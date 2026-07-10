import assert from 'node:assert/strict';
import test from 'node:test';

import { REMOTE_SHELL_EVENT_OSC_PAYLOAD_MAX_BYTES, RemoteShellEventOscParser } from './remote-shell-events.js';

const ESCAPE = '\u001b';
const BELL = '\u0007';
const RUNTIME_CONTRACT = {
  helperVersion: '1.2.3',
  protocolVersion: 1,
  capabilities: ['cwd', 'command-start', 'command-end', 'foreground-command', 'prompt-ready'],
};

/**
 * Encodes one remote shell event payload in the OSC 777 transport format.
 *
 * @param value Event payload object without the WebSocket message wrapper.
 * @returns OSC control sequence.
 */
const encodeCosmoshOsc = (value: Record<string, unknown>): string => {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `${ESCAPE}]777;cosmosh;${encoded}${BELL}`;
};

test('parser strips one or more Cosmosh OSC events from visible output', () => {
  const parser = new RemoteShellEventOscParser();
  const firstEvent = {
    ...RUNTIME_CONTRACT,
    event: 'cwd',
    shell: 'zsh',
    cwd: '/tmp',
    timestamp: 1_717_000_000_000,
  };
  const secondEvent = {
    ...RUNTIME_CONTRACT,
    event: 'command-end',
    shell: 'zsh',
    command: 'false',
    exitCode: 1,
    durationMs: 42,
    commandId: 'cmd-1',
    timestamp: 1_717_000_000_100,
  };

  const result = parser.parse(`before${encodeCosmoshOsc(firstEvent)} middle ${encodeCosmoshOsc(secondEvent)}after`);

  assert.equal(result.output, 'before middle after');
  assert.deepEqual(result.events, [
    {
      type: 'remote-shell-event',
      ...firstEvent,
    },
    {
      type: 'remote-shell-event',
      ...secondEvent,
    },
  ]);
});

test('parser preserves non-Cosmosh OSC sequences and normal ANSI text', () => {
  const parser = new RemoteShellEventOscParser();
  const nonCosmoshOsc = `${ESCAPE}]0;window title${BELL}`;
  const result = parser.parse(`plain ${ESCAPE}[31mred${ESCAPE}[0m ${nonCosmoshOsc} tail`);

  assert.equal(result.output, `plain ${ESCAPE}[31mred${ESCAPE}[0m ${nonCosmoshOsc} tail`);
  assert.deepEqual(result.events, []);
});

test('parser decodes Cosmosh OSC split across chunks', () => {
  const parser = new RemoteShellEventOscParser();
  const sequence = encodeCosmoshOsc({
    ...RUNTIME_CONTRACT,
    event: 'prompt-ready',
    shell: 'bash',
    cwd: '/home/dev',
    timestamp: 1_717_000_000_000,
  });
  const first = parser.parse(`left${sequence.slice(0, 16)}`);
  const second = parser.parse(`${sequence.slice(16)}right`);

  assert.equal(first.output, 'left');
  assert.deepEqual(first.events, []);
  assert.equal(second.output, 'right');
  assert.deepEqual(second.events, [
    {
      type: 'remote-shell-event',
      ...RUNTIME_CONTRACT,
      event: 'prompt-ready',
      shell: 'bash',
      cwd: '/home/dev',
      timestamp: 1_717_000_000_000,
    },
  ]);
});

test('parser drops invalid Cosmosh JSON without affecting surrounding output', () => {
  const parser = new RemoteShellEventOscParser();
  const invalidPayload = Buffer.from('{bad json', 'utf8').toString('base64');
  const result = parser.parse(`before${ESCAPE}]777;cosmosh;${invalidPayload}${BELL}after`);

  assert.equal(result.output, 'beforeafter');
  assert.deepEqual(result.events, []);
});

test('parser drops legacy helper events without a runtime contract', () => {
  const parser = new RemoteShellEventOscParser();
  const result = parser.parse(
    encodeCosmoshOsc({
      event: 'cwd',
      shell: 'bash',
      cwd: '/legacy',
      timestamp: 1_717_000_000_000,
    }),
  );

  assert.equal(result.output, '');
  assert.deepEqual(result.events, []);
});

test('parser drops oversized Cosmosh payloads until sequence terminator', () => {
  const parser = new RemoteShellEventOscParser();
  const oversizedPayload = 'x'.repeat(REMOTE_SHELL_EVENT_OSC_PAYLOAD_MAX_BYTES + 1);
  const result = parser.parse(`before${ESCAPE}]777;cosmosh;${oversizedPayload}${BELL}after`);

  assert.equal(result.output, 'beforeafter');
  assert.deepEqual(result.events, []);
});

test('parser can flush an incomplete nonterminated sequence as visible output on teardown', () => {
  const parser = new RemoteShellEventOscParser();
  const result = parser.parse(`before${ESCAPE}]0;title`);

  assert.equal(result.output, 'before');
  assert.deepEqual(result.events, []);
  assert.equal(parser.flush(), `${ESCAPE}]0;title`);
});
