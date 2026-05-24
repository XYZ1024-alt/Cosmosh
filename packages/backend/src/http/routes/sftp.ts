import crypto from 'node:crypto';

import {
  API_CODES,
  API_PATHS,
  type ApiSftpCreateSessionHostVerificationRequiredResponse,
  type ApiSftpCreateSessionResponse,
  type ApiSftpListDirectoryResponse,
  createApiSuccess,
} from '@cosmosh/api-contract';

import type { CreateSftpSessionInput } from '../../sftp/session-service.js';
import { buildErrorPayload } from '../errors.js';
import { type BackendHttpApp, getTranslator, translateValidationMessage } from '../i18n.js';
import type { BackendAppContext } from '../types.js';

type ValidationError = {
  i18nKey: string;
  fallbackMessage: string;
  params?: Record<string, string | number | boolean>;
};

type ValidationResult<TValue> = {
  value?: TValue;
  error?: ValidationError;
};

type NormalizedSftpSessionCreateRequest = Omit<CreateSftpSessionInput, 'locale' | 'requestId'>;

const buildValidationError = (
  i18nKey: string,
  fallbackMessage: string,
  params?: Record<string, string | number | boolean>,
): ValidationError => {
  return {
    i18nKey,
    fallbackMessage,
    params,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeOptionalBoolean = (value: unknown): boolean | undefined => {
  return typeof value === 'boolean' ? value : undefined;
};

/**
 * Parses and validates SFTP session creation payload.
 *
 * @param payload Raw HTTP JSON payload.
 * @returns Normalized request or validation error.
 */
const parseCreateSftpSessionRequest = (payload: unknown): ValidationResult<NormalizedSftpSessionCreateRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const serverId = normalizeOptionalString(payload.serverId);
  if (!serverId) {
    return {
      error: buildValidationError('errors.validation.serverIdRequired', 'serverId is required.'),
    };
  }

  const connectTimeoutSec =
    typeof payload.connectTimeoutSec === 'number' ? payload.connectTimeoutSec : Number(payload.connectTimeoutSec ?? 45);
  if (!Number.isInteger(connectTimeoutSec) || connectTimeoutSec < 5 || connectTimeoutSec > 180) {
    return {
      error: buildValidationError(
        'errors.validation.connectTimeoutRange',
        'connectTimeoutSec must be an integer between 5 and 180.',
      ),
    };
  }

  const strictHostKey = normalizeOptionalBoolean(payload.strictHostKey);
  if (payload.strictHostKey !== undefined && strictHostKey === undefined) {
    return {
      error: buildValidationError('errors.validation.strictHostKeyType', 'strictHostKey must be a boolean value.'),
    };
  }

  const initialPath = normalizeOptionalString(payload.initialPath) ?? '.';
  const value: NormalizedSftpSessionCreateRequest = {
    serverId,
    connectTimeoutSec,
    initialPath,
  };

  if (strictHostKey !== undefined) {
    value.strictHostKey = strictHostKey;
  }

  return {
    value,
  };
};

/**
 * Registers read-only SFTP browser session routes.
 *
 * @param app Backend HTTP app.
 * @param context Runtime services injected by backend bootstrap.
 * @returns void.
 */
export const registerSftpRoutes = (app: BackendHttpApp, context: BackendAppContext): void => {
  app.post(API_PATHS.sftpCreateSession, async (c) => {
    const t = getTranslator(c);
    const requestId = crypto.randomUUID();
    const parsed = parseCreateSftpSessionRequest(await c.req.json().catch(() => undefined));

    if (!parsed.value) {
      return c.json(
        buildErrorPayload(
          API_CODES.sftpValidationFailed,
          parsed.error ? t(parsed.error.i18nKey, parsed.error.params) : t('errors.validation.invalidPayload'),
        ),
        400,
      );
    }

    const result = await context.sftpSessionService.createSession({
      ...parsed.value,
      locale: c.get('locale'),
      requestId,
    });

    if (result.type === 'not-found') {
      return c.json(buildErrorPayload(API_CODES.sftpValidationFailed, t('errors.ssh.serverNotFound')), 404);
    }

    if (result.type === 'host-untrusted') {
      const payload: ApiSftpCreateSessionHostVerificationRequiredResponse = {
        success: false,
        code: API_CODES.sshHostUntrusted,
        message: t('errors.ssh.hostFingerprintUntrusted'),
        requestId,
        timestamp: new Date().toISOString(),
        data: {
          serverId: result.serverId,
          host: result.host,
          port: result.port,
          algorithm: result.algorithm,
          fingerprint: result.fingerprint,
        },
      };

      return c.json(payload, 409);
    }

    if (result.type === 'failed') {
      return c.json(
        buildErrorPayload(
          API_CODES.sftpOperationFailed,
          translateValidationMessage(
            result.message,
            t('errors.sftp.sessionCreateFailed', { reason: result.message }),
            t('errors.sftp.sessionCreateFailedNoReason'),
          ),
        ),
        400,
      );
    }

    const payload: ApiSftpCreateSessionResponse = createApiSuccess({
      code: API_CODES.sftpSessionCreateOk,
      message: t('success.sftp.sessionCreated'),
      requestId,
      data: {
        sessionId: result.sessionId,
        serverId: result.serverId,
        initialPath: result.initialPath,
        currentPath: result.currentPath,
        readOnly: true,
      },
    });

    return c.json(payload);
  });

  app.get(API_PATHS.sftpListDirectory.replace('{sessionId}', ':sessionId'), async (c) => {
    const t = getTranslator(c);
    const sessionId = c.req.param('sessionId');
    const requestedPath = c.req.query('path');

    if (!sessionId) {
      return c.json(buildErrorPayload(API_CODES.sftpValidationFailed, t('errors.sftp.sessionIdRequired')), 400);
    }

    const result = await context.sftpSessionService.listDirectory(sessionId, requestedPath);

    if (result.type === 'not-found') {
      return c.json(buildErrorPayload(API_CODES.sftpSessionNotFound, t('errors.sftp.sessionNotFound')), 404);
    }

    if (result.type === 'failed') {
      return c.json(
        buildErrorPayload(
          API_CODES.sftpOperationFailed,
          translateValidationMessage(
            result.message,
            t('errors.sftp.directoryListFailed', { reason: result.message }),
            t('errors.sftp.directoryListFailedNoReason'),
          ),
        ),
        400,
      );
    }

    const payload: ApiSftpListDirectoryResponse = createApiSuccess({
      code: API_CODES.sftpDirectoryListOk,
      message: t('success.sftp.directoryListed'),
      data: {
        sessionId: result.sessionId,
        path: result.path,
        parentPath: result.parentPath,
        entries: result.entries,
      },
    });

    return c.json(payload);
  });

  app.delete(API_PATHS.sftpCloseSession.replace('{sessionId}', ':sessionId'), async (c) => {
    const t = getTranslator(c);
    const sessionId = c.req.param('sessionId');

    if (!sessionId || !context.sftpSessionService.closeSession(sessionId)) {
      return c.json(buildErrorPayload(API_CODES.sftpSessionNotFound, t('errors.sftp.sessionNotFound')), 404);
    }

    return c.body(null, 204);
  });
};
