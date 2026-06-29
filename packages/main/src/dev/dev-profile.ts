import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

type DevelopmentProfileNameSource = 'env' | 'state';

type DevelopmentProfileNameResolution = {
  name: string;
  source: DevelopmentProfileNameSource;
};

export type DevelopmentProfileRuntime = {
  name: string;
  rootDir: string;
  userDataPath: string;
  databasePath: string;
  backendStoragePath: string;
};

const LOCAL_COSMOSH_DIR_NAME = '.cosmosh';
const DATABASE_FILE_NAME = 'cosmosh.db';
const PROFILE_STATE_FILE_NAME = 'state.json';
const DEV_PROFILES_DIR_NAME = 'dev-profiles';
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const WINDOWS_RESERVED_PROFILE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Returns true when a value is a plain object-like record.
 *
 * @param value Unknown parsed JSON value.
 * @returns Whether the value can be read as a key/value record.
 */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Narrows unknown errors to Node errno-compatible errors.
 *
 * @param error Unknown thrown value.
 * @returns Whether an errno code is available.
 */
const isErrnoError = (error: unknown): error is NodeJS.ErrnoException => {
  return typeof error === 'object' && error !== null && typeof (error as NodeJS.ErrnoException).code === 'string';
};

/**
 * Resolves whether a profile name is safe to use as a direct directory name.
 *
 * @param profileName Candidate profile name from env or state.
 * @returns True when the name is supported.
 */
const isValidDevelopmentProfileName = (profileName: string): boolean => {
  if (!PROFILE_NAME_PATTERN.test(profileName)) {
    return false;
  }

  return !WINDOWS_RESERVED_PROFILE_NAMES.has(profileName.toUpperCase());
};

/**
 * Resolves the root directory that stores all development profile data.
 *
 * @param workspaceRoot Absolute workspace root.
 * @returns Absolute `.cosmosh/dev-profiles` path.
 */
const getDevelopmentProfilesRoot = (workspaceRoot: string): string => {
  return path.join(workspaceRoot, LOCAL_COSMOSH_DIR_NAME, DEV_PROFILES_DIR_NAME);
};

/**
 * Resolves the JSON file used by the development profile CLI.
 *
 * @param workspaceRoot Absolute workspace root.
 * @returns Absolute state file path.
 */
const getDevelopmentProfileStatePath = (workspaceRoot: string): string => {
  return path.join(workspaceRoot, LOCAL_COSMOSH_DIR_NAME, DEV_PROFILES_DIR_NAME, PROFILE_STATE_FILE_NAME);
};

/**
 * Reads the current profile pointer written by `pnpm dev:profile`.
 *
 * @param workspaceRoot Absolute workspace root.
 * @returns Current profile name or null when no profile is selected.
 */
const readCurrentDevelopmentProfileName = (workspaceRoot: string): string | null => {
  const statePath = getDevelopmentProfileStatePath(workspaceRoot);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as unknown;
  } catch (error) {
    if (isErrnoError(error) && error.code === 'ENOENT') {
      return null;
    }

    console.warn(`[dev:profile] Ignoring unreadable development profile state at ${statePath}.`, error);
    return null;
  }

  if (!isRecord(parsed)) {
    console.warn(`[dev:profile] Ignoring malformed development profile state at ${statePath}.`);
    return null;
  }

  const currentProfileName = parsed.currentProfileName;
  if (typeof currentProfileName !== 'string' || currentProfileName.trim().length === 0) {
    return null;
  }

  const normalizedProfileName = currentProfileName.trim();
  if (!isValidDevelopmentProfileName(normalizedProfileName)) {
    console.warn(`[dev:profile] Ignoring invalid development profile name "${normalizedProfileName}".`);
    return null;
  }

  return normalizedProfileName;
};

/**
 * Resolves the requested development profile name from env override or saved state.
 *
 * @param workspaceRoot Absolute workspace root.
 * @returns Profile name resolution or null when profile mode is inactive.
 */
const resolveDevelopmentProfileName = (workspaceRoot: string): DevelopmentProfileNameResolution | null => {
  const envProfileName = process.env.COSMOSH_DEV_PROFILE?.trim();
  if (envProfileName) {
    if (!isValidDevelopmentProfileName(envProfileName)) {
      throw new Error(
        `[dev:profile] Invalid COSMOSH_DEV_PROFILE value "${envProfileName}". Use letters, numbers, dot, dash, or underscore only.`,
      );
    }

    return {
      name: envProfileName,
      source: 'env',
    };
  }

  const stateProfileName = readCurrentDevelopmentProfileName(workspaceRoot);
  return stateProfileName
    ? {
        name: stateProfileName,
        source: 'state',
      }
    : null;
};

/**
 * Ensures a resolved child path stays under its parent root.
 *
 * @param parentRoot Absolute parent root.
 * @param childPath Candidate child path.
 * @returns Resolved child path when it is still inside parent root.
 */
const assertChildPath = (parentRoot: string, childPath: string): string => {
  const resolvedParentRoot = path.resolve(parentRoot);
  const resolvedChildPath = path.resolve(childPath);
  const relativePath = path.relative(resolvedParentRoot, resolvedChildPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`[dev:profile] Refusing to resolve development profile outside ${resolvedParentRoot}.`);
  }

  return resolvedChildPath;
};

/**
 * Builds all runtime paths owned by a development profile.
 *
 * @param workspaceRoot Absolute workspace root.
 * @param profileName Safe development profile name.
 * @returns Runtime path set used by Electron main and backend.
 */
const buildDevelopmentProfileRuntime = (workspaceRoot: string, profileName: string): DevelopmentProfileRuntime => {
  const profilesRoot = getDevelopmentProfilesRoot(workspaceRoot);
  const profileRoot = assertChildPath(profilesRoot, path.join(profilesRoot, profileName));

  return {
    name: profileName,
    rootDir: profileRoot,
    userDataPath: path.join(profileRoot, 'user-data'),
    databasePath: path.join(profileRoot, 'database', DATABASE_FILE_NAME),
    backendStoragePath: path.join(profileRoot, 'backend-storage'),
  };
};

/**
 * Resolves active development profile runtime paths, if profile mode is enabled.
 *
 * @param workspaceRoot Absolute workspace root.
 * @returns Development profile runtime paths or null when inactive.
 */
export const resolveDevelopmentProfileRuntime = (workspaceRoot: string): DevelopmentProfileRuntime | null => {
  const profileNameResolution = resolveDevelopmentProfileName(workspaceRoot);
  if (!profileNameResolution) {
    return null;
  }

  const profileRuntime = buildDevelopmentProfileRuntime(workspaceRoot, profileNameResolution.name);

  if (profileNameResolution.source === 'state' && !fs.existsSync(profileRuntime.rootDir)) {
    console.warn(`[dev:profile] Selected development profile "${profileRuntime.name}" does not exist. Ignoring it.`);
    return null;
  }

  return profileRuntime;
};

/**
 * Applies active development profile paths before Electron creates runtime storage.
 *
 * @param workspaceRoot Absolute workspace root.
 * @returns Applied development profile runtime or null when inactive.
 */
export const applyDevelopmentProfileToElectronApp = (workspaceRoot: string): DevelopmentProfileRuntime | null => {
  if (app.isPackaged) {
    return null;
  }

  const profileRuntime = resolveDevelopmentProfileRuntime(workspaceRoot);
  if (!profileRuntime) {
    return null;
  }

  fs.mkdirSync(profileRuntime.userDataPath, { recursive: true });
  fs.mkdirSync(path.dirname(profileRuntime.databasePath), { recursive: true });
  fs.mkdirSync(profileRuntime.backendStoragePath, { recursive: true });

  app.setPath('userData', profileRuntime.userDataPath);
  process.env.COSMOSH_DEV_PROFILE = profileRuntime.name;
  process.env.COSMOSH_DEV_PROFILE_ROOT = profileRuntime.rootDir;
  process.env.COSMOSH_DB_PATH = profileRuntime.databasePath;
  process.env.COSMOSH_BACKEND_STORAGE_PATH = profileRuntime.backendStoragePath;

  console.log(
    `[dev:profile] Active development profile "${profileRuntime.name}" -> userData=${profileRuntime.userDataPath}, db=${profileRuntime.databasePath}`,
  );

  return profileRuntime;
};
