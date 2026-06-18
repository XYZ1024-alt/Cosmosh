import assert from 'node:assert/strict';
import test from 'node:test';

import type { PrismaClient } from '@prisma/client';

import type { AuditEventService } from '../audit/service.js';
import { PortForwardSessionService } from './session-service.js';

test('PortForwardSessionService rejects concurrent starts for the same rule', async () => {
  let resolveRuleLookup: ((value: null) => void) | undefined;
  const ruleLookup = new Promise<null>((resolve) => {
    resolveRuleLookup = resolve;
  });
  const dbClient = {
    portForwardRule: {
      findUnique: () => ruleLookup,
    },
  } as unknown as PrismaClient;
  const auditEventService = {
    logEvent: async () => null,
  } as unknown as AuditEventService;
  const service = new PortForwardSessionService({
    getDbClient: () => dbClient,
    auditEventService,
    credentialEncryptionKey: Buffer.alloc(32),
  });
  const input = {
    locale: 'en' as const,
    ruleId: 'rule-1',
    connectTimeoutSec: 45,
  };

  const firstStart = service.startRule(input);
  assert.equal(service.isRuleActive(input.ruleId), true);

  const secondStart = await service.startRule(input);
  assert.deepEqual(secondStart, { type: 'active' });

  resolveRuleLookup?.(null);
  assert.deepEqual(await firstStart, { type: 'not-found' });
  assert.equal(service.isRuleActive(input.ruleId), false);
});
