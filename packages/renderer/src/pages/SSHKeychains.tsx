import type { components } from '@cosmosh/api-contract';
import classNames from 'classnames';
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown, CalendarPlus, Plus, RefreshCcw, Save, Search, Trash } from 'lucide-react';
import React from 'react';

import CreateFolderDialog from '../components/home/CreateFolderDialog';
import EntityCard from '../components/home/EntityCard';
import SplitWorkbenchLayout, { SplitWorkbenchMainPanel } from '../components/layout/SplitWorkbenchLayout';
import SSHKeychainEditorForm from '../components/ssh/SSHKeychainEditorForm';
import {
  AlertDialog,
  AlertDialogActionButton,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { menuStyles } from '../components/ui/menu-styles';
import { Menubar, MenubarSeparator } from '../components/ui/menubar';
import { deleteSshKeychain, listSshFolders, listSshKeychains, listSshTags } from '../lib/backend';
import { createEntityIconNode, isEntityColorKey, renderEntityIcon } from '../lib/entity-visuals';
import { t } from '../lib/i18n';
import { createKeychainEditorTag, saveKeychainFromEditor } from '../lib/ssh-keychain-editor-actions';
import {
  applySubmittedCredentialsToCache,
  createInitialKeychainFormState,
  deriveKeychainEditorCredentialMode,
  filterSharedKeychains,
  getKeychainSortTimestamp,
  type KeychainCredentialCache,
  type KeychainFormState,
  mapKeychainToFormState,
  mergeKeychainFormStatePreservingDirtyFields,
  type SshKeychainListItem,
} from '../lib/ssh-keychain-editor-shared';
import { useToast } from '../lib/toast-context';
import { useCreateFolderDialog } from '../lib/use-create-folder-dialog';
import { useKeychainCredentialsRefresh } from '../lib/use-server-credentials';

type SshFolder = components['schemas']['SshFolder'];
type SshTag = components['schemas']['SshTag'];

type SortMode = 'default' | 'nameAsc' | 'nameDesc' | 'createdAt';

const SSHKeychains: React.FC = () => {
  const { success: notifySuccess, error: notifyError, warning: notifyWarning } = useToast();
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [keychains, setKeychains] = React.useState<SshKeychainListItem[]>([]);
  const [folders, setFolders] = React.useState<SshFolder[]>([]);
  const [tags, setTags] = React.useState<SshTag[]>([]);
  const [search, setSearch] = React.useState<string>('');
  const [sortMode, setSortMode] = React.useState<SortMode>('default');
  const [activeKeychainId, setActiveKeychainId] = React.useState<string | null>(null);
  const [formState, setFormState] = React.useState<KeychainFormState>(() => createInitialKeychainFormState());
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState<boolean>(false);
  const [isDeletingKeychain, setIsDeletingKeychain] = React.useState<boolean>(false);
  const [deleteKeychainDraft, setDeleteKeychainDraft] = React.useState<{ id: string; name: string } | null>(null);

  const activeKeychainIdRef = React.useRef<string | null>(null);
  const formStateRef = React.useRef<KeychainFormState>(formState);
  const dirtyFieldKeysRef = React.useRef<Set<keyof KeychainFormState>>(new Set());
  const credentialsCacheRef = React.useRef<Record<string, KeychainCredentialCache>>({});

  const { requiresPassword, requiresPrivateKey } = React.useMemo(() => {
    return deriveKeychainEditorCredentialMode(formState.authType);
  }, [formState.authType]);

  const activeKeychain = React.useMemo(() => {
    if (!activeKeychainId) {
      return null;
    }

    return keychains.find((item) => item.id === activeKeychainId) ?? null;
  }, [activeKeychainId, keychains]);

  React.useEffect(() => {
    activeKeychainIdRef.current = activeKeychainId;
  }, [activeKeychainId]);

  React.useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  const resetDirtyFieldKeys = React.useCallback(() => {
    dirtyFieldKeysRef.current = new Set();
  }, []);

  const reloadData = React.useCallback(
    async (preferredKeychainId?: string): Promise<void> => {
      setIsLoading(true);

      try {
        const [keychainsResponse, foldersResponse, tagsResponse] = await Promise.all([
          listSshKeychains(),
          listSshFolders(),
          listSshTags(),
        ]);
        const nextKeychains = filterSharedKeychains(keychainsResponse.data.items);
        const currentKeychainId = activeKeychainIdRef.current;
        const currentFormState = formStateRef.current;
        const dirtyFieldKeys = dirtyFieldKeysRef.current;

        setKeychains(nextKeychains);
        setFolders(foldersResponse.data.items);
        setTags(tagsResponse.data.items);

        if (nextKeychains.length === 0) {
          setActiveKeychainId(null);
          if (currentKeychainId === null) {
            setFormState(currentFormState);
          } else {
            resetDirtyFieldKeys();
            setFormState(createInitialKeychainFormState());
          }
          return;
        }

        const currentId =
          preferredKeychainId && nextKeychains.some((item) => item.id === preferredKeychainId)
            ? preferredKeychainId
            : currentKeychainId && nextKeychains.some((item) => item.id === currentKeychainId)
              ? currentKeychainId
              : nextKeychains[0].id;

        const targetKeychain = nextKeychains.find((item) => item.id === currentId) ?? nextKeychains[0];
        const cachedCredentials = credentialsCacheRef.current[targetKeychain.id];
        const nextFormState = {
          ...mapKeychainToFormState(targetKeychain),
          ...(cachedCredentials ?? {}),
        };
        const shouldPreserveLocalChanges = currentKeychainId === targetKeychain.id && dirtyFieldKeys.size > 0;

        setActiveKeychainId(targetKeychain.id);
        setFormState(
          shouldPreserveLocalChanges
            ? mergeKeychainFormStatePreservingDirtyFields(currentFormState, nextFormState, dirtyFieldKeys)
            : nextFormState,
        );

        if (!shouldPreserveLocalChanges) {
          resetDirtyFieldKeys();
        }
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('sshKeychain.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    },
    [notifyError, resetDirtyFieldKeys],
  );

  React.useEffect(() => {
    void reloadData();
  }, [reloadData]);

  const { refreshKeychainCredentials } = useKeychainCredentialsRefresh({
    enabled: Boolean(activeKeychainId),
    keychainId: activeKeychainId,
    onCredentialsLoaded: (nextCredentials) => {
      if (!activeKeychainId) {
        return;
      }

      credentialsCacheRef.current[activeKeychainId] = nextCredentials;
      setFormState((previous) => ({
        ...(activeKeychainIdRef.current === activeKeychainId
          ? mergeKeychainFormStatePreservingDirtyFields(
              previous,
              { ...previous, ...nextCredentials },
              dirtyFieldKeysRef.current,
            )
          : previous),
      }));
    },
    onLoadFailed: () => {
      notifyError(t('sshKeychain.loadCredentialsFailed'));
    },
  });

  /**
   * Re-fetches credentials after a successful save to guarantee cache/state match persisted backend values.
   *
   * @param keychainId The saved keychain id.
   * @returns Resolves once the refresh attempt finishes.
   */
  const refreshKeychainCredentialsAfterSave = React.useCallback(
    async (keychainId: string): Promise<void> => {
      await refreshKeychainCredentials(keychainId, {
        onCredentialsLoaded: (nextCredentials) => {
          credentialsCacheRef.current[keychainId] = nextCredentials;
          if (activeKeychainIdRef.current === keychainId) {
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
    [notifyWarning, refreshKeychainCredentials],
  );

  const sortKeychains = React.useCallback((items: SshKeychainListItem[], mode: SortMode): SshKeychainListItem[] => {
    return [...items].sort((left, right) => {
      if (mode === 'nameAsc') {
        return left.name.localeCompare(right.name);
      }

      if (mode === 'nameDesc') {
        return right.name.localeCompare(left.name);
      }

      if (mode === 'createdAt') {
        return getKeychainSortTimestamp(right) - getKeychainSortTimestamp(left);
      }

      return 0;
    });
  }, []);

  const searchedKeychains = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return keyword
      ? keychains.filter((item) => {
          return item.name.toLowerCase().includes(keyword) || (item.note ?? '').toLowerCase().includes(keyword);
        })
      : keychains;
  }, [keychains, search]);

  const displayGroups = React.useMemo(() => {
    const sortedItems =
      sortMode === 'nameAsc' || sortMode === 'nameDesc' || sortMode === 'createdAt'
        ? sortKeychains(searchedKeychains, sortMode)
        : searchedKeychains;

    return [
      {
        key: `flat:${sortMode}`,
        title: '',
        items: sortedItems,
      },
    ];
  }, [searchedKeychains, sortKeychains, sortMode]);

  const sortModeIcon = React.useMemo(() => {
    if (sortMode === 'nameAsc') {
      return ArrowUpAZ;
    }

    if (sortMode === 'nameDesc') {
      return ArrowDownAZ;
    }

    if (sortMode === 'createdAt') {
      return CalendarPlus;
    }

    return ArrowUpDown;
  }, [sortMode]);

  const onChangeForm = React.useCallback(<K extends keyof KeychainFormState>(key: K, value: KeychainFormState[K]) => {
    dirtyFieldKeysRef.current.add(key);
    setFormState((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  const onAddKeychain = React.useCallback(() => {
    resetDirtyFieldKeys();
    setActiveKeychainId(null);
    setFormState(createInitialKeychainFormState());
  }, [resetDirtyFieldKeys]);

  const createFolderDialog = useCreateFolderDialog({
    onCreated: (createdFolder, options) => {
      setFolders((previous) => [...previous, createdFolder]);

      if (options.selectOnCreate) {
        dirtyFieldKeysRef.current.add('folderId');
        setFormState((previous) => ({ ...previous, folderId: createdFolder.id }));
      }
    },
  });

  const onCreateFolder = React.useCallback(
    (options?: { selectOnCreate?: boolean }) => {
      createFolderDialog.openCreateFolderDialog(options);
    },
    [createFolderDialog],
  );

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

  const onPickKeychain = React.useCallback(
    (keychainId: string) => {
      const targetKeychain = keychains.find((item) => item.id === keychainId);
      if (!targetKeychain) {
        return;
      }

      resetDirtyFieldKeys();
      setActiveKeychainId(keychainId);
      setFormState({
        ...mapKeychainToFormState(targetKeychain),
        ...(credentialsCacheRef.current[keychainId] ?? {}),
      });
    },
    [keychains, resetDirtyFieldKeys],
  );

  const openDeleteDialog = React.useCallback(
    (keychainId: string) => {
      const targetKeychain = keychains.find((item) => item.id === keychainId);
      if (!targetKeychain) {
        return;
      }

      setDeleteKeychainDraft({ id: targetKeychain.id, name: targetKeychain.name });
      setIsDeleteDialogOpen(true);
    },
    [keychains],
  );

  const submitDelete = React.useCallback(async () => {
    if (!deleteKeychainDraft) {
      return;
    }

    setIsDeletingKeychain(true);
    try {
      await deleteSshKeychain(deleteKeychainDraft.id);
      setIsDeleteDialogOpen(false);
      setDeleteKeychainDraft(null);
      await reloadData();
      notifySuccess(t('sshKeychain.deleteSuccess'));
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('sshKeychain.deleteFailed'));
    } finally {
      setIsDeletingKeychain(false);
    }
  }, [deleteKeychainDraft, notifyError, notifySuccess, reloadData]);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      setIsSubmitting(true);
      try {
        const saveResult = await saveKeychainFromEditor({
          keychainId: activeKeychainId,
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

        const previousCredentials = activeKeychainId ? credentialsCacheRef.current[activeKeychainId] : undefined;
        credentialsCacheRef.current[saveResult.savedKeychain.id] = applySubmittedCredentialsToCache(
          previousCredentials,
          saveResult.submittedCredentialPayload,
        );

        await refreshKeychainCredentialsAfterSave(saveResult.savedKeychain.id);
        resetDirtyFieldKeys();
        setActiveKeychainId(saveResult.savedKeychain.id);
        await reloadData(saveResult.savedKeychain.id);

        notifySuccess(t('sshKeychain.saveSuccess'));
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('sshKeychain.saveFailed'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeKeychain,
      activeKeychainId,
      formState,
      notifyError,
      notifySuccess,
      notifyWarning,
      refreshKeychainCredentialsAfterSave,
      reloadData,
      requiresPassword,
      requiresPrivateKey,
      resetDirtyFieldKeys,
    ],
  );

  return (
    <SplitWorkbenchLayout
      sidebar={
        <>
          <div className="pb-3">
            <Menubar>
              <div className="w-50 relative">
                <Input
                  value={search}
                  placeholder={t('home.searchPlaceholder')}
                  className="pr-9"
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-header-text-muted" />
              </div>

              <MenubarSeparator vertical />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('home.sortAction')}
                    className={classNames(menuStyles.control, menuStyles.iconOnlyControl)}
                  >
                    {React.createElement(sortModeIcon, { className: 'h-4 w-4' })}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{t('home.sortAction')}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={sortMode === 'default'}
                    onSelect={() => setSortMode('default')}
                  >
                    {t('ssh.sortDefault')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={sortMode === 'nameAsc'}
                    onSelect={() => setSortMode('nameAsc')}
                  >
                    {t('home.sortByNameAsc')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={sortMode === 'nameDesc'}
                    onSelect={() => setSortMode('nameDesc')}
                  >
                    {t('home.sortByNameDesc')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={sortMode === 'createdAt'}
                    onSelect={() => setSortMode('createdAt')}
                  >
                    {t('home.sortByCreatedAt')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                aria-label={t('sshKeychain.newKeychain')}
                className={classNames(menuStyles.control, menuStyles.iconOnlyControl)}
                onClick={onAddKeychain}
              >
                <Plus className="h-4 w-4" />
              </button>
            </Menubar>
          </div>

          <div className="gutter-box-y min-h-0 flex-1 overflow-auto pb-2">
            {isLoading ? <div className="px-2 text-sm text-home-text-subtle">{t('home.loading')}</div> : null}

            {!isLoading && displayGroups.length === 0 && activeKeychainId !== null ? (
              <div className="px-2 text-sm text-home-text-subtle">{t('home.empty')}</div>
            ) : null}

            {!isLoading ? (
              <div className="space-y-4">
                {activeKeychainId === null ? (
                  <section>
                    <div className="px-2 pb-2.5 text-xs font-medium text-home-text-subtle">
                      {t('sshKeychain.draftSectionTitle')}
                    </div>
                    <EntityCard
                      selected
                      title={t('sshKeychain.draftTitle')}
                      subtitle={t('sshKeychain.draftSubtitle')}
                      icon={
                        <span
                          className={classNames(
                            'inline-flex h-full w-full items-center justify-center rounded-md',
                            'bg-home-icon-emerald text-home-icon-emerald-ink',
                          )}
                        >
                          {renderEntityIcon('KeyRound')}
                        </span>
                      }
                      onClick={onAddKeychain}
                    />
                  </section>
                ) : null}

                {displayGroups.map((group) => (
                  <section key={group.key}>
                    {group.title ? (
                      <div className="px-2 pb-2.5 text-xs font-medium text-home-text-subtle">{group.title}</div>
                    ) : null}
                    <div className="space-y-1.5">
                      {group.items.map((item) => {
                        const selected = activeKeychainId === item.id;
                        const subtitle = t('sshKeychain.visibilityShared');

                        return (
                          <EntityCard
                            key={item.id}
                            selected={selected}
                            title={item.name}
                            subtitle={subtitle}
                            icon={createEntityIconNode(
                              {
                                iconKey: item.iconKey,
                                colorKey: isEntityColorKey(item.colorKey) ? item.colorKey : 'emerald',
                              },
                              item.name,
                            )}
                            onClick={() => onPickKeychain(item.id)}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        </>
      }
      main={
        <SplitWorkbenchMainPanel
          header={
            <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 pb-1 ps-2.5">
              <h1 className="text-home-text text-[24px] font-semibold">
                {activeKeychainId ? formState.name || t('sshKeychain.untitled') : t('sshKeychain.newKeychain')}
              </h1>
              <Menubar>
                {activeKeychainId ? (
                  <>
                    <Button
                      variant="icon"
                      aria-label={t('home.contextDelete')}
                      onClick={() => openDeleteDialog(activeKeychainId)}
                    >
                      <Trash size={16} />
                    </Button>
                    <MenubarSeparator vertical />
                  </>
                ) : null}
                <Button
                  type="submit"
                  form="ssh-keychain-form"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <RefreshCcw
                      size={16}
                      className="animate-spin"
                    />
                  ) : (
                    <Save size={16} />
                  )}
                  {isSubmitting ? t('ssh.saving') : t('sshKeychain.saveAction')}
                </Button>
              </Menubar>
            </div>
          }
          body={
            <SSHKeychainEditorForm
              formState={formState}
              activeKeychain={activeKeychain}
              isSubmitting={isSubmitting}
              requiresPassword={requiresPassword}
              requiresPrivateKey={requiresPrivateKey}
              folders={folders}
              tags={tags}
              onSubmit={(event) => void onSubmit(event)}
              onCreateFolder={onCreateFolder}
              onCreateTag={onCreateTag}
              onChangeForm={onChangeForm}
            />
          }
        />
      }
    >
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sshKeychain.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sshKeychain.deleteConfirmDescription', { name: deleteKeychainDraft?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isDeletingKeychain}>{t('home.actionCancel')}</AlertDialogCancelButton>
            <AlertDialogActionButton
              disabled={isDeletingKeychain}
              onClick={(event) => {
                event.preventDefault();
                void submitDelete();
              }}
            >
              {t('home.contextDelete')}
            </AlertDialogActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </SplitWorkbenchLayout>
  );
};

export default SSHKeychains;
