import type { ApiSftpEntry, SftpDirectoryListViewSetting } from '@cosmosh/api-contract';

import type { SftpOpenedFileRemoteSnapshot, SftpPreviewState } from './sftp-types';

/**
 * Serializes the SFTP directory list view for cheap equality checks.
 *
 * @param value Directory-list view setting value.
 * @returns Stable JSON representation for registry-backed settings.
 */
export const stringifySftpDirectoryListView = (value: SftpDirectoryListViewSetting): string => JSON.stringify(value);

/**
 * Resolves the remote entry path represented by a preview state.
 *
 * @param state Current preview lifecycle state.
 * @returns Remote path when the state is tied to one entry.
 */
export const resolvePreviewStatePath = (state: SftpPreviewState | null): string => {
  if (!state) {
    return '';
  }

  if (state.status === 'large-file') {
    return state.prompt.entry.path;
  }

  return state.entry?.path ?? '';
};

/**
 * Measures UTF-8 content size before saving text preview changes.
 *
 * @param value Text content to measure.
 * @returns Encoded byte length.
 */
export const measureUtf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

/**
 * Checks whether preview replacement would discard local editor edits.
 *
 * @param state Current preview lifecycle state.
 * @returns Whether the preview has unsaved editable content.
 */
export const isDirtySftpTextPreviewState = (state: SftpPreviewState | null): boolean => {
  return state?.status === 'text' && state.content !== state.savedContent && !state.isSaving;
};

/**
 * Identifies editor and text-entry surfaces that own keyboard shortcuts.
 */
const EDITABLE_KEYBOARD_TARGET_SELECTOR = '[contenteditable="true"], [role="textbox"], .cm-editor';

/**
 * Checks whether an SFTP page keyboard event started inside editable content.
 *
 * @param target Original keyboard event target.
 * @returns Whether the target should keep text/editor shortcuts local.
 */
export const isEditableKeyboardEventTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!element) {
    return false;
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  return element.closest(EDITABLE_KEYBOARD_TARGET_SELECTOR) !== null;
};

/**
 * Captures the remote metadata that controls SFTP temp-file cache freshness.
 *
 * @param entry Remote SFTP entry.
 * @returns Size and modified-time snapshot for cache validation.
 */
export const createSftpEntryRemoteSnapshot = (entry: ApiSftpEntry): SftpOpenedFileRemoteSnapshot => ({
  size: entry.size,
  modifiedAt: entry.modifiedAt,
});

/**
 * Checks whether one cached local temp file still reflects the selected remote entry.
 *
 * @param entry Remote SFTP entry from the latest directory listing.
 * @param snapshot Snapshot stored with the cached temp file.
 * @returns Whether the cache can be reused.
 */
export const doesSftpEntryMatchRemoteSnapshot = (
  entry: ApiSftpEntry,
  snapshot: SftpOpenedFileRemoteSnapshot | undefined,
): boolean => {
  return Boolean(snapshot && snapshot.size === entry.size && snapshot.modifiedAt === entry.modifiedAt);
};

/**
 * Renderer-owned image preview cache entry separated from externally opened temp files.
 */
export type SftpImagePreviewTempFileCacheEntry = {
  localPath: string;
  remoteSnapshot: SftpOpenedFileRemoteSnapshot;
};
