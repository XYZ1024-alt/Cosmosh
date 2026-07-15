import React from 'react';

import { t } from '../lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from './ui/dialog';

type CloseWindowConfirmationDialogProps = {
  open: boolean;
  onResolve: (confirmed: boolean) => void;
};

/**
 * Presents the renderer-owned warning used before closing active SSH/SFTP sessions.
 *
 * @param props Controlled dialog state and confirmation callback.
 * @returns Close-window confirmation dialog.
 */
const CloseWindowConfirmationDialog: React.FC<CloseWindowConfirmationDialogProps> = ({ open, onResolve }) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onResolve(false);
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('closeWindowConfirmation.title')}</DialogTitle>
          <DialogDescription>{t('closeWindowConfirmation.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogSecondaryButton
            autoFocus
            onClick={() => onResolve(false)}
          >
            {t('closeWindowConfirmation.cancel')}
          </DialogSecondaryButton>
          <DialogPrimaryButton onClick={() => onResolve(true)}>
            {t('closeWindowConfirmation.confirm')}
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CloseWindowConfirmationDialog;
