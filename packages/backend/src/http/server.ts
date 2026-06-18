import { serve } from '@hono/node-server';

import type { BackendHttpApp } from './i18n.js';

export const BACKEND_BIND_HOST = '127.0.0.1';

/**
 * Starts the backend HTTP server on the IPv4 loopback interface.
 *
 * Binding explicitly is a security boundary because standalone development mode
 * does not require the Electron internal token.
 *
 * @param app Composed backend Hono application.
 * @param port TCP port selected by the backend bootstrap.
 * @returns Node HTTP server instance.
 */
export const startBackendHttpServer = (app: BackendHttpApp, port: number): ReturnType<typeof serve> => {
  return serve({
    fetch: app.fetch,
    hostname: BACKEND_BIND_HOST,
    port,
  });
};
