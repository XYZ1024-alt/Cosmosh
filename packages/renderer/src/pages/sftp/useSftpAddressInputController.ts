import React from 'react';

import type { InputContextMenuItem } from '../../components/ui/input-context-menu-registry';
import { t } from '../../lib/i18n';

/**
 * Inputs for the SFTP address input controller.
 */
type UseSftpAddressInputControllerParams = {
  currentPath: string;
  sftpShowAddressAsText: boolean;
  navigateToPath: (directoryPath: string) => Promise<boolean>;
  setSftpAddressDisplayMode: (showAddressAsText: boolean) => Promise<void>;
};

/**
 * Address bar state and handlers consumed by the SFTP toolbar.
 */
type UseSftpAddressInputControllerResult = {
  addressInputContextMenuItems: InputContextMenuItem[];
  addressInputRef: React.RefObject<HTMLInputElement | null>;
  isAddressInputEditing: boolean;
  pathInput: string;
  keepAddressInputDuringContextMenu: () => void;
  handleAddressInputPointerDown: (event: React.PointerEvent<HTMLInputElement>) => void;
  handleEditCurrentPath: () => void;
  handlePathInputBlur: () => void;
  handlePathInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handlePathSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  handleShowAddressAsText: () => void;
  setPathInput: React.Dispatch<React.SetStateAction<string>>;
};

/**
 * Owns editable address state, focus retention, and address display-mode toggling.
 *
 * @param params Current path, settings state, and navigation helpers.
 * @returns Address input state and event handlers.
 */
export const useSftpAddressInputController = ({
  currentPath,
  sftpShowAddressAsText,
  navigateToPath,
  setSftpAddressDisplayMode,
}: UseSftpAddressInputControllerParams): UseSftpAddressInputControllerResult => {
  const [pathInput, setPathInput] = React.useState<string>('.');
  const [isAddressInputEditing, setIsAddressInputEditing] = React.useState(false);
  const addressInputRef = React.useRef<HTMLInputElement | null>(null);
  const shouldRetainAddressInputAfterContextMenuRef = React.useRef(false);
  const addressInputContextMenuTimerRef = React.useRef<number | null>(null);

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

  const handleShowAddressAsText = React.useCallback((): void => {
    setIsAddressInputEditing(true);
    void setSftpAddressDisplayMode(true);
  }, [setSftpAddressDisplayMode]);

  return {
    addressInputContextMenuItems,
    addressInputRef,
    isAddressInputEditing,
    pathInput,
    keepAddressInputDuringContextMenu,
    handleAddressInputPointerDown,
    handleEditCurrentPath,
    handlePathInputBlur,
    handlePathInputKeyDown,
    handlePathSubmit,
    handleShowAddressAsText,
    setPathInput,
  };
};
