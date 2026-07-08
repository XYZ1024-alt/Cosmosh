import type { ApiSftpEntry } from '@cosmosh/api-contract';
import {
  Clipboard,
  Copy,
  Download,
  Edit3,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Info,
  Link2,
  RefreshCcw,
  Scissors,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import React from 'react';

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../../components/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../../components/ui/dropdown-menu';
import { t } from '../../lib/i18n';
import { SFTP_OPEN_WITH_APPLICATION_ICON_FALLBACK } from './sftp-constants';
import { isUnsafeDirectorySelfDrop } from './sftp-drag-drop';
import type {
  ClipboardState,
  InlineEditMenuAction,
  SftpActionMenuOptions,
  SftpOpenWithApplication,
} from './sftp-types';
import { buildRelativeRemotePathOptions, resolveActionTargetEntries } from './sftp-utils';

/**
 * Handler set required by the shared SFTP action menu renderer.
 */
type SftpActionMenuHandlers = {
  beginCreateEntryInDirectory: (type: 'file' | 'directory', directoryPath?: string) => Promise<void>;
  beginRenameEntry: (entry: ApiSftpEntry) => void;
  handleCopyEntries: (targetEntries: ApiSftpEntry[]) => void;
  handleCopyRelativeRemotePath: (relativePath: string) => Promise<void>;
  handleCopyRemotePath: (entry: ApiSftpEntry) => Promise<void>;
  handleCutEntries: (targetEntries: ApiSftpEntry[]) => void;
  handleDeleteEntries: (targetEntries: ApiSftpEntry[]) => Promise<void>;
  handleDownloadEntry: (entry: ApiSftpEntry, mode: 'downloads' | 'choose') => Promise<void>;
  handleOpenDirectoryInNewTab: (entry: ApiSftpEntry) => void;
  handleOpenEntry: (entry: ApiSftpEntry) => Promise<void>;
  handleOpenEntryWithApplication: (entry: ApiSftpEntry, application: SftpOpenWithApplication) => Promise<void>;
  handleOpenEntryWithPicker: (entry: ApiSftpEntry) => Promise<void>;
  handleOpenProperties: (entries: ApiSftpEntry[]) => void;
  handleOpenSshAtEntryLocation: (entry: ApiSftpEntry | null, targetDirectoryPath?: string) => void;
  handleCreateLinkFromClipboard: (targetDirectoryPath?: string) => void;
  handlePasteEntry: (targetDirectoryPath?: string) => Promise<void>;
  handleTreeDirectoryRefresh: (directoryPath: string) => void;
  handleUploadFiles: (targetDirectoryPath?: string) => Promise<void>;
  loadOpenWithApplications: (entry: ApiSftpEntry) => Promise<void>;
  runInlineEditMenuActionAfterClose: (action: InlineEditMenuAction) => void;
};

/**
 * Props for the shared SFTP action menu item group.
 */
type SftpActionMenuItemsProps = SftpActionMenuOptions &
  SftpActionMenuHandlers & {
    canUploadLocalFiles: boolean;
    canUseFileActions: boolean;
    canUseSftpOpenWith: boolean;
    clipboardState: ClipboardState | null;
    currentPath: string;
    loadingOpenWithPath: string;
    openWithApplicationsByPath: Record<string, SftpOpenWithApplication[]>;
    selectedEntries: ApiSftpEntry[];
    selectedPathSet: ReadonlySet<string>;
    shortcutModifier: string;
    /**
     * Allows menu content wrappers to detect that this component renders icon-bearing
     * items internally, so iconless siblings reserve the same leading slot.
     */
    withIconSlot?: boolean;
  };

/**
 * Renders the reusable action set used by SFTP row, tree, toolbar, and directory menus.
 *
 * @param props Action surface state and handlers.
 * @returns Menu item fragment for the requested surface.
 */
export const SftpActionMenuItems: React.FC<SftpActionMenuItemsProps> = ({
  beginCreateEntryInDirectory,
  beginRenameEntry,
  canUploadLocalFiles,
  canUseFileActions,
  canUseSftpOpenWith,
  clipboardState,
  contextEntry,
  currentPath,
  handleCopyEntries,
  handleCopyRelativeRemotePath,
  handleCopyRemotePath,
  handleCutEntries,
  handleDeleteEntries,
  handleDownloadEntry,
  handleOpenDirectoryInNewTab,
  handleOpenEntry,
  handleOpenEntryWithApplication,
  handleOpenEntryWithPicker,
  handleOpenProperties,
  handleOpenSshAtEntryLocation,
  handleCreateLinkFromClipboard,
  handlePasteEntry,
  handleTreeDirectoryRefresh,
  handleUploadFiles,
  loadOpenWithApplications,
  loadingOpenWithPath,
  menuSurface,
  openWithApplicationsByPath,
  runInlineEditMenuActionAfterClose,
  scope,
  selectedEntries,
  selectedPathSet,
  shortcutModifier,
  showShortcuts,
  targetDirectoryPath = currentPath,
}) => {
  const targetEntries = resolveActionTargetEntries(contextEntry, scope, selectedEntries, selectedPathSet);
  const targetEntry = targetEntries[0] ?? null;
  const isMultiTarget = targetEntries.length > 1;
  const isTreeDirectoryScope = scope === 'treeDirectory';
  const shouldShowEntryOpenActions = scope === 'entry' || scope === 'toolbarMore' || isTreeDirectoryScope;
  const shouldShowEntryMutationActions = scope === 'entry';
  const shouldShowCreateActions = scope === 'directory' || isTreeDirectoryScope;
  const shouldShowPasteAction = scope === 'directory' || isTreeDirectoryScope;
  const shouldShowCreateLinkAction = shouldShowPasteAction || scope === 'toolbarMore';
  const shouldShowUploadAction = scope === 'directory' || isTreeDirectoryScope;
  const shouldShowRefreshAction = isTreeDirectoryScope;
  const shouldShowLocationActions =
    scope === 'entry' || scope === 'toolbarMore' || scope === 'directory' || isTreeDirectoryScope;
  const relativePathOptions = targetEntry ? buildRelativeRemotePathOptions(targetEntry.path) : [];
  const canOpenEntry = canUseFileActions && Boolean(targetEntry) && !isMultiTarget;
  const shouldShowOpenInNewTab = Boolean(targetEntry && !isMultiTarget && targetEntry.type === 'directory');
  const canOpenInNewTab = canUseFileActions && shouldShowOpenInNewTab;
  const canUseSingleEntryAction = canUseFileActions && Boolean(targetEntry) && !isMultiTarget;
  const canDownloadEntry = canUseSingleEntryAction && targetEntry?.type === 'file';
  const shouldShowOpenWithEntry = Boolean(
    targetEntry && !isMultiTarget && targetEntry.type === 'file' && canUseSftpOpenWith,
  );
  const canOpenWithEntry = canUseFileActions && shouldShowOpenWithEntry;
  const openWithApplications = targetEntry ? (openWithApplicationsByPath[targetEntry.path] ?? []) : [];
  const isLoadingOpenWithApplications = Boolean(targetEntry && loadingOpenWithPath === targetEntry.path);
  const canOpenSshHere = canUseFileActions && (!isMultiTarget || !targetEntry);
  const canOpenProperties = canUseFileActions && targetEntries.length > 0;
  const canMutateEntry = canUseFileActions && targetEntries.length > 0;
  const canRenameEntry = canMutateEntry && targetEntries.length === 1;
  const canPaste = canUseFileActions && Boolean(clipboardState);
  const canCreateLinkFromClipboard =
    canUseFileActions &&
    Boolean(clipboardState?.entries.length) &&
    Boolean(targetDirectoryPath) &&
    !isUnsafeDirectorySelfDrop(clipboardState?.entries ?? [], targetDirectoryPath);
  const canRefreshDirectory = canUseFileActions && Boolean(targetDirectoryPath);
  const shouldShowOpenSeparator =
    shouldShowLocationActions ||
    shouldShowEntryMutationActions ||
    shouldShowRefreshAction ||
    shouldShowUploadAction ||
    shouldShowPasteAction ||
    shouldShowCreateLinkAction ||
    shouldShowCreateActions;
  const shouldShowCreateSeparator =
    (shouldShowUploadAction || shouldShowPasteAction || shouldShowCreateLinkAction || shouldShowRefreshAction) &&
    shouldShowCreateActions;

  const ShortcutComponent = menuSurface === 'context' ? ContextMenuShortcut : DropdownMenuShortcut;
  const ItemComponent = menuSurface === 'context' ? ContextMenuItem : DropdownMenuItem;
  const SeparatorComponent = menuSurface === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
  const SubComponent = menuSurface === 'context' ? ContextMenuSub : DropdownMenuSub;
  const SubContentComponent = menuSurface === 'context' ? ContextMenuSubContent : DropdownMenuSubContent;
  const SubTriggerComponent = menuSurface === 'context' ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const deleteShortcut = window.electron?.platform === 'darwin' ? 'Cmd+Backspace' : 'Del';

  return (
    <>
      {shouldShowEntryOpenActions ? (
        <>
          <ItemComponent
            icon={FolderOpen}
            disabled={!canOpenEntry}
            onSelect={() => {
              if (targetEntry) {
                void handleOpenEntry(targetEntry);
              }
            }}
          >
            {t('sftp.actions.open')}
            {showShortcuts ? <ShortcutComponent>Enter</ShortcutComponent> : null}
          </ItemComponent>
          {shouldShowOpenInNewTab ? (
            <ItemComponent
              icon={FolderOpen}
              disabled={!canOpenInNewTab}
              onSelect={() => {
                if (targetEntry) {
                  handleOpenDirectoryInNewTab(targetEntry);
                }
              }}
            >
              {t('sftp.actions.openInNewTab')}
              {showShortcuts ? <ShortcutComponent>{shortcutModifier}+Enter</ShortcutComponent> : null}
            </ItemComponent>
          ) : null}
          {shouldShowOpenWithEntry && window.electron?.platform === 'win32' ? (
            <ItemComponent
              disabled={!canOpenWithEntry}
              onSelect={() => {
                if (targetEntry) {
                  void handleOpenEntryWithPicker(targetEntry);
                }
              }}
            >
              {t('sftp.actions.openWith')}
            </ItemComponent>
          ) : null}
          {shouldShowOpenWithEntry && window.electron?.platform === 'darwin' ? (
            <SubComponent>
              <SubTriggerComponent
                disabled={!canOpenWithEntry}
                onPointerMove={() => {
                  if (targetEntry && openWithApplications.length === 0 && !isLoadingOpenWithApplications) {
                    void loadOpenWithApplications(targetEntry);
                  }
                }}
                onFocus={() => {
                  if (targetEntry && openWithApplications.length === 0 && !isLoadingOpenWithApplications) {
                    void loadOpenWithApplications(targetEntry);
                  }
                }}
              >
                {t('sftp.actions.openWith')}
              </SubTriggerComponent>
              <SubContentComponent>
                {isLoadingOpenWithApplications ? (
                  <ItemComponent disabled>{t('sftp.openWithLoading')}</ItemComponent>
                ) : openWithApplications.length > 0 ? (
                  openWithApplications.map((application) => (
                    <ItemComponent
                      key={application.id}
                      onSelect={() => {
                        if (targetEntry) {
                          void handleOpenEntryWithApplication(targetEntry, application);
                        }
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <img
                          alt=""
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0"
                          src={application.iconDataUrl ?? SFTP_OPEN_WITH_APPLICATION_ICON_FALLBACK}
                        />
                        <span className="truncate">{application.name}</span>
                      </span>
                    </ItemComponent>
                  ))
                ) : (
                  <ItemComponent disabled>{t('sftp.openWithNoApplications')}</ItemComponent>
                )}
              </SubContentComponent>
            </SubComponent>
          ) : null}
          {shouldShowOpenSeparator ? <SeparatorComponent /> : null}
        </>
      ) : null}
      {shouldShowLocationActions ? (
        <>
          <ItemComponent
            icon={Terminal}
            disabled={!canOpenSshHere}
            onSelect={() => {
              handleOpenSshAtEntryLocation(targetEntry, targetDirectoryPath);
            }}
          >
            {t('sftp.actions.openSshHere')}
          </ItemComponent>
          {targetEntry ? (
            <>
              <ItemComponent
                icon={Copy}
                disabled={!canUseSingleEntryAction}
                onSelect={() => {
                  void handleCopyRemotePath(targetEntry);
                }}
              >
                {t('sftp.actions.copyPath')}
              </ItemComponent>
              <SubComponent>
                <SubTriggerComponent disabled={!canUseSingleEntryAction || relativePathOptions.length === 0}>
                  {t(
                    targetEntry.type === 'directory'
                      ? 'sftp.actions.copyDirectoryRelativePath'
                      : 'sftp.actions.copyFileRelativePath',
                  )}
                </SubTriggerComponent>
                <SubContentComponent>
                  {relativePathOptions.map((relativePath) => (
                    <ItemComponent
                      key={relativePath}
                      onSelect={() => {
                        void handleCopyRelativeRemotePath(relativePath);
                      }}
                    >
                      {relativePath}
                    </ItemComponent>
                  ))}
                </SubContentComponent>
              </SubComponent>
              <ItemComponent
                icon={Download}
                disabled={!canDownloadEntry}
                onSelect={() => {
                  if (targetEntry) {
                    void handleDownloadEntry(targetEntry, 'downloads');
                  }
                }}
              >
                {t('sftp.actions.saveToDownloads')}
              </ItemComponent>
              <ItemComponent
                disabled={!canDownloadEntry}
                onSelect={() => {
                  if (targetEntry) {
                    void handleDownloadEntry(targetEntry, 'choose');
                  }
                }}
              >
                {t('sftp.actions.saveAs')}
              </ItemComponent>
            </>
          ) : null}
          {shouldShowEntryMutationActions ||
          shouldShowRefreshAction ||
          shouldShowUploadAction ||
          shouldShowPasteAction ||
          shouldShowCreateLinkAction ||
          shouldShowCreateActions ? (
            <SeparatorComponent />
          ) : null}
        </>
      ) : null}
      {shouldShowEntryMutationActions ? (
        <>
          <ItemComponent
            icon={Scissors}
            disabled={!canMutateEntry}
            onSelect={() => {
              handleCutEntries(targetEntries);
            }}
          >
            {t('sftp.actions.cut')}
            {showShortcuts ? <ShortcutComponent>{shortcutModifier}+X</ShortcutComponent> : null}
          </ItemComponent>
          <ItemComponent
            icon={Copy}
            disabled={!canMutateEntry}
            onSelect={() => {
              handleCopyEntries(targetEntries);
            }}
          >
            {t('sftp.actions.copy')}
            {showShortcuts ? <ShortcutComponent>{shortcutModifier}+C</ShortcutComponent> : null}
          </ItemComponent>
          <ItemComponent
            icon={Edit3}
            disabled={!canRenameEntry}
            onSelect={() => {
              if (targetEntry) {
                runInlineEditMenuActionAfterClose(() => beginRenameEntry(targetEntry));
              }
            }}
          >
            {t('sftp.actions.rename')}
            {showShortcuts ? <ShortcutComponent>F2</ShortcutComponent> : null}
          </ItemComponent>
          <ItemComponent
            icon={Trash2}
            disabled={!canMutateEntry}
            onSelect={() => {
              void handleDeleteEntries(targetEntries);
            }}
          >
            {t('sftp.actions.delete')}
            {showShortcuts ? <ShortcutComponent>{deleteShortcut}</ShortcutComponent> : null}
          </ItemComponent>
          {shouldShowPasteAction || shouldShowCreateLinkAction || shouldShowCreateActions ? (
            <SeparatorComponent />
          ) : null}
        </>
      ) : null}
      {shouldShowRefreshAction ? (
        <ItemComponent
          icon={RefreshCcw}
          disabled={!canRefreshDirectory}
          onSelect={() => handleTreeDirectoryRefresh(targetDirectoryPath)}
        >
          {t('sftp.actions.refresh')}
        </ItemComponent>
      ) : null}
      {shouldShowUploadAction ? (
        <ItemComponent
          icon={Upload}
          disabled={!canUseFileActions || !canUploadLocalFiles}
          onSelect={() => {
            void handleUploadFiles(targetDirectoryPath);
          }}
        >
          {t('sftp.actions.uploadFiles')}
        </ItemComponent>
      ) : null}
      {shouldShowPasteAction ? (
        <ItemComponent
          icon={Clipboard}
          disabled={!canPaste}
          onSelect={() => {
            void handlePasteEntry(targetDirectoryPath);
          }}
        >
          {t('sftp.actions.paste')}
          {showShortcuts ? <ShortcutComponent>{shortcutModifier}+V</ShortcutComponent> : null}
        </ItemComponent>
      ) : null}
      {shouldShowCreateLinkAction ? (
        <ItemComponent
          icon={Link2}
          disabled={!canCreateLinkFromClipboard}
          onSelect={() => {
            handleCreateLinkFromClipboard(targetDirectoryPath);
          }}
        >
          {t('sftp.actions.pasteAsLink')}
        </ItemComponent>
      ) : null}
      {shouldShowCreateActions ? (
        <>
          {shouldShowCreateSeparator ? <SeparatorComponent /> : null}
          <ItemComponent
            icon={FilePlus2}
            disabled={!canUseFileActions}
            onSelect={() => {
              runInlineEditMenuActionAfterClose(() => beginCreateEntryInDirectory('file', targetDirectoryPath));
            }}
          >
            {t('sftp.actions.newFile')}
            {showShortcuts ? <ShortcutComponent>{shortcutModifier}+N</ShortcutComponent> : null}
          </ItemComponent>
          <ItemComponent
            icon={FolderPlus}
            disabled={!canUseFileActions}
            onSelect={() => {
              runInlineEditMenuActionAfterClose(() => beginCreateEntryInDirectory('directory', targetDirectoryPath));
            }}
          >
            {t('sftp.actions.newFolder')}
            {showShortcuts ? <ShortcutComponent>{shortcutModifier}+Shift+N</ShortcutComponent> : null}
          </ItemComponent>
        </>
      ) : null}
      {(scope === 'entry' || isTreeDirectoryScope) && targetEntries.length > 0 ? (
        <>
          <SeparatorComponent />
          <ItemComponent
            icon={Info}
            disabled={!canOpenProperties}
            onSelect={() => {
              handleOpenProperties(targetEntries);
            }}
          >
            {t('sftp.actions.properties')}
          </ItemComponent>
        </>
      ) : null}
    </>
  );
};
