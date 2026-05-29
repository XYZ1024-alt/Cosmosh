import type { ApiSftpEntry } from '@cosmosh/api-contract';
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
  listSftpDirectory,
  renameSftpEntry,
  runSftpBatchOperation,
  trustSshFingerprint,
  updateAppSettings,
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
import { buildSftpEntryPropertiesWindowUrl } from './sftp/sftp-entry-properties-window';
import type {
  ClipboardState,
  DirectoryCacheEntry,
  DirectoryLoadOptions,
  FilePreviewState,
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
  SftpOpenWithApplication,
  SftpQueuedTask,
  SftpSelectionClickEvent,
  SftpTaskContext,
  SftpTaskOptions,
  SftpTaskState,
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
  formatSftpTabTitle,
  formatSftpTaskToolbarLabel,
  isSameClipboardSnapshot,
  joinLocalPath,
  joinRemotePath,
  mergeResolvedDirectoryIntoTree,
  resolveAddressBreadcrumbRenderState,
  resolveAncestorDirectoryPaths,
  resolveEntryParentPath,
  resolveRangeSelectionPaths,
  resolveRemoteParentPath,
  resolveRenameTargetPath,
  resolveShortcutModifier,
  sanitizeLocalFileName,
  SFTP_TASK_STATUS_ORDER,
  shouldConfirmSftpDelete,
  sortSftpEntries,
} from './sftp/sftp-utils';
import { SftpActionMenuItems } from './sftp/SftpActionMenuItems';
import { SftpDetailPanel } from './sftp/SftpDetailPanel';
import { SftpDeleteConfirmationDialog, SftpHostFingerprintDialog } from './sftp/SftpDialogs';
import { SftpDirectoryPanel } from './sftp/SftpDirectoryPanel';
import { SftpToolbar } from './sftp/SftpToolbar';
import { SftpTreePanel } from './sftp/SftpTreePanel';

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
  const [filePreview, setFilePreview] = React.useState<FilePreviewState | null>(null);
  const [openWithApplicationsByPath, setOpenWithApplicationsByPath] = React.useState<
    Record<string, SftpOpenWithApplication[]>
  >({});
  const [loadingOpenWithPath, setLoadingOpenWithPath] = React.useState<string>('');
  const [activeTreePath, setActiveTreePath] = React.useState<string>('');
  const [activeFileRowKey, setActiveFileRowKey] = React.useState<string>('');
  const [deleteConfirmationPrompt, setDeleteConfirmationPrompt] = React.useState<SftpDeleteConfirmationPrompt | null>(
    null,
  );
  const pendingPromptResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const pendingDeleteConfirmationResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const directoryCacheRef = React.useRef<Record<string, DirectoryCacheEntry>>({});
  const sessionIdRef = React.useRef<string>('');
  const currentPathRef = React.useRef<string>('.');
  const sftpShowHiddenEntriesRef = React.useRef(sftpShowHiddenEntries);
  const syncedTabTitleRef = React.useRef<string>('');
  const temporaryOpenFilePathsRef = React.useRef<Record<string, string>>({});
  const renameInputRef = React.useRef<HTMLInputElement | null>(null);
  const shouldPreventMenuCloseAutoFocusRef = React.useRef(false);
  const inlineEditMenuActionTimerRef = React.useRef<number | null>(null);
  const inlineEditMenuFocusHandoffReleaseTimerRef = React.useRef<number | null>(null);
  const taskQueueRef = React.useRef<SftpQueuedTask[]>([]);
  const isTaskQueueRunningRef = React.useRef(false);
  const taskQueueGenerationRef = React.useRef(0);
  const taskRetentionTimersRef = React.useRef<Record<string, number>>({});
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

  React.useEffect(() => {
    return () => {
      clearAllTaskRetentionTimers();
      taskQueueGenerationRef.current += 1;
      taskQueueRef.current = [];
      isTaskQueueRunningRef.current = false;
    };
  }, [clearAllTaskRetentionTimers]);

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
    return filterSftpEntries(filterSftpEntriesByHiddenVisibility(entries, sftpShowHiddenEntries), filterQuery);
  }, [entries, filterQuery, sftpShowHiddenEntries]);

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
  const backNavigationHistoryItems = React.useMemo(
    () => buildNavigationHistoryMenuItems(navigationState, 'back'),
    [navigationState],
  );
  const forwardNavigationHistoryItems = React.useMemo(
    () => buildNavigationHistoryMenuItems(navigationState, 'forward'),
    [navigationState],
  );
  const canUseFileActions = Boolean(sessionId) && status === 'ready' && !isBusy;
  const hasParentDirectoryListEntry = sftpShowParentDirectoryEntry;
  const canActivateParentDirectoryListEntry = Boolean(parentPath);

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
    setSelectedPaths([]);
    setSelectionAnchorPath('');
    setFilePreview(null);
  }, []);

  const selectSingleEntry = React.useCallback((entry: ApiSftpEntry | null): void => {
    if (!entry) {
      setSelectedPaths([]);
      setSelectionAnchorPath('');
      setFilePreview(null);
      return;
    }

    setSelectedPaths([entry.path]);
    setSelectionAnchorPath(entry.path);
    setFilePreview(null);
  }, []);

  const selectEntryRange = React.useCallback(
    (anchorPath: string, targetPath: string, shouldExtendSelection: boolean): void => {
      const rangePaths = resolveRangeSelectionPaths(visibleEntries, anchorPath, targetPath);
      if (rangePaths.length === 0) {
        return;
      }

      setSelectedPaths((previous) => {
        const nextPaths = shouldExtendSelection ? [...previous, ...rangePaths] : rangePaths;
        return Array.from(new Set(nextPaths));
      });
      setFilePreview(null);
    },
    [visibleEntries],
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
    async (nextSessionId: string, directoryPath: string, isCancelled?: () => boolean): Promise<void> => {
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
          const response = await listSftpDirectory(nextSessionId, { path: ancestorPath });
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
    [setTreeNodeLoading],
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
    async (nextSessionId: string, directoryPath: string, options?: DirectoryLoadOptions): Promise<string | null> => {
      const cachedDirectory = directoryCacheRef.current[directoryPath];
      if (cachedDirectory && !options?.forceRefresh) {
        applyDirectoryCacheEntry(cachedDirectory);
        void syncAncestorDirectories(nextSessionId, cachedDirectory.path, options?.isCancelled);
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
        const response = await listSftpDirectory(nextSessionId, { path: directoryPath });
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
        void syncAncestorDirectories(nextSessionId, response.data.path, options?.isCancelled);
        return response.data.path;
      } catch (error: unknown) {
        if (options?.isCancelled?.()) {
          setIsRefreshingDirectory(false);
          return null;
        }

        const message = error instanceof Error ? error.message : t('sftp.loadFailed');
        setIsRefreshingDirectory(false);
        setTreeNodeLoading(directoryPath, false);
        void syncAncestorDirectories(nextSessionId, directoryPath, options?.isCancelled);
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
      setTreeNodeLoading,
      syncAncestorDirectories,
    ],
  );

  const loadTreeDirectoryChildren = React.useCallback(
    async (nextSessionId: string, directoryPath: string): Promise<void> => {
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
        const response = await listSftpDirectory(nextSessionId, { path: directoryPath });
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
    [notifyError, setTreeNodeLoading],
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
        const loadedPath = await loadDirectory(nextSessionId, response.data.currentPath, { isCancelled });

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
        resetSelection();
        setTreeNodes({});
        setClipboardState(null);
        setFilePreview(null);
        temporaryOpenFilePathsRef.current = {};
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
    notifyError,
    resetSelection,
    resolveHostFingerprintPrompt,
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
      if (!sessionId || nextIndex < 0 || nextIndex >= navigationState.paths.length) {
        return;
      }

      const targetPath = navigationState.paths[nextIndex];
      if (!targetPath) {
        return;
      }

      const loadedPath = await loadDirectory(sessionId, targetPath);
      if (!loadedPath) {
        return;
      }

      setNavigationState((previous) => {
        const nextPaths = [...previous.paths];
        nextPaths[nextIndex] = loadedPath;
        return { paths: nextPaths, index: nextIndex };
      });
    },
    [loadDirectory, navigationState.paths, sessionId],
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
      if (!sessionId || !trimmedPath) {
        return false;
      }

      const loadedPath = await loadDirectory(sessionId, trimmedPath);
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
    [loadDirectory, sessionId],
  );

  const handleRefresh = React.useCallback(() => {
    if (!sessionId) {
      return;
    }

    void loadDirectory(sessionId, currentPath, { forceRefresh: true, preserveCurrentView: true });
  }, [currentPath, loadDirectory, sessionId]);

  const handleTreeDirectoryRefresh = React.useCallback(
    (directoryPath: string): void => {
      if (!sessionId) {
        return;
      }

      invalidateDirectoryCache(directoryPath);
      if (directoryPath === currentPath) {
        void loadDirectory(sessionId, directoryPath, { forceRefresh: true, preserveCurrentView: true });
        return;
      }

      void loadTreeDirectoryChildren(sessionId, directoryPath);
    },
    [currentPath, invalidateDirectoryCache, loadDirectory, loadTreeDirectoryChildren, sessionId],
  );

  const refreshCurrentDirectoryAfterOperation = React.useCallback(
    async (affectedDirectoryPaths: readonly string[] = []): Promise<void> => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
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
          void loadTreeDirectoryChildren(activeSessionId, directoryPath);
        });

      await loadDirectory(activeSessionId, activePath, { forceRefresh: true, preserveCurrentView: true });
    },
    [invalidateDirectoryCache, loadDirectory, loadTreeDirectoryChildren],
  );

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
      if (!nextName || nextName === entry.name || !sessionId) {
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
          await renameSftpEntry(sessionId, {
            sourcePath: entry.path,
            targetPath,
          });
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
    [cancelInlineEdit, notifySuccess, refreshCurrentDirectoryAfterOperation, renameInput, runSftpOperation, sessionId],
  );

  const commitPendingCreate = React.useCallback(async (): Promise<void> => {
    const draft = pendingCreate;
    const nextName = renameInput.trim();
    cancelInlineEdit();
    if (!draft || !nextName || !sessionId) {
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
        if (draft.type === 'directory') {
          await createSftpDirectory(sessionId, { path: targetPath });
        } else {
          await createSftpFile(sessionId, { path: targetPath });
        }

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
    notifySuccess,
    pendingCreate,
    refreshCurrentDirectoryAfterOperation,
    renameInput,
    runSftpOperation,
    sessionId,
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
    const downloadsPath = await window.electron?.getDownloadsPath();
    if (!downloadsPath) {
      return null;
    }

    return joinLocalPath(downloadsPath, sanitizeLocalFileName(entry.name));
  }, []);

  const downloadEntryToLocalPath = React.useCallback(
    async (entry: ApiSftpEntry, localPath: string): Promise<void> => {
      if (!sessionId || entry.type !== 'file') {
        throw new Error(t('sftp.downloadUnsupported'));
      }

      await downloadSftpFile(sessionId, {
        path: entry.path,
        localPath,
      });
    },
    [sessionId],
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
        },
      );
    },
    [downloadEntryToTemporaryPath, notifyError, runSftpOperation],
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
        },
      );
    },
    [canUseSftpOpenWith, downloadEntryToTemporaryPath, notifyError, runSftpOperation],
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
        },
      );
    },
    [downloadEntryToTemporaryPath, notifyError, runSftpOperation],
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

      if (entry.type !== 'file' || !sessionId) {
        notifyError(t('sftp.openUnsupported'));
        return;
      }

      handleOpenEntryWithDefaultApplication(entry);
    },
    [handleOpenEntryWithDefaultApplication, navigateToPath, notifyError, selectSingleEntry, sessionId],
  );

  const handleDownloadEntry = React.useCallback(
    async (entry: ApiSftpEntry, mode: 'downloads' | 'choose'): Promise<void> => {
      if (!sessionId || entry.type !== 'file') {
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
      sessionId,
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
      if (!clipboardState || !sessionId || clipboardState.entries.length === 0) {
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
          const response = await runSftpBatchOperation(sessionId, {
            operation: operationMode === 'copy' ? 'copy' : 'move',
            targetDirectoryPath,
            entries: entriesToPaste.map((entry) => ({
              path: entry.path,
              type: entry.type,
            })),
          });
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
      notifyError,
      notifySuccess,
      refreshCurrentDirectoryAfterOperation,
      runSftpOperation,
      sessionId,
    ],
  );

  const handleDeleteEntries = React.useCallback(
    async (targetEntries: ApiSftpEntry[], source: SftpDeleteInvocationSource = 'action'): Promise<void> => {
      const entriesToDelete = dedupeSftpEntries(targetEntries);
      if (!sessionId || entriesToDelete.length === 0) {
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
          const response = await runSftpBatchOperation(sessionId, {
            operation: 'delete',
            entries: entriesToDelete.map((entry) => ({
              path: entry.path,
              type: entry.type,
            })),
          });
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
          setFilePreview((previous) => (previous && deletedPaths.has(previous.path) ? null : previous));
          deletedPaths.forEach((path) => {
            delete temporaryOpenFilePathsRef.current[path];
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
      notifyError,
      notifySuccess,
      refreshCurrentDirectoryAfterOperation,
      requestDeleteConfirmation,
      runSftpOperation,
      sessionId,
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
      if (!sessionId) {
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
    [notifyError, sessionId],
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
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    },
    [sftpShowHiddenEntries, treeNodes],
  );

  const loadBreadcrumbMenuDirectories = React.useCallback(
    (breadcrumbPath: string): void => {
      if (!sessionId || directoryCacheRef.current[breadcrumbPath] || treeNodes[breadcrumbPath]?.isLoading) {
        return;
      }

      void loadTreeDirectoryChildren(sessionId, breadcrumbPath);
    },
    [loadTreeDirectoryChildren, sessionId, treeNodes],
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
      const shouldToggle = window.electron?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
      const shouldExtendRange = event.shiftKey;

      if (shouldExtendRange) {
        selectEntryRange(selectionAnchorPath, entry.path, shouldToggle);
        if (!selectionAnchorPath) {
          setSelectionAnchorPath(entry.path);
        }
        return;
      }

      if (shouldToggle) {
        setSelectedPaths((previous) => {
          if (previous.includes(entry.path)) {
            return previous.filter((path) => path !== entry.path);
          }

          return [...previous, entry.path];
        });
        setSelectionAnchorPath(entry.path);
        setFilePreview(null);
        return;
      }

      selectSingleEntry(entry);
    },
    [selectEntryRange, selectSingleEntry, selectionAnchorPath],
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

      if (event.key === 'Enter') {
        event.preventDefault();
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
        selectSingleEntry(nextRow.entry);
      }
    },
    [fileNavigationRows, focusFileRow, handleEntryOpen, handleParentDirectory, selectSingleEntry],
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

      if (shouldExpand && !node.isLoaded && sessionId) {
        void loadTreeDirectoryChildren(sessionId, nodePath);
      }
    },
    [loadTreeDirectoryChildren, sessionId, treeNodes],
  );

  const treeRootPaths = React.useMemo(() => {
    const rootPaths = Object.values(treeNodes)
      .filter((node) => !node.parentPath)
      .map((node) => node.path)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

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
          sftpShowAddressAsText={sftpShowAddressAsText}
          sftpShowHiddenEntries={sftpShowHiddenEntries}
          sortedSftpTasks={sortedSftpTasks}
          taskToolbarLabel={taskToolbarLabel}
          onAddressInputPointerDown={handleAddressInputPointerDown}
          onBeginCreateEntry={beginCreateEntry}
          onBeginRenameEntry={beginRenameEntry}
          onCopyCurrentPath={handleCopyCurrentPath}
          onCopyEntries={handleCopyEntries}
          onCutEntries={handleCutEntries}
          onDeleteEntries={handleDeleteEntries}
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
          onRefresh={handleRefresh}
          onRequestBreadcrumbDirectories={loadBreadcrumbMenuDirectories}
          onShowAddressAsText={handleShowAddressAsText}
          onShowHiddenEntriesChange={setSftpHiddenEntriesVisibility}
        />
        <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_minmax(240px,320px)] gap-2.5 overflow-hidden">
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
            onEntryContextMenu={handleEntryContextMenu}
            onEntryOpen={handleEntryOpen}
            onEntryProperties={handleOpenProperties}
            onEntrySelect={handleEntrySelect}
            onFileNavigationRowKeyDown={handleFileNavigationRowKeyDown}
            onInlineEditInputBlur={handleInlineEditInputBlur}
            onInlineEditMenuCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}
            onParentDirectory={handleParentDirectory}
            onRefresh={handleRefresh}
            onRenameInputChange={setRenameInput}
            onSetActiveFileRowKey={setActiveFileRowKey}
          />
          <SftpDetailPanel
            filePreview={filePreview}
            selectedCount={selectedCount}
            selectedEntry={selectedEntry}
          />
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
    </>
  );
};

export default SFTP;
