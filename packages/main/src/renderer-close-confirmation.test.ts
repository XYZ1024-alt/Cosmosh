import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppCloseConfirmationRequest } from '@cosmosh/api-contract';

import {
  RendererCloseConfirmationBroker,
  type RendererCloseConfirmationErrorStage,
  type RendererCloseConfirmationTarget,
} from './renderer-close-confirmation';

type TestTarget = RendererCloseConfirmationTarget & {
  destroy: () => void;
  requests: AppCloseConfirmationRequest[];
};

/**
 * Creates a controllable renderer target for broker lifecycle tests.
 *
 * @param webContentsId Test renderer identity.
 * @returns Renderer target with request capture and destruction control.
 */
const createTestTarget = (webContentsId: number): TestTarget => {
  const requests: AppCloseConfirmationRequest[] = [];
  let destroyedListener: (() => void) | null = null;

  return {
    webContentsId,
    requests,
    sendRequest: (request) => {
      requests.push(request);
    },
    subscribeDestroyed: (listener) => {
      destroyedListener = listener;
      return () => {
        destroyedListener = null;
      };
    },
    destroy: () => {
      destroyedListener?.();
    },
  };
};

test('renderer confirmation resolves only for the matching sender and request ID', async () => {
  const errors: RendererCloseConfirmationErrorStage[] = [];
  const broker = new RendererCloseConfirmationBroker({
    createRequestId: () => 'request-1',
    onError: (stage) => errors.push(stage),
  });
  const target = createTestTarget(12);
  const confirmation = broker.requestConfirmation(target);

  assert.deepEqual(target.requests, [{ requestId: 'request-1' }]);
  assert.equal(broker.resolveConfirmation(99, { requestId: 'request-1', confirmed: true }), false);
  assert.equal(broker.resolveConfirmation(12, { requestId: 'wrong', confirmed: true }), false);
  assert.equal(broker.resolveConfirmation(12, { requestId: 'request-1', confirmed: false }), true);
  assert.equal(await confirmation, false);
  assert.deepEqual(errors, []);
});

test('renderer confirmation allows close when the renderer is unavailable or destroyed', async () => {
  const errors: RendererCloseConfirmationErrorStage[] = [];
  const broker = new RendererCloseConfirmationBroker({
    createRequestId: () => 'request-2',
    onError: (stage) => errors.push(stage),
  });

  assert.equal(await broker.requestConfirmation(null), true);
  assert.deepEqual(errors, ['unavailable']);

  const target = createTestTarget(13);
  const confirmation = broker.requestConfirmation(target);
  target.destroy();
  assert.equal(await confirmation, true);
});

test('renderer confirmation timeout keeps the window open', async () => {
  const errors: RendererCloseConfirmationErrorStage[] = [];
  const broker = new RendererCloseConfirmationBroker({
    confirmationTimeoutMs: 5,
    createRequestId: () => 'request-3',
    onError: (stage) => errors.push(stage),
  });

  const confirmation = broker.requestConfirmation(createTestTarget(14));

  assert.equal(await confirmation, false);
  assert.deepEqual(errors, ['timeout']);
});
