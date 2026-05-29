import type { ApiSftpEntry, SettingsValues } from '@cosmosh/api-contract';
import classNames from 'classnames';
import { File, Folder } from 'lucide-react';
import React from 'react';

import { t } from '../../lib/i18n';
import {
  ADDRESS_BREADCRUMB_TRAILING_COUNT,
  ADDRESS_BREADCRUMB_VISIBLE_LIMIT,
  TREE_INDENT_CLASS_NAMES,
} from './sftp-constants';
import type {
  AddressBreadcrumbRenderState,
  NavigationHistoryDirection,
  NavigationHistoryMenuItem,
  NavigationState,
  SftpActionMenuOptions,
  SftpBreadcrumbItem,
  SftpDeleteInvocationSource,
  SftpTaskProgress,
  SftpTaskStatus,
  TreeDirectoryNode,
} from './sftp-types';

export const SFTP_TASK_STATUS_ORDER: Record<SftpTaskStatus, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  success: 3,
};

/**
 * Creates a stable renderer-local SFTP task id.
 *
 * @returns Unique task id for the current tab runtime.
 */
export const createSftpTaskId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `sftp-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/**
 * Returns the parent path for a POSIX-style remote path.
 *
 * @param remotePath Remote file or directory path.
 * @returns Parent directory path with root/current markers preserved.
 */
export const resolveRemoteParentPath = (remotePath: string): string => {
  const normalizedPath = remotePath.replace(/\/+$/, '');
  if (!normalizedPath || normalizedPath === '.') {
    return '.';
  }

  const slashIndex = normalizedPath.lastIndexOf('/');
  if (slashIndex <= 0) {
    return normalizedPath.startsWith('/') ? '/' : '.';
  }

  return normalizedPath.slice(0, slashIndex);
};

/**
 * Builds a POSIX-style relative path from one ancestor directory to a target path.
 *
 * @param ancestorPath Directory that acts as the relative base.
 * @param targetPath Remote target path.
 * @returns Relative path beginning with `./`.
 */
export const buildRelativeRemotePath = (ancestorPath: string, targetPath: string): string => {
  const normalizedAncestor = ancestorPath.replace(/\/+$/, '');
  const normalizedTarget = targetPath.replace(/\/+$/, '');

  if (normalizedAncestor === '/' && normalizedTarget.startsWith('/')) {
    return `.${normalizedTarget}`;
  }

  if (normalizedAncestor === '.' || normalizedAncestor === '') {
    return `./${normalizedTarget.replace(/^\/+/, '')}`;
  }

  const prefix = `${normalizedAncestor}/`;
  if (normalizedTarget.startsWith(prefix)) {
    return `./${normalizedTarget.slice(prefix.length)}`;
  }

  return `./${normalizedTarget.replace(/^\/+/, '')}`;
};

/**
 * Resolves relative path copy choices from nearest parent to root/current base.
 *
 * @param targetPath Remote target path.
 * @returns Ordered relative path choices.
 */
export const buildRelativeRemotePathOptions = (targetPath: string): string[] => {
  const normalizedTarget = targetPath.replace(/\/+$/, '');
  if (!normalizedTarget || normalizedTarget === '.') {
    return [];
  }

  const ancestors: string[] = [];
  let currentAncestor = resolveRemoteParentPath(normalizedTarget);

  while (currentAncestor && !ancestors.includes(currentAncestor)) {
    ancestors.push(currentAncestor);

    if (currentAncestor === '/' || currentAncestor === '.') {
      break;
    }

    currentAncestor = resolveRemoteParentPath(currentAncestor);
  }

  return Array.from(new Set(ancestors.map((ancestor) => buildRelativeRemotePath(ancestor, normalizedTarget))));
};

/**
 * Removes characters that are invalid in common local file systems.
 *
 * @param fileName Remote file name.
 * @returns Local-safe file name.
 */
export const sanitizeLocalFileName = (fileName: string): string => {
  const sanitized = Array.from(fileName)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint < 32 ? '_' : character.replace(/[<>:"/\\|?*]/g, '_');
    })
    .join('')
    .trim();
  return sanitized || 'download';
};

/**
 * Joins a local directory and file name using the active desktop platform separator.
 *
 * @param directory Local directory path.
 * @param fileName Local file name.
 * @returns Local destination path.
 */
export const joinLocalPath = (directory: string, fileName: string): string => {
  const separator = window.electron?.platform === 'win32' ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${fileName}`;
};

/**
 * Formats SFTP byte sizes for the compact file list.
 *
 * @param size Raw byte size from the SFTP server.
 * @returns Human-readable size label.
 */
export const formatFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) {
    return '-';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

/**
 * Serializes raw SFTP metadata for the properties inspection panel.
 *
 * @param value Raw data payload.
 * @returns Pretty-printed JSON string.
 */
export const formatRawDataJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/**
 * Formats an SFTP timestamp for the local workstation locale.
 *
 * @param value ISO timestamp returned by the backend.
 * @returns Localized timestamp or a placeholder when parsing fails.
 */
export const formatModifiedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
};

/**
 * Resolves the icon for a directory-list entry.
 *
 * @param entry SFTP entry.
 * @returns Icon element matching the entry type.
 */
export const resolveEntryIcon = (entry: ApiSftpEntry, className?: string): React.ReactNode => {
  const iconClassName = classNames('h-4 w-4 shrink-0', className ?? 'text-home-text');

  if (entry.type === 'directory') {
    return <Folder className={iconClassName} />;
  }

  return <File className={iconClassName} />;
};

/**
 * Splits a normalized SFTP path into clickable breadcrumb items.
 *
 * @param directoryPath Current remote directory path.
 * @returns Ordered breadcrumb labels and paths.
 */
export const buildBreadcrumbs = (directoryPath: string): SftpBreadcrumbItem[] => {
  if (!directoryPath || directoryPath === '.') {
    return [{ label: '.', path: '.' }];
  }

  const isAbsolute = directoryPath.startsWith('/');
  const parts = directoryPath.split('/').filter(Boolean);
  const breadcrumbs: SftpBreadcrumbItem[] = [];

  if (isAbsolute) {
    breadcrumbs.push({ label: '/', path: '/' });
  }

  parts.forEach((part, index) => {
    const path = `${isAbsolute ? '/' : ''}${parts.slice(0, index + 1).join('/')}`;
    breadcrumbs.push({ label: part, path });
  });

  return breadcrumbs.length > 0 ? breadcrumbs : [{ label: directoryPath, path: directoryPath }];
};

/**
 * Splits breadcrumbs into visible and collapsed groups for the compact address bar.
 *
 * @param items Full breadcrumb chain for the current path.
 * @returns Breadcrumb groups with old ancestors collapsed behind an ellipsis menu when needed.
 */
export const resolveAddressBreadcrumbRenderState = (items: SftpBreadcrumbItem[]): AddressBreadcrumbRenderState => {
  if (items.length <= ADDRESS_BREADCRUMB_VISIBLE_LIMIT) {
    return {
      hiddenItems: [],
      visibleItems: items,
    };
  }

  const leadingItem = items[0];
  const visibleItems = items.slice(-ADDRESS_BREADCRUMB_TRAILING_COUNT);
  const hiddenEndIndex = Math.max(1, items.length - ADDRESS_BREADCRUMB_TRAILING_COUNT);

  return {
    leadingItem,
    hiddenItems: items.slice(1, hiddenEndIndex),
    visibleItems,
  };
};

/**
 * Checks whether an entry-like name is hidden by POSIX dotfile convention.
 *
 * @param name Entry basename or breadcrumb label.
 * @returns Whether the name should be treated as dot-hidden.
 */
export const isSftpDotHiddenName = (name: string): boolean => {
  return name.startsWith('.') && name !== '.' && name !== '..';
};

/**
 * Builds the one-click jump targets exposed by the SFTP back/forward context menus.
 *
 * @param state Current in-memory path history for the tab.
 * @param direction Direction controlled by the toolbar button.
 * @returns Reachable history entries, ordered from nearest jump target to farthest.
 */
export const buildNavigationHistoryMenuItems = (
  state: NavigationState,
  direction: NavigationHistoryDirection,
): NavigationHistoryMenuItem[] => {
  if (state.index < 0 || state.paths.length === 0) {
    return [];
  }

  if (direction === 'back') {
    return state.paths
      .slice(0, state.index)
      .map((path, index) => ({ path, index }))
      .reverse();
  }

  return state.paths.slice(state.index + 1).map((path, offset) => ({
    path,
    index: state.index + offset + 1,
  }));
};

/**
 * Resolves a compact label for a path when no explicit SFTP entry name exists.
 *
 * @param directoryPath Remote directory path.
 * @returns Last path segment or root marker.
 */
export const resolvePathLabel = (directoryPath: string): string => {
  if (!directoryPath || directoryPath === '.') {
    return '.';
  }

  if (directoryPath === '/') {
    return '/';
  }

  const parts = directoryPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? directoryPath;
};

/**
 * Formats the SFTP tab title from the active folder label and source server.
 *
 * @param directoryPath Current remote directory path.
 * @param serverName Source server display name.
 * @returns Compact browser-style tab title.
 */
export const formatSftpTabTitle = (directoryPath: string, serverName: string): string => {
  const trimmedServerName = serverName.trim();
  if (!trimmedServerName) {
    return t('tabs.page.sftp');
  }

  return `${resolvePathLabel(directoryPath)} - ${trimmedServerName}`;
};

/**
 * Sorts entries in the browser order used by the SFTP page.
 *
 * @param entries Directory entries returned by the backend.
 * @returns Entries sorted with directories first, then by name.
 */
export const sortSftpEntries = (entries: ApiSftpEntry[]): ApiSftpEntry[] => {
  return [...entries].sort((left, right) => {
    const leftDirectoryRank = left.type === 'directory' ? 0 : 1;
    const rightDirectoryRank = right.type === 'directory' ? 0 : 1;
    if (leftDirectoryRank !== rightDirectoryRank) {
      return leftDirectoryRank - rightDirectoryRank;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
};

/**
 * Resolves the Tailwind indentation class for one tree row.
 *
 * @param depth Directory depth in the rendered tree.
 * @returns Stable padding class name.
 */
export const resolveTreeIndentClassName = (depth: number): string => {
  return TREE_INDENT_CLASS_NAMES[Math.min(depth, TREE_INDENT_CLASS_NAMES.length - 1)];
};

/**
 * Resolves ancestor directories that should be loaded to keep the tree structure complete.
 *
 * @param directoryPath Current remote directory path.
 * @returns Parent directory paths ordered from root to nearest parent.
 */
export const resolveAncestorDirectoryPaths = (directoryPath: string): string[] => {
  const breadcrumbs = buildBreadcrumbs(directoryPath);
  return breadcrumbs.slice(0, -1).map((breadcrumb) => breadcrumb.path);
};

/**
 * Adds breadcrumb ancestors for a path while preserving existing tree children.
 *
 * @param previous Previous tree node registry.
 * @param directoryPath Path that must be visible in the tree.
 * @returns Tree registry containing the path branch.
 */
export const mergePathBranchIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  directoryPath: string,
  showHiddenEntries = true,
): Record<string, TreeDirectoryNode> => {
  const breadcrumbs = buildBreadcrumbs(directoryPath);
  const next: Record<string, TreeDirectoryNode> = { ...previous };

  breadcrumbs.forEach((breadcrumb, index) => {
    const parentPath = index > 0 ? breadcrumbs[index - 1]?.path : undefined;
    const existing = next[breadcrumb.path];

    next[breadcrumb.path] = {
      path: breadcrumb.path,
      name: existing?.name ?? breadcrumb.label,
      parentPath,
      isHidden: existing?.isHidden ?? isSftpDotHiddenName(breadcrumb.label),
      children: existing?.children ?? [],
      isExpanded: true,
      isLoaded: existing?.isLoaded ?? false,
      isLoading: existing?.isLoading ?? false,
    };

    if (parentPath) {
      const parent = next[parentPath];
      const childSet = new Set(parent.children);
      if (showHiddenEntries || !next[breadcrumb.path]?.isHidden) {
        childSet.add(breadcrumb.path);
      }
      next[parentPath] = {
        ...parent,
        children: Array.from(childSet),
        isExpanded: true,
      };
    }
  });

  return next;
};

/**
 * Merges a loaded directory listing into the left tree registry.
 *
 * @param previous Previous tree node registry.
 * @param directoryPath Loaded remote directory path.
 * @param entries Directory entries returned for the path.
 * @returns Updated tree registry.
 */
export const mergeDirectoryEntriesIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  directoryPath: string,
  entries: ApiSftpEntry[],
  showHiddenEntries: boolean,
): Record<string, TreeDirectoryNode> => {
  const next = mergePathBranchIntoTree(previous, directoryPath, showHiddenEntries);
  const directoryChildren = filterSftpEntriesByHiddenVisibility(sortSftpEntries(entries), showHiddenEntries).filter(
    (entry) => entry.type === 'directory',
  );
  const childPaths = directoryChildren.map((entry) => entry.path);
  const existing = next[directoryPath] ?? {
    path: directoryPath,
    name: resolvePathLabel(directoryPath),
    isHidden: false,
    children: [],
    isExpanded: true,
    isLoaded: false,
    isLoading: false,
  };

  next[directoryPath] = {
    ...existing,
    children: childPaths,
    isExpanded: true,
    isLoaded: true,
    isLoading: false,
  };

  directoryChildren.forEach((entry) => {
    const childExisting = next[entry.path];
    next[entry.path] = {
      path: entry.path,
      name: entry.name,
      parentPath: directoryPath,
      isHidden: entry.isHidden,
      children: childExisting?.children ?? [],
      isExpanded: childExisting?.isExpanded ?? false,
      isLoaded: childExisting?.isLoaded ?? false,
      isLoading: childExisting?.isLoading ?? false,
    };
  });

  return next;
};

/**
 * Merges a resolved directory listing and removes any temporary requested-path placeholder.
 *
 * @param previous Previous tree node registry.
 * @param requestedPath Path used for the request.
 * @param resolvedPath Canonical path returned by the backend.
 * @param entries Directory entries returned for the canonical path.
 * @returns Updated tree registry.
 */
export const mergeResolvedDirectoryIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  requestedPath: string,
  resolvedPath: string,
  entries: ApiSftpEntry[],
  showHiddenEntries: boolean,
): Record<string, TreeDirectoryNode> => {
  const next = mergeDirectoryEntriesIntoTree(previous, resolvedPath, entries, showHiddenEntries);
  const requestedNode = next[requestedPath];
  if (requestedPath !== resolvedPath && requestedNode) {
    if (!requestedNode.isLoaded && requestedNode.children.length === 0) {
      delete next[requestedPath];
    } else {
      next[requestedPath] = { ...requestedNode, isLoading: false };
    }
  }

  return next;
};

/**
 * Filters entries by file name for the toolbar search field.
 *
 * @param entries Current directory entries.
 * @param query Search query.
 * @returns Entries matching the query.
 */
export const filterSftpEntries = (entries: ApiSftpEntry[], query: string): ApiSftpEntry[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedQuery));
};

/**
 * Filters SFTP entries by the user's hidden-entry visibility preference.
 *
 * @param entries Current directory entries.
 * @param showHiddenEntries Whether hidden entries should remain visible.
 * @returns Entries that should participate in visible browser surfaces.
 */
export const filterSftpEntriesByHiddenVisibility = (
  entries: ApiSftpEntry[],
  showHiddenEntries: boolean,
): ApiSftpEntry[] => {
  if (showHiddenEntries) {
    return entries;
  }

  return entries.filter((entry) => !entry.isHidden);
};

/**
 * Removes duplicate SFTP entries while preserving the first encountered order.
 *
 * @param entries Candidate entries.
 * @returns Unique entries keyed by remote path.
 */
export const dedupeSftpEntries = (entries: ApiSftpEntry[]): ApiSftpEntry[] => {
  const seenPaths = new Set<string>();
  return entries.filter((entry) => {
    if (seenPaths.has(entry.path)) {
      return false;
    }

    seenPaths.add(entry.path);
    return true;
  });
};

/**
 * Resolves a visible row range for Shift-click selection.
 *
 * @param entries Entries in the current rendered order.
 * @param anchorPath Existing selection anchor path.
 * @param targetPath Newly selected target path.
 * @returns Entry paths covered by the visible range.
 */
export const resolveRangeSelectionPaths = (
  entries: ApiSftpEntry[],
  anchorPath: string,
  targetPath: string,
): string[] => {
  const targetIndex = entries.findIndex((entry) => entry.path === targetPath);
  if (targetIndex < 0) {
    return [];
  }

  const anchorIndex = anchorPath ? entries.findIndex((entry) => entry.path === anchorPath) : -1;
  if (anchorIndex < 0) {
    return [targetPath];
  }

  const startIndex = Math.min(anchorIndex, targetIndex);
  const endIndex = Math.max(anchorIndex, targetIndex);
  return entries.slice(startIndex, endIndex + 1).map((entry) => entry.path);
};

/**
 * Flattens the expanded directory tree into the exact visual row order.
 *
 * @param treeNodes Directory tree registry keyed by remote path.
 * @param rootPaths Top-level paths to render.
 * @returns Visible directory paths in keyboard navigation order.
 */
export const flattenVisibleTreePaths = (
  treeNodes: Record<string, TreeDirectoryNode>,
  rootPaths: string[],
): string[] => {
  const visiblePaths: string[] = [];

  const appendNode = (nodePath: string): void => {
    const node = treeNodes[nodePath];
    if (!node) {
      return;
    }

    visiblePaths.push(node.path);

    if (node.isExpanded) {
      node.children.forEach(appendNode);
    }
  };

  rootPaths.forEach(appendNode);

  return visiblePaths;
};

/**
 * Resolves the entries affected by a toolbar or row-context action.
 *
 * @param contextEntry Row entry that opened the context menu, when available.
 * @param scope Action menu scope.
 * @param selectedEntries Current selected entries in directory order.
 * @param selectedPathSet Current selected path set.
 * @returns Entries that the action should target.
 */
export const resolveActionTargetEntries = (
  contextEntry: ApiSftpEntry | null,
  scope: SftpActionMenuOptions['scope'],
  selectedEntries: ApiSftpEntry[],
  selectedPathSet: ReadonlySet<string>,
): ApiSftpEntry[] => {
  if (scope === 'directory') {
    return [];
  }

  if (scope === 'treeDirectory') {
    return contextEntry ? [contextEntry] : [];
  }

  if (contextEntry) {
    return selectedPathSet.has(contextEntry.path) && selectedEntries.length > 0 ? selectedEntries : [contextEntry];
  }

  return selectedEntries;
};

/**
 * Formats singular/plural SFTP operation feedback.
 *
 * @param count Number of affected entries.
 * @param singularKey I18n key for one entry.
 * @param pluralKey I18n key for many entries.
 * @returns Localized feedback message.
 */
export const formatBatchFeedback = (count: number, singularKey: string, pluralKey: string): string => {
  return count === 1 ? t(singularKey) : t(pluralKey, { count });
};

/**
 * Formats the user-facing summary when the backend stops a batch after one failed item.
 *
 * @param summary Batch execution counts returned by the backend.
 * @returns Localized partial-failure message.
 */
export const formatBatchPartialFailureFeedback = (summary: {
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  totalCount: number;
}): string => {
  return t('sftp.feedback.batchPartialFailure', {
    completed: summary.completedCount,
    failed: summary.failedCount,
    skipped: summary.skippedCount,
    total: summary.totalCount,
  });
};

/**
 * Formats a compact progress label for queued SFTP tasks.
 *
 * @param progress Optional task progress counts.
 * @returns Localized progress label.
 */
export const formatSftpTaskProgressLabel = (progress?: SftpTaskProgress): string => {
  if (!progress) {
    return t('sftp.tasks.progressIndeterminate');
  }

  return t('sftp.tasks.progressCount', {
    completed: progress.completed,
    total: progress.total,
  });
};

/**
 * Formats a compact tooltip for the toolbar task trigger.
 *
 * @param runningCount Running task count.
 * @param queuedCount Queued task count.
 * @returns Localized toolbar task summary.
 */
export const formatSftpTaskToolbarLabel = (runningCount: number, queuedCount: number): string => {
  if (runningCount > 0 && queuedCount > 0) {
    return t('sftp.tasks.toolbarMixed', {
      queued: queuedCount,
      running: runningCount,
    });
  }

  if (queuedCount > 0) {
    return t('sftp.tasks.toolbarQueued', { count: queuedCount });
  }

  return t('sftp.tasks.toolbarRunning', { count: runningCount });
};

/**
 * Decides whether a destructive SFTP delete needs a confirmation prompt.
 *
 * @param mode User-configured confirmation mode.
 * @param entryCount Number of entries that would be deleted.
 * @param source UI surface that initiated the delete.
 * @returns Whether the delete flow must ask before calling the backend.
 */
export const shouldConfirmSftpDelete = (
  mode: SettingsValues['sftpDeleteConfirmationMode'],
  entryCount: number,
  source: SftpDeleteInvocationSource,
): boolean => {
  if (mode === 'always') {
    return true;
  }

  if (mode === 'batch') {
    return entryCount > 1;
  }

  if (mode === 'shortcut') {
    return source === 'shortcut';
  }

  return false;
};

/**
 * Resolves the modifier key name shown in shortcut labels for the active desktop platform.
 *
 * @returns Shortcut modifier label.
 */
export const resolveShortcutModifier = (): string => {
  return window.electron?.platform === 'darwin' ? 'Cmd' : 'Ctrl';
};

/**
 * Builds a child path for the current SFTP directory.
 *
 * @param parentPath Current remote directory path.
 * @param name New entry name.
 * @returns POSIX-style child path.
 */
export const joinRemotePath = (parentPath: string, name: string): string => {
  if (parentPath === '/' || parentPath === '.') {
    return `${parentPath === '/' ? '' : parentPath}/${name}`.replace(/\/+/g, '/') || '/';
  }

  return `${parentPath.replace(/\/+$/, '')}/${name}`;
};

/**
 * Returns the parent directory for a remote SFTP entry path.
 *
 * @param entryPath Remote entry path.
 * @returns Parent path.
 */
export const resolveEntryParentPath = (entryPath: string): string => {
  const normalizedPath = entryPath.replace(/\/+$/, '');
  const slashIndex = normalizedPath.lastIndexOf('/');
  if (slashIndex <= 0) {
    return normalizedPath.startsWith('/') ? '/' : '.';
  }

  return normalizedPath.slice(0, slashIndex);
};

/**
 * Returns a sibling path for renaming an entry without moving it.
 *
 * @param entry Existing SFTP entry.
 * @param nextName New entry name.
 * @returns Target path for rename.
 */
export const resolveRenameTargetPath = (entry: ApiSftpEntry, nextName: string): string => {
  return joinRemotePath(resolveEntryParentPath(entry.path), nextName);
};

/**
 * Checks whether the clipboard still matches the snapshot used by a queued task.
 *
 * @param current Current clipboard state.
 * @param mode Clipboard mode captured when the task was queued.
 * @param entries Entries captured when the task was queued.
 * @returns True when clearing the clipboard will not discard a newer user action.
 */
export const isSameClipboardSnapshot = (
  current: { mode: 'copy' | 'cut'; entries: ApiSftpEntry[] } | null,
  mode: 'copy' | 'cut',
  entries: readonly ApiSftpEntry[],
): boolean => {
  return (
    current?.mode === mode &&
    current.entries.length === entries.length &&
    current.entries.every((entry, index) => entry.path === entries[index]?.path && entry.type === entries[index]?.type)
  );
};

/**
 * Builds a minimal directory entry for tree-node menu actions.
 *
 * @param node Directory tree node opened through the context menu.
 * @returns SFTP directory entry carrying the path/type fields action handlers require.
 */
export const resolveTreeDirectoryEntry = (node: TreeDirectoryNode): ApiSftpEntry => {
  return {
    name: node.name,
    path: node.path,
    ...(node.parentPath ? { parentPath: node.parentPath } : {}),
    isHidden: node.isHidden,
    type: 'directory',
    size: 0,
    mode: 0,
    permissions: '',
    permissionOctal: '0000',
    uid: 0,
    gid: 0,
    modifiedAt: '',
    accessedAt: '',
    extension: '',
    shellEscapedPath: node.path,
  };
};
