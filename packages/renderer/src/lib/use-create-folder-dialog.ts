import type { components } from '@cosmosh/api-contract';
import React from 'react';

import { EntityVisual, pickRandomEntityVisual } from './entity-visuals';
import { createFolder, normalizeFolderName } from './folder-actions';
import { t } from './i18n';
import { useToast } from './toast-context';

type SshFolder = components['schemas']['SshFolder'];

type OpenCreateFolderOptions = {
  selectOnCreate?: boolean;
};

type UseCreateFolderDialogOptions = {
  onCreated?: (folder: SshFolder, options: OpenCreateFolderOptions) => Promise<void> | void;
};

const createInitialFolderVisual = (): EntityVisual => {
  return pickRandomEntityVisual('folder', `${Date.now()}:${Math.random()}`);
};

/**
 * Shared folder-creation dialog state and submit logic used by Home and SSH editor.
 */
export const useCreateFolderDialog = (options: UseCreateFolderDialogOptions = {}) => {
  const { error: notifyError, warning: notifyWarning } = useToast();
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [folderName, setFolderName] = React.useState<string>('');
  const [folderVisual, setFolderVisual] = React.useState<EntityVisual>(() => createInitialFolderVisual());
  const openOptionsRef = React.useRef<OpenCreateFolderOptions>({});

  const openCreateFolderDialog = React.useCallback((openOptions?: OpenCreateFolderOptions) => {
    openOptionsRef.current = openOptions ?? {};
    setFolderName('');
    setFolderVisual(createInitialFolderVisual());
    setIsOpen(true);
  }, []);

  const onOpenChange = React.useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      openOptionsRef.current = {};
      setFolderName('');
    }
  }, []);

  const submitCreateFolder = React.useCallback(async () => {
    const normalizedFolderName = normalizeFolderName(folderName);
    if (!normalizedFolderName) {
      notifyWarning(t('home.folderNameRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const createdFolder = await createFolder({
        name: normalizedFolderName,
        iconKey: folderVisual.iconKey,
        colorKey: folderVisual.colorKey,
      });

      setIsOpen(false);
      setFolderName('');
      await options.onCreated?.(createdFolder, openOptionsRef.current);
      openOptionsRef.current = {};
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('home.folderCreateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [folderName, folderVisual.colorKey, folderVisual.iconKey, notifyError, notifyWarning, options]);

  return {
    isOpen,
    isSubmitting,
    folderName,
    folderVisual,
    openCreateFolderDialog,
    onOpenChange,
    setFolderName,
    setFolderVisual,
    submitCreateFolder,
  };
};
