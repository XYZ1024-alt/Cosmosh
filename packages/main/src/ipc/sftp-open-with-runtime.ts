import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { isPathInsideDirectory } from './sftp-temporary-root';

const MACOS_SFTP_OPEN_WITH_HELPER_NAME = 'cosmosh-sftp-open-with';
const MACOS_SFTP_OPEN_WITH_HELPER_SOURCE_NAME = 'macos-sftp-open-with.swift';
const MAX_WINDOWS_KNOWN_FOLDER_OUTPUT_BYTES = 64 * 1024;
const WINDOWS_SYSTEM_DIRECTORY_DEVICE_PATH = '\\\\?\\GLOBALROOT\\SystemRoot\\System32';
const WINDOWS_CHILD_ENVIRONMENT_KEYS = [
  'ALLUSERSPROFILE',
  'APPDATA',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'PUBLIC',
  'TEMP',
  'TMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
] as const;
const WINDOWS_KNOWN_FOLDER_POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$knownFolders = [ordered]@{
  APPDATA = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
  CommonProgramFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonProgramFiles)
  'CommonProgramFiles(x86)' = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonProgramFilesX86)
  CommonDocuments = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDocuments)
  LOCALAPPDATA = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  ProgramData = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
  ProgramFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  'ProgramFiles(x86)' = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
  USERDOMAIN = [Environment]::UserDomainName
  USERNAME = [Environment]::UserName
  USERPROFILE = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
}

foreach ($entry in $knownFolders.GetEnumerator()) {
  if (-not [string]::IsNullOrWhiteSpace([string]$entry.Value)) {
    $encodedValue = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$entry.Value))
    [Console]::Out.WriteLine('{0}={1}', $entry.Key, $encodedValue)
  }
}
`;
const WINDOWS_KNOWN_FOLDER_PATH_KEYS = new Set([
  'APPDATA',
  'CommonDocuments',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'USERPROFILE',
]);
const WINDOWS_REQUIRED_KNOWN_FOLDER_KEYS = [
  'APPDATA',
  'CommonProgramFiles',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'USERPROFILE',
] as const;

/** Environment variable used to pass the validated temp file to Windows PowerShell. */
export const WINDOWS_OPEN_WITH_FILE_PATH_ENV_NAME = 'COSMOSH_SFTP_OPEN_WITH_PATH';
const WINDOWS_OPEN_WITH_POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::Error.Encoding = [System.Text.UTF8Encoding]::new()
$targetPath = [Environment]::GetEnvironmentVariable('${WINDOWS_OPEN_WITH_FILE_PATH_ENV_NAME}', 'Process')
if ([string]::IsNullOrWhiteSpace($targetPath)) {
  throw 'Missing Open With file path.'
}

Start-Process -FilePath $targetPath -Verb OpenAs
`;

/** Trusted command descriptor used to invoke the macOS Open With helper. */
export type MacOsOpenWithHelperInvocation = {
  /** Absolute helper executable path. */
  command: string;
  /** Arguments prepended before the helper operation and file paths. */
  argsPrefix: string[];
  /** Trusted directory used as the child process working directory. */
  workingDirectoryPath: string;
};

/** Runtime paths required to resolve packaged and development macOS helpers. */
export type ResolveMacOsOpenWithHelperOptions = {
  /** Whether Electron is running from a packaged application. */
  isPackaged: boolean;
  /** Electron resources directory used as the only packaged trust root. */
  resourcesPath: string;
  /** Directory containing the compiled or source IPC module. */
  moduleDirectoryPath: string;
  /** Current working directory used only by unpackaged development. */
  workingDirectoryPath: string;
};

/** Absolute Windows system path candidates used by the Open With process chain. */
export type WindowsOpenWithSystemPathCandidates = {
  /** Windows PowerShell executable path. */
  powershellExecutablePath: string;
  /** Rundll32 executable path. */
  rundll32ExecutablePath: string;
  /** Shell32 library path passed to rundll32. */
  shell32LibraryPath: string;
  /** System32 directory used as the child process working directory. */
  workingDirectoryPath: string;
};

/** Independently validated Windows system paths available to the Open With process chain. */
export type WindowsOpenWithSystemPaths = {
  /** Windows PowerShell executable path, or null when the primary route is unavailable. */
  powershellExecutablePath: string | null;
  /** Rundll32 executable path, or null when the fallback route is unavailable. */
  rundll32ExecutablePath: string | null;
  /** Shell32 library path, or null when the fallback route is unavailable. */
  shell32LibraryPath: string | null;
  /** Canonical System32 directory used as the child process working directory. */
  workingDirectoryPath: string;
};

/** Process runner contract used to keep Windows Open With route tests side-effect free. */
type WindowsOpenWithProcessRunner = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => Promise<void>;

/** Injectable trusted operations used by the Windows Open With route orchestrator. */
type WindowsOpenWithDialogDependencies = {
  resolveSystemPaths: () => Promise<WindowsOpenWithSystemPaths>;
  resolveKnownFolderEnvironment: (systemPaths: WindowsOpenWithSystemPaths) => Promise<NodeJS.ProcessEnv>;
  runProcess: WindowsOpenWithProcessRunner;
};

type TrustedFileCandidate = {
  filePath: string;
  rootPath: string;
};

/**
 * Reads a Windows environment variable without relying on key casing.
 *
 * @param environment Source process environment.
 * @param variableName Canonical Windows variable name.
 * @returns Variable value when present.
 */
const readWindowsEnvironmentVariable = (environment: NodeJS.ProcessEnv, variableName: string): string | undefined => {
  const normalizedName = variableName.toLowerCase();
  return Object.entries(environment).find(([key]) => key.toLowerCase() === normalizedName)?.[1];
};

/**
 * Normalizes and validates one Windows absolute path.
 *
 * @param candidatePath Untrusted path-shaped input.
 * @param label Error context for the caller.
 * @returns Normalized Windows absolute path.
 */
const normalizeWindowsAbsolutePath = (candidatePath: string | undefined, label: string): string => {
  const trimmedPath = candidatePath?.trim();
  if (!trimmedPath || !path.win32.isAbsolute(trimmedPath) || trimmedPath.includes('\0')) {
    throw new Error(`Invalid ${label}.`);
  }

  return path.win32.normalize(trimmedPath);
};

/**
 * Creates the environment required to start a trusted Windows system process.
 *
 * @param systemPaths Canonical paths resolved from the kernel-owned system namespace.
 * @returns Environment containing only immutable system-directory anchors.
 */
const createWindowsSystemProcessEnvironment = (
  systemPaths: Pick<WindowsOpenWithSystemPaths, 'workingDirectoryPath'>,
): NodeJS.ProcessEnv => {
  const systemRootPath = path.win32.dirname(systemPaths.workingDirectoryPath);
  return {
    SystemDrive: path.win32.parse(systemRootPath).root.replace(/[\\/]$/u, ''),
    SystemRoot: systemRootPath,
    WINDIR: systemRootPath,
  };
};

/**
 * Parses base64-encoded known-folder rows emitted by trusted Windows PowerShell.
 *
 * @param output Bounded helper stdout.
 * @returns Validated known-folder and user environment values.
 */
const parseWindowsKnownFolderEnvironment = (output: string): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};

  for (const row of output.split(/\r?\n/u)) {
    const separatorIndex = row.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const variableName = row.slice(0, separatorIndex);
    if (
      !WINDOWS_KNOWN_FOLDER_PATH_KEYS.has(variableName) &&
      variableName !== 'USERNAME' &&
      variableName !== 'USERDOMAIN'
    ) {
      continue;
    }

    const value = Buffer.from(row.slice(separatorIndex + 1), 'base64').toString('utf8');
    if (!value || value.includes('\0') || /[\r\n]/u.test(value)) {
      throw new Error(`Invalid Windows known-folder value: ${variableName}.`);
    }
    if (WINDOWS_KNOWN_FOLDER_PATH_KEYS.has(variableName) && !path.win32.isAbsolute(value)) {
      throw new Error(`Invalid Windows known-folder path: ${variableName}.`);
    }

    environment[variableName] = value;
  }

  if (WINDOWS_REQUIRED_KNOWN_FOLDER_KEYS.some((variableName) => !environment[variableName])) {
    throw new Error('Required Windows known-folder paths are unavailable.');
  }

  const programFilesPath = environment.ProgramFiles;
  const commonProgramFilesPath = environment.CommonProgramFiles;
  const localAppDataPath = environment.LOCALAPPDATA;
  const programDataPath = environment.ProgramData;
  const userProfilePath = environment.USERPROFILE;
  if (!programFilesPath || !commonProgramFilesPath || !localAppDataPath || !programDataPath || !userProfilePath) {
    throw new Error('Required Windows known-folder paths are unavailable.');
  }

  const homeDrive = path.win32.parse(userProfilePath).root.replace(/[\\/]$/u, '');
  environment.ALLUSERSPROFILE = programDataPath;
  environment.CommonProgramW6432 = commonProgramFilesPath;
  environment.HOMEDRIVE = homeDrive;
  environment.HOMEPATH = userProfilePath.slice(homeDrive.length);
  environment.ProgramW6432 = programFilesPath;
  environment.PUBLIC = environment.CommonDocuments ? path.win32.dirname(environment.CommonDocuments) : undefined;
  environment.TEMP = path.win32.join(localAppDataPath, 'Temp');
  environment.TMP = environment.TEMP;
  delete environment.CommonDocuments;

  return environment;
};

/**
 * Resolves a real, non-symlink directory used as a process trust root.
 *
 * @param directoryPath Candidate trust-root directory.
 * @returns Canonical directory path, or null when validation fails.
 */
const resolveTrustedDirectoryPath = async (directoryPath: string): Promise<string | null> => {
  try {
    const stats = await fs.lstat(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return null;
    }

    return await fs.realpath(directoryPath);
  } catch {
    return null;
  }
};

/**
 * Resolves a regular file and proves its canonical path remains under a trusted directory.
 *
 * @param candidate Candidate file and trust-root paths.
 * @param requireExecutable Whether the file must have executable access.
 * @returns Canonical file path, or null when validation fails.
 */
const resolveTrustedRegularFilePath = async (
  candidate: TrustedFileCandidate,
  requireExecutable: boolean,
): Promise<string | null> => {
  try {
    const canonicalRootPath = await resolveTrustedDirectoryPath(candidate.rootPath);
    if (!canonicalRootPath) {
      return null;
    }

    const stats = await fs.lstat(candidate.filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return null;
    }
    if (requireExecutable) {
      await fs.access(candidate.filePath, constants.X_OK);
    }

    const canonicalFilePath = await fs.realpath(candidate.filePath);
    return isPathInsideDirectory(canonicalFilePath, canonicalRootPath) ? canonicalFilePath : null;
  } catch {
    return null;
  }
};

/**
 * Finds the first validated file from an ordered candidate list.
 *
 * @param candidates Ordered file candidates.
 * @param requireExecutable Whether each candidate must have executable access.
 * @returns Canonical path for the first trusted file, or null.
 */
const resolveFirstTrustedRegularFilePath = async (
  candidates: readonly TrustedFileCandidate[],
  requireExecutable: boolean,
): Promise<string | null> => {
  for (const candidate of candidates) {
    const trustedPath = await resolveTrustedRegularFilePath(candidate, requireExecutable);
    if (trustedPath) {
      return trustedPath;
    }
  }

  return null;
};

/**
 * Builds absolute Windows Open With candidates from a canonical system directory.
 *
 * @param systemDirectoryPath Canonical System32 directory resolved from the OS namespace.
 * @returns Absolute system path candidates that still require filesystem validation.
 */
export const buildWindowsOpenWithSystemPathCandidates = (
  systemDirectoryPath: string,
): WindowsOpenWithSystemPathCandidates => {
  const workingDirectoryPath = normalizeWindowsAbsolutePath(systemDirectoryPath, 'Windows system directory');
  return {
    powershellExecutablePath: path.win32.join(workingDirectoryPath, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    rundll32ExecutablePath: path.win32.join(workingDirectoryPath, 'rundll32.exe'),
    shell32LibraryPath: path.win32.join(workingDirectoryPath, 'shell32.dll'),
    workingDirectoryPath,
  };
};

/**
 * Resolves and validates the Windows system files used by the Open With flow.
 *
 * @returns Canonical trusted executable, library, and working-directory paths.
 */
export const resolveWindowsOpenWithSystemPaths = async (): Promise<WindowsOpenWithSystemPaths> => {
  const canonicalSystemDirectoryPath = await resolveTrustedDirectoryPath(WINDOWS_SYSTEM_DIRECTORY_DEVICE_PATH);
  if (!canonicalSystemDirectoryPath) {
    throw new Error('Trusted Windows system directory is unavailable.');
  }

  const candidates = buildWindowsOpenWithSystemPathCandidates(canonicalSystemDirectoryPath);
  const [powershellExecutablePath, rundll32ExecutablePath, shell32LibraryPath] = await Promise.all([
    resolveTrustedRegularFilePath(
      { filePath: candidates.powershellExecutablePath, rootPath: candidates.workingDirectoryPath },
      true,
    ),
    resolveTrustedRegularFilePath(
      { filePath: candidates.rundll32ExecutablePath, rootPath: candidates.workingDirectoryPath },
      true,
    ),
    resolveTrustedRegularFilePath(
      { filePath: candidates.shell32LibraryPath, rootPath: candidates.workingDirectoryPath },
      false,
    ),
  ]);
  const hasPowerShellRoute = powershellExecutablePath !== null;
  const hasRundll32Route = rundll32ExecutablePath !== null && shell32LibraryPath !== null;
  if (!hasPowerShellRoute && !hasRundll32Route) {
    throw new Error('Trusted Windows Open With runtime is unavailable.');
  }

  return {
    powershellExecutablePath,
    rundll32ExecutablePath,
    shell32LibraryPath,
    workingDirectoryPath: canonicalSystemDirectoryPath,
  };
};

/**
 * Resolves Windows known folders without trusting inherited path environment values.
 *
 * The trusted PowerShell binary queries the current Windows user token through
 * Environment.SpecialFolder APIs. Output is base64 encoded to preserve Unicode paths.
 *
 * @param systemPaths Canonical Windows system paths returned by the trusted resolver.
 * @returns Validated environment values required by Shell Open With handlers.
 */
export const resolveWindowsOpenWithKnownFolderEnvironment = async (
  systemPaths: WindowsOpenWithSystemPaths,
): Promise<NodeJS.ProcessEnv> => {
  const powershellExecutablePath = systemPaths.powershellExecutablePath;
  if (!powershellExecutablePath) {
    throw new Error('Trusted Windows PowerShell runtime is unavailable.');
  }

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      powershellExecutablePath,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_KNOWN_FOLDER_POWERSHELL_SCRIPT,
      ],
      {
        cwd: systemPaths.workingDirectoryPath,
        env: createWindowsSystemProcessEnvironment(systemPaths),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    let outputExceeded = false;

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, 'utf8') > MAX_WINDOWS_KNOWN_FOLDER_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr, 'utf8') > MAX_WINDOWS_KNOWN_FOLDER_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill();
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (outputExceeded) {
        reject(new Error('Windows known-folder helper output exceeded the safety limit.'));
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `Windows known-folder helper failed, exit code: ${code ?? 'unknown'}`));
    });
  });

  return parseWindowsKnownFolderEnvironment(output);
};

/**
 * Creates the minimal environment needed by the Windows Open With child process.
 *
 * PATH, PATHEXT, ComSpec, and PowerShell module variables are intentionally omitted
 * because every executable, library, and target path is supplied explicitly.
 *
 * @param knownFolderEnvironment Values resolved through trusted Windows known-folder APIs, or empty for fallback.
 * @param filePath Validated SFTP temp file path passed to PowerShell.
 * @param systemPaths Canonical Windows system paths returned by the trusted resolver.
 * @returns Child environment with canonical system-root variables and optional user-shell context.
 */
export const createWindowsOpenWithChildEnvironment = (
  knownFolderEnvironment: NodeJS.ProcessEnv,
  filePath: string,
  systemPaths: WindowsOpenWithSystemPaths,
): NodeJS.ProcessEnv => {
  if (!path.win32.isAbsolute(filePath) || filePath.includes('\0')) {
    throw new Error('Invalid Windows Open With target path.');
  }

  const childEnvironment: NodeJS.ProcessEnv = {
    ...createWindowsSystemProcessEnvironment(systemPaths),
    [WINDOWS_OPEN_WITH_FILE_PATH_ENV_NAME]: filePath,
  };

  for (const variableName of WINDOWS_CHILD_ENVIRONMENT_KEYS) {
    const value = readWindowsEnvironmentVariable(knownFolderEnvironment, variableName);
    if (value !== undefined) {
      childEnvironment[variableName] = value;
    }
  }

  return childEnvironment;
};

/**
 * Runs a Windows child process and converts a non-zero exit into a useful error.
 *
 * @param command Executable to start.
 * @param args Process arguments.
 * @param options Spawn options that preserve the validated runtime boundary.
 * @returns Promise resolved when the child exits successfully.
 */
const runWindowsOpenWithProcess: WindowsOpenWithProcessRunner = async (command, args, options): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, options);
    let stderr = '';

    child.on('error', reject);
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} failed, exit code: ${code ?? 'unknown'}`));
    });
  });
};

/**
 * Opens a validated local file through independent Windows Open With routes.
 *
 * PowerShell enriches the child environment through known-folder APIs when it
 * is available. The rundll32 fallback remains reachable with a kernel-anchored
 * minimal environment when PowerShell resolution or execution is blocked.
 *
 * @param filePath Existing validated local file path.
 * @param dependencyOverrides Test-only overrides for trusted runtime operations.
 * @returns Promise resolved after one Open With route exits successfully.
 */
export const openWithDialogWindows = async (
  filePath: string,
  dependencyOverrides: Partial<WindowsOpenWithDialogDependencies> = {},
): Promise<void> => {
  const resolveSystemPaths = dependencyOverrides.resolveSystemPaths ?? resolveWindowsOpenWithSystemPaths;
  const resolveKnownFolderEnvironment =
    dependencyOverrides.resolveKnownFolderEnvironment ?? resolveWindowsOpenWithKnownFolderEnvironment;
  const runProcess = dependencyOverrides.runProcess ?? runWindowsOpenWithProcess;
  const systemPaths = await resolveSystemPaths();
  let childEnvironment = createWindowsOpenWithChildEnvironment({}, filePath, systemPaths);
  let primaryError: unknown = new Error('Trusted Windows PowerShell Open With runtime is unavailable.');

  if (systemPaths.powershellExecutablePath) {
    try {
      const knownFolderEnvironment = await resolveKnownFolderEnvironment(systemPaths);
      childEnvironment = createWindowsOpenWithChildEnvironment(knownFolderEnvironment, filePath, systemPaths);
      await runProcess(
        systemPaths.powershellExecutablePath,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          WINDOWS_OPEN_WITH_POWERSHELL_SCRIPT,
        ],
        {
          cwd: systemPaths.workingDirectoryPath,
          env: childEnvironment,
          shell: false,
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
        },
      );
      return;
    } catch (error: unknown) {
      primaryError = error;
    }
  }

  try {
    if (!systemPaths.rundll32ExecutablePath || !systemPaths.shell32LibraryPath) {
      throw new Error('Trusted Windows rundll32 Open With runtime is unavailable.');
    }

    await runProcess(
      systemPaths.rundll32ExecutablePath,
      [`${systemPaths.shell32LibraryPath},OpenAs_RunDLL`, filePath],
      {
        cwd: systemPaths.workingDirectoryPath,
        env: childEnvironment,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
  } catch (fallbackError: unknown) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : 'OpenAs shell verb failed.';
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'OpenAs_RunDLL failed.';
    throw new Error(`${primaryMessage}\nFallback Open With failed: ${fallbackMessage}`);
  }
};

/**
 * Resolves the trusted helper used for macOS NSWorkspace Open With operations.
 *
 * Packaged runs accept only the compiled helper under process.resourcesPath and
 * fail closed when it is absent. Unpackaged runs may use repository binary/source
 * locations so local development does not depend on a packaged resource layout.
 *
 * @param options Runtime paths and packaged-state boundary.
 * @returns Trusted helper invocation, or null when no allowed helper is available.
 */
export const resolveMacOsOpenWithHelperInvocation = async (
  options: ResolveMacOsOpenWithHelperOptions,
): Promise<MacOsOpenWithHelperInvocation | null> => {
  const runtimePaths = [options.resourcesPath, options.moduleDirectoryPath, options.workingDirectoryPath];
  if (runtimePaths.some((runtimePath) => !path.isAbsolute(runtimePath) || runtimePath.includes('\0'))) {
    throw new Error('Invalid macOS Open With runtime path.');
  }

  const packagedHelperDirectoryPath = path.join(options.resourcesPath, 'helpers');
  if (options.isPackaged) {
    const command = await resolveTrustedRegularFilePath(
      {
        filePath: path.join(packagedHelperDirectoryPath, MACOS_SFTP_OPEN_WITH_HELPER_NAME),
        rootPath: packagedHelperDirectoryPath,
      },
      true,
    );
    return command
      ? {
          command,
          argsPrefix: [],
          workingDirectoryPath: path.dirname(command),
        }
      : null;
  }

  const developmentHelperDirectoryPaths = Array.from(
    new Set([
      path.resolve(options.moduleDirectoryPath, '..', '..', 'resources', 'helpers'),
      path.resolve(options.workingDirectoryPath, 'packages', 'main', 'resources', 'helpers'),
    ]),
  );
  const binaryCandidates = developmentHelperDirectoryPaths.map(
    (helperDirectoryPath): TrustedFileCandidate => ({
      filePath: path.join(helperDirectoryPath, MACOS_SFTP_OPEN_WITH_HELPER_NAME),
      rootPath: helperDirectoryPath,
    }),
  );
  const binaryPath = await resolveFirstTrustedRegularFilePath(binaryCandidates, true);
  if (binaryPath) {
    return {
      command: binaryPath,
      argsPrefix: [],
      workingDirectoryPath: path.dirname(binaryPath),
    };
  }

  const sourceCandidates = developmentHelperDirectoryPaths.map(
    (helperDirectoryPath): TrustedFileCandidate => ({
      filePath: path.join(helperDirectoryPath, MACOS_SFTP_OPEN_WITH_HELPER_SOURCE_NAME),
      rootPath: helperDirectoryPath,
    }),
  );
  const sourcePath = await resolveFirstTrustedRegularFilePath(sourceCandidates, false);
  return sourcePath
    ? {
        command: '/usr/bin/swift',
        argsPrefix: [sourcePath],
        workingDirectoryPath: path.dirname(sourcePath),
      }
    : null;
};
