const { spawn } = require('node:child_process');
const path = require('node:path');

const mainPackageRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(__dirname, '../../..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/**
 * Creates a CI prebuild step descriptor.
 *
 * @param {string} label Human-readable step label for CI logs.
 * @param {string} command Executable command.
 * @param {string[]} args Command arguments.
 * @param {string} cwd Working directory for the command.
 * @returns {{ label: string, command: string, args: string[], cwd: string }} Step descriptor.
 */
const createStep = (label, command, args, cwd = workspaceRoot) => ({
  label,
  command,
  args,
  cwd,
});

/**
 * Creates a step that runs one main-package Node.js helper script.
 *
 * @param {string} label Human-readable step label for CI logs.
 * @param {string} scriptName File name under packages/main/scripts.
 * @returns {{ label: string, command: string, args: string[], cwd: string }} Step descriptor.
 */
const mainNodeScript = (label, scriptName) =>
  createStep(label, process.execPath, [path.join(mainPackageRoot, 'scripts', scriptName)], mainPackageRoot);

/**
 * Creates a step that runs pnpm from the workspace root.
 *
 * @param {string} label Human-readable step label for CI logs.
 * @param {string[]} args Arguments passed to pnpm.
 * @returns {{ label: string, command: string, args: string[], cwd: string }} Step descriptor.
 */
const pnpmStep = (label, args) => createStep(label, pnpmCommand, args, workspaceRoot);

const steps = [
  mainNodeScript('Clean release artifacts', 'cleanup-legacy-artifacts.cjs'),
  mainNodeScript('Release Prisma locks', 'release-unlock-prisma-locks.cjs'),
  pnpmStep('Build API contract', ['--filter', '@cosmosh/api-contract', 'build']),
  pnpmStep('Build i18n', ['--filter', '@cosmosh/i18n', 'build']),
  pnpmStep('Generate backend Prisma client', ['--filter', '@cosmosh/backend', 'run', 'db:generate']),
  pnpmStep('Compile backend', ['--filter', '@cosmosh/backend', 'exec', 'tsc', '-p', 'tsconfig.json']),
  mainNodeScript('Ensure SQLCipher native addon', 'ensure-sqlcipher-native.cjs'),
  mainNodeScript('Sync Prisma client runtime', 'sync-prisma-client.cjs'),
  mainNodeScript('Sync backend runtime', 'sync-backend-runtime.cjs'),
  mainNodeScript('Generate installer strings', 'generate-installer-strings.mjs'),
  mainNodeScript('Compile macOS Open With helper', 'compile-macos-open-with-helper.mjs'),
  pnpmStep('Sync renderer theme', ['--filter', '@cosmosh/renderer', 'run', 'theme:sync']),
  pnpmStep('Type-check renderer', ['--filter', '@cosmosh/renderer', 'exec', 'tsc', '-p', 'tsconfig.json']),
  pnpmStep('Build renderer', ['--filter', '@cosmosh/renderer', 'exec', 'vite', 'build']),
];

/**
 * Runs one step and rejects with command context on failure.
 *
 * @param {{ label: string, command: string, args: string[], cwd: string }} step Step descriptor.
 * @returns {Promise<void>} Resolves when the step exits successfully.
 */
const runStep = async (step) => {
  console.log(`[main:prebuild:ci] ${step.label}`);

  await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: process.env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const renderedCommand = [step.command, ...step.args].join(' ');
      reject(
        new Error(
          `${step.label} failed (code=${code ?? 'null'}, signal=${signal ?? 'null'}): ${renderedCommand}`,
        ),
      );
    });
  });
};

/**
 * Runs the optimized CI prebuild sequence without package lifecycle duplication.
 *
 * @returns {Promise<void>} Resolves when all CI prebuild steps pass.
 */
const runCiPrebuild = async () => {
  for (const step of steps) {
    await runStep(step);
  }
};

runCiPrebuild().catch((error) => {
  console.error('[main:prebuild:ci] Failed.', error);
  process.exitCode = 1;
});

