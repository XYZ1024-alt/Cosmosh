import type { ApiSftpGetTaskResponse, ApiSftpTaskData, ApiSftpTaskResult } from '@cosmosh/api-contract';

const TERMINAL_SFTP_TASK_STATES = new Set<ApiSftpTaskData['state']>(['succeeded', 'failed', 'cancelled']);

/**
 * Inputs for polling one accepted backend SFTP task.
 */
type WaitForSftpTaskOptions = {
  acceptedTask: ApiSftpTaskData;
  getTask: (sessionId: string, taskId: string) => Promise<ApiSftpGetTaskResponse>;
  onSnapshot?: (task: ApiSftpTaskData) => void;
  pollIntervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
};

/**
 * Returns whether a backend SFTP task snapshot is terminal.
 *
 * @param task Backend task snapshot.
 * @returns Whether no further polling is required.
 */
export const isTerminalSftpTask = (task: ApiSftpTaskData): boolean => {
  return TERMINAL_SFTP_TASK_STATES.has(task.state);
};

/**
 * Returns the structured result that one operation wrapper may safely consume.
 *
 * Failed batch tasks retain per-entry results so the renderer can reconcile successful
 * mutations before surfacing the partial failure. Other failed tasks remain errors.
 *
 * @param task Terminal backend task snapshot.
 * @param allowFailedResult Whether a failed task's retained result may be consumed.
 * @returns Structured task result, or null when the caller must surface a task error.
 */
export const resolveSftpTaskResult = (task: ApiSftpTaskData, allowFailedResult = false): ApiSftpTaskResult | null => {
  if (!task.result) {
    return null;
  }

  return task.state === 'succeeded' || (allowFailedResult && task.state === 'failed') ? task.result : null;
};

/**
 * Polls an accepted task against its original session, even if the tab later reconnects.
 *
 * @param options Accepted snapshot, typed task reader, and optional test hooks.
 * @returns Terminal backend task snapshot.
 */
export const waitForSftpTask = async ({
  acceptedTask,
  getTask,
  onSnapshot,
  pollIntervalMs = 500,
  wait = (delayMs) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs)),
}: WaitForSftpTaskOptions): Promise<ApiSftpTaskData> => {
  const acceptedSessionId = acceptedTask.sessionId;
  const taskId = acceptedTask.taskId;
  let current = acceptedTask;
  onSnapshot?.(current);

  while (!isTerminalSftpTask(current)) {
    await wait(pollIntervalMs);
    const response = await getTask(acceptedSessionId, taskId);
    current = response.data;
    onSnapshot?.(current);
  }

  return current;
};
