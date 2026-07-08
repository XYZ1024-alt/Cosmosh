import type {
  ApiSftpEntry,
  SftpAuxiliarySidebarMode,
  SftpDirectoryListColumnId,
  SftpDirectoryListSortDirection,
  SftpDirectoryListViewSetting,
} from '@cosmosh/api-contract';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleCheck,
  CircleX,
  Clipboard,
  Copy,
  Edit3,
  FilePlus2,
  FolderPlus,
  Hourglass,
  ListTodo,
  Loader2,
  MoreVertical,
  Redo2,
  RefreshCcw,
  Save,
  Scissors,
  Search,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import React from 'react';

import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSlot,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import type { InputContextMenuItem } from '../../components/ui/input-context-menu-registry';
import { Menubar, MenubarSeparator } from '../../components/ui/menubar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { t } from '../../lib/i18n';
import type { SftpDirectoryDropEventHandler, SftpDirectoryDropTarget } from './sftp-drag-drop';
import type {
  AddressBreadcrumbRenderState,
  NavigationHistoryControlOptions,
  SftpActionMenuOptions,
  SftpTaskState,
  TreeDirectoryNode,
} from './sftp-types';
import { formatSftpTaskProgressLabel } from './sftp-utils';
import { SftpAddressControl } from './SftpAddressControl';
import { SftpDirectoryViewMenuItems } from './SftpDirectoryViewMenuItems';

/**
 * Props for the SFTP toolbar.
 */
type SftpToolbarProps = {
  activeDropTarget: SftpDirectoryDropTarget | null;
  addressBreadcrumbRenderState: AddressBreadcrumbRenderState;
  addressInputContextMenuItems: InputContextMenuItem[];
  addressInputRef: React.RefObject<HTMLInputElement | null>;
  canGoBack: boolean;
  canGoForward: boolean;
  canUploadLocalFiles: boolean;
  canUseFileActions: boolean;
  clipboardStateExists: boolean;
  currentPath: string;
  directoryListView: SftpDirectoryListViewSetting;
  filterQuery: string;
  hasSelection: boolean;
  hasSingleSelection: boolean;
  isAddressInputEditing: boolean;
  isBusy: boolean;
  isRefreshingDirectory: boolean;
  parentPath?: string;
  pathInput: string;
  primarySelectedEntry: ApiSftpEntry | null;
  selectedEntries: ApiSftpEntry[];
  selectedEntry: ApiSftpEntry | null;
  sessionId: string;
  sftpAuxiliarySidebarMode: SftpAuxiliarySidebarMode;
  sftpShowAddressAsText: boolean;
  sftpShowHiddenEntries: boolean;
  activeTaskCount: number;
  hasTextPreview: boolean;
  isPreviewDirty: boolean;
  isPreviewSaving: boolean;
  getBreadcrumbDirectories: (breadcrumbPath: string) => TreeDirectoryNode[];
  runningTaskCount: number;
  sortedSftpTasks: SftpTaskState[];
  taskToolbarLabel: string;
  isBreadcrumbLoading: (breadcrumbPath: string) => boolean;
  keepAddressInputDuringContextMenu: () => void;
  onAddressInputPointerDown: (event: React.PointerEvent<HTMLInputElement>) => void;
  onDirectoryDropTargetDragEnter: SftpDirectoryDropEventHandler;
  onDirectoryDropTargetDragLeave: SftpDirectoryDropEventHandler;
  onDirectoryDropTargetDragOver: SftpDirectoryDropEventHandler;
  onDirectoryDropTargetDrop: SftpDirectoryDropEventHandler;
  onAuxiliarySidebarModeChange: (mode: SftpAuxiliarySidebarMode) => Promise<void>;
  onBeginCreateEntry: (type: 'file' | 'directory') => void;
  onBeginRenameEntry: (entry: ApiSftpEntry) => void;
  onCopyCurrentPath: () => Promise<void>;
  onCopyEntries: (targetEntries: ApiSftpEntry[]) => void;
  onCutEntries: (targetEntries: ApiSftpEntry[]) => void;
  onDeleteEntries: (targetEntries: ApiSftpEntry[]) => Promise<void>;
  onDirectoryListColumnVisibilityChange: (columnId: SftpDirectoryListColumnId, visible: boolean) => void;
  onDirectoryListSortChange: (sort: {
    field: SftpDirectoryListColumnId;
    direction: SftpDirectoryListSortDirection;
  }) => void;
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
  onPreviewRedo: () => void;
  onPreviewSave: () => Promise<void>;
  onPreviewUndo: () => void;
  onRefresh: () => void;
  onRequestBreadcrumbDirectories: (breadcrumbPath: string) => void;
  onShowAddressAsText: () => void;
  onShowHiddenEntriesChange: (showHiddenEntries: boolean) => Promise<void>;
  onUploadFiles: (targetDirectoryPath?: string) => Promise<void>;
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
  activeDropTarget,
  addressBreadcrumbRenderState,
  addressInputContextMenuItems,
  addressInputRef,
  backNavigationHistoryItems,
  canGoBack,
  canGoForward,
  canUploadLocalFiles,
  canUseFileActions,
  clipboardStateExists,
  currentPath,
  directoryListView,
  filterQuery,
  forwardNavigationHistoryItems,
  getBreadcrumbDirectories,
  hasTextPreview,
  hasSelection,
  hasSingleSelection,
  isAddressInputEditing,
  isBreadcrumbLoading,
  isBusy,
  isPreviewDirty,
  isPreviewSaving,
  isRefreshingDirectory,
  keepAddressInputDuringContextMenu,
  navigationIndex,
  onAddressInputPointerDown,
  onDirectoryDropTargetDragEnter,
  onDirectoryDropTargetDragLeave,
  onDirectoryDropTargetDragOver,
  onDirectoryDropTargetDrop,
  onAuxiliarySidebarModeChange,
  onBeginCreateEntry,
  onBeginRenameEntry,
  onCopyCurrentPath,
  onCopyEntries,
  onCutEntries,
  onDeleteEntries,
  onDirectoryListColumnVisibilityChange,
  onDirectoryListSortChange,
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
  onPreviewRedo,
  onPreviewSave,
  onPreviewUndo,
  onRefresh,
  onRequestBreadcrumbDirectories,
  onShowAddressAsText,
  onShowHiddenEntriesChange,
  onUploadFiles,
  parentPath,
  pathInput,
  primarySelectedEntry,
  renderActionMenuItems,
  renderNavigationHistoryControl,
  selectedEntries,
  selectedEntry,
  sessionId,
  sftpAuxiliarySidebarMode,
  sftpShowAddressAsText,
  sftpShowHiddenEntries,
  activeTaskCount,
  runningTaskCount,
  sortedSftpTasks,
  taskToolbarLabel,
}) => {
  const editorControls = hasTextPreview ? (
    <>
      <MenubarSeparator vertical />
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('sftp.actions.undo')}
              variant="ghostIcon"
              disabled={isPreviewSaving}
              onClick={onPreviewUndo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sftp.actions.undo')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('sftp.actions.redo')}
              variant="ghostIcon"
              disabled={isPreviewSaving}
              onClick={onPreviewRedo}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sftp.actions.redo')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('sftp.actions.save')}
              variant="ghostIcon"
              disabled={!isPreviewDirty || isPreviewSaving}
              onClick={() => {
                void onPreviewSave();
              }}
            >
              {isPreviewSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sftp.actions.save')}</TooltipContent>
        </Tooltip>
      </div>
    </>
  ) : null;

  const taskDropdown =
    sortedSftpTasks.length > 0 ? (
      <>
        <MenubarSeparator vertical />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={taskToolbarLabel}
                  variant="ghost"
                  className="h-[34px] gap-2 px-2.5"
                >
                  {runningTaskCount > 0 ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ListTodo className="h-4 w-4" />
                  )}
                  <span className="max-w-[92px] truncate text-sm">{t('sftp.tasks.toolbarTitle')}</span>
                  <span className="text-home-text flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-home-chip-active px-1.5 text-xs">
                    {activeTaskCount > 0 ? activeTaskCount : sortedSftpTasks.length}
                  </span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{taskToolbarLabel}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            horizontalAlign="right"
            className="w-[320px]"
          >
            <DropdownMenuSlot className="px-2 py-2">
              <div className="flex h-7 items-center justify-between gap-3 px-1">
                <div className="text-sm font-medium text-header-text">{t('sftp.tasks.title')}</div>
                <div className="truncate text-xs text-header-text-muted">{taskToolbarLabel}</div>
              </div>
              <div
                role="status"
                aria-live="polite"
                className="divide-y divide-menu-divider"
              >
                {sortedSftpTasks.map((task) => {
                  const isRunningTask = task.status === 'running';
                  const progressLabel = formatSftpTaskProgressLabel(task.progress);
                  const progressPercent =
                    task.progress && task.progress.total > 0
                      ? Math.min(100, Math.round((task.progress.completed / task.progress.total) * 100))
                      : undefined;

                  return (
                    <div
                      key={task.id}
                      className="py-2 first:pt-1 last:pb-1"
                    >
                      <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5">
                        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-header-text-muted">
                          {task.status === 'running' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : task.status === 'queued' ? (
                            <Hourglass className="h-3.5 w-3.5" />
                          ) : task.status === 'success' ? (
                            <CircleCheck className="h-3.5 w-3.5 text-header-text" />
                          ) : (
                            <CircleX className="h-3.5 w-3.5 text-form-message-error" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-header-text">{task.label}</div>
                          <div className="mt-0.5 truncate text-xs text-header-text-muted">{task.detail}</div>
                        </div>
                        <span className="shrink-0 self-start text-xs text-header-text-muted">
                          {t(`sftp.tasks.status.${task.status}`)}
                        </span>
                        <div className="col-span-2 col-start-2 flex items-center gap-2">
                          <div
                            role="progressbar"
                            aria-label={task.label}
                            aria-valuemin={task.progress ? 0 : undefined}
                            aria-valuemax={task.progress ? task.progress.total : undefined}
                            aria-valuenow={task.progress ? task.progress.completed : undefined}
                            className="h-1 flex-1 overflow-hidden rounded-sm-2 bg-menu-control-hover"
                          >
                            <div
                              className={
                                isRunningTask && progressPercent === undefined
                                  ? 'h-full w-1/2 animate-pulse rounded-sm-2 bg-header-text transition-[width] duration-200'
                                  : 'h-full rounded-sm-2 bg-header-text transition-[width] duration-200'
                              }
                              style={progressPercent === undefined ? undefined : { width: `${progressPercent}%` }}
                            />
                          </div>
                          <span className="w-9 shrink-0 text-right text-xs text-header-text-muted">
                            {progressLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </DropdownMenuSlot>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    ) : null;

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
                  disabled={!sessionId || isBusy}
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
            activeDropTarget={activeDropTarget}
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
            onDirectoryDropTargetDragEnter={onDirectoryDropTargetDragEnter}
            onDirectoryDropTargetDragLeave={onDirectoryDropTargetDragLeave}
            onDirectoryDropTargetDragOver={onDirectoryDropTargetDragOver}
            onDirectoryDropTargetDrop={onDirectoryDropTargetDrop}
            onEditCurrentPath={onEditCurrentPath}
            onNavigateToPath={onNavigateToPath}
            onPathInputBlur={onPathInputBlur}
            onPathInputChange={onPathInputChange}
            onPathInputKeyDown={onPathInputKeyDown}
            onPathSubmit={onPathSubmit}
            onRequestBreadcrumbDirectories={onRequestBreadcrumbDirectories}
            onShowAddressAsText={onShowAddressAsText}
          />

          {taskDropdown}

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
                  aria-label={t('sftp.actions.uploadFiles')}
                  variant="ghostIcon"
                  disabled={!canUseFileActions || !canUploadLocalFiles}
                  onClick={() => {
                    void onUploadFiles();
                  }}
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('sftp.actions.uploadFiles')}</TooltipContent>
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
                <DropdownMenuCheckboxItem
                  checked={sftpShowHiddenEntries}
                  onCheckedChange={(checked) => {
                    void onShowHiddenEntriesChange(Boolean(checked));
                  }}
                >
                  {t('sftp.actions.showHiddenFiles')}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t('sftp.actions.auxiliarySidebar')}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={sftpAuxiliarySidebarMode}
                      onValueChange={(value) => {
                        if (value === 'details' || value === 'preview' || value === 'off') {
                          void onAuxiliarySidebarModeChange(value);
                        }
                      }}
                    >
                      <DropdownMenuRadioItem value="details">
                        {t('sftp.auxiliarySidebar.details')}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="preview">
                        {t('sftp.auxiliarySidebar.preview')}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="off">{t('sftp.auxiliarySidebar.off')}</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <SftpDirectoryViewMenuItems
                  directoryListView={directoryListView}
                  menuSurface="dropdown"
                  onColumnVisibilityChange={onDirectoryListColumnVisibilityChange}
                  onSortChange={onDirectoryListSortChange}
                />
                <DropdownMenuSeparator />
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

          {editorControls}
        </div>
      </Menubar>
    </TooltipProvider>
  );
};
