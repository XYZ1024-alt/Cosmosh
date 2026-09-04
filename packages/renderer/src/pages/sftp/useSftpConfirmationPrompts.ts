import type { ApiSftpEntry } from '@cosmosh/api-contract';
import React from 'react';

import type {
  HostFingerprintPrompt,
  SftpDeleteConfirmationPrompt,
  SftpDeleteInvocationSource,
  SftpUploadConfirmationPrompt,
  SftpUploadConflictConfirmationPrompt,
} from './sftp-types';

/**
 * Prompt state and resolvers used by the SFTP page shell.
 */
type UseSftpConfirmationPromptsResult = {
  hostFingerprintPrompt: HostFingerprintPrompt | null;
  deleteConfirmationPrompt: SftpDeleteConfirmationPrompt | null;
  uploadConfirmationPrompt: SftpUploadConfirmationPrompt | null;
  uploadConflictConfirmationPrompt: SftpUploadConflictConfirmationPrompt | null;
  setUploadConfirmationPrompt: React.Dispatch<React.SetStateAction<SftpUploadConfirmationPrompt | null>>;
  requestHostFingerprintTrust: (prompt: HostFingerprintPrompt) => Promise<boolean>;
  resolveHostFingerprintPrompt: (accepted: boolean) => void;
  requestDeleteConfirmation: (entriesToDelete: ApiSftpEntry[], source: SftpDeleteInvocationSource) => Promise<boolean>;
  resolveDeleteConfirmationPrompt: (accepted: boolean) => void;
  requestUploadConflictConfirmation: (prompt: SftpUploadConflictConfirmationPrompt) => Promise<boolean>;
  resolveUploadConflictConfirmationPrompt: (accepted: boolean) => void;
  cancelUploadConflictConfirmationPrompt: () => void;
};

type QueuedUploadConflictConfirmation = {
  prompt: SftpUploadConflictConfirmationPrompt;
  resolve: (accepted: boolean) => void;
};

/**
 * Owns SFTP confirmation dialogs and the promise resolvers that unblock operations.
 *
 * @returns Prompt state plus request/resolve helpers for each confirmation flow.
 */
export const useSftpConfirmationPrompts = (): UseSftpConfirmationPromptsResult => {
  const [hostFingerprintPrompt, setHostFingerprintPrompt] = React.useState<HostFingerprintPrompt | null>(null);
  const [deleteConfirmationPrompt, setDeleteConfirmationPrompt] = React.useState<SftpDeleteConfirmationPrompt | null>(
    null,
  );
  const [uploadConfirmationPrompt, setUploadConfirmationPrompt] = React.useState<SftpUploadConfirmationPrompt | null>(
    null,
  );
  const [uploadConflictConfirmationPrompt, setUploadConflictConfirmationPrompt] =
    React.useState<SftpUploadConflictConfirmationPrompt | null>(null);
  const pendingPromptResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const pendingDeleteConfirmationResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const pendingUploadConflictResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const pendingUploadConflictQueueRef = React.useRef<QueuedUploadConflictConfirmation[]>([]);

  const requestHostFingerprintTrust = React.useCallback((prompt: HostFingerprintPrompt): Promise<boolean> => {
    return new Promise((resolve) => {
      pendingPromptResolverRef.current = resolve;
      setHostFingerprintPrompt(prompt);
    });
  }, []);

  const resolveHostFingerprintPrompt = React.useCallback((accepted: boolean): void => {
    pendingPromptResolverRef.current?.(accepted);
    pendingPromptResolverRef.current = null;
    setHostFingerprintPrompt(null);
  }, []);

  const requestDeleteConfirmation = React.useCallback(
    (entriesToDelete: ApiSftpEntry[], source: SftpDeleteInvocationSource): Promise<boolean> => {
      return new Promise((resolve) => {
        pendingDeleteConfirmationResolverRef.current = resolve;
        setDeleteConfirmationPrompt({ entries: entriesToDelete, source });
      });
    },
    [],
  );

  const resolveDeleteConfirmationPrompt = React.useCallback((accepted: boolean): void => {
    pendingDeleteConfirmationResolverRef.current?.(accepted);
    pendingDeleteConfirmationResolverRef.current = null;
    setDeleteConfirmationPrompt(null);
  }, []);

  const activateNextUploadConflictPrompt = React.useCallback((): void => {
    if (pendingUploadConflictResolverRef.current) {
      return;
    }

    const next = pendingUploadConflictQueueRef.current.shift();
    if (!next) {
      setUploadConflictConfirmationPrompt(null);
      return;
    }

    pendingUploadConflictResolverRef.current = next.resolve;
    setUploadConflictConfirmationPrompt(next.prompt);
  }, []);

  const requestUploadConflictConfirmation = React.useCallback(
    (prompt: SftpUploadConflictConfirmationPrompt): Promise<boolean> => {
      return new Promise((resolve) => {
        pendingUploadConflictQueueRef.current.push({ prompt, resolve });
        activateNextUploadConflictPrompt();
      });
    },
    [activateNextUploadConflictPrompt],
  );

  const resolveUploadConflictConfirmationPrompt = React.useCallback(
    (accepted: boolean): void => {
      pendingUploadConflictResolverRef.current?.(accepted);
      pendingUploadConflictResolverRef.current = null;
      activateNextUploadConflictPrompt();
    },
    [activateNextUploadConflictPrompt],
  );

  const cancelUploadConflictConfirmationPrompt = React.useCallback((): void => {
    pendingUploadConflictResolverRef.current?.(false);
    pendingUploadConflictResolverRef.current = null;
    pendingUploadConflictQueueRef.current.forEach(({ resolve }) => resolve(false));
    pendingUploadConflictQueueRef.current = [];
    setUploadConflictConfirmationPrompt(null);
  }, []);

  return {
    hostFingerprintPrompt,
    deleteConfirmationPrompt,
    uploadConfirmationPrompt,
    uploadConflictConfirmationPrompt,
    setUploadConfirmationPrompt,
    requestHostFingerprintTrust,
    resolveHostFingerprintPrompt,
    requestDeleteConfirmation,
    resolveDeleteConfirmationPrompt,
    requestUploadConflictConfirmation,
    resolveUploadConflictConfirmationPrompt,
    cancelUploadConflictConfirmationPrompt,
  };
};
