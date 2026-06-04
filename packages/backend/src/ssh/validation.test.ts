import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCreateServerRequest, parseCreateSessionRequest, parseUpdateServerRequest } from './validation.js';

test('server transport booleans validate and flow through payload parsing', () => {
  const createServer = parseCreateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
    strictHostKey: false,
    enableSshCompression: true,
    disableCharacterWidthCompatibilityMode: true,
    terminalClipboardAccess: 'writeAskRead',
  });

  assert.equal(createServer.value?.strictHostKey, false);
  assert.equal(createServer.value?.enableSshCompression, true);
  assert.equal(createServer.value?.disableCharacterWidthCompatibilityMode, true);
  assert.equal(createServer.value?.terminalClipboardAccess, 'writeAskRead');

  const updateServer = parseUpdateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
    strictHostKey: true,
    enableSshCompression: false,
    disableCharacterWidthCompatibilityMode: false,
    terminalClipboardAccess: 'askAlways',
  });

  assert.equal(updateServer.value?.strictHostKey, true);
  assert.equal(updateServer.value?.enableSshCompression, false);
  assert.equal(updateServer.value?.disableCharacterWidthCompatibilityMode, false);
  assert.equal(updateServer.value?.terminalClipboardAccess, 'askAlways');

  const createSession = parseCreateSessionRequest({
    serverId: 'srv-1',
    cols: 120,
    rows: 30,
    strictHostKey: false,
    enableSshCompression: true,
  });

  assert.equal(createSession.value?.strictHostKey, false);
  assert.equal(createSession.value?.enableSshCompression, true);
});

test('server terminal clipboard access defaults to off', () => {
  const parsed = parseCreateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
  });

  assert.equal(parsed.value?.terminalClipboardAccess, 'off');
});

test('server character width compatibility opt-out defaults to disabled', () => {
  const parsed = parseCreateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
  });

  assert.equal(parsed.value?.disableCharacterWidthCompatibilityMode, false);
});

test('strictHostKey rejects non-boolean payload values', () => {
  const parsed = parseCreateSessionRequest({
    serverId: 'srv-1',
    strictHostKey: 'false',
  });

  assert.equal(parsed.value, undefined);
  assert.ok(parsed.error);
});

test('enableSshCompression rejects non-boolean payload values', () => {
  const parsed = parseCreateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
    enableSshCompression: 'true',
  });

  assert.equal(parsed.value, undefined);
  assert.ok(parsed.error);
});

test('disableCharacterWidthCompatibilityMode rejects non-boolean payload values', () => {
  const parsed = parseCreateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
    disableCharacterWidthCompatibilityMode: 'false',
  });

  assert.equal(parsed.value, undefined);
  assert.ok(parsed.error);
});

test('terminalClipboardAccess rejects unsupported payload values', () => {
  const parsed = parseCreateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
    terminalClipboardAccess: 'readOnly',
  });

  assert.equal(parsed.value, undefined);
  assert.ok(parsed.error);
});
