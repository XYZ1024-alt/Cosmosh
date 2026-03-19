import assert from 'node:assert/strict';
import test from 'node:test';

import { BaseTerminalSessionService, type TerminalManagedSessionBase } from './base-session-service.js';

type OutboundMessage =
  | {
      type: 'output';
      data: string;
    }
  | {
      type: 'exit';
      reason: string;
    };

type MockSession = TerminalManagedSessionBase & {
  sent: OutboundMessage[];
};

class MockTerminalService extends BaseTerminalSessionService<MockSession, OutboundMessage> {
  public constructor() {
    super({
      host: '127.0.0.1',
      port: 0,
      pathPrefix: '/ws/test/',
    });
  }

  public addSession(session: MockSession): void {
    this.registerSession(session);
  }

  public pushOutput(session: MockSession, data: string): void {
    this.sendServerMessage(session, {
      type: 'output',
      data,
    });
  }

  protected handleClientMessage(): void {
    // No-op for test.
  }

  protected onSessionAttached(): void {
    // No-op for test.
  }

  protected disposeSession(sessionId: string): void {
    this.disposeSessionWithCommonLifecycle(sessionId, 'ws.sessionClosedByApiRequest', undefined, {
      createExitMessage: (reason) => ({ type: 'exit', reason }),
      disposeTransport: () => undefined,
    });
  }
}

test('pending output buffer enforces hard caps and tracks dropped chunks', async () => {
  const service = new MockTerminalService();

  try {
    const session: MockSession = {
      sessionId: 'session-1',
      websocketToken: 'token-1',
      pendingOutput: [],
      pendingOutputBytes: 0,
      pendingOutputDropCount: 0,
      attachTimeout: setTimeout(() => undefined, 60_000),
      t: ((key: string) => key) as MockSession['t'],
      socket: null,
      disposed: false,
      telemetryInterval: null,
      historySyncTimeout: null,
      sent: [],
    };

    service.addSession(session);

    for (let index = 0; index < 3000; index += 1) {
      service.pushOutput(session, `line-${index.toString().padStart(4, '0')}::${'x'.repeat(600)}`);
    }

    assert.ok(session.pendingOutput.length <= 2048);
    assert.ok(session.pendingOutputBytes <= 1024 * 1024);
    assert.ok(session.pendingOutputDropCount > 0);
  } finally {
    await service.stop();
  }
});
