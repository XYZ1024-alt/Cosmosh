import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatSftpPermissions,
  joinSftpPath,
  normalizeSftpPathInput,
  resolveSftpEntryType,
} from './session-service.js';

test('normalizeSftpPathInput keeps SFTP paths POSIX-oriented', () => {
  assert.equal(normalizeSftpPathInput(undefined), '.');
  assert.equal(normalizeSftpPathInput(''), '.');
  assert.equal(normalizeSftpPathInput(' /var/www/../log '), '/var/log');
  assert.equal(normalizeSftpPathInput('C:\\tmp\\site'), 'C:/tmp/site');
});

test('joinSftpPath builds stable remote child paths', () => {
  assert.equal(joinSftpPath('/', 'etc'), '/etc');
  assert.equal(joinSftpPath('/var/www', 'index.html'), '/var/www/index.html');
  assert.equal(joinSftpPath('.', 'relative'), 'relative');
});

test('resolveSftpEntryType maps POSIX file bits', () => {
  assert.equal(resolveSftpEntryType(0o040755), 'directory');
  assert.equal(resolveSftpEntryType(0o100644), 'file');
  assert.equal(resolveSftpEntryType(0o120777), 'symlink');
  assert.equal(resolveSftpEntryType(0o010000), 'other');
});

test('formatSftpPermissions returns symbolic permissions', () => {
  assert.equal(formatSftpPermissions(0o040755), 'drwxr-xr-x');
  assert.equal(formatSftpPermissions(0o100640), '-rw-r-----');
  assert.equal(formatSftpPermissions(0o120777), 'lrwxrwxrwx');
});
