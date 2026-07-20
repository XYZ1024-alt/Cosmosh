import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { SftpDownloadTargetAuthorizationRegistry } from './sftp-download-target-authorizations';

test('single-use SFTP download targets are owner-bound and consumed once', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const authorizedPath = registry.authorize(10, path.join('downloads', 'report.txt'), {
    reusable: false,
  });

  assert.throws(() => registry.consume(11, authorizedPath), /not authorized/);
  assert.equal(registry.consume(10, authorizedPath), authorizedPath);
  assert.throws(() => registry.consume(10, authorizedPath), /not authorized/);
});

test('reusable SFTP download targets remain available to their owner', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const authorizedPath = registry.authorize(20, path.join('temporary', 'preview.png'), {
    reusable: true,
  });

  assert.equal(registry.consume(20, authorizedPath), authorizedPath);
  assert.equal(registry.consume(20, authorizedPath), authorizedPath);
});

test('single-use SFTP download targets permit one owner-bound transfer retry', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const transferId = 'f57aa040-3138-4bf5-b329-ec4c9242fbb8';
  const authorizedPath = registry.authorize(25, path.join('downloads', 'archive.bin'), {
    reusable: false,
  });

  assert.equal(registry.consumeForTransfer(25, authorizedPath, transferId), authorizedPath);
  assert.throws(() => registry.consumeForTransfer(25, authorizedPath, transferId), /not authorized/);
  assert.throws(() => registry.consumeForTransfer(26, authorizedPath, transferId), /not authorized/);
  registry.allowTransferRetry(25, transferId);
  assert.equal(registry.consumeForTransfer(25, authorizedPath, transferId), authorizedPath);
  assert.throws(() => registry.consumeForTransfer(25, authorizedPath, transferId), /not authorized/);
});

test('completed SFTP download transfers revoke unused retry authorization', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const transferId = '7e33e12b-b1c8-46c6-9e6f-ff8c02ab7d8d';
  const authorizedPath = registry.authorize(27, path.join('downloads', 'report.csv'), {
    reusable: false,
  });

  assert.equal(registry.consumeForTransfer(27, authorizedPath, transferId), authorizedPath);
  registry.completeTransfer(27, transferId);
  assert.throws(() => registry.consumeForTransfer(27, authorizedPath, transferId), /not authorized/);
});

test('revoking an owner removes all of its SFTP download targets', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const authorizedPath = registry.authorize(30, path.join('temporary', 'preview.txt'), {
    reusable: true,
  });

  registry.revokeOwner(30);

  assert.throws(() => registry.consume(30, authorizedPath), /not authorized/);
});
