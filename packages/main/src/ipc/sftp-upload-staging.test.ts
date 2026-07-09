import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanupStagedSftpUploadFiles,
  type SftpUploadStagingOptions,
  SftpUploadStagingRejectionError,
  stageDroppedSftpUploadLocalEntries,
  stageSftpUploadLocalFile,
} from './sftp-upload-staging';

/**
 * Creates an isolated temp root for SFTP upload staging tests.
 *
 * @returns Temp root path plus cleanup callback.
 */
const createTemporaryRoot = async (): Promise<{ cleanup: () => Promise<void>; rootPath: string }> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-sftp-upload-staging-test-'));
  return {
    rootPath,
    cleanup: async () => {
      await fs.rm(rootPath, { force: true, recursive: true });
    },
  };
};

/**
 * Creates staging options backed by one test temp root.
 *
 * @param rootPath Test temp root.
 * @param stagedUploadPaths Shared allowlist set.
 * @returns Staging options.
 */
const createStagingOptions = (rootPath: string, stagedUploadPaths: Set<string>): SftpUploadStagingOptions => {
  let counter = 0;

  return {
    stagedUploadPaths,
    createTemporaryFilePath: async (fileName: string): Promise<string> => {
      counter += 1;
      const stagingDirectoryPath = path.join(rootPath, `staged-${counter}`);
      await fs.mkdir(stagingDirectoryPath, { recursive: true });
      return path.join(stagingDirectoryPath, fileName);
    },
  };
};

/**
 * Checks whether one path is inside another path.
 *
 * @param candidatePath Candidate child path.
 * @param parentPath Expected parent path.
 * @returns Whether the candidate is inside the parent.
 */
const isPathInsideDirectory = (candidatePath: string, parentPath: string): boolean => {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === '' || (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
};

/**
 * Resolves a candidate path under one test temp root.
 *
 * @param rootPath Test temp root.
 * @param candidatePath Candidate local path.
 * @returns Normalized candidate path.
 */
const resolveTemporaryCandidatePath = async (rootPath: string, candidatePath: string | undefined): Promise<string> => {
  if (!candidatePath) {
    throw new Error('Invalid path.');
  }

  const normalizedPath = path.resolve(candidatePath);
  if (!isPathInsideDirectory(normalizedPath, path.resolve(rootPath))) {
    throw new Error('Invalid path.');
  }

  return normalizedPath;
};

test('SFTP upload staging copies regular files into the controlled temp root', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const stagedUploadPaths = new Set<string>();
  const sourcePath = path.join(temporaryRoot.rootPath, 'source.txt');
  await fs.writeFile(sourcePath, 'hello', 'utf8');

  try {
    const result = await stageSftpUploadLocalFile(
      sourcePath,
      createStagingOptions(temporaryRoot.rootPath, stagedUploadPaths),
    );

    assert.equal(result.name, 'source.txt');
    assert.equal(await fs.readFile(result.localPath, 'utf8'), 'hello');
    assert.equal(stagedUploadPaths.has(path.resolve(result.localPath)), true);
  } finally {
    await temporaryRoot.cleanup();
  }
});

test('SFTP upload staging rejects directories and unreadable paths', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const stagedUploadPaths = new Set<string>();
  const directoryPath = path.join(temporaryRoot.rootPath, 'folder');
  await fs.mkdir(directoryPath);

  try {
    await assert.rejects(
      () => stageSftpUploadLocalFile(directoryPath, createStagingOptions(temporaryRoot.rootPath, stagedUploadPaths)),
      (error: unknown) =>
        error instanceof SftpUploadStagingRejectionError && error.entry.reason === 'directory-unsupported',
    );
    await assert.rejects(
      () =>
        stageSftpUploadLocalFile(
          path.join(temporaryRoot.rootPath, 'missing.txt'),
          createStagingOptions(temporaryRoot.rootPath, stagedUploadPaths),
        ),
      (error: unknown) => error instanceof SftpUploadStagingRejectionError && error.entry.reason === 'unreadable',
    );
  } finally {
    await temporaryRoot.cleanup();
  }
});

test('SFTP dropped upload staging keeps regular files while reporting rejected entries', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const stagedUploadPaths = new Set<string>();
  const sourcePath = path.join(temporaryRoot.rootPath, 'source.txt');
  const directoryPath = path.join(temporaryRoot.rootPath, 'folder');
  await fs.writeFile(sourcePath, 'hello', 'utf8');
  await fs.mkdir(directoryPath);

  try {
    const result = await stageDroppedSftpUploadLocalEntries(
      [
        { name: 'source.txt', localPath: sourcePath },
        { name: 'folder', localPath: directoryPath },
        { name: 'unknown.bin' },
      ],
      createStagingOptions(temporaryRoot.rootPath, stagedUploadPaths),
    );

    assert.equal(result.canceled, false);
    assert.equal(result.files.length, 1);
    assert.deepEqual(
      result.rejectedEntries?.map((entry) => entry.reason),
      ['directory-unsupported', 'path-unavailable'],
    );
  } finally {
    await temporaryRoot.cleanup();
  }
});

test('SFTP upload cleanup deletes only allow-listed staged files', async () => {
  const temporaryRoot = await createTemporaryRoot();
  const stagedUploadPaths = new Set<string>();
  const stagedDirectoryPath = path.join(temporaryRoot.rootPath, 'staged');
  const unstagedDirectoryPath = path.join(temporaryRoot.rootPath, 'unstaged');
  await fs.mkdir(stagedDirectoryPath, { recursive: true });
  await fs.mkdir(unstagedDirectoryPath, { recursive: true });
  const stagedPath = path.join(stagedDirectoryPath, 'file.txt');
  const unstagedPath = path.join(unstagedDirectoryPath, 'file.txt');
  await fs.writeFile(stagedPath, 'staged', 'utf8');
  await fs.writeFile(unstagedPath, 'unstaged', 'utf8');
  stagedUploadPaths.add(path.resolve(stagedPath));

  try {
    await cleanupStagedSftpUploadFiles([stagedPath, unstagedPath], {
      resolveTemporaryCandidatePath: (candidatePath) =>
        resolveTemporaryCandidatePath(temporaryRoot.rootPath, candidatePath),
      stagedUploadPaths,
      temporaryRootPath: temporaryRoot.rootPath,
      isPathInsideDirectory,
    });

    await assert.rejects(() => fs.stat(stagedPath));
    assert.equal(await fs.readFile(unstagedPath, 'utf8'), 'unstaged');
    assert.equal(stagedUploadPaths.size, 0);
  } finally {
    await temporaryRoot.cleanup();
  }
});
