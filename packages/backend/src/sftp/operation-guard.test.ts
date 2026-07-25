import assert from 'node:assert/strict';
import test from 'node:test';

import { runGuardedSftpOperation, SFTP_OPERATION_TIMEOUT_CODE, SftpOperationFailure } from './operation-guard.js';

test('runGuardedSftpOperation enforces the absolute limit while progress refreshes the idle deadline', async () => {
  const transportController = new AbortController();
  let progressTimer: NodeJS.Timeout | undefined;
  let timeoutCallbackCount = 0;

  await assert.rejects(
    runGuardedSftpOperation({
      operation: 'progressing-stream',
      impact: 'read',
      idleTimeoutMs: 500,
      absoluteTimeoutMs: 50,
      transportSignal: transportController.signal,
      start: async ({ signal, markProgress }) => {
        return await new Promise<never>((_resolve, reject) => {
          progressTimer = setInterval(markProgress, 5);
          signal.addEventListener(
            'abort',
            () => {
              if (progressTimer) {
                clearInterval(progressTimer);
              }
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
      onTimeout: () => {
        timeoutCallbackCount += 1;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SftpOperationFailure);
      assert.equal(error.code, SFTP_OPERATION_TIMEOUT_CODE);
      assert.equal(error.outcomeUnknown, false);
      assert.match(error.message, /absolute limit/);
      return true;
    },
  );

  if (progressTimer) {
    clearInterval(progressTimer);
  }
  assert.equal(timeoutCallbackCount, 1);
});
