import type { components } from '@cosmosh/api-contract';
import { FileUp, RefreshCcw } from 'lucide-react';
import React from 'react';

import { listSshFolders, listSshKeychains, listSshTags } from '../../lib/backend';
import { t } from '../../lib/i18n';
import { createKeychainEditorTag, saveKeychainFromEditor } from '../../lib/ssh-keychain-editor-actions';
import {
  applyInitialKeychainEditorFormState,
  applySubmittedCredentialsToCache,
  deriveKeychainEditorCredentialMode,
  filterSharedKeychains,
  type KeychainCredentialCache,
  type KeychainEditorInitialFormState,
  type KeychainFormState,
  mapKeychainToFormState,
  mergeKeychainFormStatePreservingDirtyFields,
  type SshKeychainListItem,
  upsertKeychainListItem,
} from '../../lib/ssh-keychain-editor-shared';
import { createPrivateKeyImportContextMenuItems, importPrivateKeyFromFile } from '../../lib/ssh-private-key-import';
import { useToast } from '../../lib/toast-context';
import { useCreateFolderDialog } from '../../lib/use-create-folder-dialog';
import { useKeychainCredentialsRefresh } from '../../lib/use-server-credentials';
import CreateFolderDialog from '../home/CreateFolderDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from '../ui/dialog';
import type { InputContextMenuItem } from '../ui/input-context-menu-registry';
import SSHKeychainEditorForm from './SSHKeychainEditorForm';

type SshFolder = components['schemas']['SshFolder'];
type SshTag = components['schemas']['SshTag'];

type SSHKeychainEditorDialogProps = {
  open: boolean;
  keychainId: string | null;
  initialFormState?: KeychainEditorInitialFormState;
  onOpenChange: (open: boolean) => void;
  onSaved: (keychain: SshKeychainListItem) => Promise<void> | void;
};

const SSHKeychainEditorDialog: React.FC<SSHKeychainEditorDialogProps> = ({
  open,
  keychainId,
  initialFormState,
  onOpenChange,
  onSaved,
}) => {
  const { error: notifyError, success: notifySuccess, warning: notifyWarning } = useToast();
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [tags, setTags] = React.useState<SshTag[]>([]);
  const [keychains, setKeychains] = React.useState<SshKeychainListItem[]>([]);
  const [editorFolders, setEditorFolders] = React.useState<SshFolder[]>([]);
  const [formState, setFormState] = React.useState<KeychainFormState>(() =>
    applyInitialKeychainEditorFormState(initialFormState),
  );

  const initialFormStateRef = React.useRef<KeychainEditorInitialFormState | undefined>(initialFormState);
  const stableKeychainIdRef = React.useRef<string | null>(keychainId);
  const initializedEditorTargetRef = React.useRef<string | undefined>(undefined);
  const dirtyFieldKeysRef = React.useRef<Set<keyof KeychainFormState>>(new Set());
  const credentialsCacheRef = React.useRef<Record<string, KeychainCredentialCache>>({});
  const displayKeychainId = open ? keychainId : stableKeychainIdRef.current;

  React.useEffect(() => {
    if (!open) {
      return;
    }

    stableKeychainIdRef.current = keychainId;
  }, [keychainId, open]);

  React.useEffect(() => {
    initialFormStateRef.current = initialFormState;
  }, [initialFormState]);

  const resetDirtyFieldKeys = React.useCallback(() => {
    dirtyFieldKeysRef.current = new Set();
  }, []);

  const activeKeychain = React.useMemo(() => {
    if (!displayKeychainId) {
      return null;
    }

    return keychains.find((item) => item.id === displayKeychainId) ?? null;
  }, [displayKeychainId, keychains]);

  React.useEffect(() => {
    if (!open) {
      initializedEditorTargetRef.current = undefined;
      return;
    }

    /**
     * During one open session, keep user edits stable.
     * Parent re-renders should not reset form values unless edit target changes.
     */
    const currentTargetKey = keychainId ?? '__create__';
    if (initializedEditorTargetRef.current === currentTargetKey) {
      return;
    }
    initializedEditorTargetRef.current = currentTargetKey;

    let cancelled = false;

    const loadReferences = async () => {
      setIsLoading(true);
      try {
        const [keychainsResponse, foldersResponse, tagsResponse] = await Promise.all([
          listSshKeychains(),
          listSshFolders(),
          listSshTags(),
        ]);
        if (cancelled) {
          return;
        }

        const nextKeychains = filterSharedKeychains(keychainsResponse.data.items);
        setKeychains(nextKeychains);
        setEditorFolders(foldersResponse.data.items);
        setTags(tagsResponse.data.items);

        if (keychainId) {
          const targetKeychain = nextKeychains.find((item) => item.id === keychainId);
          if (!targetKeychain) {
            notifyWarning(t('ssh.validationKeychainNotFound'));
            onOpenChange(false);
            return;
          }

          resetDirtyFieldKeys();
          setFormState({
            ...mapKeychainToFormState(targetKeychain),
            ...(credentialsCacheRef.current[keychainId] ?? {}),
          });
          return;
        }

        resetDirtyFieldKeys();
        setFormState(applyInitialKeychainEditorFormState(initialFormStateRef.current));
      } catch (error: unknown) {
        if (!cancelled) {
          notifyError(error instanceof Error ? error.message : t('sshKeychain.loadFailed'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadReferences();

    return () => {
      cancelled = true;
    };
  }, [keychainId, notifyError, notifyWarning, onOpenChange, open, resetDirtyFieldKeys]);

  const { refreshKeychainCredentials } = useKeychainCredentialsRefresh({
    enabled: open && Boolean(displayKeychainId),
    keychainId: displayKeychainId,
    onCredentialsLoaded: (nextCredentials) => {
      if (!displayKeychainId) {
        return;
      }

      credentialsCacheRef.current[displayKeychainId] = nextCredentials;
      setFormState((previous) => {
        if (stableKeychainIdRef.current !== displayKeychainId) {
          return previous;
        }

        return mergeKeychainFormStatePreservingDirtyFields(
          previous,
          { ...previous, ...nextCredentials },
          dirtyFieldKeysRef.current,
        );
      });
    },
    onLoadFailed: () => {
      notifyError(t('sshKeychain.loadCredentialsFailed'));
    },
  });

  /**
   * Re-fetches keychain credentials after save to guarantee cache/state match persisted backend values.
   *
   * @param savedKeychainId The saved keychain id.
   * @returns Resolves once refresh handling is finished.
   */
  const refreshKeychainCredentialsAfterSave = React.useCallback(
    async (savedKeychainId: string): Promise<void> => {
      await refreshKeychainCredentials(savedKeychainId, {
        onCredentialsLoaded: (nextCredentials) => {
          credentialsCacheRef.current[savedKeychainId] = nextCredentials;
          if (displayKeychainId === savedKeychainId) {
            setFormState((previous) => ({
              ...previous,
              ...nextCredentials,
            }));
          }
        },
        onLoadFailed: () => {
          notifyWarning(t('sshKeychain.loadCredentialsFailed'));
        },
      });
    },
    [displayKeychainId, notifyWarning, refreshKeychainCredentials],
  );

  const { requiresPassword, requiresPrivateKey } = React.useMemo(() => {
    return deriveKeychainEditorCredentialMode(formState.authType);
  }, [formState.authType]);

  const createFolderDialog = useCreateFolderDialog({
    onCreated: (createdFolder, options) => {
      setEditorFolders((previous) => {
        if (previous.some((folder) => folder.id === createdFolder.id)) {
          return previous;
        }

        return [...previous, createdFolder];
      });

      if (options.selectOnCreate) {
        onChangeForm('folderId', createdFolder.id);
      }
    },
  });

  const onChangeForm = React.useCallback(<K extends keyof KeychainFormState>(key: K, value: KeychainFormState[K]) => {
    dirtyFieldKeysRef.current.add(key);
    setFormState((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  const onCreateTag = React.useCallback(
    async (name: string): Promise<SshTag | null> => {
      return createKeychainEditorTag({
        name,
        tags,
        onTagCreated: (createdTag) => {
          setTags((previous) => [...previous, createdTag]);
        },
        onError: notifyError,
        createTagFailedMessage: t('sshKeychain.createTagFailed'),
      });
    },
    [notifyError, tags],
  );

  const importKeychainPrivateKeyFromFile = React.useCallback(async () => {
    const importedKey = await importPrivateKeyFromFile({
      onSuccess: notifySuccess,
      onError: notifyError,
      importSuccessMessage: t('ssh.privateKeyImportSuccess'),
      importFailedMessage: t('ssh.privateKeyImportFailed'),
    });

    if (importedKey) {
      onChangeForm('privateKey', importedKey.content);
    }
  }, [notifyError, notifySuccess, onChangeForm]);

  const privateKeyContextMenuItems = React.useMemo<InputContextMenuItem[]>(() => {
    return createPrivateKeyImportContextMenuItems({
      icon: FileUp,
      label: t('ssh.privateKeyImportAction'),
      onImport: importKeychainPrivateKeyFromFile,
    });
  }, [importKeychainPrivateKeyFromFile]);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      setIsSubmitting(true);
      try {
        const saveResult = await saveKeychainFromEditor({
          keychainId: displayKeychainId,
          activeKeychain,
          formState,
          requiresPassword,
          requiresPrivateKey,
          onWarning: notifyWarning,
          validationRequiredFieldsMessage: t('ssh.validationRequiredFields'),
          validationPasswordRequiredMessage: t('ssh.validationPasswordRequired'),
          validationPrivateKeyRequiredMessage: t('ssh.validationPrivateKeyRequired'),
        });
        if (!saveResult) {
          return;
        }

        const previousCredentials = displayKeychainId ? credentialsCacheRef.current[displayKeychainId] : undefined;
        credentialsCacheRef.current[saveResult.savedKeychain.id] = applySubmittedCredentialsToCache(
          previousCredentials,
          saveResult.submittedCredentialPayload,
        );

        await refreshKeychainCredentialsAfterSave(saveResult.savedKeychain.id);
        setKeychains((previous) => upsertKeychainListItem(previous, saveResult.savedKeychain));
        await onSaved(saveResult.savedKeychain);
        notifySuccess(t('sshKeychain.saveSuccess'));
        onOpenChange(false);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('sshKeychain.saveFailed'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeKeychain,
      displayKeychainId,
      formState,
      notifyError,
      notifySuccess,
      notifyWarning,
      onOpenChange,
      onSaved,
      refreshKeychainCredentialsAfterSave,
      requiresPassword,
      requiresPrivateKey,
    ],
  );

  const isFormDisabled = isLoading || isSubmitting;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && isSubmitting) {
            return;
          }

          onOpenChange(nextOpen);
        }}
      >
        <DialogContent
          showCloseButton={!isSubmitting}
          className="max-h-[92vh] !max-w-4xl gap-0 p-0"
        >
          <DialogHeader className="px-2.5">
            <DialogTitle>{displayKeychainId ? t('home.contextEdit') : t('sshKeychain.newKeychain')}</DialogTitle>
            <DialogDescription className="sr-only">{t('sshKeychain.editorDialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(92vh-136px)] overflow-auto">
            <SSHKeychainEditorForm
              formId="home-ssh-keychain-form"
              formState={formState}
              activeKeychain={activeKeychain}
              isSubmitting={isFormDisabled}
              requiresPassword={requiresPassword}
              requiresPrivateKey={requiresPrivateKey}
              folders={editorFolders}
              tags={tags}
              privateKeyContextMenuItems={privateKeyContextMenuItems}
              onSubmit={(event) => {
                void onSubmit(event);
              }}
              onCreateFolder={(options) => {
                createFolderDialog.openCreateFolderDialog(options);
              }}
              onCreateTag={onCreateTag}
              onChangeForm={onChangeForm}
            />
          </div>

          <DialogFooter className="border-t border-dialog-border">
            <DialogSecondaryButton
              disabled={isFormDisabled}
              onClick={() => onOpenChange(false)}
            >
              {t('home.actionCancel')}
            </DialogSecondaryButton>
            <DialogPrimaryButton
              type="submit"
              form="home-ssh-keychain-form"
              disabled={isFormDisabled}
            >
              {isSubmitting ? (
                <RefreshCcw
                  size={16}
                  className="animate-spin"
                />
              ) : null}
              {isSubmitting ? t('ssh.saving') : t('sshKeychain.saveAction')}
            </DialogPrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateFolderDialog
        open={createFolderDialog.isOpen}
        folderName={createFolderDialog.folderName}
        visual={createFolderDialog.folderVisual}
        isSubmitting={createFolderDialog.isSubmitting}
        onOpenChange={createFolderDialog.onOpenChange}
        onExitComplete={createFolderDialog.onExitComplete}
        onFolderNameChange={createFolderDialog.setFolderName}
        onVisualChange={createFolderDialog.setFolderVisual}
        onSubmit={() => {
          void createFolderDialog.submitCreateFolder();
        }}
      />
    </>
  );
};

export default SSHKeychainEditorDialog;
