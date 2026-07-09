import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiSftpEntry } from '@cosmosh/api-contract';

import {
  createSftpInternalDragPayload,
  hasSftpExternalFileDragItems,
  isSameParentMove,
  isSameSftpDirectoryDropTarget,
  isUnsafeDirectorySelfDrop,
  readSftpExternalDroppedFiles,
  readSftpInternalDragPayload,
  readSftpInternalDragPayloadForSession,
  resolveSftpDirectoryDropEffect,
  resolveSftpDirectoryDropSource,
  resolveSftpDragDecisionAction,
  serializeSftpInternalDragPayload,
  SFTP_INTERNAL_ENTRY_DRAG_MIME,
} from './sftp-drag-drop';

const directoryEntry: ApiSftpEntry = {
  name: 'app',
  path: '/srv/app',
  parentPath: '/srv',
  type: 'directory',
  size: 0,
  mode: 0o040755,
  permissions: 'drwxr-xr-x',
  permissionOctal: '755',
  uid: 1000,
  gid: 1000,
  modifiedAt: '2026-07-08T00:00:00.000Z',
  accessedAt: '2026-07-08T00:00:00.000Z',
  extension: '',
  isHidden: false,
  shellEscapedPath: "'/srv/app'",
};

const fileEntry: ApiSftpEntry = {
  name: 'README.md',
  path: '/srv/README.md',
  parentPath: '/srv',
  type: 'file',
  size: 128,
  mode: 0o100644,
  permissions: '-rw-r--r--',
  permissionOctal: '644',
  uid: 1000,
  gid: 1000,
  modifiedAt: '2026-07-08T00:00:00.000Z',
  accessedAt: '2026-07-08T00:00:00.000Z',
  extension: 'md',
  isHidden: false,
  shellEscapedPath: "'/srv/README.md'",
};

/**
 * Creates a minimal DataTransfer stand-in for pure payload parser tests.
 *
 * @param payload Serialized SFTP drag payload.
 * @param options Optional file-drag metadata.
 * @returns Browser DataTransfer-compatible object.
 */
const createDataTransferStub = (
  payload: string,
  options: {
    files?: readonly File[];
    items?: readonly { kind: string }[];
    types?: readonly string[];
  } = {},
): DataTransfer =>
  ({
    getData: (mimeType: string) => (mimeType === SFTP_INTERNAL_ENTRY_DRAG_MIME ? payload : ''),
    files: options.files ?? [],
    items: options.items ?? [],
    types: options.types ?? [],
  }) as unknown as DataTransfer;

/**
 * Sets the platform visible through the renderer bridge for action-resolution tests.
 *
 * @param platform Electron platform value.
 * @returns void.
 */
const setMockPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electron: {
        platform,
      },
    },
  });
};

test('SFTP internal drag payload round-trips through DataTransfer serialization', () => {
  const payload = createSftpInternalDragPayload('session-a', '/srv', [directoryEntry, fileEntry]);
  const dataTransfer = createDataTransferStub(serializeSftpInternalDragPayload(payload));

  assert.deepEqual(readSftpInternalDragPayload(dataTransfer), payload);
});

test('SFTP internal drag payload rejects malformed or cross-session payloads', () => {
  const payload = createSftpInternalDragPayload('session-a', '/srv', [directoryEntry]);
  const dataTransfer = createDataTransferStub(serializeSftpInternalDragPayload(payload));
  const malformedTransfer = createDataTransferStub(JSON.stringify({ ...payload, version: 2 }));

  assert.equal(readSftpInternalDragPayloadForSession(dataTransfer, 'session-b'), null);
  assert.equal(readSftpInternalDragPayload(malformedTransfer), null);
});

test('SFTP drag action resolution uses Ctrl on Windows/Linux and Cmd on macOS', () => {
  setMockPlatform('win32');
  assert.equal(resolveSftpDragDecisionAction({ ctrlKey: false, metaKey: true } as DragEvent, 'ask', 'copy'), 'ask');
  assert.equal(resolveSftpDragDecisionAction({ ctrlKey: true, metaKey: false } as DragEvent, 'ask', 'copy'), 'copy');

  setMockPlatform('darwin');
  assert.equal(resolveSftpDragDecisionAction({ ctrlKey: true, metaKey: false } as DragEvent, 'ask', 'link'), 'ask');
  assert.equal(resolveSftpDragDecisionAction({ ctrlKey: false, metaKey: true } as DragEvent, 'ask', 'link'), 'link');
});

test('SFTP external file drag detection accepts Files metadata and file items', () => {
  assert.equal(hasSftpExternalFileDragItems(createDataTransferStub('', { types: ['Files'] })), true);
  assert.equal(hasSftpExternalFileDragItems(createDataTransferStub('', { items: [{ kind: 'file' }] })), true);
  assert.equal(hasSftpExternalFileDragItems(createDataTransferStub('', { items: [{ kind: 'string' }] })), false);
});

test('SFTP directory drop source gives internal payloads priority over external files', () => {
  const payload = createSftpInternalDragPayload('session-a', '/srv', [fileEntry]);
  const dataTransfer = createDataTransferStub(serializeSftpInternalDragPayload(payload), { types: ['Files'] });

  assert.equal(resolveSftpDirectoryDropSource(dataTransfer, 'session-a'), 'internal-entries');
  assert.equal(
    resolveSftpDirectoryDropSource(createDataTransferStub('', { types: ['Files'] }), 'session-a'),
    'external-files',
  );
});

test('SFTP external directory drops always use a copy cursor', () => {
  assert.equal(resolveSftpDirectoryDropEffect('external-files', 'move'), 'copy');
  assert.equal(resolveSftpDirectoryDropEffect('external-files', 'link'), 'copy');
  assert.equal(resolveSftpDirectoryDropEffect('internal-entries', 'move'), 'move');
});

test('SFTP external dropped files are read from DataTransfer files', () => {
  const files = [{ name: 'report.txt' }] as unknown as File[];
  assert.deepEqual(readSftpExternalDroppedFiles(createDataTransferStub('', { files })), files);
});

test('SFTP drop target comparison includes the rendered surface', () => {
  assert.equal(
    isSameSftpDirectoryDropTarget(
      { path: '/srv/app', surface: 'tree' },
      { path: '/srv/app', surface: 'directory-list' },
    ),
    false,
  );
  assert.equal(
    isSameSftpDirectoryDropTarget({ path: '/srv/app', surface: 'tree' }, { path: '/srv/app', surface: 'tree' }),
    true,
  );
  assert.equal(
    isSameSftpDirectoryDropTarget(
      { path: '/srv', surface: 'current-directory' },
      { path: '/srv', surface: 'address-breadcrumb' },
    ),
    false,
  );
});

test('SFTP drag target guards reject unsafe directory self drops for the whole dragged set', () => {
  const draggedEntries = createSftpInternalDragPayload('session-a', '/srv', [directoryEntry, fileEntry]).entries;

  assert.equal(isUnsafeDirectorySelfDrop(draggedEntries, '/srv/app'), true);
  assert.equal(isUnsafeDirectorySelfDrop(draggedEntries, '/srv/app/logs'), true);
  assert.equal(isUnsafeDirectorySelfDrop(draggedEntries, '/tmp'), false);
});

test('SFTP drag target guards detect same-parent move no-ops', () => {
  const draggedEntries = createSftpInternalDragPayload('session-a', '/srv', [directoryEntry, fileEntry]).entries;

  assert.equal(isSameParentMove(draggedEntries, '/srv'), true);
  assert.equal(isSameParentMove(draggedEntries, '/tmp'), false);
});
