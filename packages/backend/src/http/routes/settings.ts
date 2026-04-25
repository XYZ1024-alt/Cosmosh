import crypto from 'node:crypto';

import {
  API_CODES,
  API_PATHS,
  type ApiSettingsGetResponse,
  type ApiSettingsUpdateResponse,
  createApiSuccess,
} from '@cosmosh/api-contract';

import {
  DEFAULT_SETTINGS_SCOPE,
  parseSettingsUpdateRequest,
  parseStoredSettingsValues,
} from '../../settings/validation.js';
import { buildErrorPayload } from '../errors.js';
import { type BackendHttpApp, getTranslator } from '../i18n.js';
import type { BackendAppContext } from '../types.js';

/**
 * Converts API scope object into flat DB key columns.
 */
const toScopeColumns = (scope: {
  accountId?: string;
  deviceId: string;
}): { scopeAccountId: string; scopeDeviceId: string } => {
  return {
    scopeAccountId: scope.accountId ?? '',
    scopeDeviceId: scope.deviceId,
  };
};

/**
 * Converts DB scope columns back into API response shape.
 */
const toScopePayload = (scopeAccountId: string, scopeDeviceId: string): { accountId?: string; deviceId: string } => {
  return {
    accountId: scopeAccountId.length > 0 ? scopeAccountId : undefined,
    deviceId: scopeDeviceId,
  };
};

type AppSettingsRow = {
  scopeAccountId: string;
  scopeDeviceId: string;
  payloadJson: string;
  revision: number;
  updatedAt: Date | string;
};

/**
 * Loads one settings row for a specific scope.
 */
const findSettingsRow = async (
  context: BackendAppContext,
  scopeColumns: { scopeAccountId: string; scopeDeviceId: string },
): Promise<AppSettingsRow | null> => {
  const db = context.getDbClient();
  const rows = await db.$queryRaw<AppSettingsRow[]>`
    SELECT "scopeAccountId", "scopeDeviceId", "payloadJson", "revision", "updatedAt"
    FROM "AppSettings"
    WHERE "scopeAccountId" = ${scopeColumns.scopeAccountId}
      AND "scopeDeviceId" = ${scopeColumns.scopeDeviceId}
    LIMIT 1
  `;

  return rows[0] ?? null;
};

/**
 * Normalizes Date/string values to ISO timestamp in responses.
 */
const toIsoTimestamp = (value: Date | string): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
};

/**
 * Returns changed settings keys without exposing any setting values.
 */
const collectChangedSettingKeys = (previousValues: object, nextValues: object): string[] => {
  const changedKeys: string[] = [];

  const previousRecord = previousValues as Record<string, unknown>;
  const nextRecord = nextValues as Record<string, unknown>;

  for (const [key, nextValue] of Object.entries(nextRecord)) {
    const previousSerialized = JSON.stringify(previousRecord[key]);
    const nextSerialized = JSON.stringify(nextValue);
    if (previousSerialized !== nextSerialized) {
      changedKeys.push(key);
    }
  }

  return changedKeys.sort();
};

/**
 * Registers settings read/update routes.
 */
export const registerSettingsRoutes = (app: BackendHttpApp, context: BackendAppContext): void => {
  app.get(API_PATHS.settingsGet, async (c) => {
    const t = getTranslator(c);
    const scopeColumns = toScopeColumns(DEFAULT_SETTINGS_SCOPE);
    const row = await findSettingsRow(context, scopeColumns);

    const payload: ApiSettingsGetResponse = createApiSuccess({
      code: API_CODES.settingsGetOk,
      message: t('success.settings.fetched'),
      data: {
        item: {
          scope: toScopePayload(scopeColumns.scopeAccountId, scopeColumns.scopeDeviceId),
          revision: row?.revision ?? 0,
          updatedAt: row ? toIsoTimestamp(row.updatedAt) : new Date().toISOString(),
          values: parseStoredSettingsValues(row?.payloadJson),
        },
      },
    });

    return c.json(payload);
  });

  app.put(API_PATHS.settingsUpdate, async (c) => {
    const t = getTranslator(c);
    const requestId = crypto.randomUUID();
    const parsed = parseSettingsUpdateRequest(await c.req.json().catch(() => undefined));
    if (!parsed.value) {
      return c.json(
        buildErrorPayload(
          API_CODES.settingsValidationFailed,
          parsed.error ? t(parsed.error.i18nKey, parsed.error.params) : t('errors.settings.invalidRequestPayload'),
        ),
        400,
      );
    }

    const scopeColumns = toScopeColumns(parsed.value.scope ?? DEFAULT_SETTINGS_SCOPE);
    const payloadJson = JSON.stringify(parsed.value.values);
    const db = context.getDbClient();
    const previousRow = await findSettingsRow(context, scopeColumns);
    const previousValues = parseStoredSettingsValues(previousRow?.payloadJson);
    const changedKeys = collectChangedSettingKeys(previousValues, parsed.value.values);

    await db.$executeRaw`
      INSERT INTO "AppSettings" (
        "id",
        "scopeAccountId",
        "scopeDeviceId",
        "payloadJson",
        "revision",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${crypto.randomUUID()},
        ${scopeColumns.scopeAccountId},
        ${scopeColumns.scopeDeviceId},
        ${payloadJson},
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT("scopeAccountId", "scopeDeviceId") DO UPDATE SET
        "payloadJson" = excluded."payloadJson",
        "revision" = "AppSettings"."revision" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    `;

    const row = await findSettingsRow(context, scopeColumns);

    if (!row) {
      return c.json(buildErrorPayload(API_CODES.settingsValidationFailed, t('errors.settings.rowNotPersisted')), 400);
    }

    const payload: ApiSettingsUpdateResponse = createApiSuccess({
      code: API_CODES.settingsUpdateOk,
      message: t('success.settings.updated'),
      requestId,
      data: {
        item: {
          scope: toScopePayload(row.scopeAccountId, row.scopeDeviceId),
          revision: row.revision,
          updatedAt: toIsoTimestamp(row.updatedAt),
          values: parseStoredSettingsValues(row.payloadJson),
        },
      },
    });

    void context.auditEventService.logEvent({
      category: 'settings',
      action: 'update',
      outcome: 'success',
      severity: changedKeys.length > 0 ? 'warning' : 'info',
      entityType: 'app-settings',
      entityId: `${row.scopeAccountId}:${row.scopeDeviceId}`,
      requestId,
      metadata: {
        changedKeys,
        changedCount: changedKeys.length,
        revision: row.revision,
      },
    });

    return c.json(payload);
  });
};
