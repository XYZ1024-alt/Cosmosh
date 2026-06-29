const path = require('node:path');

const { createStep, runSteps } = require('./ci-step-runner.cjs');

const mainPackageRoot = path.resolve(__dirname, '..');
const buildArgs = process.argv.slice(2);

/**
 * Creates a step that runs a main-package Node.js helper script.
 *
 * @param {string} label Human-readable step label for CI logs.
 * @param {string} scriptName File name under packages/main/scripts.
 * @returns {{ label: string, command: string, args: string[], cwd: string, shell: boolean }} Step descriptor.
 */
const mainNodeScript = (label, scriptName) =>
  createStep({
    label,
    command: process.execPath,
    args: [path.join(mainPackageRoot, 'scripts', scriptName)],
    cwd: mainPackageRoot,
  });

/**
 * Creates a step that runs a main-package CLI through Node.js.
 *
 * @param {string} label Human-readable step label for CI logs.
 * @param {string[]} cliPath Package-local CLI path segments.
 * @param {string[]} args CLI arguments.
 * @returns {{ label: string, command: string, args: string[], cwd: string, shell: boolean }} Step descriptor.
 */
const mainCliStep = (label, cliPath, args) =>
  createStep({
    label,
    command: process.execPath,
    args: [path.join(mainPackageRoot, ...cliPath), ...args],
    cwd: mainPackageRoot,
  });

const steps = [
  mainNodeScript('Run optimized prebuild', 'prebuild-ci.cjs'),
  mainCliStep('Compile main', ['node_modules', 'typescript', 'bin', 'tsc'], ['-p', 'tsconfig.json']),
  mainCliStep('Build installers', ['node_modules', 'electron-builder', 'cli.js'], buildArgs),
];

/**
 * Runs the main package CI build and installer packaging sequence.
 *
 * @returns {Promise<void>} Resolves when all CI packaging steps pass.
 */
const runCiPackage = async () => {
  await runSteps('main:package:ci', steps);
};

runCiPackage().catch((error) => {
  console.error('[main:package:ci] Failed.', error);
  process.exitCode = 1;
});
