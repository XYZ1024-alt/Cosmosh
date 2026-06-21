import crypto from 'node:crypto';

import {
  API_CODES,
  API_PATHS,
  type ApiPortForwardCreateRuleResponse,
  type ApiPortForwardListRulesResponse,
  type ApiPortForwardStartRuleRequest,
  type ApiPortForwardStartRuleResponse,
  type ApiPortForwardStopRuleResponse,
  type ApiPortForwardUpdateRuleResponse,
  type ApiSshCreateSessionHostVerificationRequiredResponse,
  createApiSuccess,
  MAX_SYSTEM_PROXY_RULES_LENGTH,
} from '@cosmosh/api-contract';
import prismaClientPackage from '@prisma/client';

import { parsePortForwardRulePayload } from '../../port-forward/validation.js';
import { isRecord, normalizeOptionalString } from '../../validation-utils.js';
import { buildErrorPayload } from '../errors.js';
import { type BackendHttpApp, getTranslator } from '../i18n.js';
import type { BackendAppContext } from '../types.js';

const { Prisma } = prismaClientPackage;

/**
 * Parses the optional system proxy result attached to a forwarding start request.
 *
 * @param payload Raw request body.
 * @returns Normalized start payload or null when invalid.
 */
const parsePortForwardStartRequest = (payload: unknown): ApiPortForwardStartRuleRequest | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const systemProxyRules = normalizeOptionalString(payload.systemProxyRules);
  if (
    payload.systemProxyRules !== undefined &&
    (!systemProxyRules || systemProxyRules.length > MAX_SYSTEM_PROXY_RULES_LENGTH)
  ) {
    return null;
  }

  return {
    systemProxyRules,
  };
};

/**
 * Builds a host-verification response shared with SSH/SFTP creation flows.
 */
const buildHostUntrustedPayload = (
  result: {
    serverId: string;
    host: string;
    port: number;
    algorithm: 'sha256';
    fingerprint: string;
  },
  requestId: string,
  message: string,
): ApiSshCreateSessionHostVerificationRequiredResponse => {
  return {
    success: false,
    code: API_CODES.sshHostUntrusted,
    message,
    requestId,
    timestamp: new Date().toISOString(),
    data: result,
  };
};

/**
 * Registers HTTP routes for persisted SSH port-forwarding rules and runtime actions.
 */
export const registerPortForwardRoutes = (app: BackendHttpApp, context: BackendAppContext): void => {
  app.get(API_PATHS.portForwardListRules, async (c) => {
    const t = getTranslator(c);
    const payload: ApiPortForwardListRulesResponse = createApiSuccess({
      code: API_CODES.portForwardRuleListOk,
      message: t('success.portForward.rulesFetched'),
      data: {
        items: await context.portForwardSessionService.listRules(),
      },
    });

    return c.json(payload);
  });

  app.post(API_PATHS.portForwardCreateRule, async (c) => {
    const t = getTranslator(c);
    const requestId = crypto.randomUUID();
    const parsed = parsePortForwardRulePayload(await c.req.json().catch(() => undefined));
    if (!parsed.value) {
      return c.json(
        buildErrorPayload(
          API_CODES.portForwardValidationFailed,
          parsed.error ? t(parsed.error.i18nKey, parsed.error.params) : t('errors.validation.invalidPayload'),
        ),
        400,
      );
    }

    const server = await context.getDbClient().sshServer.findUnique({
      where: {
        id: parsed.value.serverId,
      },
      select: {
        id: true,
      },
    });

    if (!server) {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.ssh.serverNotFound')), 404);
    }

    const rule = await context.getDbClient().portForwardRule.create({
      data: parsed.value,
      include: {
        server: {
          include: {
            keychain: true,
          },
        },
      },
    });

    void context.auditEventService.logEvent({
      category: 'port-forward',
      action: 'create',
      outcome: 'success',
      severity: 'warning',
      entityType: 'port-forward-rule',
      entityId: rule.id,
      requestId,
      metadata: {
        name: rule.name,
        type: rule.type,
        serverId: rule.serverId,
      },
    });

    const item = (await context.portForwardSessionService.listRules()).find((entry) => entry.id === rule.id);
    if (!item) {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.portForward.ruleNotFound')), 404);
    }

    const payload: ApiPortForwardCreateRuleResponse = createApiSuccess({
      code: API_CODES.portForwardRuleCreateOk,
      message: t('success.portForward.ruleCreated'),
      requestId,
      data: {
        item,
      },
    });

    return c.json(payload);
  });

  app.put(API_PATHS.portForwardUpdateRule.replace('{ruleId}', ':ruleId'), async (c) => {
    const t = getTranslator(c);
    const requestId = crypto.randomUUID();
    const ruleId = c.req.param('ruleId');
    if (!ruleId) {
      return c.json(
        buildErrorPayload(API_CODES.portForwardValidationFailed, t('errors.portForward.ruleIdRequired')),
        400,
      );
    }

    if (context.portForwardSessionService.isRuleActive(ruleId)) {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleActive, t('errors.portForward.ruleActive')), 409);
    }

    const parsed = parsePortForwardRulePayload(await c.req.json().catch(() => undefined));
    if (!parsed.value) {
      return c.json(
        buildErrorPayload(
          API_CODES.portForwardValidationFailed,
          parsed.error ? t(parsed.error.i18nKey, parsed.error.params) : t('errors.validation.invalidPayload'),
        ),
        400,
      );
    }

    const server = await context.getDbClient().sshServer.findUnique({
      where: {
        id: parsed.value.serverId,
      },
      select: {
        id: true,
      },
    });

    if (!server) {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.ssh.serverNotFound')), 404);
    }

    try {
      const rule = await context.getDbClient().portForwardRule.update({
        where: {
          id: ruleId,
        },
        data: parsed.value,
        select: {
          id: true,
          name: true,
          type: true,
          serverId: true,
        },
      });

      void context.auditEventService.logEvent({
        category: 'port-forward',
        action: 'update',
        outcome: 'success',
        severity: 'warning',
        entityType: 'port-forward-rule',
        entityId: rule.id,
        requestId,
        metadata: {
          name: rule.name,
          type: rule.type,
          serverId: rule.serverId,
        },
      });

      const item = (await context.portForwardSessionService.listRules()).find((entry) => entry.id === rule.id);
      if (!item) {
        return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.portForward.ruleNotFound')), 404);
      }

      const payload: ApiPortForwardUpdateRuleResponse = createApiSuccess({
        code: API_CODES.portForwardRuleUpdateOk,
        message: t('success.portForward.ruleUpdated'),
        requestId,
        data: {
          item,
        },
      });

      return c.json(payload);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.portForward.ruleNotFound')), 404);
      }

      throw error;
    }
  });

  app.delete(API_PATHS.portForwardDeleteRule.replace('{ruleId}', ':ruleId'), async (c) => {
    const t = getTranslator(c);
    const requestId = crypto.randomUUID();
    const ruleId = c.req.param('ruleId');
    if (!ruleId) {
      return c.json(
        buildErrorPayload(API_CODES.portForwardValidationFailed, t('errors.portForward.ruleIdRequired')),
        400,
      );
    }

    if (context.portForwardSessionService.isRuleActive(ruleId)) {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleActive, t('errors.portForward.ruleActive')), 409);
    }

    try {
      await context.getDbClient().portForwardRule.delete({
        where: {
          id: ruleId,
        },
      });

      void context.auditEventService.logEvent({
        category: 'port-forward',
        action: 'delete',
        outcome: 'success',
        severity: 'warning',
        entityType: 'port-forward-rule',
        entityId: ruleId,
        requestId,
        metadata: {
          deleted: true,
        },
      });

      return c.body(null, 204);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.portForward.ruleNotFound')), 404);
      }

      throw error;
    }
  });

  app.post(API_PATHS.portForwardStartRule.replace('{ruleId}', ':ruleId'), async (c) => {
    const t = getTranslator(c);
    const requestId = crypto.randomUUID();
    const ruleId = c.req.param('ruleId');
    if (!ruleId) {
      return c.json(
        buildErrorPayload(API_CODES.portForwardValidationFailed, t('errors.portForward.ruleIdRequired')),
        400,
      );
    }

    const startRequest = parsePortForwardStartRequest(await c.req.json().catch(() => undefined));
    if (!startRequest) {
      return c.json(
        buildErrorPayload(API_CODES.portForwardValidationFailed, t('errors.validation.invalidPayload')),
        400,
      );
    }

    const result = await context.portForwardSessionService.startRule({
      ruleId,
      locale: c.get('locale'),
      requestId,
      connectTimeoutSec: 45,
      systemProxyRules: startRequest.systemProxyRules,
    });

    if (result.type === 'not-found') {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.portForward.ruleNotFound')), 404);
    }

    if (result.type === 'active') {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleActive, t('errors.portForward.ruleActive')), 409);
    }

    if (result.type === 'host-untrusted') {
      return c.json(buildHostUntrustedPayload(result, requestId, t('errors.ssh.hostFingerprintUntrusted')), 409);
    }

    if (result.type === 'failed') {
      return c.json(
        buildErrorPayload(
          API_CODES.portForwardStartFailed,
          t('errors.portForward.startFailed', { reason: result.message }),
        ),
        400,
      );
    }

    const payload: ApiPortForwardStartRuleResponse = createApiSuccess({
      code: API_CODES.portForwardRuleStartOk,
      message: t('success.portForward.ruleStarted'),
      requestId,
      data: {
        item: result.item,
      },
    });

    return c.json(payload);
  });

  app.post(API_PATHS.portForwardStopRule.replace('{ruleId}', ':ruleId'), async (c) => {
    const t = getTranslator(c);
    const requestId = crypto.randomUUID();
    const ruleId = c.req.param('ruleId');
    if (!ruleId) {
      return c.json(
        buildErrorPayload(API_CODES.portForwardValidationFailed, t('errors.portForward.ruleIdRequired')),
        400,
      );
    }

    const result = await context.portForwardSessionService.stopRule(ruleId);
    if (result.type === 'not-found') {
      return c.json(buildErrorPayload(API_CODES.portForwardRuleNotFound, t('errors.portForward.ruleNotFound')), 404);
    }

    const payload: ApiPortForwardStopRuleResponse = createApiSuccess({
      code: API_CODES.portForwardRuleStopOk,
      message: t('success.portForward.ruleStopped'),
      requestId,
      data: {
        item: result.item,
      },
    });

    return c.json(payload);
  });
};
