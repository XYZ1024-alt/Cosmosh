import React from 'react';

type UseEditorCloseGuardOptions = {
  open: boolean;
  hasUnsavedChanges: boolean;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
};

type EditorCloseGuard = {
  isConfirmationOpen: boolean;
  onConfirmationOpenChange: (open: boolean) => void;
  requestOpenChange: (open: boolean) => void;
  confirmClose: () => void;
};

/**
 * Guards editor close requests while allowing successful saves to close through
 * the original controlled callback.
 *
 * @param options Controlled editor state and close callback.
 * @returns Close-request handlers and confirmation state for the editor.
 */
export const useEditorCloseGuard = ({
  open,
  hasUnsavedChanges,
  isSubmitting,
  onOpenChange,
}: UseEditorCloseGuardOptions): EditorCloseGuard => {
  const [isConfirmationOpen, setIsConfirmationOpen] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!open) {
      setIsConfirmationOpen(false);
    }
  }, [open]);

  const requestOpenChange = React.useCallback(
    (nextOpen: boolean): void => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      if (isSubmitting) {
        return;
      }

      if (hasUnsavedChanges) {
        setIsConfirmationOpen(true);
        return;
      }

      onOpenChange(false);
    },
    [hasUnsavedChanges, isSubmitting, onOpenChange],
  );

  const confirmClose = React.useCallback((): void => {
    setIsConfirmationOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  return {
    isConfirmationOpen,
    onConfirmationOpenChange: setIsConfirmationOpen,
    requestOpenChange,
    confirmClose,
  };
};
