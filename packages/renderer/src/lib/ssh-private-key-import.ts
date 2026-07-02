import type { InputContextMenuItem } from '../components/ui/input-context-menu-registry';

export type ImportedPrivateKeyFile = {
  fileName: string;
  content: string;
};

type ImportPrivateKeyFromFileParams = {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  importSuccessMessage: string;
  importFailedMessage: string;
};

type CreatePrivateKeyImportContextMenuItemsParams = {
  icon: InputContextMenuItem['icon'];
  label: string;
  onImport: () => void | Promise<void>;
};

/**
 * Derives a user-facing private-key name from an imported file name.
 *
 * @param fileName Imported private-key file name.
 * @returns File name without the final extension segment.
 */
export const derivePrivateKeyNameFromFileName = (fileName: string): string => {
  const trimmedFileName = fileName.trim();
  const finalDotIndex = trimmedFileName.lastIndexOf('.');

  if (finalDotIndex <= 0) {
    return trimmedFileName;
  }

  return trimmedFileName.slice(0, finalDotIndex);
};

/**
 * Imports one private-key file through the secure Electron bridge.
 *
 * @param params Import notification parameters.
 * @param params.onSuccess Success notifier callback.
 * @param params.onError Error notifier callback.
 * @param params.importSuccessMessage Localized success message.
 * @param params.importFailedMessage Localized failure message.
 * @returns Imported file metadata and content, or null when the picker is canceled.
 */
export const importPrivateKeyFromFile = async ({
  onSuccess,
  onError,
  importSuccessMessage,
  importFailedMessage,
}: ImportPrivateKeyFromFileParams): Promise<ImportedPrivateKeyFile | null> => {
  try {
    const result = await window.electron?.importPrivateKeyFromFile?.();
    if (!result || result.canceled) {
      return null;
    }

    if (typeof result.content !== 'string') {
      onError(importFailedMessage);
      return null;
    }

    onSuccess(importSuccessMessage);
    return {
      fileName: typeof result.fileName === 'string' ? result.fileName : '',
      content: result.content,
    };
  } catch (error: unknown) {
    onError(error instanceof Error ? error.message : importFailedMessage);
    return null;
  }
};

/**
 * Builds the shared textarea context-menu entry for private-key import.
 *
 * @param params Context-menu configuration.
 * @param params.icon Icon shown next to the import action.
 * @param params.label Localized action label.
 * @param params.onImport Callback that runs the import flow.
 * @returns Context-menu items for private-key textareas.
 */
export const createPrivateKeyImportContextMenuItems = ({
  icon,
  label,
  onImport,
}: CreatePrivateKeyImportContextMenuItemsParams): InputContextMenuItem[] => [
  {
    key: 'import-private-key',
    label,
    icon,
    onSelect: () => {
      void onImport();
    },
  },
];
