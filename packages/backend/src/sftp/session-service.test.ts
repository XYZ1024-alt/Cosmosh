import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeSftpShellPath,
  formatSftpPermissionOctal,
  formatSftpPermissions,
  joinSftpPath,
  normalizeSftpPathInput,
  resolveSftpEntryHiddenState,
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

test('resolveSftpEntryHiddenState detects dot-prefixed entries', () => {
  assert.equal(resolveSftpEntryHiddenState('.env', { mode: 0o100644 } as never), true);
  assert.equal(resolveSftpEntryHiddenState('.config', { mode: 0o040755 } as never), true);
  assert.equal(resolveSftpEntryHiddenState('visible.txt', { mode: 0o100644 } as never), false);
});

test('resolveSftpEntryHiddenState detects server-provided extended hidden markers', () => {
  assert.equal(
    resolveSftpEntryHiddenState('server-hidden.txt', {
      mode: 0o100644,
      extended: {
        'is-hidden': Buffer.from('true'),
      },
    } as never),
    true,
  );
  assert.equal(
    resolveSftpEntryHiddenState('server-visible.txt', {
      mode: 0o100644,
      extended: {
        hidden: 'false',
      },
    } as never),
    false,
  );
});

test('formatSftpPermissions returns symbolic permissions', () => {
  assert.equal(formatSftpPermissions(0o040755), 'drwxr-xr-x');
  assert.equal(formatSftpPermissions(0o100640), '-rw-r-----');
  assert.equal(formatSftpPermissions(0o120777), 'lrwxrwxrwx');
});

test('formatSftpPermissionOctal returns chmod-ready octal permissions', () => {
  assert.equal(formatSftpPermissionOctal(0o100644), '0644');
  assert.equal(formatSftpPermissionOctal(0o040755), '0755');
  assert.equal(formatSftpPermissionOctal(0o041755), '1755');
});

test('escapeSftpShellPath returns single-quoted shell tokens', () => {
  assert.equal(escapeSftpShellPath('/var/www/current'), "'/var/www/current'");
  assert.equal(escapeSftpShellPath("/tmp/it's here"), "'/tmp/it'\\''s here'");
});
