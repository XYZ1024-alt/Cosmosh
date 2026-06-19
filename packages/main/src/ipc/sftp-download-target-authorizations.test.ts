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

test('revoking an owner removes all of its SFTP download targets', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const authorizedPath = registry.authorize(30, path.join('temporary', 'preview.txt'), {
    reusable: true,
  });

  registry.revokeOwner(30);

  assert.throws(() => registry.consume(30, authorizedPath), /not authorized/);
});
