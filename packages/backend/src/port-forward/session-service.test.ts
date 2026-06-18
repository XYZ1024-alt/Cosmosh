import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { PrismaClient } from '@prisma/client';
import type { Client } from 'ssh2';

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

test('PortForwardSessionService contains unexpected-close persistence failures', async () => {
  const dbClient = {
    portForwardRule: {
      update: async () => {
        throw new Error('database unavailable');
      },
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
  const fakeClient = new EventEmitter() as unknown as Client;
  let clientEnded = false;
  Object.assign(fakeClient, {
    end: () => {
      clientEnded = true;
    },
  });
  const testService = service as unknown as {
    activeRules: Map<string, unknown>;
    handleUnexpectedClose: (ruleId: string, message: string) => Promise<void>;
  };
  testService.activeRules.set('rule-1', {
    ruleId: 'rule-1',
    client: fakeClient,
    localServer: null,
    localSockets: new Set(),
    channels: new Set(),
    remoteSockets: new Set(),
    activeConnectionCount: 0,
    startedAt: new Date(),
  });

  const originalConsoleError = console.error;
  const loggedErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };

  try {
    await testService.handleUnexpectedClose('rule-1', 'connection lost');
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(testService.activeRules.has('rule-1'), false);
  assert.equal(clientEnded, true);
  assert.equal(loggedErrors.length, 1);
});
