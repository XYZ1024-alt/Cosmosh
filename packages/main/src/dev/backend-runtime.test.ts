import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveDevelopmentBackendNodeExecutable } from './backend-runtime';

/**
 * Creates a regular executable fixture for runtime-path validation tests.
 *
 * @param directoryPath Temporary fixture directory.
 * @param fileName Fixture file name.
 * @returns Absolute fixture path.
 */
const createExecutableFixture = async (directoryPath: string, fileName: string): Promise<string> => {
  const executablePath = path.join(directoryPath, fileName);
  await fs.writeFile(executablePath, '', 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(executablePath, 0o700);
  }
  return executablePath;
};

test('development backend runtime resolves a canonical system Node executable', async () => {
  const temporaryDirectoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-backend-runtime-'));

  try {
    const nodeExecutablePath = await createExecutableFixture(temporaryDirectoryPath, 'node-runtime');
    const electronExecutablePath = await createExecutableFixture(temporaryDirectoryPath, 'electron-runtime');

    assert.equal(
      await resolveDevelopmentBackendNodeExecutable(nodeExecutablePath, electronExecutablePath),
      await fs.realpath(nodeExecutablePath),
    );
  } finally {
    await fs.rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
});

test('development backend runtime rejects missing, relative, and non-file paths', async () => {
  const temporaryDirectoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-backend-runtime-'));

  try {
    const electronExecutablePath = await createExecutableFixture(temporaryDirectoryPath, 'electron-runtime');

    await assert.rejects(
      () => resolveDevelopmentBackendNodeExecutable(undefined, electronExecutablePath),
      /Node\.js executable is missing/u,
    );
    await assert.rejects(
      () => resolveDevelopmentBackendNodeExecutable('relative-node', electronExecutablePath),
      /must be an absolute path/u,
    );
    await assert.rejects(
      () => resolveDevelopmentBackendNodeExecutable(temporaryDirectoryPath, electronExecutablePath),
      /must resolve to a regular file/u,
    );
  } finally {
    await fs.rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
});

test('development backend runtime rejects the Electron host executable', async () => {
  const temporaryDirectoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-backend-runtime-'));

  try {
    const electronExecutablePath = await createExecutableFixture(temporaryDirectoryPath, 'electron-runtime');

    await assert.rejects(
      () => resolveDevelopmentBackendNodeExecutable(electronExecutablePath, electronExecutablePath),
      /must differ from the Electron host executable/u,
    );
  } finally {
    await fs.rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
});
