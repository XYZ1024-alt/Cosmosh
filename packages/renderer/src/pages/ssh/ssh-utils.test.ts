import assert from 'node:assert/strict';
import test from 'node:test';

import {
  containsTerminalControlContent,
  createTerminalPasteWarningRequest,
  resolveSftpDirectoryPathFromSelection,
} from './ssh-utils';

const DEFAULT_PASTE_WARNING_SETTINGS = {
  warnOnMultiLinePaste: true,
  warnOnLargePaste: true,
  largePasteWarningThreshold: 8,
  warnOnControlCharactersPaste: true,
};

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

test('paste warning request reports enabled paste safety reasons', () => {
  const request = createTerminalPasteWarningRequest('echo one\necho two', DEFAULT_PASTE_WARNING_SETTINGS);

  assert.ok(request);
  assert.deepEqual(request.reasons, ['multiLine', 'largeText']);
  assert.equal(request.threshold, 8);
  assert.equal(request.characterCount, 17);
  assert.equal(request.preview, 'echo one\necho two');
});

test('paste warning request detects terminal control content', () => {
  assert.equal(containsTerminalControlContent('\u001b[31mred\u001b[0m'), true);
  assert.equal(containsTerminalControlContent('title\u0007'), true);

  const request = createTerminalPasteWarningRequest('printf "\u001b[31m"', {
    ...DEFAULT_PASTE_WARNING_SETTINGS,
    warnOnMultiLinePaste: false,
    warnOnLargePaste: false,
  });

  assert.ok(request);
  assert.deepEqual(request.reasons, ['controlCharacters']);
});

test('paste warning request returns null when no enabled reason matches', () => {
  assert.equal(createTerminalPasteWarningRequest('echo ok', DEFAULT_PASTE_WARNING_SETTINGS), null);
  assert.equal(
    createTerminalPasteWarningRequest('echo one\necho two', {
      ...DEFAULT_PASTE_WARNING_SETTINGS,
      warnOnMultiLinePaste: false,
      warnOnLargePaste: false,
    }),
    null,
  );
});
