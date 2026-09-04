import assert from 'node:assert/strict';
import test from 'node:test';

import { API_CODES, type ApiErrorResponse, type ApiSftpArchiveCapabilitiesData } from '@cosmosh/api-contract';

import { loadSftpArchiveCapabilitiesWithRetry } from './sftp-archive-capabilities';

const CAPABILITIES: ApiSftpArchiveCapabilitiesData = {
  sessionId: 'sftp-archive-capabilities',
  canExec: true,
  createFormats: ['tar', 'tar-gzip'],
  extractFormats: ['tar', 'tar-gzip'],
};

/**
 * Creates a structured backend failure for retry classification tests.
 *
 * @param code Stable backend API error code.
 * @returns Backend-style error with a stable API code.
 */
const createBackendApiError = (code: ApiErrorResponse['code']): Error & { code: ApiErrorResponse['code'] } => {
  return Object.assign(new Error(code), { code });
};

test('archive capability loading retries transient scheduler contention', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const result = await loadSftpArchiveCapabilitiesWithRetry(
    CAPABILITIES.sessionId,
    controller.signal,
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw createBackendApiError(API_CODES.sftpArchiveBusy);
      }
      return CAPABILITIES;
    },
    0,
  );

  assert.equal(attempts, 3);
  assert.deepEqual(result, CAPABILITIES);
});

test('archive capability loading does not retry non-busy failures', async () => {
  const controller = new AbortController();
  let attempts = 0;

  await assert.rejects(
    loadSftpArchiveCapabilitiesWithRetry(
      CAPABILITIES.sessionId,
      controller.signal,
      async () => {
        attempts += 1;
        throw createBackendApiError(API_CODES.sftpArchiveOperationFailed);
      },
      0,
    ),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === API_CODES.sftpArchiveOperationFailed,
  );
  assert.equal(attempts, 1);
});

test('archive capability loading stops retrying after lifecycle cancellation', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const resultPromise = loadSftpArchiveCapabilitiesWithRetry(
    CAPABILITIES.sessionId,
    controller.signal,
    async () => {
      attempts += 1;
      controller.abort();
      throw createBackendApiError(API_CODES.sftpArchiveBusy);
    },
    10_000,
  );

  assert.equal(await resultPromise, null);
  assert.equal(attempts, 1);
});
