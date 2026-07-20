const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const mainPackageRoot = path.resolve(__dirname, '..');
const mainEntryPath = path.join(mainPackageRoot, 'dist', 'index.js');
const typescriptCliPath = path.join(mainPackageRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const DEVELOPMENT_NODE_EXECUTABLE_ENV_NAME = 'COSMOSH_DEV_NODE_EXEC_PATH';

/**
 * Runs one development process with inherited terminal I/O.
 *
 * @param {object} options Process options.
 * @param {string} options.label Human-readable process label for diagnostics.
 * @param {string} options.command Absolute executable path.
 * @param {string[]} options.args Process arguments.
 * @param {NodeJS.ProcessEnv} options.env Child-process environment.
 * @param {boolean} options.windowsHide Whether Windows should hide a child console window.
 * @returns {Promise<void>} Resolves when the process exits successfully.
 */
const runProcess = async ({ label, command, args, env, windowsHide }) => {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: mainPackageRoot,
      env,
      stdio: 'inherit',
      shell: false,
      windowsHide,
    });

    child.once('error', (error) => {
      reject(new Error(`${label} failed to start.`, { cause: error }));
    });

    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`));
    });
  });
};

/**
 * Compiles Main and launches Electron with the canonical system Node path.
 *
 * The wrapper runs under pnpm's Node runtime before Electron starts, which
 * gives Main an explicit executable for the development backend child.
 *
 * @returns {Promise<void>} Resolves after Electron exits successfully.
 */
const runDevelopmentMain = async () => {
  const nodeExecutablePath = fs.realpathSync(process.execPath);
  const electronExecutablePath = require('electron');

  await runProcess({
    label: 'Main TypeScript compilation',
    command: nodeExecutablePath,
    args: [typescriptCliPath, '-p', 'tsconfig.json'],
    env: process.env,
    windowsHide: true,
  });

  await runProcess({
    label: 'Electron development runtime',
    command: electronExecutablePath,
    args: [mainEntryPath],
    env: {
      ...process.env,
      [DEVELOPMENT_NODE_EXECUTABLE_ENV_NAME]: nodeExecutablePath,
    },
    windowsHide: false,
  });
};

runDevelopmentMain().catch((error) => {
  console.error('[main:dev] Failed to run development Main process.', error);
  process.exitCode = 1;
});
