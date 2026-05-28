import type { ApiSftpEntry } from '@cosmosh/api-contract';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Clipboard,
  Copy,
  Edit3,
  FilePlus2,
  FolderPlus,
  MoreVertical,
  RefreshCcw,
  Scissors,
  Search,
  Trash2,
} from 'lucide-react';
import React from 'react';

import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import type { InputContextMenuItem } from '../../components/ui/input-context-menu-registry';
import { Menubar, MenubarSeparator } from '../../components/ui/menubar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { t } from '../../lib/i18n';
import type {
  AddressBreadcrumbRenderState,
  NavigationHistoryControlOptions,
  SftpActionMenuOptions,
  TreeDirectoryNode,
} from './sftp-types';
import { SftpAddressControl } from './SftpAddressControl';

/**
 * Props for the SFTP toolbar.
 */
type SftpToolbarProps = {
  addressBreadcrumbRenderState: AddressBreadcrumbRenderState;
  addressInputContextMenuItems: InputContextMenuItem[];
  addressInputRef: React.RefObject<HTMLInputElement | null>;
  canGoBack: boolean;
  canGoForward: boolean;
  canUseFileActions: boolean;
  clipboardStateExists: boolean;
  currentPath: string;
  filterQuery: string;
  hasSelection: boolean;
  hasSingleSelection: boolean;
  isAddressInputEditing: boolean;
  isBusy: boolean;
  isOperationRunning: boolean;
  isRefreshingDirectory: boolean;
  parentPath?: string;
  pathInput: string;
  primarySelectedEntry: ApiSftpEntry | null;
  selectedEntries: ApiSftpEntry[];
  selectedEntry: ApiSftpEntry | null;
  sessionId: string;
  sftpShowAddressAsText: boolean;
  getBreadcrumbDirectories: (breadcrumbPath: string) => TreeDirectoryNode[];
  isBreadcrumbLoading: (breadcrumbPath: string) => boolean;
  keepAddressInputDuringContextMenu: () => void;
  onAddressInputPointerDown: (event: React.PointerEvent<HTMLInputElement>) => void;
  onBeginCreateEntry: (type: 'file' | 'directory') => void;
  onBeginRenameEntry: (entry: ApiSftpEntry) => void;
  onCopyCurrentPath: () => Promise<void>;
  onCopyEntries: (targetEntries: ApiSftpEntry[]) => void;
  onCutEntries: (targetEntries: ApiSftpEntry[]) => void;
  onDeleteEntries: (targetEntries: ApiSftpEntry[]) => Promise<void>;
  onEditCurrentPath: () => void;
  onFilterQueryChange: (value: string) => void;
  onHistoryJump: (nextIndex: number) => Promise<void>;
  onInlineEditMenuCloseAutoFocus: (event: Event) => void;
  onNavigateToPath: (directoryPath: string) => Promise<boolean>;
  onParentDirectory: () => void;
  onPasteEntry: () => Promise<void>;
  onPathInputBlur: () => void;
  onPathInputChange: (value: string) => void;
  onPathInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onPathSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onRequestBreadcrumbDirectories: (breadcrumbPath: string) => void;
  onShowAddressAsText: () => void;
  renderActionMenuItems: (options: SftpActionMenuOptions) => React.ReactNode;
  renderNavigationHistoryControl: (options: NavigationHistoryControlOptions) => React.ReactNode;
  navigationIndex: number;
  backNavigationHistoryItems: NavigationHistoryControlOptions['items'];
  forwardNavigationHistoryItems: NavigationHistoryControlOptions['items'];
};

/**
 * Renders the SFTP browser toolbar, address field, file actions, and search field.
 *
 * @param props Toolbar state and action handlers.
 * @returns SFTP toolbar.
 */
export const SftpToolbar: React.FC<SftpToolbarProps> = ({
  addressBreadcrumbRenderState,
  addressInputContextMenuItems,
  addressInputRef,
  backNavigationHistoryItems,
  canGoBack,
  canGoForward,
  canUseFileActions,
  clipboardStateExists,
  currentPath,
  filterQuery,
  forwardNavigationHistoryItems,
  getBreadcrumbDirectories,
  hasSelection,
  hasSingleSelection,
  isAddressInputEditing,
  isBreadcrumbLoading,
  isBusy,
  isOperationRunning,
  isRefreshingDirectory,
  keepAddressInputDuringContextMenu,
  navigationIndex,
  onAddressInputPointerDown,
  onBeginCreateEntry,
  onBeginRenameEntry,
  onCopyCurrentPath,
  onCopyEntries,
  onCutEntries,
  onDeleteEntries,
  onEditCurrentPath,
  onFilterQueryChange,
  onHistoryJump,
  onInlineEditMenuCloseAutoFocus,
  onNavigateToPath,
  onParentDirectory,
  onPasteEntry,
  onPathInputBlur,
  onPathInputChange,
  onPathInputKeyDown,
  onPathSubmit,
  onRefresh,
  onRequestBreadcrumbDirectories,
  onShowAddressAsText,
  parentPath,
  pathInput,
  primarySelectedEntry,
  renderActionMenuItems,
  renderNavigationHistoryControl,
  selectedEntries,
  selectedEntry,
  sessionId,
  sftpShowAddressAsText,
}) => {
  return (
    <TooltipProvider>
      <Menubar className="w-full shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex shrink-0 items-center gap-1">
            {renderNavigationHistoryControl({
              label: t('sftp.actions.back'),
              icon: <ArrowLeft className="h-4 w-4" />,
              items: backNavigationHistoryItems,
              disabled: !canGoBack || isBusy,
              onStep: () => {
                void onHistoryJump(navigationIndex - 1);
              },
            })}
            {renderNavigationHistoryControl({
              label: t('sftp.actions.forward'),
              icon: <ArrowRight className="h-4 w-4" />,
              items: forwardNavigationHistoryItems,
              disabled: !canGoForward || isBusy,
              onStep: () => {
                void onHistoryJump(navigationIndex + 1);
              },
            })}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.up')}
                  variant="ghostIcon"
                  disabled={!sessionId || !parentPath || isBusy}
                  onClick={onParentDirectory}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.up')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.refresh')}
                  variant="ghostIcon"
                  disabled={!sessionId || isBusy || isOperationRunning}
                  onClick={onRefresh}
                >
                  <RefreshCcw className={isBusy || isRefreshingDirectory ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.refresh')}</TooltipContent>
            </Tooltip>
          </div>

          <MenubarSeparator vertical />

          <SftpAddressControl
            addressBreadcrumbRenderState={addressBreadcrumbRenderState}
            addressInputContextMenuItems={addressInputContextMenuItems}
            addressInputRef={addressInputRef}
            currentPath={currentPath}
            getBreadcrumbDirectories={getBreadcrumbDirectories}
            isAddressInputEditing={isAddressInputEditing}
            isBreadcrumbLoading={isBreadcrumbLoading}
            isBusy={isBusy}
            keepAddressInputDuringContextMenu={keepAddressInputDuringContextMenu}
            pathInput={pathInput}
            sessionId={sessionId}
            sftpShowAddressAsText={sftpShowAddressAsText}
            onAddressInputPointerDown={onAddressInputPointerDown}
            onCopyCurrentPath={onCopyCurrentPath}
            onEditCurrentPath={onEditCurrentPath}
            onNavigateToPath={onNavigateToPath}
            onPathInputBlur={onPathInputBlur}
            onPathInputChange={onPathInputChange}
            onPathInputKeyDown={onPathInputKeyDown}
            onPathSubmit={onPathSubmit}
            onRequestBreadcrumbDirectories={onRequestBreadcrumbDirectories}
            onShowAddressAsText={onShowAddressAsText}
          />

          <MenubarSeparator vertical />

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.cut')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSelection}
                  onClick={() => {
                    onCutEntries(selectedEntries);
                  }}
                >
                  <Scissors className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.cut')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.copy')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSelection}
                  onClick={() => {
                    onCopyEntries(selectedEntries);
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.copy')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.paste')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !clipboardStateExists}
                  onClick={() => {
                    void onPasteEntry();
                  }}
                >
                  <Clipboard className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.paste')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.newFile')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions}
                  onClick={() => onBeginCreateEntry('file')}
                >
                  <FilePlus2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.newFile')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.newFolder')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions}
                  onClick={() => onBeginCreateEntry('directory')}
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.newFolder')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.rename')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSingleSelection || !selectedEntry}
                  onClick={() => {
                    if (selectedEntry) {
                      onBeginRenameEntry(selectedEntry);
                    }
                  }}
                >
                  <Edit3 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.rename')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('sftp.actions.delete')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !hasSelection}
                  onClick={() => {
                    void onDeleteEntries(selectedEntries);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.delete')}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={t('sftp.actions.more')}
                      variant="ghostIcon"
                      disabled={!sessionId || isBusy}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('sftp.actions.more')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                horizontalAlign="left"
                onCloseAutoFocus={onInlineEditMenuCloseAutoFocus}
              >
                {renderActionMenuItems({
                  contextEntry: primarySelectedEntry,
                  menuSurface: 'dropdown',
                  scope: 'toolbarMore',
                  showShortcuts: true,
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="relative w-[220px] shrink-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-home-text-subtle" />
            <Input
              aria-label={t('sftp.actions.search')}
              className="h-[34px] pl-8 text-sm"
              disabled={!sessionId}
              placeholder={t('sftp.searchPlaceholder')}
              value={filterQuery}
              onChange={(event) => onFilterQueryChange(event.target.value)}
            />
          </div>
        </div>
      </Menubar>
    </TooltipProvider>
  );
};
