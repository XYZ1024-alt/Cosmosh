import type { ApiSftpEntry } from '@cosmosh/api-contract';
import type React from 'react';

export type { SftpOpenWithApplication } from '@cosmosh/api-contract';

/**
 * SSH host fingerprint prompt captured while an SFTP session is connecting.
 */
export type HostFingerprintPrompt = {
  serverId: string;
  host: string;
  port: number;
  algorithm: 'sha256';
  fingerprint: string;
};

/**
 * Options that control how a directory load updates current browser state.
 */
export type DirectoryLoadOptions = {
  forceRefresh?: boolean;
  preserveCurrentView?: boolean;
  isCancelled?: () => boolean;
};

/**
 * Cached directory payload keyed by requested and resolved remote paths.
 */
export type DirectoryCacheEntry = {
  path: string;
  parentPath?: string;
  entries: ApiSftpEntry[];
};

/**
 * Left tree node state for one remote directory.
 */
export type TreeDirectoryNode = {
  path: string;
  name: string;
  parentPath?: string;
  isHidden: boolean;
  children: string[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
};

/**
 * Top-level SFTP tab status.
 */
export type SftpConnectionStatus = 'idle' | 'connecting' | 'loading' | 'ready' | 'error';

/**
 * Browser-like history state for one SFTP tab.
 */
export type NavigationState = {
  paths: string[];
  index: number;
};

/**
 * Direction used by SFTP history menus.
 */
export type NavigationHistoryDirection = 'back' | 'forward';

/**
 * One direct jump target in the SFTP history menu.
 */
export type NavigationHistoryMenuItem = {
  path: string;
  index: number;
};

/**
 * One item in the compact SFTP address breadcrumb chain.
 */
export type SftpBreadcrumbItem = {
  label: string;
  path: string;
};

/**
 * Render grouping for the compact breadcrumb address bar.
 */
export type AddressBreadcrumbRenderState = {
  leadingItem?: SftpBreadcrumbItem;
  hiddenItems: SftpBreadcrumbItem[];
  visibleItems: SftpBreadcrumbItem[];
};

/**
 * Props used by one toolbar history button.
 */
export type NavigationHistoryControlOptions = {
  label: string;
  icon: React.ReactNode;
  items: NavigationHistoryMenuItem[];
  disabled: boolean;
  onStep: () => void;
};

/**
 * In-memory SFTP clipboard used for copy/move batch operations.
 */
export type ClipboardState = {
  mode: 'copy' | 'cut';
  entries: ApiSftpEntry[];
};

/**
 * Preview renderer category supported by the SFTP auxiliary sidebar.
 */
export type SftpPreviewType = 'text' | 'image';

/**
 * Confirmation prompt state for previews that exceed automatic open thresholds.
 */
export type SftpLargePreviewPrompt = {
  entry: ApiSftpEntry;
  previewType: SftpPreviewType;
  thresholdBytes: number;
};

/**
 * Editor-backed text preview state for one remote file.
 */
export type SftpPreviewTextState = {
  status: 'text';
  entry: ApiSftpEntry;
  content: string;
  savedContent: string;
  language: string;
  remoteSnapshot: SftpOpenedFileRemoteSnapshot;
  isSaving: boolean;
};

/**
 * Image preview state backed by a renderer-managed temporary local file.
 */
export type SftpPreviewImageState = {
  status: 'image';
  entry: ApiSftpEntry;
  localPath: string;
  sourceDataUrl: string;
};

/**
 * Complete SFTP preview lifecycle state shown in the auxiliary sidebar.
 */
export type SftpPreviewState =
  | {
      status: 'loading';
      entry: ApiSftpEntry;
      previewType: SftpPreviewType;
    }
  | {
      status: 'large-file';
      prompt: SftpLargePreviewPrompt;
    }
  | SftpPreviewTextState
  | SftpPreviewImageState
  | {
      status: 'unsupported';
      entry: ApiSftpEntry | null;
    }
  | {
      status: 'error';
      entry: ApiSftpEntry | null;
      message: string;
    };

/**
 * Pending inline create row state.
 */
export type PendingCreateState = {
  type: 'file' | 'directory';
  name: string;
};

/**
 * Shared action menu placement and target options.
 */
export type SftpActionMenuOptions = {
  contextEntry: ApiSftpEntry | null;
  menuSurface: 'context' | 'dropdown';
  scope: 'entry' | 'directory' | 'toolbarMore' | 'treeDirectory';
  showShortcuts: boolean;
  targetDirectoryPath?: string;
};

/**
 * Platform selection modifier snapshot used by SFTP row selection logic.
 */
export type SftpSelectionModifierEvent = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

/**
 * Mouse modifier snapshot used by SFTP row click selection.
 */
export type SftpSelectionClickEvent = SftpSelectionModifierEvent;

/**
 * Source surface used to decide whether delete confirmation is required.
 */
export type SftpDeleteInvocationSource = 'action' | 'shortcut';

/**
 * Delete confirmation prompt state.
 */
export type SftpDeleteConfirmationPrompt = {
  entries: ApiSftpEntry[];
  source: SftpDeleteInvocationSource;
};

/**
 * Remote snapshot captured when a regular file is opened into a local temp file.
 */
export type SftpOpenedFileRemoteSnapshot = {
  size: number;
  modifiedAt: string;
};

/**
 * Watched local temp file created by an SFTP Open/Open With action.
 */
export type SftpWatchedOpenFile = {
  remotePath: string;
  name: string;
  localPath: string;
  watchId: string;
  openedSessionId: string;
  remoteSnapshot: SftpOpenedFileRemoteSnapshot;
  pendingChange?: {
    size: number;
    modifiedAt: string;
  };
  isPromptOpen: boolean;
};

/**
 * Prompt state for uploading a modified local temp file back to SFTP.
 */
export type SftpUploadConfirmationPrompt = {
  remotePath: string;
  name: string;
  localPath: string;
  size: number;
  modifiedAt: string;
};

/**
 * Prompt state for explicitly overwriting a remote file that changed after opening.
 */
export type SftpUploadConflictConfirmationPrompt = SftpUploadConfirmationPrompt;

/**
 * Deferred inline edit action run after Radix menu focus handoff settles.
 */
export type InlineEditMenuAction = () => void | Promise<void>;

/**
 * Renderer-local lifecycle state for one queued SFTP operation.
 */
export type SftpTaskStatus = 'queued' | 'running' | 'success' | 'failed';

/**
 * Coarse task progress shown in the SFTP toolbar task list.
 */
export type SftpTaskProgress = {
  completed: number;
  total: number;
};

/**
 * Tab-scoped task list item for renderer-managed SFTP operations.
 */
export type SftpTaskState = {
  id: string;
  label: string;
  detail: string;
  status: SftpTaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: SftpTaskProgress;
};

/**
 * User-visible metadata captured when an SFTP task is queued.
 */
export type SftpTaskOptions = {
  label: string;
  detail?: string;
  progress?: SftpTaskProgress;
};

/**
 * Runtime helpers passed to a queued SFTP task implementation.
 */
export type SftpTaskContext = {
  taskId: string;
  isCurrent: () => boolean;
  update: (patch: Partial<Pick<SftpTaskState, 'detail' | 'progress'>>) => void;
};

/**
 * Internal queue entry for serialized renderer SFTP operations.
 */
export type SftpQueuedTask = {
  id: string;
  run: () => Promise<void>;
};

/**
 * Keyboard focus row model for the directory list.
 */
export type SftpFileNavigationRow =
  | {
      kind: 'parent';
      key: string;
    }
  | {
      kind: 'entry';
      key: string;
      entry: ApiSftpEntry;
    };
