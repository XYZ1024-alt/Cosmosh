import type { ApiSftpEntry } from '@cosmosh/api-contract';
import React from 'react';

import { isEditableKeyboardEventTarget } from './sftp-page-utils';
import type { ClipboardState, SftpDeleteInvocationSource } from './sftp-types';

/**
 * Inputs for SFTP page-level keyboard shortcuts.
 */
type UseSftpKeyboardShortcutsParams = {
  beginCreateEntry: (type: 'file' | 'directory') => void;
  beginRenameEntry: (entry: ApiSftpEntry) => void;
  canUseFileActions: boolean;
  clearPreviewState: () => boolean;
  clipboardState: ClipboardState | null;
  handleCopyEntries: (targetEntries: ApiSftpEntry[]) => void;
  handleCutEntries: (targetEntries: ApiSftpEntry[]) => void;
  handleDeleteEntries: (targetEntries: ApiSftpEntry[], source?: SftpDeleteInvocationSource) => Promise<void>;
  handleOpenDirectoryInNewTab: (entry: ApiSftpEntry) => void;
  handleOpenEntry: (entry: ApiSftpEntry) => Promise<void>;
  handlePasteEntry: () => Promise<void>;
  hasSelection: boolean;
  selectedEntries: ApiSftpEntry[];
  selectedEntry: ApiSftpEntry | null;
  setSelectedPaths: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectionAnchorPath: React.Dispatch<React.SetStateAction<string>>;
  visibleEntries: ApiSftpEntry[];
};

/**
 * Registers SFTP page-level file-manager shortcuts.
 *
 * @param params Current selection state and shortcut handlers.
 * @returns void.
 */
export const useSftpKeyboardShortcuts = ({
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
  selectedEntries,
  selectedEntry,
  setSelectedPaths,
  setSelectionAnchorPath,
  visibleEntries,
}: UseSftpKeyboardShortcutsParams): void => {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableKeyboardEventTarget(event.target) || !canUseFileActions) {
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
    setSelectedPaths,
    setSelectionAnchorPath,
    visibleEntries,
  ]);
};
