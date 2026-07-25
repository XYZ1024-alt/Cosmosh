import type { ApiErrorResponse, ApiSftpStartTaskRequest, ApiSftpTaskData } from '@cosmosh/api-contract';

import type { SftpDownloadTargetAuthorizationRegistry } from './sftp-download-target-authorizations';

const TERMINAL_SFTP_TASK_STATES = new Set<ApiSftpTaskData['state']>(['succeeded', 'failed', 'cancelled']);

/**
 * Consumes the exact renderer-owned local path before an asynchronous download task is accepted.
 *
 * @param registry Main-owned download target authorization registry.
 * @param ownerWebContentsId Renderer webContents that submitted the task.
 * @param request Untrusted renderer task request.
 * @returns Task request with the canonical authorized local path.
 */
export const authorizeSftpTaskStartRequest = (
  registry: SftpDownloadTargetAuthorizationRegistry,
  ownerWebContentsId: number,
  request: ApiSftpStartTaskRequest,
): ApiSftpStartTaskRequest => {
  if (request.operation !== 'download') {
    return request;
  }

  const localPath = registry.consumeForTransfer(
    ownerWebContentsId,
    request.payload.localPath,
    request.payload.transferId,
  );
  return {
    ...request,
    payload: {
      ...request.payload,
      localPath,
    },
  };
};

/**
 * Finalizes or enables the one permitted retry after task admission fails.
 *
 * @param registry Main-owned download target authorization registry.
 * @param ownerWebContentsId Renderer webContents that submitted the task.
 * @param request Authorized task request.
 * @param response Backend error response returned instead of task acceptance.
 * @returns void.
 */
export const settleRejectedSftpTaskStart = (
  registry: SftpDownloadTargetAuthorizationRegistry,
  ownerWebContentsId: number,
  request: ApiSftpStartTaskRequest,
  response: ApiErrorResponse,
): void => {
  if (request.operation !== 'download') {
    return;
  }

  if (response.code === 'SFTP_SESSION_NOT_FOUND') {
    registry.allowTransferRetry(ownerWebContentsId, request.payload.transferId);
    return;
  }

  registry.completeTransfer(ownerWebContentsId, request.payload.transferId);
};

/**
 * Releases an asynchronous download authorization after its backend task reaches a terminal state.
 *
 * @param registry Main-owned download target authorization registry.
 * @param ownerWebContentsId Renderer observing the task.
 * @param task Backend task snapshot.
 * @returns void.
 */
export const observeSftpTaskForDownloadAuthorization = (
  registry: SftpDownloadTargetAuthorizationRegistry,
  ownerWebContentsId: number,
  task: ApiSftpTaskData,
): void => {
  if (task.operation !== 'download' || !task.transferId || !TERMINAL_SFTP_TASK_STATES.has(task.state)) {
    return;
  }

  registry.completeTransfer(ownerWebContentsId, task.transferId);
};
