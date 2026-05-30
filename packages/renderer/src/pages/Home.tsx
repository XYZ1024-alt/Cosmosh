import type { ApiSshUpdateServerRequest, components } from '@cosmosh/api-contract';
import classNames from 'classnames';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpDown,
  CalendarPlus,
  Clock3,
  Copy,
  CornerUpRight,
  FolderOpen,
  FolderPlus,
  Hash,
  KeyRound,
  Link,
  Network,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  Server,
  Star,
  StarOff,
  Tags,
  Terminal,
  Trash2,
} from 'lucide-react';
import React from 'react';

import CreateFolderDialog from '../components/home/CreateFolderDialog';
import EntityCard from '../components/home/EntityCard';
import EntityIcon from '../components/home/EntityIcon';
import EntityVisualPicker from '../components/home/EntityVisualPicker';
import HomeEmptyState from '../components/home/HomeEmptyState';
import SplitWorkbenchLayout, { SplitWorkbenchMainPanel } from '../components/layout/SplitWorkbenchLayout';
import SSHKeychainEditorDialog from '../components/ssh/SSHKeychainEditorDialog';
import SSHServerEditorDialog from '../components/ssh/SSHServerEditorDialog';
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { menuStyles } from '../components/ui/menu-styles';
import { Menubar, MenubarSeparator, MenuToggleGroup, MenuToggleGroupItem } from '../components/ui/menubar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import type { LocalTerminalProfile } from '../lib/api/transport';
import {
  createSshTag,
  deleteSshServer,
  listLocalTerminalProfiles,
  listSshFolders,
  listSshKeychains,
  listSshServers,
  listSshTags,
  updateSshServer,
} from '../lib/backend';
import { createEntityIconNode, EntityColorKey, isEntityColorKey } from '../lib/entity-visuals';
import { normalizeFolderName, removeFolder, renameFolder } from '../lib/folder-actions';
import { consumeOpenLocalTerminalListRequest } from '../lib/home-target';
import { getLocale, t } from '../lib/i18n';
import { resolveServerAddressForDisplay } from '../lib/server-address';
import { useSettingsValue } from '../lib/settings-store';
import {
  filterSharedKeychains,
  type KeychainEditorInitialFormState,
  type SshKeychainListItem,
} from '../lib/ssh-keychain-editor-shared';
import { toLocalTerminalTargetId } from '../lib/ssh-target';
import { useToast } from '../lib/toast-context';
import { useCreateFolderDialog } from '../lib/use-create-folder-dialog';
import { useDirectionalNavigation } from '../lib/use-directional-navigation';
import { useKeychainEditorDialogState } from '../lib/use-keychain-editor-dialog-state';
import { useServerEditorDialogState } from '../lib/use-server-editor-dialog-state';

type HomeProps = {
  onOpenSSH: (serverId: string, tabTitle?: string, options?: { openInNewTab?: boolean }) => void;
  onOpenSFTP: (
    serverId: string,
    tabTitle?: string,
    options?: { openInNewTab?: boolean; iconColorKey?: EntityColorKey },
  ) => void;
  isActive: boolean;
};

type SshServerListItem = components['schemas']['SshServerListItem'];
type SshFolder = components['schemas']['SshFolder'];
type HomeMode = 'ssh' | 'keychains' | 'portForwarding';
type QuickFilter = 'none' | 'recent' | 'favorite';
type GroupMode = 'none' | 'lastUsed' | 'tag';
type SortMode = 'nameAsc' | 'nameDesc' | 'lastUsed' | 'createdAt';
type HomeEntityKind = 'server' | 'keychain' | 'portForwarding';

type ServerGroup = {
  key: string;
  title: string;
  items: SshServerListItem[];
};

type KeychainGroup = {
  key: string;
  title: string;
  items: SshKeychainListItem[];
};

type HomeGridNavigation = ReturnType<typeof useDirectionalNavigation>;

type SidebarCardItem = {
  key: string;
  folderId?: string;
  title: string;
  subtitle: string;
  selected: boolean;
  iconKey: string;
  colorKey: EntityColorKey;
  onClick: () => void;
};

const LOCAL_TERMINAL_FOLDER_ID = '__local_terminals__';
const KEYCHAIN_RECENT_LIMIT = 12;

const homeModeEntityKindMap: Record<HomeMode, HomeEntityKind> = {
  ssh: 'server',
  keychains: 'keychain',
  portForwarding: 'portForwarding',
};

const homeModeItems: Array<{ value: HomeMode; icon: React.ComponentType<{ className?: string }>; labelKey: string }> = [
  {
    value: 'ssh',
    icon: Terminal,
    labelKey: 'home.modeSsh',
  },
  {
    value: 'keychains',
    icon: KeyRound,
    labelKey: 'home.modeKeychains',
  },
  {
    value: 'portForwarding',
    icon: CornerUpRight,
    labelKey: 'home.modePortForwarding',
  },
];

/**
 * Checks whether a tag is the internal "favorite" tag.
 * This tag is used behind the scenes to power the favorites feature
 * and should never be displayed in user-facing tag lists or groups.
 */
const isFavoriteTag = (tagName: string): boolean => tagName.toLowerCase().includes('favorite');

/**
 * Returns the localized count label for the active home mode.
 *
 * @param kind The entity kind represented by the current tab.
 * @param count Number of entities in the group.
 * @returns Localized count label for sidebar cards.
 */
const resolveHomeEntityCountLabel = (kind: HomeEntityKind, count: number): string => {
  if (kind === 'keychain') {
    return t('home.keychainCount', { count });
  }

  if (kind === 'portForwarding') {
    return t('home.portForwardingCount', { count });
  }

  return t('home.hostCount', { count });
};

/**
 * Checks whether a keychain is marked as favorite through the shared tag model.
 *
 * @param keychain Keychain list item.
 * @returns True when a keychain has a favorite tag.
 */
const isKeychainFavorite = (keychain: SshKeychainListItem): boolean => {
  return (keychain.tags ?? []).some((tag) => isFavoriteTag(tag.name));
};

/**
 * Reads a sortable timestamp from keychain metadata.
 *
 * @param keychain Keychain list item.
 * @param field Timestamp field to read.
 * @returns Numeric timestamp or zero when unavailable.
 */
const getKeychainTimestamp = (keychain: SshKeychainListItem, field: 'createdAt' | 'updatedAt'): number => {
  return new Date(keychain[field]).getTime();
};

const resolveGreetingPeriod = (now: Date): 'morning' | 'afternoon' | 'evening' => {
  const hour = now.getHours();
  if (hour < 12) {
    return 'morning';
  }

  if (hour < 18) {
    return 'afternoon';
  }

  return 'evening';
};

const hashString = (value: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return hash >>> 0;
};

type HomeModeTabsProps = {
  activeMode: HomeMode;
  onModeChange: (mode: HomeMode) => void;
};

/**
 * Renders the Home sidebar mode switcher.
 *
 * @param props Component props.
 * @param props.activeMode Current selected home mode.
 * @param props.onModeChange Callback fired when a mode is selected.
 * @returns Sidebar-width equal-segment mode tabs.
 */
const HomeModeTabs: React.FC<HomeModeTabsProps> = ({ activeMode, onModeChange }) => {
  return (
    <TooltipProvider delayDuration={180}>
      <div className="pb-4">
        <MenuToggleGroup
          type="single"
          value={activeMode}
          className="flex w-full"
          onValueChange={(value) => {
            if (value === 'ssh' || value === 'keychains' || value === 'portForwarding') {
              onModeChange(value);
            }
          }}
        >
          {homeModeItems.map((item) => {
            const Icon = item.icon;
            const label = t(item.labelKey);
            const isActive = activeMode === item.value;

            return (
              <Tooltip key={item.value}>
                <TooltipTrigger asChild>
                  <MenuToggleGroupItem
                    value={item.value}
                    aria-label={label}
                    className={classNames(
                      'flex-1 justify-center px-0 text-header-text',
                      isActive ? '!bg-home-card-active shadow-menu' : '!bg-menu-control hover:!bg-menu-control-hover',
                    )}
                  >
                    <Icon className="h-4 w-4 text-header-text" />
                    <span className="sr-only">{label}</span>
                  </MenuToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </MenuToggleGroup>
      </div>
    </TooltipProvider>
  );
};

type HomeKeychainsContentProps = {
  groups: KeychainGroup[];
  gridIndexMap: Map<string, number>;
  gridNavigation: HomeGridNavigation;
  onEditKeychain: (keychainId: string) => void;
};

/**
 * Renders shared keychains for the selected Home folder/filter scope.
 *
 * @param props Component props.
 * @param props.groups Grouped keychain rows.
 * @param props.gridIndexMap Map from rendered row key to keyboard navigation index.
 * @param props.gridNavigation Keyboard navigation helpers for keychain cards.
 * @param props.onEditKeychain Callback fired when a keychain card is selected.
 * @returns Keychain card grid.
 */
const HomeKeychainsContent: React.FC<HomeKeychainsContentProps> = ({
  groups,
  gridIndexMap,
  gridNavigation,
  onEditKeychain,
}) => {
  return (
    <div className="space-y-4 pb-2">
      {groups.map((group) => (
        <section key={group.key}>
          {group.title ? (
            <div className="px-2 pb-2.5 text-[13px] font-medium text-home-text-subtle">{group.title}</div>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,250px)] gap-x-7 gap-y-3">
            {group.items.map((keychain) => {
              const keychainEntryKey = `${group.key}:${keychain.id}`;
              const keychainEntryIndex = gridIndexMap.get(keychainEntryKey) ?? 0;
              const colorKey = isEntityColorKey(keychain.colorKey) ? keychain.colorKey : 'emerald';

              return (
                <EntityCard
                  key={keychainEntryKey}
                  {...gridNavigation.getItemProps(keychainEntryIndex)}
                  layout="grid"
                  title={keychain.name}
                  subtitle={t('sshKeychain.visibilityShared')}
                  icon={createEntityIconNode(
                    {
                      iconKey: keychain.iconKey,
                      colorKey,
                    },
                    keychain.name,
                  )}
                  onClick={() => onEditKeychain(keychain.id)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

type HomeSshContentProps = {
  activeFolderId: string;
  groupedServers: ServerGroup[];
  filteredLocalTerminalProfiles: LocalTerminalProfile[];
  localTerminalGridNavigation: HomeGridNavigation;
  serverGridIndexMap: Map<string, number>;
  serverGridNavigation: HomeGridNavigation;
  draggingServerId: string | null;
  showFullServerAddress: boolean;
  localTerminalFileManagerLabel: string;
  openInNewTabShortcutLabel: string;
  onOpenSSH: HomeProps['onOpenSSH'];
  onOpenSFTP: HomeProps['onOpenSFTP'];
  onShowInFileManager: (targetPath: string) => void;
  onOpenServerFromCard: (
    server: SshServerListItem,
    event?: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
  ) => void;
  onSetDraggingServerId: (serverId: string | null) => void;
  onSetDragOverFolderId: (folderId: string | null) => void;
  isServerFavorite: (server: SshServerListItem) => boolean;
  onToggleFavorite: (server: SshServerListItem) => void;
  onCopyToClipboard: (value: string) => void;
  onEditServer: (serverId: string) => void;
  onDeleteServer: (serverId: string, serverName: string) => void;
};

/**
 * Renders the existing Home SSH and local-terminal card grids.
 *
 * @param props Component props.
 * @returns SSH/local-terminal content body.
 */
const HomeSshContent: React.FC<HomeSshContentProps> = ({
  activeFolderId,
  groupedServers,
  filteredLocalTerminalProfiles,
  localTerminalGridNavigation,
  serverGridIndexMap,
  serverGridNavigation,
  draggingServerId,
  showFullServerAddress,
  localTerminalFileManagerLabel,
  openInNewTabShortcutLabel,
  onOpenSSH,
  onOpenSFTP,
  onShowInFileManager,
  onOpenServerFromCard,
  onSetDraggingServerId,
  onSetDragOverFolderId,
  isServerFavorite,
  onToggleFavorite,
  onCopyToClipboard,
  onEditServer,
  onDeleteServer,
}) => {
  return (
    <div className="space-y-4 pb-2">
      {activeFolderId === LOCAL_TERMINAL_FOLDER_ID ? (
        <section>
          <div className="grid grid-cols-[repeat(auto-fill,250px)] gap-x-7 gap-y-3">
            {filteredLocalTerminalProfiles.map((profile, index) => (
              <ContextMenu key={profile.id}>
                <ContextMenuTrigger className="block">
                  <EntityCard
                    {...localTerminalGridNavigation.getItemProps(index)}
                    layout="grid"
                    title={profile.name}
                    subtitle={profile.command}
                    icon={createEntityIconNode({ iconKey: 'HardDrive', colorKey: 'blue' }, profile.name)}
                    onClick={() => onOpenSSH(toLocalTerminalTargetId(profile.id), profile.name)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    icon={Terminal}
                    onSelect={() => onOpenSSH(toLocalTerminalTargetId(profile.id), profile.name)}
                  >
                    {t('home.contextConnect')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    icon={FolderOpen}
                    onSelect={() => {
                      onShowInFileManager(profile.executablePath);
                    }}
                  >
                    {localTerminalFileManagerLabel}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled
                    className="text-xs text-home-text-subtle"
                  >
                    {t('home.contextLocalTerminalManagedHint')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </section>
      ) : (
        groupedServers.map((group) => (
          <section key={group.key}>
            {group.title ? (
              <div className="px-2 pb-2.5 text-[13px] font-medium text-home-text-subtle">{group.title}</div>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fill,250px)] gap-x-7 gap-y-3">
              {group.items.map((server) => {
                const serverEntryKey = `${group.key}:${server.id}`;
                const serverEntryIndex = serverGridIndexMap.get(serverEntryKey) ?? 0;
                const colorKey = isEntityColorKey(server.colorKey) ? server.colorKey : 'blue';
                return (
                  <ContextMenu key={serverEntryKey}>
                    <ContextMenuTrigger className="block">
                      <EntityCard
                        {...serverGridNavigation.getItemProps(serverEntryIndex)}
                        draggable
                        layout="grid"
                        title={server.name}
                        subtitle={resolveServerAddressForDisplay(server.host, showFullServerAddress)}
                        className={draggingServerId === server.id ? 'opacity-70' : undefined}
                        icon={createEntityIconNode({ iconKey: server.iconKey, colorKey }, server.name)}
                        action={
                          <Button
                            variant="ghost"
                            tabIndex={serverEntryIndex === serverGridNavigation.activeIndex ? 0 : -1}
                            className="h-[32px] w-[32px] rounded-[8px] px-0 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                            aria-label={t('home.contextConnectSftp')}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenSFTP(server.id, server.name, {
                                openInNewTab: true,
                                iconColorKey: colorKey,
                              });
                            }}
                          >
                            <FolderOpen className="h-4 w-4 flex-shrink-0" />
                          </Button>
                        }
                        onDragStart={(event) => {
                          event.dataTransfer.setData('application/x-cosmosh-server-id', server.id);
                          event.dataTransfer.effectAllowed = 'move';
                          onSetDraggingServerId(server.id);
                        }}
                        onDragEnd={() => {
                          onSetDraggingServerId(null);
                          onSetDragOverFolderId(null);
                        }}
                        onClick={(event) => onOpenServerFromCard(server, event)}
                      />
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        icon={Terminal}
                        onSelect={() => onOpenSSH(server.id, server.name)}
                      >
                        {t('home.contextConnect')}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => onOpenSSH(server.id, server.name, { openInNewTab: true })}>
                        {t('home.openSshNewTab')}
                        <ContextMenuShortcut>{openInNewTabShortcutLabel}</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuItem
                        icon={FolderOpen}
                        onSelect={() => onOpenSFTP(server.id, server.name, { iconColorKey: colorKey })}
                      >
                        {t('home.contextConnectSftp')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        icon={isServerFavorite(server) ? StarOff : Star}
                        onSelect={() => {
                          onToggleFavorite(server);
                        }}
                      >
                        {isServerFavorite(server) ? t('home.contextUnfavorite') : t('home.contextFavorite')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger icon={Copy}>{t('home.contextCopy')}</ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <ContextMenuItem
                            icon={Network}
                            onSelect={() => {
                              onCopyToClipboard(server.host);
                            }}
                          >
                            {t('home.contextCopyIp')}
                          </ContextMenuItem>
                          <ContextMenuItem
                            icon={Server}
                            onSelect={() => {
                              onCopyToClipboard(server.name);
                            }}
                          >
                            {t('home.contextCopyName')}
                          </ContextMenuItem>
                          <ContextMenuItem
                            icon={Hash}
                            onSelect={() => {
                              onCopyToClipboard(String(server.port));
                            }}
                          >
                            {t('home.contextCopyPort')}
                          </ContextMenuItem>
                          <ContextMenuItem
                            icon={Link}
                            onSelect={() => {
                              onCopyToClipboard(`ssh://${server.username}@${server.host}:${server.port}`);
                            }}
                          >
                            {t('home.contextCopySchema')}
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        icon={Pencil}
                        onSelect={() => onEditServer(server.id)}
                      >
                        {t('home.contextEdit')}
                      </ContextMenuItem>
                      <ContextMenuItem
                        icon={Trash2}
                        onSelect={() => onDeleteServer(server.id, server.name)}
                      >
                        {t('home.contextDelete')}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

/**
 * Keeps the port-forwarding tab body intentionally empty until the feature lands.
 *
 * @returns Empty layout-preserving body.
 */
const HomePortForwardingContent: React.FC = () => {
  return <div className="min-h-[1px]" />;
};

const Home: React.FC<HomeProps> = ({ onOpenSSH, onOpenSFTP, isActive }) => {
  const { error: notifyError, success: notifySuccess, warning: notifyWarning } = useToast();
  const defaultServerNoteTemplate = useSettingsValue('defaultServerNoteTemplate');
  const showFullServerAddress = useSettingsValue('showFullServerAddress');
  const [activeHomeMode, setActiveHomeMode] = React.useState<HomeMode>('ssh');
  const [servers, setServers] = React.useState<SshServerListItem[]>([]);
  const [keychains, setKeychains] = React.useState<SshKeychainListItem[]>([]);
  const [folders, setFolders] = React.useState<SshFolder[]>([]);
  const [localTerminalProfiles, setLocalTerminalProfiles] = React.useState<LocalTerminalProfile[]>([]);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [activeFolderId, setActiveFolderId] = React.useState<string>('all');
  const [activeTag, setActiveTag] = React.useState<string>('all');
  const [search, setSearch] = React.useState<string>('');
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>('none');
  const [groupMode, setGroupMode] = React.useState<GroupMode>('lastUsed');
  const [sortMode, setSortMode] = React.useState<SortMode>('lastUsed');
  const [runtimeUserName, setRuntimeUserName] = React.useState<string>('user');
  const [isEditFolderDialogOpen, setIsEditFolderDialogOpen] = React.useState<boolean>(false);
  const [isDeleteFolderDialogOpen, setIsDeleteFolderDialogOpen] = React.useState<boolean>(false);
  const [isDeleteServerDialogOpen, setIsDeleteServerDialogOpen] = React.useState<boolean>(false);
  const [folderNameInput, setFolderNameInput] = React.useState<string>('');
  const [activeFolderDraft, setActiveFolderDraft] = React.useState<{
    id: string;
    name: string;
    iconKey: string;
    colorKey: EntityColorKey;
  } | null>(null);
  const [activeServerDraft, setActiveServerDraft] = React.useState<{ id: string; name: string } | null>(null);
  const [isFolderActionSubmitting, setIsFolderActionSubmitting] = React.useState<boolean>(false);
  const [isServerDeleteSubmitting, setIsServerDeleteSubmitting] = React.useState<boolean>(false);
  const [draggingServerId, setDraggingServerId] = React.useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = React.useState<string | null>(null);
  const previousIsActiveRef = React.useRef<boolean>(isActive);

  const reloadHomeData = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const [foldersResponse, serversResponse, keychainsResponse, localTerminalProfilesResponse] = await Promise.all([
        listSshFolders(),
        listSshServers(),
        listSshKeychains(),
        listLocalTerminalProfiles(),
      ]);
      setFolders(foldersResponse.data.items);
      setServers(serversResponse.data.items);
      setKeychains(filterSharedKeychains(keychainsResponse.data.items));
      setLocalTerminalProfiles(localTerminalProfilesResponse.data.items);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load home data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Builds a safe SSH server update payload for Home actions.
   * Home operations must preserve keychain linkage instead of inline credentials,
   * otherwise backend validation may incorrectly require private key/password fields.
   */
  const buildServerUpdatePayload = React.useCallback(
    (server: SshServerListItem, overrides: Partial<ApiSshUpdateServerRequest> = {}): ApiSshUpdateServerRequest => {
      if (!server.keychainId) {
        throw new Error('Server keychain reference is missing. Please refresh and try again.');
      }

      const basePayload: ApiSshUpdateServerRequest = {
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        keychainId: server.keychainId,
        strictHostKey: server.strictHostKey,
        note: server.note ?? undefined,
        folderId: server.folder?.id,
      };

      return {
        ...basePayload,
        ...overrides,
      };
    },
    [],
  );

  const createFolderDialog = useCreateFolderDialog({
    onCreated: async () => {
      await reloadHomeData();
    },
  });

  React.useEffect(() => {
    void reloadHomeData();
  }, [reloadHomeData]);

  React.useEffect(() => {
    if (activeHomeMode !== 'ssh' && activeFolderId === LOCAL_TERMINAL_FOLDER_ID) {
      setActiveFolderId('all');
      setQuickFilter('none');
    }
  }, [activeFolderId, activeHomeMode]);

  React.useEffect(() => {
    const becameActive = !previousIsActiveRef.current && isActive;
    previousIsActiveRef.current = isActive;

    if (isActive && consumeOpenLocalTerminalListRequest()) {
      setActiveFolderId(LOCAL_TERMINAL_FOLDER_ID);
    }

    if (becameActive) {
      void reloadHomeData();
    }
  }, [isActive, reloadHomeData]);

  React.useEffect(() => {
    const loadUserName = async () => {
      const user = await window.electron?.getRuntimeUserName?.();
      if (typeof user === 'string' && user.trim().length > 0) {
        setRuntimeUserName(user.trim());
      }
    };

    void loadUserName();
  }, []);

  const greeting = React.useMemo(() => {
    const now = new Date();
    const period = resolveGreetingPeriod(now);
    const dateSeed = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const locale = getLocale();

    const variants: Record<typeof period, string[]> = {
      morning: ['home.greetingMorningPrimary', 'home.greetingMorningSecondary'],
      afternoon: ['home.greetingAfternoonPrimary', 'home.greetingAfternoonSecondary'],
      evening: ['home.greetingEveningPrimary', 'home.greetingEveningSecondary'],
    };

    const seed = hashString(`${dateSeed}:${runtimeUserName}:${period}:${locale}`);
    const variant = variants[period][seed % variants[period].length];
    return t(variant);
  }, [runtimeUserName]);

  const favoriteCount = React.useMemo(() => {
    return servers.filter((server) => (server.tags ?? []).some((tag) => isFavoriteTag(tag.name))).length;
  }, [servers]);

  const recentCount = React.useMemo(() => {
    return servers.filter((server) => Boolean(server.lastLoginAudit?.attemptedAt)).length;
  }, [servers]);

  const keychainFavoriteCount = React.useMemo(() => {
    return keychains.filter((keychain) => isKeychainFavorite(keychain)).length;
  }, [keychains]);

  const recentKeychains = React.useMemo(() => {
    return [...keychains]
      .sort((left, right) => getKeychainTimestamp(right, 'updatedAt') - getKeychainTimestamp(left, 'updatedAt'))
      .slice(0, KEYCHAIN_RECENT_LIMIT);
  }, [keychains]);

  const recentKeychainIdSet = React.useMemo(() => {
    return new Set(recentKeychains.map((keychain) => keychain.id));
  }, [recentKeychains]);

  const activeEntityKind = homeModeEntityKindMap[activeHomeMode];

  const tagSourceServers = React.useMemo(() => {
    return servers.filter((server) => {
      if (activeFolderId === LOCAL_TERMINAL_FOLDER_ID) {
        return false;
      }

      if (activeFolderId !== 'all' && server.folder?.id !== activeFolderId) {
        return false;
      }

      if (quickFilter === 'recent' && !server.lastLoginAudit?.attemptedAt) {
        return false;
      }

      if (quickFilter === 'favorite') {
        return (server.tags ?? []).some((tag) => isFavoriteTag(tag.name));
      }

      return true;
    });
  }, [servers, activeFolderId, quickFilter]);

  const tagSourceKeychains = React.useMemo(() => {
    return keychains.filter((keychain) => {
      if (activeFolderId !== 'all' && keychain.folder?.id !== activeFolderId) {
        return false;
      }

      if (quickFilter === 'recent') {
        return recentKeychainIdSet.has(keychain.id);
      }

      if (quickFilter === 'favorite') {
        return isKeychainFavorite(keychain);
      }

      return true;
    });
  }, [activeFolderId, keychains, quickFilter, recentKeychainIdSet]);

  const tags = React.useMemo(() => {
    if (activeHomeMode === 'portForwarding' || activeFolderId === LOCAL_TERMINAL_FOLDER_ID) {
      return ['all'];
    }

    const nameSet = new Set<string>();
    const sourceItems = activeHomeMode === 'keychains' ? tagSourceKeychains : tagSourceServers;
    sourceItems.forEach((item) => {
      (item.tags ?? []).forEach((tag) => {
        /* Hide the internal "favorite" tag from user-facing tag filters */
        if (!isFavoriteTag(tag.name)) {
          nameSet.add(tag.name);
        }
      });
    });

    return ['all', ...Array.from(nameSet)];
  }, [activeFolderId, activeHomeMode, tagSourceKeychains, tagSourceServers]);

  React.useEffect(() => {
    if (!tags.includes(activeTag)) {
      setActiveTag('all');
    }
  }, [tags, activeTag]);

  const filteredServers = React.useMemo(() => {
    return servers.filter((server) => {
      if (activeFolderId === LOCAL_TERMINAL_FOLDER_ID) {
        return false;
      }

      if (activeFolderId !== 'all' && server.folder?.id !== activeFolderId) {
        return false;
      }

      if (quickFilter === 'recent' && !server.lastLoginAudit?.attemptedAt) {
        return false;
      }

      if (quickFilter === 'favorite') {
        const isFavorite = (server.tags ?? []).some((tag) => isFavoriteTag(tag.name));
        if (!isFavorite) {
          return false;
        }
      }

      if (activeTag !== 'all' && !(server.tags ?? []).some((tag) => tag.name === activeTag)) {
        return false;
      }

      if (!search.trim()) {
        return true;
      }

      const keyword = search.trim().toLowerCase();
      return (
        server.name.toLowerCase().includes(keyword) ||
        server.host.toLowerCase().includes(keyword) ||
        server.username.toLowerCase().includes(keyword)
      );
    });
  }, [servers, activeFolderId, quickFilter, activeTag, search]);

  const filteredKeychains = React.useMemo(() => {
    return keychains.filter((keychain) => {
      if (activeFolderId !== 'all' && keychain.folder?.id !== activeFolderId) {
        return false;
      }

      if (quickFilter === 'recent' && !recentKeychainIdSet.has(keychain.id)) {
        return false;
      }

      if (quickFilter === 'favorite' && !isKeychainFavorite(keychain)) {
        return false;
      }

      if (activeTag !== 'all' && !(keychain.tags ?? []).some((tag) => tag.name === activeTag)) {
        return false;
      }

      if (!search.trim()) {
        return true;
      }

      const keyword = search.trim().toLowerCase();
      return keychain.name.toLowerCase().includes(keyword) || (keychain.note ?? '').toLowerCase().includes(keyword);
    });
  }, [activeFolderId, activeTag, keychains, quickFilter, recentKeychainIdSet, search]);

  const filteredLocalTerminalProfiles = React.useMemo(() => {
    if (activeFolderId !== LOCAL_TERMINAL_FOLDER_ID) {
      return [];
    }

    const keyword = search.trim().toLowerCase();
    const sortedProfiles = [...localTerminalProfiles].sort((left, right) => left.name.localeCompare(right.name));

    if (!keyword) {
      return sortedProfiles;
    }

    return sortedProfiles.filter((profile) => {
      return (
        profile.name.toLowerCase().includes(keyword) ||
        profile.command.toLowerCase().includes(keyword) ||
        profile.id.toLowerCase().includes(keyword)
      );
    });
  }, [activeFolderId, localTerminalProfiles, search]);

  const sortServers = React.useCallback(
    (items: SshServerListItem[]): SshServerListItem[] => {
      return [...items].sort((left, right) => {
        if (sortMode === 'nameAsc') {
          return left.name.localeCompare(right.name);
        }

        if (sortMode === 'nameDesc') {
          return right.name.localeCompare(left.name);
        }

        if (sortMode === 'createdAt') {
          const leftTime = new Date(left.createdAt).getTime();
          const rightTime = new Date(right.createdAt).getTime();
          return rightTime - leftTime;
        }

        const leftTime = new Date(left.lastLoginAudit?.attemptedAt ?? 0).getTime();
        const rightTime = new Date(right.lastLoginAudit?.attemptedAt ?? 0).getTime();
        return rightTime - leftTime;
      });
    },
    [sortMode],
  );

  const groupedServers = React.useMemo<ServerGroup[]>(() => {
    if (groupMode === 'none') {
      return [
        {
          key: 'ungrouped:all',
          title: '',
          items: sortServers(filteredServers),
        },
      ];
    }

    if (groupMode === 'tag') {
      const tagNameSet = new Set<string>();
      filteredServers.forEach((server) => {
        (server.tags ?? []).forEach((tag) => {
          /* Exclude the internal "favorite" tag from visible tag groups */
          if (!isFavoriteTag(tag.name)) {
            tagNameSet.add(tag.name);
          }
        });
      });

      const tagGroups = Array.from(tagNameSet)
        .sort((left, right) => left.localeCompare(right))
        .map((tagName) => {
          const items = filteredServers.filter((server) => (server.tags ?? []).some((tag) => tag.name === tagName));

          return {
            key: `tag:${tagName}`,
            title: tagName,
            items: sortServers(items),
          };
        })
        .filter((group) => group.items.length > 0);

      /* Servers whose only tag is the hidden "favorite" tag are treated as untagged */
      const untaggedItems = sortServers(
        filteredServers.filter((server) => {
          const visibleTags = (server.tags ?? []).filter((tag) => !isFavoriteTag(tag.name));
          return visibleTags.length === 0;
        }),
      );

      if (untaggedItems.length > 0) {
        tagGroups.push({
          key: 'tag:untagged',
          title: t('home.tagUntagged'),
          items: untaggedItems,
        });
      }

      return tagGroups;
    }

    const now = Date.now();
    const dayMilliseconds = 24 * 60 * 60 * 1000;
    const recentThreshold = dayMilliseconds;
    const weekThreshold = 7 * dayMilliseconds;

    const recentItems = sortServers(
      filteredServers.filter((server) => {
        const attemptedAt = server.lastLoginAudit?.attemptedAt;
        if (!attemptedAt) {
          return false;
        }

        const elapsed = now - new Date(attemptedAt).getTime();
        return elapsed <= recentThreshold;
      }),
    );

    const weekItems = sortServers(
      filteredServers.filter((server) => {
        const attemptedAt = server.lastLoginAudit?.attemptedAt;
        if (!attemptedAt) {
          return false;
        }

        const elapsed = now - new Date(attemptedAt).getTime();
        return elapsed > recentThreshold && elapsed <= weekThreshold;
      }),
    );

    const otherItems = sortServers(
      filteredServers.filter((server) => {
        const attemptedAt = server.lastLoginAudit?.attemptedAt;
        if (!attemptedAt) {
          return true;
        }

        const elapsed = now - new Date(attemptedAt).getTime();
        return elapsed > weekThreshold;
      }),
    );

    return [
      {
        key: 'last-used:recent',
        title: t('home.sectionRecent'),
        items: recentItems,
      },
      {
        key: 'last-used:last-week',
        title: t('home.sectionLastWeek'),
        items: weekItems,
      },
      {
        key: 'last-used:other',
        title: t('home.sectionOlder'),
        items: otherItems,
      },
    ].filter((group) => group.items.length > 0);
  }, [filteredServers, groupMode, sortServers]);

  const sortKeychains = React.useCallback(
    (items: SshKeychainListItem[]): SshKeychainListItem[] => {
      return [...items].sort((left, right) => {
        if (sortMode === 'nameAsc') {
          return left.name.localeCompare(right.name);
        }

        if (sortMode === 'nameDesc') {
          return right.name.localeCompare(left.name);
        }

        if (sortMode === 'createdAt') {
          return getKeychainTimestamp(right, 'createdAt') - getKeychainTimestamp(left, 'createdAt');
        }

        return getKeychainTimestamp(right, 'updatedAt') - getKeychainTimestamp(left, 'updatedAt');
      });
    },
    [sortMode],
  );

  const groupedKeychains = React.useMemo<KeychainGroup[]>(() => {
    if (groupMode === 'none') {
      return [
        {
          key: 'keychain:ungrouped:all',
          title: '',
          items: sortKeychains(filteredKeychains),
        },
      ];
    }

    if (groupMode === 'tag') {
      const tagNameSet = new Set<string>();
      filteredKeychains.forEach((keychain) => {
        (keychain.tags ?? []).forEach((tag) => {
          if (!isFavoriteTag(tag.name)) {
            tagNameSet.add(tag.name);
          }
        });
      });

      const tagGroups = Array.from(tagNameSet)
        .sort((left, right) => left.localeCompare(right))
        .map((tagName) => {
          const items = filteredKeychains.filter((keychain) =>
            (keychain.tags ?? []).some((tag) => tag.name === tagName),
          );

          return {
            key: `keychain:tag:${tagName}`,
            title: tagName,
            items: sortKeychains(items),
          };
        })
        .filter((group) => group.items.length > 0);

      const untaggedItems = sortKeychains(
        filteredKeychains.filter((keychain) => {
          const visibleTags = (keychain.tags ?? []).filter((tag) => !isFavoriteTag(tag.name));
          return visibleTags.length === 0;
        }),
      );

      if (untaggedItems.length > 0) {
        tagGroups.push({
          key: 'keychain:tag:untagged',
          title: t('home.tagUntagged'),
          items: untaggedItems,
        });
      }

      return tagGroups;
    }

    return [
      {
        key: 'keychain:last-used:recent',
        title: t('home.sectionRecentlyUpdated'),
        items: sortKeychains(filteredKeychains),
      },
    ].filter((group) => group.items.length > 0);
  }, [filteredKeychains, groupMode, sortKeychains]);

  const selectedGroupName = React.useMemo(() => {
    if (quickFilter === 'recent') {
      return activeHomeMode === 'keychains'
        ? t('home.groupRecentlyUpdatedKeychains')
        : t('home.groupRecentConnections');
    }

    if (quickFilter === 'favorite') {
      return t('home.groupFavorite');
    }

    if (activeFolderId === 'all') {
      if (activeHomeMode === 'keychains') {
        return t('home.groupAllKeychains');
      }

      if (activeHomeMode === 'portForwarding') {
        return t('home.groupAllPortForwarding');
      }

      return t('home.groupAllHosts');
    }

    if (activeFolderId === LOCAL_TERMINAL_FOLDER_ID) {
      return t('home.groupLocalTerminals');
    }

    return folders.find((folder) => folder.id === activeFolderId)?.name ?? t('home.groupUntitled');
  }, [activeHomeMode, quickFilter, activeFolderId, folders]);

  const folderServerCountMap = React.useMemo(() => {
    const countMap = new Map<string, number>();
    servers.forEach((server) => {
      const folderId = server.folder?.id;
      if (!folderId) {
        return;
      }

      countMap.set(folderId, (countMap.get(folderId) ?? 0) + 1);
    });

    return countMap;
  }, [servers]);

  const folderKeychainCountMap = React.useMemo(() => {
    const countMap = new Map<string, number>();
    keychains.forEach((keychain) => {
      const folderId = keychain.folder?.id;
      if (!folderId) {
        return;
      }

      countMap.set(folderId, (countMap.get(folderId) ?? 0) + 1);
    });

    return countMap;
  }, [keychains]);

  const quickSidebarCards = React.useMemo<SidebarCardItem[]>(() => {
    const recentTitle =
      activeHomeMode === 'keychains' ? t('home.groupRecentlyUpdatedKeychains') : t('home.groupRecentConnections');
    const recentItemCount =
      activeHomeMode === 'keychains' ? recentKeychains.length : activeHomeMode === 'portForwarding' ? 0 : recentCount;
    const favoriteItemCount =
      activeHomeMode === 'keychains' ? keychainFavoriteCount : activeHomeMode === 'portForwarding' ? 0 : favoriteCount;

    return [
      {
        key: 'quick:recent',
        title: recentTitle,
        subtitle: resolveHomeEntityCountLabel(activeEntityKind, recentItemCount),
        selected: quickFilter === 'recent',
        iconKey: 'Cloud',
        colorKey: 'blue',
        onClick: () => {
          setActiveFolderId('all');
          setQuickFilter('recent');
        },
      },
      {
        key: 'quick:favorite',
        title: t('home.groupFavorite'),
        subtitle: resolveHomeEntityCountLabel(activeEntityKind, favoriteItemCount),
        selected: quickFilter === 'favorite',
        iconKey: 'Database',
        colorKey: 'amber',
        onClick: () => {
          setActiveFolderId('all');
          setQuickFilter('favorite');
        },
      },
    ];
  }, [
    activeEntityKind,
    activeHomeMode,
    favoriteCount,
    keychainFavoriteCount,
    quickFilter,
    recentCount,
    recentKeychains.length,
  ]);

  const folderSidebarCards = React.useMemo<SidebarCardItem[]>(() => {
    const userFolders = folders.map((folder) => {
      const count =
        activeHomeMode === 'keychains'
          ? (folderKeychainCountMap.get(folder.id) ?? 0)
          : activeHomeMode === 'portForwarding'
            ? 0
            : (folderServerCountMap.get(folder.id) ?? 0);
      const colorKey = isEntityColorKey(folder.colorKey) ? folder.colorKey : 'slate';

      return {
        key: `folder:${folder.id}`,
        folderId: folder.id,
        title: folder.name,
        subtitle: resolveHomeEntityCountLabel(activeEntityKind, count),
        selected: activeFolderId === folder.id,
        iconKey: folder.iconKey,
        colorKey,
        onClick: () => {
          setActiveFolderId(folder.id);
          setQuickFilter('none');
        },
      };
    });

    const localTerminalFolder =
      activeHomeMode === 'ssh'
        ? [
            {
              key: `folder:${LOCAL_TERMINAL_FOLDER_ID}`,
              folderId: LOCAL_TERMINAL_FOLDER_ID,
              title: t('home.groupLocalTerminals'),
              subtitle: t('home.hostCount', { count: localTerminalProfiles.length }),
              selected: activeFolderId === LOCAL_TERMINAL_FOLDER_ID,
              iconKey: 'HardDrive',
              colorKey: 'blue' as EntityColorKey,
              onClick: () => {
                setActiveFolderId(LOCAL_TERMINAL_FOLDER_ID);
                setQuickFilter('none');
              },
            },
          ]
        : [];

    return [...localTerminalFolder, ...userFolders];
  }, [
    activeEntityKind,
    activeFolderId,
    activeHomeMode,
    folderKeychainCountMap,
    folderServerCountMap,
    folders,
    localTerminalProfiles.length,
  ]);

  const allSidebarCard = React.useMemo<SidebarCardItem>(() => {
    const count =
      activeHomeMode === 'keychains' ? keychains.length : activeHomeMode === 'portForwarding' ? 0 : servers.length;
    const title =
      activeHomeMode === 'keychains'
        ? t('home.groupAllKeychains')
        : activeHomeMode === 'portForwarding'
          ? t('home.groupAllPortForwarding')
          : t('home.groupAllHosts');

    return {
      key: 'all',
      folderId: 'all',
      title,
      subtitle: resolveHomeEntityCountLabel(activeEntityKind, count),
      selected: activeFolderId === 'all' && quickFilter === 'none',
      iconKey: 'Folder',
      colorKey: 'slate',
      onClick: () => {
        setActiveFolderId('all');
        setQuickFilter('none');
      },
    };
  }, [activeEntityKind, activeFolderId, activeHomeMode, keychains.length, quickFilter, servers.length]);

  const selectedFolderCardIndex = React.useMemo(() => {
    return folderSidebarCards.findIndex((item) => item.selected);
  }, [folderSidebarCards]);

  const folderListNavigation = useDirectionalNavigation({
    itemCount: folderSidebarCards.length,
    columns: 1,
    initialIndex: selectedFolderCardIndex >= 0 ? selectedFolderCardIndex : 0,
  });

  const setFolderListActiveIndex = folderListNavigation.setActiveIndex;

  React.useEffect(() => {
    if (selectedFolderCardIndex >= 0) {
      setFolderListActiveIndex(selectedFolderCardIndex);
    }
  }, [selectedFolderCardIndex, setFolderListActiveIndex]);

  const serverGridEntries = React.useMemo(() => {
    return groupedServers.flatMap((group) => {
      return group.items.map((server) => ({
        key: `${group.key}:${server.id}`,
      }));
    });
  }, [groupedServers]);

  const serverGridIndexMap = React.useMemo(() => {
    const indexMap = new Map<string, number>();
    serverGridEntries.forEach((entry, index) => {
      indexMap.set(entry.key, index);
    });

    return indexMap;
  }, [serverGridEntries]);

  const serverGridNavigation = useDirectionalNavigation({
    itemCount: serverGridEntries.length,
    columns: 3,
    initialIndex: 0,
  });

  const localTerminalGridNavigation = useDirectionalNavigation({
    itemCount: filteredLocalTerminalProfiles.length,
    columns: 3,
    initialIndex: 0,
  });

  const keychainGridEntries = React.useMemo(() => {
    return groupedKeychains.flatMap((group) => {
      return group.items.map((keychain) => ({
        key: `${group.key}:${keychain.id}`,
      }));
    });
  }, [groupedKeychains]);

  const keychainGridIndexMap = React.useMemo(() => {
    const indexMap = new Map<string, number>();
    keychainGridEntries.forEach((entry, index) => {
      indexMap.set(entry.key, index);
    });

    return indexMap;
  }, [keychainGridEntries]);

  const keychainGridNavigation = useDirectionalNavigation({
    itemCount: keychainGridEntries.length,
    columns: 3,
    initialIndex: 0,
  });

  const groupModeIcon = React.useMemo(() => {
    if (groupMode === 'tag') {
      return Tags;
    }

    if (groupMode === 'none') {
      return Network;
    }

    return Clock3;
  }, [groupMode]);

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

  const localTerminalFileManagerLabel = React.useMemo(() => {
    const platform = window.electron?.platform;
    if (platform === 'win32') {
      return t('home.contextShowInFileExplorer');
    }

    if (platform === 'darwin') {
      return t('home.contextShowInFinder');
    }

    return t('home.contextShowInFileManager');
  }, []);

  const isMacPlatform = React.useMemo(() => window.electron?.platform === 'darwin', []);

  const {
    isServerEditorDialogOpen,
    activeServerEditorId,
    serverEditorInitialFolderId,
    openCreateServerDialog,
    openEditServerDialog,
    closeServerEditorDialog,
  } = useServerEditorDialogState({
    activeFolderId,
    servers,
    localTerminalFolderId: LOCAL_TERMINAL_FOLDER_ID,
    onServerNotFound: () => {
      notifyWarning(t('ssh.validationServerNotFound'));
    },
  });

  const openInNewTabShortcutLabel = React.useMemo(() => {
    const clickLabel = t('common.click');
    return isMacPlatform ? `⌘+${clickLabel}` : `Ctrl+${clickLabel}`;
  }, [isMacPlatform]);

  const {
    isKeychainEditorDialogOpen,
    activeKeychainEditorId,
    keychainEditorInitialFormState,
    openCreateKeychainDialog,
    openEditKeychainDialog,
    closeKeychainEditorDialog,
  } = useKeychainEditorDialogState({
    keychains,
    onKeychainNotFound: () => {
      notifyWarning(t('ssh.validationKeychainNotFound'));
    },
  });

  const openCreateKeychainFromHome = React.useCallback(() => {
    const initialFormState: KeychainEditorInitialFormState | undefined =
      activeFolderId !== 'all' && activeFolderId !== LOCAL_TERMINAL_FOLDER_ID && quickFilter === 'none'
        ? { folderId: activeFolderId }
        : undefined;

    openCreateKeychainDialog(initialFormState);
  }, [activeFolderId, openCreateKeychainDialog, quickFilter]);

  const handleAddAction = React.useCallback(() => {
    if (activeHomeMode === 'keychains') {
      openCreateKeychainFromHome();
      return;
    }

    if (activeHomeMode === 'portForwarding') {
      return;
    }

    openCreateServerDialog();
  }, [activeHomeMode, openCreateKeychainFromHome, openCreateServerDialog]);

  const openServerFromCard = React.useCallback(
    (server: SshServerListItem, event?: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
      const isModifierPressed = isMacPlatform ? event?.metaKey : event?.ctrlKey;
      const shouldOpenInNewTab = event?.type === 'click' && Boolean(isModifierPressed);

      onOpenSSH(server.id, server.name, { openInNewTab: shouldOpenInNewTab });
    },
    [isMacPlatform, onOpenSSH],
  );

  const handleCopyToClipboard = React.useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        notifySuccess(t('home.copySuccess'));
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : 'Failed to copy content to clipboard.');
      }
    },
    [notifyError, notifySuccess],
  );

  const handleShowInFileManager = React.useCallback(
    async (targetPath: string) => {
      try {
        const opened = await window.electron?.showInFileManager?.(targetPath);
        if (!opened) {
          notifyError(t('home.openInFileManagerFailed'));
        }
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('home.openInFileManagerFailed'));
      }
    },
    [notifyError],
  );

  const openEditFolderDialog = React.useCallback(
    (folderId: string, folderName: string, iconKey: string, colorKey: EntityColorKey) => {
      setActiveFolderDraft({ id: folderId, name: folderName, iconKey, colorKey });
      setFolderNameInput(folderName);
      setIsEditFolderDialogOpen(true);
    },
    [],
  );

  const openDeleteFolderDialog = React.useCallback(
    (folderId: string, folderName: string, iconKey: string, colorKey: EntityColorKey) => {
      setActiveFolderDraft({ id: folderId, name: folderName, iconKey, colorKey });
      setIsDeleteFolderDialogOpen(true);
    },
    [],
  );

  const openDeleteServerDialog = React.useCallback((serverId: string, serverName: string) => {
    setActiveServerDraft({ id: serverId, name: serverName });
    setIsDeleteServerDialogOpen(true);
  }, []);

  const submitEditFolder = React.useCallback(async () => {
    if (!activeFolderDraft) {
      return;
    }

    const folderName = normalizeFolderName(folderNameInput);
    if (!folderName) {
      notifyWarning(t('home.folderNameRequired'));
      return;
    }

    setIsFolderActionSubmitting(true);
    try {
      await renameFolder(activeFolderDraft.id, folderName, {
        iconKey: activeFolderDraft.iconKey,
        colorKey: activeFolderDraft.colorKey,
      });
      setIsEditFolderDialogOpen(false);
      setFolderNameInput('');
      setActiveFolderDraft(null);
      await reloadHomeData();
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('home.folderUpdateFailed'));
    } finally {
      setIsFolderActionSubmitting(false);
    }
  }, [activeFolderDraft, folderNameInput, notifyError, notifyWarning, reloadHomeData]);

  const submitDeleteFolder = React.useCallback(async () => {
    if (!activeFolderDraft) {
      return;
    }

    setIsFolderActionSubmitting(true);
    try {
      await removeFolder(activeFolderDraft.id);

      if (activeFolderId === activeFolderDraft.id) {
        setActiveFolderId('all');
        setQuickFilter('none');
      }

      setIsDeleteFolderDialogOpen(false);
      setActiveFolderDraft(null);
      await reloadHomeData();
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('home.folderDeleteFailed'));
    } finally {
      setIsFolderActionSubmitting(false);
    }
  }, [activeFolderDraft, activeFolderId, notifyError, reloadHomeData]);

  const submitDeleteServer = React.useCallback(async () => {
    if (!activeServerDraft) {
      return;
    }

    setIsServerDeleteSubmitting(true);
    try {
      const deleted = await deleteSshServer(activeServerDraft.id);
      if (!deleted.success) {
        throw new Error(t('home.serverDeleteFailed'));
      }

      setIsDeleteServerDialogOpen(false);
      setActiveServerDraft(null);
      await reloadHomeData();
      notifySuccess(t('home.serverDeleteSuccess'));
    } catch (error: unknown) {
      notifyError(error instanceof Error ? error.message : t('home.serverDeleteFailed'));
    } finally {
      setIsServerDeleteSubmitting(false);
    }
  }, [activeServerDraft, notifyError, notifySuccess, reloadHomeData]);

  const handleAssignServerToFolder = React.useCallback(
    async (serverId: string, folderId: string) => {
      const targetServer = servers.find((server) => server.id === serverId);
      if (!targetServer) {
        return;
      }

      if (targetServer.folder?.id === folderId) {
        return;
      }

      try {
        await updateSshServer(serverId, buildServerUpdatePayload(targetServer, { folderId }));

        await reloadHomeData();
        setActiveFolderId(folderId);
        setQuickFilter('none');
        notifySuccess(t('home.dragServerToFolderSuccess'));
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('home.dragServerToFolderFailed'));
      }
    },
    [buildServerUpdatePayload, notifyError, notifySuccess, reloadHomeData, servers],
  );

  /**
   * Checks whether a server is marked as favorite based on its tags.
   * A server is considered favorite when any of its tags contains "favorite" (case-insensitive).
   */
  const isServerFavorite = React.useCallback((server: SshServerListItem): boolean => {
    return (server.tags ?? []).some((tag) => isFavoriteTag(tag.name));
  }, []);

  /**
   * Toggles the favorite status of a server.
   * - If the server is not favorited, finds or creates a "favorite" tag and assigns it.
   * - If the server is already favorited, removes the favorite tag from the server.
   */
  const handleToggleFavorite = React.useCallback(
    async (server: SshServerListItem) => {
      try {
        const currentTags = server.tags ?? [];
        const isFavorite = isServerFavorite(server);

        let newTagIds: string[];

        if (isFavorite) {
          /* Remove all tags whose name matches the favorite pattern */
          newTagIds = currentTags.filter((tag) => !isFavoriteTag(tag.name)).map((tag) => tag.id);
        } else {
          /* Resolve or create the "favorite" tag, then append its ID */
          const tagsResponse = await listSshTags();
          let favoriteTag = tagsResponse.data.items.find((tag) => tag.name.toLowerCase() === 'favorite');

          if (!favoriteTag) {
            const createResponse = await createSshTag({ name: 'favorite' });
            favoriteTag = createResponse.data.item;
          }

          newTagIds = [...currentTags.map((tag) => tag.id), favoriteTag.id];
        }

        await updateSshServer(server.id, buildServerUpdatePayload(server, { tagIds: newTagIds }));

        await reloadHomeData();
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('home.contextFavoriteFailed'));
      }
    },
    [buildServerUpdatePayload, isServerFavorite, notifyError, reloadHomeData],
  );

  const handleHomeModeChange = React.useCallback(
    (mode: HomeMode) => {
      setActiveHomeMode(mode);
      if (mode !== 'ssh') {
        setActiveFolderId((currentFolderId) =>
          currentFolderId === LOCAL_TERMINAL_FOLDER_ID ? 'all' : currentFolderId,
        );
        if (activeFolderId === LOCAL_TERMINAL_FOLDER_ID) {
          setQuickFilter('none');
        }
      }
    },
    [activeFolderId],
  );

  return (
    <SplitWorkbenchLayout
      topSlot={
        <h1 className="px-2 pb-2 text-[28px] font-semibold text-header-text">
          {t('home.greetingWithUser', { greeting, name: runtimeUserName })}
        </h1>
      }
      sidebar={
        <div className="gutter-box-y min-h-0 flex-1 overflow-auto pb-2">
          <HomeModeTabs
            activeMode={activeHomeMode}
            onModeChange={handleHomeModeChange}
          />
          <div>
            <div className="pb-5">
              <div className="px-2 pb-2.5 text-xs font-medium text-home-text-subtle">{t('home.groupAll')}</div>
              <EntityCard
                title={allSidebarCard.title}
                subtitle={allSidebarCard.subtitle}
                selected={allSidebarCard.selected}
                icon={createEntityIconNode(
                  { iconKey: allSidebarCard.iconKey, colorKey: allSidebarCard.colorKey },
                  allSidebarCard.title,
                )}
                onClick={allSidebarCard.onClick}
              />
            </div>

            <div className="pb-5">
              <div className="px-2 pb-2.5 text-xs font-medium text-home-text-subtle">
                {t('home.groupFavoriteAndRecent')}
              </div>
              <div className="space-y-1.5">
                {quickSidebarCards.map((item) => (
                  <EntityCard
                    key={item.key}
                    title={item.title}
                    subtitle={item.subtitle}
                    selected={item.selected}
                    icon={createEntityIconNode({ iconKey: item.iconKey, colorKey: item.colorKey }, item.title)}
                    onClick={item.onClick}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="px-2 pb-2.5 text-xs font-medium text-home-text-subtle">{t('home.groupFolders')}</div>
              <div className="space-y-1.5">
                {folderSidebarCards.map((item, index) => (
                  <ContextMenu key={item.key}>
                    <ContextMenuTrigger className="block">
                      <EntityCard
                        {...folderListNavigation.getItemProps(index)}
                        title={item.title}
                        subtitle={item.subtitle}
                        selected={item.selected}
                        className={dragOverFolderId === item.folderId ? 'bg-home-card-active' : undefined}
                        icon={createEntityIconNode({ iconKey: item.iconKey, colorKey: item.colorKey }, item.title)}
                        onDragOver={(event) => {
                          if (
                            activeHomeMode !== 'ssh' ||
                            !item.folderId ||
                            item.folderId === LOCAL_TERMINAL_FOLDER_ID ||
                            !draggingServerId
                          ) {
                            return;
                          }

                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          if (dragOverFolderId !== item.folderId) {
                            setDragOverFolderId(item.folderId);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverFolderId === item.folderId) {
                            setDragOverFolderId(null);
                          }
                        }}
                        onDrop={(event) => {
                          if (
                            activeHomeMode !== 'ssh' ||
                            !item.folderId ||
                            item.folderId === LOCAL_TERMINAL_FOLDER_ID
                          ) {
                            return;
                          }

                          event.preventDefault();
                          const droppedServerId =
                            event.dataTransfer.getData('application/x-cosmosh-server-id') || draggingServerId;
                          if (!droppedServerId) {
                            return;
                          }

                          setDragOverFolderId(null);
                          setDraggingServerId(null);
                          void handleAssignServerToFolder(droppedServerId, item.folderId);
                        }}
                        onClick={item.onClick}
                      />
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        icon={FolderOpen}
                        onSelect={item.onClick}
                      >
                        {t('home.contextOpenFolder')}
                      </ContextMenuItem>
                      <ContextMenuItem
                        icon={Pencil}
                        disabled={item.folderId === LOCAL_TERMINAL_FOLDER_ID}
                        onSelect={() => {
                          const folderId = item.folderId;
                          if (!folderId || folderId === LOCAL_TERMINAL_FOLDER_ID) {
                            return;
                          }

                          openEditFolderDialog(folderId, item.title, item.iconKey, item.colorKey);
                        }}
                      >
                        {t('home.contextEditFolder')}
                      </ContextMenuItem>
                      <ContextMenuItem
                        icon={Trash2}
                        disabled={item.folderId === LOCAL_TERMINAL_FOLDER_ID}
                        onSelect={() => {
                          const folderId = item.folderId;
                          if (!folderId || folderId === LOCAL_TERMINAL_FOLDER_ID) {
                            return;
                          }

                          openDeleteFolderDialog(folderId, item.title, item.iconKey, item.colorKey);
                        }}
                      >
                        {t('home.contextDeleteFolder')}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            </div>
          </div>
        </div>
      }
      main={
        <SplitWorkbenchMainPanel
          mode="panel-scroll"
          header={
            <>
              <div className="flex items-center justify-between gap-4 pb-2 ps-2">
                <div className="min-w-0 pb-2 text-[20px] font-semibold leading-[1.02] tracking-[-0.01em] text-header-text">
                  {selectedGroupName}
                </div>

                <div className="flex items-center">
                  <TooltipProvider delayDuration={180}>
                    <Menubar className="mr-1">
                      <div className="w-50 relative">
                        <Input
                          value={search}
                          placeholder={t('home.searchPlaceholder')}
                          className="pr-9"
                          onChange={(event) => setSearch(event.target.value)}
                        />
                        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-header-text-muted" />
                      </div>
                    </Menubar>
                    <Menubar className="mr-1">
                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={t('home.groupModeAction')}
                                className={classNames(menuStyles.control, menuStyles.iconOnlyControl)}
                              >
                                {React.createElement(groupModeIcon, { className: 'h-4 w-4' })}
                              </button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{t('home.groupModeAction')}</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent>
                          <DropdownMenuLabel>{t('home.groupModeAction')}</DropdownMenuLabel>
                          <DropdownMenuCheckboxItem
                            checked={groupMode === 'none'}
                            onSelect={() => setGroupMode('none')}
                          >
                            {t('home.groupModeNone')}
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={groupMode === 'lastUsed'}
                            onSelect={() => setGroupMode('lastUsed')}
                          >
                            {t('home.groupModeLastUsed')}
                          </DropdownMenuCheckboxItem>
                          <DropdownMenuCheckboxItem
                            checked={groupMode === 'tag'}
                            onSelect={() => setGroupMode('tag')}
                          >
                            {t('home.groupModeTag')}
                          </DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={t('home.sortAction')}
                                className={classNames(menuStyles.control, menuStyles.iconOnlyControl)}
                              >
                                {React.createElement(sortModeIcon, { className: 'h-4 w-4' })}
                              </button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{t('home.sortAction')}</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent>
                          <DropdownMenuLabel>{t('home.sortAction')}</DropdownMenuLabel>
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

                      {activeHomeMode !== 'portForwarding' ? (
                        <>
                          <MenubarSeparator vertical />

                          <DropdownMenu>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label={t('home.addAction')}
                                    className={classNames(menuStyles.control, menuStyles.iconOnlyControl)}
                                  >
                                    <Plus className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{t('home.addAction')}</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                icon={activeHomeMode === 'keychains' ? KeyRound : Server}
                                onSelect={handleAddAction}
                              >
                                {activeHomeMode === 'keychains'
                                  ? t('sshKeychain.newKeychain')
                                  : t('home.quickAddServer')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                icon={FolderPlus}
                                onSelect={() => createFolderDialog.openCreateFolderDialog()}
                              >
                                {t('home.quickAddFolder')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      ) : null}
                    </Menubar>
                  </TooltipProvider>
                </div>
              </div>

              {activeHomeMode !== 'portForwarding' ? (
                <MenuToggleGroup
                  type="single"
                  value={activeTag}
                  className="-ms-1"
                  onValueChange={(value) => {
                    if (value) {
                      setActiveTag(value);
                    }
                  }}
                >
                  {tags.map((tagName) => (
                    <MenuToggleGroupItem
                      key={tagName}
                      value={tagName}
                    >
                      {tagName === 'all' ? t('home.tagAll') : tagName}
                    </MenuToggleGroupItem>
                  ))}
                </MenuToggleGroup>
              ) : null}
            </>
          }
          body={
            <>
              {isLoading ? <div className="text-home-text-subtle">{t('home.loading')}</div> : null}
              {errorMessage ? <div className="text-form-message-error">{errorMessage}</div> : null}

              {!isLoading && !errorMessage ? (
                activeHomeMode === 'portForwarding' ? (
                  <HomePortForwardingContent />
                ) : activeHomeMode === 'keychains' ? (
                  <HomeKeychainsContent
                    groups={groupedKeychains}
                    gridIndexMap={keychainGridIndexMap}
                    gridNavigation={keychainGridNavigation}
                    onEditKeychain={openEditKeychainDialog}
                  />
                ) : (
                  <HomeSshContent
                    activeFolderId={activeFolderId}
                    groupedServers={groupedServers}
                    filteredLocalTerminalProfiles={filteredLocalTerminalProfiles}
                    localTerminalGridNavigation={localTerminalGridNavigation}
                    serverGridIndexMap={serverGridIndexMap}
                    serverGridNavigation={serverGridNavigation}
                    draggingServerId={draggingServerId}
                    showFullServerAddress={showFullServerAddress}
                    localTerminalFileManagerLabel={localTerminalFileManagerLabel}
                    openInNewTabShortcutLabel={openInNewTabShortcutLabel}
                    isServerFavorite={isServerFavorite}
                    onOpenSSH={onOpenSSH}
                    onOpenSFTP={onOpenSFTP}
                    onShowInFileManager={(targetPath) => {
                      void handleShowInFileManager(targetPath);
                    }}
                    onOpenServerFromCard={openServerFromCard}
                    onSetDraggingServerId={setDraggingServerId}
                    onSetDragOverFolderId={setDragOverFolderId}
                    onToggleFavorite={(server) => {
                      void handleToggleFavorite(server);
                    }}
                    onCopyToClipboard={(value) => {
                      void handleCopyToClipboard(value);
                    }}
                    onEditServer={openEditServerDialog}
                    onDeleteServer={openDeleteServerDialog}
                  />
                )
              ) : null}

              {!isLoading &&
              !errorMessage &&
              activeHomeMode === 'ssh' &&
              activeFolderId !== LOCAL_TERMINAL_FOLDER_ID &&
              filteredServers.length === 0 ? (
                <HomeEmptyState
                  text={t('home.empty')}
                  icon={PackageOpen}
                />
              ) : null}

              {!isLoading &&
              !errorMessage &&
              activeHomeMode === 'ssh' &&
              activeFolderId === LOCAL_TERMINAL_FOLDER_ID &&
              filteredLocalTerminalProfiles.length === 0 ? (
                <HomeEmptyState
                  text={t('home.empty')}
                  icon={PackageOpen}
                />
              ) : null}

              {!isLoading && !errorMessage && activeHomeMode === 'keychains' && filteredKeychains.length === 0 ? (
                <HomeEmptyState
                  text={t('sshKeychain.empty')}
                  icon={PackageOpen}
                />
              ) : null}
            </>
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

      <SSHServerEditorDialog
        open={isServerEditorDialogOpen}
        serverId={activeServerEditorId}
        initialFolderId={serverEditorInitialFolderId}
        servers={servers}
        folders={folders}
        defaultServerNoteTemplate={defaultServerNoteTemplate}
        onOpenChange={(open) => {
          if (!open) {
            closeServerEditorDialog();
          }
        }}
        onSaved={reloadHomeData}
      />

      <SSHKeychainEditorDialog
        open={isKeychainEditorDialogOpen}
        keychainId={activeKeychainEditorId}
        initialFormState={keychainEditorInitialFormState}
        onOpenChange={(open) => {
          if (!open) {
            closeKeychainEditorDialog();
          }
        }}
        onSaved={async () => {
          await reloadHomeData();
        }}
      />

      <Dialog
        open={isEditFolderDialogOpen}
        onOpenChange={setIsEditFolderDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('home.contextEditFolder')}</DialogTitle>
            <DialogDescription>{t('home.dialogEditFolderDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <EntityVisualPicker
              visual={
                activeFolderDraft
                  ? { iconKey: activeFolderDraft.iconKey, colorKey: activeFolderDraft.colorKey }
                  : { iconKey: 'Folder', colorKey: 'slate' }
              }
              label={t('home.iconSearchPlaceholder')}
              onChange={(nextVisual: { iconKey: string; colorKey: EntityColorKey }) => {
                setActiveFolderDraft((previous) => {
                  if (!previous) {
                    return previous;
                  }

                  return {
                    ...previous,
                    iconKey: nextVisual.iconKey,
                    colorKey: nextVisual.colorKey,
                  };
                });
              }}
            >
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-9 shrink-0 rounded-sm-2 p-0"
                aria-label={t('home.editVisual')}
              >
                <EntityIcon
                  icon={createEntityIconNode(
                    {
                      iconKey: activeFolderDraft?.iconKey ?? 'Folder',
                      colorKey: activeFolderDraft?.colorKey ?? 'slate',
                    },
                    t('home.editVisual'),
                  )}
                  tone="flat"
                />
              </Button>
            </EntityVisualPicker>
            <Input
              value={folderNameInput}
              placeholder={t('home.folderNamePlaceholder')}
              onChange={(event) => setFolderNameInput(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogSecondaryButton onClick={() => setIsEditFolderDialogOpen(false)}>
              {t('home.actionCancel')}
            </DialogSecondaryButton>
            <DialogPrimaryButton
              disabled={isFolderActionSubmitting}
              onClick={() => {
                void submitEditFolder();
              }}
            >
              {t('home.actionSave')}
            </DialogPrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteFolderDialogOpen}
        onOpenChange={setIsDeleteFolderDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('home.contextDeleteFolder')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('home.dialogDeleteFolderDescription', { name: activeFolderDraft?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isFolderActionSubmitting}>
              {t('home.actionCancel')}
            </AlertDialogCancelButton>
            <AlertDialogActionButton
              disabled={isFolderActionSubmitting}
              onClick={(event) => {
                event.preventDefault();
                void submitDeleteFolder();
              }}
            >
              {t('home.contextDelete')}
            </AlertDialogActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isDeleteServerDialogOpen}
        onOpenChange={setIsDeleteServerDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('home.dialogDeleteServerTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('home.dialogDeleteServerDescription', { name: activeServerDraft?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isServerDeleteSubmitting}>
              {t('home.actionCancel')}
            </AlertDialogCancelButton>
            <AlertDialogActionButton
              disabled={isServerDeleteSubmitting}
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

export default Home;
