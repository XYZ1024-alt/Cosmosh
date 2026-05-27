import type { ApiSftpEntry, SettingsValues } from '@cosmosh/api-contract';
import classNames from 'classnames';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clipboard,
  Copy,
  Download,
  Edit3,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Hourglass,
  Info,
  ListTodo,
  Loader2,
  MoreVertical,
  RefreshCcw,
  Scissors,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  Undo2,
} from 'lucide-react';
import React from 'react';

import { Button } from '../components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSlot,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Menubar, MenubarSeparator } from '../components/ui/menubar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
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
} from '../lib/backend';
import { t } from '../lib/i18n';
import { useSettingsValue } from '../lib/settings-store';
import { useToast } from '../lib/toast-context';
import type { SftpConnectionIntent } from '../types/tabs';

type HostFingerprintPrompt = {
  serverId: string;
  host: string;
  port: number;
  algorithm: 'sha256';
  fingerprint: string;
};

type SFTPProps = {
  connectionIntent?: SftpConnectionIntent;
  onOpenDirectoryInNewTab: (initialPath: string) => void;
  onOpenSshAtPath: (initialPath: string) => void;
  onTabTitleChange: (title: string) => void;
};

type DirectoryLoadOptions = {
  forceRefresh?: boolean;
  preserveCurrentView?: boolean;
  isCancelled?: () => boolean;
};

type DirectoryCacheEntry = {
  path: string;
  parentPath?: string;
  entries: ApiSftpEntry[];
};

type TreeDirectoryNode = {
  path: string;
  name: string;
  parentPath?: string;
  children: string[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
};

type NavigationState = {
  paths: string[];
  index: number;
};

type ClipboardState = {
  mode: 'copy' | 'cut';
  entries: ApiSftpEntry[];
};

type FilePreviewState = {
  path: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
};

type PendingCreateState = {
  type: 'file' | 'directory';
  name: string;
};

type SftpActionMenuOptions = {
  contextEntry: ApiSftpEntry | null;
  menuSurface: 'context' | 'dropdown';
  scope: 'entry' | 'directory' | 'toolbarMore' | 'treeDirectory';
  showShortcuts: boolean;
  targetDirectoryPath?: string;
};

type SftpSelectionClickEvent = Pick<React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>;

type SftpDeleteInvocationSource = 'action' | 'shortcut';

type SftpDeleteConfirmationPrompt = {
  entries: ApiSftpEntry[];
  source: SftpDeleteInvocationSource;
};

type InlineEditMenuAction = () => void | Promise<void>;

type SftpTaskStatus = 'queued' | 'running' | 'success' | 'failed';

type SftpTaskProgress = {
  completed: number;
  total: number;
};

type SftpTaskState = {
  id: string;
  label: string;
  detail: string;
  status: SftpTaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: SftpTaskProgress;
};

type SftpTaskOptions = {
  label: string;
  detail?: string;
  progress?: SftpTaskProgress;
};

type SftpTaskContext = {
  taskId: string;
  isCurrent: () => boolean;
  update: (patch: Partial<Pick<SftpTaskState, 'detail' | 'progress'>>) => void;
};

type SftpQueuedTask = {
  id: string;
  run: () => Promise<void>;
};

type SftpOpenWithApplication = {
  id: string;
  name: string;
  path: string;
  bundleIdentifier?: string;
  iconDataUrl?: string;
};

type SftpFileNavigationRow =
  | {
      kind: 'parent';
      key: string;
    }
  | {
      kind: 'entry';
      key: string;
      entry: ApiSftpEntry;
    };

const TREE_INDENT_CLASS_NAMES = ['pl-2', 'pl-5', 'pl-8', 'pl-11', 'pl-14', 'pl-16'] as const;
const SFTP_CARD_CLASS_NAME = 'bg-ssh-card-bg-terminal h-full min-h-0 overflow-hidden rounded-[18px] p-1';
const DIRECTORY_LIST_MIN_WIDTH_CLASS_NAME = 'min-w-[600px]';
const DIRECTORY_ROW_GRID_CLASS_NAME = 'grid-cols-[minmax(0,1fr)_92px_148px_96px_28px]';
const SFTP_OPEN_WITH_APPLICATION_ICON_FALLBACK =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const NEW_FILE_NAME = 'untitled.txt';
const NEW_DIRECTORY_NAME = 'Untitled Folder';
const PARENT_DIRECTORY_ROW_KEY = '__sftp_parent_directory__';
const INLINE_EDIT_MENU_HANDOFF_RELEASE_DELAY_MS = 220;
const SFTP_TASK_RETENTION_MS = 4500;
const SFTP_TASK_STATUS_ORDER: Record<SftpTaskStatus, number> = {
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
const createSftpTaskId = (): string => {
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
const resolveRemoteParentPath = (remotePath: string): string => {
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
const buildRelativeRemotePath = (ancestorPath: string, targetPath: string): string => {
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
const buildRelativeRemotePathOptions = (targetPath: string): string[] => {
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
const sanitizeLocalFileName = (fileName: string): string => {
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
const joinLocalPath = (directory: string, fileName: string): string => {
  const separator = window.electron?.platform === 'win32' ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${fileName}`;
};

/**
 * Formats SFTP byte sizes for the compact file list.
 *
 * @param size Raw byte size from the SFTP server.
 * @returns Human-readable size label.
 */
const formatFileSize = (size: number): string => {
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
 * Formats an SFTP timestamp for the local workstation locale.
 *
 * @param value ISO timestamp returned by the backend.
 * @returns Localized timestamp or a placeholder when parsing fails.
 */
const formatModifiedAt = (value: string): string => {
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
const resolveEntryIcon = (entry: ApiSftpEntry): React.ReactNode => {
  if (entry.type === 'directory') {
    return <Folder className="text-home-text h-4 w-4 shrink-0" />;
  }

  return <File className="text-home-text h-4 w-4 shrink-0" />;
};

/**
 * Splits a normalized SFTP path into clickable breadcrumb items.
 *
 * @param directoryPath Current remote directory path.
 * @returns Ordered breadcrumb labels and paths.
 */
const buildBreadcrumbs = (directoryPath: string): Array<{ label: string; path: string }> => {
  if (!directoryPath || directoryPath === '.') {
    return [{ label: '.', path: '.' }];
  }

  const isAbsolute = directoryPath.startsWith('/');
  const parts = directoryPath.split('/').filter(Boolean);
  const breadcrumbs: Array<{ label: string; path: string }> = [];

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
 * Resolves a compact label for a path when no explicit SFTP entry name exists.
 *
 * @param directoryPath Remote directory path.
 * @returns Last path segment or root marker.
 */
const resolvePathLabel = (directoryPath: string): string => {
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
 * Sorts entries in the browser order used by the SFTP page.
 *
 * @param entries Directory entries returned by the backend.
 * @returns Entries sorted with directories first, then by name.
 */
const sortSftpEntries = (entries: ApiSftpEntry[]): ApiSftpEntry[] => {
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
const resolveTreeIndentClassName = (depth: number): string => {
  return TREE_INDENT_CLASS_NAMES[Math.min(depth, TREE_INDENT_CLASS_NAMES.length - 1)];
};

/**
 * Resolves ancestor directories that should be loaded to keep the tree structure complete.
 *
 * @param directoryPath Current remote directory path.
 * @returns Parent directory paths ordered from root to nearest parent.
 */
const resolveAncestorDirectoryPaths = (directoryPath: string): string[] => {
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
const mergePathBranchIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  directoryPath: string,
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
      children: existing?.children ?? [],
      isExpanded: true,
      isLoaded: existing?.isLoaded ?? false,
      isLoading: existing?.isLoading ?? false,
    };

    if (parentPath) {
      const parent = next[parentPath];
      const childSet = new Set(parent.children);
      childSet.add(breadcrumb.path);
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
const mergeDirectoryEntriesIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  directoryPath: string,
  entries: ApiSftpEntry[],
): Record<string, TreeDirectoryNode> => {
  const next = mergePathBranchIntoTree(previous, directoryPath);
  const directoryChildren = sortSftpEntries(entries).filter((entry) => entry.type === 'directory');
  const childPaths = directoryChildren.map((entry) => entry.path);
  const existing = next[directoryPath] ?? {
    path: directoryPath,
    name: resolvePathLabel(directoryPath),
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
const mergeResolvedDirectoryIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  requestedPath: string,
  resolvedPath: string,
  entries: ApiSftpEntry[],
): Record<string, TreeDirectoryNode> => {
  const next = mergeDirectoryEntriesIntoTree(previous, resolvedPath, entries);
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
const filterSftpEntries = (entries: ApiSftpEntry[], query: string): ApiSftpEntry[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedQuery));
};

/**
 * Removes duplicate SFTP entries while preserving the first encountered order.
 *
 * @param entries Candidate entries.
 * @returns Unique entries keyed by remote path.
 */
const dedupeSftpEntries = (entries: ApiSftpEntry[]): ApiSftpEntry[] => {
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
const resolveRangeSelectionPaths = (entries: ApiSftpEntry[], anchorPath: string, targetPath: string): string[] => {
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
const flattenVisibleTreePaths = (treeNodes: Record<string, TreeDirectoryNode>, rootPaths: string[]): string[] => {
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
const resolveActionTargetEntries = (
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
const formatBatchFeedback = (count: number, singularKey: string, pluralKey: string): string => {
  return count === 1 ? t(singularKey) : t(pluralKey, { count });
};

/**
 * Formats the user-facing summary when the backend stops a batch after one failed item.
 *
 * @param summary Batch execution counts returned by the backend.
 * @returns Localized partial-failure message.
 */
const formatBatchPartialFailureFeedback = (summary: {
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
const formatSftpTaskProgressLabel = (progress?: SftpTaskProgress): string => {
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
const formatSftpTaskToolbarLabel = (runningCount: number, queuedCount: number): string => {
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
const shouldConfirmSftpDelete = (
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
const resolveShortcutModifier = (): string => {
  return window.electron?.platform === 'darwin' ? 'Cmd' : 'Ctrl';
};

/**
 * Builds a child path for the current SFTP directory.
 *
 * @param parentPath Current remote directory path.
 * @param name New entry name.
 * @returns POSIX-style child path.
 */
const joinRemotePath = (parentPath: string, name: string): string => {
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
const resolveEntryParentPath = (entryPath: string): string => {
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
const resolveRenameTargetPath = (entry: ApiSftpEntry, nextName: string): string => {
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
const isSameClipboardSnapshot = (
  current: ClipboardState | null,
  mode: ClipboardState['mode'],
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
const resolveTreeDirectoryEntry = (node: TreeDirectoryNode): ApiSftpEntry => {
  return {
    name: node.name,
    path: node.path,
    type: 'directory',
    size: 0,
    mode: 0,
    permissions: '',
    modifiedAt: '',
  };
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
  const sftpDeleteConfirmationMode = useSettingsValue('sftpDeleteConfirmationMode');
  const sftpShowParentDirectoryEntry = useSettingsValue('sftpShowParentDirectoryEntry');
  const [sessionId, setSessionId] = React.useState<string>('');
  const [currentPath, setCurrentPath] = React.useState<string>('.');
  const [parentPath, setParentPath] = React.useState<string | undefined>(undefined);
  const [entries, setEntries] = React.useState<ApiSftpEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = React.useState<string[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = React.useState<string>('');
  const [status, setStatus] = React.useState<'idle' | 'connecting' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [pathInput, setPathInput] = React.useState<string>('.');
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

  React.useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  React.useEffect(() => {
    const nextTitle = connectionIntent?.serverName;
    if (nextTitle && syncedTabTitleRef.current !== nextTitle) {
      syncedTabTitleRef.current = nextTitle;
      onTabTitleChange(nextTitle);
    }
  }, [connectionIntent?.serverName, onTabTitleChange]);

  React.useEffect(() => {
    setPathInput(currentPath);
    currentPathRef.current = currentPath;
  }, [currentPath]);

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
    return filterSftpEntries(entries, filterQuery);
  }, [entries, filterQuery]);

  const selectedPathSet = React.useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const selectedEntries = React.useMemo(() => {
    return entries.filter((entry) => selectedPathSet.has(entry.path));
  }, [entries, selectedPathSet]);

  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const primarySelectedEntry = selectedEntries[0] ?? null;
  const selectedCount = selectedEntries.length;
  const hasSelection = selectedCount > 0;
  const hasSingleSelection = selectedCount === 1;

  const breadcrumbs = React.useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);
  const isBusy = status === 'connecting' || status === 'loading';
  const runningTaskCount = React.useMemo(
    () => sftpTasks.filter((task) => task.status === 'running').length,
    [sftpTasks],
  );
  const queuedTaskCount = React.useMemo(() => sftpTasks.filter((task) => task.status === 'queued').length, [sftpTasks]);
  const activeTaskCount = runningTaskCount + queuedTaskCount;
  const hasVisibleTasks = sftpTasks.length > 0;
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
  const canUseFileActions = Boolean(sessionId) && status === 'ready' && !isBusy;
  const hasParentDirectoryListEntry = sftpShowParentDirectoryEntry;
  const canActivateParentDirectoryListEntry = Boolean(parentPath);

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
            mergeResolvedDirectoryIntoTree(previous, ancestorPath, cachedDirectory.path, cachedDirectory.entries),
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
            mergeResolvedDirectoryIntoTree(previous, ancestorPath, response.data.path, sortedEntries),
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
        mergeResolvedDirectoryIntoTree(previous, cacheEntry.path, cacheEntry.path, cacheEntry.entries),
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
          mergeResolvedDirectoryIntoTree(previous, directoryPath, response.data.path, sortedEntries),
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
          mergeResolvedDirectoryIntoTree(previous, directoryPath, cachedDirectory.path, cachedDirectory.entries),
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
          mergeResolvedDirectoryIntoTree(previous, directoryPath, response.data.path, sortedEntries),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : t('sftp.loadFailed');
        setTreeNodeLoading(directoryPath, false);
        notifyError(message);
      }
    },
    [notifyError, setTreeNodeLoading],
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
    if (isTaskQueueRunningRef.current) {
      return;
    }

    if (taskQueueRef.current.length === 0) {
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

  const renderSftpActionMenuItems = React.useCallback(
    ({
      contextEntry,
      menuSurface,
      scope,
      showShortcuts,
      targetDirectoryPath = currentPath,
    }: SftpActionMenuOptions): React.ReactNode => {
      const targetEntries = resolveActionTargetEntries(contextEntry, scope, selectedEntries, selectedPathSet);
      const targetEntry = targetEntries[0] ?? null;
      const isMultiTarget = targetEntries.length > 1;
      const isTreeDirectoryScope = scope === 'treeDirectory';
      const shouldShowEntryOpenActions = scope === 'entry' || scope === 'toolbarMore' || isTreeDirectoryScope;
      const shouldShowEntryMutationActions = scope === 'entry';
      const shouldShowCreateActions = scope === 'directory' || isTreeDirectoryScope;
      const shouldShowPasteAction = scope === 'directory' || isTreeDirectoryScope;
      const shouldShowRefreshAction = isTreeDirectoryScope;
      const shouldShowLocationActions =
        scope === 'entry' || scope === 'toolbarMore' || scope === 'directory' || isTreeDirectoryScope;
      const relativePathOptions = targetEntry ? buildRelativeRemotePathOptions(targetEntry.path) : [];
      const canOpenEntry = canUseFileActions && Boolean(targetEntry) && !isMultiTarget;
      const shouldShowOpenInNewTab = Boolean(targetEntry && !isMultiTarget && targetEntry.type === 'directory');
      const canOpenInNewTab = canUseFileActions && shouldShowOpenInNewTab;
      const canUseSingleEntryAction = canUseFileActions && Boolean(targetEntry) && !isMultiTarget;
      const canDownloadEntry = canUseSingleEntryAction && targetEntry?.type === 'file';
      const shouldShowOpenWithEntry = Boolean(
        targetEntry && !isMultiTarget && targetEntry.type === 'file' && canUseSftpOpenWith,
      );
      const canOpenWithEntry = canUseFileActions && shouldShowOpenWithEntry;
      const openWithApplications = targetEntry ? (openWithApplicationsByPath[targetEntry.path] ?? []) : [];
      const isLoadingOpenWithApplications = Boolean(targetEntry && loadingOpenWithPath === targetEntry.path);
      const canOpenSshHere = canUseFileActions && (!isMultiTarget || !targetEntry);
      const canMutateEntry = canUseFileActions && targetEntries.length > 0;
      const canRenameEntry = canMutateEntry && targetEntries.length === 1;
      const canPaste = canUseFileActions && Boolean(clipboardState);
      const canRefreshDirectory = canUseFileActions && Boolean(targetDirectoryPath);
      const shouldShowOpenSeparator =
        shouldShowLocationActions ||
        shouldShowEntryMutationActions ||
        shouldShowRefreshAction ||
        shouldShowPasteAction ||
        shouldShowCreateActions;
      const shouldShowCreateSeparator = (shouldShowPasteAction || shouldShowRefreshAction) && shouldShowCreateActions;

      const ShortcutComponent = menuSurface === 'context' ? ContextMenuShortcut : DropdownMenuShortcut;
      const ItemComponent = menuSurface === 'context' ? ContextMenuItem : DropdownMenuItem;
      const SeparatorComponent = menuSurface === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
      const SubComponent = menuSurface === 'context' ? ContextMenuSub : DropdownMenuSub;
      const SubContentComponent = menuSurface === 'context' ? ContextMenuSubContent : DropdownMenuSubContent;
      const SubTriggerComponent = menuSurface === 'context' ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
      const deleteShortcut = window.electron?.platform === 'darwin' ? 'Cmd+Backspace' : 'Del';

      return (
        <>
          {shouldShowEntryOpenActions ? (
            <>
              <ItemComponent
                icon={FolderOpen}
                disabled={!canOpenEntry}
                onSelect={() => {
                  if (targetEntry) {
                    void handleOpenEntry(targetEntry);
                  }
                }}
              >
                {t('sftp.actions.open')}
                {showShortcuts ? <ShortcutComponent>Enter</ShortcutComponent> : null}
              </ItemComponent>
              {shouldShowOpenInNewTab ? (
                <ItemComponent
                  icon={FolderOpen}
                  disabled={!canOpenInNewTab}
                  onSelect={() => {
                    if (targetEntry) {
                      handleOpenDirectoryInNewTab(targetEntry);
                    }
                  }}
                >
                  {t('sftp.actions.openInNewTab')}
                  {showShortcuts ? <ShortcutComponent>{shortcutModifier}+Enter</ShortcutComponent> : null}
                </ItemComponent>
              ) : null}
              {shouldShowOpenWithEntry && window.electron?.platform === 'win32' ? (
                <ItemComponent
                  disabled={!canOpenWithEntry}
                  onSelect={() => {
                    if (targetEntry) {
                      void handleOpenEntryWithPicker(targetEntry);
                    }
                  }}
                >
                  {t('sftp.actions.openWith')}
                </ItemComponent>
              ) : null}
              {shouldShowOpenWithEntry && window.electron?.platform === 'darwin' ? (
                <SubComponent>
                  <SubTriggerComponent
                    disabled={!canOpenWithEntry}
                    onPointerMove={() => {
                      if (targetEntry && openWithApplications.length === 0 && !isLoadingOpenWithApplications) {
                        void loadOpenWithApplications(targetEntry);
                      }
                    }}
                    onFocus={() => {
                      if (targetEntry && openWithApplications.length === 0 && !isLoadingOpenWithApplications) {
                        void loadOpenWithApplications(targetEntry);
                      }
                    }}
                  >
                    {t('sftp.actions.openWith')}
                  </SubTriggerComponent>
                  <SubContentComponent>
                    {isLoadingOpenWithApplications ? (
                      <ItemComponent disabled>{t('sftp.openWithLoading')}</ItemComponent>
                    ) : openWithApplications.length > 0 ? (
                      openWithApplications.map((application) => (
                        <ItemComponent
                          key={application.id}
                          onSelect={() => {
                            if (targetEntry) {
                              void handleOpenEntryWithApplication(targetEntry, application);
                            }
                          }}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <img
                              alt=""
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0"
                              src={application.iconDataUrl ?? SFTP_OPEN_WITH_APPLICATION_ICON_FALLBACK}
                            />
                            <span className="truncate">{application.name}</span>
                          </span>
                        </ItemComponent>
                      ))
                    ) : (
                      <ItemComponent disabled>{t('sftp.openWithNoApplications')}</ItemComponent>
                    )}
                  </SubContentComponent>
                </SubComponent>
              ) : null}
              {shouldShowOpenSeparator ? <SeparatorComponent /> : null}
            </>
          ) : null}
          {shouldShowLocationActions ? (
            <>
              <ItemComponent
                icon={Terminal}
                disabled={!canOpenSshHere}
                onSelect={() => {
                  handleOpenSshAtEntryLocation(targetEntry, targetDirectoryPath);
                }}
              >
                {t('sftp.actions.openSshHere')}
              </ItemComponent>
              {targetEntry ? (
                <>
                  <ItemComponent
                    icon={Copy}
                    disabled={!canUseSingleEntryAction}
                    onSelect={() => {
                      void handleCopyRemotePath(targetEntry);
                    }}
                  >
                    {t('sftp.actions.copyPath')}
                  </ItemComponent>
                  <SubComponent>
                    <SubTriggerComponent disabled={!canUseSingleEntryAction || relativePathOptions.length === 0}>
                      {t(
                        targetEntry.type === 'directory'
                          ? 'sftp.actions.copyDirectoryRelativePath'
                          : 'sftp.actions.copyFileRelativePath',
                      )}
                    </SubTriggerComponent>
                    <SubContentComponent>
                      {relativePathOptions.map((relativePath) => (
                        <ItemComponent
                          key={relativePath}
                          onSelect={() => {
                            void handleCopyRelativeRemotePath(relativePath);
                          }}
                        >
                          {relativePath}
                        </ItemComponent>
                      ))}
                    </SubContentComponent>
                  </SubComponent>
                  <ItemComponent
                    icon={Download}
                    disabled={!canDownloadEntry}
                    onSelect={() => {
                      if (targetEntry) {
                        void handleDownloadEntry(targetEntry, 'downloads');
                      }
                    }}
                  >
                    {t('sftp.actions.saveToDownloads')}
                  </ItemComponent>
                  <ItemComponent
                    disabled={!canDownloadEntry}
                    onSelect={() => {
                      if (targetEntry) {
                        void handleDownloadEntry(targetEntry, 'choose');
                      }
                    }}
                  >
                    {t('sftp.actions.saveAs')}
                  </ItemComponent>
                </>
              ) : null}
              {shouldShowEntryMutationActions ||
              shouldShowRefreshAction ||
              shouldShowPasteAction ||
              shouldShowCreateActions ? (
                <SeparatorComponent />
              ) : null}
            </>
          ) : null}
          {shouldShowEntryMutationActions ? (
            <>
              <ItemComponent
                icon={Scissors}
                disabled={!canMutateEntry}
                onSelect={() => {
                  handleCutEntries(targetEntries);
                }}
              >
                {t('sftp.actions.cut')}
                {showShortcuts ? <ShortcutComponent>{shortcutModifier}+X</ShortcutComponent> : null}
              </ItemComponent>
              <ItemComponent
                icon={Copy}
                disabled={!canMutateEntry}
                onSelect={() => {
                  handleCopyEntries(targetEntries);
                }}
              >
                {t('sftp.actions.copy')}
                {showShortcuts ? <ShortcutComponent>{shortcutModifier}+C</ShortcutComponent> : null}
              </ItemComponent>
              <ItemComponent
                icon={Edit3}
                disabled={!canRenameEntry}
                onSelect={() => {
                  if (targetEntry) {
                    runInlineEditMenuActionAfterClose(() => beginRenameEntry(targetEntry));
                  }
                }}
              >
                {t('sftp.actions.rename')}
                {showShortcuts ? <ShortcutComponent>F2</ShortcutComponent> : null}
              </ItemComponent>
              <ItemComponent
                icon={Trash2}
                disabled={!canMutateEntry}
                onSelect={() => {
                  void handleDeleteEntries(targetEntries);
                }}
              >
                {t('sftp.actions.delete')}
                {showShortcuts ? <ShortcutComponent>{deleteShortcut}</ShortcutComponent> : null}
              </ItemComponent>
              {shouldShowPasteAction || shouldShowCreateActions ? <SeparatorComponent /> : null}
            </>
          ) : null}
          {shouldShowRefreshAction ? (
            <ItemComponent
              icon={RefreshCcw}
              disabled={!canRefreshDirectory}
              onSelect={() => handleTreeDirectoryRefresh(targetDirectoryPath)}
            >
              {t('sftp.actions.refresh')}
            </ItemComponent>
          ) : null}
          {shouldShowPasteAction ? (
            <ItemComponent
              icon={Clipboard}
              disabled={!canPaste}
              onSelect={() => {
                void handlePasteEntry(targetDirectoryPath);
              }}
            >
              {t('sftp.actions.paste')}
              {showShortcuts ? <ShortcutComponent>{shortcutModifier}+V</ShortcutComponent> : null}
            </ItemComponent>
          ) : null}
          {shouldShowCreateActions ? (
            <>
              {shouldShowCreateSeparator ? <SeparatorComponent /> : null}
              <ItemComponent
                icon={FilePlus2}
                disabled={!canUseFileActions}
                onSelect={() => {
                  runInlineEditMenuActionAfterClose(() => beginCreateEntryInDirectory('file', targetDirectoryPath));
                }}
              >
                {t('sftp.actions.newFile')}
                {showShortcuts ? <ShortcutComponent>{shortcutModifier}+N</ShortcutComponent> : null}
              </ItemComponent>
              <ItemComponent
                icon={FolderPlus}
                disabled={!canUseFileActions}
                onSelect={() => {
                  runInlineEditMenuActionAfterClose(() =>
                    beginCreateEntryInDirectory('directory', targetDirectoryPath),
                  );
                }}
              >
                {t('sftp.actions.newFolder')}
                {showShortcuts ? <ShortcutComponent>{shortcutModifier}+Shift+N</ShortcutComponent> : null}
              </ItemComponent>
            </>
          ) : null}
        </>
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

  const handlePathSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void navigateToPath(pathInput);
    },
    [navigateToPath, pathInput],
  );

  const handleParentDirectory = React.useCallback((): void => {
    if (!parentPath) {
      return;
    }

    void navigateToPath(parentPath);
  }, [navigateToPath, parentPath]);

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

  const treeContent = React.useMemo(() => {
    const renderNode = (nodePath: string, depth: number): React.ReactNode => {
      const node = treeNodes[nodePath];
      if (!node) {
        return null;
      }

      const isCurrent = node.path === currentPath;
      const isExpandable = node.isLoading || node.children.length > 0 || !node.isLoaded;
      const treeContextEntry = resolveTreeDirectoryEntry(node);

      return (
        <React.Fragment key={node.path}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={classNames(
                  'group flex h-[30px] w-full items-center rounded-lg text-sm transition-colors hover:bg-home-card-hover',
                  isCurrent ? 'bg-home-card-hover' : '',
                )}
              >
                <div
                  className={classNames(
                    'flex min-w-0 flex-1 items-center',
                    depth > 0 ? resolveTreeIndentClassName(depth) : '',
                  )}
                >
                  <button
                    type="button"
                    aria-label={t(node.isExpanded ? 'sftp.actions.collapse' : 'sftp.actions.expand')}
                    className="focus-visible:ring-form-ring flex h-[30px] w-5 shrink-0 items-center justify-center rounded-sm-2 text-home-text-subtle focus-visible:outline-none focus-visible:ring-2"
                    disabled={node.isLoading}
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleTreeNodeToggle(node.path);
                    }}
                  >
                    {node.isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isExpandable ? (
                      <ChevronRight
                        className={classNames(
                          'h-3.5 w-3.5 transition-transform',
                          node.isExpanded && node.children.length > 0 ? 'rotate-90' : '',
                        )}
                      />
                    ) : (
                      <span className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    ref={(element) => {
                      treeRowRefs.current[node.path] = element;
                    }}
                    type="button"
                    className="focus-visible:ring-form-ring text-home-text flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-sm-2 pr-2 text-left focus-visible:outline-none focus-visible:ring-2"
                    tabIndex={resolvedActiveTreePath === node.path ? 0 : -1}
                    onClick={() => {
                      setActiveTreePath(node.path);
                      void navigateToPath(node.path);
                    }}
                    onFocus={() => setActiveTreePath(node.path)}
                    onKeyDown={(event) => handleTreeRowKeyDown(event, node.path)}
                  >
                    <Folder className="text-home-text h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{node.name}</span>
                  </button>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}>
              {renderSftpActionMenuItems({
                contextEntry: treeContextEntry,
                menuSurface: 'context',
                scope: 'treeDirectory',
                showShortcuts: false,
                targetDirectoryPath: node.path,
              })}
            </ContextMenuContent>
          </ContextMenu>
          {node.isExpanded ? node.children.map((childPath) => renderNode(childPath, depth + 1)) : null}
        </React.Fragment>
      );
    };

    return treeRootPaths.map((rootPath) => renderNode(rootPath, 0));
  }, [
    currentPath,
    handleInlineEditMenuCloseAutoFocus,
    handleTreeNodeToggle,
    handleTreeRowKeyDown,
    navigateToPath,
    renderSftpActionMenuItems,
    resolvedActiveTreePath,
    treeNodes,
    treeRootPaths,
  ]);

  const taskDropdown = hasVisibleTasks ? (
    <>
      <MenubarSeparator vertical />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={taskToolbarLabel}
                variant="ghost"
                className="h-[34px] gap-2 px-2.5"
              >
                {runningTaskCount > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTodo className="h-4 w-4" />}
                <span className="max-w-[92px] truncate text-sm">{t('sftp.tasks.toolbarTitle')}</span>
                <span className="text-home-text flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-home-chip-active px-1.5 text-xs">
                  {activeTaskCount > 0 ? activeTaskCount : sftpTasks.length}
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{taskToolbarLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          horizontalAlign="right"
          className="w-[320px]"
        >
          <DropdownMenuSlot className="px-2 py-2">
            <div className="flex h-7 items-center justify-between gap-3 px-1">
              <div className="text-sm font-medium text-header-text">{t('sftp.tasks.title')}</div>
              <div className="truncate text-xs text-header-text-muted">{taskToolbarLabel}</div>
            </div>
            <div
              role="status"
              aria-live="polite"
              className="divide-y divide-menu-divider"
            >
              {sortedSftpTasks.map((task) => {
                const isRunningTask = task.status === 'running';
                const progressLabel = formatSftpTaskProgressLabel(task.progress);
                const progressPercent =
                  task.progress && task.progress.total > 0
                    ? Math.min(100, Math.round((task.progress.completed / task.progress.total) * 100))
                    : undefined;

                return (
                  <div
                    key={task.id}
                    className="py-2 first:pt-1 last:pb-1"
                  >
                    <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5">
                      <span className="flex h-5 w-4 shrink-0 items-center justify-center text-header-text-muted">
                        {task.status === 'running' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : task.status === 'queued' ? (
                          <Hourglass className="h-3.5 w-3.5" />
                        ) : task.status === 'success' ? (
                          <CircleCheck className="h-3.5 w-3.5 text-header-text" />
                        ) : (
                          <CircleX className="h-3.5 w-3.5 text-form-message-error" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-header-text">{task.label}</div>
                        <div className="mt-0.5 truncate text-xs text-header-text-muted">{task.detail}</div>
                      </div>
                      <span className="shrink-0 self-start text-xs text-header-text-muted">
                        {t(`sftp.tasks.status.${task.status}`)}
                      </span>
                      <div className="col-span-2 col-start-2 flex items-center gap-2">
                        <div
                          role="progressbar"
                          aria-label={task.label}
                          aria-valuemin={task.progress ? 0 : undefined}
                          aria-valuemax={task.progress ? task.progress.total : undefined}
                          aria-valuenow={task.progress ? task.progress.completed : undefined}
                          className="h-1 flex-1 overflow-hidden rounded-sm-2 bg-menu-control-hover"
                        >
                          <div
                            className={classNames(
                              'h-full rounded-sm-2 bg-header-text transition-[width] duration-200',
                              isRunningTask && progressPercent === undefined ? 'w-1/2 animate-pulse' : '',
                            )}
                            style={progressPercent === undefined ? undefined : { width: `${progressPercent}%` }}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right text-xs text-header-text-muted">{progressLabel}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </DropdownMenuSlot>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ) : null;

  const toolbar = (
    <TooltipProvider>
      <Menubar className="w-full shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.back')}
                  variant="ghostIcon"
                  disabled={!canGoBack || isBusy}
                  onClick={() => {
                    void handleHistoryJump(navigationState.index - 1);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.back')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.forward')}
                  variant="ghostIcon"
                  disabled={!canGoForward || isBusy}
                  onClick={() => {
                    void handleHistoryJump(navigationState.index + 1);
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.forward')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.up')}
                  variant="ghostIcon"
                  disabled={!sessionId || !parentPath || isBusy}
                  onClick={handleParentDirectory}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.up')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.refresh')}
                  variant="ghostIcon"
                  disabled={!sessionId || isBusy}
                  onClick={handleRefresh}
                >
                  <RefreshCcw className={classNames('h-4 w-4', (isBusy || isRefreshingDirectory) && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.refresh')}</TooltipContent>
            </Tooltip>
          </div>

          <form
            className="mx-1 min-w-0 flex-1"
            onSubmit={handlePathSubmit}
          >
            <Input
              aria-label={t('sftp.pathInputLabel')}
              className="h-[34px] min-w-0 text-sm"
              disabled={!sessionId || isBusy}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
            />
          </form>

          {taskDropdown}

          <MenubarSeparator vertical />

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.cut')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSelection}
                  onClick={() => {
                    handleCutEntries(selectedEntries);
                  }}
                >
                  <Scissors className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.cut')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.copy')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSelection}
                  onClick={() => {
                    handleCopyEntries(selectedEntries);
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.copy')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.paste')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !clipboardState}
                  onClick={() => {
                    void handlePasteEntry();
                  }}
                >
                  <Clipboard className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.paste')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.newFile')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions}
                  onClick={() => beginCreateEntry('file')}
                >
                  <FilePlus2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.newFile')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.newFolder')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions}
                  onClick={() => beginCreateEntry('directory')}
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.newFolder')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.rename')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSingleSelection || !selectedEntry}
                  onClick={() => {
                    if (selectedEntry) {
                      beginRenameEntry(selectedEntry);
                    }
                  }}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.rename')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.delete')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSelection}
                  onClick={() => {
                    void handleDeleteEntries(selectedEntries);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.delete')}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={t('sftp.actions.more')}
                      variant="ghostIcon"
                      disabled={!sessionId || isBusy}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('sftp.actions.more')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                horizontalAlign="left"
                onCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}
              >
                {renderSftpActionMenuItems({
                  contextEntry: primarySelectedEntry,
                  menuSurface: 'dropdown',
                  scope: 'toolbarMore',
                  showShortcuts: true,
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="relative w-[220px] shrink-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-home-text-subtle" />
            <Input
              aria-label={t('sftp.actions.search')}
              className="h-[34px] pl-8 text-sm"
              disabled={!sessionId}
              placeholder={t('sftp.searchPlaceholder')}
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
            />
          </div>
        </div>
      </Menubar>
    </TooltipProvider>
  );

  const treePanel = (
    <aside className={SFTP_CARD_CLASS_NAME}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {status === 'connecting' && treeRootPaths.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-home-text-subtle">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('sftp.connecting')}
            </div>
          ) : (
            treeContent
          )}
        </div>
      </div>
    </aside>
  );

  const directoryPanel = (
    <main className={SFTP_CARD_CLASS_NAME}>
      {status === 'error' ? (
        <div className="flex h-full min-h-0 items-center justify-center px-6 text-center">
          <div className="flex max-w-[360px] flex-col items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-form-message-error" />
            <div className="text-home-text text-sm">{errorMessage || t('sftp.loadFailed')}</div>
            <Menubar>
              <Button
                variant="ghost"
                padding="mid"
                disabled={!sessionId}
                onClick={handleRefresh}
              >
                {t('sftp.actions.retry')}
              </Button>
            </Menubar>
          </div>
        </div>
      ) : status === 'connecting' || status === 'loading' ? (
        <div className="flex h-full min-h-0 items-center justify-center gap-2 px-6 text-center text-sm text-home-text-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === 'connecting' ? t('sftp.connecting') : t('sftp.loading')}
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="h-full min-h-0 overflow-auto">
              <div className={classNames('flex min-h-full flex-col', DIRECTORY_LIST_MIN_WIDTH_CLASS_NAME)}>
                <div
                  className={classNames(
                    'sticky top-0 z-10 grid h-[30px] shrink-0 items-center bg-ssh-card-bg-terminal px-3 text-xs font-medium text-home-text-subtle',
                    DIRECTORY_ROW_GRID_CLASS_NAME,
                  )}
                >
                  <span className="min-w-0 truncate">{t('sftp.columns.name')}</span>
                  <span className="min-w-0 truncate">{t('sftp.columns.size')}</span>
                  <span className="min-w-0 truncate">{t('sftp.columns.modified')}</span>
                  <span className="min-w-0 truncate">{t('sftp.columns.mode')}</span>
                  <span></span>
                </div>
                <div className="min-h-0 flex-1">
                  {status === 'idle' ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                      {t('sftp.noSession')}
                    </div>
                  ) : null}
                  {status === 'ready' && entries.length === 0 && !pendingCreate && !hasParentDirectoryListEntry ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                      {t('sftp.empty')}
                    </div>
                  ) : null}
                  {status === 'ready' &&
                  entries.length > 0 &&
                  visibleEntries.length === 0 &&
                  !hasParentDirectoryListEntry ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                      {t('sftp.searchEmpty')}
                    </div>
                  ) : null}
                  {status === 'ready' && hasParentDirectoryListEntry ? (
                    <div
                      ref={(element) => {
                        fileRowRefs.current[PARENT_DIRECTORY_ROW_KEY] = element;
                      }}
                      role="button"
                      aria-label={t('sftp.parentDirectoryEntryLabel')}
                      aria-disabled={!canActivateParentDirectoryListEntry}
                      tabIndex={
                        canActivateParentDirectoryListEntry && resolvedActiveFileRowKey === PARENT_DIRECTORY_ROW_KEY
                          ? 0
                          : -1
                      }
                      className={classNames(
                        'focus-visible:ring-form-ring grid h-[34px] w-full items-center rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
                        DIRECTORY_ROW_GRID_CLASS_NAME,
                        canActivateParentDirectoryListEntry
                          ? 'text-home-text hover:bg-home-card-hover'
                          : 'cursor-default text-home-text-subtle opacity-55',
                      )}
                      onDoubleClick={canActivateParentDirectoryListEntry ? handleParentDirectory : undefined}
                      onFocus={() => {
                        if (canActivateParentDirectoryListEntry) {
                          setActiveFileRowKey(PARENT_DIRECTORY_ROW_KEY);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (canActivateParentDirectoryListEntry) {
                          handleFileNavigationRowKeyDown(event, {
                            kind: 'parent',
                            key: PARENT_DIRECTORY_ROW_KEY,
                          });
                        }
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <Undo2
                          className={classNames(
                            'h-4 w-4 shrink-0',
                            canActivateParentDirectoryListEntry ? 'text-home-text' : 'text-home-text-subtle',
                          )}
                        />
                        <span className="truncate">..</span>
                      </span>
                      <span className="min-w-0 truncate text-xs text-home-text-subtle">-</span>
                      <span className="truncate text-xs text-home-text-subtle">-</span>
                      <span className="min-w-0 truncate font-mono text-xs text-home-text-subtle">-</span>
                      <span />
                    </div>
                  ) : null}
                  {pendingCreate ? (
                    <div
                      className={classNames(
                        'text-home-text grid h-[34px] w-full items-center rounded-lg bg-home-card-hover px-3 text-left text-sm',
                        DIRECTORY_ROW_GRID_CLASS_NAME,
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                        {pendingCreate.type === 'directory' ? (
                          <Folder className="text-home-text h-4 w-4 shrink-0" />
                        ) : (
                          <File className="text-home-text h-4 w-4 shrink-0" />
                        )}
                        <Input
                          ref={renameInputRef}
                          aria-label={t('sftp.renameInputLabel')}
                          className="h-[26px] min-w-0 flex-1 rounded-sm-2 px-0 text-sm"
                          value={renameInput}
                          onBlur={() => {
                            handleInlineEditInputBlur(commitPendingCreate);
                          }}
                          onChange={(event) => setRenameInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void commitPendingCreate();
                            }

                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelInlineEdit();
                            }
                          }}
                        />
                      </span>
                      <span className="min-w-0 truncate text-xs text-home-text-subtle">-</span>
                      <span className="truncate text-xs text-home-text-subtle">-</span>
                      <span className="min-w-0 truncate font-mono text-xs text-home-text-subtle">-</span>
                      <span />
                    </div>
                  ) : null}
                  {status === 'ready' && visibleEntries.length > 0
                    ? visibleEntries.map((entry, index) => {
                        const isSelected = selectedPathSet.has(entry.path);
                        const hasSelectedPreviousEntry =
                          isSelected && index > 0 && selectedPathSet.has(visibleEntries[index - 1]?.path ?? '');
                        const hasSelectedNextEntry =
                          isSelected &&
                          index < visibleEntries.length - 1 &&
                          selectedPathSet.has(visibleEntries[index + 1]?.path ?? '');
                        const isCut =
                          clipboardState?.mode === 'cut'
                            ? clipboardState.entries.some((clipboardEntry) => clipboardEntry.path === entry.path)
                            : false;

                        return (
                          <ContextMenu key={entry.path}>
                            <ContextMenuTrigger asChild>
                              <div
                                ref={(element) => {
                                  fileRowRefs.current[entry.path] = element;
                                }}
                                role="button"
                                aria-selected={isSelected}
                                tabIndex={resolvedActiveFileRowKey === entry.path ? 0 : -1}
                                className={classNames(
                                  'focus-visible:ring-form-ring grid h-[34px] w-full items-center px-3 text-left text-sm transition-colors hover:bg-home-card-hover focus-visible:outline-none focus-visible:ring-2',
                                  DIRECTORY_ROW_GRID_CLASS_NAME,
                                  hasSelectedPreviousEntry && hasSelectedNextEntry
                                    ? 'rounded-none'
                                    : hasSelectedPreviousEntry
                                      ? 'rounded-b-lg rounded-t-none'
                                      : hasSelectedNextEntry
                                        ? 'rounded-b-none rounded-t-lg'
                                        : 'rounded-lg',
                                  isSelected ? 'text-home-text bg-home-card-hover' : 'text-home-text',
                                  isCut ? 'opacity-55' : '',
                                )}
                                onClick={(event) => {
                                  setActiveFileRowKey(entry.path);
                                  handleEntrySelect(entry, event);
                                }}
                                onDoubleClick={() => handleEntryOpen(entry)}
                                onContextMenu={() => handleEntryContextMenu(entry)}
                                onFocus={() => setActiveFileRowKey(entry.path)}
                                onKeyDown={(event) => {
                                  handleFileNavigationRowKeyDown(event, {
                                    kind: 'entry',
                                    key: entry.path,
                                    entry,
                                  });
                                }}
                              >
                                <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                                  {resolveEntryIcon(entry)}
                                  {renamingEntryPath === entry.path ? (
                                    <Input
                                      ref={renameInputRef}
                                      aria-label={t('sftp.renameInputLabel')}
                                      className="h-[26px] min-w-0 flex-1 rounded-sm-2 px-0 text-sm"
                                      value={renameInput}
                                      onClick={(event) => event.stopPropagation()}
                                      onBlur={() => {
                                        handleInlineEditInputBlur(() => commitRenameEntry(entry));
                                      }}
                                      onChange={(event) => setRenameInput(event.target.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault();
                                          void commitRenameEntry(entry);
                                        }

                                        if (event.key === 'Escape') {
                                          event.preventDefault();
                                          cancelInlineEdit();
                                        }
                                      }}
                                    />
                                  ) : (
                                    <span className="truncate">{entry.name}</span>
                                  )}
                                </span>
                                <span className="min-w-0 truncate text-xs text-home-text-subtle">
                                  {entry.type === 'directory' ? '-' : formatFileSize(entry.size)}
                                </span>
                                <span className="truncate text-xs text-home-text-subtle">
                                  {formatModifiedAt(entry.modifiedAt)}
                                </span>
                                <span className="min-w-0 truncate font-mono text-xs text-home-text-subtle">
                                  {entry.permissions}
                                </span>
                                <Info className="h-3.5 w-3.5 shrink-0 justify-self-end text-home-text-subtle" />
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent onCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}>
                              {renderSftpActionMenuItems({
                                contextEntry: entry,
                                menuSurface: 'context',
                                scope: 'entry',
                                showShortcuts: true,
                              })}
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })
                    : null}
                </div>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent onCloseAutoFocus={handleInlineEditMenuCloseAutoFocus}>
            {renderSftpActionMenuItems({
              contextEntry: null,
              menuSurface: 'context',
              scope: 'directory',
              showShortcuts: true,
            })}
          </ContextMenuContent>
        </ContextMenu>
      )}
    </main>
  );

  const detailPanel = (
    <aside className={SFTP_CARD_CLASS_NAME}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[34px] shrink-0 items-center gap-2 px-2">
          <Info className="h-4 w-4 shrink-0 text-home-text-subtle" />
          <div className="text-home-text min-w-0 flex-1 truncate text-sm font-medium">
            {filePreview ? t('sftp.previewTitle') : t('sftp.detailTitle')}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {filePreview ? (
            <div className="flex h-full min-h-0 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <File className="text-home-text h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-home-text truncate text-sm font-medium">{filePreview.name}</div>
                  <div className="mt-0.5 text-xs text-home-text-subtle">
                    {formatFileSize(filePreview.size)}
                    {filePreview.truncated ? ` · ${t('sftp.previewTruncated')}` : ''}
                  </div>
                </div>
              </div>
              <pre className="bg-home-card/70 text-home-text min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-home-divider p-2 font-mono text-xs leading-5">
                {filePreview.content || t('sftp.previewEmpty')}
              </pre>
            </div>
          ) : selectedCount > 1 ? (
            <div className="flex h-full items-center justify-center px-3 text-center text-sm text-home-text-subtle">
              {t('sftp.detailSelectedMany', { count: selectedCount })}
            </div>
          ) : selectedEntry ? (
            <div className="space-y-4">
              <div className="flex min-w-0 items-center gap-2">
                {resolveEntryIcon(selectedEntry)}
                <div className="min-w-0">
                  <div className="text-home-text truncate text-sm font-medium">{selectedEntry.name}</div>
                  <div className="mt-0.5 text-xs text-home-text-subtle">
                    {t(`sftp.entryType.${selectedEntry.type}`)}
                  </div>
                </div>
              </div>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.path')}</dt>
                  <dd className="text-home-text mt-1 break-all font-mono text-xs">{selectedEntry.path}</dd>
                </div>
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.size')}</dt>
                  <dd className="text-home-text mt-1">{formatFileSize(selectedEntry.size)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.modified')}</dt>
                  <dd className="text-home-text mt-1">{formatModifiedAt(selectedEntry.modifiedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.permissions')}</dt>
                  <dd className="text-home-text mt-1 font-mono text-xs">{selectedEntry.permissions}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-sm text-home-text-subtle">
              {t('sftp.detailEmpty')}
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="flex h-full w-full flex-col gap-2.5 overflow-hidden">
        {toolbar}
        <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_minmax(240px,320px)] gap-2.5 overflow-hidden">
          {treePanel}
          {directoryPanel}
          {detailPanel}
        </div>
      </div>
      <Dialog
        open={Boolean(hostFingerprintPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            resolveHostFingerprintPrompt(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ssh.hostFingerprintDialogTitle')}</DialogTitle>
            <DialogDescription>{t('ssh.hostFingerprintDialogDescription')}</DialogDescription>
          </DialogHeader>
          {hostFingerprintPrompt ? (
            <div className="bg-home-card/70 space-y-2 rounded-lg border border-home-divider p-3 text-sm">
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogHost')}: </span>
                <span className="text-home-text font-medium">
                  {hostFingerprintPrompt.host}:{hostFingerprintPrompt.port}
                </span>
              </div>
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogAlgorithm')}: </span>
                <span className="text-home-text font-medium">{hostFingerprintPrompt.algorithm}</span>
              </div>
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogFingerprint')}: </span>
                <span className="text-home-text break-all font-mono text-xs">{hostFingerprintPrompt.fingerprint}</span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <DialogSecondaryButton onClick={() => resolveHostFingerprintPrompt(false)}>
              {t('ssh.hostFingerprintDialogCancel')}
            </DialogSecondaryButton>
            <DialogPrimaryButton onClick={() => resolveHostFingerprintPrompt(true)}>
              {t('ssh.hostFingerprintDialogTrustContinue')}
            </DialogPrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteConfirmationPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            resolveDeleteConfirmationPrompt(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sftp.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {deleteConfirmationPrompt?.entries.length === 1
                ? t('sftp.deleteConfirmDescription', { name: deleteConfirmationPrompt.entries[0]?.name ?? '' })
                : t('sftp.deleteConfirmDescriptionMany', {
                    count: deleteConfirmationPrompt?.entries.length ?? 0,
                  })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogSecondaryButton onClick={() => resolveDeleteConfirmationPrompt(false)}>
              {t('sftp.deleteConfirmCancel')}
            </DialogSecondaryButton>
            <DialogPrimaryButton onClick={() => resolveDeleteConfirmationPrompt(true)}>
              <Trash2 className="h-4 w-4" />
              {t('sftp.deleteConfirmAccept')}
            </DialogPrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SFTP;
