import assert from 'node:assert/strict';
import test from 'node:test';

import type { RemoteBootstrapResult, RemoteBootstrapStatus } from '../remote-bootstrap/service.js';
import type { OpenSshClientResult } from './connect.js';
import type { RemoteShellEventMessage } from './remote-shell-events.js';
import { SshSessionService } from './session-service.js';

type RemoteShellEventSessionHarness = {
  remoteEnhancementsRuntimeState: 'pending' | 'active' | 'disabled';
  remoteEnhancementsRuntimeContract: {
    shell: 'bash';
    helperVersion: string;
    protocolVersion: number;
    capabilities: string[];
  } | null;
  remoteEnhancementsRuntimeCode: string | null;
  remoteEnhancementsRuntimeMessage: string | null;
  remoteEnhancementsHandshakeTimeout: NodeJS.Timeout | null;
  pendingRemoteShellEvents: RemoteShellEventMessage[];
  completionWorkingDirectory: string | null;
  completionPendingCwdCommands: string[];
  remoteShellReady: boolean;
  remoteShellCwd: string | null;
  remoteShellForegroundCommand: string | null;
  lastRemoteCommand: string | null;
  lastExitCode: number | null;
  lastCommandDurationMs: number | null;
  socket: null;
  disposed: boolean;
};

type RemoteShellEventServiceHarness = {
  disableRemoteEnhancementsRuntime(session: RemoteShellEventSessionHarness, code: string, message: string): void;
  handleRemoteShellEvent(session: RemoteShellEventSessionHarness, event: RemoteShellEventMessage): void;
  flushPendingRemoteShellEvents(session: RemoteShellEventSessionHarness): void;
  startRemoteEnhancementHandshakeTimeout(session: RemoteShellEventSessionHarness, timeoutMs?: number): void;
};

type RemoteBootstrapEnsureServiceHarness = {
  ensureRemoteEnhancementsBeforeShell(options: {
    openClient: (signal: AbortSignal) => Promise<OpenSshClientResult>;
    serverId: string;
    sessionId: string;
    requestId?: string;
    serverEnabled: boolean;
    signal?: AbortSignal;
    sendStatus: (status: RemoteBootstrapStatus) => void;
    ensureTimeoutMs?: number;
  }): Promise<RemoteBootstrapResult>;
};

/**
 * Builds the minimum session shape needed to exercise remote shell event gating.
 *
 * @param overrides Session field overrides for the specific test case.
 * @returns Mutable session harness.
 */
const createSessionHarness = (
  overrides: Partial<RemoteShellEventSessionHarness> = {},
): RemoteShellEventSessionHarness => ({
  remoteEnhancementsRuntimeState: 'disabled',
  remoteEnhancementsRuntimeContract: {
    shell: 'bash',
    helperVersion: '1.2.3',
    protocolVersion: 1,
    capabilities: ['cwd', 'command-start', 'command-end', 'foreground-command', 'prompt-ready'],
  },
  remoteEnhancementsRuntimeCode: null,
  remoteEnhancementsRuntimeMessage: null,
  remoteEnhancementsHandshakeTimeout: null,
  pendingRemoteShellEvents: [],
  completionWorkingDirectory: null,
  completionPendingCwdCommands: [],
  remoteShellReady: false,
  remoteShellCwd: null,
  remoteShellForegroundCommand: null,
  lastRemoteCommand: null,
  lastExitCode: null,
  lastCommandDurationMs: null,
  socket: null,
  disposed: false,
  ...overrides,
});

/**
 * Creates a normalized remote shell event payload for gate tests.
 *
 * @param overrides Event field overrides for the specific test case.
 * @returns Remote shell event message.
 */
const createRemoteShellEvent = (overrides: Partial<RemoteShellEventMessage> = {}): RemoteShellEventMessage => ({
  type: 'remote-shell-event',
  event: 'cwd',
  shell: 'bash',
  helperVersion: '1.2.3',
  protocolVersion: 1,
  capabilities: ['cwd', 'command-start', 'command-end', 'foreground-command', 'prompt-ready'],
  cwd: '/root',
  timestamp: 1_783_172_312_000,
  ...overrides,
});

test('SshSessionService ignores remote shell events while the runtime is disabled', () => {
  const serviceHarness = SshSessionService.prototype as unknown as RemoteShellEventServiceHarness;
  const session = createSessionHarness();
  const event = createRemoteShellEvent();

  serviceHarness.handleRemoteShellEvent(session, event);

  assert.equal(session.remoteShellCwd, null);
  assert.equal(session.remoteShellReady, false);
  assert.deepEqual(session.pendingRemoteShellEvents, []);
});

test('SshSessionService clears pending remote shell events when Remote Enhancements runtime is disabled', () => {
  const serviceHarness = SshSessionService.prototype as unknown as RemoteShellEventServiceHarness;
  const event = createRemoteShellEvent();
  const session = createSessionHarness({
    pendingRemoteShellEvents: [event],
  });

  serviceHarness.flushPendingRemoteShellEvents(session);

  assert.deepEqual(session.pendingRemoteShellEvents, []);
});

test('SshSessionService activates only after a matching integration-ready handshake', () => {
  const serviceHarness = SshSessionService.prototype as unknown as RemoteShellEventServiceHarness;
  const session = createSessionHarness({ remoteEnhancementsRuntimeState: 'pending' });
  serviceHarness.startRemoteEnhancementHandshakeTimeout(session, 1_000);

  serviceHarness.handleRemoteShellEvent(session, createRemoteShellEvent());
  assert.equal(session.remoteEnhancementsRuntimeState, 'pending');
  assert.equal(session.remoteShellCwd, null);

  serviceHarness.handleRemoteShellEvent(
    session,
    createRemoteShellEvent({ event: 'integration-ready', cwd: '/home/dev' }),
  );

  assert.equal(session.remoteEnhancementsRuntimeState, 'active');
  assert.equal(session.remoteEnhancementsHandshakeTimeout, null);
  assert.equal(session.remoteShellReady, true);
  assert.equal(session.remoteShellCwd, '/home/dev');
});

test('SshSessionService disables a pending runtime when the helper handshake times out', async () => {
  const serviceHarness = SshSessionService.prototype as unknown as RemoteShellEventServiceHarness;
  const session = createSessionHarness({ remoteEnhancementsRuntimeState: 'pending' });

  serviceHarness.startRemoteEnhancementHandshakeTimeout(session, 5);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });

  assert.equal(session.remoteEnhancementsRuntimeState, 'disabled');
  assert.equal(session.remoteEnhancementsRuntimeCode, 'HELPER_HANDSHAKE_TIMEOUT');
  assert.equal(session.remoteEnhancementsHandshakeTimeout, null);
});

test('SshSessionService disables a pending runtime when the helper contract mismatches', () => {
  const serviceHarness = SshSessionService.prototype as unknown as RemoteShellEventServiceHarness;
  const session = createSessionHarness({ remoteEnhancementsRuntimeState: 'pending' });

  serviceHarness.handleRemoteShellEvent(
    session,
    createRemoteShellEvent({ event: 'integration-ready', helperVersion: '1.2.2' }),
  );

  assert.equal(session.remoteEnhancementsRuntimeState, 'disabled');
  assert.equal(session.remoteEnhancementsRuntimeCode, 'HELPER_CONTRACT_MISMATCH');
  assert.equal(session.remoteShellReady, false);
});

test('SshSessionService resets remote shell state when Remote Enhancements runtime is disabled', () => {
  const serviceHarness = SshSessionService.prototype as unknown as RemoteShellEventServiceHarness;
  const event = createRemoteShellEvent();
  const session = createSessionHarness({
    lastCommandDurationMs: 25,
    lastExitCode: 1,
    lastRemoteCommand: 'false',
    pendingRemoteShellEvents: [event],
    remoteEnhancementsRuntimeState: 'active',
    remoteShellCwd: '/tmp',
    remoteShellForegroundCommand: 'vim',
    remoteShellReady: true,
  });

  serviceHarness.disableRemoteEnhancementsRuntime(session, 'TEST_DISABLED', 'disabled for test');

  assert.equal(session.remoteEnhancementsRuntimeState, 'disabled');
  assert.equal(session.remoteEnhancementsRuntimeCode, 'TEST_DISABLED');
  assert.equal(session.remoteEnhancementsHandshakeTimeout, null);
  assert.deepEqual(session.pendingRemoteShellEvents, []);
  assert.equal(session.remoteShellReady, false);
  assert.equal(session.remoteShellCwd, null);
  assert.equal(session.remoteShellForegroundCommand, null);
  assert.equal(session.lastRemoteCommand, null);
  assert.equal(session.lastExitCode, null);
  assert.equal(session.lastCommandDurationMs, null);
});

test('SshSessionService stops waiting when the optional bootstrap exceeds its total connection budget', async () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const reportedStatuses: RemoteBootstrapStatus[] = [];
  const reportedContexts: Array<{ serverId: string; sessionId: string; requestId?: string }> = [];
  let receivedSignal: AbortSignal | undefined;
  const serviceContext = {
    getDbClient: () => ({
      $queryRaw: async () => [],
    }),
    remoteBootstrapService: {
      runForSession: async (options: { signal?: AbortSignal }): Promise<RemoteBootstrapResult> => {
        receivedSignal = options.signal;
        return await new Promise<RemoteBootstrapResult>(() => undefined);
      },
      reportStatus: (
        context: {
          serverId: string;
          sessionId: string;
          requestId?: string;
          sendStatus: (status: RemoteBootstrapStatus) => void;
        },
        status: RemoteBootstrapStatus,
      ): void => {
        reportedContexts.push({
          serverId: context.serverId,
          sessionId: context.sessionId,
          requestId: context.requestId,
        });
        reportedStatuses.push(status);
        context.sendStatus(status);
      },
    },
  };
  const serviceHarness = SshSessionService.prototype as unknown as RemoteBootstrapEnsureServiceHarness;
  const startedAt = Date.now();
  const keepAlive = setTimeout(() => undefined, 1_000);

  const result = await serviceHarness.ensureRemoteEnhancementsBeforeShell
    .call(serviceContext, {
      openClient: async () => {
        throw new Error('bootstrap client should stay lazy while no command is requested');
      },
      serverId: 'server-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      serverEnabled: true,
      sendStatus: (status) => statuses.push(status),
      ensureTimeoutMs: 5,
    })
    .finally(() => clearTimeout(keepAlive));

  assert.equal(result.state, 'disabled');
  assert.equal(result.state === 'disabled' ? result.code : null, 'BOOTSTRAP_ENSURE_TIMEOUT');
  assert.equal(statuses.at(-1)?.code, 'BOOTSTRAP_ENSURE_TIMEOUT');
  assert.equal(reportedStatuses.at(-1)?.code, 'BOOTSTRAP_ENSURE_TIMEOUT');
  assert.deepEqual(reportedContexts, [
    {
      serverId: 'server-1',
      sessionId: 'session-1',
      requestId: 'request-1',
    },
  ]);
  assert.equal(receivedSignal?.aborted, true);
  assert.ok(Date.now() - startedAt < 1_000);
});
