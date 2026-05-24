import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { Prisma, PrismaClient } from '@prisma/client';
import { Client, type ConnectConfig, type SFTPWrapper, type Stats } from 'ssh2';

import type { AuditEventService } from '../audit/service.js';
import type { AuditEventInput } from '../audit/types.js';
import { createI18n, type I18nInstance, type Locale } from '../i18n-bridge.js';
import { decryptSensitiveValue } from '../ssh/crypto.js';

type GetDbClient = () => PrismaClient;

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
};

export type SftpEntryType = 'directory' | 'file' | 'symlink' | 'other';

export type SftpEntry = {
  name: string;
  path: string;
  type: SftpEntryType;
  size: number;
  mode: number;
  permissions: string;
  modifiedAt: string;
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

export type SftpOperationResult =
  | {
      type: 'success';
      sessionId: string;
      path: string;
      targetPath?: string;
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

type OpenSftpResult =
  | {
      type: 'ready';
      client: Client;
      sftp: SFTPWrapper;
    }
  | {
      type: 'host-untrusted';
      fingerprint: string;
      message: string;
    }
  | {
      type: 'failed';
      message: string;
    };

type SftpLiveSession = {
  sessionId: string;
  serverId: string;
  client: Client;
  sftp: SFTPWrapper;
  t: I18nInstance['t'];
};

const POSIX_PATH = path.posix;

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIRECTORY_MODE = 0o755;
const DEFAULT_READ_FILE_MAX_BYTES = 256 * 1024;
const MAX_READ_FILE_MAX_BYTES = 1024 * 1024;

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

const sortSftpEntries = (entries: SftpEntry[]): SftpEntry[] => {
  return [...entries].sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') {
      return -1;
    }

    if (left.type !== 'directory' && right.type === 'directory') {
      return 1;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
  });
};

/**
 * Manages SFTP file-system sessions created for renderer tabs.
 */
export class SftpSessionService {
  private readonly getDbClient: GetDbClient;

  private readonly auditEventService: AuditEventService;

  private readonly credentialEncryptionKey: Buffer;

  private readonly sessions = new Map<string, SftpLiveSession>();

  constructor(options: {
    getDbClient: GetDbClient;
    auditEventService: AuditEventService;
    credentialEncryptionKey: Buffer;
  }) {
    this.getDbClient = options.getDbClient;
    this.auditEventService = options.auditEventService;
    this.credentialEncryptionKey = options.credentialEncryptionKey;
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
    const openResult = await this.openSftp(server, {
      connectTimeoutSec: input.connectTimeoutSec,
      strictHostKey,
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
          fingerprint: openResult.fingerprint,
          reason: openResult.message || 'Host fingerprint is not trusted.',
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
          reason: openResult.message,
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
      t: i18n.t,
    };

    this.sessions.set(sessionId, session);

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
        initialPath: resolvedInitialPath,
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
    const session = this.sessions.get(sessionId);
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
      return {
        type: 'success',
        sessionId,
        path: resolvedPath,
        parentPath: this.resolveParentPath(resolvedPath),
        entries: sortSftpEntries(
          entries
            .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
            .map((entry) => {
              const entryPath = joinSftpPath(resolvedPath, entry.filename);
              return {
                name: entry.filename,
                path: entryPath,
                type: resolveSftpEntryType(entry.attrs.mode),
                size: entry.attrs.size,
                mode: entry.attrs.mode,
                permissions: formatSftpPermissions(entry.attrs.mode),
                modifiedAt: new Date(entry.attrs.mtime * 1000).toISOString(),
              };
            }),
        ),
      };
    } catch (error: unknown) {
      return {
        type: 'failed',
        message: this.resolveErrorMessage(error, session.t('errors.sftp.directoryListFailedNoReason')),
      };
    }
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
    const session = this.sessions.get(sessionId);
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

      try {
        if (readLength > 0) {
          await this.read(session, handle, buffer, readLength);
        }
      } finally {
        await this.closeHandle(session, handle).catch(() => undefined);
      }

      return {
        type: 'success',
        sessionId,
        path: normalizedPath,
        content: buffer.toString('utf8'),
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
   * Creates one empty remote file.
   *
   * @param sessionId Live SFTP session id.
   * @param requestedPath Remote file path.
   * @returns File creation result.
   */
  public async createFile(sessionId: string, requestedPath: string | undefined): Promise<SftpOperationResult> {
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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
    try {
      session.client.end();
    } catch (error: unknown) {
      console.warn('[sftp] Failed to close SSH client.', error);
    }

    return true;
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

  private resolveParentPath(inputPath: string): string | undefined {
    if (!inputPath || inputPath === '/') {
      return undefined;
    }

    const parentPath = POSIX_PATH.dirname(inputPath);
    return parentPath === inputPath ? undefined : parentPath || '/';
  }

  private async readdir(
    session: SftpLiveSession,
    directoryPath: string,
  ): Promise<Array<{ filename: string; attrs: Stats }>> {
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

  private async read(session: SftpLiveSession, handle: Buffer, buffer: Buffer, length: number): Promise<number> {
    return await new Promise((resolve, reject) => {
      session.sftp.read(handle, buffer, 0, length, 0, (error, bytesRead) => {
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
          });
          return;
        }

        settle({
          type: 'failed',
          message: error.message,
        });
      });

      client.connect(connectConfig);
    });
  }
}
