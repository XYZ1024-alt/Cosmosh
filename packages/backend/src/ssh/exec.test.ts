import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { Client, ClientChannel } from 'ssh2';

import { executeBoundedSshCommand } from './exec.js';

type FakeChannel = EventEmitter & {
  close: () => void;
};

/**
 * Creates a minimal ssh2 channel test double.
 *
 * @returns Channel and close-state accessor.
 */
const createFakeChannel = (): { channel: FakeChannel; wasClosed: () => boolean } => {
  let closed = false;
  const channel = new EventEmitter() as FakeChannel;
  channel.close = () => {
    closed = true;
    channel.emit('close');
  };

  return {
    channel,
    wasClosed: () => closed,
  };
};

test('executeBoundedSshCommand returns stdout when the channel closes', async () => {
  const { channel } = createFakeChannel();
  const client = {
    exec: (_command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
      callback(undefined, channel as unknown as ClientChannel);
      channel.emit('data', Buffer.from('hello'));
      channel.emit('close');
    },
  } as unknown as Client;

  assert.equal(await executeBoundedSshCommand(client, 'printf hello'), 'hello');
});

test('executeBoundedSshCommand closes channels that exceed the output budget', async () => {
  const { channel, wasClosed } = createFakeChannel();
  const client = {
    exec: (_command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
      callback(undefined, channel as unknown as ClientChannel);
      channel.emit('data', Buffer.from('oversized'));
    },
  } as unknown as Client;

  assert.equal(await executeBoundedSshCommand(client, 'cat large-file', { maxOutputBytes: 4 }), null);
  assert.equal(wasClosed(), true);
});

test('executeBoundedSshCommand times out stalled exec callbacks', async () => {
  const client = {
    exec: () => undefined,
  } as unknown as Client;

  assert.equal(await executeBoundedSshCommand(client, 'sleep forever', { timeoutMs: 5 }), null);
});

test('executeBoundedSshCommand closes the active channel when its shared budget is aborted', async () => {
  const abortController = new AbortController();
  const { channel, wasClosed } = createFakeChannel();
  const client = {
    exec: (_command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
      callback(undefined, channel as unknown as ClientChannel);
    },
  } as unknown as Client;

  const resultPromise = executeBoundedSshCommand(client, 'sleep forever', {
    timeoutMs: 60_000,
    signal: abortController.signal,
  });
  abortController.abort();

  assert.equal(await resultPromise, null);
  assert.equal(wasClosed(), true);
});
