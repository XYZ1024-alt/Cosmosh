import { API_CODES, type ApiSftpArchiveCapabilitiesData } from '@cosmosh/api-contract';

const ARCHIVE_CAPABILITY_RETRY_INTERVAL_MS = 250;
const ARCHIVE_CAPABILITY_MAX_RETRY_INTERVAL_MS = 2_000;

/**
 * Checks whether a backend-style error carries the expected stable API code.
 *
 * @param error Candidate request failure.
 * @param code Expected backend API code.
 * @returns Whether the error exposes the requested code.
 */
const hasBackendApiErrorCode = (error: unknown, code: string): boolean => {
  return error instanceof Error && 'code' in error && error.code === code;
};

/**
 * Waits for the next archive capability admission attempt or an owning lifecycle cancellation.
 *
 * @param delayMs Retry delay in milliseconds.
 * @param signal Lifecycle cancellation signal.
 * @returns A promise that settles after the delay or immediately after cancellation.
 */
const waitForArchiveCapabilityRetry = async (delayMs: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timerId);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timerId = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) {
      finish();
    }
  });
};

/**
 * Loads archive capabilities after the session's exclusive scheduler claim becomes available.
 *
 * Only the explicit busy response is retried. Transport, exec, and probe failures remain
 * fail-closed so the renderer never advertises archive operations without confirmed support.
 *
 * @param sessionId Active SFTP session id.
 * @param signal Lifecycle cancellation signal.
 * @param loadCapabilities Backend capability request.
 * @param retryDelayMs Delay between immediate-only admission attempts.
 * @returns Confirmed capabilities, or `null` when the owning lifecycle is cancelled.
 */
export const loadSftpArchiveCapabilitiesWithRetry = async (
  sessionId: string,
  signal: AbortSignal,
  loadCapabilities: (activeSessionId: string) => Promise<ApiSftpArchiveCapabilitiesData>,
  retryDelayMs = ARCHIVE_CAPABILITY_RETRY_INTERVAL_MS,
): Promise<ApiSftpArchiveCapabilitiesData | null> => {
  let currentRetryDelayMs = Math.max(0, retryDelayMs);

  while (!signal.aborted) {
    try {
      const capabilities = await loadCapabilities(sessionId);
      return signal.aborted ? null : capabilities;
    } catch (error: unknown) {
      if (signal.aborted || !hasBackendApiErrorCode(error, API_CODES.sftpArchiveBusy)) {
        if (signal.aborted) {
          return null;
        }
        throw error;
      }
    }

    await waitForArchiveCapabilityRetry(currentRetryDelayMs, signal);
    currentRetryDelayMs = Math.min(currentRetryDelayMs * 2, ARCHIVE_CAPABILITY_MAX_RETRY_INTERVAL_MS);
  }

  return null;
};
