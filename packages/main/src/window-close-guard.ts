/**
 * Counts of active SSH and SFTP connections reported by the backend runtime.
 */
export type ActiveConnectionSummary = {
  sshCount: number;
  sftpCount: number;
  totalCount: number;
};

/**
 * User action that initiated the guarded close flow.
 */
export type ConnectionCloseIntent = 'quit' | 'window';

/**
 * Stage that failed while evaluating one guarded close request.
 */
export type ConnectionCloseGuardErrorStage = 'confirmation' | 'disconnect' | 'preference' | 'probe';

type ConnectionCloseGuardOptions = {
  readActiveConnections: () => Promise<ActiveConnectionSummary>;
  readCloseConfirmationEnabled: () => Promise<boolean>;
  confirmClose: (input: { intent: ConnectionCloseIntent; summary: ActiveConnectionSummary | null }) => Promise<boolean>;
  closeActiveConnections: () => Promise<void>;
  onApproved: (intent: ConnectionCloseIntent) => Promise<void> | void;
  onError: (stage: ConnectionCloseGuardErrorStage, error: unknown) => void;
};

/**
 * Validates backend connection counts before Main uses them for a close decision.
 *
 * @param value Untrusted backend response data.
 * @returns Validated summary, or `null` when counts are malformed or inconsistent.
 */
export const parseActiveConnectionSummary = (value: unknown): ActiveConnectionSummary | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const sshCount = candidate.sshCount;
  const sftpCount = candidate.sftpCount;
  const totalCount = candidate.totalCount;

  if (
    !Number.isSafeInteger(sshCount) ||
    !Number.isSafeInteger(sftpCount) ||
    !Number.isSafeInteger(totalCount) ||
    (sshCount as number) < 0 ||
    (sftpCount as number) < 0 ||
    (totalCount as number) < 0 ||
    totalCount !== (sshCount as number) + (sftpCount as number)
  ) {
    return null;
  }

  return {
    sshCount: sshCount as number,
    sftpCount: sftpCount as number,
    totalCount: totalCount as number,
  };
};

/**
 * Serializes close decisions so repeated title-bar, menu, or shortcut requests
 * cannot open duplicate prompts or run overlapping disconnect operations.
 */
export class ConnectionCloseGuard {
  private pendingRequest: Promise<void> | null = null;

  /**
   * Creates a guarded close coordinator with injected runtime and UI boundaries.
   *
   * @param options Backend, confirmation, and lifecycle callbacks.
   */
  public constructor(private readonly options: ConnectionCloseGuardOptions) {}

  /**
   * Evaluates one close intent, reusing any decision already in progress.
   *
   * @param intent Whether the caller is closing one window or quitting the app.
   * @returns Promise resolved after the request is canceled or approved.
   */
  public requestClose(intent: ConnectionCloseIntent): Promise<void> {
    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    const request = this.runRequest(intent).finally(() => {
      if (this.pendingRequest === request) {
        this.pendingRequest = null;
      }
    });
    this.pendingRequest = request;
    return request;
  }

  /**
   * Reads authoritative state, asks only when needed, then disconnects before approval.
   *
   * @param intent Close action being evaluated.
   * @returns Promise resolved after the guarded decision completes.
   */
  private async runRequest(intent: ConnectionCloseIntent): Promise<void> {
    let summary: ActiveConnectionSummary | null = null;

    try {
      summary = await this.options.readActiveConnections();
    } catch (error: unknown) {
      this.options.onError('probe', error);
    }

    if (summary?.totalCount === 0) {
      await this.options.onApproved(intent);
      return;
    }

    let confirmationEnabled = true;
    try {
      confirmationEnabled = await this.options.readCloseConfirmationEnabled();
    } catch (error: unknown) {
      // Preference failures preserve the safer default rather than silently skipping the warning.
      this.options.onError('preference', error);
    }

    if (confirmationEnabled) {
      let confirmed = false;
      try {
        confirmed = await this.options.confirmClose({ intent, summary });
      } catch (error: unknown) {
        this.options.onError('confirmation', error);
        return;
      }

      if (!confirmed) {
        return;
      }
    }

    try {
      await this.options.closeActiveConnections();
    } catch (error: unknown) {
      // The user already approved closing. App shutdown remains the final cleanup boundary.
      this.options.onError('disconnect', error);
    }

    await this.options.onApproved(intent);
  }
}
