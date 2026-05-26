import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSftpDirectoryPathFromSelection } from './ssh-utils';

test('selection directory resolver accepts explicit remote paths', () => {
  assert.equal(resolveSftpDirectoryPathFromSelection('/'), '/');
  assert.equal(resolveSftpDirectoryPathFromSelection('/var/www/'), '/var/www');
  assert.equal(resolveSftpDirectoryPathFromSelection("'~/projects/site'"), '~/projects/site');
  assert.equal(resolveSftpDirectoryPathFromSelection('./logs,'), './logs');
  assert.equal(resolveSftpDirectoryPathFromSelection('file:///opt/app/current'), '/opt/app/current');
  assert.equal(resolveSftpDirectoryPathFromSelection('file:///tmp/%broken'), '/tmp/%broken');
});

test('selection directory resolver rejects ambiguous or unsafe values', () => {
  assert.equal(resolveSftpDirectoryPathFromSelection('var/www'), null);
  assert.equal(resolveSftpDirectoryPathFromSelection('https://example.com/path'), null);
  assert.equal(resolveSftpDirectoryPathFromSelection(''), null);
});
