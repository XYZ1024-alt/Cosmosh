import type { ApiSftpEntry } from '@cosmosh/api-contract';
import type React from 'react';

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
 * Text preview state for a downloaded remote file.
 */
export type FilePreviewState = {
  path: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
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
 * Mouse modifier snapshot used by SFTP row selection logic.
 */
export type SftpSelectionClickEvent = Pick<React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>;

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
 * Deferred inline edit action run after Radix menu focus handoff settles.
 */
export type InlineEditMenuAction = () => void | Promise<void>;

/**
 * Native application candidate for platform Open With menus.
 */
export type SftpOpenWithApplication = {
  id: string;
  name: string;
  path: string;
  bundleIdentifier?: string;
  iconDataUrl?: string;
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
