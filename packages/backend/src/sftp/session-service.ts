import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, lstatSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { sortSftpEntriesByBrowserOrder } from '@cosmosh/api-contract';
import type { Prisma, PrismaClient } from '@prisma/client';
import { Client, type ConnectConfig, type SFTPWrapper, type Stats } from 'ssh2';

import type { AuditEventService } from '../audit/service.js';
import type { AuditEventInput } from '../audit/types.js';
import { createI18n, type I18nInstance, type Locale } from '../i18n-bridge.js';
import { buildSshCompressionAlgorithms } from '../ssh/compression.js';
import { decryptSensitiveValue } from '../ssh/crypto.js';
import { prepareSshProxyTransport, SshProxyConnectionError, type SshProxyMetadata } from '../ssh/proxy.js';

type GetDbClient = () => PrismaClient;

const SFTP_TEMP_ROOT_ENV_NAME = 'COSMOSH_SFTP_TEMP_ROOT';

type SshServerWithKeychain = Prisma.SshServerGetPayload<{
  include: {
    keychain: true;
  };
}>;

export type CreateSftpSessionInput = {
  locale: Locale;
  requestId?: string;
  serverId: string;
  initialPath?: string;
  connectTimeoutSec: number;
  strictHostKey?: boolean;
  systemProxyRules?: string;
};

export type SftpEntryType = 'directory' | 'file' | 'symlink' | 'other';

/**
 * Non-recursive metadata shared by SFTP directory lists and detail views.
 */
export type SftpEntry = {
  name: string;
  path: string;
  parentPath?: string;
  type: SftpEntryType;
  size: number;
  mode: number;
  permissions: string;
  permissionOctal: string;
  uid: number;
  gid: number;
  modifiedAt: string;
  accessedAt: string;
  extension: string;
  shellEscapedPath: string;
  isHidden: boolean;
  longname?: string;
  symlinkTarget?: SftpSymlinkTarget;
};

/**
 * Reachability state for a symbolic link target.
 */
export type SftpSymlinkTargetStatus = 'exists' | 'broken' | 'permission-denied' | 'unknown';

/**
 * Metadata resolved from readlink/stat for a symbolic link target.
 */
export type SftpSymlinkTarget = {
  status: SftpSymlinkTargetStatus;
  path?: string;
  resolvedPath?: string;
  isAbsolute?: boolean;
  type?: SftpEntryType;
  size?: number;
  mode?: number;
  permissions?: string;
  permissionOctal?: string;
  modifiedAt?: string;
  accessedAt?: string;
  message?: string;
};

/**
 * Per-entry status returned by the details endpoint.
 */
export type SftpEntryDetailsItemStatus = 'success' | 'failed';

/**
 * Detailed metadata result for one requested SFTP path.
 */
export type SftpEntryDetailsItem = {
  path: string;
  status: SftpEntryDetailsItemStatus;
  entry?: SftpEntry;
  message?: string;
};

/**
 * Batch operation modes supported by one SFTP API request.
 */
export type SftpBatchOperation = 'copy' | 'move' | 'delete' | 'link';

/**
 * Remote entry descriptor accepted by the SFTP batch operation endpoint.
 */
export type SftpBatchOperationEntry = {
  path: string;
  type: SftpEntryType;
};

/**
 * Per-entry execution status reported by SFTP batch operations.
 */
export type SftpBatchOperationItemStatus = 'success' | 'failed' | 'skipped';

/**
 * Per-entry execution result reported by SFTP batch operations.
 */
export type SftpBatchOperationItemResult = {
  path: string;
  type: SftpEntryType;
  targetPath?: string;
  status: SftpBatchOperationItemStatus;
  message?: string;
};

/**
 * Normalized batch operation input used by the SFTP session service.
 */
export type RunSftpBatchOperationInput = {
  operation: SftpBatchOperation;
  entries: SftpBatchOperationEntry[];
  targetDirectoryPath?: string;
};

export type CreateSftpSessionResult =
  | {
      type: 'success';
      sessionId: string;
      serverId: string;
      initialPath: string;
      currentPath: string;
    }
  | {
      type: 'not-found';
    }
  | {
      type: 'host-untrusted';
      serverId: string;
      host: string;
      port: number;
      algorithm: 'sha256';
      fingerprint: string;
    }
  | {
      type: 'failed';
      message: string;
    };

export type ListSftpDirectoryResult =
  | {
      type: 'success';
      sessionId: string;
      path: string;
      parentPath?: string;
      entries: SftpEntry[];
    }
  | {
      type: 'not-found';
    }
  | {
      type: 'failed';
      message: string;
    };

/**
 * Result envelope for fetching detailed metadata for selected SFTP entries.
 */
export type GetSftpEntryDetailsResult =
  | {
      type: 'success';
      sessionId: string;
      requestedCount: number;
      entries: SftpEntryDetailsItem[];
    }
  | {
      type: 'not-found';
    };

export type SftpOperationResult =
  | {
      type: 'success';
      sessionId: string;
      path: string;
      targetPath?: string;
      size?: number;
      modifiedAt?: string;
    }
  | {
      type: 'not-found';
    }
  | {
      type: 'failed';
      message: string;
      reason?: 'remote-conflict';
    };

export type SftpBatchOperationResult =
  | {
      type: 'success';
      sessionId: string;
      operation: SftpBatchOperation;
      totalCount: number;
      completedCount: number;
      failedCount: number;
      skippedCount: number;
      stoppedOnFailure: boolean;
      results: SftpBatchOperationItemResult[];
    }
  | {
      type: 'not-found';
    }
  | {
      type: 'failed';
      message: string;
    };

export type ReadSftpFileResult =
  | {
      type: 'success';
      sessionId: string;
      path: string;
      content: string;
      size: number;
      truncated: boolean;
    }
  | {
      type: 'not-found';
    }
  | {
      type: 'failed';
      message: string;
    };

export type DownloadSftpFileResult =
  | {
      type: 'success';
      sessionId: string;
      path: string;
      localPath: string;
      size: number;
    }
  | {
      type: 'not-found';
    }
  | {
      type: 'failed';
      message: string;
    };

export type UploadSftpFileConflictSnapshot = {
  size: number;
  modifiedAt: string;
};

export type UploadSftpFileResult = SftpOperationResult;

export type WriteSftpFileResult = SftpOperationResult;

export type UploadSftpFileOptions = {
  overwrite?: boolean;
};

type RemoteFileReplacementOptions = {
  expectedRemoteSnapshot?: UploadSftpFileConflictSnapshot;
};

/**
 * Error marker used when upload replacement discovers that the remote file changed.
 */
class SftpRemoteConflictError extends Error {
  /**
   * Creates a typed remote-conflict error for API mapping.
   *
   * @param message Localized conflict message.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'SftpRemoteConflictError';
  }
}

type OpenSftpResult =
  | {
      type: 'ready';
      client: Client;
      sftp: SFTPWrapper;
      proxyMetadata: SshProxyMetadata;
    }
  | {
      type: 'host-untrusted';
      fingerprint: string;
      message: string;
      proxyMetadata?: SshProxyMetadata;
    }
  | {
      type: 'failed';
      message: string;
      proxyMetadata?: SshProxyMetadata;
    };

type SftpLiveSession = {
  sessionId: string;
  serverId: string;
  client: Client;
  sftp: SFTPWrapper;
  isClosed: boolean;
  t: I18nInstance['t'];
};

type SftpDirectoryEntry = {
  filename: string;
  longname?: string;
  attrs: Stats;
};

type SftpReadlinkWrapper = SFTPWrapper & {
  readlink(targetPath: string, callback: (error: Error | undefined | null, linkString: string) => void): void;
};

type SftpSymlinkWrapper = SFTPWrapper & {
  symlink(targetPath: string, linkPath: string, callback: (error: Error | undefined | null) => void): void;
};

type SftpOpenSshExtensions = {
  ext_openssh_rename?(
    sourcePath: string,
    targetPath: string,
    callback: (error?: Error | null | undefined) => void,
  ): void;
};

const POSIX_PATH = path.posix;

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIRECTORY_MODE = 0o755;
const DEFAULT_READ_FILE_MAX_BYTES = 256 * 1024;
const MAX_READ_FILE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_WRITE_FILE_CONTENT_BYTES = MAX_READ_FILE_MAX_BYTES;

type SftpStatsWithExtendedAttributes = Stats & {
  readonly extended?: unknown;
};

const HIDDEN_EXTENDED_ATTRIBUTE_NAMES = new Set([
  'hidden',
  'ishidden',
  'filehidden',
  'systemhidden',
  'doshidden',
  'attributehidden',
  'attributeshidden',
  'comapplefinderinfohidden',
]);

/**
 * Checks whether an unknown value is a plain record.
 *
 * @param value Candidate value.
 * @returns Whether the value can be safely inspected as an object map.
 */
const isUnknownRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Normalizes an extended attribute key for defensive hidden-marker matching.
 *
 * @param key Raw server-provided extended attribute key.
 * @returns Lowercase key without separators or namespace punctuation.
 */
const normalizeSftpExtendedAttributeName = (key: string): string => {
  return key.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Parses a hidden marker payload returned through SFTP extended attributes.
 *
 * @param value Raw extended attribute value.
 * @returns Parsed boolean when the payload is recognizable.
 */
const parseSftpHiddenMarkerValue = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLocaleLowerCase();
    if (['1', 'true', 'yes', 'y', 'on', 'hidden'].includes(normalized)) {
      return true;
    }

    if (['', '0', 'false', 'no', 'n', 'off', 'visible'].includes(normalized)) {
      return false;
    }

    return null;
  }

  if (value instanceof Uint8Array) {
    if (value.length === 0) {
      return false;
    }

    const decoded = Buffer.from(value).toString('utf8').replace(/\0/g, '').trim();
    const decodedMarker = parseSftpHiddenMarkerValue(decoded);
    if (decodedMarker !== null) {
      return decodedMarker;
    }

    if (value.length === 1) {
      return value[0] !== 0;
    }
  }

  if (isUnknownRecord(value)) {
    for (const markerKey of ['hidden', 'isHidden', 'is_hidden']) {
      if (markerKey in value) {
        return parseSftpHiddenMarkerValue(value[markerKey]);
      }
    }
  }

  return null;
};

/**
 * Resolves whether an SFTP entry should be treated as hidden.
 *
 * @param name Entry basename returned by the server.
 * @param stats SFTP stats object returned by ssh2.
 * @returns Whether the entry is hidden by server metadata or dot-prefix convention.
 */
export const resolveSftpEntryHiddenState = (name: string, stats: Stats): boolean => {
  const trimmedName = name.trim();
  if (trimmedName.startsWith('.') && trimmedName !== '.' && trimmedName !== '..') {
    return true;
  }

  const extended = (stats as SftpStatsWithExtendedAttributes).extended;
  if (!isUnknownRecord(extended)) {
    return false;
  }

  for (const [rawKey, rawValue] of Object.entries(extended)) {
    const normalizedKey = normalizeSftpExtendedAttributeName(rawKey);
    if (!HIDDEN_EXTENDED_ATTRIBUTE_NAMES.has(normalizedKey) && !normalizedKey.endsWith('hidden')) {
      continue;
    }

    const markerValue = parseSftpHiddenMarkerValue(rawValue);
    if (markerValue !== null) {
      return markerValue;
    }
  }

  return false;
};

/**
 * Converts user-provided SFTP paths into POSIX-style paths used by remote SFTP servers.
 *
 * @param input Raw path input.
 * @returns Normalized POSIX path with root preserved.
 */
export const normalizeSftpPathInput = (input: string | undefined): string => {
  const trimmed = input?.trim();
  if (!trimmed || trimmed === '.') {
    return '.';
  }

  const slashNormalized = trimmed.replace(/\\/g, '/');
  const normalized = POSIX_PATH.normalize(slashNormalized);

  return normalized === '' ? '.' : normalized;
};

/**
 * Builds a child path without allowing platform-specific separators to leak into SFTP paths.
 *
 * @param parent Parent directory path.
 * @param name Entry name.
 * @returns Normalized child path.
 */
export const joinSftpPath = (parent: string, name: string): string => {
  if (parent === '/' || parent === '.') {
    return POSIX_PATH.normalize(`${parent === '/' ? '' : parent}/${name}`);
  }

  return POSIX_PATH.normalize(`${parent}/${name}`);
};

/**
 * Returns a sibling path with a Finder-like numeric suffix when the target already exists.
 *
 * @param targetPath Desired destination path.
 * @param attempt Numbered collision attempt.
 * @returns Collision-resistant target path candidate.
 */
export const buildSftpCopyTargetCandidate = (targetPath: string, attempt: number): string => {
  if (attempt <= 0) {
    return targetPath;
  }

  const directoryName = POSIX_PATH.dirname(targetPath);
  const baseName = POSIX_PATH.basename(targetPath);
  const extensionName = POSIX_PATH.extname(baseName);
  const stem = extensionName ? baseName.slice(0, -extensionName.length) : baseName;
  const candidateName = `${stem} copy${attempt > 1 ? ` ${attempt}` : ''}${extensionName}`;

  return directoryName === '.' ? candidateName : joinSftpPath(directoryName, candidateName);
};

/**
 * Checks whether a normalized path is safe for mutating entry-level operations.
 *
 * @param targetPath Normalized SFTP path.
 * @returns True when the path targets a concrete entry instead of the root/current marker.
 */
export const isMutableSftpEntryPath = (targetPath: string): boolean => {
  return targetPath !== '' && targetPath !== '.' && targetPath !== '/';
};

/**
 * Checks whether a local path stays inside the controlled SFTP temp root.
 *
 * @param candidatePath Absolute candidate path.
 * @param parentPath Absolute parent directory.
 * @returns Whether candidatePath is parentPath or one of its descendants.
 */
const isLocalPathInsideDirectory = (candidatePath: string, parentPath: string): boolean => {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === '' || (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
};

/**
 * Asserts that the Main-owned SFTP temp root is private on POSIX platforms.
 *
 * @param rootPath Candidate root path used for diagnostics.
 * @param mode File mode from lstat.
 * @returns void.
 */
const assertPrivateSftpTemporaryRootMode = (rootPath: string, mode: number): void => {
  if (process.platform === 'win32') {
    return;
  }

  if ((mode & 0o077) !== 0) {
    throw new Error(`SFTP temporary root is not private: ${rootPath}`);
  }
};

/**
 * Validates the Main-owned SFTP temp root passed into Backend.
 *
 * @param configuredPath Path supplied by Main through constructor options or process env.
 * @returns Canonical temp root path.
 */
const validateConfiguredSftpTemporaryRootPath = (configuredPath: string | undefined): string => {
  const rootPath = configuredPath?.trim();
  if (!rootPath) {
    throw new Error(
      `${SFTP_TEMP_ROOT_ENV_NAME} is required for backend startup. Electron Main creates and injects this ` +
        'private SFTP temp root automatically. When starting @cosmosh/backend directly, create a real existing ' +
        `private directory and set ${SFTP_TEMP_ROOT_ENV_NAME} to its absolute path; POSIX platforms require mode 0700.`,
    );
  }

  const normalizedRootPath = path.resolve(rootPath);
  const rootStats = lstatSync(normalizedRootPath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('SFTP temporary root must be a real directory.');
  }

  assertPrivateSftpTemporaryRootMode(normalizedRootPath, rootStats.mode);
  return realpathSync(normalizedRootPath);
};

/**
 * Maps ssh2 mode bits into the entry types shown by the SFTP browser.
 *
 * @param mode POSIX mode bits from ssh2 stats.
 * @returns SFTP entry type.
 */
export const resolveSftpEntryType = (mode: number): SftpEntryType => {
  const fileType = mode & S_IFMT;

  if (fileType === S_IFDIR) {
    return 'directory';
  }

  if (fileType === S_IFREG) {
    return 'file';
  }

  if (fileType === S_IFLNK) {
    return 'symlink';
  }

  return 'other';
};

/**
 * Formats POSIX mode bits into a compact permission string.
 *
 * @param mode POSIX mode bits from ssh2 stats.
 * @returns Symbolic permission string such as drwxr-xr-x.
 */
export const formatSftpPermissions = (mode: number): string => {
  const type = resolveSftpEntryType(mode);
  const prefix = type === 'directory' ? 'd' : type === 'symlink' ? 'l' : type === 'file' ? '-' : '?';
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  const symbols = ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x'];
  const permissions = bits.map((bit, index) => ((mode & bit) === bit ? symbols[index] : '-')).join('');

  return `${prefix}${permissions}`;
};

/**
 * Formats POSIX permission bits into the octal display used by chmod.
 *
 * @param mode POSIX mode bits from ssh2 stats.
 * @returns Four-digit octal permission string such as 0644.
 */
export const formatSftpPermissionOctal = (mode: number): string => {
  return (mode & 0o7777).toString(8).padStart(4, '0');
};

/**
 * Escapes a remote path for safe copy-paste into POSIX shells.
 *
 * @param targetPath Remote path.
 * @returns Single-quoted shell token.
 */
export const escapeSftpShellPath = (targetPath: string): string => {
  return `'${targetPath.replace(/'/g, "'\\''")}'`;
};

/**
 * Manages SFTP file-system sessions created for renderer tabs.
 */
export class SftpSessionService {
  private readonly getDbClient: GetDbClient;

  private readonly auditEventService: AuditEventService;

  private readonly credentialEncryptionKey: Buffer;

  private readonly sftpTemporaryRootPath: string;

  private readonly sessions = new Map<string, SftpLiveSession>();

  constructor(options: {
    getDbClient: GetDbClient;
    auditEventService: AuditEventService;
    credentialEncryptionKey: Buffer;
    sftpTemporaryRootPath?: string;
  }) {
    this.getDbClient = options.getDbClient;
    this.auditEventService = options.auditEventService;
    this.credentialEncryptionKey = options.credentialEncryptionKey;
    this.sftpTemporaryRootPath = validateConfiguredSftpTemporaryRootPath(
      options.sftpTemporaryRootPath ?? process.env[SFTP_TEMP_ROOT_ENV_NAME],
    );
  }

  /**
   * Opens one SSH connection and initializes the SFTP subsystem for directory browsing.
   *
   * @param input Session creation input from HTTP route.
   * @returns SFTP session creation result.
   */
  public async createSession(input: CreateSftpSessionInput): Promise<CreateSftpSessionResult> {
    const i18n = createI18n({ locale: input.locale, fallbackLocale: 'en' });
    const db = this.getDbClient();
    const initialPath = normalizeSftpPathInput(input.initialPath);
    const server = await db.sshServer.findUnique({
      where: {
        id: input.serverId,
      },
      include: {
        keychain: true,
      },
    });

    if (!server) {
      return { type: 'not-found' };
    }

    const trustedKeys = await db.sshKnownHost.findMany({
      where: {
        host: server.host,
        port: server.port,
        trusted: true,
        keyType: 'sha256',
      },
      select: {
        fingerprint: true,
      },
    });
    const trustedFingerprintSet = new Set(trustedKeys.map((item) => item.fingerprint));
    const strictHostKey = input.strictHostKey ?? server.strictHostKey;
    const enableSshCompression = server.enableSshCompression;
    const openResult = await this.openSftp(server, {
      connectTimeoutSec: input.connectTimeoutSec,
      strictHostKey,
      enableSshCompression,
      systemProxyRules: input.systemProxyRules,
      trustedFingerprintSet,
      t: i18n.t,
    });

    if (openResult.type === 'host-untrusted') {
      this.logSftpAuditEvent({
        category: 'sftp-session',
        action: 'connect',
        outcome: 'failure',
        severity: 'warning',
        entityType: 'ssh-server',
        entityId: server.id,
        requestId: input.requestId,
        metadata: {
          host: server.host,
          port: server.port,
          strictHostKey,
          enableSshCompression,
          fingerprint: openResult.fingerprint,
          reason: openResult.message || 'Host fingerprint is not trusted.',
          proxyMode: openResult.proxyMetadata?.mode,
          proxyProtocol: openResult.proxyMetadata?.protocol,
        },
      });

      return {
        type: 'host-untrusted',
        serverId: server.id,
        host: server.host,
        port: server.port,
        algorithm: 'sha256',
        fingerprint: openResult.fingerprint,
      };
    }

    if (openResult.type === 'failed') {
      this.logSftpAuditEvent({
        category: 'sftp-session',
        action: 'connect',
        outcome: 'failure',
        severity: 'warning',
        entityType: 'ssh-server',
        entityId: server.id,
        requestId: input.requestId,
        metadata: {
          host: server.host,
          port: server.port,
          strictHostKey,
          enableSshCompression,
          reason: openResult.message,
          proxyMode: openResult.proxyMetadata?.mode,
          proxyProtocol: openResult.proxyMetadata?.protocol,
        },
      });

      return {
        type: 'failed',
        message: openResult.message,
      };
    }

    const sessionId = randomUUID();
    const session: SftpLiveSession = {
      sessionId,
      serverId: server.id,
      client: openResult.client,
      sftp: openResult.sftp,
      isClosed: false,
      t: i18n.t,
    };

    this.sessions.set(sessionId, session);
    this.watchSessionTransport(session);

    const resolvedInitialPath = await this.resolveRealPath(session, initialPath);

    if (!resolvedInitialPath) {
      this.closeSession(sessionId);
      return {
        type: 'failed',
        message: i18n.t('errors.sftp.directoryListFailedNoReason'),
      };
    }

    this.logSftpAuditEvent({
      category: 'sftp-session',
      action: 'connect',
      outcome: 'success',
      severity: 'info',
      entityType: 'ssh-server',
      entityId: server.id,
      sessionId,
      requestId: input.requestId,
      metadata: {
        host: server.host,
        port: server.port,
        strictHostKey,
        enableSshCompression,
        initialPath: resolvedInitialPath,
        proxyMode: openResult.proxyMetadata.mode,
        proxyProtocol: openResult.proxyMetadata.protocol,
      },
    });

    return {
      type: 'success',
      sessionId,
      serverId: server.id,
      initialPath: resolvedInitialPath,
      currentPath: resolvedInitialPath,
    };
  }

  /**
   * Lists entries for one active SFTP session directory.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote directory path.
   * @returns Directory list result.
   */
  public async listDirectory(sessionId: string, requestedPath: string | undefined): Promise<ListSftpDirectoryResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    const resolvedPath = await this.resolveRealPath(session, normalizedPath);
    if (!resolvedPath) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.directoryListFailedNoReason'),
      };
    }

    try {
      const entries = await this.readdir(session, resolvedPath);
      const mappedEntries = await Promise.all(
        entries
          .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
          .map(async (entry) => {
            const entryPath = joinSftpPath(resolvedPath, entry.filename);
            const entryType = resolveSftpEntryType(entry.attrs.mode);
            const symlinkTarget =
              entryType === 'symlink' ? await this.resolveSymlinkTargetMetadata(session, entryPath) : undefined;

            return this.buildSftpEntry({
              name: entry.filename,
              path: entryPath,
              stats: entry.attrs,
              ...(entry.longname ? { longname: entry.longname } : {}),
              ...(symlinkTarget ? { symlinkTarget } : {}),
            });
          }),
      );

      return {
        type: 'success',
        sessionId,
        path: resolvedPath,
        parentPath: this.resolveParentPath(resolvedPath),
        entries: sortSftpEntriesByBrowserOrder(mappedEntries),
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.directoryListFailedNoReason')),
      };
    }
  }

  /**
   * Fetches non-recursive metadata for selected remote entries.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPaths Remote entry paths selected by the renderer.
   * @returns Per-path metadata results without recursive directory size calculation.
   */
  public async getEntryDetails(sessionId: string, requestedPaths: string[]): Promise<GetSftpEntryDetailsResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const entries: SftpEntryDetailsItem[] = [];
    for (const requestedPath of requestedPaths) {
      const normalizedPath = normalizeSftpPathInput(requestedPath);
      if (!isMutableSftpEntryPath(normalizedPath)) {
        entries.push({
          path: normalizedPath,
          status: 'failed',
          message: session.t('errors.sftp.pathRequired'),
        });
        continue;
      }

      entries.push(await this.getSingleEntryDetails(session, normalizedPath));
    }

    return {
      type: 'success',
      sessionId,
      requestedCount: requestedPaths.length,
      entries,
    };
  }

  /**
   * Reads one remote file into a bounded UTF-8 preview payload.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote file path.
   * @param requestedMaxBytes Maximum preview bytes requested by the caller.
   * @returns File preview result.
   */
  public async readFilePreview(
    sessionId: string,
    requestedPath: string | undefined,
    requestedMaxBytes?: number,
  ): Promise<ReadSftpFileResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    if (!isMutableSftpEntryPath(normalizedPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    try {
      const stats = await this.stat(session, normalizedPath);
      if (!stats.isFile()) {
        return {
          type: 'failed',
          message: session.t('errors.sftp.fileReadUnsupported'),
        };
      }

      const maxBytes = this.normalizeReadFileMaxBytes(requestedMaxBytes);
      const readLength = Math.min(stats.size, maxBytes);
      const buffer = Buffer.alloc(readLength);
      const handle = await this.open(session, normalizedPath, 'r');
      let bytesReadTotal = 0;

      try {
        if (readLength > 0) {
          bytesReadTotal = await this.readFullyIntoBuffer(session, handle, buffer, readLength);
        }
      } finally {
        await this.closeHandle(session, handle).catch(() => undefined);
      }

      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
        content: buffer.subarray(0, bytesReadTotal).toString('utf8'),
        size: stats.size,
        truncated: stats.size > maxBytes,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.fileReadFailedNoReason')),
      };
    }
  }

  /**
   * Writes UTF-8 text content back to one regular remote file.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote file path.
   * @param content UTF-8 text content to write.
   * @param expectedRemoteSnapshot Remote metadata captured when the preview was opened.
   * @param options Conflict override options.
   * @returns Write result with updated remote metadata.
   */
  public async writeTextFile(
    sessionId: string,
    requestedPath: string | undefined,
    content: string,
    expectedRemoteSnapshot: UploadSftpFileConflictSnapshot,
    options: UploadSftpFileOptions = {},
  ): Promise<WriteSftpFileResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    if (!isMutableSftpEntryPath(normalizedPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    const contentBuffer = Buffer.from(content, 'utf8');
    if (contentBuffer.byteLength > MAX_WRITE_FILE_CONTENT_BYTES) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.fileWriteTooLarge', {
          limit: MAX_WRITE_FILE_CONTENT_BYTES,
        }),
      };
    }

    try {
      const targetStats = await this.stat(session, normalizedPath);
      if (!targetStats.isFile()) {
        return {
          type: 'failed',
          message: session.t('errors.sftp.fileUploadUnsupported'),
        };
      }

      if (!options.overwrite && !this.doesRemoteSnapshotMatch(targetStats, expectedRemoteSnapshot)) {
        return {
          type: 'failed',
          message: session.t('errors.sftp.fileUploadRemoteChanged'),
          reason: 'remote-conflict',
        };
      }

      await this.writeBufferToRemotePath(session, contentBuffer, normalizedPath, targetStats.mode & 0o777, {
        expectedRemoteSnapshot: options.overwrite ? undefined : expectedRemoteSnapshot,
      });
      this.logSftpMutation(session, 'write-file', {
        path: normalizedPath,
      });

      const writtenStats = await this.stat(session, normalizedPath);
      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
        size: writtenStats.size,
        modifiedAt: this.formatStatsTimestamp(writtenStats.mtime),
      };
    } catch (error: unknown) {
      if (error instanceof SftpRemoteConflictError) {
        return {
          type: 'failed',
          message: error.message,
          reason: 'remote-conflict',
        };
      }

      return {
        type: 'failed',
        message: this.resolveUploadErrorMessage(error, session.t('errors.sftp.fileWriteFailedNoReason')),
      };
    }
  }

  /**
   * Downloads one regular remote file into a local workstation path.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote file path.
   * @param localPath Absolute local destination path selected by the main process.
   * @returns Download result with final local path and byte size.
   */
  public async downloadFile(
    sessionId: string,
    requestedPath: string | undefined,
    localPath: string | undefined,
  ): Promise<DownloadSftpFileResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    if (!isMutableSftpEntryPath(normalizedPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    const normalizedLocalPath = localPath?.trim();
    if (!normalizedLocalPath) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.localPathRequired'),
      };
    }

    try {
      const sourceStats = await this.stat(session, normalizedPath);
      if (!sourceStats.isFile()) {
        return {
          type: 'failed',
          message: session.t('errors.sftp.fileReadUnsupported'),
        };
      }

      await this.downloadFileToLocalPath(session, normalizedPath, normalizedLocalPath);

      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
        localPath: normalizedLocalPath,
        size: sourceStats.size,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.fileDownloadFailedNoReason')),
      };
    }
  }

  /**
   * Uploads one controlled local temp file to a new or existing remote path.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote file path.
   * @param localPath Absolute local temp path selected by the main process.
   * @param expectedRemoteSnapshot Optional metadata captured when an existing remote file was opened.
   * @returns Upload result.
   */
  public async uploadFile(
    sessionId: string,
    requestedPath: string | undefined,
    localPath: string | undefined,
    expectedRemoteSnapshot?: UploadSftpFileConflictSnapshot,
    options: UploadSftpFileOptions = {},
  ): Promise<UploadSftpFileResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    if (!isMutableSftpEntryPath(normalizedPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    const requestedLocalPath = localPath?.trim() ?? '';
    if (!requestedLocalPath) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.localPathRequired'),
      };
    }

    const normalizedLocalPath = path.resolve(requestedLocalPath);
    if (!isLocalPathInsideDirectory(normalizedLocalPath, this.sftpTemporaryRootPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.localFileReadUnsupported'),
      };
    }

    try {
      let targetStats: Stats | undefined;
      try {
        targetStats = await this.stat(session, normalizedPath);
      } catch (error: unknown) {
        if (!this.isNoSuchFileError(error)) {
          throw error;
        }
      }

      if (targetStats) {
        if (!targetStats.isFile()) {
          return {
            type: 'failed',
            message: session.t('errors.sftp.fileUploadUnsupported'),
          };
        }

        if (!options.overwrite) {
          if (!expectedRemoteSnapshot) {
            return {
              type: 'failed',
              message: session.t('errors.sftp.fileUploadTargetExists'),
              reason: 'remote-conflict',
            };
          }

          if (!this.doesRemoteSnapshotMatch(targetStats, expectedRemoteSnapshot)) {
            return {
              type: 'failed',
              message: session.t('errors.sftp.fileUploadRemoteChanged'),
              reason: 'remote-conflict',
            };
          }
        }
      } else if (expectedRemoteSnapshot && !options.overwrite) {
        return {
          type: 'failed',
          message: session.t('errors.sftp.fileUploadRemoteChanged'),
          reason: 'remote-conflict',
        };
      }

      const canonicalLocalPath = await this.resolveExistingUploadLocalPath(normalizedLocalPath);
      if (!canonicalLocalPath) {
        return {
          type: 'failed',
          message: session.t('errors.sftp.localFileReadUnsupported'),
        };
      }

      const localStats = await fs.lstat(canonicalLocalPath);
      if (!localStats.isFile() || localStats.isSymbolicLink()) {
        return {
          type: 'failed',
          message: session.t('errors.sftp.localFileReadUnsupported'),
        };
      }

      if (targetStats) {
        await this.uploadLocalFileToRemotePath(session, canonicalLocalPath, normalizedPath, targetStats.mode & 0o777, {
          expectedRemoteSnapshot: options.overwrite ? undefined : expectedRemoteSnapshot,
        });
      } else {
        await this.createRemoteFileFromLocalPath(session, canonicalLocalPath, normalizedPath, 0o644);
      }

      this.logSftpMutation(session, 'upload', {
        path: normalizedPath,
      });
      const uploadedStats = await this.stat(session, normalizedPath);

      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
        size: uploadedStats.size,
        modifiedAt: this.formatStatsTimestamp(uploadedStats.mtime),
      };
    } catch (error: unknown) {
      if (error instanceof SftpRemoteConflictError) {
        return {
          type: 'failed',
          message: error.message,
          reason: 'remote-conflict',
        };
      }

      return {
        type: 'failed',
        message: this.resolveUploadErrorMessage(error, session.t('errors.sftp.fileUploadFailedNoReason')),
      };
    }
  }

  /**
   * Creates one empty remote file.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote file path.
   * @returns File creation result.
   */
  public async createFile(sessionId: string, requestedPath: string | undefined): Promise<SftpOperationResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    if (!isMutableSftpEntryPath(normalizedPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    try {
      await this.writeFile(session, normalizedPath, Buffer.alloc(0), DEFAULT_FILE_MODE);
      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.fileCreateFailedNoReason')),
      };
    }
  }

  /**
   * Creates one remote directory.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote directory path.
   * @returns Directory creation result.
   */
  public async createDirectory(sessionId: string, requestedPath: string | undefined): Promise<SftpOperationResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    if (!isMutableSftpEntryPath(normalizedPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    try {
      await this.mkdir(session, normalizedPath, DEFAULT_DIRECTORY_MODE);
      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.directoryCreateFailedNoReason')),
      };
    }
  }

  /**
   * Renames or moves one remote entry.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedSourcePath Source path.
   * @param requestedTargetPath Target path.
   * @returns Rename result.
   */
  public async renameEntry(
    sessionId: string,
    requestedSourcePath: string | undefined,
    requestedTargetPath: string | undefined,
  ): Promise<SftpOperationResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const sourcePath = normalizeSftpPathInput(requestedSourcePath);
    const targetPath = normalizeSftpPathInput(requestedTargetPath);
    if (!isMutableSftpEntryPath(sourcePath) || !isMutableSftpEntryPath(targetPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    if (sourcePath === targetPath) {
      return {
        type: 'success',
        sessionId,
        path: sourcePath,
        targetPath,
      };
    }

    try {
      const sourceStats = await this.lstat(session, sourcePath);
      if (sourceStats.isDirectory() && this.isSameOrDescendantPath(sourcePath, targetPath)) {
        throw new Error(session.t('errors.sftp.moveIntoSelfUnsupported'));
      }

      await this.rename(session, sourcePath, targetPath);
      this.logSftpMutation(session, 'rename', {
        path: sourcePath,
        targetPath,
      });
      return {
        type: 'success',
        sessionId,
        path: sourcePath,
        targetPath,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.entryRenameFailedNoReason')),
      };
    }
  }

  /**
   * Copies one remote file or directory tree.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedSourcePath Source path.
   * @param requestedTargetPath Target path.
   * @returns Copy result.
   */
  public async copyEntry(
    sessionId: string,
    requestedSourcePath: string | undefined,
    requestedTargetPath: string | undefined,
  ): Promise<SftpOperationResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const sourcePath = normalizeSftpPathInput(requestedSourcePath);
    const targetPath = normalizeSftpPathInput(requestedTargetPath);
    if (!isMutableSftpEntryPath(sourcePath) || !isMutableSftpEntryPath(targetPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    try {
      const resolvedTargetPath = await this.resolveAvailableCopyPath(session, targetPath);
      if (this.isSameOrDescendantPath(sourcePath, resolvedTargetPath)) {
        throw new Error(session.t('errors.sftp.copyIntoSelfUnsupported'));
      }

      await this.copyEntryRecursive(session, sourcePath, resolvedTargetPath);
      this.logSftpMutation(session, 'copy', {
        path: sourcePath,
        targetPath: resolvedTargetPath,
      });

      return {
        type: 'success',
        sessionId,
        path: sourcePath,
        targetPath: resolvedTargetPath,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.entryCopyFailedNoReason')),
      };
    }
  }

  /**
   * Creates one absolute symbolic link to a remote file or directory.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedSourcePath Source path the link should point to.
   * @param requestedTargetPath Desired link path.
   * @returns Link result.
   */
  public async linkEntry(
    sessionId: string,
    requestedSourcePath: string | undefined,
    requestedTargetPath: string | undefined,
  ): Promise<SftpOperationResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const sourcePath = normalizeSftpPathInput(requestedSourcePath);
    const targetPath = normalizeSftpPathInput(requestedTargetPath);
    if (!isMutableSftpEntryPath(sourcePath) || !isMutableSftpEntryPath(targetPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    try {
      const resolvedTargetPath = await this.resolveAvailableCopyPath(session, targetPath);
      await this.symlink(session, sourcePath, resolvedTargetPath);
      this.logSftpMutation(session, 'link', {
        path: sourcePath,
        targetPath: resolvedTargetPath,
      });

      return {
        type: 'success',
        sessionId,
        path: sourcePath,
        targetPath: resolvedTargetPath,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.entryLinkFailedNoReason')),
      };
    }
  }

  /**
   * Deletes one remote file, symlink, or directory tree.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote entry path.
   * @param recursive Whether directories should be removed recursively.
   * @returns Delete result.
   */
  public async deleteEntry(
    sessionId: string,
    requestedPath: string | undefined,
    recursive: boolean,
  ): Promise<SftpOperationResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    const normalizedPath = normalizeSftpPathInput(requestedPath);
    if (!isMutableSftpEntryPath(normalizedPath)) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    try {
      await this.deleteEntryRecursive(session, normalizedPath, recursive);
      this.logSftpMutation(session, 'delete', {
        path: normalizedPath,
        recursive,
      });
      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.entryDeleteFailedNoReason')),
      };
    }
  }

  /**
   * Runs one ordered, fail-fast batch operation against one active SFTP session.
   *
   * @param sessionId Live SFTP session id.
   * @param input Normalized batch operation input from the HTTP route.
   * @returns Batch execution summary with per-entry status.
   */
  public async runBatchOperation(
    sessionId: string,
    input: RunSftpBatchOperationInput,
  ): Promise<SftpBatchOperationResult> {
    const session = this.getOpenSession(sessionId);
    if (!session) {
      return { type: 'not-found' };
    }

    if (input.entries.length === 0) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.batchEntriesRequired'),
      };
    }

    const targetDirectoryPath = input.targetDirectoryPath
      ? normalizeSftpPathInput(input.targetDirectoryPath)
      : undefined;
    if (
      (input.operation === 'copy' || input.operation === 'move' || input.operation === 'link') &&
      !targetDirectoryPath
    ) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.batchTargetRequired'),
      };
    }

    const entries = input.entries.map((entry) => ({
      path: normalizeSftpPathInput(entry.path),
      type: entry.type,
    }));

    if (entries.some((entry) => !isMutableSftpEntryPath(entry.path))) {
      return {
        type: 'failed',
        message: session.t('errors.sftp.pathRequired'),
      };
    }

    const results: SftpBatchOperationItemResult[] = [];
    let stoppedOnFailure = false;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const result = await this.runSingleBatchEntryOperation(sessionId, input.operation, entry, targetDirectoryPath);

      if (result.type === 'success') {
        const itemResult: SftpBatchOperationItemResult = {
          path: result.path,
          type: entry.type,
          status: 'success',
        };

        if (result.targetPath) {
          itemResult.targetPath = result.targetPath;
        }

        results.push(itemResult);
        continue;
      }

      const message = result.type === 'not-found' ? session.t('errors.sftp.sessionNotFound') : result.message;
      results.push({
        path: entry.path,
        type: entry.type,
        status: 'failed',
        message,
      });
      stoppedOnFailure = true;

      for (const skippedEntry of entries.slice(index + 1)) {
        results.push({
          path: skippedEntry.path,
          type: skippedEntry.type,
          status: 'skipped',
          message: session.t('errors.sftp.batchSkippedAfterFailure'),
        });
      }
      break;
    }

    const completedCount = results.filter((result) => result.status === 'success').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;
    const skippedCount = results.filter((result) => result.status === 'skipped').length;

    return {
      type: 'success',
      sessionId,
      operation: input.operation,
      totalCount: entries.length,
      completedCount,
      failedCount,
      skippedCount,
      stoppedOnFailure,
      results,
    };
  }

  /**
   * Closes one SFTP session and releases its SSH connection.
   *
   * @param sessionId Live SFTP session id.
   * @returns True when a session was found and closed.
   */
  public closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);
    session.isClosed = true;
    try {
      session.client.end();
    } catch (error: unknown) {
      console.warn('[sftp] Failed to close SSH client.', error);
    }

    return true;
  }

  /**
   * Returns the number of SFTP sessions that still own live SSH transports.
   *
   * @returns Active SFTP session count.
   */
  public getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Closes every active SFTP session without stopping the service.
   *
   * @returns Number of sessions closed by this call.
   */
  public closeAllSessions(): number {
    let closedCount = 0;

    for (const sessionId of [...this.sessions.keys()]) {
      if (this.closeSession(sessionId)) {
        closedCount += 1;
      }
    }

    return closedCount;
  }

  /**
   * Stops all active SFTP sessions during backend shutdown.
   *
   * @returns Promise resolved after best-effort cleanup.
   */
  public async stop(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
  }

  /**
   * Resolves an active session and evicts stale transport handles before work starts.
   *
   * @param sessionId Candidate live SFTP session id.
   * @returns Open session when it can still accept SFTP work.
   */
  private getOpenSession(sessionId: string): SftpLiveSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.isClosed) {
      if (session?.isClosed) {
        this.sessions.delete(sessionId);
      }

      return null;
    }

    return session;
  }

  /**
   * Removes a session as soon as the underlying SSH transport is no longer usable.
   *
   * @param session Live session whose transport should be watched.
   * @returns void.
   */
  private watchSessionTransport(session: SftpLiveSession): void {
    const markClosed = (): void => {
      if (session.isClosed) {
        return;
      }

      session.isClosed = true;
      if (this.sessions.get(session.sessionId) === session) {
        this.sessions.delete(session.sessionId);
      }
    };

    session.client.once('close', markClosed);
    session.client.once('end', markClosed);
    session.client.once('error', markClosed);
    session.sftp.once('close', markClosed);
    session.sftp.once('end', markClosed);
    session.sftp.once('error', markClosed);
  }

  private async resolveRealPath(session: SftpLiveSession, inputPath: string): Promise<string | null> {
    try {
      return await new Promise<string>((resolve, reject) => {
        session.sftp.realpath(inputPath, (error, resolvedPath) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(resolvedPath);
        });
      });
    } catch {
      return null;
    }
  }

  /**
   * Resolves one path into the common SFTP entry metadata contract.
   *
   * @param session Live SFTP session.
   * @param targetPath Normalized remote path.
   * @returns Per-path details item.
   */
  private async getSingleEntryDetails(session: SftpLiveSession, targetPath: string): Promise<SftpEntryDetailsItem> {
    try {
      const stats = await this.lstat(session, targetPath);
      const entryType = resolveSftpEntryType(stats.mode);
      const symlinkTarget =
        entryType === 'symlink' ? await this.resolveSymlinkTargetMetadata(session, targetPath) : undefined;

      return {
        path: targetPath,
        status: 'success',
        entry: this.buildSftpEntry({
          name: this.resolveEntryName(targetPath),
          path: targetPath,
          stats,
          ...(symlinkTarget ? { symlinkTarget } : {}),
        }),
      };
    } catch (error: unknown) {
      return {
        path: targetPath,
        status: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.operationFailedNoReason')),
      };
    }
  }

  /**
   * Builds the shared SFTP entry shape used by list and details APIs.
   *
   * @param input Raw stats and path information.
   * @returns API-ready SFTP entry metadata.
   */
  private buildSftpEntry(input: {
    name: string;
    path: string;
    stats: Stats;
    longname?: string;
    symlinkTarget?: SftpSymlinkTarget;
  }): SftpEntry {
    const type = resolveSftpEntryType(input.stats.mode);

    return {
      name: input.name,
      path: input.path,
      parentPath: this.resolveParentPath(input.path),
      type,
      size: input.stats.size,
      mode: input.stats.mode,
      permissions: formatSftpPermissions(input.stats.mode),
      permissionOctal: formatSftpPermissionOctal(input.stats.mode),
      uid: input.stats.uid,
      gid: input.stats.gid,
      modifiedAt: this.formatStatsTimestamp(input.stats.mtime),
      accessedAt: this.formatStatsTimestamp(input.stats.atime),
      extension: this.resolveEntryExtension(input.name, type),
      shellEscapedPath: escapeSftpShellPath(input.path),
      isHidden: resolveSftpEntryHiddenState(input.name, input.stats),
      ...(input.longname ? { longname: input.longname } : {}),
      ...(input.symlinkTarget ? { symlinkTarget: input.symlinkTarget } : {}),
    };
  }

  /**
   * Reads and stats a symbolic link target without failing the link metadata fetch.
   *
   * @param session Live SFTP session.
   * @param linkPath Normalized symbolic link path.
   * @returns Target metadata or broken/permission status.
   */
  private async resolveSymlinkTargetMetadata(session: SftpLiveSession, linkPath: string): Promise<SftpSymlinkTarget> {
    try {
      const targetPath = await this.readlink(session, linkPath);
      const resolvedPath = this.resolveSymlinkTargetPath(linkPath, targetPath);
      const baseTarget = {
        path: targetPath,
        resolvedPath,
        isAbsolute: targetPath.startsWith('/'),
      };

      try {
        const targetStats = await this.stat(session, resolvedPath);
        return {
          ...baseTarget,
          status: 'exists',
          type: resolveSftpEntryType(targetStats.mode),
          size: targetStats.size,
          mode: targetStats.mode,
          permissions: formatSftpPermissions(targetStats.mode),
          permissionOctal: formatSftpPermissionOctal(targetStats.mode),
          modifiedAt: this.formatStatsTimestamp(targetStats.mtime),
          accessedAt: this.formatStatsTimestamp(targetStats.atime),
        };
      } catch (error: unknown) {
        return {
          ...baseTarget,
          status: this.resolveSymlinkTargetStatus(error),
          message: this.resolveErrorMessage(error, session.t('errors.sftp.operationFailedNoReason')),
        };
      }
    } catch (error: unknown) {
      return {
        status: 'unknown',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.operationFailedNoReason')),
      };
    }
  }

  /**
   * Resolves a readlink target relative to the symlink parent when needed.
   *
   * @param linkPath Normalized symbolic link path.
   * @param targetPath Raw readlink target.
   * @returns Absolute or normalized relative target path.
   */
  private resolveSymlinkTargetPath(linkPath: string, targetPath: string): string {
    if (targetPath.startsWith('/')) {
      return normalizeSftpPathInput(targetPath);
    }

    return joinSftpPath(this.resolveParentPath(linkPath) ?? '.', targetPath);
  }

  /**
   * Formats stats timestamps defensively because some SFTP servers omit atime/mtime.
   *
   * @param seconds POSIX timestamp in seconds.
   * @returns ISO timestamp.
   */
  private formatStatsTimestamp(seconds: number): string {
    return new Date(seconds * 1000).toISOString();
  }

  /**
   * Compares the current remote metadata with the snapshot captured when the temp file was opened.
   *
   * @param stats Current remote file stats.
   * @param expectedSnapshot Renderer-provided opening snapshot.
   * @returns Whether the remote file still matches the opened version.
   */
  private doesRemoteSnapshotMatch(stats: Stats, expectedSnapshot: UploadSftpFileConflictSnapshot): boolean {
    const expectedModifiedSeconds = Math.trunc(Date.parse(expectedSnapshot.modifiedAt) / 1000);
    return stats.size === expectedSnapshot.size && stats.mtime === expectedModifiedSeconds;
  }

  /**
   * Resolves the display name for an entry path.
   *
   * @param targetPath Normalized remote path.
   * @returns Basename or root marker.
   */
  private resolveEntryName(targetPath: string): string {
    if (targetPath === '/') {
      return '/';
    }

    return POSIX_PATH.basename(targetPath) || targetPath;
  }

  /**
   * Extracts a file extension for list columns and sorting.
   *
   * @param name Entry basename.
   * @param type Entry type.
   * @returns Lowercase extension without the leading dot.
   */
  private resolveEntryExtension(name: string, type: SftpEntryType): string {
    if (type !== 'file' && type !== 'symlink') {
      return '';
    }

    const extension = POSIX_PATH.extname(name).replace(/^\./, '');
    return extension.toLowerCase();
  }

  private resolveParentPath(inputPath: string): string | undefined {
    if (!inputPath || inputPath === '/') {
      return undefined;
    }

    const parentPath = POSIX_PATH.dirname(inputPath);
    return parentPath === inputPath ? undefined : parentPath || '/';
  }

  private async readdir(session: SftpLiveSession, directoryPath: string): Promise<SftpDirectoryEntry[]> {
    return await new Promise((resolve, reject) => {
      session.sftp.readdir(directoryPath, (error, entries) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(entries);
      });
    });
  }

  private async readlink(session: SftpLiveSession, targetPath: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const sftp = session.sftp as SftpReadlinkWrapper;
      sftp.readlink(targetPath, (error, linkString) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(linkString);
      });
    });
  }

  /**
   * Creates one symbolic link through the active SFTP subsystem.
   *
   * @param session Live SFTP session.
   * @param targetPath Absolute remote path the new link should point to.
   * @param linkPath Remote path where the symlink should be created.
   * @returns Nothing.
   */
  private async symlink(session: SftpLiveSession, targetPath: string, linkPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sftp = session.sftp as SftpSymlinkWrapper;
      sftp.symlink(targetPath, linkPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async stat(session: SftpLiveSession, targetPath: string): Promise<Stats> {
    return await new Promise((resolve, reject) => {
      session.sftp.stat(targetPath, (error, stats) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stats);
      });
    });
  }

  private async lstat(session: SftpLiveSession, targetPath: string): Promise<Stats> {
    return await new Promise((resolve, reject) => {
      session.sftp.lstat(targetPath, (error, stats) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stats);
      });
    });
  }

  private async open(session: SftpLiveSession, targetPath: string, mode: 'r' | 'w'): Promise<Buffer> {
    return await new Promise((resolve, reject) => {
      session.sftp.open(targetPath, mode, (error, handle) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(handle);
      });
    });
  }

  private async closeHandle(session: SftpLiveSession, handle: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      session.sftp.close(handle, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  /**
   * Reads until the requested preview buffer is filled or the server reports EOF.
   *
   * @param session Live SFTP session.
   * @param handle Open remote file handle.
   * @param buffer Destination buffer.
   * @param length Maximum bytes to read.
   * @returns Number of bytes actually read.
   */
  private async readFullyIntoBuffer(
    session: SftpLiveSession,
    handle: Buffer,
    buffer: Buffer,
    length: number,
  ): Promise<number> {
    let bytesReadTotal = 0;
    while (bytesReadTotal < length) {
      const nextReadLength = length - bytesReadTotal;
      const bytesRead = await this.read(session, handle, buffer, bytesReadTotal, nextReadLength, bytesReadTotal);
      if (bytesRead <= 0) {
        break;
      }

      bytesReadTotal += bytesRead;
    }

    return bytesReadTotal;
  }

  /**
   * Reads one SFTP chunk at a specific file position.
   *
   * @param session Live SFTP session.
   * @param handle Open remote file handle.
   * @param buffer Destination buffer.
   * @param offset Destination buffer offset.
   * @param length Number of bytes to request.
   * @param position Remote file position.
   * @returns Number of bytes read by the server.
   */
  private async read(
    session: SftpLiveSession,
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<number> {
    return await new Promise((resolve, reject) => {
      session.sftp.read(handle, buffer, offset, length, position, (error, bytesRead) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(bytesRead);
      });
    });
  }

  private async writeFile(session: SftpLiveSession, targetPath: string, data: Buffer, mode: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      session.sftp.writeFile(targetPath, data, { mode, flag: 'wx' }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async mkdir(session: SftpLiveSession, targetPath: string, mode: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      session.sftp.mkdir(targetPath, { mode }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async unlink(session: SftpLiveSession, targetPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      session.sftp.unlink(targetPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async rmdir(session: SftpLiveSession, targetPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      session.sftp.rmdir(targetPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async rename(session: SftpLiveSession, sourcePath: string, targetPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      session.sftp.rename(sourcePath, targetPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  /**
   * Uses the OpenSSH atomic rename extension when the connected server exposes it.
   *
   * @param session Live SFTP session.
   * @param sourcePath Remote temp source path.
   * @param targetPath Remote target path.
   * @returns Whether the extension was available and completed successfully.
   */
  private async tryOpenSshPosixRename(
    session: SftpLiveSession,
    sourcePath: string,
    targetPath: string,
  ): Promise<boolean> {
    const posixRename = (session.sftp as SFTPWrapper & SftpOpenSshExtensions).ext_openssh_rename;
    if (!posixRename) {
      return false;
    }

    await new Promise<void>((resolve, reject) => {
      posixRename.call(session.sftp, sourcePath, targetPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return true;
  }

  /**
   * Rechecks the opened-file conflict guard immediately before non-atomic fallback replacement.
   *
   * @param session Live SFTP session.
   * @param targetPath Remote file path.
   * @param expectedRemoteSnapshot Remote metadata captured when the file was opened.
   * @returns Nothing.
   */
  private async assertRemoteSnapshotStillMatches(
    session: SftpLiveSession,
    targetPath: string,
    expectedRemoteSnapshot: UploadSftpFileConflictSnapshot,
  ): Promise<void> {
    const currentStats = await this.stat(session, targetPath);
    if (!currentStats.isFile() || !this.doesRemoteSnapshotMatch(currentStats, expectedRemoteSnapshot)) {
      throw new SftpRemoteConflictError(session.t('errors.sftp.fileUploadRemoteChanged'));
    }
  }

  /**
   * Replaces a remote regular file with an uploaded temp file across common SFTP server behaviors.
   *
   * @param session Live SFTP session.
   * @param temporaryPath Uploaded remote temp file path.
   * @param targetPath Remote target file path.
   * @param expectedRemoteSnapshot Remote metadata captured when the file was opened.
   * @returns Nothing.
   */
  private async replaceRemoteFileFromTemp(
    session: SftpLiveSession,
    temporaryPath: string,
    targetPath: string,
    options: RemoteFileReplacementOptions,
  ): Promise<void> {
    try {
      if (await this.tryOpenSshPosixRename(session, temporaryPath, targetPath)) {
        return;
      }
    } catch {
      // Fall through to portable replacement; not every server accepts the OpenSSH extension for all paths.
    }

    try {
      await this.rename(session, temporaryPath, targetPath);
      return;
    } catch (renameError: unknown) {
      if (!this.isGenericSftpFailureError(renameError)) {
        throw renameError;
      }

      if (options.expectedRemoteSnapshot) {
        await this.assertRemoteSnapshotStillMatches(session, targetPath, options.expectedRemoteSnapshot);
      }
      await this.unlink(session, targetPath);
      try {
        await this.rename(session, temporaryPath, targetPath);
      } catch (replaceError: unknown) {
        throw replaceError instanceof Error && replaceError.message.trim().length > 0 ? replaceError : renameError;
      }
    }
  }

  /**
   * Best-effort removes a remote temp file created during upload replacement.
   *
   * @param session Live SFTP session.
   * @param targetPath Remote temp path.
   * @returns Nothing.
   */
  private async unlinkRemoteTempFile(session: SftpLiveSession, targetPath: string): Promise<void> {
    await this.unlink(session, targetPath).catch(() => undefined);
  }

  private async pathExists(session: SftpLiveSession, targetPath: string): Promise<boolean> {
    try {
      await this.stat(session, targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeReadFileMaxBytes(requestedMaxBytes: number | undefined): number {
    if (!requestedMaxBytes || !Number.isFinite(requestedMaxBytes)) {
      return DEFAULT_READ_FILE_MAX_BYTES;
    }

    return Math.min(Math.max(Math.trunc(requestedMaxBytes), 1024), MAX_READ_FILE_MAX_BYTES);
  }

  private async resolveAvailableCopyPath(session: SftpLiveSession, targetPath: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidatePath = buildSftpCopyTargetCandidate(targetPath, attempt);
      if (!(await this.pathExists(session, candidatePath))) {
        return candidatePath;
      }
    }

    throw new Error(session.t('errors.sftp.copyTargetConflict'));
  }

  private async runSingleBatchEntryOperation(
    sessionId: string,
    operation: SftpBatchOperation,
    entry: SftpBatchOperationEntry,
    targetDirectoryPath: string | undefined,
  ): Promise<SftpOperationResult> {
    if (operation === 'delete') {
      return await this.deleteEntry(sessionId, entry.path, entry.type === 'directory');
    }

    const targetPath = joinSftpPath(targetDirectoryPath ?? '.', POSIX_PATH.basename(entry.path));
    if (operation === 'copy') {
      return await this.copyEntry(sessionId, entry.path, targetPath);
    }

    if (operation === 'link') {
      return await this.linkEntry(sessionId, entry.path, targetPath);
    }

    return await this.renameEntry(sessionId, entry.path, targetPath);
  }

  private async copyFile(
    session: SftpLiveSession,
    sourcePath: string,
    targetPath: string,
    sourceStats: Stats,
  ): Promise<void> {
    const readStream = session.sftp.createReadStream(sourcePath, { flags: 'r' });
    const writeStream = session.sftp.createWriteStream(targetPath, { flags: 'wx', mode: sourceStats.mode & 0o777 });
    await pipeline(readStream, writeStream);
  }

  /**
   * Resolves a renderer-supplied upload source into a canonical Main-owned temp file path.
   *
   * @param localPath Renderer-supplied local temp path.
   * @returns Canonical local file path, or null when validation fails.
   */
  private async resolveExistingUploadLocalPath(localPath: string): Promise<string | null> {
    const normalizedLocalPath = path.resolve(localPath);
    if (!isLocalPathInsideDirectory(normalizedLocalPath, this.sftpTemporaryRootPath)) {
      return null;
    }

    try {
      const localStats = await fs.lstat(normalizedLocalPath);
      if (!localStats.isFile() || localStats.isSymbolicLink()) {
        return null;
      }

      const canonicalLocalPath = await fs.realpath(normalizedLocalPath);
      if (!isLocalPathInsideDirectory(canonicalLocalPath, this.sftpTemporaryRootPath)) {
        return null;
      }

      return canonicalLocalPath;
    } catch {
      return null;
    }
  }

  /**
   * Streams one remote file to a temporary local file before replacing the final destination.
   *
   * @param session Live SFTP session.
   * @param sourcePath Remote file path.
   * @param localPath Final local destination path.
   * @returns Nothing.
   */
  private async downloadFileToLocalPath(
    session: SftpLiveSession,
    sourcePath: string,
    localPath: string,
  ): Promise<void> {
    const localDirectory = path.dirname(localPath);
    const temporaryPath = path.join(
      localDirectory,
      `.${path.basename(localPath)}.cosmosh-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );

    await fs.mkdir(localDirectory, { recursive: true });

    try {
      const readStream = session.sftp.createReadStream(sourcePath, { flags: 'r' });
      const shouldHardenTemporaryFile = isLocalPathInsideDirectory(path.resolve(localPath), this.sftpTemporaryRootPath);
      const writeStream = createWriteStream(temporaryPath, {
        flags: 'wx',
        ...(shouldHardenTemporaryFile ? { mode: 0o600 } : {}),
      });
      await pipeline(readStream, writeStream);
      await fs.rename(temporaryPath, localPath);
    } catch (error: unknown) {
      await fs.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Streams a local file into a remote temp file before replacing the target path atomically when possible.
   *
   * @param session Live SFTP session.
   * @param localPath Existing local file path.
   * @param targetPath Remote file path to replace.
   * @param mode Remote file permission bits to preserve.
   * @returns Nothing.
   */
  private async uploadLocalFileToRemotePath(
    session: SftpLiveSession,
    localPath: string,
    targetPath: string,
    mode: number,
    options: RemoteFileReplacementOptions,
  ): Promise<void> {
    const remoteDirectory = this.resolveParentPath(targetPath) ?? '.';
    const temporaryPath = joinSftpPath(
      remoteDirectory,
      `.${this.resolveEntryName(targetPath)}.cosmosh-${Date.now()}-${randomUUID()}.tmp`,
    );

    try {
      const readStream = createReadStream(localPath, { flags: 'r' });
      const writeStream = session.sftp.createWriteStream(temporaryPath, { flags: 'wx', mode });
      await pipeline(readStream, writeStream);
      await this.replaceRemoteFileFromTemp(session, temporaryPath, targetPath, options);
    } catch (error: unknown) {
      await this.unlinkRemoteTempFile(session, temporaryPath);
      throw error;
    }
  }

  /**
   * Streams a local file into a new remote path without replacing an existing entry.
   *
   * @param session Live SFTP session.
   * @param localPath Existing local file path.
   * @param targetPath New remote file path.
   * @param mode Initial remote permission bits.
   * @returns Nothing.
   */
  private async createRemoteFileFromLocalPath(
    session: SftpLiveSession,
    localPath: string,
    targetPath: string,
    mode: number,
  ): Promise<void> {
    let didOpenTarget = false;

    try {
      const readStream = createReadStream(localPath, { flags: 'r' });
      const writeStream = session.sftp.createWriteStream(targetPath, { flags: 'wx', mode });
      writeStream.once('open', () => {
        didOpenTarget = true;
      });
      await pipeline(readStream, writeStream);
    } catch (error: unknown) {
      if (this.isFileAlreadyExistsError(error)) {
        throw new SftpRemoteConflictError(session.t('errors.sftp.fileUploadTargetExists'));
      }

      if (didOpenTarget) {
        await this.unlinkRemoteTempFile(session, targetPath);
      }
      throw error;
    }
  }

  /**
   * Writes an in-memory buffer through a remote temp file before replacing the target.
   *
   * @param session Live SFTP session.
   * @param data File content.
   * @param targetPath Remote file path to replace.
   * @param mode Remote file permission bits to preserve.
   * @param options Remote replacement conflict options.
   * @returns Nothing.
   */
  private async writeBufferToRemotePath(
    session: SftpLiveSession,
    data: Buffer,
    targetPath: string,
    mode: number,
    options: RemoteFileReplacementOptions,
  ): Promise<void> {
    const remoteDirectory = this.resolveParentPath(targetPath) ?? '.';
    const temporaryPath = joinSftpPath(
      remoteDirectory,
      `.${this.resolveEntryName(targetPath)}.cosmosh-${Date.now()}-${randomUUID()}.tmp`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        session.sftp.writeFile(temporaryPath, data, { mode, flag: 'wx' }, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await this.replaceRemoteFileFromTemp(session, temporaryPath, targetPath, options);
    } catch (error: unknown) {
      await this.unlinkRemoteTempFile(session, temporaryPath);
      throw error;
    }
  }

  private async copyEntryRecursive(session: SftpLiveSession, sourcePath: string, targetPath: string): Promise<void> {
    const sourceStats = await this.lstat(session, sourcePath);
    if (sourceStats.isDirectory()) {
      await this.mkdir(session, targetPath, sourceStats.mode & 0o777);
      const children = await this.readdir(session, sourcePath);
      for (const child of children) {
        if (child.filename === '.' || child.filename === '..') {
          continue;
        }

        await this.copyEntryRecursive(
          session,
          joinSftpPath(sourcePath, child.filename),
          joinSftpPath(targetPath, child.filename),
        );
      }
      return;
    }

    if (sourceStats.isFile()) {
      await this.copyFile(session, sourcePath, targetPath, sourceStats);
      return;
    }

    throw new Error(session.t('errors.sftp.entryCopyUnsupported'));
  }

  private async deleteEntryRecursive(session: SftpLiveSession, targetPath: string, recursive: boolean): Promise<void> {
    const stats = await this.lstat(session, targetPath);
    if (!stats.isDirectory()) {
      await this.unlink(session, targetPath);
      return;
    }

    if (!recursive) {
      await this.rmdir(session, targetPath);
      return;
    }

    const entries = await this.readdir(session, targetPath);
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') {
        continue;
      }

      await this.deleteEntryRecursive(session, joinSftpPath(targetPath, entry.filename), true);
    }

    await this.rmdir(session, targetPath);
  }

  private isSameOrDescendantPath(sourcePath: string, targetPath: string): boolean {
    const normalizedSource = sourcePath.replace(/\/+$/, '');
    const normalizedTarget = targetPath.replace(/\/+$/, '');
    return normalizedTarget === normalizedSource || normalizedTarget.startsWith(`${normalizedSource}/`);
  }

  private logSftpAuditEvent(input: AuditEventInput): void {
    void this.auditEventService.logEvent(input);
  }

  private logSftpMutation(session: SftpLiveSession, action: string, metadata: Record<string, unknown>): void {
    this.logSftpAuditEvent({
      category: 'sftp-session',
      action,
      outcome: 'success',
      severity: 'info',
      entityType: 'ssh-server',
      entityId: session.serverId,
      sessionId: session.sessionId,
      metadata,
    });
  }

  /**
   * Classifies target stat failures into user-visible symlink states.
   *
   * @param error Raw ssh2/SFTP error.
   * @returns Symlink target status.
   */
  private resolveSymlinkTargetStatus(error: unknown): SftpSymlinkTargetStatus {
    if (this.isNoSuchFileError(error)) {
      return 'broken';
    }

    if (this.isPermissionDeniedError(error)) {
      return 'permission-denied';
    }

    return 'unknown';
  }

  /**
   * Detects missing-path failures from ssh2's numeric or string error codes.
   *
   * @param error Raw ssh2/SFTP error.
   * @returns True when the error indicates that the target does not exist.
   */
  private isNoSuchFileError(error: unknown): boolean {
    const code = this.readSftpErrorCode(error);
    if (code === 2 || code === 'ENOENT') {
      return true;
    }

    return this.readSftpErrorMessage(error).includes('no such file');
  }

  /**
   * Detects exclusive-create failures caused by a remote target already existing.
   *
   * @param error Raw ssh2/SFTP error.
   * @returns True when the target already exists.
   */
  private isFileAlreadyExistsError(error: unknown): boolean {
    const code = this.readSftpErrorCode(error);
    if (code === 11 || code === 'EEXIST') {
      return true;
    }

    const message = this.readSftpErrorMessage(error);
    return message.includes('already exists') || message.includes('file exists');
  }

  /**
   * Detects permission failures from ssh2's numeric or string error codes.
   *
   * @param error Raw ssh2/SFTP error.
   * @returns True when the error indicates missing target permissions.
   */
  private isPermissionDeniedError(error: unknown): boolean {
    const code = this.readSftpErrorCode(error);
    if (code === 3 || code === 'EACCES' || code === 'EPERM') {
      return true;
    }

    return this.readSftpErrorMessage(error).includes('permission denied');
  }

  /**
   * Reads common error code shapes without trusting third-party error objects.
   *
   * @param error Raw unknown error.
   * @returns Numeric or string code when present.
   */
  private readSftpErrorCode(error: unknown): string | number | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return undefined;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' || typeof code === 'number' ? code : undefined;
  }

  /**
   * Reads and normalizes an error message for classification.
   *
   * @param error Raw unknown error.
   * @returns Lowercase message or an empty string.
   */
  private readSftpErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message.toLowerCase();
    }

    if (!error || typeof error !== 'object' || !('message' in error)) {
      return '';
    }

    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message.toLowerCase() : '';
  }

  /**
   * Detects ssh2's unhelpful SSH_FX_FAILURE surface used by some servers for overwrite rename.
   *
   * @param error Unknown SFTP error.
   * @returns Whether the error is the generic SFTP failure signal.
   */
  private isGenericSftpFailureError(error: unknown): boolean {
    const message = this.readSftpErrorMessage(error).trim();
    if (message === 'failure') {
      return true;
    }

    if (!isUnknownRecord(error)) {
      return false;
    }

    return error.code === 4 || error.code === '4' || error.code === 'FAILURE';
  }

  /**
   * Resolves upload errors while hiding unhelpful generic SFTP failure text.
   *
   * @param error Unknown upload error.
   * @param fallback Localized fallback message.
   * @returns User-facing upload error.
   */
  private resolveUploadErrorMessage(error: unknown, fallback: string): string {
    if (this.isGenericSftpFailureError(error)) {
      return fallback;
    }

    return this.resolveErrorMessage(error, fallback);
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return fallback;
  }

  private async openSftp(
    server: SshServerWithKeychain,
    options: {
      connectTimeoutSec: number;
      strictHostKey: boolean;
      enableSshCompression: boolean;
      systemProxyRules?: string;
      trustedFingerprintSet: Set<string>;
      t: I18nInstance['t'];
    },
  ): Promise<OpenSftpResult> {
    const client = new Client();
    let presentedFingerprint = '';

    const connectConfig: ConnectConfig = {
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: options.connectTimeoutSec * 1000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      algorithms: {
        compress: buildSshCompressionAlgorithms(options.enableSshCompression),
      },
      hostHash: 'sha256',
      hostVerifier: (hashedKey: string) => {
        presentedFingerprint = hashedKey;
        return !options.strictHostKey || options.trustedFingerprintSet.has(hashedKey);
      },
    };

    try {
      if (server.keychain.authType === 'password' || server.keychain.authType === 'both') {
        if (!server.keychain.passwordEncrypted) {
          return {
            type: 'failed',
            message: options.t('errors.ssh.passwordNotConfigured'),
          };
        }

        connectConfig.password = decryptSensitiveValue(server.keychain.passwordEncrypted, this.credentialEncryptionKey);
      }

      if (server.keychain.authType === 'key' || server.keychain.authType === 'both') {
        if (!server.keychain.privateKeyEncrypted) {
          return {
            type: 'failed',
            message: options.t('errors.ssh.privateKeyNotConfigured'),
          };
        }

        connectConfig.privateKey = decryptSensitiveValue(
          server.keychain.privateKeyEncrypted,
          this.credentialEncryptionKey,
        );

        if (server.keychain.privateKeyPassphraseEncrypted) {
          connectConfig.passphrase = decryptSensitiveValue(
            server.keychain.privateKeyPassphraseEncrypted,
            this.credentialEncryptionKey,
          );
        }
      }
    } catch {
      return {
        type: 'failed',
        message: options.t('errors.ssh.decryptCredentialsFailed'),
      };
    }

    let proxyTransport;
    try {
      proxyTransport = await prepareSshProxyTransport(
        this.getDbClient(),
        server,
        options.systemProxyRules,
        options.connectTimeoutSec * 1000,
      );
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: error instanceof Error ? error.message : 'Proxy connection failed.',
        proxyMetadata: error instanceof SshProxyConnectionError ? error.metadata : undefined,
      };
    }

    connectConfig.readyTimeout = proxyTransport.readyTimeoutMs;
    if (proxyTransport.socket) {
      connectConfig.sock = proxyTransport.socket;
    }

    return await new Promise<OpenSftpResult>((resolve) => {
      let settled = false;

      const settle = (result: OpenSftpResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      client.once('ready', () => {
        client.sftp((error, sftp) => {
          if (error) {
            client.end();
            settle({
              type: 'failed',
              message: error.message,
            });
            return;
          }

          settle({
            type: 'ready',
            client,
            sftp,
            proxyMetadata: proxyTransport.metadata,
          });
        });
      });

      client.once('error', (error) => {
        client.end();

        if (options.strictHostKey && presentedFingerprint && !options.trustedFingerprintSet.has(presentedFingerprint)) {
          settle({
            type: 'host-untrusted',
            fingerprint: presentedFingerprint,
            message: error.message,
            proxyMetadata: proxyTransport.metadata,
          });
          return;
        }

        settle({
          type: 'failed',
          message: error.message,
          proxyMetadata: proxyTransport.metadata,
        });
      });

      client.connect(connectConfig);
    });
  }
}
