import type { components } from '@cosmosh/api-contract';
import { FileUp, RefreshCcw } from 'lucide-react';
import React from 'react';

import { createSshServer, listSshKeychains, listSshTags, updateSshServer } from '../../lib/backend';
import { isEntityColorKey } from '../../lib/entity-visuals';
import { t } from '../../lib/i18n';
import {
  createServerEditorTag,
  importServerEditorPrivateKeyFromFile,
  saveInlineCredentialsToSharedKeychain as saveInlineCredentialsToSharedKeychainAction,
} from '../../lib/ssh-server-editor-actions';
import {
  applySubmittedCredentialsToCache,
  createInitialServerFormState,
  deriveServerEditorCredentialMode,
  mapServerToFormState,
  parsePort,
  type ServerCredentialCache,
  type ServerEditorFormState,
  type SshServerListItem,
} from '../../lib/ssh-server-editor-shared';
import { useToast } from '../../lib/toast-context';
import { useCreateFolderDialog } from '../../lib/use-create-folder-dialog';
import { useKeychainCredentials, useServerCredentialsRefresh } from '../../lib/use-server-credentials';
import CreateFolderDialog from '../home/CreateFolderDialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from '../ui/dialog';
import type { InputContextMenuItem } from '../ui/input-context-menu-registry';
import SSHServerEditorForm, {
  SSH_SERVER_ADD_KEYCHAIN_SELECT_VALUE,
  SSH_SERVER_INLINE_KEYCHAIN_SELECT_VALUE,
} from './SSHServerEditorForm';

type SshFolder = components['schemas']['SshFolder'];
type SshTag = components['schemas']['SshTag'];
type SshKeychainListItem = components['schemas']['SshKeychainListItem'];

type SSHServerEditorDialogProps = {
  open: boolean;
  serverId: string | null;
  initialFolderId?: string;
  servers: SshServerListItem[];
  folders: SshFolder[];
  defaultServerNoteTemplate: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
};

const SSHServerEditorDialog: React.FC<SSHServerEditorDialogProps> = ({
  open,
  serverId,
  initialFolderId,
  servers,
  folders,
  defaultServerNoteTemplate,
  onOpenChange,
  onSaved,
}) => {
  const { error: notifyError, success: notifySuccess, warning: notifyWarning } = useToast();
  const [tags, setTags] = React.useState<SshTag[]>([]);
  const [keychains, setKeychains] = React.useState<SshKeychainListItem[]>([]);
  const [editorFolders, setEditorFolders] = React.useState<SshFolder[]>(folders);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [formState, setFormState] = React.useState<ServerEditorFormState>(() =>
    createInitialServerFormState(defaultServerNoteTemplate),
  );
  const stableServerIdRef = React.useRef<string | null>(serverId);
  const initializedEditorTargetRef = React.useRef<string | null | undefined>(undefined);
  const formStateRef = React.useRef<ServerEditorFormState>(formState);
  const credentialsCacheRef = React.useRef<Record<string, ServerCredentialCache>>({});
  const displayServerId = open ? serverId : stableServerIdRef.current;

  React.useEffect(() => {
    if (!open) {
      return;
    }

    stableServerIdRef.current = serverId;
  }, [open, serverId]);

  const activeServer = React.useMemo(() => {
    if (!displayServerId) {
      return null;
    }

    return servers.find((server) => server.id === displayServerId) ?? null;
  }, [displayServerId, servers]);

  React.useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  React.useEffect(() => {
    if (!open) {
      initializedEditorTargetRef.current = undefined;
      return;
    }

    /**
     * During one open session, keep user edits stable.
     * Parent list refreshes (servers/folders) may happen while the dialog is open
     * or closing, and should not rehydrate the form unless the edit target changes.
     */
    if (initializedEditorTargetRef.current === serverId) {
      return;
    }
    initializedEditorTargetRef.current = serverId;

    setEditorFolders(folders);

    if (serverId) {
      const targetServer = servers.find((server) => server.id === serverId);
      if (!targetServer) {
        notifyWarning(t('ssh.validationServerNotFound'));
        onOpenChange(false);
        return;
      }

      setFormState({
        ...mapServerToFormState(targetServer),
        ...(credentialsCacheRef.current[serverId] ?? {}),
      });
      return;
    }

    const nextFormState = createInitialServerFormState(defaultServerNoteTemplate);
    if (initialFolderId) {
      nextFormState.folderId = initialFolderId;
    }
    setFormState(nextFormState);
  }, [defaultServerNoteTemplate, folders, initialFolderId, notifyWarning, onOpenChange, open, serverId, servers]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const loadReferences = async () => {
      try {
        const [tagsResponse, keychainsResponse] = await Promise.all([listSshTags(), listSshKeychains()]);
        if (cancelled) {
          return;
        }

        setTags(tagsResponse.data.items);
        setKeychains(keychainsResponse.data.items);
      } catch (error: unknown) {
        if (!cancelled) {
          notifyError(error instanceof Error ? error.message : t('ssh.editorLoadFailed'));
        }
      }
    };

    void loadReferences();

    return () => {
      cancelled = true;
    };
  }, [notifyError, open]);

  const { refreshServerCredentials } = useServerCredentialsRefresh({
    enabled: open,
    serverId,
    onCredentialsLoaded: (nextCredentials) => {
      if (!serverId) {
        return;
      }

      credentialsCacheRef.current[serverId] = nextCredentials;
      setFormState((previous) => ({
        ...previous,
        ...nextCredentials,
      }));
    },
    onLoadFailed: () => {
      notifyError(t('ssh.credentialsLoadFailed'));
    },
  });

  useKeychainCredentials({
    enabled: open,
    keychainId: formState.keychainId || null,
    onCredentialsLoaded: (nextCredentials) => {
      setFormState((previous) => ({
        ...previous,
        ...nextCredentials,
      }));
    },
    onLoadFailed: () => {
      notifyError(t('ssh.credentialsLoadFailed'));
    },
  });

  const { sharedKeychains, isUsingInlineCredentials, requiresPassword, requiresPrivateKey } = React.useMemo(() => {
    return deriveServerEditorCredentialMode({
      keychainId: formState.keychainId,
      keychains,
      authType: formState.authType,
    });
  }, [formState.authType, formState.keychainId, keychains]);

  const keychainSelectValue = isUsingInlineCredentials ? SSH_SERVER_INLINE_KEYCHAIN_SELECT_VALUE : formState.keychainId;

  const createFolderDialog = useCreateFolderDialog({
    onCreated: (createdFolder, options) => {
      setEditorFolders((previous) => {
        if (previous.some((folder) => folder.id === createdFolder.id)) {
          return previous;
        }

        return [...previous, createdFolder];
      });

      if (options.selectOnCreate) {
        setFormState((previous) => ({
          ...previous,
          folderId: createdFolder.id,
        }));
      }
    },
  });

  const onChangeForm = React.useCallback(
    <K extends keyof ServerEditorFormState>(key: K, value: ServerEditorFormState[K]) => {
      setFormState((previous) => ({
        ...previous,
        [key]: value,
      }));
    },
    [],
  );

  const onHostChange = React.useCallback(
    (nextHost: string) => {
      onChangeForm('host', nextHost);

      if (!serverId && !formStateRef.current.name.trim()) {
        onChangeForm('name', nextHost);
      }
    },
    [onChangeForm, serverId],
  );

  const onCreateTag = React.useCallback(
    async (name: string): Promise<SshTag | null> => {
      return createServerEditorTag({
        name,
        tags,
        onTagCreated: (createdTag) => {
          setTags((previous) => [...previous, createdTag]);
        },
        onError: notifyError,
        createTagFailedMessage: t('ssh.createTagFailed'),
      });
    },
    [notifyError, tags],
  );

  const importPrivateKeyFromFile = React.useCallback(async () => {
    await importServerEditorPrivateKeyFromFile({
      onPrivateKeyImported: (privateKey) => {
        onChangeForm('privateKey', privateKey);
      },
      onSuccess: notifySuccess,
      onError: notifyError,
      importSuccessMessage: t('ssh.privateKeyImportSuccess'),
      importFailedMessage: t('ssh.privateKeyImportFailed'),
    });
  }, [notifyError, notifySuccess, onChangeForm]);

  const privateKeyContextMenuItems = React.useMemo<InputContextMenuItem[]>(() => {
    return [
      {
        key: 'import-private-key',
        label: t('ssh.privateKeyImportAction'),
        icon: FileUp,
        onSelect: () => {
          void importPrivateKeyFromFile();
        },
      },
    ];
  }, [importPrivateKeyFromFile]);

  const openSelectedKeychainEditor = React.useCallback(() => {
    notifyWarning(t('ssh.keychainEditComingSoon'));
  }, [notifyWarning]);

  const saveInlineCredentialsToSharedKeychain = React.useCallback(async () => {
    await saveInlineCredentialsToSharedKeychainAction({
      isUsingInlineCredentials,
      formState,
      setIsSubmitting,
      onKeychainCreated: (createdKeychain) => {
        setKeychains((previous) => [...previous, createdKeychain]);
        setFormState((previous) => ({
          ...previous,
          keychainId: createdKeychain.id,
        }));
      },
      onWarning: notifyWarning,
      onSuccess: notifySuccess,
      onError: notifyError,
      validationRequiredFieldsMessage: t('ssh.validationRequiredFields'),
      validationPasswordRequiredMessage: t('ssh.validationPasswordRequired'),
      validationPrivateKeyRequiredMessage: t('ssh.validationPrivateKeyRequired'),
      saveSuccessMessage: t('ssh.saveInlineCredentialsToKeychainSuccess'),
      saveFailedMessage: t('ssh.saveInlineCredentialsToKeychainFailed'),
    });
  }, [formState, isUsingInlineCredentials, notifyError, notifySuccess, notifyWarning]);

  const refreshServerCredentialsAfterSave = React.useCallback(
    async (savedServerId: string): Promise<void> => {
      await refreshServerCredentials(savedServerId, {
        onCredentialsLoaded: (nextCredentials) => {
          credentialsCacheRef.current[savedServerId] = nextCredentials;
          if (serverId === savedServerId) {
            setFormState((previous) => ({
              ...previous,
              ...nextCredentials,
            }));
          }
        },
        onLoadFailed: () => {
          notifyWarning(t('ssh.credentialsLoadFailed'));
        },
      });
    },
    [notifyWarning, refreshServerCredentials, serverId],
  );

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const port = parsePort(formState.port);
      if (!formState.name.trim() || !formState.host.trim() || !formState.username.trim()) {
        notifyWarning(t('ssh.validationRequiredFields'));
        return;
      }

      if (port === null) {
        notifyWarning(t('ssh.validationInvalidPort'));
        return;
      }

      setIsSubmitting(true);
      try {
        let successMessage = t('ssh.serverCreatedSuccessfully');
        const selectedKeychainId = isUsingInlineCredentials ? undefined : formState.keychainId || undefined;
        const submittedCredentialPayload = {
          authType: formState.authType,
          password: formState.password.trim() || undefined,
          privateKey: formState.privateKey.trim() || undefined,
          privateKeyPassphrase: formState.privateKeyPassphrase.trim() || undefined,
        };

        if (serverId) {
          const targetServer = servers.find((server) => server.id === serverId);
          if (!targetServer) {
            notifyWarning(t('ssh.validationServerNotFound'));
            return;
          }

          if (requiresPassword && !formState.password.trim() && !targetServer.hasPassword) {
            notifyWarning(t('ssh.validationPasswordRequired'));
            return;
          }

          if (requiresPrivateKey && !formState.privateKey.trim() && !targetServer.hasPrivateKey) {
            notifyWarning(t('ssh.validationPrivateKeyRequired'));
            return;
          }

          await updateSshServer(serverId, {
            name: formState.name.trim(),
            host: formState.host.trim(),
            port,
            username: formState.username.trim(),
            keychainId: selectedKeychainId,
            authType: isUsingInlineCredentials ? submittedCredentialPayload.authType : undefined,
            iconKey: formState.iconKey,
            colorKey: isEntityColorKey(formState.colorKey) ? formState.colorKey : undefined,
            password: isUsingInlineCredentials ? submittedCredentialPayload.password : undefined,
            privateKey: isUsingInlineCredentials ? submittedCredentialPayload.privateKey : undefined,
            privateKeyPassphrase: isUsingInlineCredentials
              ? submittedCredentialPayload.privateKeyPassphrase
              : undefined,
            folderId: formState.folderId || undefined,
            tagIds: formState.tagIds,
            note: formState.note.trim() || undefined,
            strictHostKey: formState.strictHostKey,
          });

          if (isUsingInlineCredentials) {
            credentialsCacheRef.current[serverId] = applySubmittedCredentialsToCache(
              credentialsCacheRef.current[serverId],
              submittedCredentialPayload,
            );
          }

          await refreshServerCredentialsAfterSave(serverId);
          successMessage = t('ssh.serverUpdatedSuccessfully');
        } else {
          const created = await createSshServer({
            name: formState.name.trim(),
            host: formState.host.trim(),
            port,
            username: formState.username.trim(),
            keychainId: selectedKeychainId,
            authType: isUsingInlineCredentials ? submittedCredentialPayload.authType : undefined,
            iconKey: formState.iconKey,
            colorKey: isEntityColorKey(formState.colorKey) ? formState.colorKey : undefined,
            password: isUsingInlineCredentials ? submittedCredentialPayload.password : undefined,
            privateKey: isUsingInlineCredentials ? submittedCredentialPayload.privateKey : undefined,
            privateKeyPassphrase: isUsingInlineCredentials
              ? submittedCredentialPayload.privateKeyPassphrase
              : undefined,
            folderId: formState.folderId || undefined,
            tagIds: formState.tagIds,
            note: formState.note.trim() || undefined,
            strictHostKey: formState.strictHostKey,
          });

          const createdServerId = created.data.item.id;
          if (isUsingInlineCredentials) {
            credentialsCacheRef.current[createdServerId] = applySubmittedCredentialsToCache(
              undefined,
              submittedCredentialPayload,
            );
          }
          await refreshServerCredentialsAfterSave(createdServerId);
        }

        await onSaved();
        notifySuccess(successMessage);
        onOpenChange(false);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('ssh.saveServerFailed'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      formState,
      isUsingInlineCredentials,
      notifyError,
      notifySuccess,
      notifyWarning,
      onOpenChange,
      onSaved,
      refreshServerCredentialsAfterSave,
      requiresPassword,
      requiresPrivateKey,
      serverId,
      servers,
    ],
  );

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
            <DialogTitle>{displayServerId ? t('home.contextEdit') : t('home.quickAddServer')}</DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-136px)] overflow-auto">
            <SSHServerEditorForm
              formId="home-ssh-editor-form"
              formState={formState}
              activeServer={activeServer}
              isSubmitting={isSubmitting}
              sharedKeychains={sharedKeychains}
              folders={editorFolders}
              tags={tags}
              keychainSelectValue={keychainSelectValue}
              isUsingInlineCredentials={isUsingInlineCredentials}
              requiresPassword={requiresPassword}
              requiresPrivateKey={requiresPrivateKey}
              privateKeyContextMenuItems={privateKeyContextMenuItems}
              onSubmit={(event) => {
                void onSubmit(event);
              }}
              onHostChange={onHostChange}
              onCreateFolder={(options) => {
                createFolderDialog.openCreateFolderDialog(options);
              }}
              onCreateTag={onCreateTag}
              onOpenSelectedKeychainEditor={openSelectedKeychainEditor}
              onSaveInlineCredentialsToSharedKeychain={() => {
                void saveInlineCredentialsToSharedKeychain();
              }}
              onKeychainSelectValueChange={(value) => {
                if (value === SSH_SERVER_ADD_KEYCHAIN_SELECT_VALUE) {
                  notifyWarning(t('ssh.keychainCreateComingSoon'));
                  return;
                }

                onChangeForm('keychainId', value === SSH_SERVER_INLINE_KEYCHAIN_SELECT_VALUE ? '' : value);
              }}
              onChangeForm={onChangeForm}
            />
          </div>

          <DialogFooter className="border-t border-dialog-border">
            <DialogSecondaryButton
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              {t('home.actionCancel')}
            </DialogSecondaryButton>
            <DialogPrimaryButton
              type="submit"
              form="home-ssh-editor-form"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <RefreshCcw
                  size={16}
                  className="animate-spin"
                />
              ) : null}
              {isSubmitting ? t('ssh.saving') : displayServerId ? t('ssh.saveChanges') : t('ssh.createServerButton')}
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
        onFolderNameChange={createFolderDialog.setFolderName}
        onVisualChange={createFolderDialog.setFolderVisual}
        onSubmit={() => {
          void createFolderDialog.submitCreateFolder();
        }}
      />
    </>
  );
};

export default SSHServerEditorDialog;
