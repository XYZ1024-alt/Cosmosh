import { Trash2 } from 'lucide-react';
import React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from '../../components/ui/dialog';
import { t } from '../../lib/i18n';
import type { HostFingerprintPrompt, SftpDeleteConfirmationPrompt } from './sftp-types';

/**
 * Props for the SFTP host fingerprint trust dialog.
 */
type SftpHostFingerprintDialogProps = {
  prompt: HostFingerprintPrompt | null;
  onResolve: (accepted: boolean) => void;
};

/**
 * Props for the SFTP delete confirmation dialog.
 */
type SftpDeleteConfirmationDialogProps = {
  prompt: SftpDeleteConfirmationPrompt | null;
  onResolve: (accepted: boolean) => void;
};

/**
 * Shows the SSH host fingerprint trust prompt used during SFTP connection setup.
 *
 * @param props Prompt state and resolver.
 * @returns Host fingerprint dialog.
 */
export const SftpHostFingerprintDialog: React.FC<SftpHostFingerprintDialogProps> = ({ prompt, onResolve }) => {
  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) {
          onResolve(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ssh.hostFingerprintDialogTitle')}</DialogTitle>
          <DialogDescription>{t('ssh.hostFingerprintDialogDescription')}</DialogDescription>
        </DialogHeader>
        {prompt ? (
          <div className="bg-home-card/70 space-y-2 rounded-lg border border-home-divider p-3 text-sm">
            <div>
              <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogHost')}: </span>
              <span className="text-home-text font-medium">
                {prompt.host}:{prompt.port}
              </span>
            </div>
            <div>
              <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogAlgorithm')}: </span>
              <span className="text-home-text font-medium">{prompt.algorithm}</span>
            </div>
            <div>
              <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogFingerprint')}: </span>
              <span className="text-home-text break-all font-mono text-xs">{prompt.fingerprint}</span>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <DialogSecondaryButton onClick={() => onResolve(false)}>
            {t('ssh.hostFingerprintDialogCancel')}
          </DialogSecondaryButton>
          <DialogPrimaryButton onClick={() => onResolve(true)}>
            {t('ssh.hostFingerprintDialogTrustContinue')}
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Shows the destructive-action confirmation prompt for SFTP delete operations.
 *
 * @param props Prompt state and resolver.
 * @returns Delete confirmation dialog.
 */
export const SftpDeleteConfirmationDialog: React.FC<SftpDeleteConfirmationDialogProps> = ({ prompt, onResolve }) => {
  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) {
          onResolve(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sftp.deleteConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {prompt?.entries.length === 1
              ? t('sftp.deleteConfirmDescription', { name: prompt.entries[0]?.name ?? '' })
              : t('sftp.deleteConfirmDescriptionMany', {
                  count: prompt?.entries.length ?? 0,
                })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogSecondaryButton onClick={() => onResolve(false)}>
            {t('sftp.deleteConfirmCancel')}
          </DialogSecondaryButton>
          <DialogPrimaryButton onClick={() => onResolve(true)}>
            <Trash2 className="h-4 w-4" />
            {t('sftp.deleteConfirmAccept')}
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
