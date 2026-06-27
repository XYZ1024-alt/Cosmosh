#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_FILE_NAME = 'cosmosh.db';
const DEFAULT_PROFILE_NAME = 'default';
const LOCAL_COSMOSH_DIR_NAME = '.cosmosh';
const PROFILE_MANIFEST_FILE_NAME = 'profile.json';
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
 * Prints command usage for the development profile manager.
 *
 * @returns {void}
 */
const printHelp = () => {
  console.log(`Cosmosh development profile manager

Usage:
  pnpm dev:profile list
  pnpm dev:profile current
  pnpm dev:profile create <name> [--use]
  pnpm dev:profile import-default [--force] [--use]
  pnpm dev:profile use <name>
  pnpm dev:profile reset <name>
  pnpm dev:profile delete <name> [--force]
  pnpm dev:profile path <name>
  pnpm dev:profile run <name> [--create] [--reset] -- <command> [...args]

Examples:
  pnpm dev:profile list
  pnpm dev:profile use default
  pnpm dev:profile import-default --force --use
  pnpm dev:profile create fresh --use
  pnpm dev:profile run fresh --create --reset -- pnpm dev:main
  pnpm dev:profile delete fresh --force
`);
};

/**
 * Resolves the repository root from this script location.
 *
 * @returns {string} Absolute workspace root.
 */
const resolveWorkspaceRoot = () => {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
};

const workspaceRoot = resolveWorkspaceRoot();

/**
 * Resolves the development profile root directory.
 *
 * @returns {string} Absolute profile root directory.
 */
const resolveProfilesRoot = () => {
  const envProfilesRoot = process.env.COSMOSH_DEV_PROFILES_ROOT?.trim();
  if (envProfilesRoot) {
    return path.resolve(envProfilesRoot);
  }

  return path.join(workspaceRoot, LOCAL_COSMOSH_DIR_NAME, DEV_PROFILES_DIR_NAME);
};

const profilesRoot = resolveProfilesRoot();
const statePath = path.join(profilesRoot, PROFILE_STATE_FILE_NAME);

/**
 * Returns true when the error carries a Node errno code.
 *
 * @param {unknown} error Unknown thrown value.
 * @param {string} code Expected errno code.
 * @returns {boolean} Whether the error has the expected code.
 */
const hasErrorCode = (error, code) => {
  return typeof error === 'object' && error !== null && error.code === code;
};

/**
 * Fails the command with a user-facing message.
 *
 * @param {string} message Error message.
 * @returns {never} Never returns.
 */
const fail = (message) => {
  console.error(`[dev:profile] ${message}`);
  process.exit(1);
};

/**
 * Validates profile names before using them as direct directory names.
 *
 * @param {string} profileName Candidate profile name.
 * @returns {void}
 */
const validateProfileName = (profileName) => {
  if (
    typeof profileName !== 'string' ||
    !PROFILE_NAME_PATTERN.test(profileName) ||
    WINDOWS_RESERVED_PROFILE_NAMES.has(profileName.toUpperCase())
  ) {
    fail('Profile name must start with a letter or number and only contain letters, numbers, dot, dash, or underscore.');
  }
};

/**
 * Ensures a resolved child path stays under its intended root.
 *
 * @param {string} parentRoot Absolute parent directory.
 * @param {string} childPath Candidate child path.
 * @returns {string} Resolved child path.
 */
const assertChildPath = (parentRoot, childPath) => {
  const resolvedParentRoot = path.resolve(parentRoot);
  const resolvedChildPath = path.resolve(childPath);
  const relativePath = path.relative(resolvedParentRoot, resolvedChildPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    fail(`Refusing to access a path outside ${resolvedParentRoot}.`);
  }

  return resolvedChildPath;
};

/**
 * Reads package metadata as a best-effort JSON object.
 *
 * @param {string} packageJsonPath Package JSON path.
 * @returns {Record<string, unknown>} Parsed object or empty object.
 */
const readPackageJson = (packageJsonPath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Resolves the Electron app name used by legacy development userData.
 *
 * @returns {string} Product name used for app storage paths.
 */
const resolveElectronProductName = () => {
  const mainPackageJson = readPackageJson(path.join(workspaceRoot, 'packages', 'main', 'package.json'));
  const productName = mainPackageJson.productName;
  if (typeof productName === 'string' && productName.trim()) {
    return productName.trim();
  }

  return 'Cosmosh';
};

/**
 * Resolves the platform data root used by legacy backend secret storage.
 *
 * @returns {string} Absolute data root path.
 */
const resolveLegacyBackendDataRoot = () => {
  if (process.env.LOCALAPPDATA) {
    return process.env.LOCALAPPDATA;
  }

  if (process.env.XDG_DATA_HOME) {
    return process.env.XDG_DATA_HOME;
  }

  return path.join(os.homedir(), '.local', 'share');
};

/**
 * Resolves the platform appData root used by Electron for legacy userData.
 *
 * @returns {string} Absolute appData root path.
 */
const resolveLegacyElectronAppDataRoot = () => {
  if (process.env.APPDATA) {
    return process.env.APPDATA;
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }

  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }

  return path.join(os.homedir(), '.config');
};

/**
 * Resolves source paths for the implicit legacy default development identity.
 *
 * @returns {{databasePath: string, userDataPath: string, backendStoragePath: string}} Legacy path set.
 */
const resolveLegacyDefaultPaths = () => {
  const appName = resolveElectronProductName();

  return {
    databasePath:
      process.env.COSMOSH_LEGACY_DB_PATH?.trim() || path.join(workspaceRoot, '.dev_data', DATABASE_FILE_NAME),
    userDataPath:
      process.env.COSMOSH_LEGACY_USER_DATA_PATH?.trim() || path.join(resolveLegacyElectronAppDataRoot(), appName),
    backendStoragePath:
      process.env.COSMOSH_LEGACY_BACKEND_STORAGE_PATH?.trim() ||
      path.join(resolveLegacyBackendDataRoot(), appName, 'backend', 'storage'),
  };
};

/**
 * Builds all filesystem paths owned by a development profile.
 *
 * @param {string} profileName Safe profile name.
 * @returns {{name: string, rootDir: string, userDataPath: string, databasePath: string, backendStoragePath: string, manifestPath: string}} Profile paths.
 */
const buildProfilePaths = (profileName) => {
  validateProfileName(profileName);
  const rootDir = assertChildPath(profilesRoot, path.join(profilesRoot, profileName));

  return {
    name: profileName,
    rootDir,
    userDataPath: path.join(rootDir, 'user-data'),
    databasePath: path.join(rootDir, 'database', DATABASE_FILE_NAME),
    backendStoragePath: path.join(rootDir, 'backend-storage'),
    manifestPath: path.join(rootDir, PROFILE_MANIFEST_FILE_NAME),
  };
};

/**
 * Reads the persisted development profile state.
 *
 * @returns {{currentProfileName: string | null}} Persisted state.
 */
const readState = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      currentProfileName: typeof parsed.currentProfileName === 'string' ? parsed.currentProfileName : null,
    };
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { currentProfileName: null };
    }

    fail(`Failed to read ${statePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * Writes the persisted development profile state.
 *
 * @param {{currentProfileName: string | null}} state State to write.
 * @returns {void}
 */
const writeState = (state) => {
  fs.mkdirSync(profilesRoot, { recursive: true });
  fs.writeFileSync(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(`${statePath}.tmp`, statePath);
};

/**
 * Returns true when a path exists.
 *
 * @param {string} targetPath Path to check.
 * @returns {boolean} Whether the path exists.
 */
const pathExists = (targetPath) => {
  return fs.existsSync(targetPath);
};

/**
 * Reads a profile manifest when present.
 *
 * @param {ReturnType<typeof buildProfilePaths>} profilePaths Profile paths.
 * @returns {Record<string, unknown> | null} Parsed manifest or null.
 */
const readProfileManifest = (profilePaths) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(profilePaths.manifestPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Writes a profile manifest atomically enough for local developer tooling.
 *
 * @param {ReturnType<typeof buildProfilePaths>} profilePaths Profile paths.
 * @param {Record<string, unknown>} manifest Manifest payload.
 * @returns {void}
 */
const writeProfileManifest = (profilePaths, manifest) => {
  fs.mkdirSync(profilePaths.rootDir, { recursive: true });
  fs.writeFileSync(`${profilePaths.manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(`${profilePaths.manifestPath}.tmp`, profilePaths.manifestPath);
};

/**
 * Creates the profile-owned directory structure.
 *
 * @param {ReturnType<typeof buildProfilePaths>} profilePaths Profile paths.
 * @returns {void}
 */
const ensureProfileDirectories = (profilePaths) => {
  fs.mkdirSync(profilePaths.userDataPath, { recursive: true });
  fs.mkdirSync(path.dirname(profilePaths.databasePath), { recursive: true });
  fs.mkdirSync(profilePaths.backendStoragePath, { recursive: true });
};

/**
 * Removes profile-owned runtime artifacts while keeping the profile entry.
 *
 * @param {ReturnType<typeof buildProfilePaths>} profilePaths Profile paths.
 * @returns {void}
 */
const resetProfile = (profilePaths) => {
  fs.rmSync(profilePaths.userDataPath, { recursive: true, force: true });
  fs.rmSync(path.dirname(profilePaths.databasePath), { recursive: true, force: true });
  fs.rmSync(profilePaths.backendStoragePath, { recursive: true, force: true });
  ensureProfileDirectories(profilePaths);
};

/**
 * Records a copy result for a missing source path.
 *
 * @param {string} label Human-readable source label.
 * @param {string} sourcePath Source path.
 * @param {string} targetPath Target path.
 * @returns {{label: string, sourcePath: string, targetPath: string, status: string}} Copy result.
 */
const missingCopyResult = (label, sourcePath, targetPath) => {
  return { label, sourcePath, targetPath, status: 'missing' };
};

/**
 * Copies a file when present and records the outcome.
 *
 * @param {string} label Human-readable source label.
 * @param {string} sourcePath Source file path.
 * @param {string} targetPath Target file path.
 * @returns {{label: string, sourcePath: string, targetPath: string, status: string, message?: string}} Copy result.
 */
const copyFileIfPresent = (label, sourcePath, targetPath) => {
  try {
    if (!pathExists(sourcePath)) {
      return missingCopyResult(label, sourcePath, targetPath);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    return { label, sourcePath, targetPath, status: 'copied' };
  } catch (error) {
    return {
      label,
      sourcePath,
      targetPath,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Copies directory contents when present and records the outcome.
 *
 * @param {string} label Human-readable source label.
 * @param {string} sourcePath Source directory path.
 * @param {string} targetPath Target directory path.
 * @returns {{label: string, sourcePath: string, targetPath: string, status: string, message?: string}} Copy result.
 */
const copyDirectoryContentsIfPresent = (label, sourcePath, targetPath) => {
  try {
    if (!pathExists(sourcePath)) {
      return missingCopyResult(label, sourcePath, targetPath);
    }

    const sourceStats = fs.statSync(sourcePath);
    if (!sourceStats.isDirectory()) {
      return { label, sourcePath, targetPath, status: 'failed', message: 'Source is not a directory.' };
    }

    fs.mkdirSync(targetPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      fs.cpSync(path.join(sourcePath, entry), path.join(targetPath, entry), { recursive: true, force: true });
    }

    return { label, sourcePath, targetPath, status: 'copied' };
  } catch (error) {
    return {
      label,
      sourcePath,
      targetPath,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Imports the legacy implicit default development identity into a managed profile.
 *
 * @param {{force?: boolean, use?: boolean, automatic?: boolean}} options Import options.
 * @returns {{created: boolean, copyResults: Array<Record<string, unknown>>}} Import result.
 */
const importDefaultProfile = (options = {}) => {
  const profilePaths = buildProfilePaths(DEFAULT_PROFILE_NAME);
  const force = options.force === true;
  const use = options.use === true;
  const automatic = options.automatic === true;

  if (pathExists(profilePaths.rootDir) && !force) {
    if (use) {
      writeState({ currentProfileName: DEFAULT_PROFILE_NAME });
    }

    if (!automatic) {
      console.log(`Profile "${DEFAULT_PROFILE_NAME}" already exists.`);
    }

    return { created: false, copyResults: [] };
  }

  if (force) {
    fs.rmSync(profilePaths.rootDir, { recursive: true, force: true });
  }

  ensureProfileDirectories(profilePaths);

  const legacyPaths = resolveLegacyDefaultPaths();
  const copyResults = [
    copyFileIfPresent('legacy database', legacyPaths.databasePath, profilePaths.databasePath),
    copyFileIfPresent('legacy database WAL', `${legacyPaths.databasePath}-wal`, `${profilePaths.databasePath}-wal`),
    copyFileIfPresent('legacy database SHM', `${legacyPaths.databasePath}-shm`, `${profilePaths.databasePath}-shm`),
    copyDirectoryContentsIfPresent('legacy Electron userData', legacyPaths.userDataPath, profilePaths.userDataPath),
    copyDirectoryContentsIfPresent(
      'legacy backend secret storage',
      legacyPaths.backendStoragePath,
      profilePaths.backendStoragePath,
    ),
  ];

  writeProfileManifest(profilePaths, {
    name: DEFAULT_PROFILE_NAME,
    kind: 'imported-default',
    importedAt: new Date().toISOString(),
    sourcePaths: legacyPaths,
    copyResults,
  });

  if (use) {
    writeState({ currentProfileName: DEFAULT_PROFILE_NAME });
  }

  const failureResults = copyResults.filter((result) => result.status === 'failed');
  const copiedCount = copyResults.filter((result) => result.status === 'copied').length;
  if (!automatic) {
    console.log(`Imported legacy default identity as profile "${DEFAULT_PROFILE_NAME}" (${copiedCount} source(s) copied).`);
  } else {
    console.log(`[dev:profile] Imported legacy default identity as profile "${DEFAULT_PROFILE_NAME}".`);
  }

  if (failureResults.length > 0) {
    console.warn(
      `[dev:profile] Default import completed with ${failureResults.length} failed source(s). Run "pnpm dev:profile import-default --force" after fixing access to retry.`,
    );
  }

  return { created: true, copyResults };
};

/**
 * Ensures the legacy default identity is visible as a managed profile.
 *
 * @returns {void}
 */
const ensureDefaultProfileImported = () => {
  const defaultProfilePaths = buildProfilePaths(DEFAULT_PROFILE_NAME);
  if (pathExists(defaultProfilePaths.rootDir)) {
    return;
  }

  importDefaultProfile({ automatic: true });
};

/**
 * Formats import status from a default profile manifest.
 *
 * @param {ReturnType<typeof buildProfilePaths>} profilePaths Profile paths.
 * @returns {string} Import status suffix.
 */
const formatImportStatus = (profilePaths) => {
  const manifest = readProfileManifest(profilePaths);
  if (!manifest || manifest.kind !== 'imported-default' || !Array.isArray(manifest.copyResults)) {
    return '';
  }

  const failedCount = manifest.copyResults.filter((result) => result?.status === 'failed').length;
  return failedCount > 0 ? ', import=partial' : ', import=ok';
};

/**
 * Formats whether a profile currently owns runtime data.
 *
 * @param {ReturnType<typeof buildProfilePaths>} profilePaths Profile paths.
 * @returns {string} Compact profile status.
 */
const formatProfileStatus = (profilePaths) => {
  const hasDatabase = pathExists(profilePaths.databasePath);
  const hasUserData = pathExists(profilePaths.userDataPath);
  return `db=${hasDatabase ? 'yes' : 'no'}, userData=${hasUserData ? 'yes' : 'no'}${formatImportStatus(profilePaths)}`;
};

/**
 * Lists profile directory names sorted for stable CLI output.
 *
 * @returns {string[]} Profile names.
 */
const listProfiles = () => {
  try {
    return fs
      .readdirSync(profilesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && PROFILE_NAME_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }

    fail(`Failed to list profiles: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * Creates a profile and optionally makes it current.
 *
 * @param {string[]} args Command arguments.
 * @returns {void}
 */
const createProfile = (args) => {
  const profileName = args[0];
  if (!profileName) {
    fail('Missing profile name.');
  }

  if (profileName === DEFAULT_PROFILE_NAME) {
    fail('Profile "default" is managed automatically. Use "pnpm dev:profile import-default --force" to rebuild it.');
  }

  const profilePaths = buildProfilePaths(profileName);
  if (pathExists(profilePaths.rootDir)) {
    fail(`Profile "${profileName}" already exists.`);
  }

  ensureProfileDirectories(profilePaths);
  if (args.includes('--use')) {
    writeState({ currentProfileName: profileName });
  }

  console.log(`Created profile "${profileName}".`);
  if (args.includes('--use')) {
    console.log(`Current profile is now "${profileName}".`);
  }
};

/**
 * Selects an existing profile as the default development identity.
 *
 * @param {string[]} args Command arguments.
 * @returns {void}
 */
const useProfile = (args) => {
  const profileName = args[0];
  if (!profileName) {
    fail('Missing profile name.');
  }

  const profilePaths = buildProfilePaths(profileName);
  if (!pathExists(profilePaths.rootDir)) {
    fail(`Profile "${profileName}" does not exist. Create it first.`);
  }

  writeState({ currentProfileName: profileName });
  console.log(`Current profile is now "${profileName}".`);
};

/**
 * Prints all known development profiles.
 *
 * @returns {void}
 */
const printProfiles = () => {
  const state = readState();
  const profiles = listProfiles();

  if (profiles.length === 0) {
    console.log('No development profiles.');
    return;
  }

  for (const profileName of profiles) {
    const profilePaths = buildProfilePaths(profileName);
    const marker = state.currentProfileName === profileName ? '*' : ' ';
    console.log(`${marker} ${profileName} (${formatProfileStatus(profilePaths)})`);
  }
};

/**
 * Prints the current development profile.
 *
 * @returns {void}
 */
const printCurrentProfile = () => {
  const state = readState();
  if (!state.currentProfileName) {
    console.log('No current development profile. Legacy default runtime remains active; use "pnpm dev:profile use default" to switch to the imported default profile.');
    return;
  }

  const profilePaths = buildProfilePaths(state.currentProfileName);
  console.log(`${state.currentProfileName}`);
  console.log(`root: ${profilePaths.rootDir}`);
  console.log(`userData: ${profilePaths.userDataPath}`);
  console.log(`database: ${profilePaths.databasePath}`);
  console.log(`backendStorage: ${profilePaths.backendStoragePath}`);
};

/**
 * Prints filesystem paths for one development profile.
 *
 * @param {string[]} args Command arguments.
 * @returns {void}
 */
const printProfilePath = (args) => {
  const profileName = args[0] ?? readState().currentProfileName;
  if (!profileName) {
    fail('Missing profile name and no current profile is selected.');
  }

  const profilePaths = buildProfilePaths(profileName);
  console.log(`root: ${profilePaths.rootDir}`);
  console.log(`userData: ${profilePaths.userDataPath}`);
  console.log(`database: ${profilePaths.databasePath}`);
  console.log(`backendStorage: ${profilePaths.backendStoragePath}`);
  if (profilePaths.name === DEFAULT_PROFILE_NAME) {
    console.log(`manifest: ${profilePaths.manifestPath}`);
  }
};

/**
 * Resets profile runtime data to simulate a fresh install for the same profile.
 *
 * @param {string[]} args Command arguments.
 * @returns {void}
 */
const resetProfileCommand = (args) => {
  const profileName = args[0];
  if (!profileName) {
    fail('Missing profile name.');
  }

  if (profileName === DEFAULT_PROFILE_NAME) {
    fail('Refusing to reset managed profile "default". Use "pnpm dev:profile import-default --force" to rebuild it from legacy sources.');
  }

  const profilePaths = buildProfilePaths(profileName);
  if (!pathExists(profilePaths.rootDir)) {
    fail(`Profile "${profileName}" does not exist.`);
  }

  resetProfile(profilePaths);
  console.log(`Reset profile "${profileName}".`);
};

/**
 * Deletes one development profile directory.
 *
 * @param {string[]} args Command arguments.
 * @returns {void}
 */
const deleteProfile = (args) => {
  const profileName = args[0];
  if (!profileName) {
    fail('Missing profile name.');
  }

  if (profileName === DEFAULT_PROFILE_NAME) {
    fail('Refusing to delete managed profile "default". Use "pnpm dev:profile import-default --force" to rebuild it from legacy sources.');
  }

  const profilePaths = buildProfilePaths(profileName);
  if (!pathExists(profilePaths.rootDir)) {
    fail(`Profile "${profileName}" does not exist.`);
  }

  const force = args.includes('--force');
  if (!force) {
    fail(`Deleting profiles removes all runtime data. Re-run with --force to delete "${profileName}".`);
  }

  fs.rmSync(profilePaths.rootDir, { recursive: true, force: true });

  const state = readState();
  if (state.currentProfileName === profileName) {
    writeState({ currentProfileName: null });
  }

  console.log(`Deleted profile "${profileName}".`);
};

/**
 * Builds environment variables for launching commands under a development profile.
 *
 * @param {ReturnType<typeof buildProfilePaths>} profilePaths Profile paths.
 * @returns {NodeJS.ProcessEnv} Child process environment.
 */
const buildProfileEnv = (profilePaths) => {
  return {
    ...process.env,
    COSMOSH_DEV_PROFILE: profilePaths.name,
    COSMOSH_DEV_PROFILE_ROOT: profilePaths.rootDir,
    COSMOSH_DB_PATH: profilePaths.databasePath,
    COSMOSH_BACKEND_STORAGE_PATH: profilePaths.backendStoragePath,
  };
};

/**
 * Resolves whether a command should run through the platform shell.
 *
 * Package-manager shims on Windows are `.cmd` files, so they need shell execution.
 * Direct binaries such as `node` and `pwsh` keep argument quoting more reliable without it.
 *
 * @param {string} command Command name passed after `--`.
 * @returns {boolean} Whether spawn should use shell mode.
 */
const shouldUseShellForCommand = (command) => {
  if (process.platform !== 'win32') {
    return false;
  }

  const baseName = path.basename(command).toLowerCase();
  return ['pnpm', 'pnpm.cmd', 'npm', 'npm.cmd', 'yarn', 'yarn.cmd'].includes(baseName);
};

/**
 * Runs an arbitrary command with development profile environment variables.
 *
 * @param {string[]} args Command arguments.
 * @returns {void}
 */
const runWithProfile = (args) => {
  const separatorIndex = args.indexOf('--');
  if (separatorIndex <= 0 || separatorIndex === args.length - 1) {
    fail('Usage: pnpm dev:profile run <name> [--create] [--reset] -- <command> [...args]');
  }

  const profileName = args[0];
  const profileFlags = new Set(args.slice(1, separatorIndex));
  const profilePaths = buildProfilePaths(profileName);
  const profileExists = pathExists(profilePaths.rootDir);

  for (const flag of profileFlags) {
    if (flag !== '--create' && flag !== '--reset') {
      fail(`Unknown run flag "${flag}". Supported flags: --create, --reset.`);
    }
  }

  if (profileName === DEFAULT_PROFILE_NAME && profileFlags.has('--reset')) {
    fail('Refusing to reset managed profile "default" during run. Use "pnpm dev:profile import-default --force" to rebuild it.');
  }

  if (!profileExists && !profileFlags.has('--create')) {
    fail(`Profile "${profileName}" does not exist. Create it first.`);
  }

  ensureProfileDirectories(profilePaths);
  if (profileFlags.has('--reset')) {
    resetProfile(profilePaths);
  }

  const command = args[separatorIndex + 1];
  const commandArgs = args.slice(separatorIndex + 2);
  const child = spawn(command, commandArgs, {
    cwd: workspaceRoot,
    env: buildProfileEnv(profilePaths),
    shell: shouldUseShellForCommand(command),
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on('error', (error) => {
    fail(`Failed to launch command: ${error.message}`);
  });
};

/**
 * Returns true when the command should ensure the default profile exists first.
 *
 * @param {string} command Command name.
 * @param {string[]} args Command args.
 * @returns {boolean} Whether auto-import should run.
 */
const shouldAutoImportDefaultProfile = (command, args) => {
  if (['help', '--help', '-h', 'import-default'].includes(command)) {
    return false;
  }

  if (['delete', 'remove', 'rm'].includes(command) && args[0] === DEFAULT_PROFILE_NAME) {
    return false;
  }

  return true;
};

const [command = 'help', ...args] = process.argv.slice(2);

if (shouldAutoImportDefaultProfile(command, args)) {
  ensureDefaultProfileImported();
}

switch (command) {
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  case 'create':
    createProfile(args);
    break;
  case 'import-default':
    importDefaultProfile({ force: args.includes('--force'), use: args.includes('--use') });
    break;
  case 'use':
    useProfile(args);
    break;
  case 'list':
    printProfiles();
    break;
  case 'current':
    printCurrentProfile();
    break;
  case 'path':
    printProfilePath(args);
    break;
  case 'reset':
    resetProfileCommand(args);
    break;
  case 'delete':
  case 'remove':
  case 'rm':
    deleteProfile(args);
    break;
  case 'run':
    runWithProfile(args);
    break;
  default:
    fail(`Unknown command "${command}". Run pnpm dev:profile --help.`);
}