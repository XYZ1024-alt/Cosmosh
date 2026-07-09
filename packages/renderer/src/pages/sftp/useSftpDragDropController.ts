import type { ApiSftpEntry } from '@cosmosh/api-contract';
import React from 'react';

import { runSftpBatchOperation } from '../../lib/backend';
import { t } from '../../lib/i18n';
import {
  createSftpInternalDragPayload,
  hasSftpExternalFileDragItems,
  isSameParentMove,
  isSameSftpDirectoryDropTarget,
  isUnsafeDirectorySelfDrop,
  readSftpExternalDroppedFiles,
  readSftpInternalDragPayloadForSession,
  resolveSftpDirectoryDropEffect,
  resolveSftpDragDecisionAction,
  serializeSftpInternalDragPayload,
  SFTP_INTERNAL_ENTRY_DRAG_MIME,
  type SftpDirectoryDropEventHandler,
  type SftpDirectoryDropTarget,
  type SftpDragDecisionAction,
  type SftpEntryDragStartHandler,
  type SftpInternalDragEntry,
  type SftpInternalDragPayload,
  type SftpResolvedDragOperation,
} from './sftp-drag-drop';
import type { SftpImagePreviewTempFileCacheEntry } from './sftp-page-utils';
import { resolvePreviewStatePath } from './sftp-page-utils';
import type {
  ClipboardState,
  SftpOpenWithApplication,
  SftpPreviewState,
  SftpTaskContext,
  SftpTaskOptions,
} from './sftp-types';
import {
  dedupeSftpEntries,
  formatBatchFeedback,
  formatBatchPartialFailureFeedback,
  resolveEntryParentPath,
} from './sftp-utils';
import type { SftpPendingDropOperationMenu } from './SftpDropOperationMenu';

/**
 * Inputs for the internal SFTP drag/drop controller.
 */
type UseSftpDragDropControllerParams = {
  canUseFileActions: boolean;
  clipboardState: ClipboardState | null;
  currentPath: string;
  hasSftpSession: boolean;
  imagePreviewTempFilesRef: React.MutableRefObject<Record<string, SftpImagePreviewTempFileCacheEntry>>;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
  onUploadDroppedLocalFiles: (files: File[], targetDirectoryPath: string) => Promise<void>;
  refreshCurrentDirectoryAfterOperation: (affectedDirectoryPaths?: readonly string[]) => Promise<void>;
  runSftpOperation: (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>) => void;
  runWithSftpReconnect: <TResult>(operation: (activeSessionId: string) => Promise<TResult>) => Promise<TResult>;
  selectedEntries: ApiSftpEntry[];
  selectedPathSet: Set<string>;
  sessionId: string;
  setOpenWithApplicationsByPath: React.Dispatch<React.SetStateAction<Record<string, SftpOpenWithApplication[]>>>;
  setPreviewState: React.Dispatch<React.SetStateAction<SftpPreviewState | null>>;
  setSelectedPaths: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectionAnchorPath: React.Dispatch<React.SetStateAction<string>>;
  sftpInternalDragDefaultAction: SftpDragDecisionAction;
  sftpInternalDragModifierAction: SftpDragDecisionAction;
  temporaryOpenFilePathsRef: React.MutableRefObject<Record<string, string>>;
};

/**
 * Internal SFTP drag/drop state and handlers consumed by browser surfaces.
 */
type UseSftpDragDropControllerResult = {
  activeDropTarget: SftpDirectoryDropTarget | null;
  handleCreateLinkFromClipboard: (targetDirectoryPath?: string) => void;
  handleDirectoryDropTargetDragEnter: SftpDirectoryDropEventHandler;
  handleDirectoryDropTargetDragLeave: SftpDirectoryDropEventHandler;
  handleDirectoryDropTargetDragOver: SftpDirectoryDropEventHandler;
  handleDirectoryDropTargetDrop: SftpDirectoryDropEventHandler;
  handleDirectoryDropTargetReject: () => void;
  handlePendingDropOperationSelect: (operation: SftpResolvedDragOperation) => void;
  handleSftpEntryDragEnd: () => void;
  handleSftpEntryDragStart: SftpEntryDragStartHandler;
  pendingDropOperationMenu: SftpPendingDropOperationMenu | null;
  setPendingDropOperationMenu: React.Dispatch<React.SetStateAction<SftpPendingDropOperationMenu | null>>;
};

/**
 * Accepted directory drop after source and target guards pass.
 */
type AcceptedSftpDirectoryDrop =
  | {
      source: 'external-files';
    }
  | {
      source: 'internal-entries';
      payload: SftpInternalDragPayload;
    };

/**
 * Owns internal SFTP drag payloads, drop-target highlighting, and drop batch execution.
 *
 * @param params Current SFTP state, task runner, and cache mutation helpers.
 * @returns Drag/drop state and event handlers.
 */
export const useSftpDragDropController = ({
  canUseFileActions,
  clipboardState,
  currentPath,
  hasSftpSession,
  imagePreviewTempFilesRef,
  notifyError,
  notifySuccess,
  onUploadDroppedLocalFiles,
  refreshCurrentDirectoryAfterOperation,
  runSftpOperation,
  runWithSftpReconnect,
  selectedEntries,
  selectedPathSet,
  sessionId,
  setOpenWithApplicationsByPath,
  setPreviewState,
  setSelectedPaths,
  setSelectionAnchorPath,
  sftpInternalDragDefaultAction,
  sftpInternalDragModifierAction,
  temporaryOpenFilePathsRef,
}: UseSftpDragDropControllerParams): UseSftpDragDropControllerResult => {
  const [activeInternalDragPayload, setActiveInternalDragPayload] = React.useState<SftpInternalDragPayload | null>(
    null,
  );
  const [activeDropTarget, setActiveDropTarget] = React.useState<SftpDirectoryDropTarget | null>(null);
  const [pendingDropOperationMenu, setPendingDropOperationMenu] = React.useState<SftpPendingDropOperationMenu | null>(
    null,
  );

  React.useEffect(() => {
    if (!activeInternalDragPayload) {
      return undefined;
    }

    const clearDragState = (): void => {
      setActiveInternalDragPayload(null);
      setActiveDropTarget(null);
    };

    window.addEventListener('dragend', clearDragState);
    window.addEventListener('blur', clearDragState);

    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('blur', clearDragState);
    };
  }, [activeInternalDragPayload]);

  const resolveCurrentSftpDragPayload = React.useCallback(
    (event?: React.DragEvent<HTMLElement>): SftpInternalDragPayload | null => {
      if (activeInternalDragPayload?.sessionId === sessionId && activeInternalDragPayload.entries.length > 0) {
        return activeInternalDragPayload;
      }

      if (!event) {
        return null;
      }

      return readSftpInternalDragPayloadForSession(event.dataTransfer, sessionId);
    },
    [activeInternalDragPayload, sessionId],
  );

  const resolveAcceptedSftpDirectoryDrop = React.useCallback(
    (target: SftpDirectoryDropTarget, event?: React.DragEvent<HTMLElement>): AcceptedSftpDirectoryDrop | null => {
      if (!canUseFileActions || !target.path) {
        return null;
      }

      const payload = resolveCurrentSftpDragPayload(event);
      if (payload) {
        if (isUnsafeDirectorySelfDrop(payload.entries, target.path)) {
          return null;
        }

        return {
          source: 'internal-entries',
          payload,
        };
      }

      if (event && hasSftpExternalFileDragItems(event.dataTransfer)) {
        return {
          source: 'external-files',
        };
      }

      return null;
    },
    [canUseFileActions, resolveCurrentSftpDragPayload],
  );

  const runSftpDroppedEntriesOperation = React.useCallback(
    (
      operation: SftpResolvedDragOperation,
      targetDirectoryPath: string,
      draggedEntries: readonly SftpInternalDragEntry[],
    ): void => {
      if (!hasSftpSession || draggedEntries.length === 0) {
        return;
      }

      if (isUnsafeDirectorySelfDrop(draggedEntries, targetDirectoryPath)) {
        notifyError(t('sftp.feedback.invalidDropTarget'));
        return;
      }

      if (operation === 'move' && isSameParentMove(draggedEntries, targetDirectoryPath)) {
        notifySuccess(t('sftp.feedback.alreadyInTargetDirectory'));
        return;
      }

      const operationLabel =
        operation === 'copy'
          ? t('sftp.tasks.copy')
          : operation === 'move'
            ? t('sftp.tasks.move')
            : t('sftp.tasks.link');

      runSftpOperation(
        {
          label: operationLabel,
          detail: targetDirectoryPath,
          progress: { completed: 0, total: draggedEntries.length },
        },
        async ({ isCurrent, update }) => {
          const response = await runWithSftpReconnect((activeSessionId) =>
            runSftpBatchOperation(activeSessionId, {
              operation,
              targetDirectoryPath,
              entries: draggedEntries.map((entry) => ({
                path: entry.path,
                type: entry.type,
              })),
            }),
          );
          update({ progress: { completed: response.data.completedCount, total: response.data.totalCount } });
          if (!isCurrent()) {
            return;
          }

          if (response.data.failedCount > 0) {
            notifyError(formatBatchPartialFailureFeedback(response.data));
          } else {
            const feedbackKeys =
              operation === 'copy'
                ? (['sftp.feedback.copied', 'sftp.feedback.copiedMany'] as const)
                : operation === 'move'
                  ? (['sftp.feedback.moved', 'sftp.feedback.movedMany'] as const)
                  : (['sftp.feedback.linked', 'sftp.feedback.linkedMany'] as const);
            notifySuccess(formatBatchFeedback(response.data.completedCount, feedbackKeys[0], feedbackKeys[1]));
          }

          if (operation === 'move') {
            const movedPaths = new Set(
              response.data.results.filter((result) => result.status === 'success').map((result) => result.path),
            );
            setSelectedPaths((previous) => previous.filter((path) => !movedPaths.has(path)));
            setSelectionAnchorPath((previous) => (movedPaths.has(previous) ? '' : previous));
            setPreviewState((previous) => (movedPaths.has(resolvePreviewStatePath(previous)) ? null : previous));
            movedPaths.forEach((path) => {
              delete temporaryOpenFilePathsRef.current[path];
              delete imagePreviewTempFilesRef.current[path];
            });
            setOpenWithApplicationsByPath((previous) => {
              const next = { ...previous };
              movedPaths.forEach((path) => {
                delete next[path];
              });
              return next;
            });
          }

          await refreshCurrentDirectoryAfterOperation([
            ...draggedEntries.map((entry) => entry.parentPath ?? resolveEntryParentPath(entry.path)),
            targetDirectoryPath,
          ]);
        },
      );
    },
    [
      hasSftpSession,
      imagePreviewTempFilesRef,
      notifyError,
      notifySuccess,
      refreshCurrentDirectoryAfterOperation,
      runSftpOperation,
      runWithSftpReconnect,
      setOpenWithApplicationsByPath,
      setPreviewState,
      setSelectedPaths,
      setSelectionAnchorPath,
      temporaryOpenFilePathsRef,
    ],
  );

  const handleCreateLinkFromClipboard = React.useCallback(
    (targetDirectoryPath = currentPath): void => {
      if (!clipboardState || clipboardState.entries.length === 0) {
        return;
      }

      runSftpDroppedEntriesOperation(
        'link',
        targetDirectoryPath,
        clipboardState.entries.map((entry) => ({
          name: entry.name,
          parentPath: entry.parentPath ?? resolveEntryParentPath(entry.path),
          path: entry.path,
          type: entry.type,
        })),
      );
    },
    [clipboardState, currentPath, runSftpDroppedEntriesOperation],
  );

  const handleSftpEntryDragStart = React.useCallback<SftpEntryDragStartHandler>(
    (entry, event): void => {
      if (!hasSftpSession || !canUseFileActions) {
        event.preventDefault();
        return;
      }

      const draggedEntries = dedupeSftpEntries(
        selectedPathSet.has(entry.path) && selectedEntries.length > 0 ? selectedEntries : [entry],
      );
      if (draggedEntries.length === 0) {
        event.preventDefault();
        return;
      }

      const payload = createSftpInternalDragPayload(sessionId, currentPath, draggedEntries);
      event.dataTransfer.effectAllowed = 'all';
      event.dataTransfer.setData(SFTP_INTERNAL_ENTRY_DRAG_MIME, serializeSftpInternalDragPayload(payload));
      setActiveInternalDragPayload(payload);
      setActiveDropTarget(null);
      setPendingDropOperationMenu(null);
      setSelectedPaths(draggedEntries.map((draggedEntry) => draggedEntry.path));
      setSelectionAnchorPath(draggedEntries[draggedEntries.length - 1]?.path ?? '');
    },
    [
      canUseFileActions,
      currentPath,
      hasSftpSession,
      selectedEntries,
      selectedPathSet,
      sessionId,
      setSelectedPaths,
      setSelectionAnchorPath,
    ],
  );

  const handleSftpEntryDragEnd = React.useCallback((): void => {
    setActiveInternalDragPayload(null);
    setActiveDropTarget(null);
  }, []);

  const handleDirectoryDropTargetDragEnter = React.useCallback<SftpDirectoryDropEventHandler>(
    (event, target): void => {
      if (!resolveAcceptedSftpDirectoryDrop(target, event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setActiveDropTarget(target);
    },
    [resolveAcceptedSftpDirectoryDrop],
  );

  const handleDirectoryDropTargetDragOver = React.useCallback<SftpDirectoryDropEventHandler>(
    (event, target): void => {
      const acceptedDrop = resolveAcceptedSftpDirectoryDrop(target, event);
      if (!acceptedDrop) {
        event.dataTransfer.dropEffect = 'none';
        if (isSameSftpDirectoryDropTarget(activeDropTarget, target)) {
          setActiveDropTarget(null);
        }
        return;
      }

      const action = resolveSftpDragDecisionAction(
        event,
        sftpInternalDragDefaultAction,
        sftpInternalDragModifierAction,
      );

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = resolveSftpDirectoryDropEffect(acceptedDrop.source, action);
      setActiveDropTarget(target);
    },
    [activeDropTarget, resolveAcceptedSftpDirectoryDrop, sftpInternalDragDefaultAction, sftpInternalDragModifierAction],
  );

  const handleDirectoryDropTargetDragLeave = React.useCallback<SftpDirectoryDropEventHandler>(
    (event, target): void => {
      const relatedNode = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (relatedNode && event.currentTarget.contains(relatedNode)) {
        return;
      }

      if (isSameSftpDirectoryDropTarget(activeDropTarget, target)) {
        setActiveDropTarget(null);
      }
    },
    [activeDropTarget],
  );

  const handleDirectoryDropTargetReject = React.useCallback((): void => {
    setActiveDropTarget(null);
  }, []);

  const handleDirectoryDropTargetDrop = React.useCallback<SftpDirectoryDropEventHandler>(
    (event, target): void => {
      const acceptedDrop = resolveAcceptedSftpDirectoryDrop(target, event);
      setActiveInternalDragPayload(null);
      setActiveDropTarget(null);
      if (!acceptedDrop) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (acceptedDrop.source === 'external-files') {
        void onUploadDroppedLocalFiles(readSftpExternalDroppedFiles(event.dataTransfer), target.path);
        return;
      }

      const action = resolveSftpDragDecisionAction(
        event,
        sftpInternalDragDefaultAction,
        sftpInternalDragModifierAction,
      );
      if (action === 'ask') {
        setPendingDropOperationMenu({
          entries: acceptedDrop.payload.entries,
          targetDirectoryPath: target.path,
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }

      runSftpDroppedEntriesOperation(action, target.path, acceptedDrop.payload.entries);
    },
    [
      onUploadDroppedLocalFiles,
      resolveAcceptedSftpDirectoryDrop,
      runSftpDroppedEntriesOperation,
      sftpInternalDragDefaultAction,
      sftpInternalDragModifierAction,
    ],
  );

  const handlePendingDropOperationSelect = React.useCallback(
    (operation: SftpResolvedDragOperation): void => {
      const pendingMenu = pendingDropOperationMenu;
      setPendingDropOperationMenu(null);
      if (!pendingMenu) {
        return;
      }

      runSftpDroppedEntriesOperation(operation, pendingMenu.targetDirectoryPath, pendingMenu.entries);
    },
    [pendingDropOperationMenu, runSftpDroppedEntriesOperation],
  );

  return {
    activeDropTarget,
    handleCreateLinkFromClipboard,
    handleDirectoryDropTargetDragEnter,
    handleDirectoryDropTargetDragLeave,
    handleDirectoryDropTargetDragOver,
    handleDirectoryDropTargetDrop,
    handleDirectoryDropTargetReject,
    handlePendingDropOperationSelect,
    handleSftpEntryDragEnd,
    handleSftpEntryDragStart,
    pendingDropOperationMenu,
    setPendingDropOperationMenu,
  };
};
