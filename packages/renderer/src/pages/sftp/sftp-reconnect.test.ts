import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureSharedSftpReconnect,
  isSftpSessionNotFoundError,
  runSftpOperationWithReconnect,
  type SftpOperationImpact,
  type SftpReconnectPromiseRef,
} from './sftp-reconnect';

const STALE_SESSION_ERROR = new Error('stale session');

test('session-not-found detection accepts both admission and terminal task failures', () => {
  const apiError = Object.assign(new Error('Session not found.'), {
    name: 'BackendApiError',
    code: 'SFTP_SESSION_NOT_FOUND',
  });
  const taskError = Object.assign(new Error('Session not found.'), {
    name: 'BackendSftpTaskError',
    code: 'SFTP_SESSION_NOT_FOUND',
  });

  assert.equal(isSftpSessionNotFoundError(apiError), true);
  assert.equal(isSftpSessionNotFoundError(taskError), true);
  assert.equal(
    isSftpSessionNotFoundError(
      Object.assign(new Error('Operation failed.'), {
        name: 'BackendSftpTaskError',
        code: 'SFTP_OPERATION_FAILED',
      }),
    ),
    false,
  );
});

/**
 * Creates the common runner inputs used by reconnect policy tests.
 *
 * @param impact Whether the operation is safe to replay.
 * @param overrides Per-test session and operation behavior.
 * @returns A reconnect-aware operation promise.
 */
const runOperation = <TResult>(
  impact: SftpOperationImpact,
  overrides: {
    getActiveSessionId: () => string;
    ensureSession: () => Promise<string>;
    operation: (activeSessionId: string) => Promise<TResult>;
    isReconnectableError?: (error: unknown) => boolean;
  },
): Promise<TResult> => {
  return runSftpOperationWithReconnect({
    impact,
    getActiveSessionId: overrides.getActiveSessionId,
    createNoSessionError: () => new Error('no session'),
    isReconnectableError: overrides.isReconnectableError ?? ((error) => error === STALE_SESSION_ERROR),
    ensureSession: overrides.ensureSession,
    operation: overrides.operation,
  });
};

test('ensureSharedSftpReconnect shares one in-flight reconnect and clears it after settlement', async () => {
  const reconnectPromiseRef: SftpReconnectPromiseRef = { current: null };
  let resolveReconnect: ((sessionId: string) => void) | undefined;
  let reconnectCount = 0;
  const reconnect = (): Promise<string> => {
    reconnectCount += 1;
    return new Promise((resolve) => {
      resolveReconnect = resolve;
    });
  };

  const first = ensureSharedSftpReconnect(reconnectPromiseRef, reconnect);
  const second = ensureSharedSftpReconnect(reconnectPromiseRef, reconnect);

  assert.equal(first, second);
  assert.equal(reconnectCount, 1);
  resolveReconnect?.('session-2');
  assert.equal(await first, 'session-2');
  assert.equal(reconnectPromiseRef.current, null);

  const third = ensureSharedSftpReconnect(reconnectPromiseRef, async () => 'session-3');
  assert.notEqual(third, first);
  assert.equal(await third, 'session-3');
});

test('ensureSharedSftpReconnect clears a rejected reconnect so a later attempt can recover', async () => {
  const reconnectPromiseRef: SftpReconnectPromiseRef = { current: null };
  const reconnectError = new Error('reconnect failed');
  let reconnectCount = 0;

  const first = ensureSharedSftpReconnect(reconnectPromiseRef, async () => {
    reconnectCount += 1;
    throw reconnectError;
  });
  const second = ensureSharedSftpReconnect(reconnectPromiseRef, async () => 'unexpected');

  assert.equal(first, second);
  await assert.rejects(first, reconnectError);
  assert.equal(reconnectPromiseRef.current, null);

  const recovered = ensureSharedSftpReconnect(reconnectPromiseRef, async () => {
    reconnectCount += 1;
    return 'session-2';
  });
  assert.equal(await recovered, 'session-2');
  assert.equal(reconnectCount, 2);
});

test('read operation reconnects and replays once after a stale-session failure', async () => {
  let activeSessionId = 'session-1';
  const operationSessionIds: string[] = [];
  let reconnectCount = 0;

  const result = await runOperation('read', {
    getActiveSessionId: () => activeSessionId,
    ensureSession: async () => {
      reconnectCount += 1;
      activeSessionId = 'session-2';
      return activeSessionId;
    },
    operation: async (sessionId) => {
      operationSessionIds.push(sessionId);
      if (sessionId === 'session-1') {
        throw STALE_SESSION_ERROR;
      }
      return 'result';
    },
  });

  assert.equal(result, 'result');
  assert.deepEqual(operationSessionIds, ['session-1', 'session-2']);
  assert.equal(reconnectCount, 1);
});

test('concurrent stale reads share one reconnect before each replays once', async () => {
  const reconnectPromiseRef: SftpReconnectPromiseRef = { current: null };
  let activeSessionId = 'session-1';
  let reconnectCount = 0;
  let resolveReconnect: ((sessionId: string) => void) | undefined;
  const operationSessionIds: [string[], string[]] = [[], []];
  const ensureSession = (): Promise<string> => {
    return ensureSharedSftpReconnect(reconnectPromiseRef, () => {
      reconnectCount += 1;
      return new Promise((resolve) => {
        resolveReconnect = (sessionId) => {
          activeSessionId = sessionId;
          resolve(sessionId);
        };
      });
    });
  };
  const createRead = (index: 0 | 1): Promise<string> =>
    runOperation('read', {
      getActiveSessionId: () => activeSessionId,
      ensureSession,
      operation: async (sessionId) => {
        operationSessionIds[index].push(sessionId);
        if (sessionId === 'session-1') {
          throw STALE_SESSION_ERROR;
        }
        return `result-${index}`;
      },
    });

  const first = createRead(0);
  const second = createRead(1);
  await Promise.resolve();

  assert.equal(reconnectCount, 1);
  resolveReconnect?.('session-2');
  assert.deepEqual(await Promise.all([first, second]), ['result-0', 'result-1']);
  assert.deepEqual(operationSessionIds, [
    ['session-1', 'session-2'],
    ['session-1', 'session-2'],
  ]);
});

test('read operation uses an already-recovered session without starting another reconnect', async () => {
  let activeSessionId = 'session-1';
  const operationSessionIds: string[] = [];

  const result = await runOperation('read', {
    getActiveSessionId: () => activeSessionId,
    ensureSession: async () => {
      assert.fail('unexpected reconnect');
    },
    operation: async (sessionId) => {
      operationSessionIds.push(sessionId);
      if (sessionId === 'session-1') {
        activeSessionId = 'session-2';
        throw STALE_SESSION_ERROR;
      }
      return 'result';
    },
  });

  assert.equal(result, 'result');
  assert.deepEqual(operationSessionIds, ['session-1', 'session-2']);
});

test('read operation never reconnects or replays more than once', async () => {
  let activeSessionId = 'session-1';
  const operationSessionIds: string[] = [];
  let reconnectCount = 0;

  await assert.rejects(
    runOperation('read', {
      getActiveSessionId: () => activeSessionId,
      ensureSession: async () => {
        reconnectCount += 1;
        activeSessionId = 'session-2';
        return activeSessionId;
      },
      operation: async (sessionId) => {
        operationSessionIds.push(sessionId);
        throw STALE_SESSION_ERROR;
      },
    }),
    STALE_SESSION_ERROR,
  );

  assert.deepEqual(operationSessionIds, ['session-1', 'session-2']);
  assert.equal(reconnectCount, 1);
});

test('mutation starts session repair but rejects immediately without replaying', async () => {
  let activeSessionId = 'session-1';
  const operationSessionIds: string[] = [];
  let reconnectCount = 0;
  let resolveReconnect: ((sessionId: string) => void) | undefined;

  await assert.rejects(
    runOperation('mutation', {
      getActiveSessionId: () => activeSessionId,
      ensureSession: () => {
        reconnectCount += 1;
        return new Promise((resolve) => {
          resolveReconnect = (sessionId) => {
            activeSessionId = sessionId;
            resolve(sessionId);
          };
        });
      },
      operation: async (sessionId) => {
        operationSessionIds.push(sessionId);
        throw STALE_SESSION_ERROR;
      },
    }),
    STALE_SESSION_ERROR,
  );

  assert.deepEqual(operationSessionIds, ['session-1']);
  assert.equal(reconnectCount, 1);
  assert.equal(activeSessionId, 'session-1');

  resolveReconnect?.('session-2');
  await Promise.resolve();
  assert.equal(activeSessionId, 'session-2');
});

test('mutation preserves its original error when session repair also fails', async () => {
  const reconnectError = new Error('reconnect failed');
  let operationCount = 0;

  await assert.rejects(
    runOperation('mutation', {
      getActiveSessionId: () => 'session-1',
      ensureSession: async () => {
        throw reconnectError;
      },
      operation: async () => {
        operationCount += 1;
        throw STALE_SESSION_ERROR;
      },
    }),
    STALE_SESSION_ERROR,
  );

  assert.equal(operationCount, 1);
});

test('non-reconnectable failures preserve the original error without session repair', async () => {
  const operationError = new Error('permission denied');
  let reconnectCount = 0;

  await assert.rejects(
    runOperation('read', {
      getActiveSessionId: () => 'session-1',
      ensureSession: async () => {
        reconnectCount += 1;
        return 'session-2';
      },
      operation: async () => {
        throw operationError;
      },
    }),
    operationError,
  );

  assert.equal(reconnectCount, 0);
});

test('missing session fails before invoking the operation or reconnecting', async () => {
  let operationCount = 0;
  let reconnectCount = 0;

  await assert.rejects(
    runOperation('read', {
      getActiveSessionId: () => '',
      ensureSession: async () => {
        reconnectCount += 1;
        return 'session-2';
      },
      operation: async () => {
        operationCount += 1;
        return 'unexpected';
      },
    }),
    /no session/,
  );

  assert.equal(operationCount, 0);
  assert.equal(reconnectCount, 0);
});
