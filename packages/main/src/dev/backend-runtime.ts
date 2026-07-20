import fs from 'node:fs/promises';
import path from 'node:path';

/** Environment variable used only to hand the system Node executable from the dev wrapper to Main. */
export const DEVELOPMENT_NODE_EXECUTABLE_ENV_NAME = 'COSMOSH_DEV_NODE_EXEC_PATH';

/**
 * Resolves and validates one executable path before Main uses it as a child runtime.
 *
 * @param label Human-readable path source for error messages.
 * @param candidatePath Untrusted executable path.
 * @returns Canonical absolute path to a regular executable file.
 */
const resolveCanonicalExecutablePath = async (label: string, candidatePath: string | undefined): Promise<string> => {
  const normalizedCandidatePath = candidatePath?.trim();
  if (!normalizedCandidatePath) {
    throw new Error(`${label} is missing.`);
  }

  if (!path.isAbsolute(normalizedCandidatePath)) {
    throw new Error(`${label} must be an absolute path.`);
  }

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(normalizedCandidatePath);
  } catch (error: unknown) {
    throw new Error(`${label} does not resolve to an existing file.`, { cause: error });
  }

  const stats = await fs.stat(canonicalPath);
  if (!stats.isFile()) {
    throw new Error(`${label} must resolve to a regular file.`);
  }

  if (process.platform !== 'win32' && (stats.mode & 0o111) === 0) {
    throw new Error(`${label} must resolve to an executable file.`);
  }

  return canonicalPath;
};

/**
 * Normalizes a canonical path for platform-correct identity comparison.
 *
 * @param canonicalPath Canonical absolute path.
 * @returns Comparable path identity.
 */
const normalizeExecutableIdentity = (canonicalPath: string): string => {
  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
};

/**
 * Resolves the system Node executable used for the development backend.
 *
 * @param configuredExecutablePath Path provided by the system-Node development wrapper.
 * @param electronExecutablePath Current Electron host executable path.
 * @returns Canonical system Node executable path.
 */
export const resolveDevelopmentBackendNodeExecutable = async (
  configuredExecutablePath: string | undefined = process.env[DEVELOPMENT_NODE_EXECUTABLE_ENV_NAME],
  electronExecutablePath: string = process.execPath,
): Promise<string> => {
  const nodeExecutablePath = await resolveCanonicalExecutablePath(
    'Development backend Node.js executable',
    configuredExecutablePath,
  );
  const canonicalElectronExecutablePath = await resolveCanonicalExecutablePath(
    'Electron host executable',
    electronExecutablePath,
  );

  if (
    normalizeExecutableIdentity(nodeExecutablePath) === normalizeExecutableIdentity(canonicalElectronExecutablePath)
  ) {
    throw new Error('Development backend Node.js executable must differ from the Electron host executable.');
  }

  return nodeExecutablePath;
};
