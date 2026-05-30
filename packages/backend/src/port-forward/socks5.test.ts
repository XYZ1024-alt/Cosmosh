import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type net from 'node:net';
import test from 'node:test';

import { handleSocks5Greeting, parseSocks5ConnectRequest, writeSocks5Response } from './socks5.js';

type MockSocket = EventEmitter & {
  writes: Buffer[];
  write: (chunk: Buffer) => boolean;
};

/**
 * Creates a socket-like object for pure SOCKS parser tests.
 *
 * @returns Mock socket collecting writes.
 */
const createMockSocket = (): MockSocket => {
  const socket = new EventEmitter() as MockSocket;
  socket.writes = [];
  socket.write = (chunk: Buffer): boolean => {
    socket.writes.push(chunk);
    return true;
  };
  return socket;
};

test('handleSocks5Greeting selects no-auth and returns remaining bytes', () => {
  const socket = createMockSocket();
  const remaining = handleSocks5Greeting(socket as unknown as net.Socket, Buffer.from([0x05, 0x01, 0x00, 0xaa]));

  assert.deepEqual(socket.writes, [Buffer.from([0x05, 0x00])]);
  assert.deepEqual(remaining, Buffer.from([0xaa]));
});

test('handleSocks5Greeting rejects unsupported auth methods', () => {
  const socket = createMockSocket();
  const remaining = handleSocks5Greeting(socket as unknown as net.Socket, Buffer.from([0x05, 0x01, 0x02]));

  assert.equal(remaining, null);
  assert.deepEqual(socket.writes, [Buffer.from([0x05, 0xff])]);
});

test('parseSocks5ConnectRequest parses IPv4 CONNECT target', () => {
  const parsed = parseSocks5ConnectRequest(Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90]));

  assert.deepEqual(parsed, {
    type: 'connect',
    host: '127.0.0.1',
    port: 8080,
    consumedBytes: 10,
  });
});

test('parseSocks5ConnectRequest parses domain CONNECT target', () => {
  const domain = Buffer.from('example.test');
  const parsed = parseSocks5ConnectRequest(
    Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, domain.length]), domain, Buffer.from([0x01, 0xbb])]),
  );

  assert.deepEqual(parsed, {
    type: 'connect',
    host: 'example.test',
    port: 443,
    consumedBytes: 7 + domain.length,
  });
});

test('parseSocks5ConnectRequest parses IPv6 CONNECT target', () => {
  const parsed = parseSocks5ConnectRequest(Buffer.from('0501000420010db80000000000000000000000010050', 'hex'));

  assert.deepEqual(parsed, {
    type: 'connect',
    host: '2001:db8:0:0:0:0:0:1',
    port: 80,
    consumedBytes: 22,
  });
});

test('parseSocks5ConnectRequest rejects unsupported commands', () => {
  const parsed = parseSocks5ConnectRequest(Buffer.from([0x05, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90]));

  assert.deepEqual(parsed, {
    type: 'unsupported',
    code: 0x07,
    consumedBytes: 10,
  });
});

test('parseSocks5ConnectRequest waits for incomplete frames', () => {
  assert.deepEqual(parseSocks5ConnectRequest(Buffer.from([0x05, 0x01, 0x00])), {
    type: 'need-more-data',
  });
});

test('writeSocks5Response writes IPv4 zero bind response', () => {
  const socket = createMockSocket();

  writeSocks5Response(socket as unknown as net.Socket, 0x05);

  assert.deepEqual(socket.writes, [Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])]);
});
