import { randomUUID } from 'node:crypto';

import type { AppCloseConfirmationRequest, AppCloseConfirmationResponse } from '@cosmosh/api-contract';

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 30_000;

/**
 * Renderer endpoint that can display one close confirmation request.
 */
export type RendererCloseConfirmationTarget = {
  webContentsId: number;
  sendRequest: (request: AppCloseConfirmationRequest) => void;
  subscribeDestroyed: (listener: () => void) => () => void;
};

/**
 * Failure stages surfaced by the renderer confirmation broker.
 */
export type RendererCloseConfirmationErrorStage = 'send' | 'timeout' | 'unavailable';

type RendererCloseConfirmationBrokerOptions = {
  confirmationTimeoutMs?: number;
  createRequestId?: () => string;
  onError: (stage: RendererCloseConfirmationErrorStage, error: unknown) => void;
};

type PendingRendererCloseConfirmation = {
  ownerWebContentsId: number;
  promise: Promise<boolean>;
  requestId: string;
  settle: (confirmed: boolean) => void;
  timeout: NodeJS.Timeout | null;
  unsubscribeDestroyed: () => void;
};

/**
 * Bridges one Main-owned close decision to the renderer while binding the
 * response to both an opaque request ID and the originating webContents.
 */
export class RendererCloseConfirmationBroker {
  private readonly confirmationTimeoutMs: number;

  private readonly createRequestId: () => string;

  private pendingConfirmation: PendingRendererCloseConfirmation | null = null;

  /**
   * Creates a renderer close confirmation broker.
   *
   * @param options Timeout, request identity, and error reporting dependencies.
   */
  public constructor(private readonly options: RendererCloseConfirmationBrokerOptions) {
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    this.createRequestId = options.createRequestId ?? randomUUID;
  }

  /**
   * Requests renderer confirmation, or allows closure when no renderer exists.
   *
   * A missing or destroyed renderer cannot present a dialog and must not make
   * the application impossible to exit. A responsive renderer times out to the
   * safe cancel decision.
   *
   * @param target Renderer endpoint that owns the visible main window.
   * @returns Promise resolving to the user's confirmation decision.
   */
  public requestConfirmation(target: RendererCloseConfirmationTarget | null): Promise<boolean> {
    if (this.pendingConfirmation) {
      return this.pendingConfirmation.promise;
    }

    if (!target) {
      this.options.onError('unavailable', new Error('Renderer close confirmation target is unavailable.'));
      return Promise.resolve(true);
    }

    const request: AppCloseConfirmationRequest = {
      requestId: this.createRequestId(),
    };
    let resolvePromise!: (confirmed: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    const pending: PendingRendererCloseConfirmation = {
      ownerWebContentsId: target.webContentsId,
      promise,
      requestId: request.requestId,
      settle: () => undefined,
      timeout: null,
      unsubscribeDestroyed: () => undefined,
    };

    pending.settle = (confirmed: boolean): void => {
      if (this.pendingConfirmation !== pending) {
        return;
      }

      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.unsubscribeDestroyed();
      this.pendingConfirmation = null;
      resolvePromise(confirmed);
    };
    pending.timeout = setTimeout(() => {
      this.options.onError('timeout', new Error('Renderer close confirmation timed out.'));
      pending.settle(false);
    }, this.confirmationTimeoutMs);
    this.pendingConfirmation = pending;
    pending.unsubscribeDestroyed = target.subscribeDestroyed(() => {
      pending.settle(true);
    });

    try {
      target.sendRequest(request);
    } catch (error: unknown) {
      this.options.onError('send', error);
      pending.settle(true);
    }

    return promise;
  }

  /**
   * Resolves the pending request only when sender identity and request ID match.
   *
   * @param senderWebContentsId IPC sender webContents identifier.
   * @param response Validated renderer response payload.
   * @returns Whether the response matched and resolved the pending request.
   */
  public resolveConfirmation(senderWebContentsId: number, response: AppCloseConfirmationResponse): boolean {
    const pending = this.pendingConfirmation;
    if (!pending || senderWebContentsId !== pending.ownerWebContentsId || response.requestId !== pending.requestId) {
      return false;
    }

    pending.settle(response.confirmed);
    return true;
  }
}
