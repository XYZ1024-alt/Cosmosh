import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPrivateSftpTemporaryDirectory,
  createPrivateSftpTemporaryRoot,
  resolveExistingSftpTemporaryFilePath,
  validateSftpTemporaryRootPath,
} from './sftp-temporary-root';

test('SFTP temporary root helpers create a private canonical temp root', async () => {
  const parentPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-sftp-root-parent-'));

  try {
    const rootPath = await createPrivateSftpTemporaryRoot(parentPath);
    assert.equal(rootPath, await fs.realpath(rootPath));

    const stats = await fs.lstat(rootPath);
    assert.equal(stats.isDirectory(), true);
    assert.equal(stats.isSymbolicLink(), false);
    if (process.platform !== 'win32') {
      assert.equal(stats.mode & 0o077, 0);
    }
  } finally {
    await fs.rm(parentPath, { force: true, recursive: true });
  }
});

test('SFTP temporary root helpers resolve only existing files inside the canonical root', async () => {
  const parentPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-sftp-root-parent-'));

  try {
    const rootPath = await createPrivateSftpTemporaryRoot(parentPath);
    const directoryPath = await createPrivateSftpTemporaryDirectory(rootPath);
    const filePath = path.join(directoryPath, 'file.txt');
    const outsidePath = path.join(parentPath, 'outside.txt');
    await fs.writeFile(filePath, 'inside', 'utf8');
    await fs.writeFile(outsidePath, 'outside', 'utf8');

    assert.equal(await resolveExistingSftpTemporaryFilePath(rootPath, filePath), await fs.realpath(filePath));
    await assert.rejects(() => resolveExistingSftpTemporaryFilePath(rootPath, outsidePath), /Invalid file path/);
  } finally {
    await fs.rm(parentPath, { force: true, recursive: true });
  }
});

test(
  'SFTP temporary root helpers reject symlink roots and symlink files',
  { skip: process.platform === 'win32' ? 'Windows symlink creation requires elevated host policy.' : false },
  async () => {
    const parentPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cosmosh-sftp-root-parent-'));

    try {
      const rootPath = await createPrivateSftpTemporaryRoot(parentPath);
      const rootLinkPath = path.join(parentPath, 'root-link');
      await fs.symlink(rootPath, rootLinkPath, 'dir');
      await assert.rejects(() => validateSftpTemporaryRootPath(rootLinkPath), /real directory/);

      const directoryPath = await createPrivateSftpTemporaryDirectory(rootPath);
      const targetPath = path.join(directoryPath, 'target.txt');
      const linkPath = path.join(directoryPath, 'link.txt');
      await fs.writeFile(targetPath, 'inside', 'utf8');
      await fs.symlink(targetPath, linkPath);

      await assert.rejects(() => resolveExistingSftpTemporaryFilePath(rootPath, linkPath), /Invalid file path/);
    } finally {
      await fs.rm(parentPath, { force: true, recursive: true });
    }
  },
);
