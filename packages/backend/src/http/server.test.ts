import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { Hono } from 'hono';

import type { BackendHttpEnv } from './i18n.js';
import { BACKEND_BIND_HOST, startBackendHttpServer } from './server.js';

test('startBackendHttpServer binds only to the IPv4 loopback interface', async () => {
  const app = new Hono<BackendHttpEnv>();
  app.get('/health', (context) => context.json({ status: 'ok' }));

  const server = startBackendHttpServer(app, 0);

  try {
    if (!server.listening) {
      await once(server, 'listening');
    }

    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    assert.equal(address.address, BACKEND_BIND_HOST);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});
