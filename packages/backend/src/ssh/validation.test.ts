import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCreateServerRequest, parseCreateSessionRequest, parseUpdateServerRequest } from './validation.js';

test('strictHostKey validates and flows through server/session payload parsing', () => {
  const createServer = parseCreateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'secret',
    strictHostKey: false,
  });

  assert.equal(createServer.value?.strictHostKey, false);

  const updateServer = parseUpdateServerRequest({
    name: 'Server',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    strictHostKey: true,
  });

  assert.equal(updateServer.value?.strictHostKey, true);

  const createSession = parseCreateSessionRequest({
    serverId: 'srv-1',
    cols: 120,
    rows: 30,
    strictHostKey: false,
  });

  assert.equal(createSession.value?.strictHostKey, false);
});

test('strictHostKey rejects non-boolean payload values', () => {
  const parsed = parseCreateSessionRequest({
    serverId: 'srv-1',
    strictHostKey: 'false',
  });

  assert.equal(parsed.value, undefined);
  assert.ok(parsed.error);
});
