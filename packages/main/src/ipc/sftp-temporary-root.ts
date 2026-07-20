import fs from 'node:fs/promises';
import path from 'node:path';

const SFTP_TEMP_ROOT_PREFIX = 'cosmosh-sftp-';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/**
 * Environment variable used to pass the Main-owned SFTP temp root into Backend.
 */
export const SFTP_TEMP_ROOT_ENV_NAME = 'COSMOSH_SFTP_TEMP_ROOT';

/**
 * Checks whether a candidate path is inside the expected parent directory.
 *
 * @param candidatePath Absolute candidate path.
 * @param parentPath Absolute parent path.
 * @returns True when candidatePath is parentPath or a descendant.
 */
export const isPathInsideDirectory = (candidatePath: string, parentPath: string): boolean => {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === '' || (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
};

/**
 * Applies private file permissions on platforms where POSIX modes are meaningful.
 *
 * @param filePath File path to harden.
 * @returns Promise resolved after permissions are applied.
 */
export const applyPrivateSftpTemporaryFileMode = async (filePath: string): Promise<void> => {
  if (process.platform === 'win32') {
    return;
  }

  await fs.chmod(filePath, PRIVATE_FILE_MODE);
};

/**
 * Applies private directory permissions on platforms where POSIX modes are meaningful.
 *
 * @param directoryPath Directory path to harden.
 * @returns Promise resolved after permissions are applied.
 */
const applyPrivateSftpTemporaryDirectoryMode = async (directoryPath: string): Promise<void> => {
  if (process.platform === 'win32') {
    return;
  }

  await fs.chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
};

/**
 * Asserts that a directory is not readable, writable, or executable by group/other users.
 *
 * @param directoryPath Directory path used for diagnostics.
 * @param mode File mode from lstat.
 * @returns void.
 */
const assertPrivateDirectoryMode = (directoryPath: string, mode: number): void => {
  if (process.platform === 'win32') {
    return;
  }

  if ((mode & 0o077) !== 0) {
    throw new Error(`SFTP temporary root is not private: ${directoryPath}`);
  }
};

/**
 * Validates and canonicalizes an SFTP temporary root.
 *
 * @param rootPath Candidate temp root path.
 * @returns Canonical realpath for the temp root.
 */
export const validateSftpTemporaryRootPath = async (rootPath: string): Promise<string> => {
  const trimmedRootPath = rootPath.trim();
  if (!trimmedRootPath) {
    throw new Error('SFTP temporary root is required.');
  }

  const normalizedRootPath = path.resolve(trimmedRootPath);
  const stats = await fs.lstat(normalizedRootPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('SFTP temporary root must be a real directory.');
  }

  assertPrivateDirectoryMode(normalizedRootPath, stats.mode);
  return fs.realpath(normalizedRootPath);
};

/**
 * Creates a private per-run SFTP temp root under the app temp directory.
 *
 * @param parentTempPath Parent temp directory provided by Electron.
 * @returns Canonical realpath for the created temp root.
 */
export const createPrivateSftpTemporaryRoot = async (parentTempPath: string): Promise<string> => {
  const rootPath = await fs.mkdtemp(path.join(path.resolve(parentTempPath), SFTP_TEMP_ROOT_PREFIX));
  await applyPrivateSftpTemporaryDirectoryMode(rootPath);
  return validateSftpTemporaryRootPath(rootPath);
};

/**
 * Best-effort cleanup for the per-run SFTP temp root.
 *
 * @param rootPath Canonical temp root path.
 * @returns Promise resolved after cleanup is attempted.
 */
export const cleanupSftpTemporaryRoot = async (rootPath: string | null | undefined): Promise<void> => {
  if (!rootPath) {
    return;
  }

  await fs.rm(rootPath, { force: true, recursive: true });
};

/**
 * Resolves one existing regular file under the canonical SFTP temp root.
 *
 * @param rootPath Canonical SFTP temp root.
 * @param candidatePath Renderer-provided local path.
 * @returns Canonical existing file path.
 */
export const resolveExistingSftpTemporaryFilePath = async (
  rootPath: string,
  candidatePath: string | undefined,
): Promise<string> => {
  if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
    throw new Error('Invalid file path.');
  }

  const normalizedPath = path.resolve(candidatePath.trim());
  if (!isPathInsideDirectory(normalizedPath, rootPath)) {
    throw new Error('Invalid file path.');
  }

  const stats = await fs.lstat(normalizedPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Invalid file path.');
  }

  const canonicalPath = await fs.realpath(normalizedPath);
  if (!isPathInsideDirectory(canonicalPath, rootPath)) {
    throw new Error('Invalid file path.');
  }

  return canonicalPath;
};

/**
 * Resolves one existing staged file under the canonical SFTP temp root for cleanup.
 *
 * @param rootPath Canonical SFTP temp root.
 * @param candidatePath Renderer-provided local path.
 * @returns Canonical staged file path.
 */
export const resolveStagedSftpTemporaryFilePath = async (
  rootPath: string,
  candidatePath: string | undefined,
): Promise<string> => {
  return resolveExistingSftpTemporaryFilePath(rootPath, candidatePath);
};

/**
 * Creates a private subdirectory for one SFTP temp file.
 *
 * @param rootPath Canonical SFTP temp root.
 * @returns Canonical realpath for the new private directory.
 */
export const createPrivateSftpTemporaryDirectory = async (rootPath: string): Promise<string> => {
  const temporaryDirectoryPath = await fs.mkdtemp(path.join(rootPath, 'file-'));
  await applyPrivateSftpTemporaryDirectoryMode(temporaryDirectoryPath);
  const canonicalDirectoryPath = await fs.realpath(temporaryDirectoryPath);
  if (!isPathInsideDirectory(canonicalDirectoryPath, rootPath)) {
    throw new Error('Invalid SFTP temporary directory.');
  }

  return canonicalDirectoryPath;
};
