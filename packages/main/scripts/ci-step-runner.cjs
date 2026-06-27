const { spawn } = require('node:child_process');

/**
 * Creates a CI step descriptor.
 *
 * @param {object} options Step options.
 * @param {string} options.label Human-readable step label for CI logs.
 * @param {string} options.command Executable command.
 * @param {string[]} options.args Command arguments.
 * @param {string} options.cwd Working directory for the command.
 * @param {boolean} [options.shell=false] Whether to run the command through the platform shell.
 * @returns {{ label: string, command: string, args: string[], cwd: string, shell: boolean }} Step descriptor.
 */
const createStep = ({ label, command, args, cwd, shell = false }) => ({
  label,
  command,
  args,
  cwd,
  shell,
});

/**
 * Runs one CI step and rejects with command context on failure.
 *
 * @param {string} logPrefix Log prefix used to identify the calling CI script.
 * @param {{ label: string, command: string, args: string[], cwd: string, shell: boolean }} step Step descriptor.
 * @returns {Promise<void>} Resolves when the step exits successfully.
 */
const runStep = async (logPrefix, step) => {
  console.log(`[${logPrefix}] ${step.label}`);

  await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: process.env,
      stdio: 'inherit',
      shell: step.shell,
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
 * Runs CI steps sequentially so earlier build products are available to later steps.
 *
 * @param {string} logPrefix Log prefix used to identify the calling CI script.
 * @param {{ label: string, command: string, args: string[], cwd: string, shell: boolean }[]} steps Ordered CI steps.
 * @returns {Promise<void>} Resolves when all steps exit successfully.
 */
const runSteps = async (logPrefix, steps) => {
  for (const step of steps) {
    await runStep(logPrefix, step);
  }
};

module.exports = {
  createStep,
  runSteps,
};
