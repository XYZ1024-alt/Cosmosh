/**
 * Describes whether replaying an SFTP operation is safe after session recovery.
 */
export type SftpOperationImpact = 'read' | 'mutation';

/**
 * Mutable holder used to share one in-flight reconnect across concurrent operations.
 */
export type SftpReconnectPromiseRef = {
  /** Current reconnect, cleared after it settles. */
  current: Promise<string> | null;
};

/**
 * Inputs for one SFTP operation guarded by passive session recovery.
 */
export type RunSftpOperationWithReconnectOptions<TResult> = {
  /** Controls whether the failed operation may be replayed after recovery. */
  impact: SftpOperationImpact;
  /** Returns the renderer's latest active session id. */
  getActiveSessionId: () => string;
  /** Creates the error used when the tab has no active session. */
  createNoSessionError: () => Error;
  /** Detects the stale-session failure that permits passive recovery. */
  isReconnectableError: (error: unknown) => boolean;
  /** Repairs the tab session and returns the replacement session id. */
  ensureSession: () => Promise<string>;
  /** Performs the backend request against the supplied session id. */
  operation: (activeSessionId: string) => Promise<TResult>;
};

/**
 * Shares one reconnect promise across all callers observing the same stale session.
 *
 * @param reconnectPromiseRef Mutable holder for the current reconnect.
 * @param reconnect Creates a replacement session when no reconnect is already running.
 * @returns The shared replacement session id promise.
 */
export const ensureSharedSftpReconnect = (
  reconnectPromiseRef: SftpReconnectPromiseRef,
  reconnect: () => Promise<string>,
): Promise<string> => {
  const existingReconnect = reconnectPromiseRef.current;
  if (existingReconnect) {
    return existingReconnect;
  }

  const reconnectPromise = reconnect().finally(() => {
    if (reconnectPromiseRef.current === reconnectPromise) {
      reconnectPromiseRef.current = null;
    }
  });
  reconnectPromiseRef.current = reconnectPromise;
  return reconnectPromise;
};

/**
 * Runs one SFTP operation with impact-aware passive session recovery.
 *
 * Read operations may be replayed once because they do not change remote state.
 * Mutations repair the session for later work but preserve the original failure,
 * because the remote outcome may be unknown when the stale response arrives.
 *
 * @param options Operation, session accessors, and reconnect policy.
 * @returns The operation result for an initial success or one safe read replay.
 */
export const runSftpOperationWithReconnect = async <TResult>({
  impact,
  getActiveSessionId,
  createNoSessionError,
  isReconnectableError,
  ensureSession,
  operation,
}: RunSftpOperationWithReconnectOptions<TResult>): Promise<TResult> => {
  const initialSessionId = getActiveSessionId();
  if (!initialSessionId) {
    throw createNoSessionError();
  }

  try {
    return await operation(initialSessionId);
  } catch (originalError: unknown) {
    if (!isReconnectableError(originalError)) {
      throw originalError;
    }

    const latestSessionId = getActiveSessionId();
    if (impact === 'read') {
      const retrySessionId =
        latestSessionId && latestSessionId !== initialSessionId ? latestSessionId : await ensureSession();
      return await operation(retrySessionId);
    }

    if (!latestSessionId || latestSessionId === initialSessionId) {
      void ensureSession().catch(() => {
        // The reconnect task reports its own failure; the mutation must retain its original outcome.
      });
    }
    throw originalError;
  }
};
