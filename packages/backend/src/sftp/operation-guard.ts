/**
 * Stable internal code used when an SFTP request stops completing or making progress.
 */
export const SFTP_OPERATION_TIMEOUT_CODE = 'SFTP_OPERATION_TIMEOUT' as const;

/**
 * Stable internal code used when the owning SSH/SFTP transport becomes unusable.
 */
export const SFTP_TRANSPORT_CLOSED_CODE = 'SFTP_TRANSPORT_CLOSED' as const;

/**
 * Machine-readable failures produced by the ordinary SFTP operation guard.
 */
export type SftpOperationFailureCode = typeof SFTP_OPERATION_TIMEOUT_CODE | typeof SFTP_TRANSPORT_CLOSED_CODE;

/**
 * Describes whether a remote request can change server state.
 */
export type SftpOperationImpact = 'read' | 'mutation';

/**
 * Identifies which deadline ended a guarded operation.
 */
export type SftpOperationTimeoutKind = 'idle' | 'absolute';

/**
 * Context supplied to one guarded callback or stream operation.
 */
export type SftpOperationGuardContext = {
  /**
   * Signal that aborts stream resources when the guard reaches a terminal failure.
   */
  signal: AbortSignal;

  /**
   * Refreshes the idle deadline after verified stream progress.
   */
  markProgress: () => void;
};

/**
 * Configuration for one bounded SFTP callback or stream operation.
 *
 * @template T Operation result type.
 */
export type SftpOperationGuardOptions<T> = {
  /**
   * Diagnostic operation name. It must not contain user-controlled paths.
   */
  operation: string;

  /**
   * Whether the remote request can mutate server state.
   */
  impact: SftpOperationImpact;

  /**
   * Maximum time without completion or verified progress.
   */
  idleTimeoutMs: number;

  /**
   * Maximum wall-clock duration even while a stream continues making progress.
   */
  absoluteTimeoutMs: number;

  /**
   * Session-level signal fired by explicit close or transport failure.
   */
  transportSignal: AbortSignal;

  /**
   * Starts the underlying callback or stream operation.
   */
  start: (context: SftpOperationGuardContext) => Promise<T>;

  /**
   * Invalidates the owning session after either operation deadline.
   */
  onTimeout?: (error: SftpOperationFailure) => void;
};

/**
 * Typed failure that preserves timeout and uncertain-mutation semantics across service layers.
 */
export class SftpOperationFailure extends Error {
  public readonly code: SftpOperationFailureCode;

  public readonly operation: string;

  public readonly outcomeUnknown: boolean;

  /**
   * Creates a stable SFTP lifecycle failure.
   *
   * @param code Machine-readable failure code.
   * @param operation Diagnostic operation name.
   * @param impact Whether the request can mutate remote state.
   * @param timeoutMs Configured deadline when the failure is a timeout.
   * @param timeoutKind Deadline category used to construct precise diagnostics.
   */
  public constructor(
    code: SftpOperationFailureCode,
    operation: string,
    impact: SftpOperationImpact,
    timeoutMs?: number,
    timeoutKind: SftpOperationTimeoutKind = 'idle',
  ) {
    const detail =
      code === SFTP_OPERATION_TIMEOUT_CODE
        ? timeoutKind === 'absolute'
          ? `The ${operation} operation did not complete within the ${timeoutMs ?? 0} ms absolute limit.`
          : `The ${operation} operation did not complete or make progress within ${timeoutMs ?? 0} ms.`
        : `The ${operation} operation was interrupted because the SFTP transport closed.`;
    super(`${code}: ${detail}`);
    this.name = 'SftpOperationFailure';
    this.code = code;
    this.operation = operation;
    this.outcomeUnknown = impact === 'mutation';
  }
}

/**
 * Detects lifecycle failures without relying on user-facing message text.
 *
 * @param error Unknown caught value.
 * @returns Whether the value is a guarded SFTP operation failure.
 */
export const isSftpOperationFailure = (error: unknown): error is SftpOperationFailure => {
  return error instanceof SftpOperationFailure;
};

/**
 * Runs one callback or stream operation with idle and absolute deadlines plus transport cancellation.
 *
 * The guard settles exactly once. Late callbacks and stream completions are observed but ignored,
 * while the local signal lets stream pipelines destroy their resources immediately.
 *
 * @template T Operation result type.
 * @param options Guard configuration.
 * @returns Operation result when it completes before either lifecycle boundary.
 */
export const runGuardedSftpOperation = <T>(options: SftpOperationGuardOptions<T>): Promise<T> => {
  if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs <= 0) {
    return Promise.reject(new RangeError('SFTP operation idle timeout must be a positive finite number.'));
  }
  if (!Number.isFinite(options.absoluteTimeoutMs) || options.absoluteTimeoutMs <= 0) {
    return Promise.reject(new RangeError('SFTP operation absolute timeout must be a positive finite number.'));
  }

  return new Promise<T>((resolve, reject) => {
    const operationController = new AbortController();
    let idleTimer: NodeJS.Timeout | undefined;
    let absoluteTimer: NodeJS.Timeout | undefined;
    let settled = false;

    /**
     * Removes lifecycle listeners and timers after the first terminal result.
     *
     * @returns void.
     */
    const cleanup = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      if (absoluteTimer) {
        clearTimeout(absoluteTimer);
        absoluteTimer = undefined;
      }
      options.transportSignal.removeEventListener('abort', handleTransportAbort);
    };

    /**
     * Resolves the outer operation once and ignores late callbacks.
     *
     * @param value Successful operation result.
     * @returns Whether this call selected the terminal result.
     */
    const settleSuccess = (value: T): boolean => {
      if (settled) {
        return false;
      }

      settled = true;
      cleanup();
      resolve(value);
      return true;
    };

    /**
     * Rejects the outer operation once and aborts resources owned by the operation.
     *
     * @param error Terminal operation failure.
     * @returns Whether this call selected the terminal result.
     */
    const settleFailure = (error: unknown): boolean => {
      if (settled) {
        return false;
      }

      settled = true;
      cleanup();
      operationController.abort(error);
      reject(error);
      return true;
    };

    /**
     * Converts session transport aborts into an operation-specific stable failure.
     *
     * @returns void.
     */
    function handleTransportAbort(): void {
      settleFailure(new SftpOperationFailure(SFTP_TRANSPORT_CLOSED_CODE, options.operation, options.impact));
    }

    /**
     * Selects a stable timeout failure for either lifecycle deadline.
     *
     * @param timeoutMs Configured deadline duration.
     * @param timeoutKind Deadline category that expired.
     * @returns void.
     */
    const handleTimeout = (timeoutMs: number, timeoutKind: SftpOperationTimeoutKind): void => {
      const timeoutError = new SftpOperationFailure(
        SFTP_OPERATION_TIMEOUT_CODE,
        options.operation,
        options.impact,
        timeoutMs,
        timeoutKind,
      );
      if (!settleFailure(timeoutError)) {
        return;
      }

      try {
        options.onTimeout?.(timeoutError);
      } catch (error: unknown) {
        console.warn('[sftp] Failed to invalidate a timed-out SFTP session.', error);
      }
    };

    /**
     * Arms or refreshes the idle deadline after verified work.
     *
     * @returns void.
     */
    const markProgress = (): void => {
      if (settled) {
        return;
      }

      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        handleTimeout(options.idleTimeoutMs, 'idle');
      }, options.idleTimeoutMs);
    };

    options.transportSignal.addEventListener('abort', handleTransportAbort, { once: true });
    if (options.transportSignal.aborted) {
      handleTransportAbort();
      return;
    }

    markProgress();
    absoluteTimer = setTimeout(() => {
      handleTimeout(options.absoluteTimeoutMs, 'absolute');
    }, options.absoluteTimeoutMs);
    try {
      void options.start({ signal: operationController.signal, markProgress }).then(
        (value) => {
          settleSuccess(value);
        },
        (error: unknown) => {
          settleFailure(error);
        },
      );
    } catch (error: unknown) {
      settleFailure(error);
    }
  });
};
