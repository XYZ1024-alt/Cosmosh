import type { components } from '@cosmosh/api-contract';
import classNames from 'classnames';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpDown,
  CalendarPlus,
  FileUp,
  Folder,
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
import EntityIcon from '../components/home/EntityIcon';
import EntityVisualPicker from '../components/home/EntityVisualPicker';
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
import { Form, FormControl, FormField, FormLabel, FormMessage } from '../components/ui/form';
import { formStyles } from '../components/ui/form-styles';
import { Input } from '../components/ui/input';
import type { InputContextMenuItem } from '../components/ui/input-context-menu-registry';
import { Label } from '../components/ui/label';
import { menuStyles } from '../components/ui/menu-styles';
import { Menubar, MenubarSeparator } from '../components/ui/menubar';
import { PasswordField } from '../components/ui/password-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { TagInput } from '../components/ui/tag-input';
import { Textarea } from '../components/ui/textarea';
import {
  createSshServer,
  createSshTag,
  deleteSshServer,
  getSshServerCredentials,
  listSshFolders,
  listSshServers,
  listSshTags,
  updateSshServer,
} from '../lib/backend';
import {
  createEntityIconNode,
  EntityColorKey,
  getEntityColorClassName,
  isEntityColorKey,
  pickRandomEntityVisual,
  renderEntityIcon,
} from '../lib/entity-visuals';
import { t } from '../lib/i18n';
import { resolveServerAddressForDisplay } from '../lib/server-address';
import { useSettingsValue } from '../lib/settings-store';
import { consumeSshEditorCreateMode, getActiveSshServerId, setActiveSshServerId } from '../lib/ssh-target';
import { useToast } from '../lib/toast-context';
import { useCreateFolderDialog } from '../lib/use-create-folder-dialog';
import { useDirectionalNavigation } from '../lib/use-directional-navigation';

type SshServerListItem = components['schemas']['SshServerListItem'];
type SshFolder = components['schemas']['SshFolder'];
type SshTag = components['schemas']['SshTag'];
type SshAuthType = components['schemas']['SshAuthType'];

type SortMode = 'default' | 'nameAsc' | 'nameDesc' | 'lastUsed' | 'createdAt';

type ServerEditorFormState = {
  name: string;
  iconKey: string;
  colorKey: string;
  note: string;
  host: string;
  port: string;
  username: string;
  authType: SshAuthType;
  password: string;
  privateKey: string;
  privateKeyPassphrase: string;
  folderId: string;
  tagIds: string[];
  strictHostKey: boolean;
};

type ServerCredentialCache = {
  authType: SshAuthType;
  password: string;
  privateKey: string;
  privateKeyPassphrase: string;
};

const NO_FOLDER_SELECT_VALUE = '__none__';
const CREATE_FOLDER_SELECT_VALUE = '__create_folder__';

const createInitialFormState = (defaultServerNoteTemplate = ''): ServerEditorFormState => {
  const visual = pickRandomEntityVisual('server', `${Date.now()}:${Math.random()}`);

  return {
    name: '',
    iconKey: visual.iconKey,
    colorKey: visual.colorKey,
    note: defaultServerNoteTemplate,
    host: '',
    port: '22',
    username: '',
    authType: 'password',
    password: '',
    privateKey: '',
    privateKeyPassphrase: '',
    folderId: '',
    tagIds: [],
    strictHostKey: true,
  };
};

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

const parsePort = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }

  return parsed;
};

const getServerSortTimestamp = (server: SshServerListItem, mode: 'lastUsed' | 'createdAt'): number => {
  if (mode === 'createdAt') {
    return new Date(server.createdAt).getTime();
  }

  return new Date(server.lastLoginAudit?.attemptedAt ?? server.createdAt).getTime();
};

const mapServerToFormState = (server: SshServerListItem): ServerEditorFormState => {
  return {
    name: server.name,
    iconKey: server.iconKey,
    colorKey: server.colorKey,
    note: server.note ?? '',
    host: server.host,
    port: String(server.port),
    username: server.username,
    authType: server.authType,
    password: '',
    privateKey: '',
    privateKeyPassphrase: '',
    folderId: server.folder?.id ?? '',
    tagIds: (server.tags ?? []).map((tag) => tag.id),
    strictHostKey: true,
  };
};

const SSHEditor: React.FC = () => {
  const { error: notifyError, success: notifySuccess, warning: notifyWarning } = useToast();
  const defaultServerNoteTemplate = useSettingsValue('defaultServerNoteTemplate');
  const showFullServerAddress = useSettingsValue('showFullServerAddress');
  const [servers, setServers] = React.useState<SshServerListItem[]>([]);
  const [folders, setFolders] = React.useState<SshFolder[]>([]);
  const [tags, setTags] = React.useState<SshTag[]>([]);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [search, setSearch] = React.useState<string>('');
  const [sortMode, setSortMode] = React.useState<SortMode>('default');
  const [activeServerId, setActiveServerId] = React.useState<string | null>(null);
  const [formState, setFormState] = React.useState<ServerEditorFormState>(
    createInitialFormState(defaultServerNoteTemplate),
  );
  const [isDeleteServerDialogOpen, setIsDeleteServerDialogOpen] = React.useState<boolean>(false);
  const [isDeletingServer, setIsDeletingServer] = React.useState<boolean>(false);
  const [deleteServerDraft, setDeleteServerDraft] = React.useState<{ id: string; name: string } | null>(null);
  const activeServerIdRef = React.useRef<string | null>(null);
  const formStateRef = React.useRef<ServerEditorFormState>(formState);
  const credentialsCacheRef = React.useRef<Record<string, ServerCredentialCache>>({});
  const dirtyFieldKeysRef = React.useRef<Set<keyof ServerEditorFormState>>(new Set());
  const preferCreateModeRef = React.useRef<boolean>(false);

  const requiresPassword = formState.authType === 'password' || formState.authType === 'both';
  const requiresPrivateKey = formState.authType === 'key' || formState.authType === 'both';

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

  const reloadData = React.useCallback(async () => {
    setIsLoading(true);

    try {
      const [foldersResponse, serversResponse, tagsResponse] = await Promise.all([
        listSshFolders(),
        listSshServers(),
        listSshTags(),
      ]);
      const nextFolders = foldersResponse.data.items;
      const nextServers = serversResponse.data.items;
      const nextTags = tagsResponse.data.items;
      const nextDefaultServerNoteTemplate = defaultServerNoteTemplate;
      const currentActiveServerId = activeServerIdRef.current;
      const currentFormState = formStateRef.current;
      const dirtyFieldKeys = dirtyFieldKeysRef.current;

      setFolders(nextFolders);
      setServers(nextServers);
      setTags(nextTags);

      if (consumeSshEditorCreateMode()) {
        preferCreateModeRef.current = true;
      }

      if (preferCreateModeRef.current) {
        setActiveServerId(null);
        if (currentActiveServerId === null) {
          setFormState(currentFormState);
        } else {
          resetDirtyFieldKeys();
          setFormState(createInitialFormState(nextDefaultServerNoteTemplate));
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
          setFormState(createInitialFormState(nextDefaultServerNoteTemplate));
        }
        return;
      }

      const preferredServerId = getActiveSshServerId();
      const currentId =
        currentActiveServerId && nextServers.some((server) => server.id === currentActiveServerId)
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
  }, [defaultServerNoteTemplate, notifyError, resetDirtyFieldKeys]);

  React.useEffect(() => {
    void reloadData();
  }, [reloadData]);

  React.useEffect(() => {
    if (!activeServerId) {
      return;
    }

    let cancelled = false;
    const requestedServerId = activeServerId;

    const loadCredentials = async () => {
      try {
        const response = await getSshServerCredentials(requestedServerId);
        if (cancelled) {
          return;
        }

        const nextCredentials: ServerCredentialCache = {
          authType: response.data.authType,
          password: response.data.password ?? '',
          privateKey: response.data.privateKey ?? '',
          privateKeyPassphrase: response.data.privateKeyPassphrase ?? '',
        };

        credentialsCacheRef.current[requestedServerId] = nextCredentials;
        setFormState((previous) => ({
          ...(activeServerIdRef.current === requestedServerId
            ? mergeFormStatePreservingDirtyFields(
                previous,
                { ...previous, ...nextCredentials },
                dirtyFieldKeysRef.current,
              )
            : previous),
        }));
      } catch {
        if (!cancelled) {
          notifyError(t('ssh.credentialsLoadFailed'));
        }
      }
    };

    void loadCredentials();

    return () => {
      cancelled = true;
    };
  }, [activeServerId, notifyError]);

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
      setActiveSshServerId(serverId);
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
      const normalizedName = name.trim();
      if (!normalizedName) {
        return null;
      }

      const existingTag = tags.find((tag) => tag.name.toLowerCase() === normalizedName.toLowerCase());
      if (existingTag) {
        return existingTag;
      }

      try {
        const createdResponse = await createSshTag({ name: normalizedName });
        const createdTag = createdResponse.data.item;

        setTags((previous) => [...previous, createdTag]);
        return createdTag;
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('ssh.createTagFailed'));
        return null;
      }
    },
    [notifyError, tags],
  );

  const importPrivateKeyFromFile = React.useCallback(async () => {
    try {
      const result = await window.electron?.importPrivateKeyFromFile?.();
      if (!result || result.canceled) {
        return;
      }

      if (typeof result.content !== 'string') {
        notifyError(t('ssh.privateKeyImportFailed'));
        return;
      }

      onChangeForm('privateKey', result.content);
      notifySuccess(t('ssh.privateKeyImportSuccess'));
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('ssh.privateKeyImportFailed'));
    }
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
    setActiveSshServerId('');
    setActiveServerId(null);
    setFormState(createInitialFormState(defaultServerNoteTemplate));
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
        setActiveSshServerId('');
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

        if (activeServerId) {
          const targetServer = servers.find((server) => server.id === activeServerId);
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

          await updateSshServer(activeServerId, {
            name: formState.name.trim(),
            host: formState.host.trim(),
            port,
            username: formState.username.trim(),
            authType: formState.authType,
            iconKey: formState.iconKey,
            colorKey: isEntityColorKey(formState.colorKey) ? formState.colorKey : undefined,
            password: formState.password.trim() || undefined,
            privateKey: formState.privateKey.trim() || undefined,
            privateKeyPassphrase: formState.privateKeyPassphrase.trim() || undefined,
            folderId: formState.folderId || undefined,
            tagIds: formState.tagIds,
            note: formState.note.trim() || undefined,
          });
          resetDirtyFieldKeys();
          setActiveSshServerId(activeServerId);
          successMessage = t('ssh.serverUpdatedSuccessfully');
        } else {
          const created = await createSshServer({
            name: formState.name.trim(),
            host: formState.host.trim(),
            port,
            username: formState.username.trim(),
            authType: formState.authType,
            iconKey: formState.iconKey,
            colorKey: isEntityColorKey(formState.colorKey) ? formState.colorKey : undefined,
            password: formState.password.trim() || undefined,
            privateKey: formState.privateKey.trim() || undefined,
            privateKeyPassphrase: formState.privateKeyPassphrase.trim() || undefined,
            folderId: formState.folderId || undefined,
            tagIds: formState.tagIds,
            note: formState.note.trim() || undefined,
          });

          const createdServerId = created.data.item.id;
          resetDirtyFieldKeys();
          setActiveSshServerId(createdServerId);
          preferCreateModeRef.current = false;
        }

        await reloadData();
        notifySuccess(successMessage);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('ssh.saveServerFailed'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeServerId,
      formState,
      notifyError,
      notifySuccess,
      notifyWarning,
      reloadData,
      resetDirtyFieldKeys,
      requiresPassword,
      requiresPrivateKey,
      servers,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-3 py-2">
      <div className="flex min-h-0 flex-1 gap-3.5">
        <aside className="flex h-full w-[250px] shrink-0 flex-col">
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
        </aside>

        <div className="w-px shrink-0 bg-home-divider" />

        <main className="flex min-w-0 flex-1 flex-col pl-2">
          <div className="shrink-0 bg-bg pb-2">
            <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 pb-1 ps-2">
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
          </div>

          <div className="scrollbar-gutter-stable -me-2 min-h-0 flex-1 overflow-auto">
            <Form
              id="ssh-editor-form"
              className="mx-auto grid max-w-4xl gap-4 pb-4"
              onSubmit={(event) => void onSubmit(event)}
            >
              <section className="grid gap-3">
                <div className="flex items-end justify-between gap-4">
                  <EntityVisualPicker
                    visual={{
                      iconKey: formState.iconKey,
                      colorKey: isEntityColorKey(formState.colorKey) ? formState.colorKey : 'blue',
                    }}
                    label={t('home.iconSearchPlaceholder')}
                    onChange={(nextVisual) => {
                      onChangeForm('iconKey', nextVisual.iconKey);
                      onChangeForm('colorKey', nextVisual.colorKey);
                    }}
                  >
                    <button
                      type="button"
                      aria-label={t('home.editVisual')}
                    >
                      <EntityIcon
                        icon={
                          <span
                            className={classNames(
                              'inline-flex h-full w-full items-center justify-center rounded-md',
                              getEntityColorClassName(
                                isEntityColorKey(formState.colorKey) ? formState.colorKey : 'blue',
                              ),
                            )}
                          >
                            {renderEntityIcon(formState.iconKey)}
                          </span>
                        }
                        tone="flat"
                      />
                    </button>
                  </EntityVisualPicker>
                  <FormField className="flex-1">
                    <FormLabel htmlFor="ssh-editor-name">{t('ssh.columnName')}</FormLabel>
                    <FormControl>
                      <Input
                        id="ssh-editor-name"
                        value={formState.name}
                        placeholder={t('ssh.serverNamePlaceholder')}
                        className="w-[280px]"
                        onChange={(event) => onChangeForm('name', event.target.value)}
                      />
                    </FormControl>
                  </FormField>
                </div>

                <div className="px-2 pb-1 text-[15px] font-medium text-home-text-subtle">
                  {t('ssh.sectionBasicConnection')}
                </div>

                <div className="grid grid-cols-[5fr_2fr] gap-3">
                  <FormField>
                    <FormLabel htmlFor="ssh-editor-host">{t('ssh.columnHost')}</FormLabel>
                    <FormControl>
                      <Input
                        id="ssh-editor-host"
                        value={formState.host}
                        placeholder={t('ssh.hostPlaceholder')}
                        onChange={(event) => onHostChange(event.target.value)}
                      />
                    </FormControl>
                  </FormField>

                  <FormField>
                    <FormLabel htmlFor="ssh-editor-port">{t('ssh.columnPort')}</FormLabel>
                    <FormControl>
                      <Input
                        id="ssh-editor-port"
                        value={formState.port}
                        placeholder={t('ssh.portPlaceholder')}
                        inputMode="numeric"
                        onChange={(event) => onChangeForm('port', event.target.value)}
                      />
                    </FormControl>
                  </FormField>
                </div>
              </section>

              <section className="grid gap-3">
                <div className="px-2 pb-1 text-[15px] font-medium text-home-text-subtle">
                  {t('ssh.sectionAuthentication')}
                </div>

                <div className="grid grid-cols-[5fr_2fr] gap-3">
                  <FormField>
                    <FormLabel htmlFor="ssh-editor-username">{t('ssh.columnUser')}</FormLabel>
                    <FormControl>
                      <Input
                        id="ssh-editor-username"
                        value={formState.username}
                        placeholder={t('ssh.usernamePlaceholder')}
                        onChange={(event) => onChangeForm('username', event.target.value)}
                      />
                    </FormControl>
                  </FormField>

                  <FormField>
                    <FormLabel htmlFor="ssh-editor-auth-type">{t('ssh.columnAuth')}</FormLabel>
                    <FormControl>
                      <Select
                        value={formState.authType}
                        onValueChange={(value) => onChangeForm('authType', value as SshAuthType)}
                      >
                        <SelectTrigger id="ssh-editor-auth-type">
                          <SelectValue placeholder={t('ssh.authTypePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="password">{t('ssh.authTypePassword')}</SelectItem>
                          <SelectItem value="key">{t('ssh.authTypeKey')}</SelectItem>
                          <SelectItem value="both">{t('ssh.authTypeBoth')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormField>
                </div>

                {requiresPassword ? (
                  <FormField>
                    <FormLabel htmlFor="ssh-editor-password">{t('ssh.passwordLabel')}</FormLabel>
                    <FormControl>
                      <PasswordField
                        id="ssh-editor-password"
                        value={formState.password}
                        placeholder={
                          activeServer?.hasPassword ? t('ssh.passwordSavedPlaceholder') : t('ssh.passwordPlaceholder')
                        }
                        onChange={(event) => onChangeForm('password', event.target.value)}
                      />
                    </FormControl>
                    {activeServer?.hasPassword && !formState.password.trim() ? (
                      <FormMessage>{t('ssh.passwordSavedHint')}</FormMessage>
                    ) : null}
                  </FormField>
                ) : null}

                {requiresPrivateKey ? (
                  <>
                    <FormField>
                      <FormLabel htmlFor="ssh-editor-private-key">{t('ssh.privateKeyLabel')}</FormLabel>
                      <FormControl>
                        <Textarea
                          id="ssh-editor-private-key"
                          value={formState.privateKey}
                          placeholder={
                            activeServer?.hasPrivateKey
                              ? t('ssh.privateKeySavedPlaceholder')
                              : t('ssh.privateKeyPlaceholder')
                          }
                          rows={5}
                          contextMenuItems={privateKeyContextMenuItems}
                          onChange={(event) => onChangeForm('privateKey', event.target.value)}
                        />
                      </FormControl>
                      <FormMessage>
                        {formState.privateKey.length > 0 && formState.privateKey.length < 32
                          ? t('ssh.privateKeyTooShort')
                          : ''}
                      </FormMessage>
                    </FormField>

                    <FormField>
                      <FormLabel htmlFor="ssh-editor-private-key-passphrase">
                        {t('ssh.privateKeyPassphraseLabel')}
                      </FormLabel>
                      <FormControl>
                        <PasswordField
                          id="ssh-editor-private-key-passphrase"
                          value={formState.privateKeyPassphrase}
                          placeholder={t('ssh.optionalPlaceholder')}
                          onChange={(event) => onChangeForm('privateKeyPassphrase', event.target.value)}
                        />
                      </FormControl>
                    </FormField>
                  </>
                ) : null}
              </section>

              <section className="grid gap-3">
                <div className="px-2 pb-1 text-[15px] font-medium text-home-text-subtle">
                  {t('ssh.sectionSecurity')}
                </div>
                <div className="flex items-center gap-2.5 px-2.5">
                  <Switch
                    id="ssh-editor-strict-host-key"
                    checked={formState.strictHostKey}
                    onCheckedChange={(checkedState) => onChangeForm('strictHostKey', checkedState)}
                  />
                  <Label
                    htmlFor="ssh-editor-strict-host-key"
                    className={formStyles.inlineLabel}
                  >
                    {t('ssh.strictHostKeyChecking')}
                  </Label>
                </div>
              </section>

              <section className="grid gap-3">
                <div className="px-2 pb-1 text-[15px] font-medium text-home-text-subtle">
                  {t('ssh.sectionSettings')}
                </div>

                <div className="grid grid-cols-[1fr_1fr] gap-3">
                  <FormField>
                    <FormLabel htmlFor="ssh-editor-folder">{t('ssh.columnFolder')}</FormLabel>
                    <FormControl>
                      <Select
                        value={formState.folderId || NO_FOLDER_SELECT_VALUE}
                        onValueChange={(value) => {
                          if (value === CREATE_FOLDER_SELECT_VALUE) {
                            onCreateFolder({ selectOnCreate: true });
                            return;
                          }

                          onChangeForm('folderId', value === NO_FOLDER_SELECT_VALUE ? '' : value);
                        }}
                      >
                        <SelectTrigger id="ssh-editor-folder">
                          <SelectValue placeholder={t('ssh.noFolder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_FOLDER_SELECT_VALUE}>{t('ssh.noFolder')}</SelectItem>
                          {folders.map((folder) => (
                            <SelectItem
                              key={folder.id}
                              value={folder.id}
                              icon={Folder}
                            >
                              {folder.name}
                            </SelectItem>
                          ))}
                          <SelectSeparator />
                          <SelectItem
                            value={CREATE_FOLDER_SELECT_VALUE}
                            icon={FolderPlus}
                          >
                            {t('home.quickAddFolder')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormField>

                  <FormField>
                    <FormLabel>{t('ssh.tagsLegend')}</FormLabel>
                    <FormControl>
                      <TagInput
                        tags={tags}
                        selectedTagIds={formState.tagIds}
                        menuTitle={t('ssh.tagsLegend')}
                        inputPlaceholder={t('ssh.tagNamePlaceholder')}
                        emptyText={t('ssh.emptyTags')}
                        disabled={isSubmitting}
                        onSelectedTagIdsChange={(nextTagIds) => onChangeForm('tagIds', nextTagIds)}
                        onCreateTag={onCreateTag}
                      />
                    </FormControl>
                  </FormField>
                </div>

                <FormField>
                  <FormLabel htmlFor="ssh-editor-note">{t('ssh.noteLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                      id="ssh-editor-note"
                      value={formState.note}
                      placeholder={t('ssh.notePlaceholder')}
                      rows={4}
                      onChange={(event) => onChangeForm('note', event.target.value)}
                    />
                  </FormControl>
                </FormField>
              </section>
            </Form>
          </div>
        </main>
      </div>

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
    </div>
  );
};

export default SSHEditor;
