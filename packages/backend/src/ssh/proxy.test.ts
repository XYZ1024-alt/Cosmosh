import assert from 'node:assert/strict';
import net from 'node:net';
import { afterEach, test } from 'node:test';

import {
  DEFAULT_SETTINGS_VALUES,
  normalizeSettingsValuesStrict,
  normalizeSettingsValuesWithDefaults,
  validateProxyUrl,
} from '@cosmosh/api-contract';
import type { PrismaClient } from '@prisma/client';

import { parseSystemProxyRules, prepareSshProxyTransport, resolveEffectiveProxyPolicy } from './proxy.js';

const openServers = new Set<net.Server>();

/**
 * Starts a local TCP server on an ephemeral loopback port.
 *
 * @param listener Connection listener.
 * @returns Server and assigned port.
 */
const listen = async (listener: (socket: net.Socket) => void): Promise<{ server: net.Server; port: number }> => {
  const server = net.createServer(listener);
  openServers.add(server);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    server,
    port: address.port,
  };
};

/**
 * Creates the minimal Prisma client shape used by proxy policy resolution.
 *
 * @param mode Global proxy mode.
 * @param proxyUrl Global proxy URL.
 * @returns Prisma-compatible test double.
 */
const createDbStub = (mode = 'system', proxyUrl = ''): PrismaClient => {
  return {
    appSettings: {
      findUnique: async () => ({
        payloadJson: JSON.stringify({
          serverProxyMode: mode,
          serverProxyUrl: proxyUrl,
        }),
      }),
    },
  } as unknown as PrismaClient;
};

afterEach(async () => {
  const servers = [...openServers];
  openServers.clear();
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

test('system proxy rules preserve supported candidate order and explicit DIRECT', () => {
  assert.deepEqual(
    parseSystemProxyRules('PROXY proxy.local:8080; HTTPS secure.local:8443; SOCKS5 socks.local:1080; DIRECT'),
    [
      { type: 'http', host: 'proxy.local', port: 8080 },
      { type: 'https', host: 'secure.local', port: 8443 },
      { type: 'socks5', host: 'socks.local', port: 1080 },
      { type: 'direct' },
    ],
  );
});

test('per-server proxy modes apply the complete global precedence matrix', () => {
  const globalModes = ['off', 'system', 'custom'] as const;

  for (const globalMode of globalModes) {
    assert.deepEqual(
      resolveEffectiveProxyPolicy('default', null, globalMode, 'http://global.proxy:8080'),
      globalMode === 'custom'
        ? { mode: 'custom', proxyUrl: 'http://global.proxy:8080' }
        : { mode: globalMode, proxyUrl: undefined },
    );
    assert.deepEqual(resolveEffectiveProxyPolicy('off', null, globalMode, 'http://global.proxy:8080'), {
      mode: 'off',
    });
    assert.deepEqual(
      resolveEffectiveProxyPolicy('custom', 'socks5://server.proxy:1080', globalMode, 'http://global.proxy:8080'),
      {
        mode: 'custom',
        proxyUrl: 'socks5://server.proxy:1080',
      },
    );
  }
});

test('proxy URL validation accepts supported protocols and rejects path data', () => {
  assert.equal(validateProxyUrl('https://user:pass@proxy.example.test:8443').valid, true);
  assert.equal(validateProxyUrl('socks5://127.0.0.1:1080').valid, true);
  assert.deepEqual(validateProxyUrl('http://proxy.example.test:8080/path'), {
    valid: false,
    reason: 'invalid-path',
  });
});

test('global custom proxy settings require a valid proxy URL', () => {
  const parsed = normalizeSettingsValuesStrict({
    ...DEFAULT_SETTINGS_VALUES,
    serverProxyMode: 'custom',
    serverProxyUrl: '',
  });

  assert.equal(parsed.value, undefined);
  assert.equal(parsed.error?.i18nKey, 'settings.validation.proxyUrlInvalid');
});

test('legacy settings snapshots inherit the system proxy default', () => {
  const normalized = normalizeSettingsValuesWithDefaults({});
  assert.equal(normalized.serverProxyMode, 'system');
  assert.equal(normalized.serverProxyUrl, '');
});

test('custom HTTP proxy sends Basic authentication without exposing credentials in metadata', async () => {
  let receivedHeader = '';
  const { port } = await listen((socket) => {
    socket.once('data', (chunk) => {
      receivedHeader = chunk.toString('latin1');
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    });
  });

  const transport = await prepareSshProxyTransport(
    createDbStub(),
    {
      host: 'ssh.example.test',
      port: 22,
      proxyMode: 'custom',
      proxyUrl: `http://alice:secret@127.0.0.1:${port}`,
    },
    undefined,
    2_000,
  );

  assert.equal(transport.metadata.mode, 'custom');
  assert.equal(transport.metadata.protocol, 'http');
  assert.match(receivedHeader, /CONNECT ssh\.example\.test:22 HTTP\/1\.1/);
  assert.match(receivedHeader, /Proxy-Authorization: Basic YWxpY2U6c2VjcmV0/);
  transport.socket?.destroy();
});

test('system DIRECT opens a direct socket only when Chromium explicitly returns DIRECT', async () => {
  const { port } = await listen(() => undefined);
  const transport = await prepareSshProxyTransport(
    createDbStub('system'),
    {
      host: '127.0.0.1',
      port,
      proxyMode: 'default',
      proxyUrl: null,
    },
    'DIRECT',
    2_000,
  );

  assert.equal(transport.metadata.mode, 'system');
  assert.equal(transport.metadata.protocol, 'direct');
  transport.socket?.destroy();
});

test('custom SOCKS5 proxy establishes a tunnel', async () => {
  const { port } = await listen((socket) => {
    let stage: 'greeting' | 'connect' = 'greeting';
    socket.on('data', (chunk) => {
      if (stage === 'greeting') {
        assert.equal(chunk[0], 0x05);
        socket.write(Buffer.from([0x05, 0x00]));
        stage = 'connect';
        return;
      }

      assert.equal(chunk[0], 0x05);
      assert.equal(chunk[1], 0x01);
      socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 22]));
    });
  });

  const transport = await prepareSshProxyTransport(
    createDbStub(),
    {
      host: 'ssh.example.test',
      port: 22,
      proxyMode: 'custom',
      proxyUrl: `socks5://127.0.0.1:${port}`,
    },
    undefined,
    2_000,
  );

  assert.equal(transport.metadata.protocol, 'socks5');
  transport.socket?.destroy();
});

test('system mode does not silently connect directly without a DIRECT candidate', async () => {
  await assert.rejects(
    prepareSshProxyTransport(
      createDbStub('system'),
      {
        host: '127.0.0.1',
        port: 22,
        proxyMode: 'default',
        proxyUrl: null,
      },
      'PROXY 127.0.0.1:1',
      250,
    ),
    /Proxy connection failed/,
  );
});
