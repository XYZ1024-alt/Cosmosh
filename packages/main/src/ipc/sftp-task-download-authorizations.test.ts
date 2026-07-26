import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { ApiSftpStartTaskRequest, ApiSftpTaskData } from '@cosmosh/api-contract';

import { SftpDownloadTargetAuthorizationRegistry } from './sftp-download-target-authorizations';
import {
  authorizeSftpTaskStartRequest,
  observeSftpTaskForDownloadAuthorization,
  settleRejectedSftpTaskStart,
} from './sftp-task-download-authorizations';

const createDownloadTaskRequest = (
  localPath: string,
  transferId = 'd1156f6e-8d6d-4890-975d-9ad4e81ffcea',
): ApiSftpStartTaskRequest => ({
  operation: 'download',
  payload: {
    path: '/remote/report.csv',
    localPath,
    transferId,
  },
});

const createDownloadTask = (
  transferId: string,
  state: ApiSftpTaskData['state'],
  errorCode?: ApiSftpTaskData['errorCode'],
): ApiSftpTaskData => {
  return {
    sessionId: 'session-1',
    taskId: '1ee18f90-ccbc-4ff1-b073-cd44d12353bf',
    operation: 'download',
    state,
    remotePaths: ['/remote/report.csv'],
    transferId,
    createdAt: new Date(0).toISOString(),
    deadlineAt: new Date(60_000).toISOString(),
    ...(errorCode ? { errorCode } : {}),
  };
};

test('asynchronous download task admission rejects the wrong owner, path, and transfer id', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const ownerWebContentsId = 41;
  const localPath = registry.authorize(ownerWebContentsId, path.join('downloads', 'report.csv'), {
    reusable: false,
  });
  const request = createDownloadTaskRequest(localPath);

  assert.throws(() => authorizeSftpTaskStartRequest(registry, 42, request), /not authorized/);
  assert.throws(
    () => authorizeSftpTaskStartRequest(registry, ownerWebContentsId, createDownloadTaskRequest(`${localPath}.other`)),
    /not authorized/,
  );

  const authorized = authorizeSftpTaskStartRequest(registry, ownerWebContentsId, request);
  assert.equal(authorized.operation, 'download');
  assert.equal(authorized.payload.localPath, localPath);
  assert.throws(
    () =>
      authorizeSftpTaskStartRequest(
        registry,
        ownerWebContentsId,
        createDownloadTaskRequest(localPath, 'e2916ac8-76fc-4b44-8714-271b5ab0fe72'),
      ),
    /not authorized/,
  );
});

test('missing-session admission preserves one exact retry and terminal observation releases it', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const ownerWebContentsId = 43;
  const transferId = '2affffea-ef0b-4dac-b8da-71ee9bc81e93';
  const localPath = registry.authorize(ownerWebContentsId, path.join('downloads', 'archive.bin'), {
    reusable: false,
  });
  const request = createDownloadTaskRequest(localPath, transferId);

  const firstAuthorized = authorizeSftpTaskStartRequest(registry, ownerWebContentsId, request);
  settleRejectedSftpTaskStart(registry, ownerWebContentsId, firstAuthorized, {
    success: false,
    code: 'SFTP_SESSION_NOT_FOUND',
    message: 'Session not found.',
    requestId: 'request-1',
    timestamp: new Date(0).toISOString(),
  });

  authorizeSftpTaskStartRequest(registry, ownerWebContentsId, request);
  observeSftpTaskForDownloadAuthorization(registry, ownerWebContentsId, createDownloadTask(transferId, 'running'));
  observeSftpTaskForDownloadAuthorization(registry, ownerWebContentsId, createDownloadTask(transferId, 'failed'));

  assert.throws(() => authorizeSftpTaskStartRequest(registry, ownerWebContentsId, request), /not authorized/);
});

test('accepted download task preserves one exact retry after terminal session loss', () => {
  const registry = new SftpDownloadTargetAuthorizationRegistry();
  const ownerWebContentsId = 44;
  const transferId = '47fc8d9a-cda8-4f38-a01d-a633d88f0a69';
  const localPath = registry.authorize(ownerWebContentsId, path.join('downloads', 'queued.bin'), {
    reusable: false,
  });
  const request = createDownloadTaskRequest(localPath, transferId);

  authorizeSftpTaskStartRequest(registry, ownerWebContentsId, request);
  observeSftpTaskForDownloadAuthorization(
    registry,
    ownerWebContentsId,
    createDownloadTask(transferId, 'failed', 'SFTP_SESSION_NOT_FOUND'),
  );

  authorizeSftpTaskStartRequest(registry, ownerWebContentsId, request);
  observeSftpTaskForDownloadAuthorization(registry, ownerWebContentsId, createDownloadTask(transferId, 'succeeded'));

  assert.throws(() => authorizeSftpTaskStartRequest(registry, ownerWebContentsId, request), /not authorized/);
});
