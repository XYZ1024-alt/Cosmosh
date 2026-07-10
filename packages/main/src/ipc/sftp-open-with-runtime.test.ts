import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildWindowsOpenWithSystemPathCandidates,
  createWindowsOpenWithChildEnvironment,
  openWithDialogWindows,
  resolveMacOsOpenWithHelperInvocation,
  resolveWindowsOpenWithKnownFolderEnvironment,
  resolveWindowsOpenWithSystemPaths,
  WINDOWS_OPEN_WITH_FILE_PATH_ENV_NAME,
} from './sftp-open-with-runtime';

/**
 * Creates an isolated filesystem root for Open With resolver tests.
 *
 * @returns Test root path plus cleanup callback.
 */
const createTestRoot = async (): Promise<{ cleanup: () => Promise<void>; rootPath: string }> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-open-with-runtime-test-'));
  return {
    rootPath,
    cleanup: async () => {
      await fs.rm(rootPath, { force: true, recursive: true });
    },
  };
};

/**
 * Writes a helper fixture and optionally marks it executable.
 *
 * @param filePath Fixture destination.
 * @param executable Whether to add executable permission bits.
 * @returns Promise resolved after the fixture is ready.
 */
const writeHelperFixture = async (filePath: string, executable: boolean): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '# helper fixture\n', 'utf8');
  if (executable) {
    await fs.chmod(filePath, 0o755);
  }
};

/**
 * Runs a trusted Windows PowerShell script without invoking any shell verb or UI.
 *
 * @param executablePath Canonical Windows PowerShell path.
 * @param workingDirectoryPath Canonical System32 directory.
 * @param environment Minimal child process environment.
 * @param script PowerShell expression that writes the probe result to stdout.
 * @returns Captured standard output.
 */
const runWindowsPowerShellProbe = async (
  executablePath: string,
  workingDirectoryPath: string,
  environment: NodeJS.ProcessEnv,
  script: string,
): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executablePath, ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: workingDirectoryPath,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `PowerShell probe failed, exit code: ${code ?? 'unknown'}`));
    });
  });
};

test('Windows Open With candidates use absolute paths below a canonical system directory', () => {
  const paths = buildWindowsOpenWithSystemPathCandidates('D:\\Windows\\System32');

  assert.deepEqual(paths, {
    powershellExecutablePath: 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    rundll32ExecutablePath: 'D:\\Windows\\System32\\rundll32.exe',
    shell32LibraryPath: 'D:\\Windows\\System32\\shell32.dll',
    workingDirectoryPath: 'D:\\Windows\\System32',
  });
  assert.equal(path.win32.isAbsolute(paths.powershellExecutablePath), true);
  assert.equal(path.win32.isAbsolute(paths.rundll32ExecutablePath), true);
  assert.equal(path.win32.isAbsolute(paths.shell32LibraryPath), true);
});

test('Windows Open With candidates reject relative system directories', () => {
  assert.throws(
    () => buildWindowsOpenWithSystemPathCandidates('.\\Windows\\System32'),
    /Invalid Windows system directory/,
  );
});

test('Windows Open With child environment excludes command search variables', () => {
  const systemPaths = buildWindowsOpenWithSystemPathCandidates('C:\\Windows\\System32');
  const childEnvironment = createWindowsOpenWithChildEnvironment(
    {
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      ComSpec: 'C:\\untrusted-bin\\cmd.exe',
      Path: 'C:\\untrusted-bin',
      PATHEXT: '.EXE;.CMD',
      ProgramData: 'C:\\ProgramData',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      PSModulePath: 'C:\\untrusted-modules',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Users\\test\\Temp',
      WINDIR: 'C:\\Windows',
    },
    'C:\\Users\\test\\Temp\\file.txt',
    systemPaths,
  );

  assert.equal(childEnvironment.PATH, undefined);
  assert.equal(childEnvironment.Path, undefined);
  assert.equal(childEnvironment.PATHEXT, undefined);
  assert.equal(childEnvironment.ComSpec, undefined);
  assert.equal(childEnvironment.PSModulePath, undefined);
  assert.equal(childEnvironment.ProgramData, 'C:\\ProgramData');
  assert.equal(childEnvironment.ProgramFiles, 'C:\\Program Files');
  assert.equal(childEnvironment['ProgramFiles(x86)'], 'C:\\Program Files (x86)');
  assert.equal(childEnvironment.SystemDrive, 'C:');
  assert.equal(childEnvironment.SystemRoot, 'C:\\Windows');
  assert.equal(childEnvironment.WINDIR, 'C:\\Windows');
  assert.equal(childEnvironment[WINDOWS_OPEN_WITH_FILE_PATH_ENV_NAME], 'C:\\Users\\test\\Temp\\file.txt');
  assert.throws(
    () => createWindowsOpenWithChildEnvironment({}, '.\\relative.txt', systemPaths),
    /Invalid Windows Open With target path/,
  );
});

test('Windows Open With uses rundll32 when PowerShell is unavailable', async () => {
  const targetPath = 'C:\\Users\\test\\Temp\\file.txt';
  const systemPaths = {
    powershellExecutablePath: null,
    rundll32ExecutablePath: 'C:\\Windows\\System32\\rundll32.exe',
    shell32LibraryPath: 'C:\\Windows\\System32\\shell32.dll',
    workingDirectoryPath: 'C:\\Windows\\System32',
  };
  const processCalls: Array<{ args: string[]; command: string; environment: NodeJS.ProcessEnv | undefined }> = [];

  await openWithDialogWindows(targetPath, {
    resolveSystemPaths: async () => systemPaths,
    resolveKnownFolderEnvironment: async () => {
      throw new Error('Known-folder discovery must not run without PowerShell.');
    },
    runProcess: async (command, args, options) => {
      processCalls.push({ command, args, environment: options?.env });
    },
  });

  assert.equal(processCalls.length, 1);
  assert.equal(processCalls[0]?.command, systemPaths.rundll32ExecutablePath);
  assert.deepEqual(processCalls[0]?.args, [`${systemPaths.shell32LibraryPath},OpenAs_RunDLL`, targetPath]);
  assert.equal(processCalls[0]?.environment?.PATH, undefined);
  assert.equal(processCalls[0]?.environment?.[WINDOWS_OPEN_WITH_FILE_PATH_ENV_NAME], targetPath);
});

test('Windows Open With keeps rundll32 reachable when known-folder discovery fails', async () => {
  const targetPath = 'C:\\Users\\test\\Temp\\file.txt';
  const systemPaths = {
    powershellExecutablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    rundll32ExecutablePath: 'C:\\Windows\\System32\\rundll32.exe',
    shell32LibraryPath: 'C:\\Windows\\System32\\shell32.dll',
    workingDirectoryPath: 'C:\\Windows\\System32',
  };
  const processCommands: string[] = [];

  await openWithDialogWindows(targetPath, {
    resolveSystemPaths: async () => systemPaths,
    resolveKnownFolderEnvironment: async () => {
      throw new Error('PowerShell is blocked by policy.');
    },
    runProcess: async (command) => {
      processCommands.push(command);
    },
  });

  assert.deepEqual(processCommands, [systemPaths.rundll32ExecutablePath]);
});

test('Windows Open With uses PowerShell when the rundll32 fallback is unavailable', async () => {
  const targetPath = 'C:\\Users\\test\\Temp\\file.txt';
  const systemPaths = {
    powershellExecutablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    rundll32ExecutablePath: null,
    shell32LibraryPath: null,
    workingDirectoryPath: 'C:\\Windows\\System32',
  };
  const processCommands: string[] = [];

  await openWithDialogWindows(targetPath, {
    resolveSystemPaths: async () => systemPaths,
    resolveKnownFolderEnvironment: async () => ({
      ProgramData: 'C:\\ProgramData',
      ProgramFiles: 'C:\\Program Files',
    }),
    runProcess: async (command) => {
      processCommands.push(command);
    },
  });

  assert.deepEqual(processCommands, [systemPaths.powershellExecutablePath]);
});

test(
  'Windows Open With runtime resolves existing canonical system files',
  { skip: process.platform === 'win32' ? false : 'Windows system files are unavailable on this platform.' },
  async () => {
    const paths = await resolveWindowsOpenWithSystemPaths();
    assert.ok(paths.powershellExecutablePath);
    assert.ok(paths.rundll32ExecutablePath);
    assert.ok(paths.shell32LibraryPath);
    assert.equal(path.isAbsolute(paths.powershellExecutablePath), true);
    assert.equal(path.isAbsolute(paths.rundll32ExecutablePath), true);
    assert.equal(path.isAbsolute(paths.shell32LibraryPath), true);
    assert.equal((await fs.lstat(paths.powershellExecutablePath)).isFile(), true);
    assert.equal((await fs.lstat(paths.rundll32ExecutablePath)).isFile(), true);
    assert.equal((await fs.lstat(paths.shell32LibraryPath)).isFile(), true);
  },
);

test(
  'Windows Open With runtime ignores spoofed system and known-folder environment paths',
  { skip: process.platform === 'win32' ? false : 'Windows system files are unavailable on this platform.' },
  async () => {
    const testRoot = await createTestRoot();
    const fakeSystemDirectoryPath = path.join(testRoot.rootPath, 'System32');
    const fakePowerShellDirectoryPath = path.join(fakeSystemDirectoryPath, 'WindowsPowerShell', 'v1.0');
    const fakeProgramFilesPath = path.join(testRoot.rootPath, 'Program Files');
    const originalSystemRoot = process.env.SystemRoot;
    const originalWindowsDirectory = process.env.WINDIR;
    const originalProgramFiles = process.env.ProgramFiles;

    try {
      await fs.mkdir(fakePowerShellDirectoryPath, { recursive: true });
      await Promise.all([
        fs.writeFile(path.join(fakePowerShellDirectoryPath, 'powershell.exe'), ''),
        fs.writeFile(path.join(fakeSystemDirectoryPath, 'rundll32.exe'), ''),
        fs.writeFile(path.join(fakeSystemDirectoryPath, 'shell32.dll'), ''),
      ]);
      process.env.SystemRoot = testRoot.rootPath;
      process.env.WINDIR = testRoot.rootPath;
      process.env.ProgramFiles = fakeProgramFilesPath;

      const paths = await resolveWindowsOpenWithSystemPaths();
      const knownFolderEnvironment = await resolveWindowsOpenWithKnownFolderEnvironment(paths);
      const canonicalSystemDirectoryPath = await fs.realpath('\\\\?\\GLOBALROOT\\SystemRoot\\System32');

      assert.equal(paths.workingDirectoryPath.toLowerCase(), canonicalSystemDirectoryPath.toLowerCase());
      assert.notEqual(knownFolderEnvironment.ProgramFiles?.toLowerCase(), fakeProgramFilesPath.toLowerCase());
    } finally {
      if (originalSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = originalSystemRoot;
      if (originalWindowsDirectory === undefined) delete process.env.WINDIR;
      else process.env.WINDIR = originalWindowsDirectory;
      if (originalProgramFiles === undefined) delete process.env.ProgramFiles;
      else process.env.ProgramFiles = originalProgramFiles;
      await testRoot.cleanup();
    }
  },
);

test(
  'Windows Open With runtime starts trusted PowerShell with the minimal child environment',
  { skip: process.platform === 'win32' ? false : 'Windows PowerShell is unavailable on this platform.' },
  async () => {
    const paths = await resolveWindowsOpenWithSystemPaths();
    assert.ok(paths.powershellExecutablePath);
    const knownFolderEnvironment = await resolveWindowsOpenWithKnownFolderEnvironment(paths);
    const targetPath = path.join(os.tmpdir(), 'cosmosh-open-with-probe.txt');
    const childEnvironment = createWindowsOpenWithChildEnvironment(knownFolderEnvironment, targetPath, paths);
    const stdout = await runWindowsPowerShellProbe(
      paths.powershellExecutablePath,
      paths.workingDirectoryPath,
      childEnvironment,
      `[Console]::Out.Write([Environment]::GetEnvironmentVariable('${WINDOWS_OPEN_WITH_FILE_PATH_ENV_NAME}', 'Process'))`,
    );
    const expandedProgramFiles = await runWindowsPowerShellProbe(
      paths.powershellExecutablePath,
      paths.workingDirectoryPath,
      childEnvironment,
      '[Console]::Out.Write([Environment]::ExpandEnvironmentVariables("%ProgramFiles%"))',
    );

    assert.equal(stdout, targetPath);
    assert.equal(expandedProgramFiles, knownFolderEnvironment.ProgramFiles);
    assert.equal(path.win32.isAbsolute(childEnvironment.ProgramFiles ?? ''), true);
    if (knownFolderEnvironment['ProgramFiles(x86)']) {
      assert.equal(path.win32.isAbsolute(childEnvironment['ProgramFiles(x86)'] ?? ''), true);
    }
  },
);

test('packaged macOS helper resolution never falls back to source or development directories', async () => {
  const testRoot = await createTestRoot();
  const resourcesPath = path.join(testRoot.rootPath, 'packaged-resources');
  const moduleDirectoryPath = path.join(testRoot.rootPath, 'repository', 'dist', 'ipc');
  const workingDirectoryPath = path.join(testRoot.rootPath, 'launch-directory');
  const packagedSourcePath = path.join(resourcesPath, 'helpers', 'macos-sftp-open-with.swift');
  const developmentBinaryPath = path.join(
    workingDirectoryPath,
    'packages',
    'main',
    'resources',
    'helpers',
    'cosmosh-sftp-open-with',
  );

  try {
    await writeHelperFixture(packagedSourcePath, false);
    await writeHelperFixture(developmentBinaryPath, true);

    const invocation = await resolveMacOsOpenWithHelperInvocation({
      isPackaged: true,
      resourcesPath,
      moduleDirectoryPath,
      workingDirectoryPath,
    });
    assert.equal(invocation, null);
  } finally {
    await testRoot.cleanup();
  }
});

test('macOS helper resolution rejects relative runtime paths', async () => {
  await assert.rejects(
    () =>
      resolveMacOsOpenWithHelperInvocation({
        isPackaged: true,
        resourcesPath: '.\\relative-resources',
        moduleDirectoryPath: path.resolve('dist', 'ipc'),
        workingDirectoryPath: process.cwd(),
      }),
    /Invalid macOS Open With runtime path/,
  );
});

test('packaged macOS helper resolution accepts only the compiled resource helper', async () => {
  const testRoot = await createTestRoot();
  const resourcesPath = path.join(testRoot.rootPath, 'packaged-resources');
  const packagedBinaryPath = path.join(resourcesPath, 'helpers', 'cosmosh-sftp-open-with');

  try {
    await writeHelperFixture(packagedBinaryPath, true);
    const invocation = await resolveMacOsOpenWithHelperInvocation({
      isPackaged: true,
      resourcesPath,
      moduleDirectoryPath: path.join(testRoot.rootPath, 'repository', 'dist', 'ipc'),
      workingDirectoryPath: path.join(testRoot.rootPath, 'launch-directory'),
    });

    assert.deepEqual(invocation, {
      command: await fs.realpath(packagedBinaryPath),
      argsPrefix: [],
      workingDirectoryPath: await fs.realpath(path.dirname(packagedBinaryPath)),
    });
  } finally {
    await testRoot.cleanup();
  }
});

test(
  'packaged macOS helper resolution rejects a symlinked helper',
  { skip: process.platform === 'win32' ? 'Windows symlink creation requires elevated host policy.' : false },
  async () => {
    const testRoot = await createTestRoot();
    const resourcesPath = path.join(testRoot.rootPath, 'packaged-resources');
    const packagedBinaryPath = path.join(resourcesPath, 'helpers', 'cosmosh-sftp-open-with');
    const outsideBinaryPath = path.join(testRoot.rootPath, 'outside', 'cosmosh-sftp-open-with');

    try {
      await writeHelperFixture(outsideBinaryPath, true);
      await fs.mkdir(path.dirname(packagedBinaryPath), { recursive: true });
      await fs.symlink(outsideBinaryPath, packagedBinaryPath);

      const invocation = await resolveMacOsOpenWithHelperInvocation({
        isPackaged: true,
        resourcesPath,
        moduleDirectoryPath: path.join(testRoot.rootPath, 'repository', 'dist', 'ipc'),
        workingDirectoryPath: path.join(testRoot.rootPath, 'launch-directory'),
      });
      assert.equal(invocation, null);
    } finally {
      await testRoot.cleanup();
    }
  },
);

test('development macOS helper resolution permits repository binary and Swift source fallbacks', async () => {
  const testRoot = await createTestRoot();
  const packageDirectoryPath = path.join(testRoot.rootPath, 'repository');
  const moduleDirectoryPath = path.join(packageDirectoryPath, 'dist', 'ipc');
  const helperDirectoryPath = path.join(packageDirectoryPath, 'resources', 'helpers');
  const binaryPath = path.join(helperDirectoryPath, 'cosmosh-sftp-open-with');
  const sourcePath = path.join(helperDirectoryPath, 'macos-sftp-open-with.swift');
  const options = {
    isPackaged: false,
    resourcesPath: path.join(testRoot.rootPath, 'electron-resources'),
    moduleDirectoryPath,
    workingDirectoryPath: path.join(testRoot.rootPath, 'launch-directory'),
  };

  try {
    await writeHelperFixture(binaryPath, true);
    assert.deepEqual(await resolveMacOsOpenWithHelperInvocation(options), {
      command: await fs.realpath(binaryPath),
      argsPrefix: [],
      workingDirectoryPath: await fs.realpath(helperDirectoryPath),
    });

    await fs.rm(binaryPath);
    await writeHelperFixture(sourcePath, false);
    assert.deepEqual(await resolveMacOsOpenWithHelperInvocation(options), {
      command: '/usr/bin/swift',
      argsPrefix: [await fs.realpath(sourcePath)],
      workingDirectoryPath: await fs.realpath(helperDirectoryPath),
    });
  } finally {
    await testRoot.cleanup();
  }
});
