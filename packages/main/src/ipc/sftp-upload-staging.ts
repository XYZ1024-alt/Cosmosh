import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  SftpDroppedUploadLocalEntry,
  SftpUploadFileSelection,
  SftpUploadLocalFile,
  SftpUploadRejectedLocalEntry,
  SftpUploadRejectedLocalEntryReason,
} from '@cosmosh/api-contract';

const DROPPED_UPLOAD_ENTRY_FALLBACK_NAME = 'Dropped item';

/**
 * Dependencies needed to stage local files without coupling tests to Electron app state.
 */
export type SftpUploadStagingOptions = {
  createTemporaryFilePath: (fileName: string) => Promise<string>;
  stagedUploadPaths: Set<string>;
};

/**
 * Dependencies needed to clean staged upload files while preserving the temp-root boundary.
 */
export type SftpUploadCleanupOptions = {
  resolveTemporaryCandidatePath: (candidatePath: string | undefined) => string;
  stagedUploadPaths: Set<string>;
  temporaryRootPath: string;
  isPathInsideDirectory: (candidatePath: string, parentPath: string) => boolean;
};

/**
 * Error type used when a local entry is intentionally rejected before staging.
 */
export class SftpUploadStagingRejectionError extends Error {
  public readonly entry: SftpUploadRejectedLocalEntry;

  /**
   * Creates a rejected-entry error with user-display metadata.
   *
   * @param entry Dropped or selected entry that could not be staged.
   */
  public constructor(entry: SftpUploadRejectedLocalEntry) {
    super(resolveSftpUploadRejectionMessage(entry.reason));
    this.name = 'SftpUploadStagingRejectionError';
    this.entry = entry;
  }
}

/**
 * Converts a rejection reason into a concise error string for picker failures.
 *
 * @param reason Local-entry rejection reason.
 * @returns Error message for logs and picker exceptions.
 */
export const resolveSftpUploadRejectionMessage = (reason: SftpUploadRejectedLocalEntryReason): string => {
  if (reason === 'directory-unsupported') {
    return 'Directory upload is not supported yet.';
  }

  if (reason === 'not-file') {
    return 'Only regular files can be uploaded.';
  }

  if (reason === 'path-unavailable') {
    return 'Dropped file path is unavailable.';
  }

  return 'Unable to read local file.';
};

/**
 * Resolves the best display name for a dropped local entry.
 *
 * @param entry Preload-resolved dropped entry.
 * @returns Non-empty display name.
 */
const resolveDroppedEntryName = (entry: SftpDroppedUploadLocalEntry): string => {
  const explicitName = entry.name.trim();
  if (explicitName) {
    return explicitName;
  }

  const localPath = entry.localPath?.trim();
  return localPath
    ? path.basename(localPath) || DROPPED_UPLOAD_ENTRY_FALLBACK_NAME
    : DROPPED_UPLOAD_ENTRY_FALLBACK_NAME;
};

/**
 * Creates a rejected local-entry descriptor.
 *
 * @param name Display name for the local entry.
 * @param reason Why staging rejected the entry.
 * @returns Rejected-entry descriptor.
 */
const createRejectedEntry = (
  name: string,
  reason: SftpUploadRejectedLocalEntryReason,
): SftpUploadRejectedLocalEntry => ({
  name: name.trim() || DROPPED_UPLOAD_ENTRY_FALLBACK_NAME,
  reason,
});

/**
 * Normalizes the IPC payload sent by preload after it resolves dropped File objects.
 *
 * @param payload Unknown IPC payload.
 * @returns Safe dropped-entry descriptors.
 */
export const normalizeDroppedSftpUploadLocalEntries = (payload: unknown): SftpDroppedUploadLocalEntry[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    const localPath = typeof record.localPath === 'string' && record.localPath.trim() ? record.localPath : undefined;
    return [
      {
        name,
        ...(localPath ? { localPath } : {}),
      },
    ];
  });
};

/**
 * Copies one local regular file into the controlled SFTP temp root.
 *
 * @param sourcePath Local file path selected by main or resolved by preload.
 * @param options Staging dependencies.
 * @returns Staged upload descriptor safe to expose to the renderer.
 */
export const stageSftpUploadLocalFile = async (
  sourcePath: string,
  options: SftpUploadStagingOptions,
): Promise<SftpUploadLocalFile> => {
  const name = path.basename(sourcePath) || DROPPED_UPLOAD_ENTRY_FALLBACK_NAME;
  let sourceStats: Stats;

  try {
    sourceStats = await fs.stat(sourcePath);
  } catch {
    throw new SftpUploadStagingRejectionError(createRejectedEntry(name, 'unreadable'));
  }

  if (sourceStats.isDirectory()) {
    throw new SftpUploadStagingRejectionError(createRejectedEntry(name, 'directory-unsupported'));
  }

  if (!sourceStats.isFile()) {
    throw new SftpUploadStagingRejectionError(createRejectedEntry(name, 'not-file'));
  }

  const localPath = await options.createTemporaryFilePath(name);
  try {
    await fs.copyFile(sourcePath, localPath);
    const stagedStats = await fs.stat(localPath);
    options.stagedUploadPaths.add(path.resolve(localPath));
    return {
      name,
      localPath,
      size: stagedStats.size,
      modifiedAt: stagedStats.mtime.toISOString(),
    };
  } catch {
    await fs.rm(path.dirname(localPath), { force: true, recursive: true }).catch(() => undefined);
    throw new SftpUploadStagingRejectionError(createRejectedEntry(name, 'unreadable'));
  }
};

/**
 * Stages dropped local entries while preserving successful files when other entries are rejected.
 *
 * @param droppedEntries Preload-resolved local entries.
 * @param options Staging dependencies.
 * @returns Upload selection with staged files and rejected dropped entries.
 */
export const stageDroppedSftpUploadLocalEntries = async (
  droppedEntries: readonly SftpDroppedUploadLocalEntry[],
  options: SftpUploadStagingOptions,
): Promise<SftpUploadFileSelection> => {
  const files: SftpUploadLocalFile[] = [];
  const rejectedEntries: SftpUploadRejectedLocalEntry[] = [];

  for (const entry of droppedEntries) {
    const entryName = resolveDroppedEntryName(entry);
    if (!entry.localPath) {
      rejectedEntries.push(createRejectedEntry(entryName, 'path-unavailable'));
      continue;
    }

    try {
      files.push(await stageSftpUploadLocalFile(entry.localPath, options));
    } catch (error: unknown) {
      if (error instanceof SftpUploadStagingRejectionError) {
        rejectedEntries.push(error.entry);
      } else {
        rejectedEntries.push(createRejectedEntry(entryName, 'unreadable'));
      }
    }
  }

  return {
    canceled: false,
    files,
    ...(rejectedEntries.length > 0 ? { rejectedEntries } : {}),
  };
};

/**
 * Removes staged SFTP upload files without allowing deletion outside the temp root.
 *
 * @param localPaths Renderer-provided staged paths.
 * @param options Cleanup boundary and allowlist dependencies.
 * @returns Promise resolved after best-effort cleanup.
 */
export const cleanupStagedSftpUploadFiles = async (
  localPaths: readonly string[],
  options: SftpUploadCleanupOptions,
): Promise<void> => {
  const temporaryRootPath = path.resolve(options.temporaryRootPath);
  await Promise.all(
    localPaths.map(async (localPath) => {
      try {
        const normalizedPath = options.resolveTemporaryCandidatePath(localPath);
        if (!options.stagedUploadPaths.has(normalizedPath)) {
          return;
        }

        await fs.unlink(normalizedPath);
        options.stagedUploadPaths.delete(normalizedPath);
        const parentPath = path.dirname(normalizedPath);
        if (parentPath !== temporaryRootPath && options.isPathInsideDirectory(parentPath, temporaryRootPath)) {
          await fs.rmdir(parentPath).catch(() => undefined);
        }
      } catch {
        // Cleanup is intentionally best-effort and never expands the allowed temp-root boundary.
      }
    }),
  );
};
