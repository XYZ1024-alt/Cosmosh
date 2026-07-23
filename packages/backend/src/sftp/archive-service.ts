import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  API_CODES,
  type ApiErrorResponse,
  type ApiSftpArchiveCapabilitiesData,
  type ApiSftpArchiveCompressionLevel,
  type ApiSftpArchiveConflict,
  type ApiSftpArchiveConflictResolution,
  type ApiSftpArchiveDestinationMode,
  type ApiSftpArchiveFormat,
  type ApiSftpArchiveOperationData,
  type ApiSftpArchiveOperationRequest,
} from '@cosmosh/api-contract';
import type { Client, ClientChannel, SFTPWrapper, Stats } from 'ssh2';

import type { AuditEventService } from '../audit/service.js';

const POSIX_PATH = path.posix;
const ARCHIVE_OUTPUT_LIMIT_BYTES = 256 * 1024;
const ARCHIVE_OPERATION_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const ARCHIVE_PROBE_TIMEOUT_MS = 15 * 1_000;
const ARCHIVE_CONFLICT_TIMEOUT_MS = 10 * 60 * 1_000;
const ARCHIVE_TERMINAL_RETENTION_MS = 60 * 1_000;
const ARCHIVE_CANCEL_GRACE_MS = 3 * 1_000;
const ARCHIVE_SESSION_CLOSE_TIMEOUT_MS = ARCHIVE_CANCEL_GRACE_MS + 2_000;
const ARCHIVE_UNSUPPORTED_PASSWORD = '__cosmosh_encrypted_archives_are_unsupported__';
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

type ArchiveErrorCode = Extract<
  ApiErrorResponse['code'],
  | 'SFTP_ARCHIVE_UNSUPPORTED'
  | 'SFTP_ARCHIVE_BUSY'
  | 'SFTP_ARCHIVE_TARGET_EXISTS'
  | 'SFTP_ARCHIVE_UNSAFE_ENTRY'
  | 'SFTP_ARCHIVE_OPERATION_NOT_FOUND'
  | 'SFTP_ARCHIVE_OPERATION_FAILED'
  | 'SFTP_ARCHIVE_TIMEOUT'
  | 'SFTP_ARCHIVE_CANCEL_FAILED'
  | 'SFTP_VALIDATION_FAILED'
>;

type RemoteEntry = {
  filename: string;
  attrs: Stats;
};

type RemoteCommandResult = {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  signal: string | null;
};

type ConflictWaiter = {
  promise: Promise<ApiSftpArchiveConflictResolution>;
  resolve: (resolution: ApiSftpArchiveConflictResolution) => void;
  timer: NodeJS.Timeout;
};

type ArchiveOperationRecord = {
  publicData: ApiSftpArchiveOperationData;
  session: SftpArchiveSession;
  request: ApiSftpArchiveOperationRequest;
  deadlineAt: number;
  channel?: ClientChannel;
  cancelSignalledChannel?: ClientChannel;
  cancelFallbackTimer?: NodeJS.Timeout;
  temporaryPaths: Set<string>;
  provisionalDirectories: Set<string>;
  cleanupPromise?: Promise<boolean>;
  conflictWaiter?: ConflictWaiter;
  retentionTimer?: NodeJS.Timeout;
};

type ArchiveToolSet = Set<string>;

/**
 * Minimal live-session surface required by controlled remote archive execution.
 */
export type SftpArchiveSession = {
  sessionId: string;
  serverId: string;
  client: Client;
  sftp: SFTPWrapper;
  isClosed: boolean;
};

/**
 * Typed archive error used by the HTTP layer for stable status and error-code mapping.
 */
export class SftpArchiveError extends Error {
  public readonly code: ArchiveErrorCode;

  /**
   * @param code Stable API error code.
   * @param message Sanitized user-facing error summary.
   */
  public constructor(code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = 'SftpArchiveError';
    this.code = code;
  }
}

class SftpArchiveCancelledError extends Error {
  /** Creates the internal cancellation sentinel. */
  public constructor() {
    super('Archive operation cancelled.');
    this.name = 'SftpArchiveCancelledError';
  }
}

/**
 * Quotes one token for a POSIX shell without allowing command substitution or flag injection.
 *
 * @param value Raw token value.
 * @returns Single-quoted POSIX shell token.
 */
export const quotePosixShellToken = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

/**
 * Maps a displayed archive name to the canonical format understood by the backend.
 *
 * @param archiveName Remote archive basename.
 * @returns Canonical format when the compound extension is supported.
 */
export const detectArchiveFormatFromName = (archiveName: string): ApiSftpArchiveFormat | null => {
  const normalized = archiveName.toLowerCase();
  if (normalized.endsWith('.tar.gz') || normalized.endsWith('.tgz')) return 'tar-gzip';
  if (normalized.endsWith('.tar.xz') || normalized.endsWith('.txz')) return 'tar-xz';
  if (normalized.endsWith('.tar.bz2') || normalized.endsWith('.tbz2')) return 'tar-bzip2';
  if (normalized.endsWith('.tar')) return 'tar';
  if (normalized.endsWith('.zip')) return 'zip';
  if (normalized.endsWith('.7z')) return '7z';
  return null;
};

/**
 * Removes one recognized archive extension for destination-directory naming.
 *
 * @param archiveName Remote archive basename.
 * @returns Basename without its recognized compound extension.
 */
export const stripArchiveExtension = (archiveName: string): string => {
  const format = detectArchiveFormatFromName(archiveName);
  if (!format) return archiveName;
  const suffixes: Record<ApiSftpArchiveFormat, string[]> = {
    tar: ['.tar'],
    'tar-gzip': ['.tar.gz', '.tgz'],
    zip: ['.zip'],
    'tar-xz': ['.tar.xz', '.txz'],
    'tar-bzip2': ['.tar.bz2', '.tbz2'],
    '7z': ['.7z'],
  };
  const lowerName = archiveName.toLowerCase();
  const suffix = suffixes[format].find((candidate) => lowerName.endsWith(candidate));
  return suffix ? archiveName.slice(0, -suffix.length) || 'archive' : archiveName;
};

/**
 * Rejects absolute paths, parent traversal, control characters, and ambiguous empty members.
 *
 * @param memberName Member path returned by the remote archive tool.
 * @returns Whether the member can be extracted inside a random staging directory.
 */
export const isSafeArchiveMember = (memberName: string): boolean => {
  const normalizedSeparators = memberName.replace(/\\/g, '/');
  if (!normalizedSeparators || hasControlCharacters(normalizedSeparators)) return false;
  if (normalizedSeparators.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedSeparators)) return false;
  const segments = normalizedSeparators.split('/').filter(Boolean);
  return segments.every((segment) => segment !== '..');
};

/**
 * Resolves create/extract formats from a remote executable probe.
 *
 * @param tools Executable basenames available on the remote host.
 * @param sessionId Owning SFTP session id.
 * @returns Public capability payload.
 */
export const buildArchiveCapabilities = (
  tools: ReadonlySet<string>,
  sessionId: string,
): ApiSftpArchiveCapabilitiesData => {
  const has7z = tools.has('7z') || tools.has('7zz');
  const createFormats: ApiSftpArchiveFormat[] = [];
  const extractFormats: ApiSftpArchiveFormat[] = [];
  if (tools.has('tar')) {
    createFormats.push('tar');
    extractFormats.push('tar');
    if (tools.has('gzip')) {
      createFormats.push('tar-gzip');
      extractFormats.push('tar-gzip');
    }
    if (tools.has('xz')) {
      createFormats.push('tar-xz');
      extractFormats.push('tar-xz');
    }
    if (tools.has('bzip2')) {
      createFormats.push('tar-bzip2');
      extractFormats.push('tar-bzip2');
    }
  }
  if (tools.has('zip') || has7z) createFormats.push('zip');
  if (tools.has('unzip') || has7z) extractFormats.push('zip');
  if (has7z) {
    createFormats.push('7z');
    extractFormats.push('7z');
  }
  return { sessionId, canExec: true, createFormats, extractFormats };
};

/**
 * Owns controlled remote archive jobs for active SFTP sessions.
 */
export class SftpArchiveService {
  private readonly auditEventService: AuditEventService;

  private readonly operationTimeoutMs: number;

  private readonly sessionCloseTimeoutMs: number;

  private readonly capabilities = new Map<string, Promise<ApiSftpArchiveCapabilitiesData>>();

  private readonly toolSets = new Map<string, Promise<ArchiveToolSet>>();

  private readonly operations = new Map<string, ArchiveOperationRecord>();

  private readonly activeOperationBySession = new Map<string, string>();

  private readonly startingSessions = new Set<string>();

  /**
   * @param options Service dependencies.
   */
  public constructor(options: {
    auditEventService: AuditEventService;
    operationTimeoutMs?: number;
    sessionCloseTimeoutMs?: number;
  }) {
    this.auditEventService = options.auditEventService;
    this.operationTimeoutMs = Math.max(1, options.operationTimeoutMs ?? ARCHIVE_OPERATION_TIMEOUT_MS);
    this.sessionCloseTimeoutMs = Math.max(0, options.sessionCloseTimeoutMs ?? ARCHIVE_SESSION_CLOSE_TIMEOUT_MS);
  }

  /**
   * Returns cached session capabilities or probes fixed executable names once.
   *
   * @param session Live SFTP session.
   * @returns Remote archive capabilities.
   */
  public async getCapabilities(session: SftpArchiveSession): Promise<ApiSftpArchiveCapabilitiesData> {
    const cached = this.capabilities.get(session.sessionId);
    if (cached) return cached;

    const pending = this.probeCapabilities(session).catch((error: unknown) => {
      console.warn('[sftp:archive] Remote archive capability probe failed.', sanitizeRemoteError(error));
      return {
        sessionId: session.sessionId,
        canExec: false,
        createFormats: [],
        extractFormats: [],
      } satisfies ApiSftpArchiveCapabilitiesData;
    });
    this.capabilities.set(session.sessionId, pending);
    return pending;
  }

  /**
   * Starts one archive operation without exposing its generated command.
   *
   * @param session Live SFTP session.
   * @param request Structured archive request.
   * @returns Initial asynchronous operation state.
   */
  public async startOperation(
    session: SftpArchiveSession,
    request: ApiSftpArchiveOperationRequest,
  ): Promise<ApiSftpArchiveOperationData> {
    if (this.activeOperationBySession.has(session.sessionId) || this.startingSessions.has(session.sessionId)) {
      throw new SftpArchiveError(API_CODES.sftpArchiveBusy, 'Another archive operation is active for this session.');
    }
    this.startingSessions.add(session.sessionId);
    try {
      validateArchiveRequest(request);
      const capabilities = await this.getCapabilities(session);
      if (session.isClosed) {
        throw new SftpArchiveError(
          API_CODES.sftpArchiveUnsupported,
          'The SFTP session closed before the task started.',
        );
      }
      const requestedFormat =
        request.type === 'compress'
          ? request.format
          : detectArchiveFormatFromName(POSIX_PATH.basename(request.archivePath));
      const supportedFormats = request.type === 'compress' ? capabilities.createFormats : capabilities.extractFormats;
      if (!capabilities.canExec || !requestedFormat || !supportedFormats.includes(requestedFormat)) {
        throw new SftpArchiveError(
          API_CODES.sftpArchiveUnsupported,
          'The remote host does not support this archive operation.',
        );
      }

      const operationId = randomUUID();
      const record: ArchiveOperationRecord = {
        publicData: {
          sessionId: session.sessionId,
          operationId,
          type: request.type,
          state: 'running',
          stage: 'preparing',
          cancelRequested: false,
        },
        session,
        request,
        deadlineAt: Date.now() + this.operationTimeoutMs,
        temporaryPaths: new Set<string>(),
        provisionalDirectories: new Set<string>(),
      };
      this.operations.set(operationId, record);
      this.activeOperationBySession.set(session.sessionId, operationId);
      void this.runOperation(record, requestedFormat);
      return copyOperationData(record.publicData);
    } finally {
      this.startingSessions.delete(session.sessionId);
    }
  }

  /**
   * Reads a retained operation that belongs to the requested session.
   *
   * @param sessionId Owning session id.
   * @param operationId Operation id.
   * @returns Public operation state.
   */
  public getOperation(sessionId: string, operationId: string): ApiSftpArchiveOperationData {
    const record = this.requireOperation(sessionId, operationId);
    return copyOperationData(record.publicData);
  }

  /**
   * Applies one decision to all conflicts currently held by the operation.
   *
   * @param sessionId Owning session id.
   * @param operationId Operation id.
   * @param resolution Conflict decision.
   * @returns State immediately after accepting the decision.
   */
  public resolveConflict(
    sessionId: string,
    operationId: string,
    resolution: ApiSftpArchiveConflictResolution,
  ): ApiSftpArchiveOperationData {
    const record = this.requireOperation(sessionId, operationId);
    if (record.publicData.state !== 'awaiting-conflict' || !record.conflictWaiter) {
      throw new SftpArchiveError(
        API_CODES.sftpValidationFailed,
        'The archive operation is not waiting for conflict resolution.',
      );
    }
    record.conflictWaiter.resolve(resolution);
    return copyOperationData(record.publicData);
  }

  /**
   * Requests cancellation and signals the active remote process when one exists.
   *
   * @param sessionId Owning session id.
   * @param operationId Operation id.
   * @returns State after the cancellation request was registered.
   */
  public cancelOperation(sessionId: string, operationId: string): ApiSftpArchiveOperationData {
    const record = this.requireOperation(sessionId, operationId);
    if (isTerminalState(record.publicData.state)) return copyOperationData(record.publicData);
    record.publicData.cancelRequested = true;
    record.conflictWaiter?.resolve('cancel');
    if (record.channel) requestRemoteCommandCancellation(record, record.channel);
    return copyOperationData(record.publicData);
  }

  /**
   * Cancels and cleans an active operation before its SSH transport is closed.
   *
   * @param sessionId Closing session id.
   * @returns Promise resolved after bounded cleanup.
   */
  public async closeSession(sessionId: string): Promise<void> {
    this.capabilities.delete(sessionId);
    this.toolSets.delete(sessionId);
    const operationId = this.activeOperationBySession.get(sessionId);
    if (!operationId) return;
    const record = this.operations.get(operationId);
    if (!record) return;
    try {
      this.cancelOperation(sessionId, operationId);
    } catch (error: unknown) {
      console.warn('[sftp:archive] Failed to signal operation during session close.', sanitizeRemoteError(error));
    }
    const closeDeadlineAt = Date.now() + this.sessionCloseTimeoutMs;
    await waitUntil(() => isTerminalState(record.publicData.state), remainingDuration(closeDeadlineAt));
    if (record.temporaryPaths.size > 0 || record.provisionalDirectories.size > 0) {
      const cleanupCompleted = await waitForPromiseUntil(this.cleanupTemporaryPaths(record), closeDeadlineAt);
      if (!cleanupCompleted) {
        console.warn('[sftp:archive] Session close stopped waiting for remote temporary-path cleanup.');
      }
    }
  }

  /**
   * Drops private state after an unexpected transport close.
   *
   * @param sessionId Closed session id.
   * @returns void.
   */
  public handleTransportClosed(sessionId: string): void {
    this.capabilities.delete(sessionId);
    this.toolSets.delete(sessionId);
    const operationId = this.activeOperationBySession.get(sessionId);
    if (!operationId) return;
    const record = this.operations.get(operationId);
    if (!record) return;
    record.publicData.cancelRequested = true;
    record.conflictWaiter?.resolve('cancel');
  }

  /** Runs one operation through execution, commit, audit, and cleanup. */
  private async runOperation(record: ArchiveOperationRecord, format: ApiSftpArchiveFormat): Promise<void> {
    let terminalState: Extract<ApiSftpArchiveOperationData['state'], 'succeeded' | 'failed' | 'cancelled'> = 'failed';
    try {
      const resultPaths =
        record.request.type === 'compress'
          ? await this.runCompression(record, record.request, format)
          : await this.runExtraction(record, record.request, format);
      record.publicData.resultPaths = resultPaths;
      terminalState = 'succeeded';
    } catch (error: unknown) {
      if (error instanceof SftpArchiveCancelledError || record.publicData.cancelRequested) {
        terminalState = 'cancelled';
      } else {
        const archiveError = normalizeArchiveError(error);
        terminalState = 'failed';
        record.publicData.errorCode = archiveError.code;
        record.publicData.errorMessage = archiveError.message;
      }
    } finally {
      if (record.publicData.state === 'awaiting-conflict') record.publicData.state = 'running';
      record.publicData.stage = 'cleaning';
      const cleanupSucceeded = await this.cleanupTemporaryPaths(record);
      record.channel = undefined;
      if (!cleanupSucceeded) {
        terminalState = 'failed';
        if (!record.publicData.errorCode) {
          record.publicData.errorCode = record.publicData.cancelRequested
            ? API_CODES.sftpArchiveCancelFailed
            : API_CODES.sftpArchiveOperationFailed;
          record.publicData.errorMessage = 'The archive task ended before temporary items could be cleaned.';
        }
      }
      record.publicData.state = terminalState;
      record.publicData.stage = 'completed';
      this.logOperation(record, terminalState === 'succeeded' ? 'success' : 'failure', format);
      this.activeOperationBySession.delete(record.session.sessionId);
      record.retentionTimer = setTimeout(
        () => this.operations.delete(record.publicData.operationId),
        ARCHIVE_TERMINAL_RETENTION_MS,
      );
      record.retentionTimer.unref();
    }
  }

  /** Creates one archive in a sibling temporary file and atomically submits it. */
  private async runCompression(
    record: ArchiveOperationRecord,
    request: Extract<ApiSftpArchiveOperationRequest, { type: 'compress' }>,
    format: ApiSftpArchiveFormat,
  ): Promise<string[]> {
    const targetDirectory = normalizeRemotePath(request.targetDirectoryPath);
    const sourcePaths = request.sourcePaths.map(normalizeRemotePath);
    const targetPath = POSIX_PATH.join(targetDirectory, request.archiveName);
    await this.assertCompressionInputs(record, sourcePaths, targetDirectory, targetPath);

    const temporaryName = `.cosmosh-${randomUUID()}.partial${archiveExtension(format)}`;
    const temporaryPath = POSIX_PATH.join(targetDirectory, temporaryName);
    record.temporaryPaths.add(temporaryPath);
    const intermediateName =
      format === 'tar-gzip' || format === 'tar-xz' || format === 'tar-bzip2'
        ? `.cosmosh-${randomUUID()}.partial.tar`
        : undefined;
    if (intermediateName) record.temporaryPaths.add(POSIX_PATH.join(targetDirectory, intermediateName));
    record.publicData.stage = 'compressing';
    const toolSet = await this.getToolSet(record.session);
    const command = buildCompressionCommand(
      format,
      request.compressionLevel,
      targetDirectory,
      temporaryName,
      intermediateName,
      sourcePaths.map((sourcePath) => POSIX_PATH.basename(sourcePath)),
      toolSet,
    );
    await this.runCheckedCommand(record, command);
    if (intermediateName) record.temporaryPaths.delete(POSIX_PATH.join(targetDirectory, intermediateName));
    assertOperationActive(record);
    record.publicData.stage = 'committing';
    if (await pathExists(record.session.sftp, targetPath, record.deadlineAt)) {
      throw new SftpArchiveError(API_CODES.sftpArchiveTargetExists, 'The archive target already exists.');
    }
    assertOperationActive(record);
    await renameRemote(record.session.sftp, temporaryPath, targetPath, record.deadlineAt);
    record.temporaryPaths.delete(temporaryPath);
    return [targetPath];
  }

  /** Validates, extracts, and commits one remote archive. */
  private async runExtraction(
    record: ArchiveOperationRecord,
    request: Extract<ApiSftpArchiveOperationRequest, { type: 'extract' }>,
    format: ApiSftpArchiveFormat,
  ): Promise<string[]> {
    const archivePath = normalizeRemotePath(request.archivePath);
    const targetDirectory = normalizeRemotePath(request.targetDirectoryPath);
    if (!POSIX_PATH.isAbsolute(archivePath) || !POSIX_PATH.isAbsolute(targetDirectory) || targetDirectory === '/') {
      throw new SftpArchiveError(
        API_CODES.sftpValidationFailed,
        'Archive and destination paths must be absolute, and extraction at the remote root is not allowed.',
      );
    }
    const archiveStats = await lstatRemote(record.session.sftp, archivePath, record.deadlineAt);
    if ((archiveStats.mode & S_IFMT) !== S_IFREG) {
      throw new SftpArchiveError(API_CODES.sftpArchiveUnsupported, 'Only regular archive files can be extracted.');
    }
    const createdDirectories = await ensureRemoteDirectory(
      record.session.sftp,
      targetDirectory,
      () => assertOperationActive(record),
      (createdDirectory) => record.provisionalDirectories.add(createdDirectory),
      record.deadlineAt,
    );
    await validateArchiveHeader(record.session.sftp, archivePath, format, record.deadlineAt);
    const toolSet = await this.getToolSet(record.session);
    const compressedTarFormat = isCompressedTarFormat(format) ? format : undefined;
    const expandedTarPath = compressedTarFormat
      ? POSIX_PATH.join(targetDirectory, `.cosmosh-${randomUUID()}.partial.tar`)
      : undefined;
    if (compressedTarFormat && expandedTarPath) {
      record.temporaryPaths.add(expandedTarPath);
      await this.runCheckedCommand(
        record,
        buildCompressedTarExpansionCommand(compressedTarFormat, archivePath, expandedTarPath),
      );
      await validateArchiveHeader(record.session.sftp, expandedTarPath, 'tar', record.deadlineAt);
    }
    const extractionArchivePath = expandedTarPath ?? archivePath;
    const extractionFormat = expandedTarPath ? 'tar' : format;
    const members = await this.listArchiveMembers(record, extractionArchivePath, extractionFormat, toolSet);
    if (members.some((member) => !isSafeArchiveMember(member))) {
      throw new SftpArchiveError(API_CODES.sftpArchiveUnsafeEntry, 'The archive contains an unsafe member path.');
    }

    const stagingPath = POSIX_PATH.join(targetDirectory, `.cosmosh-${randomUUID()}`);
    await mkdirRemote(record.session.sftp, stagingPath, 0o700, record.deadlineAt);
    record.temporaryPaths.add(stagingPath);
    record.publicData.stage = 'extracting';
    await this.runCheckedCommand(
      record,
      buildExtractionCommand(extractionFormat, extractionArchivePath, stagingPath, toolSet),
    );
    if (expandedTarPath) {
      await unlinkRemote(record.session.sftp, expandedTarPath, record.deadlineAt);
      record.temporaryPaths.delete(expandedTarPath);
    }
    assertOperationActive(record);
    record.publicData.stage = 'verifying';
    await validateStagedTree(
      record.session.sftp,
      stagingPath,
      stagingPath,
      () => assertOperationActive(record),
      S_IFDIR,
      record.deadlineAt,
    );
    record.publicData.stage = 'committing';
    const resultPaths = await this.commitExtractedEntries(
      record,
      stagingPath,
      targetDirectory,
      archivePath,
      request.destinationMode,
    );
    for (const createdDirectory of createdDirectories) record.provisionalDirectories.delete(createdDirectory);
    return resultPaths;
  }

  /** Commits staged extraction output according to smart/current/named rules. */
  private async commitExtractedEntries(
    record: ArchiveOperationRecord,
    stagingPath: string,
    targetDirectory: string,
    archivePath: string,
    destinationMode: ApiSftpArchiveDestinationMode,
  ): Promise<string[]> {
    assertOperationActive(record);
    const entries = await readdirRemote(record.session.sftp, stagingPath, record.deadlineAt);
    assertOperationActive(record);
    const archiveDirectoryName = stripArchiveExtension(POSIX_PATH.basename(archivePath));
    if (destinationMode === 'smart' && entries.length !== 1) {
      const uniquePath = await findAvailablePath(
        record.session.sftp,
        POSIX_PATH.join(targetDirectory, archiveDirectoryName),
        record.deadlineAt,
      );
      assertOperationActive(record);
      await renameRemote(record.session.sftp, stagingPath, uniquePath, record.deadlineAt);
      record.temporaryPaths.delete(stagingPath);
      return [uniquePath];
    }

    if (destinationMode === 'archive-name-directory') {
      const targetPath = POSIX_PATH.join(targetDirectory, archiveDirectoryName);
      if (!(await pathExists(record.session.sftp, targetPath, record.deadlineAt))) {
        assertOperationActive(record);
        await renameRemote(record.session.sftp, stagingPath, targetPath, record.deadlineAt);
        record.temporaryPaths.delete(stagingPath);
        return [targetPath];
      }
      assertOperationActive(record);
      const resolution = await this.waitForConflicts(record, [toConflict(stagingPath, targetPath, 'directory')]);
      if (resolution === 'cancel') throw new SftpArchiveCancelledError();
      if (resolution === 'keep-both') {
        const uniquePath = await findAvailablePath(record.session.sftp, targetPath, record.deadlineAt);
        assertOperationActive(record);
        await renameRemote(record.session.sftp, stagingPath, uniquePath, record.deadlineAt);
        record.temporaryPaths.delete(stagingPath);
        return [uniquePath];
      }
      assertOperationActive(record);
      await mergeRemoteEntry(
        record.session.sftp,
        stagingPath,
        targetPath,
        () => assertOperationActive(record),
        record.deadlineAt,
      );
      record.temporaryPaths.delete(stagingPath);
      return [targetPath];
    }

    const conflicts: ApiSftpArchiveConflict[] = [];
    for (const entry of entries) {
      assertOperationActive(record);
      const sourcePath = POSIX_PATH.join(stagingPath, entry.filename);
      const targetPath = POSIX_PATH.join(targetDirectory, entry.filename);
      if (await pathExists(record.session.sftp, targetPath, record.deadlineAt)) {
        conflicts.push(toConflict(sourcePath, targetPath, entryType(entry.attrs.mode)));
      }
      assertOperationActive(record);
    }
    const resolution = conflicts.length > 0 ? await this.waitForConflicts(record, conflicts) : 'overwrite';
    if (resolution === 'cancel') throw new SftpArchiveCancelledError();
    const resultPaths: string[] = [];
    for (const entry of entries) {
      assertOperationActive(record);
      const sourcePath = POSIX_PATH.join(stagingPath, entry.filename);
      const desiredPath = POSIX_PATH.join(targetDirectory, entry.filename);
      if (!(await pathExists(record.session.sftp, desiredPath, record.deadlineAt))) {
        assertOperationActive(record);
        await renameRemote(record.session.sftp, sourcePath, desiredPath, record.deadlineAt);
        resultPaths.push(desiredPath);
      } else if (resolution === 'keep-both') {
        const uniquePath = await findAvailablePath(record.session.sftp, desiredPath, record.deadlineAt);
        assertOperationActive(record);
        await renameRemote(record.session.sftp, sourcePath, uniquePath, record.deadlineAt);
        resultPaths.push(uniquePath);
      } else {
        assertOperationActive(record);
        await mergeRemoteEntry(
          record.session.sftp,
          sourcePath,
          desiredPath,
          () => assertOperationActive(record),
          record.deadlineAt,
        );
        resultPaths.push(desiredPath);
      }
    }
    await removeRemoteTree(record.session.sftp, stagingPath, undefined, record.deadlineAt);
    record.temporaryPaths.delete(stagingPath);
    return resultPaths;
  }

  /** Suspends commit until one conflict decision is supplied or expires. */
  private async waitForConflicts(
    record: ArchiveOperationRecord,
    conflicts: ApiSftpArchiveConflict[],
  ): Promise<ApiSftpArchiveConflictResolution> {
    record.publicData.state = 'awaiting-conflict';
    record.publicData.stage = 'awaiting-conflict';
    record.publicData.conflicts = conflicts;
    let resolvePromise!: (resolution: ApiSftpArchiveConflictResolution) => void;
    const promise = new Promise<ApiSftpArchiveConflictResolution>((resolve) => {
      resolvePromise = resolve;
    });
    const timer = setTimeout(() => resolvePromise('cancel'), ARCHIVE_CONFLICT_TIMEOUT_MS);
    timer.unref();
    record.conflictWaiter = {
      promise,
      resolve: (resolution) => {
        clearTimeout(timer);
        resolvePromise(resolution);
      },
      timer,
    };
    try {
      return await waitForPromiseBeforeDeadline(() => promise, record.deadlineAt);
    } finally {
      clearTimeout(timer);
      record.conflictWaiter = undefined;
      record.publicData.conflicts = undefined;
      record.publicData.state = 'running';
      record.publicData.stage = 'committing';
    }
  }

  /** Lists archive members through the selected fixed tool template. */
  private async listArchiveMembers(
    record: ArchiveOperationRecord,
    archivePath: string,
    format: ApiSftpArchiveFormat,
    tools: ArchiveToolSet,
  ): Promise<string[]> {
    const result = await this.runCheckedCommand(record, buildArchiveListCommand(format, archivePath, tools));
    if (result.stdoutTruncated) {
      throw new SftpArchiveError(
        API_CODES.sftpArchiveUnsafeEntry,
        'The archive member list exceeded the safe validation limit.',
      );
    }
    if (format === 'zip' && tools.has('unzip')) {
      await this.runCheckedCommand(record, buildZipIntegrityCommand(archivePath));
    }
    if (/^Encrypted\s*=\s*\+/im.test(result.stdout)) {
      throw new SftpArchiveError(API_CODES.sftpArchiveUnsupported, 'Encrypted archives are not supported.');
    }
    if (format === '7z' || (format === 'zip' && !tools.has('unzip'))) {
      const archiveName = POSIX_PATH.basename(archivePath);
      return result.stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('Path = '))
        .map((line) => line.slice('Path = '.length).trim())
        .filter((member) => member && member !== archivePath && member !== archiveName);
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /** Runs a fixed remote command and converts non-zero exits into stable errors. */
  private async runCheckedCommand(record: ArchiveOperationRecord, command: string): Promise<RemoteCommandResult> {
    assertOperationActive(record);
    const result = await runRemoteCommand(record.session.client, command, record, remainingDuration(record.deadlineAt));
    record.channel = undefined;
    assertOperationActive(record);
    if (result.exitCode !== 0) {
      const summary = sanitizeRemoteOutput(result.stderr || result.stdout);
      throw new SftpArchiveError(
        API_CODES.sftpArchiveOperationFailed,
        summary ? `Remote archive tool failed: ${summary}` : 'The remote archive tool failed.',
      );
    }
    return result;
  }

  /** Probes command availability without accepting renderer-provided shell content. */
  private async probeCapabilities(session: SftpArchiveSession): Promise<ApiSftpArchiveCapabilitiesData> {
    const tools = await this.getToolSet(session);
    return buildArchiveCapabilities(tools, session.sessionId);
  }

  /** Reads fixed executable names from the remote POSIX shell. */
  private async getToolSet(session: SftpArchiveSession): Promise<ArchiveToolSet> {
    const cached = this.toolSets.get(session.sessionId);
    if (cached) return cached;
    const pending = this.probeToolSet(session).catch((error: unknown) => {
      this.toolSets.delete(session.sessionId);
      throw error;
    });
    this.toolSets.set(session.sessionId, pending);
    return pending;
  }

  /** Executes the fixed remote executable probe once for a session tool snapshot. */
  private async probeToolSet(session: SftpArchiveSession): Promise<ArchiveToolSet> {
    const command =
      'for c in sh tar gzip xz bzip2 zip unzip 7z 7zz; do if command -v "$c" >/dev/null 2>&1; then printf \'%s\\n\' "$c"; fi; done';
    const result = await runRemoteCommand(session.client, command, undefined, ARCHIVE_PROBE_TIMEOUT_MS);
    if (result.exitCode !== 0) throw new Error('Remote exec is unavailable.');
    return new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }

  /** Verifies compression paths, types, and non-overwrite behavior before exec. */
  private async assertCompressionInputs(
    record: ArchiveOperationRecord,
    sourcePaths: string[],
    targetDirectory: string,
    targetPath: string,
  ): Promise<void> {
    if (targetDirectory === '/' || targetDirectory === '.') {
      throw new SftpArchiveError(API_CODES.sftpValidationFailed, 'Archive output at the remote root is not allowed.');
    }
    if (sourcePaths.some((sourcePath) => POSIX_PATH.dirname(sourcePath) !== targetDirectory)) {
      throw new SftpArchiveError(
        API_CODES.sftpValidationFailed,
        'All archive sources must share the target directory.',
      );
    }
    if (await pathExists(record.session.sftp, targetPath, record.deadlineAt)) {
      throw new SftpArchiveError(API_CODES.sftpArchiveTargetExists, 'The archive target already exists.');
    }
    assertOperationActive(record);
    for (const sourcePath of sourcePaths) {
      const stats = await lstatRemote(record.session.sftp, sourcePath, record.deadlineAt);
      assertOperationActive(record);
      const type = stats.mode & S_IFMT;
      if (type !== S_IFREG && type !== S_IFDIR && type !== 0o120000) {
        throw new SftpArchiveError(API_CODES.sftpArchiveUnsupported, 'The selected source type is not supported.');
      }
    }
  }

  /** Returns the single active cleanup attempt for this operation. */
  private cleanupTemporaryPaths(record: ArchiveOperationRecord): Promise<boolean> {
    const activeCleanup = record.cleanupPromise;
    if (activeCleanup) return activeCleanup;
    const cleanupPromise = this.performTemporaryPathCleanup(record);
    record.cleanupPromise = cleanupPromise;
    void cleanupPromise.then(
      () => {
        if (record.cleanupPromise === cleanupPromise) record.cleanupPromise = undefined;
      },
      () => {
        if (record.cleanupPromise === cleanupPromise) record.cleanupPromise = undefined;
      },
    );
    return cleanupPromise;
  }

  /** Removes every known temporary path without blind directory scanning. */
  private async performTemporaryPathCleanup(record: ArchiveOperationRecord): Promise<boolean> {
    let succeeded = true;
    for (const temporaryPath of [...record.temporaryPaths].reverse()) {
      try {
        await removeRemoteTree(record.session.sftp, temporaryPath, undefined, record.deadlineAt);
        record.temporaryPaths.delete(temporaryPath);
      } catch (error: unknown) {
        succeeded = false;
        console.warn('[sftp:archive] Failed to clean a known temporary path.', sanitizeRemoteError(error));
        if (isArchiveTimeoutError(error)) return false;
      }
    }
    const provisionalDirectories = [...record.provisionalDirectories].sort((left, right) => right.length - left.length);
    for (const provisionalDirectory of provisionalDirectories) {
      try {
        await rmdirRemote(record.session.sftp, provisionalDirectory, record.deadlineAt);
        record.provisionalDirectories.delete(provisionalDirectory);
      } catch (error: unknown) {
        if (isNoSuchFileError(error)) {
          record.provisionalDirectories.delete(provisionalDirectory);
          continue;
        }
        try {
          if ((await readdirRemote(record.session.sftp, provisionalDirectory, record.deadlineAt)).length > 0) {
            record.provisionalDirectories.delete(provisionalDirectory);
            continue;
          }
        } catch {
          // Preserve the original cleanup failure below.
        }
        succeeded = false;
        console.warn('[sftp:archive] Failed to remove an empty extraction destination.', sanitizeRemoteError(error));
        if (isArchiveTimeoutError(error)) return false;
      }
    }
    return succeeded;
  }

  /** Returns an operation only when its session ownership matches. */
  private requireOperation(sessionId: string, operationId: string): ArchiveOperationRecord {
    const record = this.operations.get(operationId);
    if (!record || record.publicData.sessionId !== sessionId) {
      throw new SftpArchiveError(API_CODES.sftpArchiveOperationNotFound, 'Archive operation not found.');
    }
    return record;
  }

  /** Emits bounded archive metadata without commands, tool output, or credentials. */
  private logOperation(
    record: ArchiveOperationRecord,
    outcome: 'success' | 'failure',
    format: ApiSftpArchiveFormat,
  ): void {
    const request = record.request;
    void this.auditEventService.logEvent({
      category: 'sftp-session',
      action: `archive-${request.type}`,
      outcome,
      severity: outcome === 'success' ? 'info' : 'warning',
      entityType: 'ssh-server',
      entityId: record.session.serverId,
      sessionId: record.session.sessionId,
      correlationId: record.publicData.operationId,
      metadata: {
        format,
        sourceCount: request.type === 'compress' ? request.sourcePaths.length : 1,
        target:
          request.type === 'compress'
            ? POSIX_PATH.join(request.targetDirectoryPath, request.archiveName)
            : request.targetDirectoryPath,
        result: record.publicData.state,
        errorCode: record.publicData.errorCode,
      },
    });
  }
}

/** Validates fields that must never reach shell command construction unchecked. */
const validateArchiveRequest = (request: ApiSftpArchiveOperationRequest): void => {
  const paths =
    request.type === 'compress'
      ? [...request.sourcePaths, request.targetDirectoryPath]
      : [request.archivePath, request.targetDirectoryPath];
  if (paths.some((candidate) => !candidate.trim() || hasControlCharacters(candidate))) {
    throw new SftpArchiveError(API_CODES.sftpValidationFailed, 'Archive paths contain invalid characters.');
  }
  if (request.type === 'compress') {
    if (
      request.archiveName !== POSIX_PATH.basename(request.archiveName) ||
      request.archiveName === '.' ||
      request.archiveName === '..' ||
      /[\\/]/.test(request.archiveName) ||
      hasControlCharacters(request.archiveName)
    ) {
      throw new SftpArchiveError(API_CODES.sftpValidationFailed, 'archiveName must be a safe basename.');
    }
    if (detectArchiveFormatFromName(request.archiveName) !== request.format) {
      throw new SftpArchiveError(API_CODES.sftpValidationFailed, 'archiveName does not match the selected format.');
    }
    if (
      (request.format === 'tar' && request.compressionLevel !== 'store') ||
      (request.format !== 'tar' && request.compressionLevel === 'store')
    ) {
      throw new SftpArchiveError(
        API_CODES.sftpValidationFailed,
        'compressionLevel does not match the selected format.',
      );
    }
  }
};

/** Normalizes one structured remote path while preserving POSIX semantics. */
const normalizeRemotePath = (value: string): string => POSIX_PATH.normalize(value.replace(/\\/g, '/'));

/** Returns the standard temporary-file extension for a canonical format. */
const archiveExtension = (format: ApiSftpArchiveFormat): string =>
  ({
    tar: '.tar',
    'tar-gzip': '.tar.gz',
    zip: '.zip',
    'tar-xz': '.tar.xz',
    'tar-bzip2': '.tar.bz2',
    '7z': '.7z',
  })[format];

/** Returns whether a canonical format uses an externally compressed tar stream. */
const isCompressedTarFormat = (
  format: ApiSftpArchiveFormat,
): format is Extract<ApiSftpArchiveFormat, 'tar-gzip' | 'tar-xz' | 'tar-bzip2'> =>
  format === 'tar-gzip' || format === 'tar-xz' || format === 'tar-bzip2';

/** Maps a user compression level to a tool-supported numeric level. */
const numericCompressionLevel = (level: ApiSftpArchiveCompressionLevel): number =>
  ({ store: 0, fast: 1, standard: 6, maximum: 9 })[level];

/** Builds one fixed compression command from validated tokens. */
const buildCompressionCommand = (
  format: ApiSftpArchiveFormat,
  level: ApiSftpArchiveCompressionLevel,
  directoryPath: string,
  temporaryName: string,
  intermediateName: string | undefined,
  sourceNames: string[],
  tools: ArchiveToolSet,
): string => {
  const cwd = quotePosixShellToken(directoryPath);
  const output = quotePosixShellToken(`./${temporaryName}`);
  const sources = sourceNames.map((name) => quotePosixShellToken(`./${name}`)).join(' ');
  const numericLevel = numericCompressionLevel(level);
  if (format === 'tar') return `cd ${cwd} && tar -cf ${output} -- ${sources}`;
  const intermediate = quotePosixShellToken(`./${intermediateName ?? `${temporaryName}.tar`}`);
  if (format === 'tar-gzip') {
    return `cd ${cwd} && tar -cf ${intermediate} -- ${sources} && gzip -${numericLevel} -c -- ${intermediate} > ${output} && rm -f -- ${intermediate}`;
  }
  if (format === 'tar-xz') {
    return `cd ${cwd} && tar -cf ${intermediate} -- ${sources} && xz -${numericLevel} -c -- ${intermediate} > ${output} && rm -f -- ${intermediate}`;
  }
  if (format === 'tar-bzip2') {
    return `cd ${cwd} && tar -cf ${intermediate} -- ${sources} && bzip2 -${numericLevel} -c -- ${intermediate} > ${output} && rm -f -- ${intermediate}`;
  }
  if (format === 'zip' && tools.has('zip')) {
    return `cd ${cwd} && zip -q -r -y -${numericLevel} ${output} -- ${sources}`;
  }
  const executable = tools.has('7zz') ? '7zz' : '7z';
  return `cd ${cwd} && ${executable} a -bd -y -mx=${numericLevel} -snl -- ${output} ${sources}`;
};

/** Expands one compressed tar stream into a tracked sibling temporary file. */
const buildCompressedTarExpansionCommand = (
  format: Extract<ApiSftpArchiveFormat, 'tar-gzip' | 'tar-xz' | 'tar-bzip2'>,
  archivePath: string,
  outputPath: string,
): string => {
  const executable = format === 'tar-gzip' ? 'gzip' : format === 'tar-xz' ? 'xz' : 'bzip2';
  return `exec ${executable} -dc -- ${quotePosixShellToken(archivePath)} > ${quotePosixShellToken(outputPath)}`;
};

/** Builds one fixed member-list command for traversal and encryption checks. */
const buildArchiveListCommand = (format: ApiSftpArchiveFormat, archivePath: string, tools: ArchiveToolSet): string => {
  const archive = quotePosixShellToken(archivePath);
  if (format === 'tar') return `exec tar -tf ${archive}`;
  if (format === 'tar-gzip') return `exec tar -tzf ${archive}`;
  if (format === 'tar-xz') return `exec tar -tJf ${archive}`;
  if (format === 'tar-bzip2') return `exec tar -tjf ${archive}`;
  if (format === 'zip' && tools.has('unzip')) return `exec unzip -Z1 -- ${archive}`;
  const executable = tools.has('7zz') ? '7zz' : '7z';
  return `exec ${executable} l -slt -p${ARCHIVE_UNSUPPORTED_PASSWORD} -- ${archive}`;
};

/** Builds a separate native ZIP integrity command so cancellation targets one executable. */
const buildZipIntegrityCommand = (archivePath: string): string =>
  `exec unzip -P '' -tqq -- ${quotePosixShellToken(archivePath)}`;

/** Builds one fixed extraction command targeting a random empty directory. */
const buildExtractionCommand = (
  format: ApiSftpArchiveFormat,
  archivePath: string,
  stagingPath: string,
  tools: ArchiveToolSet,
): string => {
  const archive = quotePosixShellToken(archivePath);
  const staging = quotePosixShellToken(stagingPath);
  if (format === 'tar') return `exec tar -xf ${archive} -C ${staging} --`;
  if (format === 'tar-gzip') return `exec tar -xzf ${archive} -C ${staging} --`;
  if (format === 'tar-xz') return `exec tar -xJf ${archive} -C ${staging} --`;
  if (format === 'tar-bzip2') return `exec tar -xjf ${archive} -C ${staging} --`;
  if (format === 'zip' && tools.has('unzip')) return `exec unzip -P '' -qq -n -- ${archive} -d ${staging}`;
  const executable = tools.has('7zz') ? '7zz' : '7z';
  return `exec ${executable} x -bd -y -aoa -p${ARCHIVE_UNSUPPORTED_PASSWORD} -o${staging} -- ${archive}`;
};

/**
 * Closes and destroys one channel without allowing teardown errors to escape timer callbacks.
 *
 * @param channel Remote exec channel.
 * @returns void.
 */
const forceCloseRemoteCommandChannel = (channel: ClientChannel): void => {
  try {
    channel.close();
  } catch (error: unknown) {
    console.warn('[sftp:archive] Failed to close the remote archive channel.', sanitizeRemoteError(error));
  }
  try {
    channel.destroy();
  } catch (error: unknown) {
    console.warn('[sftp:archive] Failed to destroy the remote archive channel.', sanitizeRemoteError(error));
  }
};

/**
 * Sends TERM once and retains a forced local channel teardown for non-compliant servers.
 *
 * @param record Owning archive operation.
 * @param channel Active remote exec channel.
 * @returns void.
 */
const requestRemoteCommandCancellation = (record: ArchiveOperationRecord, channel: ClientChannel): void => {
  if (record.cancelSignalledChannel === channel) return;
  if (record.cancelFallbackTimer) clearTimeout(record.cancelFallbackTimer);
  record.cancelSignalledChannel = channel;
  try {
    channel.signal('TERM');
  } catch (error: unknown) {
    console.warn(
      '[sftp:archive] Remote process rejected TERM; forcing channel close after the grace period.',
      sanitizeRemoteError(error),
    );
  }
  record.cancelFallbackTimer = setTimeout(() => {
    if (record.channel !== channel) return;
    forceCloseRemoteCommandChannel(channel);
  }, ARCHIVE_CANCEL_GRACE_MS);
  record.cancelFallbackTimer.unref();
};

/**
 * Clears cancellation bookkeeping when one remote command channel settles.
 *
 * @param record Optional owning archive operation.
 * @param channel Settled remote exec channel.
 * @returns void.
 */
const clearRemoteCommandChannel = (record: ArchiveOperationRecord | undefined, channel: ClientChannel): void => {
  if (!record) return;
  if (record.cancelSignalledChannel === channel) {
    if (record.cancelFallbackTimer) clearTimeout(record.cancelFallbackTimer);
    record.cancelFallbackTimer = undefined;
    record.cancelSignalledChannel = undefined;
  }
  if (record.channel === channel) record.channel = undefined;
};

/** Runs one command with bounded output, timeout, and optional operation cancellation. */
const runRemoteCommand = async (
  client: Client,
  command: string,
  record?: ArchiveOperationRecord,
  timeoutMs = ARCHIVE_OPERATION_TIMEOUT_MS,
): Promise<RemoteCommandResult> => {
  if (timeoutMs <= 0) throw createArchiveTimeoutError();
  return new Promise<RemoteCommandResult>((resolve, reject) => {
    let settled = false;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const channel = record?.channel;
      if (channel) {
        clearRemoteCommandChannel(record, channel);
        forceCloseRemoteCommandChannel(channel);
      }
      reject(createArchiveTimeoutError());
    }, timeoutMs);
    timeout.unref();
    client.exec(command, (error, channel) => {
      if (error) {
        clearTimeout(timeout);
        settled = true;
        reject(error);
        return;
      }
      if (settled) {
        forceCloseRemoteCommandChannel(channel);
        return;
      }
      if (record) record.channel = channel;
      channel.on('data', (chunk: Buffer | string) => {
        const appended = appendBounded(stdout, chunk);
        stdout = appended.value;
        stdoutTruncated ||= appended.truncated;
      });
      channel.stderr.on('data', (chunk: Buffer | string) => {
        const appended = appendBounded(stderr, chunk);
        stderr = appended.value;
        stderrTruncated ||= appended.truncated;
      });
      channel.on('exit', (code: number | null, signal?: string | null) => {
        exitCode = code;
        exitSignal = signal ?? null;
      });
      channel.once('error', (channelError: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearRemoteCommandChannel(record, channel);
        reject(channelError);
      });
      channel.once('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearRemoteCommandChannel(record, channel);
        resolve({
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          stdoutTruncated,
          stderrTruncated,
          exitCode,
          signal: exitSignal,
        });
      });
      if (record?.publicData.cancelRequested) requestRemoteCommandCancellation(record, channel);
    });
  });
};

type BoundedBufferAppendResult = {
  value: Buffer<ArrayBufferLike>;
  truncated: boolean;
};

/** Appends remote output without exceeding the diagnostic memory bound. */
const appendBounded = (
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike> | string,
): BoundedBufferAppendResult => {
  const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const availableBytes = Math.max(0, ARCHIVE_OUTPUT_LIMIT_BYTES - current.length);
  return {
    value: availableBytes > 0 ? Buffer.concat([current, input.subarray(0, availableBytes)]) : current,
    truncated: input.length > availableBytes,
  };
};

/** Validates a small file header against the extension-selected format. */
const validateArchiveHeader = async (
  sftp: SFTPWrapper,
  archivePath: string,
  format: ApiSftpArchiveFormat,
  deadlineAt?: number,
): Promise<void> => {
  const header = await readRemoteRange(sftp, archivePath, 0, 512, deadlineAt);
  const matches =
    format === 'tar'
      ? isTarHeader(header)
      : format === 'tar-gzip'
        ? header[0] === 0x1f && header[1] === 0x8b
        : format === 'zip'
          ? header[0] === 0x50 && header[1] === 0x4b
          : format === 'tar-xz'
            ? header.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))
            : format === 'tar-bzip2'
              ? header.subarray(0, 3).toString('ascii') === 'BZh'
              : header.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
  if (!matches) {
    throw new SftpArchiveError(API_CODES.sftpArchiveUnsupported, 'The archive header does not match its extension.');
  }
};

/** Validates the POSIX tar checksum while accepting pre-ustar archives. */
const isTarHeader = (header: Buffer<ArrayBufferLike>): boolean => {
  if (header.length < 512) return false;
  if (header.subarray(0, 512).every((value) => value === 0)) return true;
  const checksumText = header.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim();
  const expectedChecksum = Number.parseInt(checksumText, 8);
  if (!Number.isFinite(expectedChecksum)) return false;
  let actualChecksum = 0;
  for (let index = 0; index < 512; index += 1) {
    actualChecksum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  return actualChecksum === expectedChecksum;
};

/** Reads a bounded range through SFTP without downloading archive contents. */
const readRemoteRange = async (
  sftp: SFTPWrapper,
  targetPath: string,
  position: number,
  length: number,
  deadlineAt?: number,
): Promise<Buffer> => {
  const handle = await waitForPromiseBeforeDeadline(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        sftp.open(targetPath, 'r', (error, openedHandle) => (error ? reject(error) : resolve(openedHandle)));
      }),
    deadlineAt,
  );
  try {
    return await waitForPromiseBeforeDeadline(
      () =>
        new Promise<Buffer>((resolve, reject) => {
          const buffer = Buffer.alloc(length);
          sftp.read(handle, buffer, 0, length, position, (error, bytesRead) =>
            error ? reject(error) : resolve(buffer.subarray(0, bytesRead)),
          );
        }),
      deadlineAt,
    );
  } finally {
    await waitForPromiseBeforeDeadline(
      () => new Promise<void>((resolve) => sftp.close(handle, () => resolve())),
      deadlineAt,
    );
  }
};

/** Resolves an lstat request into a promise. */
const lstatRemote = async (sftp: SFTPWrapper, targetPath: string, deadlineAt?: number): Promise<Stats> =>
  waitForPromiseBeforeDeadline(
    () =>
      new Promise<Stats>((resolve, reject) => {
        sftp.lstat(targetPath, (error, stats) => (error ? reject(error) : resolve(stats)));
      }),
    deadlineAt,
  );

/** Resolves a readdir request into normalized entries. */
const readdirRemote = async (sftp: SFTPWrapper, targetPath: string, deadlineAt?: number): Promise<RemoteEntry[]> =>
  waitForPromiseBeforeDeadline(
    () =>
      new Promise<RemoteEntry[]>((resolve, reject) => {
        sftp.readdir(targetPath, (error, entries) =>
          error ? reject(error) : resolve(entries.map((entry) => ({ filename: entry.filename, attrs: entry.attrs }))),
        );
      }),
    deadlineAt,
  );

/** Reads one symbolic-link target without following it. */
const readlinkRemote = async (sftp: SFTPWrapper, targetPath: string, deadlineAt?: number): Promise<string> =>
  waitForPromiseBeforeDeadline(
    () =>
      new Promise<string>((resolve, reject) => {
        const wrapper = sftp as SFTPWrapper & {
          readlink(path: string, callback: (error: Error | undefined | null, linkPath: string) => void): void;
        };
        wrapper.readlink(targetPath, (error, linkPath) => (error ? reject(error) : resolve(linkPath)));
      }),
    deadlineAt,
  );

/**
 * Rejects staged symbolic links that resolve outside the random extraction root.
 *
 * Readdir already supplies each child's mode, so ordinary files do not incur an extra
 * network round trip. The activity callback keeps the post-extraction scan cancellable.
 *
 * @param sftp Active SFTP channel.
 * @param targetPath Entry currently being inspected.
 * @param stagingRoot Random extraction root that links must remain within.
 * @param assertActive Callback that throws when the owning task was cancelled.
 * @param knownMode Mode supplied by the parent readdir response when available.
 * @param deadlineAt Optional absolute operation deadline.
 * @returns Promise resolved after the subtree is verified.
 */
export const validateStagedTree = async (
  sftp: SFTPWrapper,
  targetPath: string,
  stagingRoot: string,
  assertActive: () => void,
  knownMode?: number,
  deadlineAt?: number,
): Promise<void> => {
  assertActive();
  const mode = knownMode ?? (await lstatRemote(sftp, targetPath, deadlineAt)).mode;
  assertActive();
  const type = mode & S_IFMT;
  if (type === 0o120000) {
    const linkPath = await readlinkRemote(sftp, targetPath, deadlineAt);
    assertActive();
    const resolvedPath = POSIX_PATH.isAbsolute(linkPath)
      ? linkPath
      : POSIX_PATH.resolve(POSIX_PATH.dirname(targetPath), linkPath);
    if (
      hasControlCharacters(linkPath) ||
      (resolvedPath !== stagingRoot && !resolvedPath.startsWith(`${stagingRoot}/`))
    ) {
      throw new SftpArchiveError(
        API_CODES.sftpArchiveUnsafeEntry,
        'The archive contains a symbolic link that escapes the extraction directory.',
      );
    }
    return;
  }
  if (type !== S_IFDIR) return;
  const entries = await readdirRemote(sftp, targetPath, deadlineAt);
  assertActive();
  for (const entry of entries) {
    assertActive();
    await validateStagedTree(
      sftp,
      POSIX_PATH.join(targetPath, entry.filename),
      stagingRoot,
      assertActive,
      entry.attrs.mode,
      deadlineAt,
    );
  }
};

/** Creates one private remote directory. */
const mkdirRemote = async (sftp: SFTPWrapper, targetPath: string, mode: number, deadlineAt?: number): Promise<void> =>
  waitForPromiseBeforeDeadline(
    () =>
      new Promise<void>((resolve, reject) => {
        sftp.mkdir(targetPath, { mode }, (error) => (error ? reject(error) : resolve()));
      }),
    deadlineAt,
  );

/**
 * Creates missing destination path segments while rejecting non-directory ancestors.
 *
 * @param sftp Active SFTP channel.
 * @param targetPath Absolute destination path.
 * @param assertActive Callback that throws when the owning task was cancelled.
 * @param onCreated Callback that immediately registers each created directory for cleanup.
 * @param deadlineAt Optional absolute operation deadline.
 * @returns Newly created paths from shallowest to deepest.
 */
const ensureRemoteDirectory = async (
  sftp: SFTPWrapper,
  targetPath: string,
  assertActive: () => void,
  onCreated: (createdPath: string) => void,
  deadlineAt?: number,
): Promise<string[]> => {
  const missingPaths: string[] = [];
  let cursor = targetPath;
  while (cursor !== '/') {
    assertActive();
    try {
      const stats = await lstatRemote(sftp, cursor, deadlineAt);
      assertActive();
      if ((stats.mode & S_IFMT) !== S_IFDIR) {
        throw new SftpArchiveError(
          API_CODES.sftpValidationFailed,
          'The extraction destination contains a non-directory path segment.',
        );
      }
      break;
    } catch (error: unknown) {
      if (!isNoSuchFileError(error)) throw error;
      missingPaths.push(cursor);
      cursor = POSIX_PATH.dirname(cursor);
    }
  }

  const createdPaths: string[] = [];
  for (const missingPath of missingPaths.reverse()) {
    assertActive();
    try {
      await mkdirRemote(sftp, missingPath, 0o755, deadlineAt);
      createdPaths.push(missingPath);
      onCreated(missingPath);
    } catch (error: unknown) {
      try {
        const stats = await lstatRemote(sftp, missingPath, deadlineAt);
        if ((stats.mode & S_IFMT) === S_IFDIR) continue;
      } catch {
        // Preserve the original mkdir failure below.
      }
      throw error;
    }
  }
  return createdPaths;
};

/** Renames one remote entry. */
const renameRemote = async (
  sftp: SFTPWrapper,
  sourcePath: string,
  targetPath: string,
  deadlineAt?: number,
): Promise<void> =>
  waitForPromiseBeforeDeadline(
    () =>
      new Promise<void>((resolve, reject) => {
        sftp.rename(sourcePath, targetPath, (error) => (error ? reject(error) : resolve()));
      }),
    deadlineAt,
  );

/** Removes one remote file or symbolic link. */
const unlinkRemote = async (sftp: SFTPWrapper, targetPath: string, deadlineAt?: number): Promise<void> =>
  waitForPromiseBeforeDeadline(
    () =>
      new Promise<void>((resolve, reject) => {
        sftp.unlink(targetPath, (error) => (error ? reject(error) : resolve()));
      }),
    deadlineAt,
  );

/** Removes one empty remote directory. */
const rmdirRemote = async (sftp: SFTPWrapper, targetPath: string, deadlineAt?: number): Promise<void> =>
  waitForPromiseBeforeDeadline(
    () =>
      new Promise<void>((resolve, reject) => {
        sftp.rmdir(targetPath, (error) => (error ? reject(error) : resolve()));
      }),
    deadlineAt,
  );

/** Detects remote path existence without swallowing non-ENOENT errors. */
const pathExists = async (sftp: SFTPWrapper, targetPath: string, deadlineAt?: number): Promise<boolean> => {
  try {
    await lstatRemote(sftp, targetPath, deadlineAt);
    return true;
  } catch (error: unknown) {
    if (isNoSuchFileError(error)) return false;
    throw error;
  }
};

/** Removes one known entry recursively with optional cancellation boundaries. */
const removeRemoteTree = async (
  sftp: SFTPWrapper,
  targetPath: string,
  assertActive?: () => void,
  deadlineAt?: number,
): Promise<void> => {
  assertActive?.();
  let stats: Stats;
  try {
    stats = await lstatRemote(sftp, targetPath, deadlineAt);
  } catch (error: unknown) {
    if (isNoSuchFileError(error)) return;
    throw error;
  }
  assertActive?.();
  if ((stats.mode & S_IFMT) !== S_IFDIR) {
    await unlinkRemote(sftp, targetPath, deadlineAt);
    return;
  }
  const entries = await readdirRemote(sftp, targetPath, deadlineAt);
  assertActive?.();
  for (const entry of entries) {
    assertActive?.();
    await removeRemoteTree(sftp, POSIX_PATH.join(targetPath, entry.filename), assertActive, deadlineAt);
  }
  assertActive?.();
  await rmdirRemote(sftp, targetPath, deadlineAt);
};

/** Merges directories recursively while checking cancellation between remote requests. */
const mergeRemoteEntry = async (
  sftp: SFTPWrapper,
  sourcePath: string,
  targetPath: string,
  assertActive: () => void,
  deadlineAt?: number,
): Promise<void> => {
  assertActive();
  const sourceStats = await lstatRemote(sftp, sourcePath, deadlineAt);
  assertActive();
  const targetStats = await lstatRemote(sftp, targetPath, deadlineAt);
  assertActive();
  const sourceIsDirectory = (sourceStats.mode & S_IFMT) === S_IFDIR;
  const targetIsDirectory = (targetStats.mode & S_IFMT) === S_IFDIR;
  if (!sourceIsDirectory || !targetIsDirectory) {
    assertActive();
    await removeRemoteTree(sftp, targetPath, undefined, deadlineAt);
    await renameRemote(sftp, sourcePath, targetPath, deadlineAt);
    return;
  }
  const entries = await readdirRemote(sftp, sourcePath, deadlineAt);
  assertActive();
  for (const entry of entries) {
    assertActive();
    const childSource = POSIX_PATH.join(sourcePath, entry.filename);
    const childTarget = POSIX_PATH.join(targetPath, entry.filename);
    const childExists = await pathExists(sftp, childTarget, deadlineAt);
    assertActive();
    if (childExists) await mergeRemoteEntry(sftp, childSource, childTarget, assertActive, deadlineAt);
    else await renameRemote(sftp, childSource, childTarget, deadlineAt);
  }
  await rmdirRemote(sftp, sourcePath, deadlineAt);
};

/** Returns a Finder-style numbered sibling path that does not exist. */
const findAvailablePath = async (sftp: SFTPWrapper, desiredPath: string, deadlineAt?: number): Promise<string> => {
  if (!(await pathExists(sftp, desiredPath, deadlineAt))) return desiredPath;
  const directory = POSIX_PATH.dirname(desiredPath);
  const basename = POSIX_PATH.basename(desiredPath);
  for (let attempt = 2; attempt < 10_000; attempt += 1) {
    const candidate = POSIX_PATH.join(directory, `${basename} (${attempt})`);
    if (!(await pathExists(sftp, candidate, deadlineAt))) return candidate;
  }
  throw new SftpArchiveError(API_CODES.sftpArchiveOperationFailed, 'No available destination name could be found.');
};

/** Maps POSIX mode bits to the public conflict entry type. */
const entryType = (mode: number): ApiSftpArchiveConflict['type'] => {
  const type = mode & S_IFMT;
  return type === S_IFDIR ? 'directory' : type === S_IFREG ? 'file' : type === 0o120000 ? 'symlink' : 'other';
};

/** Builds a public conflict without exposing staging paths. */
const toConflict = (
  sourcePath: string,
  targetPath: string,
  type: ApiSftpArchiveConflict['type'],
): ApiSftpArchiveConflict => ({ path: POSIX_PATH.basename(sourcePath), targetPath, type });

/** Checks for the common ssh2 missing-file error shapes. */
const isNoSuchFileError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 2 ||
    candidate.code === 'ENOENT' ||
    (typeof candidate.message === 'string' && candidate.message.toLowerCase().includes('no such file'))
  );
};

/** Throws when an operation cannot safely start another remote step. */
const assertOperationActive = (record: ArchiveOperationRecord): void => {
  if (remainingDuration(record.deadlineAt) === 0) throw createArchiveTimeoutError();
  if (record.publicData.cancelRequested || record.session.isClosed) throw new SftpArchiveCancelledError();
};

/** Creates the stable error used by command, SFTP, conflict, and cleanup deadlines. */
const createArchiveTimeoutError = (): SftpArchiveError =>
  new SftpArchiveError(API_CODES.sftpArchiveTimeout, 'The archive operation timed out.');

/** Returns whether a failure represents the operation-wide archive deadline. */
const isArchiveTimeoutError = (error: unknown): boolean =>
  error instanceof SftpArchiveError && error.code === API_CODES.sftpArchiveTimeout;

/** Returns whether a public task state is terminal. */
const isTerminalState = (state: ApiSftpArchiveOperationData['state']): boolean =>
  state === 'succeeded' || state === 'failed' || state === 'cancelled';

/** Copies arrays so callers cannot mutate the internal job registry. */
const copyOperationData = (data: ApiSftpArchiveOperationData): ApiSftpArchiveOperationData => ({
  ...data,
  conflicts: data.conflicts?.map((conflict) => ({ ...conflict })),
  resultPaths: data.resultPaths ? [...data.resultPaths] : undefined,
});

/** Converts arbitrary failures into the stable archive error surface. */
const normalizeArchiveError = (error: unknown): SftpArchiveError =>
  error instanceof SftpArchiveError
    ? error
    : new SftpArchiveError(API_CODES.sftpArchiveOperationFailed, sanitizeRemoteError(error));

/** Removes control sequences and sensitive-sized output from errors. */
const sanitizeRemoteError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'The remote archive operation failed.';
  return sanitizeRemoteOutput(message) || 'The remote archive operation failed.';
};

/** Returns whether a user-controlled token contains ASCII control characters. */
const hasControlCharacters = (value: string): boolean => {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
};

/** Produces one bounded single-line diagnostic summary. */
const sanitizeRemoteOutput = (value: string): string =>
  [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || (codePoint >= 0x20 && codePoint !== 0x7f)
      );
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512);

/** Returns the non-negative duration remaining before an absolute deadline. */
const remainingDuration = (deadlineAt: number): number => Math.max(0, deadlineAt - Date.now());

/**
 * Starts one remote request only when time remains and rejects it at the shared operation deadline.
 *
 * @param start Creates the remote request promise.
 * @param deadlineAt Optional absolute deadline for archive operations.
 * @returns The remote result when it arrives before the deadline.
 */
const waitForPromiseBeforeDeadline = <T>(start: () => Promise<T>, deadlineAt?: number): Promise<T> => {
  if (deadlineAt === undefined) {
    try {
      return start();
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error('The remote request failed.'));
    }
  }
  const timeoutMs = remainingDuration(deadlineAt);
  if (timeoutMs === 0) return Promise.reject(createArchiveTimeoutError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const timeout = setTimeout(() => finish(() => reject(createArchiveTimeoutError())), timeoutMs);
    timeout.unref();
    try {
      void start().then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error: unknown) {
      finish(() => reject(error));
    }
  });
};

/** Waits for one promise only while the owning session-close deadline remains. */
const waitForPromiseUntil = async (promise: Promise<unknown>, deadlineAt: number): Promise<boolean> => {
  const timeoutMs = remainingDuration(deadlineAt);
  if (timeoutMs === 0) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (completed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(completed);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    void promise.then(
      () => finish(true),
      () => finish(true),
    );
  });
};

/** Polls a local predicate during bounded session shutdown. */
const waitUntil = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
};
