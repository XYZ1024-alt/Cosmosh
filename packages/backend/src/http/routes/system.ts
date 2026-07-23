import {
  API_CAPABILITIES,
  API_CODES,
  API_PATHS,
  type ApiRuntimeActiveConnectionsCloseResponse,
  type ApiRuntimeActiveConnectionsData,
  type ApiRuntimeActiveConnectionsGetResponse,
  type ApiTestPingResponse,
  createApiSuccess,
} from '@cosmosh/api-contract';

import { type BackendHttpApp, getTranslator } from '../i18n.js';
import type { BackendAppContext } from '../types.js';

/**
 * Reads the SSH and SFTP runtime registries without exposing session identifiers.
 *
 * @param context Backend services that own active connection state.
 * @returns Aggregate active connection counts.
 */
const getActiveConnectionCounts = (context: BackendAppContext): ApiRuntimeActiveConnectionsData => {
  const sshCount = context.sshSessionService.getActiveSessionCount();
  const sftpCount = context.sftpSessionService.getActiveSessionCount();

  return {
    sshCount,
    sftpCount,
    totalCount: sshCount + sftpCount,
  };
};

/**
 * Registers public/system routes (root metadata, health, and connectivity test).
 */
export const registerSystemRoutes = (app: BackendHttpApp, context: BackendAppContext): void => {
  app.get('/', (c) => {
    const t = getTranslator(c);

    return c.json({
      message: t('api.rootMessage'),
      version: '0.1.0',
      status: 'running',
    });
  });

  app.get(API_PATHS.health, (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get(API_PATHS.testPing, (c) => {
    const t = getTranslator(c);

    const payload: ApiTestPingResponse = createApiSuccess({
      code: API_CODES.testPingOk,
      message: t('success.system.backendConnectionHealthy'),
      data: {
        service: 'cosmosh-backend',
        mode: context.runtimeMode,
        authenticated: c.get('authenticated'),
        capabilities: [...API_CAPABILITIES],
      },
    });

    return c.json(payload);
  });

  app.get(API_PATHS.runtimeGetActiveConnections, (c) => {
    const t = getTranslator(c);
    const payload: ApiRuntimeActiveConnectionsGetResponse = createApiSuccess({
      code: API_CODES.runtimeActiveConnectionsGetOk,
      message: t('success.system.activeConnectionsLoaded'),
      data: getActiveConnectionCounts(context),
    });

    return c.json(payload);
  });

  app.delete(API_PATHS.runtimeCloseActiveConnections, async (c) => {
    const t = getTranslator(c);
    const sshCount = context.sshSessionService.closeAllSessions();
    const sftpCount = await context.sftpSessionService.closeAllSessions();
    const payload: ApiRuntimeActiveConnectionsCloseResponse = createApiSuccess({
      code: API_CODES.runtimeActiveConnectionsCloseOk,
      message: t('success.system.activeConnectionsClosed'),
      data: {
        sshCount,
        sftpCount,
        totalCount: sshCount + sftpCount,
      },
    });

    return c.json(payload);
  });
};
