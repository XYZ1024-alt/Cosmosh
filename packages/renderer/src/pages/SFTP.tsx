import {
  type ApiSftpEntry,
  type ApiSftpUploadFileRequest,
  type ApiSftpUploadFileResponse,
  type ApiSftpWriteFileRequest,
  type ApiSftpWriteFileResponse,
  compareSftpEntryNames,
  compareSftpNames,
  MAX_SFTP_IMAGE_PREVIEW_WARNING_THRESHOLD_BYTES,
  MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES,
  type SftpAuxiliarySidebarMode,
  type SftpDirectoryListColumnId,
  type SftpDirectoryListSortDirection,
  type SftpDirectoryListViewSetting,
} from '@cosmosh/api-contract';
import type { editor as MonacoEditor } from 'monaco-editor';
import React from 'react';

import { Button } from '../components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/ui/context-menu';
import type { InputContextMenuItem } from '../components/ui/input-context-menu-registry';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import {
  closeSftpSession,
  createSftpDirectory,
  createSftpFile,
  createSftpSession,
  downloadSftpFile,
  isBackendApiError,
  listSftpDirectory,
  readSftpFile,
  renameSftpEntry,
  runSftpBatchOperation,
  trustSshFingerprint,
  updateAppSettings,
  uploadSftpFile,
  writeSftpFile,
} from '../lib/backend';
import { t } from '../lib/i18n';
import { updateSettingsStoreValues, useSettingsValue, useSettingsValues } from '../lib/settings-store';
import { useToast } from '../lib/toast-context';
import type { SftpConnectionIntent } from '../types/tabs';
import {
  INLINE_EDIT_MENU_HANDOFF_RELEASE_DELAY_MS,
  NEW_DIRECTORY_NAME,
  NEW_FILE_NAME,
  PARENT_DIRECTORY_ROW_KEY,
  SFTP_TASK_RETENTION_MS,
} from './sftp/sftp-constants';
import { sortSftpEntriesByDirectoryListView } from './sftp/sftp-directory-view';
import { buildSftpEntryPropertiesWindowUrl } from './sftp/sftp-entry-properties-window';
import type {
  ClipboardState,
  DirectoryCacheEntry,
  DirectoryLoadOptions,
  HostFingerprintPrompt,
  InlineEditMenuAction,
  NavigationHistoryControlOptions,
  NavigationHistoryMenuItem,
  NavigationState,
  PendingCreateState,
  SftpActionMenuOptions,
  SftpDeleteConfirmationPrompt,
  SftpDeleteInvocationSource,
  SftpFileNavigationRow,
  SftpLargePreviewPrompt,
  SftpOpenedFileRemoteSnapshot,
  SftpOpenWithApplication,
  SftpPreviewState,
  SftpQueuedTask,
  SftpSelectionClickEvent,
  SftpSelectionModifierEvent,
  SftpTaskContext,
  SftpTaskOptions,
  SftpTaskState,
  SftpUploadConfirmationPrompt,
  SftpUploadConflictConfirmationPrompt,
  SftpWatchedOpenFile,
  TreeDirectoryNode,
} from './sftp/sftp-types';
import {
  buildBreadcrumbs,
  buildNavigationHistoryMenuItems,
  createSftpTaskId,
  dedupeSftpEntries,
  filterSftpEntries,
  filterSftpEntriesByHiddenVisibility,
  flattenVisibleTreePaths,
  formatBatchFeedback,
  formatBatchPartialFailureFeedback,
  formatFileSize,
  formatSftpTabTitle,
  formatSftpTaskToolbarLabel,
  isSameClipboardSnapshot,
  isSftpImagePreviewEntry,
  isSftpTextPreviewEntry,
  joinRemotePath,
  mergeResolvedDirectoryIntoTree,
  resolveAddressBreadcrumbRenderState,
  resolveAncestorDirectoryPaths,
  resolveEntryParentPath,
  resolveRangeSelectionPaths,
  resolveRemoteParentPath,
  resolveRenameTargetPath,
  resolveSftpPreviewLanguage,
  resolveShortcutModifier,
  sanitizeLocalFileName,
  SFTP_TASK_STATUS_ORDER,
  shouldConfirmSftpDelete,
  sortSftpEntries,
} from './sftp/sftp-utils';
import { SftpActionMenuItems } from './sftp/SftpActionMenuItems';
import { SftpDetailPanel } from './sftp/SftpDetailPanel';
import {
  SftpDeleteConfirmationDialog,
  SftpHostFingerprintDialog,
  SftpUploadConfirmationDialog,
  SftpUploadConflictConfirmationDialog,
} from './sftp/SftpDialogs';
import { SftpDirectoryPanel } from './sftp/SftpDirectoryPanel';
import { SftpToolbar } from './sftp/SftpToolbar';
import { SftpTreePanel } from './sftp/SftpTreePanel';

/**
 * Serializes the SFTP directory list view for cheap equality checks.
 *
 * @param value Directory-list view setting value.
 * @returns Stable JSON representation for registry-backed settings.
 */
const stringifySftpDirectoryListView = (value: SftpDirectoryListViewSetting): string => JSON.stringify(value);

/**
 * Resolves the remote entry path represented by a preview state.
 *
 * @param state Current preview lifecycle state.
 * @returns Remote path when the state is tied to one entry.
 */
const resolvePreviewStatePath = (state: SftpPreviewState | null): string => {
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
const measureUtf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

/**
 * Checks whether preview replacement would discard local Monaco edits.
 *
 * @param state Current preview lifecycle state.
 * @returns Whether the preview has unsaved editable content.
 */
const isDirtySftpTextPreviewState = (state: SftpPreviewState | null): boolean => {
  return state?.status === 'text' && state.content !== state.savedContent && !state.isSaving;
};

/**
 * Captures the remote metadata that controls SFTP temp-file cache freshness.
 *
 * @param entry Remote SFTP entry.
 * @returns Size and modified-time snapshot for cache validation.
 */
const createSftpEntryRemoteSnapshot = (entry: ApiSftpEntry): SftpOpenedFileRemoteSnapshot => ({
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
const doesSftpEntryMatchRemoteSnapshot = (
  entry: ApiSftpEntry,
  snapshot: SftpOpenedFileRemoteSnapshot | undefined,
): boolean => {
  return Boolean(snapshot && snapshot.size === entry.size && snapshot.modifiedAt === entry.modifiedAt);
};

/**
 * Renderer-owned image preview cache entry separated from externally opened temp files.
 */
type SftpImagePreviewTempFileCacheEntry = {
  localPath: string;
  remoteSnapshot: SftpOpenedFileRemoteSnapshot;
};

type SFTPProps = {
  connectionIntent?: SftpConnectionIntent;
  onOpenDirectoryInNewTab: (initialPath: string) => void;
  onOpenSshAtPath: (initialPath: string) => void;
  onTabTitleChange: (title: string) => void;
};

/**
 * Read-only SFTP browser page bound to one renderer tab.
 *
 * @param props SFTP tab runtime props.
 * @returns SFTP workbench page.
 */
const SFTP: React.FC<SFTPProps> = ({
  connectionIntent,
  onOpenDirectoryInNewTab,
  onOpenSshAtPath,
  onTabTitleChange,
}) => {
  const { error: notifyError, success: notifySuccess } = useToast();
  const settingsValues = useSettingsValues();
  const sftpDeleteConfirmationMode = useSettingsValue('sftpDeleteConfirmationMode');
  const sftpShowHiddenEntries = useSettingsValue('sftpShowHiddenEntries');
  const sftpDimHiddenEntries = useSettingsValue('sftpDimHiddenEntries');
  const sftpShowParentDirectoryEntry = useSettingsValue('sftpShowParentDirectoryEntry');
  const sftpShowAddressAsText = useSettingsValue('sftpShowAddressAsText');
  const sftpAuxiliarySidebarMode = useSettingsValue('sftpAuxiliarySidebarMode');
  const sftpTextPreviewWarningThresholdBytes = useSettingsValue('sftpTextPreviewWarningThresholdBytes');
  const sftpImagePreviewWarningThresholdBytes = useSettingsValue('sftpImagePreviewWarningThresholdBytes');
  const registrySftpDirectoryListView = useSettingsValue('sftpDirectoryListView');
  const sftpReconnectMode = useSettingsValue('sftpReconnectMode');
  const [directoryListViewDraft, setDirectoryListViewDraft] = React.useState<SftpDirectoryListViewSetting | null>(null);
  const sftpDirectoryListView = directoryListViewDraft ?? registrySftpDirectoryListView;
  const [sessionId, setSessionId] = React.useState<string>('');
  const [currentPath, setCurrentPath] = React.useState<string>('.');
  const [parentPath, setParentPath] = React.useState<string | undefined>(undefined);
  const [entries, setEntries] = React.useState<ApiSftpEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = React.useState<string[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = React.useState<string>('');
  const [status, setStatus] = React.useState<'idle' | 'connecting' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [pathInput, setPathInput] = React.useState<string>('.');
  const [isAddressInputEditing, setIsAddressInputEditing] = React.useState(false);
  const [filterQuery, setFilterQuery] = React.useState<string>('');
  const [treeNodes, setTreeNodes] = React.useState<Record<string, TreeDirectoryNode>>({});
  const [navigationState, setNavigationState] = React.useState<NavigationState>({ paths: [], index: -1 });
  const [hostFingerprintPrompt, setHostFingerprintPrompt] = React.useState<HostFingerprintPrompt | null>(null);
  const [clipboardState, setClipboardState] = React.useState<ClipboardState | null>(null);
  const [sftpTasks, setSftpTasks] = React.useState<SftpTaskState[]>([]);
  const [isRefreshingDirectory, setIsRefreshingDirectory] = React.useState(false);
  const [renamingEntryPath, setRenamingEntryPath] = React.useState<string>('');
  const [renameInput, setRenameInput] = React.useState<string>('');
  const [pendingCreate, setPendingCreate] = React.useState<PendingCreateState | null>(null);
  const [previewState, setPreviewState] = React.useState<SftpPreviewState | null>(null);
  const [openWithApplicationsByPath, setOpenWithApplicationsByPath] = React.useState<
    Record<string, SftpOpenWithApplication[]>
  >({});
  const [loadingOpenWithPath, setLoadingOpenWithPath] = React.useState<string>('');
  const [activeTreePath, setActiveTreePath] = React.useState<string>('');
  const [activeFileRowKey, setActiveFileRowKey] = React.useState<string>('');
  const [deleteConfirmationPrompt, setDeleteConfirmationPrompt] = React.useState<SftpDeleteConfirmationPrompt | null>(
    null,
  );
  const [uploadConfirmationPrompt, setUploadConfirmationPrompt] = React.useState<SftpUploadConfirmationPrompt | null>(
    null,
  );
  const [uploadConflictConfirmationPrompt, setUploadConflictConfirmationPrompt] =
    React.useState<SftpUploadConflictConfirmationPrompt | null>(null);
  const pendingPromptResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const pendingDeleteConfirmationResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const pendingUploadConflictResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const directoryCacheRef = React.useRef<Record<string, DirectoryCacheEntry>>({});
  const sessionIdRef = React.useRef<string>('');
  const currentPathRef = React.useRef<string>('.');
  const sftpShowHiddenEntriesRef = React.useRef(sftpShowHiddenEntries);
  const syncedTabTitleRef = React.useRef<string>('');
  const temporaryOpenFilePathsRef = React.useRef<Record<string, string>>({});
  const imagePreviewTempFilesRef = React.useRef<Record<string, SftpImagePreviewTempFileCacheEntry>>({});
  const watchedOpenFilesRef = React.useRef<Record<string, SftpWatchedOpenFile>>({});
  const renameInputRef = React.useRef<HTMLInputElement | null>(null);
  const shouldPreventMenuCloseAutoFocusRef = React.useRef(false);
  const inlineEditMenuActionTimerRef = React.useRef<number | null>(null);
  const inlineEditMenuFocusHandoffReleaseTimerRef = React.useRef<number | null>(null);
  const taskQueueRef = React.useRef<SftpQueuedTask[]>([]);
  const isTaskQueueRunningRef = React.useRef(false);
  const taskQueueGenerationRef = React.useRef(0);
  const taskRetentionTimersRef = React.useRef<Record<string, number>>({});
  const reconnectPromiseRef = React.useRef<Promise<string> | null>(null);
  const previewLoadGenerationRef = React.useRef(0);
  const previewEditorRef = React.useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const previewStateRef = React.useRef<SftpPreviewState | null>(null);
  const treeRowRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const fileRowRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const addressInputRef = React.useRef<HTMLInputElement | null>(null);
  const shouldRetainAddressInputAfterContextMenuRef = React.useRef(false);
  const addressInputContextMenuTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  React.useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  React.useEffect(() => {
    sftpShowHiddenEntriesRef.current = sftpShowHiddenEntries;
  }, [sftpShowHiddenEntries]);

  React.useEffect(() => {
    if (!directoryListViewDraft) {
      return;
    }

    if (
      stringifySftpDirectoryListView(directoryListViewDraft) ===
      stringifySftpDirectoryListView(registrySftpDirectoryListView)
    ) {
      setDirectoryListViewDraft(null);
    }
  }, [directoryListViewDraft, registrySftpDirectoryListView]);

  /**
   * Clears the delayed removal timer for one completed task.
   *
   * @param taskId Task id to clear.
   * @returns void.
   */
  const clearTaskRetentionTimer = React.useCallback((taskId: string): void => {
    const timerId = taskRetentionTimersRef.current[taskId];
    if (timerId === undefined) {
      return;
    }

    window.clearTimeout(timerId);
    delete taskRetentionTimersRef.current[taskId];
  }, []);

  /**
   * Clears every scheduled task cleanup timer.
   *
   * @returns void.
   */
  const clearAllTaskRetentionTimers = React.useCallback((): void => {
    Object.values(taskRetentionTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    taskRetentionTimersRef.current = {};
  }, []);

  /**
   * Schedules completed tasks to disappear after users have time to inspect them.
   *
   * @param taskId Completed task id.
   * @returns void.
   */
  const scheduleTaskRetentionCleanup = React.useCallback(
    (taskId: string): void => {
      clearTaskRetentionTimer(taskId);
      taskRetentionTimersRef.current[taskId] = window.setTimeout(() => {
        delete taskRetentionTimersRef.current[taskId];
        setSftpTasks((previous) => previous.filter((task) => task.id !== taskId));
      }, SFTP_TASK_RETENTION_MS);
    },
    [clearTaskRetentionTimer],
  );

  /**
   * Stops every main-process watcher attached to opened SFTP temp files.
   *
   * @returns void.
   */
  const stopAllWatchedOpenFiles = React.useCallback((): void => {
    Object.values(watchedOpenFilesRef.current).forEach((watchedFile) => {
      void window.electron?.stopSftpTemporaryFileWatch(watchedFile.watchId);
    });
    watchedOpenFilesRef.current = {};
    pendingUploadConflictResolverRef.current?.(false);
    pendingUploadConflictResolverRef.current = null;
    setUploadConfirmationPrompt(null);
    setUploadConflictConfirmationPrompt(null);
  }, []);

  React.useEffect(() => {
    return () => {
      stopAllWatchedOpenFiles();
      clearAllTaskRetentionTimers();
      taskQueueGenerationRef.current += 1;
      taskQueueRef.current = [];
      isTaskQueueRunningRef.current = false;
    };
  }, [clearAllTaskRetentionTimers, stopAllWatchedOpenFiles]);

  React.useEffect(() => {
    return window.electron?.onSftpTemporaryFileChanged((change) => {
      const watchedFile = Object.values(watchedOpenFilesRef.current).find(
        (candidate) => candidate.watchId === change.watchId,
      );
      if (!watchedFile) {
        return;
      }

      const nextWatchedFile: SftpWatchedOpenFile = {
        ...watchedFile,
        pendingChange: {
          size: change.size,
          modifiedAt: change.modifiedAt,
        },
        isPromptOpen: true,
      };
      watchedOpenFilesRef.current = {
        ...watchedOpenFilesRef.current,
        [watchedFile.remotePath]: nextWatchedFile,
      };
      setUploadConfirmationPrompt({
        remotePath: watchedFile.remotePath,
        name: watchedFile.name,
        localPath: watchedFile.localPath,
        size: change.size,
        modifiedAt: change.modifiedAt,
      });
    });
  }, []);

  React.useEffect(() => {
    const serverName = connectionIntent?.serverName;
    if (!serverName) {
      return;
    }

    const hasResolvedCurrentDirectory = status === 'ready' || navigationState.index >= 0;
    const fallbackTitle = serverName.trim() || t('tabs.page.sftp');
    const nextTitle = hasResolvedCurrentDirectory ? formatSftpTabTitle(currentPath, serverName) : fallbackTitle;
    if (syncedTabTitleRef.current !== nextTitle) {
      syncedTabTitleRef.current = nextTitle;
      onTabTitleChange(nextTitle);
    }
  }, [connectionIntent?.serverName, currentPath, navigationState.index, onTabTitleChange, status]);

  React.useEffect(() => {
    setPathInput(currentPath);
  }, [currentPath]);

  React.useEffect(() => {
    previewStateRef.current = previewState;
  }, [previewState]);

  React.useEffect(() => {
    if (!isAddressInputEditing) {
      return;
    }

    const focusFrameId = window.requestAnimationFrame(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(focusFrameId);
  }, [isAddressInputEditing]);

  React.useEffect(() => {
    return () => {
      if (addressInputContextMenuTimerRef.current !== null) {
        window.clearTimeout(addressInputContextMenuTimerRef.current);
      }
    };
  }, []);

  /**
   * Focuses and selects the active inline-edit input after React mounts it.
   *
   * @returns void.
   */
  const focusInlineEditInput = React.useCallback((): void => {
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, []);

  /**
   * Releases the short-lived menu focus guard used while inline edit starts.
   *
   * @returns void.
   */
  const releaseInlineEditMenuFocusHandoff = React.useCallback((): void => {
    if (inlineEditMenuFocusHandoffReleaseTimerRef.current !== null) {
      window.clearTimeout(inlineEditMenuFocusHandoffReleaseTimerRef.current);
      inlineEditMenuFocusHandoffReleaseTimerRef.current = null;
    }

    shouldPreventMenuCloseAutoFocusRef.current = false;
  }, []);

  /**
   * Keeps the menu close guard alive long enough for nested menus to finish restoring focus.
   *
   * @returns void.
   */
  const scheduleInlineEditMenuFocusHandoffRelease = React.useCallback((): void => {
    if (inlineEditMenuFocusHandoffReleaseTimerRef.current !== null) {
      window.clearTimeout(inlineEditMenuFocusHandoffReleaseTimerRef.current);
    }

    inlineEditMenuFocusHandoffReleaseTimerRef.current = window.setTimeout(() => {
      shouldPreventMenuCloseAutoFocusRef.current = false;
      inlineEditMenuFocusHandoffReleaseTimerRef.current = null;
    }, INLINE_EDIT_MENU_HANDOFF_RELEASE_DELAY_MS);
  }, []);

  /**
   * Marks menu close events as an inline-edit focus handoff until the input is stable.
   *
   * @returns void.
   */
  const requestInlineEditMenuFocusHandoff = React.useCallback((): void => {
    shouldPreventMenuCloseAutoFocusRef.current = true;
    scheduleInlineEditMenuFocusHandoffRelease();
  }, [scheduleInlineEditMenuFocusHandoffRelease]);

  /**
   * Prevents Radix menu focus restoration from immediately blurring inline edit inputs.
   *
   * @param event Radix close autofocus event.
   * @returns void.
   */
  const handleInlineEditMenuCloseAutoFocus = React.useCallback(
    (event: Event): void => {
      if (!shouldPreventMenuCloseAutoFocusRef.current) {
        return;
      }

      event.preventDefault();
      scheduleInlineEditMenuFocusHandoffRelease();
    },
    [scheduleInlineEditMenuFocusHandoffRelease],
  );

  /**
   * Runs an inline-edit action after menu selection has finished closing the source menu.
   *
   * @param action Action that starts rename or create state.
   * @returns void.
   */
  const runInlineEditMenuActionAfterClose = React.useCallback(
    (action: InlineEditMenuAction): void => {
      requestInlineEditMenuFocusHandoff();

      if (inlineEditMenuActionTimerRef.current !== null) {
        window.clearTimeout(inlineEditMenuActionTimerRef.current);
      }

      inlineEditMenuActionTimerRef.current = window.setTimeout(() => {
        inlineEditMenuActionTimerRef.current = null;

        void Promise.resolve()
          .then(action)
          .catch((error: unknown) => {
            releaseInlineEditMenuFocusHandoff();
            notifyError(error instanceof Error ? error.message : t('sftp.operationFailed'));
          });
      }, 0);
    },
    [notifyError, releaseInlineEditMenuFocusHandoff, requestInlineEditMenuFocusHandoff],
  );

  /**
   * Commits an inline edit unless the blur came from the menu-to-input focus handoff.
   *
   * @param commit Action that commits the current inline-edit draft.
   * @returns void.
   */
  const handleInlineEditInputBlur = React.useCallback(
    (commit: InlineEditMenuAction): void => {
      if (shouldPreventMenuCloseAutoFocusRef.current) {
        window.requestAnimationFrame(focusInlineEditInput);
        scheduleInlineEditMenuFocusHandoffRelease();
        return;
      }

      void Promise.resolve()
        .then(commit)
        .catch((error: unknown) => {
          notifyError(error instanceof Error ? error.message : t('sftp.operationFailed'));
        });
    },
    [focusInlineEditInput, notifyError, scheduleInlineEditMenuFocusHandoffRelease],
  );

  React.useEffect(() => {
    if (!renamingEntryPath && !pendingCreate) {
      return undefined;
    }

    const focusFrameId = window.requestAnimationFrame(() => {
      focusInlineEditInput();
      scheduleInlineEditMenuFocusHandoffRelease();
    });

    return () => window.cancelAnimationFrame(focusFrameId);
  }, [focusInlineEditInput, pendingCreate, renamingEntryPath, scheduleInlineEditMenuFocusHandoffRelease]);

  React.useEffect(() => {
    return () => {
      if (inlineEditMenuActionTimerRef.current !== null) {
        window.clearTimeout(inlineEditMenuActionTimerRef.current);
        inlineEditMenuActionTimerRef.current = null;
      }

      releaseInlineEditMenuFocusHandoff();
    };
  }, [releaseInlineEditMenuFocusHandoff]);

  const visibleEntries = React.useMemo(() => {
    const filteredEntries = filterSftpEntries(
      filterSftpEntriesByHiddenVisibility(entries, sftpShowHiddenEntries),
      filterQuery,
    );
    return sortSftpEntriesByDirectoryListView(filteredEntries, sftpDirectoryListView.sort);
  }, [entries, filterQuery, sftpDirectoryListView.sort, sftpShowHiddenEntries]);

  const selectedPathSet = React.useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const selectedEntries = React.useMemo(() => {
    return visibleEntries.filter((entry) => selectedPathSet.has(entry.path));
  }, [selectedPathSet, visibleEntries]);

  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const primarySelectedEntry = selectedEntries[0] ?? null;
  const selectedCount = selectedEntries.length;
  const hasSelection = selectedCount > 0;
  const hasSingleSelection = selectedCount === 1;

  const breadcrumbs = React.useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);
  const addressBreadcrumbRenderState = React.useMemo(
    () => resolveAddressBreadcrumbRenderState(breadcrumbs),
    [breadcrumbs],
  );
  const isBusy = status === 'connecting' || status === 'loading';
  const runningTaskCount = React.useMemo(
    () => sftpTasks.filter((task) => task.status === 'running').length,
    [sftpTasks],
  );
  const queuedTaskCount = React.useMemo(() => sftpTasks.filter((task) => task.status === 'queued').length, [sftpTasks]);
  const activeTaskCount = runningTaskCount + queuedTaskCount;
  const sortedSftpTasks = React.useMemo(() => {
    return [...sftpTasks].sort((left, right) => {
      const statusDelta = SFTP_TASK_STATUS_ORDER[left.status] - SFTP_TASK_STATUS_ORDER[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return left.createdAt - right.createdAt;
    });
  }, [sftpTasks]);
  const taskToolbarLabel = React.useMemo(
    () =>
      activeTaskCount > 0
        ? formatSftpTaskToolbarLabel(runningTaskCount, queuedTaskCount)
        : t('sftp.tasks.toolbarRecent', { count: sftpTasks.length }),
    [activeTaskCount, queuedTaskCount, runningTaskCount, sftpTasks.length],
  );
  const shortcutModifier = React.useMemo(() => resolveShortcutModifier(), []);
  const canGoBack = navigationState.index > 0;
  const canGoForward = navigationState.index >= 0 && navigationState.index < navigationState.paths.length - 1;
  const hasSftpSession = Boolean(sessionId);
  const backNavigationHistoryItems = React.useMemo(
    () => buildNavigationHistoryMenuItems(navigationState, 'back'),
    [navigationState],
  );
  const forwardNavigationHistoryItems = React.useMemo(
    () => buildNavigationHistoryMenuItems(navigationState, 'forward'),
    [navigationState],
  );
  const canUseFileActions = hasSftpSession && status === 'ready' && !isBusy;
  const hasParentDirectoryListEntry = sftpShowParentDirectoryEntry;
  const canActivateParentDirectoryListEntry = Boolean(parentPath);
  const activeTextPreview = previewState?.status === 'text' ? previewState : null;
  const hasTextPreview = Boolean(activeTextPreview);
  const isPreviewDirty = Boolean(activeTextPreview && activeTextPreview.content !== activeTextPreview.savedContent);
  const isPreviewSaving = Boolean(activeTextPreview?.isSaving);
  const sftpWorkbenchGridClassName =
    sftpAuxiliarySidebarMode === 'off'
      ? 'grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)] gap-2.5 overflow-hidden'
      : sftpAuxiliarySidebarMode === 'preview'
        ? 'grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_minmax(320px,420px)] gap-2.5 overflow-hidden'
        : 'grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_minmax(240px,320px)] gap-2.5 overflow-hidden';

  React.useEffect(() => {
    const visiblePathSet = new Set(visibleEntries.map((entry) => entry.path));
    setSelectedPaths((previous) => previous.filter((path) => visiblePathSet.has(path)));
    setSelectionAnchorPath((previous) => (previous && visiblePathSet.has(previous) ? previous : ''));
  }, [visibleEntries]);

  React.useEffect(() => {
    setTreeNodes((previous) => {
      let next = previous;
      Object.values(directoryCacheRef.current).forEach((cacheEntry) => {
        next = mergeResolvedDirectoryIntoTree(
          next,
          cacheEntry.path,
          cacheEntry.path,
          cacheEntry.entries,
          sftpShowHiddenEntries,
        );
      });

      return next;
    });
  }, [sftpShowHiddenEntries]);

  /**
   * Blocks selection changes that would silently drop unsaved preview edits.
   *
   * @returns Whether the caller should keep the current selection and preview state.
   */
  const shouldPreserveDirtyPreviewState = React.useCallback((): boolean => {
    if (!isDirtySftpTextPreviewState(previewStateRef.current)) {
      return false;
    }

    notifyError(t('sftp.previewUnsavedChanges'));
    return true;
  }, [notifyError]);

  /**
   * Clears preview state unless doing so would discard local Monaco edits.
   *
   * @param options Clear behavior options.
   * @returns Whether the preview state was cleared.
   */
  const clearPreviewState = React.useCallback(
    (options: { force?: boolean } = {}): boolean => {
      if (!options.force && shouldPreserveDirtyPreviewState()) {
        return false;
      }

      previewLoadGenerationRef.current += 1;
      previewEditorRef.current = null;
      previewStateRef.current = null;
      setPreviewState(null);
      return true;
    },
    [shouldPreserveDirtyPreviewState],
  );

  /**
   * Clears preview state for a new single-entry selection when needed.
   *
   * @param nextEntry Entry that will become the single selection.
   * @returns Whether selection may proceed.
   */
  const clearPreviewStateForSelection = React.useCallback(
    (nextEntry: ApiSftpEntry | null): boolean => {
      const currentPreviewPath = resolvePreviewStatePath(previewStateRef.current);
      if (nextEntry && currentPreviewPath === nextEntry.path) {
        return true;
      }

      return clearPreviewState();
    },
    [clearPreviewState],
  );

  /**
   * Clears preview state for hard runtime resets where preserving local state is unsafe.
   *
   * @returns void.
   */
  const forceClearPreviewState = React.useCallback((): void => {
    void clearPreviewState({ force: true });
  }, [clearPreviewState]);

  const fileNavigationRows = React.useMemo<SftpFileNavigationRow[]>(() => {
    const rows: SftpFileNavigationRow[] = [];

    if (canActivateParentDirectoryListEntry) {
      rows.push({ kind: 'parent', key: PARENT_DIRECTORY_ROW_KEY });
    }

    visibleEntries.forEach((entry) => {
      rows.push({ kind: 'entry', key: entry.path, entry });
    });

    return rows;
  }, [canActivateParentDirectoryListEntry, visibleEntries]);

  const resolvedActiveFileRowKey = activeFileRowKey || fileNavigationRows[0]?.key || '';
  const clipboardPaths = React.useMemo(() => {
    return new Set(clipboardState?.entries.map((entry) => entry.path) ?? []);
  }, [clipboardState]);

  const resetSelection = React.useCallback((): void => {
    if (!clearPreviewState()) {
      return;
    }

    setSelectedPaths([]);
    setSelectionAnchorPath('');
  }, [clearPreviewState]);

  const selectSingleEntry = React.useCallback(
    (entry: ApiSftpEntry | null): void => {
      if (!clearPreviewStateForSelection(entry)) {
        return;
      }

      if (!entry) {
        setSelectedPaths([]);
        setSelectionAnchorPath('');
        return;
      }

      setSelectedPaths([entry.path]);
      setSelectionAnchorPath(entry.path);
    },
    [clearPreviewStateForSelection],
  );

  const selectEntryRange = React.useCallback(
    (anchorPath: string, targetPath: string, shouldExtendSelection: boolean): void => {
      const rangePaths = resolveRangeSelectionPaths(visibleEntries, anchorPath, targetPath);
      if (rangePaths.length === 0) {
        return;
      }

      if (!clearPreviewState()) {
        return;
      }

      setSelectedPaths((previous) => {
        const nextPaths = shouldExtendSelection ? [...previous, ...rangePaths] : rangePaths;
        return Array.from(new Set(nextPaths));
      });
    },
    [clearPreviewState, visibleEntries],
  );

  /**
   * Applies desktop file-manager selection modifiers to one target entry.
   *
   * @param entry Entry that receives the selection action.
   * @param event Platform modifier key snapshot for the action.
   * @param options Selection anchor override for keyboard range expansion.
   * @returns void.
   */
  const selectEntryWithModifiers = React.useCallback(
    (entry: ApiSftpEntry, event: SftpSelectionModifierEvent, options: { rangeAnchorPath?: string } = {}): void => {
      const shouldToggle = window.electron?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
      const shouldExtendRange = event.shiftKey;

      if (shouldExtendRange) {
        const anchorPath = options.rangeAnchorPath ?? selectionAnchorPath;
        selectEntryRange(anchorPath, entry.path, shouldToggle);
        if (!selectionAnchorPath) {
          setSelectionAnchorPath(anchorPath || entry.path);
        }
        return;
      }

      if (shouldToggle) {
        if (!clearPreviewState()) {
          return;
        }

        setSelectedPaths((previous) => {
          if (previous.includes(entry.path)) {
            return previous.filter((path) => path !== entry.path);
          }

          return [...previous, entry.path];
        });
        setSelectionAnchorPath(entry.path);
        return;
      }

      selectSingleEntry(entry);
    },
    [clearPreviewState, selectEntryRange, selectSingleEntry, selectionAnchorPath],
  );

  const pruneSelectionToEntries = React.useCallback((nextEntries: ApiSftpEntry[]): void => {
    const validPaths = new Set(nextEntries.map((entry) => entry.path));
    setSelectedPaths((previous) => previous.filter((path) => validPaths.has(path)));
    setSelectionAnchorPath((previous) => (previous && validPaths.has(previous) ? previous : ''));
  }, []);

  const requestHostFingerprintTrust = React.useCallback((prompt: HostFingerprintPrompt): Promise<boolean> => {
    return new Promise((resolve) => {
      pendingPromptResolverRef.current = resolve;
      setHostFingerprintPrompt(prompt);
    });
  }, []);

  const resolveHostFingerprintPrompt = React.useCallback((accepted: boolean): void => {
    pendingPromptResolverRef.current?.(accepted);
    pendingPromptResolverRef.current = null;
    setHostFingerprintPrompt(null);
  }, []);

  const requestDeleteConfirmation = React.useCallback(
    (entriesToDelete: ApiSftpEntry[], source: SftpDeleteInvocationSource): Promise<boolean> => {
      return new Promise((resolve) => {
        pendingDeleteConfirmationResolverRef.current = resolve;
        setDeleteConfirmationPrompt({ entries: entriesToDelete, source });
      });
    },
    [],
  );

  const resolveDeleteConfirmationPrompt = React.useCallback((accepted: boolean): void => {
    pendingDeleteConfirmationResolverRef.current?.(accepted);
    pendingDeleteConfirmationResolverRef.current = null;
    setDeleteConfirmationPrompt(null);
  }, []);

  /**
   * Requests explicit confirmation before overwriting a remote file that changed after opening.
   *
   * @param prompt Remote conflict prompt details.
   * @returns Whether the user chose to overwrite the remote file.
   */
  const requestUploadConflictConfirmation = React.useCallback(
    (prompt: SftpUploadConflictConfirmationPrompt): Promise<boolean> => {
      pendingUploadConflictResolverRef.current?.(false);
      return new Promise((resolve) => {
        pendingUploadConflictResolverRef.current = resolve;
        setUploadConflictConfirmationPrompt(prompt);
      });
    },
    [],
  );

  /**
   * Resolves the upload conflict confirmation dialog.
   *
   * @param accepted Whether the user wants to overwrite the changed remote file.
   * @returns void.
   */
  const resolveUploadConflictConfirmationPrompt = React.useCallback((accepted: boolean): void => {
    pendingUploadConflictResolverRef.current?.(accepted);
    pendingUploadConflictResolverRef.current = null;
    setUploadConflictConfirmationPrompt(null);
  }, []);

  /**
   * Detects the stale-session error that should trigger SFTP reconnect.
   *
   * @param error Error thrown by the renderer backend client.
   * @returns Whether this failure represents a missing or closed SFTP session.
   */
  const isSftpSessionNotFoundError = React.useCallback((error: unknown): boolean => {
    return isBackendApiError(error) && error.code === 'SFTP_SESSION_NOT_FOUND';
  }, []);

  /**
   * Detects opened-file upload conflicts that should ask for explicit overwrite confirmation.
   *
   * @param error Error thrown by the renderer backend client.
   * @returns Whether this failure represents a remote file conflict.
   */
  const isSftpUploadConflictError = React.useCallback((error: unknown): boolean => {
    return isBackendApiError(error) && error.code === 'SFTP_UPLOAD_CONFLICT';
  }, []);

  /**
   * Shows SFTP reconnect progress in the task list without entering the FIFO operation queue.
   *
   * @param operation Reconnect implementation to run immediately.
   * @returns Promise resolved with the new active session id.
   */
  const runSftpReconnectTask = React.useCallback(
    (operation: (context: SftpTaskContext) => Promise<string>): Promise<string> => {
      const taskId = createSftpTaskId();
      const task: SftpTaskState = {
        id: taskId,
        label: t('sftp.tasks.reconnect'),
        detail: t('sftp.tasks.reconnecting'),
        status: 'running',
        createdAt: Date.now(),
        startedAt: Date.now(),
        progress: { completed: 0, total: 1 },
      };

      clearTaskRetentionTimer(taskId);
      setSftpTasks((previous) => [...previous, task]);

      const taskGeneration = taskQueueGenerationRef.current;
      const isCurrent = (): boolean => taskQueueGenerationRef.current === taskGeneration;
      const update = (patch: Partial<Pick<SftpTaskState, 'detail' | 'progress'>>): void => {
        if (!isCurrent()) {
          return;
        }

        setSftpTasks((previous) =>
          previous.map((currentTask) => (currentTask.id === taskId ? { ...currentTask, ...patch } : currentTask)),
        );
      };

      return operation({ taskId, isCurrent, update })
        .then((nextSessionId) => {
          if (isCurrent()) {
            setSftpTasks((previous) =>
              previous.map((currentTask) =>
                currentTask.id === taskId
                  ? {
                      ...currentTask,
                      detail: t('sftp.tasks.reconnectComplete'),
                      status: 'success',
                      finishedAt: Date.now(),
                      progress: { completed: 1, total: 1 },
                    }
                  : currentTask,
              ),
            );
            scheduleTaskRetentionCleanup(taskId);
          }

          return nextSessionId;
        })
        .catch((error: unknown) => {
          if (isCurrent()) {
            const message = error instanceof Error ? error.message : t('sftp.reconnectFailed');
            setSftpTasks((previous) =>
              previous.map((currentTask) =>
                currentTask.id === taskId
                  ? {
                      ...currentTask,
                      detail: message,
                      status: 'failed',
                      finishedAt: Date.now(),
                    }
                  : currentTask,
              ),
            );
            scheduleTaskRetentionCleanup(taskId);
          }

          throw error;
        });
    },
    [clearTaskRetentionTimer, scheduleTaskRetentionCleanup],
  );

  /**
   * Creates a replacement SFTP session for the current tab after the old one expires.
   *
   * @param preferredPath Current remote path that should be restored when possible.
   * @returns New active backend session id.
   */
  const reconnectSftpSession = React.useCallback(
    async (preferredPath: string): Promise<string> => {
      if (!connectionIntent?.serverId) {
        throw new Error(t('sftp.noSession'));
      }

      const fallbackPath = connectionIntent.initialPath ?? '.';
      const candidatePaths = Array.from(new Set([preferredPath.trim() || fallbackPath, fallbackPath]));
      const trustRejectedMessage = t('ssh.hostFingerprintNotTrusted');

      for (const initialPath of candidatePaths) {
        try {
          let shouldRetryTrust = true;
          while (shouldRetryTrust) {
            shouldRetryTrust = false;
            const response = await createSftpSession({
              serverId: connectionIntent.serverId,
              initialPath,
              connectTimeoutSec: 45,
            });

            if (!response.success && response.code === 'SSH_HOST_UNTRUSTED') {
              const accepted = await requestHostFingerprintTrust({
                serverId: response.data.serverId,
                host: response.data.host,
                port: response.data.port,
                algorithm: response.data.algorithm,
                fingerprint: response.data.fingerprint,
              });

              if (!accepted) {
                throw new Error(trustRejectedMessage);
              }

              await trustSshFingerprint({
                serverId: response.data.serverId,
                fingerprintSha256: response.data.fingerprint,
                algorithm: response.data.algorithm,
              });
              shouldRetryTrust = true;
              continue;
            }

            const nextSessionId = response.data.sessionId;
            sessionIdRef.current = nextSessionId;
            setSessionId(nextSessionId);
            return nextSessionId;
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.message === trustRejectedMessage) {
            throw error;
          }

          if (initialPath === candidatePaths[candidatePaths.length - 1]) {
            throw error;
          }
        }
      }

      throw new Error(t('sftp.reconnectFailed'));
    },
    [connectionIntent?.initialPath, connectionIntent?.serverId, requestHostFingerprintTrust],
  );

  /**
   * Ensures one reconnect attempt is shared by every operation that observes the same stale session.
   *
   * @returns New active backend session id.
   */
  const ensureSftpSessionForOperation = React.useCallback(async (): Promise<string> => {
    const existingReconnect = reconnectPromiseRef.current;
    if (existingReconnect) {
      return existingReconnect;
    }

    const reconnectPromise = runSftpReconnectTask(async ({ update }) => {
      update({ detail: t('sftp.tasks.reconnecting'), progress: { completed: 0, total: 1 } });
      const nextSessionId = await reconnectSftpSession(currentPathRef.current);
      update({ progress: { completed: 1, total: 1 } });
      return nextSessionId;
    }).finally(() => {
      if (reconnectPromiseRef.current === reconnectPromise) {
        reconnectPromiseRef.current = null;
      }
    });

    reconnectPromiseRef.current = reconnectPromise;
    return reconnectPromise;
  }, [reconnectSftpSession, runSftpReconnectTask]);

  /**
   * Runs one SFTP backend request and retries once after passive session recovery.
   *
   * @param operation Operation that receives the session id to call.
   * @returns Operation result.
   */
  const runWithSftpReconnect = React.useCallback(
    async function runWithSftpReconnectRequest<TResult>(
      operation: (activeSessionId: string) => Promise<TResult>,
    ): Promise<TResult> {
      const initialSessionId = sessionIdRef.current;
      if (!initialSessionId) {
        throw new Error(t('sftp.noSession'));
      }

      try {
        return await operation(initialSessionId);
      } catch (error: unknown) {
        if (sftpReconnectMode === 'off' || !isSftpSessionNotFoundError(error)) {
          throw error;
        }

        const latestSessionId = sessionIdRef.current;
        if (latestSessionId && latestSessionId !== initialSessionId) {
          return await operation(latestSessionId);
        }

        const nextSessionId = await ensureSftpSessionForOperation();
        return await operation(nextSessionId);
      }
    },
    [ensureSftpSessionForOperation, isSftpSessionNotFoundError, sftpReconnectMode],
  );

  const setTreeNodeLoading = React.useCallback((directoryPath: string, isLoading: boolean): void => {
    setTreeNodes((previous) => {
      const existing = previous[directoryPath];
      if (!existing) {
        return previous;
      }

      return {
        ...previous,
        [directoryPath]: {
          ...existing,
          isExpanded: isLoading ? true : existing.isExpanded,
          isLoading,
        },
      };
    });
  }, []);

  const syncAncestorDirectories = React.useCallback(
    async (directoryPath: string, isCancelled?: () => boolean): Promise<void> => {
      const ancestorPaths = resolveAncestorDirectoryPaths(directoryPath);

      for (const ancestorPath of ancestorPaths) {
        if (isCancelled?.()) {
          return;
        }

        const cachedDirectory = directoryCacheRef.current[ancestorPath];
        if (cachedDirectory) {
          setTreeNodes((previous) =>
            mergeResolvedDirectoryIntoTree(
              previous,
              ancestorPath,
              cachedDirectory.path,
              cachedDirectory.entries,
              sftpShowHiddenEntriesRef.current,
            ),
          );
          continue;
        }

        setTreeNodeLoading(ancestorPath, true);

        try {
          const response = await runWithSftpReconnect((activeSessionId) =>
            listSftpDirectory(activeSessionId, { path: ancestorPath }),
          );
          if (isCancelled?.()) {
            return;
          }

          const sortedEntries = sortSftpEntries(response.data.entries);
          directoryCacheRef.current = {
            ...directoryCacheRef.current,
            [ancestorPath]: {
              path: response.data.path,
              parentPath: response.data.parentPath,
              entries: sortedEntries,
            },
            [response.data.path]: {
              path: response.data.path,
              parentPath: response.data.parentPath,
              entries: sortedEntries,
            },
          };
          setTreeNodes((previous) =>
            mergeResolvedDirectoryIntoTree(
              previous,
              ancestorPath,
              response.data.path,
              sortedEntries,
              sftpShowHiddenEntriesRef.current,
            ),
          );
        } catch {
          setTreeNodeLoading(ancestorPath, false);
        }
      }
    },
    [runWithSftpReconnect, setTreeNodeLoading],
  );

  const applyDirectoryCacheEntry = React.useCallback(
    (cacheEntry: DirectoryCacheEntry): void => {
      setCurrentPath(cacheEntry.path);
      setParentPath(cacheEntry.parentPath);
      setEntries(cacheEntry.entries);
      resetSelection();
      setFilterQuery('');
      setTreeNodes((previous) =>
        mergeResolvedDirectoryIntoTree(
          previous,
          cacheEntry.path,
          cacheEntry.path,
          cacheEntry.entries,
          sftpShowHiddenEntriesRef.current,
        ),
      );
      setStatus('ready');
      setErrorMessage('');
    },
    [resetSelection],
  );

  const invalidateDirectoryCache = React.useCallback((directoryPath?: string): void => {
    if (!directoryPath) {
      directoryCacheRef.current = {};
      return;
    }

    const nextCache = { ...directoryCacheRef.current };
    delete nextCache[directoryPath];
    directoryCacheRef.current = nextCache;
  }, []);

  const loadDirectory = React.useCallback(
    async (directoryPath: string, options?: DirectoryLoadOptions): Promise<string | null> => {
      const cachedDirectory = directoryCacheRef.current[directoryPath];
      if (cachedDirectory && !options?.forceRefresh) {
        applyDirectoryCacheEntry(cachedDirectory);
        void syncAncestorDirectories(cachedDirectory.path, options?.isCancelled);
        return cachedDirectory.path;
      }

      const shouldPreserveCurrentView = options?.preserveCurrentView === true;
      if (shouldPreserveCurrentView) {
        setIsRefreshingDirectory(true);
      } else {
        setStatus((previous) => (previous === 'connecting' ? 'connecting' : 'loading'));
      }

      setErrorMessage('');
      setTreeNodeLoading(directoryPath, true);

      try {
        const response = await runWithSftpReconnect((activeSessionId) =>
          listSftpDirectory(activeSessionId, { path: directoryPath }),
        );
        if (options?.isCancelled?.()) {
          setIsRefreshingDirectory(false);
          return null;
        }

        const sortedEntries = sortSftpEntries(response.data.entries);
        setCurrentPath(response.data.path);
        setParentPath(response.data.parentPath);
        setEntries(sortedEntries);
        if (!shouldPreserveCurrentView) {
          resetSelection();
          setFilterQuery('');
        } else {
          pruneSelectionToEntries(sortedEntries);
        }
        setTreeNodes((previous) =>
          mergeResolvedDirectoryIntoTree(
            previous,
            directoryPath,
            response.data.path,
            sortedEntries,
            sftpShowHiddenEntriesRef.current,
          ),
        );
        setIsRefreshingDirectory(false);
        directoryCacheRef.current = {
          ...directoryCacheRef.current,
          [directoryPath]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
          [response.data.path]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
        };
        setStatus('ready');
        void syncAncestorDirectories(response.data.path, options?.isCancelled);
        return response.data.path;
      } catch (error: unknown) {
        if (options?.isCancelled?.()) {
          setIsRefreshingDirectory(false);
          return null;
        }

        const message = error instanceof Error ? error.message : t('sftp.loadFailed');
        setIsRefreshingDirectory(false);
        setTreeNodeLoading(directoryPath, false);
        void syncAncestorDirectories(directoryPath, options?.isCancelled);
        setErrorMessage(message);
        if (!shouldPreserveCurrentView) {
          setStatus('error');
        }

        notifyError(message);
        return null;
      }
    },
    [
      applyDirectoryCacheEntry,
      notifyError,
      pruneSelectionToEntries,
      resetSelection,
      runWithSftpReconnect,
      setTreeNodeLoading,
      syncAncestorDirectories,
    ],
  );

  const loadTreeDirectoryChildren = React.useCallback(
    async (directoryPath: string): Promise<void> => {
      const cachedDirectory = directoryCacheRef.current[directoryPath];
      if (cachedDirectory) {
        setTreeNodes((previous) =>
          mergeResolvedDirectoryIntoTree(
            previous,
            directoryPath,
            cachedDirectory.path,
            cachedDirectory.entries,
            sftpShowHiddenEntriesRef.current,
          ),
        );
        return;
      }

      setTreeNodeLoading(directoryPath, true);

      try {
        const response = await runWithSftpReconnect((activeSessionId) =>
          listSftpDirectory(activeSessionId, { path: directoryPath }),
        );
        const sortedEntries = sortSftpEntries(response.data.entries);
        directoryCacheRef.current = {
          ...directoryCacheRef.current,
          [directoryPath]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
          [response.data.path]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
        };
        setTreeNodes((previous) =>
          mergeResolvedDirectoryIntoTree(
            previous,
            directoryPath,
            response.data.path,
            sortedEntries,
            sftpShowHiddenEntriesRef.current,
          ),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : t('sftp.loadFailed');
        setTreeNodeLoading(directoryPath, false);
        notifyError(message);
      }
    },
    [notifyError, runWithSftpReconnect, setTreeNodeLoading],
  );

  /**
   * Persists whether hidden SFTP entries should be shown in browser surfaces.
   *
   * @param showHiddenEntries Next hidden-entry visibility state.
   * @returns Promise that resolves after the settings store is synchronized.
   */
  const setSftpHiddenEntriesVisibility = React.useCallback(
    async (showHiddenEntries: boolean): Promise<void> => {
      if (settingsValues.sftpShowHiddenEntries === showHiddenEntries) {
        return;
      }

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpShowHiddenEntries: showHiddenEntries,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [notifyError, settingsValues],
  );

  const setSftpAuxiliarySidebarMode = React.useCallback(
    async (mode: SftpAuxiliarySidebarMode): Promise<void> => {
      if (mode !== 'preview' && isDirtySftpTextPreviewState(previewStateRef.current)) {
        notifyError(t('sftp.previewUnsavedChanges'));
        return;
      }

      if (settingsValues.sftpAuxiliarySidebarMode === mode) {
        return;
      }

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpAuxiliarySidebarMode: mode,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [notifyError, settingsValues],
  );

  const persistSftpDirectoryListView = React.useCallback(
    async (nextDirectoryListView: SftpDirectoryListViewSetting): Promise<void> => {
      const currentDirectoryListView = directoryListViewDraft ?? settingsValues.sftpDirectoryListView;
      if (
        stringifySftpDirectoryListView(currentDirectoryListView) ===
        stringifySftpDirectoryListView(nextDirectoryListView)
      ) {
        return;
      }

      setDirectoryListViewDraft(nextDirectoryListView);

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpDirectoryListView: nextDirectoryListView,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        setDirectoryListViewDraft(null);
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [directoryListViewDraft, notifyError, settingsValues],
  );

  const setSftpDirectoryListSort = React.useCallback(
    (sort: { field: SftpDirectoryListColumnId; direction: SftpDirectoryListSortDirection }): void => {
      void persistSftpDirectoryListView({
        ...sftpDirectoryListView,
        sort,
      });
    },
    [persistSftpDirectoryListView, sftpDirectoryListView],
  );

  const handleSftpDirectoryListSortFieldClick = React.useCallback(
    (columnId: SftpDirectoryListColumnId): void => {
      const isCurrentSortField = sftpDirectoryListView.sort.field === columnId;
      const nextDirection: SftpDirectoryListSortDirection =
        isCurrentSortField && sftpDirectoryListView.sort.direction === 'asc' ? 'desc' : 'asc';

      setSftpDirectoryListSort({
        field: columnId,
        direction: isCurrentSortField ? nextDirection : 'asc',
      });
    },
    [setSftpDirectoryListSort, sftpDirectoryListView.sort],
  );

  const setSftpDirectoryListColumnVisibility = React.useCallback(
    (columnId: SftpDirectoryListColumnId, visible: boolean): void => {
      void persistSftpDirectoryListView({
        ...sftpDirectoryListView,
        columns: sftpDirectoryListView.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                visible: column.id === 'name' ? true : visible,
              }
            : column,
        ),
      });
    },
    [persistSftpDirectoryListView, sftpDirectoryListView],
  );

  const setSftpDirectoryListColumnOrder = React.useCallback(
    (columnIds: SftpDirectoryListColumnId[]): void => {
      const currentColumnsById = new Map(sftpDirectoryListView.columns.map((column) => [column.id, column]));
      const nextColumns = columnIds.map((columnId) => {
        const currentColumn = currentColumnsById.get(columnId);
        return {
          id: columnId,
          visible: columnId === 'name' ? true : Boolean(currentColumn?.visible),
        };
      });

      void persistSftpDirectoryListView({
        ...sftpDirectoryListView,
        columns: nextColumns,
      });
    },
    [persistSftpDirectoryListView, sftpDirectoryListView],
  );

  const createSessionForIntent = React.useCallback(
    async (isCancelled = (): boolean => false): Promise<void> => {
      if (!connectionIntent?.serverId) {
        setStatus('idle');
        return;
      }

      setStatus('connecting');
      setErrorMessage('');

      let shouldRetry = true;
      while (shouldRetry) {
        shouldRetry = false;
        const response = await createSftpSession({
          serverId: connectionIntent.serverId,
          initialPath: connectionIntent.initialPath ?? '.',
          connectTimeoutSec: 45,
        });

        if (!response.success && response.code === 'SSH_HOST_UNTRUSTED') {
          const accepted = await requestHostFingerprintTrust({
            serverId: response.data.serverId,
            host: response.data.host,
            port: response.data.port,
            algorithm: response.data.algorithm,
            fingerprint: response.data.fingerprint,
          });

          if (!accepted) {
            throw new Error(t('ssh.hostFingerprintNotTrusted'));
          }

          await trustSshFingerprint({
            serverId: response.data.serverId,
            fingerprintSha256: response.data.fingerprint,
            algorithm: response.data.algorithm,
          });
          shouldRetry = true;
          continue;
        }

        const nextSessionId = response.data.sessionId;
        if (isCancelled()) {
          await closeSftpSession(nextSessionId).catch(() => undefined);
          return;
        }

        sessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        const loadedPath = await loadDirectory(response.data.currentPath, { isCancelled });

        if (!isCancelled() && loadedPath) {
          setNavigationState({ paths: [loadedPath], index: 0 });
        }

        if (isCancelled()) {
          await closeSftpSession(nextSessionId).catch(() => undefined);
        }
      }
    },
    [connectionIntent?.initialPath, connectionIntent?.serverId, loadDirectory, requestHostFingerprintTrust],
  );

  React.useEffect(() => {
    let isCancelled = false;

    const run = async (): Promise<void> => {
      if (!connectionIntent?.serverId) {
        return;
      }

      const previousSessionId = sessionIdRef.current;
      if (previousSessionId) {
        await closeSftpSession(previousSessionId).catch(() => undefined);
        if (!isCancelled) {
          setSessionId('');
        }
      }

      if (!isCancelled) {
        setEntries([]);
        setSelectedPaths([]);
        setSelectionAnchorPath('');
        forceClearPreviewState();
        setTreeNodes({});
        setClipboardState(null);
        stopAllWatchedOpenFiles();
        temporaryOpenFilePathsRef.current = {};
        imagePreviewTempFilesRef.current = {};
        setOpenWithApplicationsByPath({});
        setLoadingOpenWithPath('');
        setPendingCreate(null);
        setRenamingEntryPath('');
        setSftpTasks([]);
        taskQueueGenerationRef.current += 1;
        taskQueueRef.current = [];
        isTaskQueueRunningRef.current = false;
        clearAllTaskRetentionTimers();
        directoryCacheRef.current = {};
        setCurrentPath(connectionIntent.initialPath ?? '.');
        setParentPath(undefined);
        setNavigationState({ paths: [], index: -1 });
        setFilterQuery('');
      }

      try {
        await createSessionForIntent(() => isCancelled);
      } catch (error: unknown) {
        if (isCancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : t('sftp.sessionInitFailed');
        setErrorMessage(message);
        setStatus('error');
        notifyError(message);
      }
    };

    void run();

    return () => {
      isCancelled = true;
      resolveHostFingerprintPrompt(false);
    };
  }, [
    connectionIntent?.createdAt,
    connectionIntent?.initialPath,
    connectionIntent?.serverId,
    clearAllTaskRetentionTimers,
    createSessionForIntent,
    forceClearPreviewState,
    notifyError,
    resolveHostFingerprintPrompt,
    stopAllWatchedOpenFiles,
  ]);

  React.useEffect(() => {
    return () => {
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) {
        void closeSftpSession(activeSessionId);
      }
    };
  }, []);

  const handleHistoryJump = React.useCallback(
    async (nextIndex: number): Promise<void> => {
      if (!hasSftpSession || nextIndex < 0 || nextIndex >= navigationState.paths.length) {
        return;
      }

      const targetPath = navigationState.paths[nextIndex];
      if (!targetPath) {
        return;
      }

      const loadedPath = await loadDirectory(targetPath);
      if (!loadedPath) {
        return;
      }

      setNavigationState((previous) => {
        const nextPaths = [...previous.paths];
        nextPaths[nextIndex] = loadedPath;
        return { paths: nextPaths, index: nextIndex };
      });
    },
    [hasSftpSession, loadDirectory, navigationState.paths],
  );

  /**
   * Renders direct SFTP history jump choices for a toolbar navigation button.
   *
   * @param items Reachable history targets for the button direction.
   * @returns Context-menu items that jump directly to the selected history entry.
   */
  const renderNavigationHistoryMenuItems = React.useCallback(
    (items: NavigationHistoryMenuItem[]): React.ReactNode => {
      return items.map((item) => (
        <ContextMenuItem
          key={`${item.index}:${item.path}`}
          aria-label={t('sftp.actions.historyJump', { path: item.path })}
          disabled={isBusy}
          onSelect={() => {
            void handleHistoryJump(item.index);
          }}
        >
          <span
            className="min-w-0 flex-1 truncate"
            title={t('sftp.actions.historyJump', { path: item.path })}
          >
            {item.path}
          </span>
        </ContextMenuItem>
      ));
    },
    [handleHistoryJump, isBusy],
  );

  /**
   * Renders a toolbar history button, only mounting its context menu when it has jump targets.
   *
   * @param options Button label, icon, enabled state, step handler, and direct jump targets.
   * @returns Toolbar navigation control with optional history context menu.
   */
  const renderNavigationHistoryControl = ({
    label,
    icon,
    items,
    disabled,
    onStep,
  }: NavigationHistoryControlOptions): React.ReactNode => {
    if (items.length === 0) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={label}
              variant="ghostIcon"
              disabled={disabled}
              onClick={onStep}
            >
              {icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      );
    }

    return (
      <ContextMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>
              <Button
                aria-label={label}
                variant="ghostIcon"
                disabled={disabled}
                onClick={onStep}
              >
                {icon}
              </Button>
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <ContextMenuContent className="min-w-[220px]">{renderNavigationHistoryMenuItems(items)}</ContextMenuContent>
      </ContextMenu>
    );
  };

  const navigateToPath = React.useCallback(
    async (directoryPath: string): Promise<boolean> => {
      const trimmedPath = directoryPath.trim();
      if (!hasSftpSession || !trimmedPath) {
        return false;
      }

      const loadedPath = await loadDirectory(trimmedPath);
      if (!loadedPath) {
        return false;
      }

      setNavigationState((previous) => {
        const currentHistoryPath = previous.paths[previous.index];
        if (currentHistoryPath === loadedPath) {
          return previous;
        }

        const retainedPaths = previous.index >= 0 ? previous.paths.slice(0, previous.index + 1) : [];
        const nextPaths = [...retainedPaths, loadedPath];
        return { paths: nextPaths, index: nextPaths.length - 1 };
      });
      return true;
    },
    [hasSftpSession, loadDirectory],
  );

  const handleRefresh = React.useCallback(() => {
    if (!hasSftpSession) {
      return;
    }

    void loadDirectory(currentPath, { forceRefresh: true, preserveCurrentView: true });
  }, [currentPath, hasSftpSession, loadDirectory]);

  const handleTreeDirectoryRefresh = React.useCallback(
    (directoryPath: string): void => {
      if (!hasSftpSession) {
        return;
      }

      invalidateDirectoryCache(directoryPath);
      if (directoryPath === currentPath) {
        void loadDirectory(directoryPath, { forceRefresh: true, preserveCurrentView: true });
        return;
      }

      void loadTreeDirectoryChildren(directoryPath);
    },
    [currentPath, hasSftpSession, invalidateDirectoryCache, loadDirectory, loadTreeDirectoryChildren],
  );

  const refreshCurrentDirectoryAfterOperation = React.useCallback(
    async (affectedDirectoryPaths: readonly string[] = []): Promise<void> => {
      if (!sessionIdRef.current) {
        return;
      }

      const activePath = currentPathRef.current;
      const pathsToInvalidate = Array.from(new Set([activePath, ...affectedDirectoryPaths]));
      pathsToInvalidate.forEach((directoryPath) => {
        invalidateDirectoryCache(directoryPath);
      });
      pathsToInvalidate
        .filter((directoryPath) => directoryPath !== activePath)
        .forEach((directoryPath) => {
          void loadTreeDirectoryChildren(directoryPath);
        });

      await loadDirectory(activePath, {
        forceRefresh: true,
        preserveCurrentView: true,
      });
    },
    [invalidateDirectoryCache, loadDirectory, loadTreeDirectoryChildren],
  );

  /**
   * Updates an opened-file watcher with fresh remote metadata from the directory cache.
   *
   * @param remotePath Remote file path to refresh.
   * @returns void.
   */
  const syncWatchedOpenFileSnapshotFromCache = React.useCallback((remotePath: string): void => {
    const parentDirectoryPath = resolveEntryParentPath(remotePath);
    const cacheEntry = parentDirectoryPath ? directoryCacheRef.current[parentDirectoryPath] : undefined;
    const refreshedEntry = cacheEntry?.entries.find((entry) => entry.path === remotePath && entry.type === 'file');
    const watchedFile = watchedOpenFilesRef.current[remotePath];
    if (!watchedFile || !refreshedEntry) {
      return;
    }

    watchedOpenFilesRef.current = {
      ...watchedOpenFilesRef.current,
      [remotePath]: {
        ...watchedFile,
        remoteSnapshot: {
          size: refreshedEntry.size,
          modifiedAt: refreshedEntry.modifiedAt,
        },
      },
    };
  }, []);

  /**
   * Starts the next queued SFTP operation while keeping the page interactive.
   *
   * @returns void.
   */
  const flushSftpTaskQueue = React.useCallback((): void => {
    if (isTaskQueueRunningRef.current || taskQueueRef.current.length === 0) {
      return;
    }

    isTaskQueueRunningRef.current = true;
    const activeGeneration = taskQueueGenerationRef.current;

    const runQueue = async (): Promise<void> => {
      try {
        while (taskQueueGenerationRef.current === activeGeneration) {
          const nextTask = taskQueueRef.current.shift();
          if (!nextTask) {
            return;
          }

          setSftpTasks((previous) =>
            previous.map((task) =>
              task.id === nextTask.id
                ? {
                    ...task,
                    status: 'running',
                    startedAt: Date.now(),
                  }
                : task,
            ),
          );

          try {
            await nextTask.run();
            if (taskQueueGenerationRef.current !== activeGeneration) {
              continue;
            }

            setSftpTasks((previous) =>
              previous.map((task) =>
                task.id === nextTask.id
                  ? {
                      ...task,
                      status: 'success',
                      finishedAt: Date.now(),
                    }
                  : task,
              ),
            );
          } catch (error: unknown) {
            if (taskQueueGenerationRef.current !== activeGeneration) {
              continue;
            }

            const message = error instanceof Error ? error.message : t('sftp.operationFailed');
            setSftpTasks((previous) =>
              previous.map((task) =>
                task.id === nextTask.id
                  ? {
                      ...task,
                      status: 'failed',
                      detail: message,
                      finishedAt: Date.now(),
                    }
                  : task,
              ),
            );
            notifyError(message);
          } finally {
            if (taskQueueGenerationRef.current === activeGeneration) {
              scheduleTaskRetentionCleanup(nextTask.id);
            }
          }
        }
      } finally {
        if (taskQueueGenerationRef.current === activeGeneration) {
          isTaskQueueRunningRef.current = false;
        }
      }
    };

    void runQueue();
  }, [notifyError, scheduleTaskRetentionCleanup]);

  /**
   * Adds one renderer-managed SFTP operation to the tab-local task list.
   *
   * @param options User-visible task metadata.
   * @param operation Operation implementation to run when the queue reaches this task.
   * @returns Created task id.
   */
  const enqueueSftpTask = React.useCallback(
    (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>): string => {
      const taskId = createSftpTaskId();
      const task: SftpTaskState = {
        id: taskId,
        label: options.label,
        detail: options.detail ?? t('sftp.tasks.pending'),
        status: 'queued',
        createdAt: Date.now(),
        progress: options.progress,
      };

      clearTaskRetentionTimer(taskId);
      const taskGeneration = taskQueueGenerationRef.current;
      setSftpTasks((previous) => [...previous, task]);
      taskQueueRef.current.push({
        id: taskId,
        run: async () => {
          const isCurrent = (): boolean => taskQueueGenerationRef.current === taskGeneration;
          const update = (patch: Partial<Pick<SftpTaskState, 'detail' | 'progress'>>): void => {
            if (!isCurrent()) {
              return;
            }

            setSftpTasks((previous) =>
              previous.map((currentTask) => (currentTask.id === taskId ? { ...currentTask, ...patch } : currentTask)),
            );
          };

          await operation({ taskId, isCurrent, update });
        },
      });
      flushSftpTaskQueue();
      return taskId;
    },
    [clearTaskRetentionTimer, flushSftpTaskQueue],
  );

  /**
   * Queues a file operation only when the active SFTP session is ready for actions.
   *
   * @param options User-visible task metadata.
   * @param operation Operation implementation to run when scheduled.
   * @returns void.
   */
  const runSftpOperation = React.useCallback(
    (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>): void => {
      if (!canUseFileActions) {
        return;
      }

      enqueueSftpTask(options, operation);
    },
    [canUseFileActions, enqueueSftpTask],
  );

  const beginRenameEntry = React.useCallback(
    (entry: ApiSftpEntry): void => {
      setPendingCreate(null);
      selectSingleEntry(entry);
      setRenamingEntryPath(entry.path);
      setRenameInput(entry.name);
    },
    [selectSingleEntry],
  );

  const cancelInlineEdit = React.useCallback((): void => {
    setRenamingEntryPath('');
    setRenameInput('');
    setPendingCreate(null);
  }, []);

  const commitRenameEntry = React.useCallback(
    async (entry: ApiSftpEntry): Promise<void> => {
      const nextName = renameInput.trim();
      cancelInlineEdit();
      if (!nextName || nextName === entry.name || !hasSftpSession) {
        return;
      }

      const targetPath = resolveRenameTargetPath(entry, nextName);
      runSftpOperation(
        {
          label: t('sftp.tasks.rename'),
          detail: entry.name,
          progress: { completed: 0, total: 1 },
        },
        async ({ isCurrent, update }) => {
          update({ detail: `${entry.name} -> ${nextName}`, progress: { completed: 0, total: 1 } });
          await runWithSftpReconnect((activeSessionId) =>
            renameSftpEntry(activeSessionId, {
              sourcePath: entry.path,
              targetPath,
            }),
          );
          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            return;
          }

          notifySuccess(t('sftp.feedback.renamed'));
          await refreshCurrentDirectoryAfterOperation([
            resolveEntryParentPath(entry.path),
            resolveEntryParentPath(targetPath),
          ]);
          if (currentPathRef.current === resolveEntryParentPath(targetPath)) {
            setSelectedPaths([targetPath]);
            setSelectionAnchorPath(targetPath);
          }
        },
      );
    },
    [
      cancelInlineEdit,
      notifySuccess,
      hasSftpSession,
      refreshCurrentDirectoryAfterOperation,
      renameInput,
      runSftpOperation,
      runWithSftpReconnect,
    ],
  );

  const commitPendingCreate = React.useCallback(async (): Promise<void> => {
    const draft = pendingCreate;
    const nextName = renameInput.trim();
    cancelInlineEdit();
    if (!draft || !nextName || !hasSftpSession) {
      return;
    }

    const targetPath = joinRemotePath(currentPath, nextName);
    runSftpOperation(
      {
        label: draft.type === 'directory' ? t('sftp.tasks.createFolder') : t('sftp.tasks.createFile'),
        detail: nextName,
        progress: { completed: 0, total: 1 },
      },
      async ({ isCurrent, update }) => {
        await runWithSftpReconnect((activeSessionId) =>
          draft.type === 'directory'
            ? createSftpDirectory(activeSessionId, { path: targetPath })
            : createSftpFile(activeSessionId, { path: targetPath }),
        );

        update({ progress: { completed: 1, total: 1 } });
        if (!isCurrent()) {
          return;
        }

        notifySuccess(
          draft.type === 'directory' ? t('sftp.feedback.directoryCreated') : t('sftp.feedback.fileCreated'),
        );
        await refreshCurrentDirectoryAfterOperation([resolveEntryParentPath(targetPath)]);
        if (currentPathRef.current === resolveEntryParentPath(targetPath)) {
          setSelectedPaths([targetPath]);
          setSelectionAnchorPath(targetPath);
        }
      },
    );
  }, [
    cancelInlineEdit,
    currentPath,
    hasSftpSession,
    notifySuccess,
    pendingCreate,
    refreshCurrentDirectoryAfterOperation,
    renameInput,
    runSftpOperation,
    runWithSftpReconnect,
  ]);

  const beginCreateEntry = React.useCallback(
    (type: PendingCreateState['type']): void => {
      if (!canUseFileActions) {
        return;
      }

      setRenamingEntryPath('');
      resetSelection();
      setPendingCreate({
        type,
        name: type === 'directory' ? NEW_DIRECTORY_NAME : NEW_FILE_NAME,
      });
      setRenameInput(type === 'directory' ? NEW_DIRECTORY_NAME : NEW_FILE_NAME);
    },
    [canUseFileActions, resetSelection],
  );

  const beginCreateEntryInDirectory = React.useCallback(
    async (type: PendingCreateState['type'], directoryPath = currentPath): Promise<void> => {
      if (!canUseFileActions) {
        return;
      }

      if (directoryPath !== currentPath) {
        const didNavigate = await navigateToPath(directoryPath);
        if (!didNavigate) {
          return;
        }
      }

      beginCreateEntry(type);
    },
    [beginCreateEntry, canUseFileActions, currentPath, navigateToPath],
  );

  const handleOpenDirectoryInNewTab = React.useCallback(
    (entry: ApiSftpEntry): void => {
      if (entry.type !== 'directory') {
        return;
      }

      onOpenDirectoryInNewTab(entry.path);
    },
    [onOpenDirectoryInNewTab],
  );

  const handleOpenSshAtEntryLocation = React.useCallback(
    (entry: ApiSftpEntry | null, targetDirectoryPath = currentPath): void => {
      const sshPath = entry
        ? entry.type === 'directory'
          ? entry.path
          : resolveRemoteParentPath(entry.path)
        : targetDirectoryPath;
      onOpenSshAtPath(sshPath);
    },
    [currentPath, onOpenSshAtPath],
  );

  const copyTextToClipboard = React.useCallback(
    async (value: string, successMessage: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(value);
        notifySuccess(successMessage);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('sftp.feedback.copyPathFailed'));
      }
    },
    [notifyError, notifySuccess],
  );

  const handleCopyRemotePath = React.useCallback(
    async (entry: ApiSftpEntry): Promise<void> => {
      await copyTextToClipboard(entry.path, t('sftp.feedback.pathCopied'));
    },
    [copyTextToClipboard],
  );

  const handleCopyCurrentPath = React.useCallback(async (): Promise<void> => {
    await copyTextToClipboard(currentPath, t('sftp.feedback.pathCopied'));
  }, [copyTextToClipboard, currentPath]);

  const handleCopyRelativeRemotePath = React.useCallback(
    async (relativePath: string): Promise<void> => {
      await copyTextToClipboard(relativePath, t('sftp.feedback.relativePathCopied'));
    },
    [copyTextToClipboard],
  );

  const canUseSftpOpenWith = React.useMemo(() => {
    return window.electron?.platform === 'win32' || window.electron?.platform === 'darwin';
  }, []);

  const resolveDefaultLocalDownloadPath = React.useCallback(async (entry: ApiSftpEntry): Promise<string | null> => {
    return (await window.electron?.createSftpDownloadsFile(sanitizeLocalFileName(entry.name))) ?? null;
  }, []);

  const downloadEntryToLocalPath = React.useCallback(
    async (entry: ApiSftpEntry, localPath: string): Promise<void> => {
      if (!hasSftpSession || entry.type !== 'file') {
        throw new Error(t('sftp.downloadUnsupported'));
      }

      await runWithSftpReconnect((activeSessionId) =>
        downloadSftpFile(activeSessionId, {
          path: entry.path,
          localPath,
        }),
      );
    },
    [hasSftpSession, runWithSftpReconnect],
  );

  const downloadEntryToTemporaryPath = React.useCallback(
    async (
      entry: ApiSftpEntry,
      options: { reuseCached?: boolean; shouldCache?: () => boolean } = {},
    ): Promise<string> => {
      const cachedLocalPath = temporaryOpenFilePathsRef.current[entry.path];
      if (cachedLocalPath && options.reuseCached) {
        return cachedLocalPath;
      }

      const localPath =
        cachedLocalPath ?? (await window.electron?.createSftpTemporaryFile(sanitizeLocalFileName(entry.name)));
      if (!localPath) {
        throw new Error(t('sftp.temporaryPathUnavailable'));
      }

      await downloadEntryToLocalPath(entry, localPath);
      if (options.shouldCache?.() ?? true) {
        temporaryOpenFilePathsRef.current[entry.path] = localPath;
      }
      return localPath;
    },
    [downloadEntryToLocalPath],
  );

  /**
   * Downloads one image preview into a renderer-owned temp cache.
   *
   * @param entry Remote image entry to preview.
   * @param options Cache write options.
   * @returns Validated local temp path for main-process data URL loading.
   */
  const downloadEntryToImagePreviewPath = React.useCallback(
    async (entry: ApiSftpEntry, options: { shouldCache?: () => boolean } = {}): Promise<string> => {
      const cachedPreview = imagePreviewTempFilesRef.current[entry.path];
      if (cachedPreview && doesSftpEntryMatchRemoteSnapshot(entry, cachedPreview.remoteSnapshot)) {
        return cachedPreview.localPath;
      }

      const localPath =
        cachedPreview?.localPath ?? (await window.electron?.createSftpTemporaryFile(sanitizeLocalFileName(entry.name)));
      if (!localPath) {
        throw new Error(t('sftp.temporaryPathUnavailable'));
      }

      await downloadEntryToLocalPath(entry, localPath);
      if (options.shouldCache?.() ?? true) {
        imagePreviewTempFilesRef.current[entry.path] = {
          localPath,
          remoteSnapshot: createSftpEntryRemoteSnapshot(entry),
        };
      }

      return localPath;
    },
    [downloadEntryToLocalPath],
  );

  /**
   * Loads the preview payload for one selected SFTP entry.
   *
   * @param entry Selected remote entry to preview.
   * @param options Preview loading options.
   * @returns Promise resolved when the preview state settles.
   */
  const loadPreviewForEntry = React.useCallback(
    async (entry: ApiSftpEntry, options: { force?: boolean } = {}): Promise<void> => {
      const generation = previewLoadGenerationRef.current + 1;
      previewLoadGenerationRef.current = generation;
      previewEditorRef.current = null;

      if (!hasSftpSession || entry.type !== 'file') {
        setPreviewState({ status: 'unsupported', entry });
        return;
      }

      if (isSftpTextPreviewEntry(entry)) {
        const thresholdBytes = Math.min(
          sftpTextPreviewWarningThresholdBytes,
          MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES,
        );
        if (entry.size > MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES && options.force) {
          setPreviewState({ status: 'error', entry, message: t('sftp.previewTooLargeToOpen') });
          return;
        }

        if (!options.force && entry.size > thresholdBytes) {
          setPreviewState({
            status: 'large-file',
            prompt: { entry, previewType: 'text', thresholdBytes },
          });
          return;
        }

        setPreviewState({ status: 'loading', entry, previewType: 'text' });
        try {
          const maxBytes = Math.max(1024, Math.min(MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES, entry.size || 1024));
          const response = await runWithSftpReconnect((activeSessionId) =>
            readSftpFile(activeSessionId, {
              path: entry.path,
              maxBytes,
            }),
          );
          if (previewLoadGenerationRef.current !== generation) {
            return;
          }

          if (response.data.truncated) {
            setPreviewState({ status: 'error', entry, message: t('sftp.previewTooLargeToOpen') });
            return;
          }

          const nextEntry = { ...entry, size: response.data.size };
          setPreviewState({
            status: 'text',
            entry: nextEntry,
            content: response.data.content,
            savedContent: response.data.content,
            language: resolveSftpPreviewLanguage(entry),
            remoteSnapshot: {
              size: response.data.size,
              modifiedAt: entry.modifiedAt,
            },
            isSaving: false,
          });
        } catch (error: unknown) {
          if (previewLoadGenerationRef.current === generation) {
            setPreviewState({
              status: 'error',
              entry,
              message: error instanceof Error ? error.message : t('sftp.previewFailed'),
            });
          }
        }
        return;
      }

      if (isSftpImagePreviewEntry(entry)) {
        if (entry.size > MAX_SFTP_IMAGE_PREVIEW_WARNING_THRESHOLD_BYTES) {
          setPreviewState({
            status: 'error',
            entry,
            message: t('sftp.previewImageTooLargeToOpen', {
              limit: formatFileSize(MAX_SFTP_IMAGE_PREVIEW_WARNING_THRESHOLD_BYTES),
            }),
          });
          return;
        }

        if (!options.force && entry.size > sftpImagePreviewWarningThresholdBytes) {
          setPreviewState({
            status: 'large-file',
            prompt: { entry, previewType: 'image', thresholdBytes: sftpImagePreviewWarningThresholdBytes },
          });
          return;
        }

        setPreviewState({ status: 'loading', entry, previewType: 'image' });
        try {
          const localPath = await downloadEntryToImagePreviewPath(entry, {
            shouldCache: () => previewLoadGenerationRef.current === generation,
          });
          if (previewLoadGenerationRef.current !== generation) {
            return;
          }

          const sourceDataUrl = await window.electron?.readSftpTemporaryImagePreview(localPath);
          if (!sourceDataUrl) {
            throw new Error(t('sftp.previewFailed'));
          }
          if (previewLoadGenerationRef.current !== generation) {
            return;
          }

          setPreviewState({
            status: 'image',
            entry,
            localPath,
            sourceDataUrl,
          });
        } catch (error: unknown) {
          if (previewLoadGenerationRef.current === generation) {
            setPreviewState({
              status: 'error',
              entry,
              message: error instanceof Error ? error.message : t('sftp.previewFailed'),
            });
          }
        }
        return;
      }

      setPreviewState({ status: 'unsupported', entry });
    },
    [
      downloadEntryToImagePreviewPath,
      hasSftpSession,
      runWithSftpReconnect,
      sftpImagePreviewWarningThresholdBytes,
      sftpTextPreviewWarningThresholdBytes,
    ],
  );

  /**
   * Continues a large preview after the user explicitly accepts the download/read cost.
   *
   * @param prompt Large preview prompt selected by the user.
   * @returns void.
   */
  const handleConfirmLargePreview = React.useCallback(
    (prompt: SftpLargePreviewPrompt): void => {
      void loadPreviewForEntry(prompt.entry, { force: true });
    },
    [loadPreviewForEntry],
  );

  const handlePreviewContentChange = React.useCallback((content: string): void => {
    setPreviewState((previous) => (previous?.status === 'text' ? { ...previous, content } : previous));
  }, []);

  const handlePreviewEditorMount = React.useCallback((editorInstance: MonacoEditor.IStandaloneCodeEditor): void => {
    previewEditorRef.current = editorInstance;
  }, []);

  const handlePreviewUndo = React.useCallback((): void => {
    previewEditorRef.current?.trigger('sftp-preview', 'undo', null);
  }, []);

  const handlePreviewRedo = React.useCallback((): void => {
    previewEditorRef.current?.trigger('sftp-preview', 'redo', null);
  }, []);

  /**
   * Saves Monaco text preview changes through the shared SFTP operation queue.
   *
   * @returns Promise resolved after the save is queued.
   */
  const handlePreviewSave = React.useCallback(async (): Promise<void> => {
    const preview = activeTextPreview;
    if (!preview || preview.content === preview.savedContent) {
      return;
    }

    if (!canUseFileActions) {
      notifyError(t('sftp.operationFailed'));
      return;
    }

    const content = preview.content;
    const contentSize = measureUtf8ByteLength(content);
    const setPreviewSaving = (isSaving: boolean): void => {
      setPreviewState((previous) =>
        previous?.status === 'text' && previous.entry.path === preview.entry.path
          ? { ...previous, isSaving }
          : previous,
      );
    };

    setPreviewSaving(true);
    runSftpOperation(
      {
        label: t('sftp.tasks.save'),
        detail: preview.entry.name,
        progress: { completed: 0, total: 1 },
      },
      async ({ isCurrent, update }) => {
        try {
          const payload: ApiSftpWriteFileRequest = {
            path: preview.entry.path,
            content,
            expectedSize: preview.remoteSnapshot.size,
            expectedModifiedAt: preview.remoteSnapshot.modifiedAt,
          };
          let response: ApiSftpWriteFileResponse;
          try {
            response = await runWithSftpReconnect((activeSessionId) => writeSftpFile(activeSessionId, payload));
          } catch (error: unknown) {
            if (!isSftpUploadConflictError(error) || !isCurrent()) {
              throw error;
            }

            const shouldOverwrite = await requestUploadConflictConfirmation({
              remotePath: preview.entry.path,
              name: preview.entry.name,
              localPath: preview.entry.path,
              size: contentSize,
              modifiedAt: new Date().toISOString(),
            });
            if (!shouldOverwrite || !isCurrent()) {
              update({ detail: t('sftp.tasks.saveSkipped') });
              setPreviewSaving(false);
              return;
            }

            response = await runWithSftpReconnect((activeSessionId) =>
              writeSftpFile(activeSessionId, {
                ...payload,
                overwrite: true,
              }),
            );
          }

          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            setPreviewSaving(false);
            return;
          }

          const nextSize = response.data.size ?? contentSize;
          const nextModifiedAt = response.data.modifiedAt ?? new Date().toISOString();
          const nextEntry = {
            ...preview.entry,
            size: nextSize,
            modifiedAt: nextModifiedAt,
          };
          setPreviewState((previous) =>
            previous?.status === 'text' && previous.entry.path === preview.entry.path
              ? {
                  ...previous,
                  entry: nextEntry,
                  content,
                  savedContent: content,
                  remoteSnapshot: {
                    size: nextSize,
                    modifiedAt: nextModifiedAt,
                  },
                  isSaving: false,
                }
              : previous,
          );
          notifySuccess(t('sftp.feedback.saved'));
          await refreshCurrentDirectoryAfterOperation([resolveEntryParentPath(preview.entry.path)]);
        } catch (error: unknown) {
          setPreviewSaving(false);
          throw error;
        }
      },
    );
  }, [
    activeTextPreview,
    canUseFileActions,
    isSftpUploadConflictError,
    notifyError,
    notifySuccess,
    refreshCurrentDirectoryAfterOperation,
    requestUploadConflictConfirmation,
    runSftpOperation,
    runWithSftpReconnect,
  ]);

  React.useEffect(() => {
    if (sftpAuxiliarySidebarMode !== 'preview') {
      if (!isDirtySftpTextPreviewState(previewStateRef.current)) {
        forceClearPreviewState();
      }
      return;
    }

    if (!hasSftpSession || selectedCount !== 1 || !selectedEntry) {
      if (!isDirtySftpTextPreviewState(previewStateRef.current)) {
        forceClearPreviewState();
      }
      return;
    }

    if (
      resolvePreviewStatePath(previewStateRef.current) === selectedEntry.path &&
      isDirtySftpTextPreviewState(previewStateRef.current)
    ) {
      return;
    }

    void loadPreviewForEntry(selectedEntry);
  }, [
    forceClearPreviewState,
    hasSftpSession,
    loadPreviewForEntry,
    selectedCount,
    selectedEntry,
    sftpAuxiliarySidebarMode,
  ]);

  /**
   * Starts watching a temp file opened through SFTP so later local saves can be uploaded.
   *
   * @param entry Remote file entry that produced the temp file.
   * @param localPath Local temp file path controlled by Cosmosh.
   * @returns Promise resolved when the watcher is registered or skipped.
   */
  const registerWatchedOpenFile = React.useCallback(async (entry: ApiSftpEntry, localPath: string): Promise<void> => {
    const electronBridge = window.electron;
    if (!electronBridge?.startSftpTemporaryFileWatch || entry.type !== 'file') {
      return;
    }

    const existing = watchedOpenFilesRef.current[entry.path];
    if (existing) {
      void electronBridge.stopSftpTemporaryFileWatch(existing.watchId);
    }

    const watchId = await electronBridge.startSftpTemporaryFileWatch(localPath);
    watchedOpenFilesRef.current = {
      ...watchedOpenFilesRef.current,
      [entry.path]: {
        remotePath: entry.path,
        name: entry.name,
        localPath,
        watchId,
        openedSessionId: sessionIdRef.current,
        remoteSnapshot: {
          size: entry.size,
          modifiedAt: entry.modifiedAt,
        },
        isPromptOpen: false,
      },
    };
  }, []);

  const handleOpenEntryWithDefaultApplication = React.useCallback(
    async (entry: ApiSftpEntry): Promise<void> => {
      if (entry.type !== 'file') {
        notifyError(t('sftp.openUnsupported'));
        return;
      }

      runSftpOperation(
        {
          label: t('sftp.tasks.open'),
          detail: entry.name,
          progress: { completed: 0, total: 1 },
        },
        async ({ isCurrent, update }) => {
          const localPath = await downloadEntryToTemporaryPath(entry, { shouldCache: isCurrent });
          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            return;
          }

          const didOpen = await window.electron?.openSftpTemporaryFile(localPath);
          if (!didOpen) {
            throw new Error(t('sftp.openLocalFileFailed'));
          }

          await registerWatchedOpenFile(entry, localPath);
        },
      );
    },
    [downloadEntryToTemporaryPath, notifyError, registerWatchedOpenFile, runSftpOperation],
  );

  const handleOpenEntryWithPicker = React.useCallback(
    async (entry: ApiSftpEntry): Promise<void> => {
      if (!canUseSftpOpenWith || entry.type !== 'file') {
        notifyError(t('sftp.openWithUnsupported'));
        return;
      }

      runSftpOperation(
        {
          label: t('sftp.tasks.openWith'),
          detail: entry.name,
          progress: { completed: 0, total: 1 },
        },
        async ({ isCurrent, update }) => {
          const localPath = await downloadEntryToTemporaryPath(entry, { shouldCache: isCurrent });
          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            return;
          }

          const didOpen = await window.electron?.showSftpOpenWithDialog(localPath);
          if (!didOpen) {
            throw new Error(t('sftp.openWithFailed'));
          }

          await registerWatchedOpenFile(entry, localPath);
        },
      );
    },
    [canUseSftpOpenWith, downloadEntryToTemporaryPath, notifyError, registerWatchedOpenFile, runSftpOperation],
  );

  const handleOpenEntryWithApplication = React.useCallback(
    async (entry: ApiSftpEntry, application: SftpOpenWithApplication): Promise<void> => {
      if (entry.type !== 'file') {
        notifyError(t('sftp.openWithUnsupported'));
        return;
      }

      runSftpOperation(
        {
          label: t('sftp.tasks.openWith'),
          detail: `${entry.name} - ${application.name}`,
          progress: { completed: 0, total: 1 },
        },
        async ({ isCurrent, update }) => {
          const localPath = await downloadEntryToTemporaryPath(entry, { shouldCache: isCurrent });
          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            return;
          }

          const didOpen = await window.electron?.openSftpFileWithApplication(localPath, application.path);
          if (!didOpen) {
            throw new Error(t('sftp.openWithFailed'));
          }

          await registerWatchedOpenFile(entry, localPath);
        },
      );
    },
    [downloadEntryToTemporaryPath, notifyError, registerWatchedOpenFile, runSftpOperation],
  );

  const loadOpenWithApplications = React.useCallback(
    async (entry: ApiSftpEntry): Promise<void> => {
      if (window.electron?.platform !== 'darwin' || entry.type !== 'file') {
        return;
      }

      setLoadingOpenWithPath(entry.path);
      try {
        const localPath = await downloadEntryToTemporaryPath(entry, { reuseCached: true });
        const applications = (await window.electron?.listSftpOpenWithApplications(localPath)) ?? [];
        setOpenWithApplicationsByPath((previous) => ({
          ...previous,
          [entry.path]: applications,
        }));
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('sftp.openWithApplicationsUnavailable'));
      } finally {
        setLoadingOpenWithPath((previous) => (previous === entry.path ? '' : previous));
      }
    },
    [downloadEntryToTemporaryPath, notifyError],
  );

  const handleOpenEntry = React.useCallback(
    async (entry: ApiSftpEntry): Promise<void> => {
      selectSingleEntry(entry);
      if (entry.type === 'directory') {
        await navigateToPath(entry.path);
        return;
      }

      if (entry.type !== 'file' || !hasSftpSession) {
        notifyError(t('sftp.openUnsupported'));
        return;
      }

      handleOpenEntryWithDefaultApplication(entry);
    },
    [handleOpenEntryWithDefaultApplication, hasSftpSession, navigateToPath, notifyError, selectSingleEntry],
  );

  const handleDownloadEntry = React.useCallback(
    async (entry: ApiSftpEntry, mode: 'downloads' | 'choose'): Promise<void> => {
      if (!hasSftpSession || entry.type !== 'file') {
        notifyError(t('sftp.downloadUnsupported'));
        return;
      }

      const defaultLocalPath = await resolveDefaultLocalDownloadPath(entry);
      if (!defaultLocalPath) {
        notifyError(t('sftp.downloadPathUnavailable'));
        return;
      }

      const localPath =
        mode === 'downloads'
          ? defaultLocalPath
          : (await window.electron?.showSaveFileDialog(defaultLocalPath))?.filePath;

      if (!localPath) {
        return;
      }

      runSftpOperation(
        {
          label: t('sftp.tasks.download'),
          detail: entry.name,
          progress: { completed: 0, total: 1 },
        },
        async ({ isCurrent, update }) => {
          await downloadEntryToLocalPath(entry, localPath);
          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            return;
          }

          notifySuccess(t('sftp.feedback.downloaded', { path: localPath }));
        },
      );
    },
    [
      downloadEntryToLocalPath,
      notifyError,
      notifySuccess,
      resolveDefaultLocalDownloadPath,
      runSftpOperation,
      hasSftpSession,
    ],
  );

  /**
   * Resolves the upload prompt raised by an edited temp file.
   *
   * @param accepted Whether the user wants to upload the changed temp file.
   * @returns void.
   */
  const resolveUploadConfirmationPrompt = React.useCallback(
    (accepted: boolean): void => {
      const prompt = uploadConfirmationPrompt;
      if (!prompt) {
        return;
      }

      const watchedFile = watchedOpenFilesRef.current[prompt.remotePath];
      if (!watchedFile) {
        setUploadConfirmationPrompt(null);
        return;
      }

      watchedOpenFilesRef.current = {
        ...watchedOpenFilesRef.current,
        [prompt.remotePath]: {
          ...watchedFile,
          isPromptOpen: false,
          pendingChange: undefined,
        },
      };
      setUploadConfirmationPrompt(null);

      if (!accepted) {
        return;
      }

      runSftpOperation(
        {
          label: t('sftp.tasks.upload'),
          detail: watchedFile.name,
          progress: { completed: 0, total: 1 },
        },
        async ({ isCurrent, update }) => {
          const uploadPayload: ApiSftpUploadFileRequest = {
            path: watchedFile.remotePath,
            localPath: watchedFile.localPath,
            expectedSize: watchedFile.remoteSnapshot.size,
            expectedModifiedAt: watchedFile.remoteSnapshot.modifiedAt,
          };
          let response: ApiSftpUploadFileResponse;
          try {
            response = await runWithSftpReconnect((activeSessionId) => uploadSftpFile(activeSessionId, uploadPayload));
          } catch (error: unknown) {
            if (!isSftpUploadConflictError(error) || !isCurrent()) {
              throw error;
            }

            const shouldOverwrite = await requestUploadConflictConfirmation({
              remotePath: watchedFile.remotePath,
              name: watchedFile.name,
              localPath: watchedFile.localPath,
              size: prompt.size,
              modifiedAt: prompt.modifiedAt,
            });
            if (!shouldOverwrite || !isCurrent()) {
              update({ detail: t('sftp.tasks.uploadSkipped') });
              return;
            }

            response = await runWithSftpReconnect((activeSessionId) =>
              uploadSftpFile(activeSessionId, {
                ...uploadPayload,
                overwrite: true,
              }),
            );
          }

          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            return;
          }

          watchedOpenFilesRef.current = {
            ...watchedOpenFilesRef.current,
            [watchedFile.remotePath]: {
              ...watchedFile,
              remoteSnapshot: {
                size: response.data.size ?? prompt.size,
                modifiedAt: response.data.modifiedAt ?? prompt.modifiedAt,
              },
              pendingChange: undefined,
              isPromptOpen: false,
            },
          };

          notifySuccess(t('sftp.feedback.uploaded'));
          await refreshCurrentDirectoryAfterOperation([resolveEntryParentPath(watchedFile.remotePath)]);
          syncWatchedOpenFileSnapshotFromCache(watchedFile.remotePath);
        },
      );
    },
    [
      isSftpUploadConflictError,
      notifySuccess,
      refreshCurrentDirectoryAfterOperation,
      requestUploadConflictConfirmation,
      runSftpOperation,
      runWithSftpReconnect,
      syncWatchedOpenFileSnapshotFromCache,
      uploadConfirmationPrompt,
    ],
  );

  const handleCopyEntries = React.useCallback((targetEntries: ApiSftpEntry[]): void => {
    const entriesToCopy = dedupeSftpEntries(targetEntries);
    if (entriesToCopy.length === 0) {
      return;
    }

    setClipboardState({ mode: 'copy', entries: entriesToCopy });
    setSelectedPaths(entriesToCopy.map((entry) => entry.path));
    setSelectionAnchorPath(entriesToCopy[entriesToCopy.length - 1]?.path ?? '');
  }, []);

  const handleCutEntries = React.useCallback((targetEntries: ApiSftpEntry[]): void => {
    const entriesToCut = dedupeSftpEntries(targetEntries);
    if (entriesToCut.length === 0) {
      return;
    }

    setClipboardState({ mode: 'cut', entries: entriesToCut });
    setSelectedPaths(entriesToCut.map((entry) => entry.path));
    setSelectionAnchorPath(entriesToCut[entriesToCut.length - 1]?.path ?? '');
  }, []);

  const handlePasteEntry = React.useCallback(
    async (targetDirectoryPath = currentPath): Promise<void> => {
      if (!clipboardState || !hasSftpSession || clipboardState.entries.length === 0) {
        return;
      }

      const entriesToPaste = clipboardState.entries;
      const operationLabel = clipboardState.mode === 'copy' ? t('sftp.tasks.copy') : t('sftp.tasks.move');
      const operationMode = clipboardState.mode;
      runSftpOperation(
        {
          label: operationLabel,
          detail: targetDirectoryPath,
          progress: { completed: 0, total: entriesToPaste.length },
        },
        async ({ isCurrent, update }) => {
          const response = await runWithSftpReconnect((activeSessionId) =>
            runSftpBatchOperation(activeSessionId, {
              operation: operationMode === 'copy' ? 'copy' : 'move',
              targetDirectoryPath,
              entries: entriesToPaste.map((entry) => ({
                path: entry.path,
                type: entry.type,
              })),
            }),
          );
          update({ progress: { completed: response.data.completedCount, total: response.data.totalCount } });
          if (!isCurrent()) {
            return;
          }

          if (operationMode === 'copy') {
            if (response.data.failedCount > 0) {
              notifyError(formatBatchPartialFailureFeedback(response.data));
            } else {
              notifySuccess(
                formatBatchFeedback(response.data.completedCount, 'sftp.feedback.copied', 'sftp.feedback.copiedMany'),
              );
            }
          } else {
            setClipboardState((previous) =>
              isSameClipboardSnapshot(previous, operationMode, entriesToPaste) ? null : previous,
            );
            if (response.data.failedCount > 0) {
              notifyError(formatBatchPartialFailureFeedback(response.data));
            } else {
              notifySuccess(
                formatBatchFeedback(response.data.completedCount, 'sftp.feedback.moved', 'sftp.feedback.movedMany'),
              );
            }
          }

          await refreshCurrentDirectoryAfterOperation([
            ...entriesToPaste.map((entry) => resolveEntryParentPath(entry.path)),
            targetDirectoryPath,
          ]);
        },
      );
    },
    [
      clipboardState,
      currentPath,
      hasSftpSession,
      notifyError,
      notifySuccess,
      refreshCurrentDirectoryAfterOperation,
      runSftpOperation,
      runWithSftpReconnect,
    ],
  );

  const handleDeleteEntries = React.useCallback(
    async (targetEntries: ApiSftpEntry[], source: SftpDeleteInvocationSource = 'action'): Promise<void> => {
      const entriesToDelete = dedupeSftpEntries(targetEntries);
      if (!hasSftpSession || entriesToDelete.length === 0) {
        return;
      }

      if (shouldConfirmSftpDelete(sftpDeleteConfirmationMode, entriesToDelete.length, source)) {
        const accepted = await requestDeleteConfirmation(entriesToDelete, source);
        if (!accepted) {
          return;
        }
      }

      runSftpOperation(
        {
          label: t('sftp.tasks.delete'),
          detail: formatBatchFeedback(entriesToDelete.length, 'sftp.tasks.entryCountOne', 'sftp.tasks.entryCountMany'),
          progress: { completed: 0, total: entriesToDelete.length },
        },
        async ({ isCurrent, update }) => {
          const response = await runWithSftpReconnect((activeSessionId) =>
            runSftpBatchOperation(activeSessionId, {
              operation: 'delete',
              entries: entriesToDelete.map((entry) => ({
                path: entry.path,
                type: entry.type,
              })),
            }),
          );
          update({ progress: { completed: response.data.completedCount, total: response.data.totalCount } });
          if (!isCurrent()) {
            return;
          }

          const deletedPaths = new Set(
            response.data.results.filter((result) => result.status === 'success').map((result) => result.path),
          );

          if (response.data.failedCount > 0) {
            notifyError(formatBatchPartialFailureFeedback(response.data));
          } else {
            notifySuccess(
              formatBatchFeedback(response.data.completedCount, 'sftp.feedback.deleted', 'sftp.feedback.deletedMany'),
            );
          }

          setSelectedPaths((previous) => previous.filter((path) => !deletedPaths.has(path)));
          setSelectionAnchorPath((previous) => (deletedPaths.has(previous) ? '' : previous));
          setPreviewState((previous) => (deletedPaths.has(resolvePreviewStatePath(previous)) ? null : previous));
          deletedPaths.forEach((path) => {
            delete temporaryOpenFilePathsRef.current[path];
            delete imagePreviewTempFilesRef.current[path];
          });
          setOpenWithApplicationsByPath((previous) => {
            const next = { ...previous };
            deletedPaths.forEach((path) => {
              delete next[path];
            });
            return next;
          });
          await refreshCurrentDirectoryAfterOperation(
            entriesToDelete.map((entry) => resolveEntryParentPath(entry.path)),
          );
        },
      );
    },
    [
      hasSftpSession,
      notifyError,
      notifySuccess,
      refreshCurrentDirectoryAfterOperation,
      requestDeleteConfirmation,
      runSftpOperation,
      runWithSftpReconnect,
      sftpDeleteConfirmationMode,
    ],
  );

  /**
   * Opens a standalone metadata window for one or more remote SFTP entries.
   *
   * @param entries Entries whose properties should be shown.
   * @returns void.
   */
  const handleOpenProperties = React.useCallback(
    (entries: ApiSftpEntry[]): void => {
      if (!hasSftpSession) {
        notifyError(t('sftp.noSession'));
        return;
      }

      if (entries.length === 0) {
        return;
      }

      try {
        const windowName =
          entries.length === 1
            ? `cosmosh-sftp-properties:${sessionId}:${entries[0]?.path ?? ''}`
            : `cosmosh-sftp-properties:${sessionId}:selection:${entries.map((entry) => entry.path).join('|')}`;
        const propertiesWindow = window.open(
          buildSftpEntryPropertiesWindowUrl(sessionId, entries),
          windowName,
          'popup,width=520,height=680,resizable=yes,scrollbars=yes',
        );

        if (!propertiesWindow) {
          notifyError(t('sftp.properties.openFailed'));
          return;
        }

        propertiesWindow.opener = null;
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('sftp.properties.openFailed'));
      }
    },
    [hasSftpSession, notifyError, sessionId],
  );

  const renderSftpActionMenuItems = React.useCallback(
    ({
      contextEntry,
      menuSurface,
      scope,
      showShortcuts,
      targetDirectoryPath = currentPath,
    }: SftpActionMenuOptions): React.ReactNode => {
      return (
        <SftpActionMenuItems
          withIconSlot
          beginCreateEntryInDirectory={beginCreateEntryInDirectory}
          beginRenameEntry={beginRenameEntry}
          canUseFileActions={canUseFileActions}
          canUseSftpOpenWith={canUseSftpOpenWith}
          clipboardState={clipboardState}
          contextEntry={contextEntry}
          currentPath={currentPath}
          handleCopyEntries={handleCopyEntries}
          handleCopyRelativeRemotePath={handleCopyRelativeRemotePath}
          handleCopyRemotePath={handleCopyRemotePath}
          handleCutEntries={handleCutEntries}
          handleDeleteEntries={handleDeleteEntries}
          handleDownloadEntry={handleDownloadEntry}
          handleOpenDirectoryInNewTab={handleOpenDirectoryInNewTab}
          handleOpenEntry={handleOpenEntry}
          handleOpenEntryWithApplication={handleOpenEntryWithApplication}
          handleOpenEntryWithPicker={handleOpenEntryWithPicker}
          handleOpenProperties={handleOpenProperties}
          handleOpenSshAtEntryLocation={handleOpenSshAtEntryLocation}
          handlePasteEntry={handlePasteEntry}
          handleTreeDirectoryRefresh={handleTreeDirectoryRefresh}
          loadOpenWithApplications={loadOpenWithApplications}
          loadingOpenWithPath={loadingOpenWithPath}
          menuSurface={menuSurface}
          openWithApplicationsByPath={openWithApplicationsByPath}
          runInlineEditMenuActionAfterClose={runInlineEditMenuActionAfterClose}
          scope={scope}
          selectedEntries={selectedEntries}
          selectedPathSet={selectedPathSet}
          shortcutModifier={shortcutModifier}
          showShortcuts={showShortcuts}
          targetDirectoryPath={targetDirectoryPath}
        />
      );
    },
    [
      beginCreateEntryInDirectory,
      beginRenameEntry,
      canUseFileActions,
      canUseSftpOpenWith,
      clipboardState,
      currentPath,
      handleCopyEntries,
      handleCopyRelativeRemotePath,
      handleCopyRemotePath,
      handleCutEntries,
      handleDeleteEntries,
      handleDownloadEntry,
      handleOpenDirectoryInNewTab,
      handleOpenEntry,
      handleOpenEntryWithApplication,
      handleOpenEntryWithPicker,
      handleOpenProperties,
      handleOpenSshAtEntryLocation,
      handlePasteEntry,
      loadOpenWithApplications,
      loadingOpenWithPath,
      openWithApplicationsByPath,
      handleTreeDirectoryRefresh,
      runInlineEditMenuActionAfterClose,
      selectedEntries,
      selectedPathSet,
      shortcutModifier,
    ],
  );

  const setSftpAddressDisplayMode = React.useCallback(
    async (showAddressAsText: boolean): Promise<void> => {
      if (settingsValues.sftpShowAddressAsText === showAddressAsText) {
        return;
      }

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpShowAddressAsText: showAddressAsText,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [notifyError, settingsValues],
  );

  const keepAddressInputDuringContextMenu = React.useCallback((): void => {
    shouldRetainAddressInputAfterContextMenuRef.current = true;
    if (addressInputContextMenuTimerRef.current !== null) {
      window.clearTimeout(addressInputContextMenuTimerRef.current);
    }

    addressInputContextMenuTimerRef.current = window.setTimeout(() => {
      shouldRetainAddressInputAfterContextMenuRef.current = false;
      addressInputContextMenuTimerRef.current = null;
    }, 240);
  }, []);

  const handleAddressInputPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLInputElement>): void => {
      if (event.button === 2) {
        keepAddressInputDuringContextMenu();
      }
    },
    [keepAddressInputDuringContextMenu],
  );

  const handlePathSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void navigateToPath(pathInput).then((didNavigate) => {
        if (didNavigate) {
          setIsAddressInputEditing(false);
        }
      });
    },
    [navigateToPath, pathInput],
  );

  const handlePathInputBlur = React.useCallback((): void => {
    if (shouldRetainAddressInputAfterContextMenuRef.current) {
      return;
    }

    setIsAddressInputEditing(false);
  }, []);

  const handlePathInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      setPathInput(currentPath);
      setIsAddressInputEditing(false);
    },
    [currentPath],
  );

  const handleEditCurrentPath = React.useCallback((): void => {
    setPathInput(currentPath);
    setIsAddressInputEditing(true);
  }, [currentPath]);

  const addressInputContextMenuItems = React.useMemo<InputContextMenuItem[]>(() => {
    return [
      {
        key: 'toggle-sftp-address-display-mode',
        label: t('sftp.actions.showAddressAsText'),
        checked: sftpShowAddressAsText,
        onSelect: () => {
          const nextShowAddressAsText = !sftpShowAddressAsText;
          if (nextShowAddressAsText) {
            setIsAddressInputEditing(true);
          } else {
            setIsAddressInputEditing(false);
          }

          void setSftpAddressDisplayMode(nextShowAddressAsText);
        },
      },
    ];
  }, [setSftpAddressDisplayMode, sftpShowAddressAsText]);

  const handleParentDirectory = React.useCallback((): void => {
    if (!parentPath) {
      return;
    }

    void navigateToPath(parentPath);
  }, [navigateToPath, parentPath]);

  const resolveBreadcrumbMenuDirectories = React.useCallback(
    (breadcrumbPath: string): TreeDirectoryNode[] => {
      const treeNode = treeNodes[breadcrumbPath];
      const directoryEntries =
        directoryCacheRef.current[breadcrumbPath]?.entries
          .filter((entry) => sftpShowHiddenEntries || !entry.isHidden)
          .filter((entry) => entry.type === 'directory')
          .map((entry) => ({
            path: entry.path,
            name: entry.name,
            parentPath: breadcrumbPath,
            isHidden: entry.isHidden,
            children: treeNodes[entry.path]?.children ?? [],
            isExpanded: treeNodes[entry.path]?.isExpanded ?? false,
            isLoaded: treeNodes[entry.path]?.isLoaded ?? false,
            isLoading: treeNodes[entry.path]?.isLoading ?? false,
          })) ?? [];
      const treeChildren =
        treeNode?.children
          .map((childPath) => treeNodes[childPath])
          .filter((node): node is TreeDirectoryNode => Boolean(node) && (sftpShowHiddenEntries || !node.isHidden)) ??
        [];

      return [...directoryEntries, ...treeChildren]
        .filter((node, index, nodes) => nodes.findIndex((candidate) => candidate.path === node.path) === index)
        .sort(compareSftpEntryNames);
    },
    [sftpShowHiddenEntries, treeNodes],
  );

  const loadBreadcrumbMenuDirectories = React.useCallback(
    (breadcrumbPath: string): void => {
      if (!hasSftpSession || directoryCacheRef.current[breadcrumbPath] || treeNodes[breadcrumbPath]?.isLoading) {
        return;
      }

      void loadTreeDirectoryChildren(breadcrumbPath);
    },
    [hasSftpSession, loadTreeDirectoryChildren, treeNodes],
  );

  const isBreadcrumbLoading = React.useCallback(
    (breadcrumbPath: string): boolean => {
      return Boolean(treeNodes[breadcrumbPath]?.isLoading);
    },
    [treeNodes],
  );

  const handleShowAddressAsText = React.useCallback((): void => {
    setIsAddressInputEditing(true);
    void setSftpAddressDisplayMode(true);
  }, [setSftpAddressDisplayMode]);

  const handleEntrySelect = React.useCallback(
    (entry: ApiSftpEntry, event: SftpSelectionClickEvent): void => {
      selectEntryWithModifiers(entry, event);
    },
    [selectEntryWithModifiers],
  );

  const handleEntryContextMenu = React.useCallback(
    (entry: ApiSftpEntry): void => {
      if (!selectedPathSet.has(entry.path)) {
        selectSingleEntry(entry);
      }
    },
    [selectSingleEntry, selectedPathSet],
  );

  const handleEntryOpen = React.useCallback(
    (entry: ApiSftpEntry): void => {
      void handleOpenEntry(entry);
    },
    [handleOpenEntry],
  );

  const focusFileRow = React.useCallback((rowKey: string): void => {
    setActiveFileRowKey(rowKey);
    fileRowRefs.current[rowKey]?.focus();
  }, []);

  const handleFileNavigationRowKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>, row: SftpFileNavigationRow): void => {
      if (event.currentTarget !== event.target) {
        return;
      }

      const hasSelectionModifier = window.electron?.platform === 'darwin' ? event.metaKey : event.ctrlKey;

      if ((event.key === ' ' || event.key === 'Spacebar') && row.kind === 'entry') {
        event.preventDefault();
        event.stopPropagation();
        selectEntryWithModifiers(row.entry, {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (row.kind === 'parent') {
          handleParentDirectory();
          return;
        }

        handleEntryOpen(row.entry);
        return;
      }

      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentIndex = fileNavigationRows.findIndex((candidate) => candidate.key === row.key);
      if (currentIndex < 0) {
        return;
      }

      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? fileNavigationRows.length - 1
            : event.key === 'ArrowDown'
              ? Math.min(currentIndex + 1, fileNavigationRows.length - 1)
              : Math.max(currentIndex - 1, 0);
      const nextRow = fileNavigationRows[nextIndex];
      if (!nextRow || nextRow.key === row.key) {
        return;
      }

      focusFileRow(nextRow.key);
      if (nextRow.kind === 'entry') {
        const rangeAnchorPath =
          event.shiftKey && row.kind === 'entry' && !selectionAnchorPath ? row.entry.path : undefined;
        if (!hasSelectionModifier || event.shiftKey) {
          selectEntryWithModifiers(
            nextRow.entry,
            {
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
            },
            { rangeAnchorPath },
          );
        }
      }
    },
    [
      fileNavigationRows,
      focusFileRow,
      handleEntryOpen,
      handleParentDirectory,
      selectEntryWithModifiers,
      selectionAnchorPath,
    ],
  );

  React.useEffect(() => {
    setActiveFileRowKey((previous) => {
      if (previous && fileNavigationRows.some((row) => row.key === previous)) {
        return previous;
      }

      const selectedVisibleRow = selectedEntry
        ? fileNavigationRows.find((row) => row.kind === 'entry' && row.key === selectedEntry.path)
        : undefined;

      return selectedVisibleRow?.key ?? fileNavigationRows[0]?.key ?? '';
    });
  }, [fileNavigationRows, selectedEntry]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isEditingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (isEditingText || !canUseFileActions) {
        return;
      }

      const hasShortcutModifier = window.electron?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
      if (hasShortcutModifier && event.key.toLowerCase() === 'a' && visibleEntries.length > 0) {
        event.preventDefault();
        if (!clearPreviewState()) {
          return;
        }

        setSelectedPaths(visibleEntries.map((entry) => entry.path));
        setSelectionAnchorPath(visibleEntries[0]?.path ?? '');
        return;
      }

      if (hasShortcutModifier && event.key.toLowerCase() === 'x' && hasSelection) {
        event.preventDefault();
        handleCutEntries(selectedEntries);
        return;
      }

      if (hasShortcutModifier && event.key.toLowerCase() === 'c' && hasSelection) {
        event.preventDefault();
        handleCopyEntries(selectedEntries);
        return;
      }

      if (hasShortcutModifier && event.key.toLowerCase() === 'v' && clipboardState) {
        event.preventDefault();
        void handlePasteEntry();
        return;
      }

      if (hasShortcutModifier && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        beginCreateEntry('directory');
        return;
      }

      if (hasShortcutModifier && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        beginCreateEntry('file');
        return;
      }

      if (event.key === 'F2' && selectedEntry) {
        event.preventDefault();
        beginRenameEntry(selectedEntry);
        return;
      }

      const isDeleteShortcut =
        (window.electron?.platform === 'darwin' && event.metaKey && event.key === 'Backspace') ||
        (window.electron?.platform !== 'darwin' && event.key === 'Delete');
      if (isDeleteShortcut && hasSelection) {
        event.preventDefault();
        void handleDeleteEntries(selectedEntries, 'shortcut');
        return;
      }

      if (event.key === 'Enter' && selectedEntry) {
        event.preventDefault();
        if (hasShortcutModifier && selectedEntry.type === 'directory') {
          handleOpenDirectoryInNewTab(selectedEntry);
          return;
        }

        void handleOpenEntry(selectedEntry);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    beginCreateEntry,
    beginRenameEntry,
    canUseFileActions,
    clearPreviewState,
    clipboardState,
    handleCopyEntries,
    handleCutEntries,
    handleDeleteEntries,
    handleOpenDirectoryInNewTab,
    handleOpenEntry,
    handlePasteEntry,
    hasSelection,
    selectedEntry,
    selectedEntries,
    visibleEntries,
  ]);

  const handleTreeNodeToggle = React.useCallback(
    (nodePath: string): void => {
      const node = treeNodes[nodePath];
      if (!node || node.isLoading) {
        return;
      }

      const shouldExpand = !node.isExpanded;
      setTreeNodes((previous) => {
        const previousNode = previous[nodePath];
        if (!previousNode) {
          return previous;
        }

        return {
          ...previous,
          [nodePath]: {
            ...previousNode,
            isExpanded: shouldExpand,
          },
        };
      });

      if (shouldExpand && !node.isLoaded && hasSftpSession) {
        void loadTreeDirectoryChildren(nodePath);
      }
    },
    [hasSftpSession, loadTreeDirectoryChildren, treeNodes],
  );

  const treeRootPaths = React.useMemo(() => {
    const rootPaths = Object.values(treeNodes)
      .filter((node) => !node.parentPath)
      .map((node) => node.path)
      .sort(compareSftpNames);

    if (rootPaths.length > 0) {
      return rootPaths;
    }

    return breadcrumbs[0]?.path ? [breadcrumbs[0].path] : [];
  }, [breadcrumbs, treeNodes]);

  const visibleTreePaths = React.useMemo(() => {
    return flattenVisibleTreePaths(treeNodes, treeRootPaths);
  }, [treeNodes, treeRootPaths]);

  const resolvedActiveTreePath =
    (activeTreePath && visibleTreePaths.includes(activeTreePath) ? activeTreePath : '') ||
    (visibleTreePaths.includes(currentPath) ? currentPath : '') ||
    visibleTreePaths[0] ||
    '';

  const focusTreePath = React.useCallback((nodePath: string): void => {
    setActiveTreePath(nodePath);
    treeRowRefs.current[nodePath]?.focus();
  }, []);

  const handleTreeRowKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, nodePath: string): void => {
      if (event.currentTarget !== event.target) {
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void navigateToPath(nodePath);
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();

        const currentIndex = visibleTreePaths.indexOf(nodePath);
        if (currentIndex < 0) {
          return;
        }

        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? visibleTreePaths.length - 1
              : event.key === 'ArrowDown'
                ? Math.min(currentIndex + 1, visibleTreePaths.length - 1)
                : Math.max(currentIndex - 1, 0);
        const nextPath = visibleTreePaths[nextIndex];
        if (nextPath && nextPath !== nodePath) {
          focusTreePath(nextPath);
        }
        return;
      }

      const node = treeNodes[nodePath];
      const isExpandable = Boolean(node && (node.isLoading || node.children.length > 0 || !node.isLoaded));

      if (event.key === 'ArrowRight' && node && isExpandable && !node.isExpanded) {
        event.preventDefault();
        event.stopPropagation();
        handleTreeNodeToggle(node.path);
        return;
      }

      if (event.key === 'ArrowLeft' && node?.isExpanded) {
        event.preventDefault();
        event.stopPropagation();
        handleTreeNodeToggle(node.path);
      }
    },
    [focusTreePath, handleTreeNodeToggle, navigateToPath, treeNodes, visibleTreePaths],
  );

  return (
    <>
      <div className="flex h-full w-full flex-col gap-2.5 overflow-hidden">
        <SftpToolbar
          addressBreadcrumbRenderState={addressBreadcrumbRenderState}
          addressInputContextMenuItems={addressInputContextMenuItems}
          addressInputRef={addressInputRef}
          backNavigationHistoryItems={backNavigationHistoryItems}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          canUseFileActions={canUseFileActions}
          clipboardStateExists={Boolean(clipboardState)}
          currentPath={currentPath}
          directoryListView={sftpDirectoryListView}
          filterQuery={filterQuery}
          forwardNavigationHistoryItems={forwardNavigationHistoryItems}
          getBreadcrumbDirectories={resolveBreadcrumbMenuDirectories}
          hasSelection={hasSelection}
          hasSingleSelection={hasSingleSelection}
          isAddressInputEditing={isAddressInputEditing}
          isBreadcrumbLoading={isBreadcrumbLoading}
          isBusy={isBusy}
          isRefreshingDirectory={isRefreshingDirectory}
          keepAddressInputDuringContextMenu={keepAddressInputDuringContextMenu}
          navigationIndex={navigationState.index}
          parentPath={parentPath}
          pathInput={pathInput}
          primarySelectedEntry={primarySelectedEntry}
          renderActionMenuItems={renderSftpActionMenuItems}
          renderNavigationHistoryControl={renderNavigationHistoryControl}
          activeTaskCount={activeTaskCount}
          runningTaskCount={runningTaskCount}
          selectedEntries={selectedEntries}
          selectedEntry={selectedEntry}
          sessionId={sessionId}
          sftpAuxiliarySidebarMode={sftpAuxiliarySidebarMode}
          sftpShowAddressAsText={sftpShowAddressAsText}
          sftpShowHiddenEntries={sftpShowHiddenEntries}
          sortedSftpTasks={sortedSftpTasks}
          hasTextPreview={hasTextPreview}
          isPreviewDirty={isPreviewDirty}
          isPreviewSaving={isPreviewSaving}
          taskToolbarLabel={taskToolbarLabel}
          onAddressInputPointerDown={handleAddressInputPointerDown}
          onAuxiliarySidebarModeChange={setSftpAuxiliarySidebarMode}
          onBeginCreateEntry={beginCreateEntry}
          onBeginRenameEntry={beginRenameEntry}
          onCopyCurrentPath={handleCopyCurrentPath}
          onCopyEntries={handleCopyEntries}
          onCutEntries={handleCutEntries}
          onDeleteEntries={handleDeleteEntries}
          onDirectoryListColumnVisibilityChange={setSftpDirectoryListColumnVisibility}
          onDirectoryListSortChange={setSftpDirectoryListSort}
          onEditCurrentPath={handleEditCurrentPath}
          onFilterQueryChange={setFilterQuery}
          onHistoryJump={handleHistoryJump}
          onInlineEditMenuCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}
          onNavigateToPath={navigateToPath}
          onParentDirectory={handleParentDirectory}
          onPasteEntry={handlePasteEntry}
          onPathInputBlur={handlePathInputBlur}
          onPathInputChange={setPathInput}
          onPathInputKeyDown={handlePathInputKeyDown}
          onPathSubmit={handlePathSubmit}
          onPreviewRedo={handlePreviewRedo}
          onPreviewSave={handlePreviewSave}
          onPreviewUndo={handlePreviewUndo}
          onRefresh={handleRefresh}
          onRequestBreadcrumbDirectories={loadBreadcrumbMenuDirectories}
          onShowAddressAsText={handleShowAddressAsText}
          onShowHiddenEntriesChange={setSftpHiddenEntriesVisibility}
        />
        <div className={sftpWorkbenchGridClassName}>
          <SftpTreePanel
            currentPath={currentPath}
            renderActionMenuItems={renderSftpActionMenuItems}
            resolvedActiveTreePath={resolvedActiveTreePath}
            sftpDimHiddenEntries={sftpDimHiddenEntries}
            sftpShowHiddenEntries={sftpShowHiddenEntries}
            status={status}
            treeNodes={treeNodes}
            treeRootPaths={treeRootPaths}
            treeRowRefs={treeRowRefs}
            onInlineEditMenuCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}
            onNavigateToPath={navigateToPath}
            onSetActiveTreePath={setActiveTreePath}
            onTreeNodeToggle={handleTreeNodeToggle}
            onTreeRowKeyDown={handleTreeRowKeyDown}
          />
          <SftpDirectoryPanel
            canActivateParentDirectoryListEntry={canActivateParentDirectoryListEntry}
            clipboardMode={clipboardState?.mode}
            clipboardPaths={clipboardPaths}
            directoryListView={sftpDirectoryListView}
            entries={entries}
            errorMessage={errorMessage}
            fileRowRefs={fileRowRefs}
            hasParentDirectoryListEntry={hasParentDirectoryListEntry}
            pendingCreate={pendingCreate}
            renameInput={renameInput}
            renameInputRef={renameInputRef}
            renamingEntryPath={renamingEntryPath}
            renderActionMenuItems={renderSftpActionMenuItems}
            resolvedActiveFileRowKey={resolvedActiveFileRowKey}
            selectedPathSet={selectedPathSet}
            sessionId={sessionId}
            sftpDimHiddenEntries={sftpDimHiddenEntries}
            sftpShowHiddenEntries={sftpShowHiddenEntries}
            status={status}
            visibleEntries={visibleEntries}
            onCancelInlineEdit={cancelInlineEdit}
            onCommitPendingCreate={commitPendingCreate}
            onCommitRenameEntry={commitRenameEntry}
            onDirectoryBlankClick={resetSelection}
            onDirectoryListColumnOrderChange={setSftpDirectoryListColumnOrder}
            onDirectoryListColumnVisibilityChange={setSftpDirectoryListColumnVisibility}
            onDirectoryListSortChange={setSftpDirectoryListSort}
            onDirectoryListSortFieldClick={handleSftpDirectoryListSortFieldClick}
            onEntryContextMenu={handleEntryContextMenu}
            onEntryOpen={handleEntryOpen}
            onEntrySelect={handleEntrySelect}
            onFileNavigationRowKeyDown={handleFileNavigationRowKeyDown}
            onInlineEditInputBlur={handleInlineEditInputBlur}
            onInlineEditMenuCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}
            onParentDirectory={handleParentDirectory}
            onRefresh={handleRefresh}
            onRenameInputChange={setRenameInput}
            onSetActiveFileRowKey={setActiveFileRowKey}
          />
          {sftpAuxiliarySidebarMode !== 'off' ? (
            <SftpDetailPanel
              auxiliarySidebarMode={sftpAuxiliarySidebarMode}
              previewState={previewState}
              selectedCount={selectedCount}
              selectedEntry={selectedEntry}
              onConfirmLargePreview={handleConfirmLargePreview}
              onPreviewContentChange={handlePreviewContentChange}
              onPreviewEditorMount={handlePreviewEditorMount}
            />
          ) : null}
        </div>
      </div>
      <SftpHostFingerprintDialog
        prompt={hostFingerprintPrompt}
        onResolve={resolveHostFingerprintPrompt}
      />
      <SftpDeleteConfirmationDialog
        prompt={deleteConfirmationPrompt}
        onResolve={resolveDeleteConfirmationPrompt}
      />
      <SftpUploadConfirmationDialog
        prompt={uploadConfirmationPrompt}
        onResolve={resolveUploadConfirmationPrompt}
      />
      <SftpUploadConflictConfirmationDialog
        prompt={uploadConflictConfirmationPrompt}
        onResolve={resolveUploadConflictConfirmationPrompt}
      />
    </>
  );
};

export default SFTP;
