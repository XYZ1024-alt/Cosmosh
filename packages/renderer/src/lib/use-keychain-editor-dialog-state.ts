import React from 'react';

import type { KeychainEditorInitialFormState, SshKeychainListItem } from './ssh-keychain-editor-shared';

type UseKeychainEditorDialogStateParams = {
  keychains: SshKeychainListItem[];
  onKeychainNotFound: () => void;
};

type UseKeychainEditorDialogStateResult = {
  isKeychainEditorDialogOpen: boolean;
  activeKeychainEditorId: string | null;
  keychainEditorInitialFormState?: KeychainEditorInitialFormState;
  openCreateKeychainDialog: (initialFormState?: KeychainEditorInitialFormState) => void;
  openEditKeychainDialog: (keychainId: string) => void;
  closeKeychainEditorDialog: () => void;
};

/**
 * Centralizes create/edit keychain dialog state transitions for pages that embed the server editor form.
 *
 * @param params Hook parameters.
 * @param params.keychains Current keychain list used for edit-target validation.
 * @param params.onKeychainNotFound Callback fired when an edit target cannot be found.
 * @returns Dialog state values and handlers.
 */
export const useKeychainEditorDialogState = ({
  keychains,
  onKeychainNotFound,
}: UseKeychainEditorDialogStateParams): UseKeychainEditorDialogStateResult => {
  const [isKeychainEditorDialogOpen, setIsKeychainEditorDialogOpen] = React.useState<boolean>(false);
  const [activeKeychainEditorId, setActiveKeychainEditorId] = React.useState<string | null>(null);
  const [keychainEditorInitialFormState, setKeychainEditorInitialFormState] =
    React.useState<KeychainEditorInitialFormState>();

  const openCreateKeychainDialog = React.useCallback((initialFormState?: KeychainEditorInitialFormState) => {
    setActiveKeychainEditorId(null);
    setKeychainEditorInitialFormState(initialFormState);
    setIsKeychainEditorDialogOpen(true);
  }, []);

  const openEditKeychainDialog = React.useCallback(
    (keychainId: string) => {
      const targetKeychain = keychains.find((item) => item.id === keychainId);
      if (!targetKeychain) {
        onKeychainNotFound();
        return;
      }

      setActiveKeychainEditorId(keychainId);
      setKeychainEditorInitialFormState(undefined);
      setIsKeychainEditorDialogOpen(true);
    },
    [keychains, onKeychainNotFound],
  );

  const closeKeychainEditorDialog = React.useCallback(() => {
    /**
     * Keep edit target intact until dialog exit animation completes.
     */
    setIsKeychainEditorDialogOpen(false);
  }, []);

  return {
    isKeychainEditorDialogOpen,
    activeKeychainEditorId,
    keychainEditorInitialFormState,
    openCreateKeychainDialog,
    openEditKeychainDialog,
    closeKeychainEditorDialog,
  };
};
