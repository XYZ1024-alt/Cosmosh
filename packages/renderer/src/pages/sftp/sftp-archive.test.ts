import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiSftpEntry } from '@cosmosh/api-contract';

import {
  buildSftpArchiveDefaultStem,
  canExtractSftpEntries,
  detectSftpArchiveFormat,
  getSftpArchiveTaskStageKey,
  normalizeSftpArchiveCompressionLevel,
  stripSftpArchiveExtension,
  suggestAvailableSftpArchiveName,
  switchSftpArchiveExtension,
} from './sftp-archive';

const createEntry = (name: string, type: ApiSftpEntry['type'] = 'file'): ApiSftpEntry => ({
  name,
  path: `/srv/${name}`,
  parentPath: '/srv',
  type,
  size: 0,
  mode: type === 'directory' ? 0o040755 : 0o100644,
  permissions: type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
  permissionOctal: type === 'directory' ? '0755' : '0644',
  uid: 1000,
  gid: 1000,
  modifiedAt: '2026-07-22T00:00:00.000Z',
  accessedAt: '2026-07-22T00:00:00.000Z',
  extension: '',
  shellEscapedPath: "'/srv/item'",
  isHidden: false,
});

test('detectSftpArchiveFormat recognizes compound aliases', () => {
  assert.equal(detectSftpArchiveFormat('backup.tar.gz'), 'tar-gzip');
  assert.equal(detectSftpArchiveFormat('backup.tgz'), 'tar-gzip');
  assert.equal(detectSftpArchiveFormat('backup.txz'), 'tar-xz');
  assert.equal(detectSftpArchiveFormat('backup.tbz2'), 'tar-bzip2');
});

test('archive extension helpers use locale-invariant case folding', () => {
  const localeSensitiveName = new String('BACKUP.ZIP');
  localeSensitiveName.toLocaleLowerCase = () => 'backup.z\u0131p';

  assert.equal(detectSftpArchiveFormat(localeSensitiveName as unknown as string), 'zip');
  assert.equal(stripSftpArchiveExtension(localeSensitiveName as unknown as string), 'BACKUP');
  assert.equal(switchSftpArchiveExtension(localeSensitiveName as unknown as string, 'tar'), 'BACKUP.tar');
});

test('buildSftpArchiveDefaultStem follows file, directory, and multi-select rules', () => {
  assert.equal(buildSftpArchiveDefaultStem([createEntry('config.prod.json')], '/srv/app'), 'config.prod');
  assert.equal(buildSftpArchiveDefaultStem([createEntry('.env')], '/srv/app'), '.env');
  assert.equal(buildSftpArchiveDefaultStem([createEntry('dist', 'directory')], '/srv/app'), 'dist');
  assert.equal(buildSftpArchiveDefaultStem([createEntry('a'), createEntry('b')], '/srv/app'), 'app');
  assert.equal(buildSftpArchiveDefaultStem([createEntry('a'), createEntry('b')], '/'), 'archive');
});

test('switchSftpArchiveExtension uses standard compound extensions', () => {
  assert.equal(switchSftpArchiveExtension('release.tgz', 'tar-xz'), 'release.tar.xz');
  assert.equal(switchSftpArchiveExtension('release.tar.xz', 'zip'), 'release.zip');
});

test('normalizeSftpArchiveCompressionLevel keeps every format and level combination valid', () => {
  assert.equal(normalizeSftpArchiveCompressionLevel('tar', 'maximum'), 'store');
  assert.equal(normalizeSftpArchiveCompressionLevel('zip', 'store'), 'standard');
  assert.equal(normalizeSftpArchiveCompressionLevel('tar-gzip', 'maximum'), 'maximum');
  assert.equal(normalizeSftpArchiveCompressionLevel('7z', 'fast'), 'fast');
});

test('stripSftpArchiveExtension removes aliases for extraction directory labels', () => {
  assert.equal(stripSftpArchiveExtension('release.tar.gz'), 'release');
  assert.equal(stripSftpArchiveExtension('release.tgz'), 'release');
  assert.equal(stripSftpArchiveExtension('release.zip'), 'release');
});

test('suggestAvailableSftpArchiveName uses numbered collision suffixes', () => {
  const names = new Set(['release.tar.gz', 'release (2).tar.gz']);
  assert.equal(suggestAvailableSftpArchiveName('release.tar.gz', names), 'release (3).tar.gz');
});

test('canExtractSftpEntries requires regular files and supported formats', () => {
  assert.equal(canExtractSftpEntries([createEntry('backup.zip')], ['zip']), true);
  assert.equal(canExtractSftpEntries([createEntry('backup.zip')], ['tar']), false);
  assert.equal(canExtractSftpEntries([createEntry('backup.zip', 'directory')], ['zip']), false);
});

test('getSftpArchiveTaskStageKey preserves cancellation feedback across polling', () => {
  assert.equal(getSftpArchiveTaskStageKey('extracting', false), 'extracting');
  assert.equal(getSftpArchiveTaskStageKey('extracting', true), 'cancelling');
  assert.equal(getSftpArchiveTaskStageKey('verifying', true), 'cancelling');
});
