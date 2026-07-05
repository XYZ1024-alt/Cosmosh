import assert from 'node:assert/strict';
import test from 'node:test';

import type { RemoteShellEventMessage } from './remote-shell-events.js';
import { SshSessionService } from './session-service.js';

type RemoteShellEventSessionHarness = {
  remoteEnhancementsRuntimeEnabled: boolean;
  pendingRemoteShellEvents: RemoteShellEventMessage[];
  remoteShellReady: boolean;
  remoteShellCwd: string | null;
  remoteShellForegroundCommand: string | null;
  lastRemoteCommand: string | null;
  lastExitCode: number | null;
  lastCommandDurationMs: number | null;
  socket: null;
};

type RemoteShellEventServiceHarness = {
  disableRemoteEnhancementsRuntime(session: RemoteShellEventSessionHarness): void;
  handleRemoteShellEvent(session: RemoteShellEventSessionHarness, event: RemoteShellEventMessage): void;
  flushPendingRemoteShellEvents(session: RemoteShellEventSessionHarness): void;
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
  remoteEnhancementsRuntimeEnabled: false,
  pendingRemoteShellEvents: [],
  remoteShellReady: false,
  remoteShellCwd: null,
  remoteShellForegroundCommand: null,
  lastRemoteCommand: null,
  lastExitCode: null,
  lastCommandDurationMs: null,
  socket: null,
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
  cwd: '/root',
  timestamp: 1_783_172_312_000,
  ...overrides,
});

test('SshSessionService ignores remote shell events until Remote Enhancements runtime is enabled', () => {
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

test('SshSessionService resets remote shell state when Remote Enhancements runtime is disabled', () => {
  const serviceHarness = SshSessionService.prototype as unknown as RemoteShellEventServiceHarness;
  const event = createRemoteShellEvent();
  const session = createSessionHarness({
    lastCommandDurationMs: 25,
    lastExitCode: 1,
    lastRemoteCommand: 'false',
    pendingRemoteShellEvents: [event],
    remoteEnhancementsRuntimeEnabled: true,
    remoteShellCwd: '/tmp',
    remoteShellForegroundCommand: 'vim',
    remoteShellReady: true,
  });

  serviceHarness.disableRemoteEnhancementsRuntime(session);

  assert.equal(session.remoteEnhancementsRuntimeEnabled, false);
  assert.deepEqual(session.pendingRemoteShellEvents, []);
  assert.equal(session.remoteShellReady, false);
  assert.equal(session.remoteShellCwd, null);
  assert.equal(session.remoteShellForegroundCommand, null);
  assert.equal(session.lastRemoteCommand, null);
  assert.equal(session.lastExitCode, null);
  assert.equal(session.lastCommandDurationMs, null);
});
