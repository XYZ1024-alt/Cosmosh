import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePortForwardRulePayload } from './validation.js';

test('parsePortForwardRulePayload normalizes local forwarding payloads', () => {
  const parsed = parsePortForwardRulePayload({
    name: 'Local web',
    serverId: 'srv_1',
    type: 'local',
    localBindPort: '8080',
    targetHost: '127.0.0.1',
    targetPort: '80',
  });

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value?.localBindHost, '127.0.0.1');
  assert.equal(parsed.value?.localBindPort, 8080);
  assert.equal(parsed.value?.targetHost, '127.0.0.1');
  assert.equal(parsed.value?.targetPort, 80);
});

test('parsePortForwardRulePayload normalizes remote forwarding payloads', () => {
  const parsed = parsePortForwardRulePayload({
    name: 'Remote callback',
    serverId: 'srv_1',
    type: 'remote',
    remoteBindHost: '0.0.0.0',
    remoteBindPort: 9000,
    targetHost: '127.0.0.1',
    targetPort: 3000,
  });

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value?.remoteBindHost, '0.0.0.0');
  assert.equal(parsed.value?.remoteBindPort, 9000);
  assert.equal(parsed.value?.localBindHost, undefined);
  assert.equal(parsed.value?.localBindPort, undefined);
});

test('parsePortForwardRulePayload normalizes dynamic SOCKS payloads without target fields', () => {
  const parsed = parsePortForwardRulePayload({
    name: 'SOCKS',
    serverId: 'srv_1',
    type: 'dynamic',
    localBindHost: 'localhost',
    localBindPort: 1080,
    targetHost: 'ignored.example',
    targetPort: 443,
  });

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value?.localBindHost, 'localhost');
  assert.equal(parsed.value?.localBindPort, 1080);
  assert.equal(parsed.value?.targetHost, undefined);
  assert.equal(parsed.value?.targetPort, undefined);
});

test('parsePortForwardRulePayload rejects out-of-range ports', () => {
  const parsed = parsePortForwardRulePayload({
    name: 'Invalid',
    serverId: 'srv_1',
    type: 'local',
    localBindPort: 0,
    targetHost: '127.0.0.1',
    targetPort: 80,
  });

  assert.equal(parsed.value, undefined);
  assert.equal(parsed.error?.i18nKey, 'errors.validation.portRange');
});

test('parsePortForwardRulePayload rejects overlong host fields', () => {
  const parsed = parsePortForwardRulePayload({
    name: 'Invalid',
    serverId: 'srv_1',
    type: 'local',
    localBindPort: 8080,
    targetHost: 'a'.repeat(256),
    targetPort: 80,
  });

  assert.equal(parsed.value, undefined);
  assert.equal(parsed.error?.i18nKey, 'errors.validation.hostLength');
});
