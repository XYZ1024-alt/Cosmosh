import type { ApiSftpEntry, SettingsValues } from '@cosmosh/api-contract';
import type React from 'react';

import { resolveEntryParentPath } from './sftp-utils';

export const SFTP_INTERNAL_ENTRY_DRAG_MIME = 'application/x-cosmosh-sftp-entries';

const DATA_TRANSFER_FILES_TYPE = 'Files';

export type SftpDragDecisionAction = SettingsValues['sftpInternalDragDefaultAction'];

export type SftpResolvedDragOperation = Exclude<SftpDragDecisionAction, 'ask'>;

export type SftpDropTargetSurface =
  | 'address-breadcrumb'
  | 'address-menu'
  | 'current-directory'
  | 'directory-list'
  | 'tree';

export type SftpDirectoryDropSource = 'external-files' | 'internal-entries';

export type SftpInternalDragEntry = {
  name: string;
  parentPath?: string;
  path: string;
  type: ApiSftpEntry['type'];
};

export type SftpInternalDragPayload = {
  kind: 'sftp-internal-entries';
  version: 1;
  sessionId: string;
  sourceDirectoryPath: string;
  entries: SftpInternalDragEntry[];
};

export type SftpDirectoryDropTarget = {
  path: string;
  surface: SftpDropTargetSurface;
};

export type SftpDirectoryDropEventHandler = (
  event: React.DragEvent<HTMLElement>,
  target: SftpDirectoryDropTarget,
) => void;

export type SftpEntryDragStartHandler = (entry: ApiSftpEntry, event: React.DragEvent<HTMLElement>) => void;

/**
 * Checks whether two directory drop targets describe the same rendered target surface.
 *
 * @param left First target.
 * @param right Second target.
 * @returns Whether both targets represent the same drop surface and path.
 */
export const isSameSftpDirectoryDropTarget = (
  left: SftpDirectoryDropTarget | null,
  right: SftpDirectoryDropTarget | null,
): boolean => {
  return Boolean(left && right && left.surface === right.surface && left.path === right.path);
};

/**
 * Creates the internal drag payload shared by SFTP list rows and directory drop targets.
 *
 * @param sessionId Active SFTP session id.
 * @param sourceDirectoryPath Current directory where the drag started.
 * @param entries Remote entries selected for the drag.
 * @returns Serializable internal drag payload.
 */
export const createSftpInternalDragPayload = (
  sessionId: string,
  sourceDirectoryPath: string,
  entries: readonly ApiSftpEntry[],
): SftpInternalDragPayload => ({
  kind: 'sftp-internal-entries',
  version: 1,
  sessionId,
  sourceDirectoryPath,
  entries: entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    parentPath: entry.parentPath ?? resolveEntryParentPath(entry.path),
    type: entry.type,
  })),
});

/**
 * Serializes one internal SFTP drag payload for DataTransfer.
 *
 * @param payload Internal drag payload.
 * @returns JSON string stored under the SFTP MIME type.
 */
export const serializeSftpInternalDragPayload = (payload: SftpInternalDragPayload): string => {
  return JSON.stringify(payload);
};

/**
 * Checks whether a value is a known SFTP drag decision action.
 *
 * @param value Candidate setting value.
 * @returns Whether the value is a supported action.
 */
export const isSftpDragDecisionAction = (value: unknown): value is SftpDragDecisionAction => {
  return value === 'ask' || value === 'move' || value === 'copy' || value === 'link';
};

/**
 * Parses an SFTP internal drag payload from DataTransfer.
 *
 * @param dataTransfer Browser drag data.
 * @returns Parsed payload when it matches the current schema.
 */
export const readSftpInternalDragPayload = (dataTransfer: DataTransfer): SftpInternalDragPayload | null => {
  const rawPayload = dataTransfer.getData(SFTP_INTERNAL_ENTRY_DRAG_MIME);
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const payload = parsed as Partial<SftpInternalDragPayload>;
    if (
      payload.kind !== 'sftp-internal-entries' ||
      payload.version !== 1 ||
      typeof payload.sessionId !== 'string' ||
      typeof payload.sourceDirectoryPath !== 'string' ||
      !Array.isArray(payload.entries)
    ) {
      return null;
    }

    const entries: SftpInternalDragEntry[] = [];
    for (const entry of payload.entries) {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const candidate = entry as Partial<SftpInternalDragEntry>;
      if (
        typeof candidate.name !== 'string' ||
        typeof candidate.path !== 'string' ||
        (candidate.parentPath !== undefined && typeof candidate.parentPath !== 'string') ||
        (candidate.type !== 'directory' &&
          candidate.type !== 'file' &&
          candidate.type !== 'symlink' &&
          candidate.type !== 'other')
      ) {
        return null;
      }

      entries.push({
        name: candidate.name,
        path: candidate.path,
        ...(candidate.parentPath ? { parentPath: candidate.parentPath } : {}),
        type: candidate.type,
      });
    }

    return {
      kind: 'sftp-internal-entries',
      version: 1,
      sessionId: payload.sessionId,
      sourceDirectoryPath: payload.sourceDirectoryPath,
      entries,
    };
  } catch {
    return null;
  }
};

/**
 * Parses an internal drag payload only when it belongs to the expected SFTP session.
 *
 * @param dataTransfer Browser drag data.
 * @param sessionId Expected tab-local SFTP session id.
 * @returns Parsed payload for the expected session.
 */
export const readSftpInternalDragPayloadForSession = (
  dataTransfer: DataTransfer,
  sessionId: string,
): SftpInternalDragPayload | null => {
  const payload = readSftpInternalDragPayload(dataTransfer);
  return payload?.sessionId === sessionId && payload.entries.length > 0 ? payload : null;
};

/**
 * Detects whether a browser drag carries local filesystem files.
 *
 * @param dataTransfer Browser drag data.
 * @returns Whether the payload advertises local files.
 */
export const hasSftpExternalFileDragItems = (dataTransfer: DataTransfer): boolean => {
  const transferTypes = Array.from(dataTransfer.types ?? []);
  if (transferTypes.includes(DATA_TRANSFER_FILES_TYPE)) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file');
};

/**
 * Reads dropped local File objects from a DataTransfer.
 *
 * @param dataTransfer Browser drop data.
 * @returns Dropped File objects.
 */
export const readSftpExternalDroppedFiles = (dataTransfer: DataTransfer): File[] => {
  return Array.from(dataTransfer.files ?? []);
};

/**
 * Resolves which SFTP directory-drop source should handle one drag payload.
 *
 * Internal SFTP payloads take priority so a drag that carries both custom SFTP
 * data and file-like browser metadata still follows the remote move/copy/link flow.
 *
 * @param dataTransfer Browser drag data.
 * @param sessionId Expected tab-local SFTP session id.
 * @returns Directory drop source when supported.
 */
export const resolveSftpDirectoryDropSource = (
  dataTransfer: DataTransfer,
  sessionId: string,
): SftpDirectoryDropSource | null => {
  if (readSftpInternalDragPayloadForSession(dataTransfer, sessionId)) {
    return 'internal-entries';
  }

  return hasSftpExternalFileDragItems(dataTransfer) ? 'external-files' : null;
};

/**
 * Resolves the configured operation for a drop event.
 *
 * @param event Drag event snapshot at dragover or drop time.
 * @param defaultAction User-configured action without the platform modifier.
 * @param modifierAction User-configured action with Ctrl/Cmd held.
 * @returns Configured action, possibly ask.
 */
export const resolveSftpDragDecisionAction = (
  event: React.DragEvent<HTMLElement> | DragEvent,
  defaultAction: SftpDragDecisionAction,
  modifierAction: SftpDragDecisionAction,
): SftpDragDecisionAction => {
  const isPrimaryModifierPressed = window.electron?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  return isPrimaryModifierPressed ? modifierAction : defaultAction;
};

/**
 * Maps a drag action into a browser dropEffect hint.
 *
 * @param action Configured drag action.
 * @returns Drop effect shown while hovering eligible targets.
 */
export const resolveSftpDragDropEffect = (action: SftpDragDecisionAction): DataTransfer['dropEffect'] => {
  if (action === 'move') {
    return 'move';
  }

  if (action === 'link') {
    return 'link';
  }

  return 'copy';
};

/**
 * Resolves the browser dropEffect hint for an accepted SFTP directory drop.
 *
 * @param source Accepted directory-drop source.
 * @param action Configured internal drag action.
 * @returns Drop effect shown while hovering eligible targets.
 */
export const resolveSftpDirectoryDropEffect = (
  source: SftpDirectoryDropSource,
  action: SftpDragDecisionAction,
): DataTransfer['dropEffect'] => {
  return source === 'external-files' ? 'copy' : resolveSftpDragDropEffect(action);
};

/**
 * Checks whether a path is equal to or nested below another remote directory path.
 *
 * @param sourcePath Source directory path.
 * @param targetDirectoryPath Candidate target directory path.
 * @returns Whether targetDirectoryPath is sourcePath or one of its descendants.
 */
export const isSameOrDescendantRemotePath = (sourcePath: string, targetDirectoryPath: string): boolean => {
  const normalizedSource = sourcePath.replace(/\/+$/, '');
  const normalizedTarget = targetDirectoryPath.replace(/\/+$/, '');

  return normalizedTarget === normalizedSource || normalizedTarget.startsWith(`${normalizedSource}/`);
};

/**
 * Detects directory drops that would put a directory into itself.
 *
 * @param entries Dragged entries.
 * @param targetDirectoryPath Target directory path.
 * @returns Whether the drop target is unsafe for the whole dragged set.
 */
export const isUnsafeDirectorySelfDrop = (
  entries: readonly SftpInternalDragEntry[],
  targetDirectoryPath: string,
): boolean => {
  return entries.some(
    (entry) => entry.type === 'directory' && isSameOrDescendantRemotePath(entry.path, targetDirectoryPath),
  );
};

/**
 * Detects a move that would leave every selected entry in its current parent directory.
 *
 * @param entries Dragged entries.
 * @param targetDirectoryPath Target directory path.
 * @returns Whether the move would be a no-op.
 */
export const isSameParentMove = (entries: readonly SftpInternalDragEntry[], targetDirectoryPath: string): boolean => {
  return (
    entries.length > 0 &&
    entries.every((entry) => (entry.parentPath ?? resolveEntryParentPath(entry.path)) === targetDirectoryPath)
  );
};
