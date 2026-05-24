import crypto from 'node:crypto';

import {
  API_CODES,
  API_PATHS,
  type ApiSftpBatchOperationResponse,
  type ApiSftpCopyResponse,
  type ApiSftpCreateDirectoryResponse,
  type ApiSftpCreateFileResponse,
  type ApiSftpCreateSessionHostVerificationRequiredResponse,
  type ApiSftpCreateSessionResponse,
  type ApiSftpDeleteResponse,
  type ApiSftpListDirectoryResponse,
  type ApiSftpReadFileResponse,
  type ApiSftpRenameResponse,
  createApiSuccess,
} from '@cosmosh/api-contract';

import type {
  CreateSftpSessionInput,
  RunSftpBatchOperationInput,
  SftpBatchOperation,
  SftpBatchOperationResult,
  SftpEntryType,
} from '../../sftp/session-service.js';
import { buildErrorPayload } from '../errors.js';
import { type BackendHttpApp, type BackendTranslator, getTranslator, translateValidationMessage } from '../i18n.js';
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

type NormalizedSftpPathRequest = {
  path: string;
};

type NormalizedSftpRenameRequest = {
  sourcePath: string;
  targetPath: string;
};

type NormalizedSftpDeleteRequest = {
  path: string;
  recursive: boolean;
};

type NormalizedSftpBatchOperationRequest = RunSftpBatchOperationInput;

type SuccessfulSftpBatchOperationResult = Extract<SftpBatchOperationResult, { type: 'success' }>;

type ApiSftpOperationResponse =
  | ApiSftpCreateDirectoryResponse
  | ApiSftpCreateFileResponse
  | ApiSftpRenameResponse
  | ApiSftpCopyResponse
  | ApiSftpDeleteResponse;

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

const isSftpEntryType = (value: unknown): value is SftpEntryType => {
  return value === 'directory' || value === 'file' || value === 'symlink' || value === 'other';
};

const isSftpBatchOperation = (value: unknown): value is SftpBatchOperation => {
  return value === 'copy' || value === 'move' || value === 'delete';
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

const normalizePositiveInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalizedValue = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(normalizedValue) && normalizedValue > 0 ? normalizedValue : undefined;
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
 * Parses and validates a payload that contains one SFTP path.
 *
 * @param payload Raw HTTP JSON payload.
 * @returns Normalized request or validation error.
 */
const parseSftpPathRequest = (payload: unknown): ValidationResult<NormalizedSftpPathRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const requestedPath = normalizeOptionalString(payload.path);
  if (!requestedPath) {
    return {
      error: buildValidationError('errors.sftp.pathRequired', 'path is required.'),
    };
  }

  return {
    value: {
      path: requestedPath,
    },
  };
};

/**
 * Parses source/target path payloads for SFTP copy and rename operations.
 *
 * @param payload Raw HTTP JSON payload.
 * @returns Normalized source/target request or validation error.
 */
const parseSftpSourceTargetRequest = (payload: unknown): ValidationResult<NormalizedSftpRenameRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const sourcePath = normalizeOptionalString(payload.sourcePath);
  const targetPath = normalizeOptionalString(payload.targetPath);
  if (!sourcePath || !targetPath) {
    return {
      error: buildValidationError('errors.sftp.sourceTargetRequired', 'sourcePath and targetPath are required.'),
    };
  }

  return {
    value: {
      sourcePath,
      targetPath,
    },
  };
};

/**
 * Parses SFTP delete payloads.
 *
 * @param payload Raw HTTP JSON payload.
 * @returns Normalized delete request or validation error.
 */
const parseSftpDeleteRequest = (payload: unknown): ValidationResult<NormalizedSftpDeleteRequest> => {
  const parsedPath = parseSftpPathRequest(payload);
  if (!parsedPath.value) {
    return parsedPath as ValidationResult<NormalizedSftpDeleteRequest>;
  }

  const recursive = isRecord(payload) && typeof payload.recursive === 'boolean' ? payload.recursive : true;
  return {
    value: {
      path: parsedPath.value.path,
      recursive,
    },
  };
};

/**
 * Parses SFTP batch operation payloads.
 *
 * @param payload Raw HTTP JSON payload.
 * @returns Normalized batch operation request or validation error.
 */
const parseSftpBatchOperationRequest = (payload: unknown): ValidationResult<NormalizedSftpBatchOperationRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  if (!isSftpBatchOperation(payload.operation)) {
    return {
      error: buildValidationError('errors.sftp.batchOperationRequired', 'operation must be copy, move, or delete.'),
    };
  }

  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    return {
      error: buildValidationError('errors.sftp.batchEntriesRequired', 'entries must contain at least one item.'),
    };
  }

  const entries: RunSftpBatchOperationInput['entries'] = [];
  for (const entry of payload.entries) {
    if (!isRecord(entry)) {
      return {
        error: buildValidationError('errors.sftp.batchEntriesRequired', 'entries must contain valid item objects.'),
      };
    }

    const entryPath = normalizeOptionalString(entry.path);
    if (!entryPath) {
      return {
        error: buildValidationError('errors.sftp.pathRequired', 'path is required.'),
      };
    }

    if (!isSftpEntryType(entry.type)) {
      return {
        error: buildValidationError('errors.sftp.entryTypeRequired', 'entry type is required.'),
      };
    }

    entries.push({
      path: entryPath,
      type: entry.type,
    });
  }

  const targetDirectoryPath = normalizeOptionalString(payload.targetDirectoryPath);
  if ((payload.operation === 'copy' || payload.operation === 'move') && !targetDirectoryPath) {
    return {
      error: buildValidationError(
        'errors.sftp.batchTargetRequired',
        'targetDirectoryPath is required for copy and move batch operations.',
      ),
    };
  }

  const value: NormalizedSftpBatchOperationRequest = {
    operation: payload.operation,
    entries,
  };

  if (targetDirectoryPath) {
    value.targetDirectoryPath = targetDirectoryPath;
  }

  return {
    value,
  };
};

const buildValidationFailureResponse = (t: BackendTranslator, error?: ValidationError) => {
  return buildErrorPayload(
    API_CODES.sftpValidationFailed,
    error ? t(error.i18nKey, error.params) : t('errors.validation.invalidPayload'),
  );
};

const buildOperationFailureResponse = (t: BackendTranslator, reason: string) => {
  return buildErrorPayload(
    API_CODES.sftpOperationFailed,
    translateValidationMessage(
      reason,
      t('errors.sftp.operationFailed', { reason }),
      t('errors.sftp.operationFailedNoReason'),
    ),
  );
};

const buildSftpOperationSuccess = (
  code: typeof API_CODES.sftpOperationOk,
  message: string,
  data: {
    sessionId: string;
    path: string;
    targetPath?: string;
  },
): ApiSftpOperationResponse => {
  return createApiSuccess({
    code,
    message,
    data,
  });
};

const buildSftpBatchOperationSuccess = (
  t: BackendTranslator,
  data: SuccessfulSftpBatchOperationResult,
): ApiSftpBatchOperationResponse => {
  return createApiSuccess({
    code: API_CODES.sftpOperationOk,
    message: t('success.sftp.batchOperationCompleted'),
    data: {
      sessionId: data.sessionId,
      operation: data.operation,
      totalCount: data.totalCount,
      completedCount: data.completedCount,
      failedCount: data.failedCount,
      skippedCount: data.skippedCount,
      stoppedOnFailure: data.stoppedOnFailure,
      results: data.results,
    },
  });
};

/**
 * Registers a POST SFTP path operation route with shared validation/error mapping.
 *
 * @param app Backend HTTP app.
 * @param routePath API path template with `{sessionId}` token.
 * @param parsePayload Payload parser.
 * @param successMessage Success message resolver.
 * @param runOperation Service operation callback.
 * @returns void.
 */
const registerSftpPathOperationRoute = <TRequest>(
  app: BackendHttpApp,
  routePath: string,
  parsePayload: (payload: unknown) => ValidationResult<TRequest>,
  successMessage: (t: BackendTranslator) => string,
  runOperation: (
    sessionId: string,
    request: TRequest,
  ) => Promise<
    | {
        type: 'success';
        sessionId: string;
        path: string;
        targetPath?: string;
      }
    | { type: 'not-found' }
    | { type: 'failed'; message: string }
  >,
): void => {
  app.post(routePath.replace('{sessionId}', ':sessionId'), async (c) => {
    const t = getTranslator(c);
    const sessionId = c.req.param('sessionId');

    if (!sessionId) {
      return c.json(buildErrorPayload(API_CODES.sftpValidationFailed, t('errors.sftp.sessionIdRequired')), 400);
    }

    const parsed = parsePayload(await c.req.json().catch(() => undefined));
    if (!parsed.value) {
      return c.json(buildValidationFailureResponse(t, parsed.error), 400);
    }

    const result = await runOperation(sessionId, parsed.value);
    if (result.type === 'not-found') {
      return c.json(buildErrorPayload(API_CODES.sftpSessionNotFound, t('errors.sftp.sessionNotFound')), 404);
    }

    if (result.type === 'failed') {
      return c.json(buildOperationFailureResponse(t, result.message), 400);
    }

    return c.json(buildSftpOperationSuccess(API_CODES.sftpOperationOk, successMessage(t), result));
  });
};

/**
 * Registers SFTP browser session routes.
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
        readOnly: false,
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

  app.get(API_PATHS.sftpReadFile.replace('{sessionId}', ':sessionId'), async (c) => {
    const t = getTranslator(c);
    const sessionId = c.req.param('sessionId');
    const requestedPath = c.req.query('path');
    const maxBytes = normalizePositiveInteger(c.req.query('maxBytes'));

    if (!sessionId) {
      return c.json(buildErrorPayload(API_CODES.sftpValidationFailed, t('errors.sftp.sessionIdRequired')), 400);
    }

    if (!requestedPath) {
      return c.json(
        buildValidationFailureResponse(t, buildValidationError('errors.sftp.pathRequired', 'path is required.')),
        400,
      );
    }

    const result = await context.sftpSessionService.readFilePreview(sessionId, requestedPath, maxBytes);
    if (result.type === 'not-found') {
      return c.json(buildErrorPayload(API_CODES.sftpSessionNotFound, t('errors.sftp.sessionNotFound')), 404);
    }

    if (result.type === 'failed') {
      return c.json(buildOperationFailureResponse(t, result.message), 400);
    }

    const payload: ApiSftpReadFileResponse = createApiSuccess({
      code: API_CODES.sftpFileReadOk,
      message: t('success.sftp.fileRead'),
      data: {
        sessionId: result.sessionId,
        path: result.path,
        encoding: 'utf8',
        content: result.content,
        size: result.size,
        truncated: result.truncated,
      },
    });

    return c.json(payload);
  });

  registerSftpPathOperationRoute(
    app,
    API_PATHS.sftpCreateDirectory,
    parseSftpPathRequest,
    (t) => t('success.sftp.directoryCreated'),
    (sessionId, request) => context.sftpSessionService.createDirectory(sessionId, request.path),
  );

  registerSftpPathOperationRoute(
    app,
    API_PATHS.sftpCreateFile,
    parseSftpPathRequest,
    (t) => t('success.sftp.fileCreated'),
    (sessionId, request) => context.sftpSessionService.createFile(sessionId, request.path),
  );

  registerSftpPathOperationRoute(
    app,
    API_PATHS.sftpRenameEntry,
    parseSftpSourceTargetRequest,
    (t) => t('success.sftp.entryRenamed'),
    (sessionId, request) => context.sftpSessionService.renameEntry(sessionId, request.sourcePath, request.targetPath),
  );

  registerSftpPathOperationRoute(
    app,
    API_PATHS.sftpCopyEntry,
    parseSftpSourceTargetRequest,
    (t) => t('success.sftp.entryCopied'),
    (sessionId, request) => context.sftpSessionService.copyEntry(sessionId, request.sourcePath, request.targetPath),
  );

  registerSftpPathOperationRoute(
    app,
    API_PATHS.sftpDeleteEntry,
    parseSftpDeleteRequest,
    (t) => t('success.sftp.entryDeleted'),
    (sessionId, request) => context.sftpSessionService.deleteEntry(sessionId, request.path, request.recursive),
  );

  app.post(API_PATHS.sftpBatchOperation.replace('{sessionId}', ':sessionId'), async (c) => {
    const t = getTranslator(c);
    const sessionId = c.req.param('sessionId');

    if (!sessionId) {
      return c.json(buildErrorPayload(API_CODES.sftpValidationFailed, t('errors.sftp.sessionIdRequired')), 400);
    }

    const parsed = parseSftpBatchOperationRequest(await c.req.json().catch(() => undefined));
    if (!parsed.value) {
      return c.json(buildValidationFailureResponse(t, parsed.error), 400);
    }

    const result = await context.sftpSessionService.runBatchOperation(sessionId, parsed.value);
    if (result.type === 'not-found') {
      return c.json(buildErrorPayload(API_CODES.sftpSessionNotFound, t('errors.sftp.sessionNotFound')), 404);
    }

    if (result.type === 'failed') {
      return c.json(buildOperationFailureResponse(t, result.message), 400);
    }

    return c.json(buildSftpBatchOperationSuccess(t, result));
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
