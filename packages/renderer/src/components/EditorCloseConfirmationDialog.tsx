import React from 'react';

import { t } from '../lib/i18n';
import {
  AlertDialog,
  AlertDialogActionButton,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

type EditorCloseConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/**
 * Confirms that the user intends to discard an editor's unsaved settings.
 *
 * @param props Controlled confirmation state and close callbacks.
 * @returns Shared unsaved-settings confirmation dialog.
 */
const EditorCloseConfirmationDialog: React.FC<EditorCloseConfirmationDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
}) => {
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('editorCloseConfirmation.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('editorCloseConfirmation.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancelButton autoFocus>{t('editorCloseConfirmation.cancel')}</AlertDialogCancelButton>
          <AlertDialogActionButton onClick={onConfirm}>{t('editorCloseConfirmation.confirm')}</AlertDialogActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default EditorCloseConfirmationDialog;
