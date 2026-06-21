import type { components } from '@cosmosh/api-contract';
import classNames from 'classnames';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpDown,
  CalendarPlus,
  FileUp,
  FolderPlus,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Server,
  Trash,
} from 'lucide-react';
import React from 'react';

import CreateFolderDialog from '../components/home/CreateFolderDialog';
import EntityCard from '../components/home/EntityCard';
import SplitWorkbenchLayout, { SplitWorkbenchMainPanel } from '../components/layout/SplitWorkbenchLayout';
import SSHKeychainEditorDialog from '../components/ssh/SSHKeychainEditorDialog';
import SSHServerEditorForm, {
  SSH_SERVER_ADD_KEYCHAIN_SELECT_VALUE,
  SSH_SERVER_INLINE_KEYCHAIN_SELECT_VALUE,
} from '../components/ssh/SSHServerEditorForm';
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import type { InputContextMenuItem } from '../components/ui/input-context-menu-registry';
import { menuStyles } from '../components/ui/menu-styles';
import { Menubar, MenubarSeparator } from '../components/ui/menubar';
import { deleteSshServer, listSshFolders, listSshKeychains, listSshServers, listSshTags } from '../lib/backend';
import { createEntityIconNode, EntityColorKey, isEntityColorKey } from '../lib/entity-visuals';
import { t } from '../lib/i18n';
import { resolveServerAddressForDisplay } from '../lib/server-address';
import { useSettingsValue } from '../lib/settings-store';
import { upsertKeychainListItem } from '../lib/ssh-keychain-editor-shared';
import {
  buildInlineCredentialKeychainEditorFormState,
  createServerEditorTag,
  importServerEditorPrivateKeyFromFile,
  saveServerFromEditor,
} from '../lib/ssh-server-editor-actions';
import {
  applySubmittedCredentialsToCache,
  createInitialServerFormState,
  deriveServerEditorCredentialMode,
  mapServerToFormState,
  type ServerCredentialCache,
  type ServerEditorFormState,
  type SshServerListItem,
} from '../lib/ssh-server-editor-shared';
import { consumeSshEditorCreateMode } from '../lib/ssh-target';
import { useToast } from '../lib/toast-context';
import { useCreateFolderDialog } from '../lib/use-create-folder-dialog';
import { useDirectionalNavigation } from '../lib/use-directional-navigation';
import { useKeychainEditorDialogState } from '../lib/use-keychain-editor-dialog-state';
import { useKeychainCredentials, useServerCredentialsRefresh } from '../lib/use-server-credentials';

type SshFolder = components['schemas']['SshFolder'];
type SshTag = components['schemas']['SshTag'];
type SshKeychainListItem = components['schemas']['SshKeychainListItem'];

type SortMode = 'default' | 'nameAsc' | 'nameDesc' | 'lastUsed' | 'createdAt';

/**
 * Merges a refreshed server snapshot into the current editor state without discarding locally edited fields.
 *
 * @param currentFormState The form state currently shown in the editor.
 * @param nextFormState The latest state derived from backend data.
 * @param dirtyFields The field keys edited locally since the current entity was loaded.
 * @returns A merged form state that preserves unsaved local edits.
 */
const mergeFormStatePreservingDirtyFields = (
  currentFormState: ServerEditorFormState,
  nextFormState: ServerEditorFormState,
  dirtyFields: ReadonlySet<keyof ServerEditorFormState>,
): ServerEditorFormState => {
  if (dirtyFields.size === 0) {
    return nextFormState;
  }

  const mergedFormState: ServerEditorFormState = { ...currentFormState };
  const mutableFormState = mergedFormState as Record<
    keyof ServerEditorFormState,
    ServerEditorFormState[keyof ServerEditorFormState]
  >;

  (Object.keys(nextFormState) as Array<keyof ServerEditorFormState>).forEach((fieldKey) => {
    if (!dirtyFields.has(fieldKey)) {
      mutableFormState[fieldKey] = nextFormState[fieldKey];
    }
  });

  return mergedFormState;
};

const getServerSortTimestamp = (server: SshServerListItem, mode: 'lastUsed' | 'createdAt'): number => {
  if (mode === 'createdAt') {
    return new Date(server.createdAt).getTime();
  }

  return new Date(server.lastLoginAudit?.attemptedAt ?? server.createdAt).getTime();
};

type SSHEditorProps = {
  preferredServerId?: string;
  preferCreateMode?: boolean;
};

const SSHEditor: React.FC<SSHEditorProps> = ({ preferredServerId, preferCreateMode = false }) => {
  const { error: notifyError, success: notifySuccess, warning: notifyWarning } = useToast();
  const defaultServerNoteTemplate = useSettingsValue('defaultServerNoteTemplate');
  const showFullServerAddress = useSettingsValue('showFullServerAddress');
  const [servers, setServers] = React.useState<SshServerListItem[]>([]);
  const [folders, setFolders] = React.useState<SshFolder[]>([]);
  const [tags, setTags] = React.useState<SshTag[]>([]);
  const [keychains, setKeychains] = React.useState<SshKeychainListItem[]>([]);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [search, setSearch] = React.useState<string>('');
  const [sortMode, setSortMode] = React.useState<SortMode>('default');
  const [activeServerId, setActiveServerId] = React.useState<string | null>(null);
  const [formState, setFormState] = React.useState<ServerEditorFormState>(
    createInitialServerFormState(defaultServerNoteTemplate),
  );
  const [isDeleteServerDialogOpen, setIsDeleteServerDialogOpen] = React.useState<boolean>(false);
  const [isDeletingServer, setIsDeletingServer] = React.useState<boolean>(false);
  const [deleteServerDraft, setDeleteServerDraft] = React.useState<{ id: string; name: string } | null>(null);
  const activeServerIdRef = React.useRef<string | null>(null);
  const formStateRef = React.useRef<ServerEditorFormState>(formState);
  const credentialsCacheRef = React.useRef<Record<string, ServerCredentialCache>>({});
  const dirtyFieldKeysRef = React.useRef<Set<keyof ServerEditorFormState>>(new Set());
  const preferCreateModeRef = React.useRef<boolean>(preferCreateMode);

  React.useEffect(() => {
    preferCreateModeRef.current = preferCreateMode;
  }, [preferCreateMode]);

  const activeServer = React.useMemo(() => {
    if (!activeServerId) {
      return null;
    }

    return servers.find((server) => server.id === activeServerId) ?? null;
  }, [activeServerId, servers]);

  React.useEffect(() => {
    activeServerIdRef.current = activeServerId;
  }, [activeServerId]);

  React.useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  const resetDirtyFieldKeys = React.useCallback(() => {
    dirtyFieldKeysRef.current = new Set();
  }, []);

  const reloadData = React.useCallback(
    async (preferredServerIdOverride?: string) => {
      setIsLoading(true);

      try {
        const [foldersResponse, serversResponse, tagsResponse, keychainsResponse] = await Promise.all([
          listSshFolders(),
          listSshServers(),
          listSshTags(),
          listSshKeychains(),
        ]);
        const nextFolders = foldersResponse.data.items;
        const nextServers = serversResponse.data.items;
        const nextTags = tagsResponse.data.items;
        const nextKeychains = keychainsResponse.data.items;
        const nextDefaultServerNoteTemplate = defaultServerNoteTemplate;
        const currentActiveServerId = activeServerIdRef.current;
        const currentFormState = formStateRef.current;
        const dirtyFieldKeys = dirtyFieldKeysRef.current;

        setFolders(nextFolders);
        setServers(nextServers);
        setTags(nextTags);
        setKeychains(nextKeychains);

        if (consumeSshEditorCreateMode()) {
          preferCreateModeRef.current = true;
        }

        if (preferCreateModeRef.current) {
          setActiveServerId(null);
          if (currentActiveServerId === null) {
            setFormState(currentFormState);
          } else {
            resetDirtyFieldKeys();
            setFormState(createInitialServerFormState(nextDefaultServerNoteTemplate));
          }
          return;
        }

        if (nextServers.length === 0) {
          preferCreateModeRef.current = true;
          setActiveServerId(null);
          if (currentActiveServerId === null) {
            setFormState(currentFormState);
          } else {
            resetDirtyFieldKeys();
            setFormState(createInitialServerFormState(nextDefaultServerNoteTemplate));
          }
          return;
        }

        const currentId =
          preferredServerIdOverride && nextServers.some((server) => server.id === preferredServerIdOverride)
            ? preferredServerIdOverride
            : currentActiveServerId && nextServers.some((server) => server.id === currentActiveServerId)
              ? currentActiveServerId
              : preferredServerId && nextServers.some((server) => server.id === preferredServerId)
                ? preferredServerId
                : nextServers[0].id;
        const targetServer = nextServers.find((server) => server.id === currentId) ?? nextServers[0];
        const cachedCredentials = credentialsCacheRef.current[targetServer.id];
        const nextFormState = {
          ...mapServerToFormState(targetServer),
          ...(cachedCredentials ?? {}),
        };
        const shouldPreserveLocalChanges = currentActiveServerId === targetServer.id && dirtyFieldKeys.size > 0;

        preferCreateModeRef.current = false;
        setActiveServerId(targetServer.id);
        setFormState(
          shouldPreserveLocalChanges
            ? mergeFormStatePreservingDirtyFields(currentFormState, nextFormState, dirtyFieldKeys)
            : nextFormState,
        );

        if (!shouldPreserveLocalChanges) {
          resetDirtyFieldKeys();
        }
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('ssh.editorLoadFailed'));
      } finally {
        setIsLoading(false);
      }
    },
    [defaultServerNoteTemplate, notifyError, preferredServerId, resetDirtyFieldKeys],
  );

  React.useEffect(() => {
    void reloadData();
  }, [reloadData]);

  const { refreshServerCredentials } = useServerCredentialsRefresh({
    enabled: Boolean(activeServerId),
    serverId: activeServerId,
    onCredentialsLoaded: (nextCredentials) => {
      if (!activeServerId) {
        return;
      }

      credentialsCacheRef.current[activeServerId] = nextCredentials;
      setFormState((previous) => ({
        ...(activeServerIdRef.current === activeServerId
          ? mergeFormStatePreservingDirtyFields(
              previous,
              { ...previous, ...nextCredentials },
              dirtyFieldKeysRef.current,
            )
          : previous),
      }));
    },
    onLoadFailed: () => {
      notifyError(t('ssh.credentialsLoadFailed'));
    },
  });

  useKeychainCredentials({
    keychainId: formState.keychainId || null,
    onCredentialsLoaded: (nextCredentials) => {
      setFormState((previous) => ({
        ...mergeFormStatePreservingDirtyFields(
          previous,
          { ...previous, ...nextCredentials },
          dirtyFieldKeysRef.current,
        ),
      }));
    },
    onLoadFailed: () => {
      notifyError(t('ssh.credentialsLoadFailed'));
    },
  });

  /**
   * Re-fetches credentials after a successful save to guarantee cache/state match persisted backend values.
   *
   * @param serverId The saved server id.
   * @returns Resolves once the refresh attempt finishes.
   */
  const refreshServerCredentialsAfterSave = React.useCallback(
    async (serverId: string): Promise<void> => {
      await refreshServerCredentials(serverId, {
        onCredentialsLoaded: (nextCredentials) => {
          credentialsCacheRef.current[serverId] = nextCredentials;
          if (activeServerIdRef.current === serverId) {
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
    [notifyWarning, refreshServerCredentials],
  );

  const { sharedKeychains, isUsingInlineCredentials, requiresPassword, requiresPrivateKey } = React.useMemo(() => {
    return deriveServerEditorCredentialMode({
      keychainId: formState.keychainId,
      keychains,
      authType: formState.authType,
    });
  }, [formState.authType, formState.keychainId, keychains]);

  const keychainSelectValue = isUsingInlineCredentials ? SSH_SERVER_INLINE_KEYCHAIN_SELECT_VALUE : formState.keychainId;

  const {
    isKeychainEditorDialogOpen,
    activeKeychainEditorId,
    keychainEditorInitialFormState,
    openCreateKeychainDialog,
    openEditKeychainDialog,
    closeKeychainEditorDialog,
  } = useKeychainEditorDialogState({
    keychains: sharedKeychains,
    onKeychainNotFound: () => {
      notifyWarning(t('ssh.validationKeychainNotFound'));
    },
  });

  const openSelectedKeychainEditor = React.useCallback(() => {
    if (!formState.keychainId) {
      return;
    }

    openEditKeychainDialog(formState.keychainId);
  }, [formState.keychainId, openEditKeychainDialog]);

  const saveInlineCredentialsToSharedKeychain = React.useCallback(() => {
    if (!isUsingInlineCredentials) {
      return;
    }

    openCreateKeychainDialog(buildInlineCredentialKeychainEditorFormState(formState));
  }, [formState, isUsingInlineCredentials, openCreateKeychainDialog]);

  const sortServers = React.useCallback((items: SshServerListItem[], mode: SortMode): SshServerListItem[] => {
    return [...items].sort((left, right) => {
      if (mode === 'nameAsc') {
        return left.name.localeCompare(right.name);
      }

      if (mode === 'nameDesc') {
        return right.name.localeCompare(left.name);
      }

      if (mode === 'lastUsed' || mode === 'createdAt') {
        return getServerSortTimestamp(right, mode) - getServerSortTimestamp(left, mode);
      }

      return 0;
    });
  }, []);

  const searchedServers = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return keyword
      ? servers.filter((server) => {
          return (
            server.name.toLowerCase().includes(keyword) ||
            server.host.toLowerCase().includes(keyword) ||
            server.username.toLowerCase().includes(keyword)
          );
        })
      : servers;
  }, [search, servers]);

  const displayGroups = React.useMemo(() => {
    if (sortMode === 'nameAsc' || sortMode === 'nameDesc') {
      return [
        {
          key: `flat:${sortMode}`,
          title: '',
          items: sortServers(searchedServers, sortMode),
        },
      ];
    }

    if (sortMode === 'lastUsed' || sortMode === 'createdAt') {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const oneWeekMs = 7 * oneDayMs;
      const oneMonthMs = 30 * oneDayMs;
      const recentServers = sortServers(searchedServers, sortMode);
      const dayItems: SshServerListItem[] = [];
      const weekItems: SshServerListItem[] = [];
      const monthItems: SshServerListItem[] = [];
      const olderItems: SshServerListItem[] = [];

      recentServers.forEach((server) => {
        const age = now - getServerSortTimestamp(server, sortMode);
        if (age <= oneDayMs) {
          dayItems.push(server);
          return;
        }

        if (age <= oneWeekMs) {
          weekItems.push(server);
          return;
        }

        if (age <= oneMonthMs) {
          monthItems.push(server);
          return;
        }

        olderItems.push(server);
      });

      return [
        { key: 'time:day', title: t('ssh.groupDay'), items: dayItems },
        { key: 'time:week', title: t('ssh.groupWeek'), items: weekItems },
        { key: 'time:month', title: t('ssh.groupMonth'), items: monthItems },
        { key: 'time:older', title: t('ssh.groupOlder'), items: olderItems },
      ].filter((group) => group.items.length > 0);
    }

    const groups = folders
      .map((folder) => {
        const items = searchedServers.filter((server) => server.folder?.id === folder.id);
        return {
          key: `folder:${folder.id}`,
          title: folder.name,
          items,
        };
      })
      .filter((group) => group.items.length > 0);

    const uncategorized = searchedServers.filter((server) => !server.folder?.id);

    if (uncategorized.length > 0) {
      groups.push({
        key: 'folder:uncategorized',
        title: t('ssh.noFolder'),
        items: uncategorized,
      });
    }

    return groups;
  }, [folders, searchedServers, sortMode, sortServers]);

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

  const sidebarEntries = React.useMemo(() => {
    const entries: Array<{ key: string; serverId: string | null }> = [];

    if (activeServerId === null) {
      entries.push({ key: 'draft:server', serverId: null });
    }

    displayGroups.forEach((group) => {
      group.items.forEach((server) => {
        entries.push({
          key: `server:${server.id}`,
          serverId: server.id,
        });
      });
    });

    return entries;
  }, [activeServerId, displayGroups]);

  const sidebarEntryIndexMap = React.useMemo(() => {
    const indexMap = new Map<string, number>();
    sidebarEntries.forEach((entry, index) => {
      indexMap.set(entry.key, index);
    });

    return indexMap;
  }, [sidebarEntries]);

  const activeSidebarIndex = React.useMemo(() => {
    if (activeServerId === null) {
      return sidebarEntryIndexMap.get('draft:server') ?? 0;
    }

    return sidebarEntryIndexMap.get(`server:${activeServerId}`) ?? 0;
  }, [activeServerId, sidebarEntryIndexMap]);

  const sidebarNavigation = useDirectionalNavigation({
    itemCount: sidebarEntries.length,
    columns: 1,
    initialIndex: activeSidebarIndex,
  });

  const setSidebarActiveIndex = sidebarNavigation.setActiveIndex;

  React.useEffect(() => {
    setSidebarActiveIndex(activeSidebarIndex);
  }, [activeSidebarIndex, setSidebarActiveIndex]);

  const onPickServer = React.useCallback(
    (serverId: string) => {
      const targetServer = servers.find((server) => server.id === serverId);
      if (!targetServer) {
        return;
      }

      preferCreateModeRef.current = false;
      resetDirtyFieldKeys();
      setActiveServerId(serverId);
      setFormState({
        ...mapServerToFormState(targetServer),
        ...(credentialsCacheRef.current[serverId] ?? {}),
      });
    },
    [resetDirtyFieldKeys, servers],
  );

  const onChangeForm = React.useCallback(
    <K extends keyof ServerEditorFormState>(key: K, value: ServerEditorFormState[K]) => {
      dirtyFieldKeysRef.current.add(key);
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

      if (activeServerId === null && !formStateRef.current.name.trim()) {
        onChangeForm('name', nextHost);
      }
    },
    [activeServerId, onChangeForm],
  );

  const createFolderDialog = useCreateFolderDialog({
    onCreated: (createdFolder, options) => {
      setFolders((previous) => [...previous, createdFolder]);

      if (options.selectOnCreate) {
        dirtyFieldKeysRef.current.add('folderId');
        setFormState((previous) => ({ ...previous, folderId: createdFolder.id }));
      }
    },
  });

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

  const onAddServer = React.useCallback(() => {
    preferCreateModeRef.current = true;
    resetDirtyFieldKeys();
    setActiveServerId(null);
    setFormState(createInitialServerFormState(defaultServerNoteTemplate));
  }, [defaultServerNoteTemplate, resetDirtyFieldKeys]);

  const onCreateFolder = React.useCallback(
    (options?: { selectOnCreate?: boolean }) => {
      createFolderDialog.openCreateFolderDialog(options);
    },
    [createFolderDialog],
  );

  const openDeleteServerDialog = React.useCallback(
    (serverId: string) => {
      const targetServer = servers.find((server) => server.id === serverId);
      if (!targetServer) {
        return;
      }

      setDeleteServerDraft({ id: targetServer.id, name: targetServer.name });
      setIsDeleteServerDialogOpen(true);
    },
    [servers],
  );

  const submitDeleteServer = React.useCallback(async () => {
    if (!deleteServerDraft) {
      return;
    }

    setIsDeletingServer(true);
    try {
      const result = await deleteSshServer(deleteServerDraft.id);
      if (!result.success) {
        throw new Error(t('ssh.deleteServerFailed'));
      }

      if (activeServerId === deleteServerDraft.id) {
        preferCreateModeRef.current = true;
      }

      setIsDeleteServerDialogOpen(false);
      setDeleteServerDraft(null);
      await reloadData();
      notifySuccess(t('ssh.deleteServerSuccess'));
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('ssh.deleteServerFailed'));
    } finally {
      setIsDeletingServer(false);
    }
  }, [activeServerId, deleteServerDraft, notifyError, notifySuccess, reloadData]);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      setIsSubmitting(true);
      try {
        const result = await saveServerFromEditor({
          serverId: activeServerId,
          activeServer,
          formState,
          isUsingInlineCredentials,
          requiresPassword,
          requiresPrivateKey,
          onWarning: notifyWarning,
          validationRequiredFieldsMessage: t('ssh.validationRequiredFields'),
          validationInvalidPortMessage: t('ssh.validationInvalidPort'),
          validationServerNotFoundMessage: t('ssh.validationServerNotFound'),
          validationPasswordRequiredMessage: t('ssh.validationPasswordRequired'),
          validationPrivateKeyRequiredMessage: t('ssh.validationPrivateKeyRequired'),
          validationProxyUrlMessage: t('ssh.validationProxyUrl'),
        });
        if (!result) {
          return;
        }

        const wasEditing = Boolean(activeServerId);
        const savedServerId = activeServerId ?? result.savedServer.id;
        if (isUsingInlineCredentials) {
          credentialsCacheRef.current[savedServerId] = applySubmittedCredentialsToCache(
            credentialsCacheRef.current[savedServerId],
            result.submittedCredentialPayload,
          );
        }
        await refreshServerCredentialsAfterSave(savedServerId);
        resetDirtyFieldKeys();

        if (wasEditing) {
          await reloadData(savedServerId);
        } else {
          preferCreateModeRef.current = false;
          setActiveServerId(savedServerId);
          await reloadData(savedServerId);
        }
        notifySuccess(wasEditing ? t('ssh.serverUpdatedSuccessfully') : t('ssh.serverCreatedSuccessfully'));
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('ssh.saveServerFailed'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeServerId,
      activeServer,
      formState,
      notifyError,
      notifySuccess,
      notifyWarning,
      refreshServerCredentialsAfterSave,
      isUsingInlineCredentials,
      reloadData,
      resetDirtyFieldKeys,
      requiresPassword,
      requiresPrivateKey,
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
                    checked={sortMode === 'lastUsed'}
                    onSelect={() => setSortMode('lastUsed')}
                  >
                    {t('home.sortByLastUsed')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={sortMode === 'createdAt'}
                    onSelect={() => setSortMode('createdAt')}
                  >
                    {t('home.sortByCreatedAt')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('home.addAction')}
                    className={classNames(menuStyles.control, menuStyles.iconOnlyControl)}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    icon={Server}
                    onSelect={onAddServer}
                  >
                    {t('home.quickAddServer')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={FolderPlus}
                    onSelect={() => onCreateFolder()}
                  >
                    {t('home.quickAddFolder')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Menubar>
          </div>

          <div className="gutter-box-y min-h-0 flex-1 overflow-auto pb-2">
            {isLoading ? <div className="px-2 text-sm text-home-text-subtle">{t('home.loading')}</div> : null}

            {!isLoading && displayGroups.length === 0 && activeServerId !== null ? (
              <div className="px-2 text-sm text-home-text-subtle">{t('home.empty')}</div>
            ) : null}

            {!isLoading ? (
              <div className="space-y-4">
                {activeServerId === null ? (
                  <section>
                    <div className="px-2 pb-2.5 text-xs font-medium text-home-text-subtle">
                      {t('ssh.draftSectionTitle')}
                    </div>
                    <EntityCard
                      {...sidebarNavigation.getItemProps(sidebarEntryIndexMap.get('draft:server') ?? 0)}
                      selected
                      title={t('ssh.draftServerTitle')}
                      subtitle={t('ssh.draftServerSubtitle')}
                      icon={createEntityIconNode(
                        {
                          iconKey: 'Server',
                          colorKey: 'blue',
                        },
                        t('ssh.draftServerTitle'),
                      )}
                      onClick={onAddServer}
                    />
                  </section>
                ) : null}

                {displayGroups.map((group) => (
                  <section key={group.key}>
                    {group.title ? (
                      <div className="px-2 pb-2.5 text-xs font-medium text-home-text-subtle">{group.title}</div>
                    ) : null}
                    <div className="space-y-1.5">
                      {group.items.map((server) => {
                        const colorKey: EntityColorKey = isEntityColorKey(server.colorKey) ? server.colorKey : 'blue';
                        const iconKey = server.iconKey;
                        const sidebarIndex = sidebarEntryIndexMap.get(`server:${server.id}`) ?? 0;
                        return (
                          <ContextMenu key={server.id}>
                            <ContextMenuTrigger className="block">
                              <EntityCard
                                {...sidebarNavigation.getItemProps(sidebarIndex)}
                                title={server.name}
                                subtitle={
                                  server.note || resolveServerAddressForDisplay(server.host, showFullServerAddress)
                                }
                                selected={server.id === activeServerId}
                                icon={createEntityIconNode({ iconKey, colorKey }, server.name)}
                                onClick={() => onPickServer(server.id)}
                              />
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                icon={Server}
                                onSelect={() => onPickServer(server.id)}
                              >
                                {t('home.contextEdit')}
                              </ContextMenuItem>
                              <ContextMenuItem
                                icon={Trash}
                                onSelect={() => openDeleteServerDialog(server.id)}
                              >
                                {t('home.contextDelete')}
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
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
                {activeServerId ? formState.name || t('ssh.untitledServer') : t('ssh.newServer')}
              </h1>
              <Menubar>
                {activeServerId ? (
                  <>
                    <Button
                      variant="icon"
                      aria-label={t('home.contextDelete')}
                      onClick={() => openDeleteServerDialog(activeServerId)}
                    >
                      <Trash size={16} />
                    </Button>
                    <MenubarSeparator vertical />
                  </>
                ) : null}
                <Button
                  type="submit"
                  form="ssh-editor-form"
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
                  {isSubmitting ? t('ssh.saving') : activeServerId ? t('ssh.saveChanges') : t('ssh.createServerButton')}
                </Button>
              </Menubar>
            </div>
          }
          body={
            <SSHServerEditorForm
              formState={formState}
              activeServer={activeServer}
              isSubmitting={isSubmitting}
              sharedKeychains={sharedKeychains}
              folders={folders}
              tags={tags}
              keychainSelectValue={keychainSelectValue}
              isUsingInlineCredentials={isUsingInlineCredentials}
              requiresPassword={requiresPassword}
              requiresPrivateKey={requiresPrivateKey}
              privateKeyContextMenuItems={privateKeyContextMenuItems}
              onSubmit={(event) => void onSubmit(event)}
              onHostChange={onHostChange}
              onCreateFolder={onCreateFolder}
              onCreateTag={onCreateTag}
              onOpenSelectedKeychainEditor={openSelectedKeychainEditor}
              onSaveInlineCredentialsToSharedKeychain={saveInlineCredentialsToSharedKeychain}
              onKeychainSelectValueChange={(value) => {
                if (value === SSH_SERVER_ADD_KEYCHAIN_SELECT_VALUE) {
                  openCreateKeychainDialog();
                  return;
                }

                onChangeForm('keychainId', value === SSH_SERVER_INLINE_KEYCHAIN_SELECT_VALUE ? '' : value);
              }}
              onChangeForm={onChangeForm}
            />
          }
        />
      }
    >
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

      <SSHKeychainEditorDialog
        open={isKeychainEditorDialogOpen}
        keychainId={activeKeychainEditorId}
        initialFormState={keychainEditorInitialFormState}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeKeychainEditorDialog();
          }
        }}
        onSaved={(savedKeychain) => {
          setKeychains((previous) => upsertKeychainListItem(previous, savedKeychain));
          onChangeForm('keychainId', savedKeychain.id);
        }}
      />

      <AlertDialog
        open={isDeleteServerDialogOpen}
        onOpenChange={setIsDeleteServerDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ssh.deleteServerConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('ssh.deleteServerConfirmDescription', { name: deleteServerDraft?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isDeletingServer}>{t('home.actionCancel')}</AlertDialogCancelButton>
            <AlertDialogActionButton
              disabled={isDeletingServer}
              onClick={(event) => {
                event.preventDefault();
                void submitDeleteServer();
              }}
            >
              {t('home.contextDelete')}
            </AlertDialogActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SplitWorkbenchLayout>
  );
};

export default SSHEditor;
