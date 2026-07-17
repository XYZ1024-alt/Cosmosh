import { AlertTriangle, Trash2, Upload } from 'lucide-react';
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
import { useDialogExitSnapshot } from '../../components/ui/dialog-lifecycle';
import { t } from '../../lib/i18n';
import type {
  HostFingerprintPrompt,
  SftpDeleteConfirmationPrompt,
  SftpUploadConfirmationPrompt,
  SftpUploadConflictConfirmationPrompt,
} from './sftp-types';

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
 * Props for the SFTP opened-file upload confirmation dialog.
 */
type SftpUploadConfirmationDialogProps = {
  prompt: SftpUploadConfirmationPrompt | null;
  onResolve: (accepted: boolean) => void;
};

/**
 * Props for the SFTP upload conflict overwrite confirmation dialog.
 */
type SftpUploadConflictConfirmationDialogProps = {
  prompt: SftpUploadConflictConfirmationPrompt | null;
  onResolve: (accepted: boolean) => void;
};

/**
 * Shows the SSH host fingerprint trust prompt used during SFTP connection setup.
 *
 * @param props Prompt state and resolver.
 * @returns Host fingerprint dialog.
 */
export const SftpHostFingerprintDialog: React.FC<SftpHostFingerprintDialogProps> = ({ prompt, onResolve }) => {
  const [exitPrompt, clearExitPrompt] = useDialogExitSnapshot(prompt);

  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) {
          onResolve(false);
        }
      }}
    >
      <DialogContent onExitComplete={clearExitPrompt}>
        <DialogHeader>
          <DialogTitle>{t('ssh.hostFingerprintDialogTitle')}</DialogTitle>
          <DialogDescription>{t('ssh.hostFingerprintDialogDescription')}</DialogDescription>
        </DialogHeader>
        {exitPrompt ? (
          <div className="bg-home-card/70 space-y-2 rounded-lg border border-home-divider p-3 text-sm">
            <div>
              <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogHost')}: </span>
              <span className="text-home-text font-medium">
                {exitPrompt.host}:{exitPrompt.port}
              </span>
            </div>
            <div>
              <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogAlgorithm')}: </span>
              <span className="text-home-text font-medium">{exitPrompt.algorithm}</span>
            </div>
            <div>
              <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogFingerprint')}: </span>
              <span className="text-home-text break-all font-mono text-xs">{exitPrompt.fingerprint}</span>
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
  const [exitPrompt, clearExitPrompt] = useDialogExitSnapshot(prompt);

  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) {
          onResolve(false);
        }
      }}
    >
      <DialogContent onExitComplete={clearExitPrompt}>
        <DialogHeader>
          <DialogTitle>{t('sftp.deleteConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {exitPrompt?.entries.length === 1
              ? t('sftp.deleteConfirmDescription', { name: exitPrompt.entries[0]?.name ?? '' })
              : t('sftp.deleteConfirmDescriptionMany', {
                  count: exitPrompt?.entries.length ?? 0,
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

/**
 * Shows the upload prompt when an externally opened SFTP temp file changes locally.
 *
 * @param props Prompt state and resolver.
 * @returns Upload confirmation dialog.
 */
export const SftpUploadConfirmationDialog: React.FC<SftpUploadConfirmationDialogProps> = ({ prompt, onResolve }) => {
  const [exitPrompt, clearExitPrompt] = useDialogExitSnapshot(prompt);

  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) {
          onResolve(false);
        }
      }}
    >
      <DialogContent onExitComplete={clearExitPrompt}>
        <DialogHeader>
          <DialogTitle>{t('sftp.uploadConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('sftp.uploadConfirmDescription', {
              name: exitPrompt?.name ?? '',
              path: exitPrompt?.remotePath ?? '',
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogSecondaryButton onClick={() => onResolve(false)}>
            {t('sftp.uploadConfirmIgnore')}
          </DialogSecondaryButton>
          <DialogPrimaryButton onClick={() => onResolve(true)}>
            <Upload className="h-4 w-4" />
            {t('sftp.uploadConfirmAccept')}
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Shows the overwrite prompt when the remote file changed after the temp file was opened.
 *
 * @param props Prompt state and resolver.
 * @returns Upload conflict confirmation dialog.
 */
export const SftpUploadConflictConfirmationDialog: React.FC<SftpUploadConflictConfirmationDialogProps> = ({
  prompt,
  onResolve,
}) => {
  const [exitPrompt, clearExitPrompt] = useDialogExitSnapshot(prompt);

  return (
    <Dialog
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) {
          onResolve(false);
        }
      }}
    >
      <DialogContent onExitComplete={clearExitPrompt}>
        <DialogHeader>
          <DialogTitle>{t('sftp.uploadConflictTitle')}</DialogTitle>
          <DialogDescription>
            {t('sftp.uploadConflictDescription', {
              name: exitPrompt?.name ?? '',
              path: exitPrompt?.remotePath ?? '',
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogSecondaryButton onClick={() => onResolve(false)}>
            {t('sftp.uploadConflictCancel')}
          </DialogSecondaryButton>
          <DialogPrimaryButton onClick={() => onResolve(true)}>
            <AlertTriangle className="h-4 w-4" />
            {t('sftp.uploadConflictOverwrite')}
          </DialogPrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
