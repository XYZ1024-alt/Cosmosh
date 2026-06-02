import {
  type ApiSftpEntry,
  isSftpDirectoryListColumnId,
  type SftpDirectoryListColumnId,
  type SftpDirectoryListSortDirection,
  type SftpDirectoryListViewSetting,
} from '@cosmosh/api-contract';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import classNames from 'classnames';
import { ArrowDown, ArrowUp, File, Folder, Loader2, ShieldAlert, Undo2 } from 'lucide-react';
import React from 'react';

import { Button } from '../../components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../../components/ui/context-menu';
import { Input } from '../../components/ui/input';
import { Menubar } from '../../components/ui/menubar';
import { useDateTimeFormatter } from '../../lib/date-time-format';
import { t } from '../../lib/i18n';
import { PARENT_DIRECTORY_ROW_KEY, SFTP_CARD_CLASS_NAME } from './sftp-constants';
import {
  buildSftpDirectoryGridTemplate,
  formatSftpDirectoryColumnValue,
  resolveSftpDirectoryListMinWidth,
  resolveVisibleSftpDirectoryColumns,
  type SftpDirectoryColumnDefinition,
} from './sftp-directory-view';
import type {
  PendingCreateState,
  SftpActionMenuOptions,
  SftpConnectionStatus,
  SftpFileNavigationRow,
  SftpSelectionClickEvent,
} from './sftp-types';
import { resolveEntryIcon } from './sftp-utils';
import { SftpDirectoryViewMenuItems } from './SftpDirectoryViewMenuItems';

type SortableHeaderCellProps = {
  column: SftpDirectoryColumnDefinition;
  sort: SftpDirectoryListViewSetting['sort'];
  onSortFieldClick: (columnId: SftpDirectoryListColumnId) => void;
};

/**
 * Renders one draggable, sortable directory-list header cell.
 *
 * @param props Column definition, active sort state, and sort callback.
 * @returns Sortable header cell.
 */
const SortableHeaderCell: React.FC<SortableHeaderCellProps> = ({ column, sort, onSortFieldClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
  });
  const isSorted = sort.field === column.id;
  const transformStyle = transform
    ? CSS.Transform.toString({
        x: transform.x,
        y: 0,
        scaleX: 1,
        scaleY: 1,
      })
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transformStyle,
        transition: isDragging ? undefined : transition,
      }}
      className={classNames('h-full min-w-0', isDragging ? 'relative z-20 opacity-70' : '')}
    >
      <button
        type="button"
        className={classNames(
          'flex h-full w-full min-w-0 items-center gap-1.5 rounded-sm-2 text-xs font-medium text-home-text-subtle outline-none transition-colors hover:bg-home-card-hover focus-visible:ring-1 focus-visible:ring-outline',
          column.align === 'right' ? 'justify-end text-right' : 'justify-start text-left',
        )}
        {...attributes}
        {...listeners}
        onClick={() => onSortFieldClick(column.id)}
      >
        <span className="min-w-0 truncate">{t(column.labelI18nKey)}</span>
        {isSorted ? (
          sort.direction === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : null}
      </button>
    </div>
  );
};

/**
 * Props for the central SFTP directory listing panel.
 */
type SftpDirectoryPanelProps = {
  canActivateParentDirectoryListEntry: boolean;
  clipboardMode?: 'copy' | 'cut';
  clipboardPaths: ReadonlySet<string>;
  directoryListView: SftpDirectoryListViewSetting;
  entries: ApiSftpEntry[];
  errorMessage: string;
  fileRowRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  hasParentDirectoryListEntry: boolean;
  pendingCreate: PendingCreateState | null;
  renameInput: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renamingEntryPath: string;
  resolvedActiveFileRowKey: string;
  selectedPathSet: ReadonlySet<string>;
  sessionId: string;
  sftpDimHiddenEntries: boolean;
  sftpShowHiddenEntries: boolean;
  status: SftpConnectionStatus;
  visibleEntries: ApiSftpEntry[];
  onCancelInlineEdit: () => void;
  onCommitPendingCreate: () => Promise<void>;
  onCommitRenameEntry: (entry: ApiSftpEntry) => Promise<void>;
  onDirectoryBlankClick: () => void;
  onDirectoryListColumnOrderChange: (columnIds: SftpDirectoryListColumnId[]) => void;
  onDirectoryListColumnVisibilityChange: (columnId: SftpDirectoryListColumnId, visible: boolean) => void;
  onDirectoryListSortChange: (sort: {
    field: SftpDirectoryListColumnId;
    direction: SftpDirectoryListSortDirection;
  }) => void;
  onDirectoryListSortFieldClick: (columnId: SftpDirectoryListColumnId) => void;
  onEntryContextMenu: (entry: ApiSftpEntry) => void;
  onEntryOpen: (entry: ApiSftpEntry) => void;
  onEntrySelect: (entry: ApiSftpEntry, event: SftpSelectionClickEvent) => void;
  onFileNavigationRowKeyDown: (event: React.KeyboardEvent<HTMLElement>, row: SftpFileNavigationRow) => void;
  onInlineEditInputBlur: (commit: () => void | Promise<void>) => void;
  onInlineEditMenuCloseAutoFocus: (event: Event) => void;
  onParentDirectory: () => void;
  onRefresh: () => void;
  onRenameInputChange: (value: string) => void;
  onSetActiveFileRowKey: (rowKey: string) => void;
  renderActionMenuItems: (options: SftpActionMenuOptions) => React.ReactNode;
};

/**
 * Renders the central SFTP directory table, inline create rows, and entry context menus.
 *
 * @param props Directory state and event handlers.
 * @returns SFTP directory panel.
 */
export const SftpDirectoryPanel: React.FC<SftpDirectoryPanelProps> = ({
  canActivateParentDirectoryListEntry,
  clipboardMode,
  clipboardPaths,
  directoryListView,
  entries,
  errorMessage,
  fileRowRefs,
  hasParentDirectoryListEntry,
  onCancelInlineEdit,
  onCommitPendingCreate,
  onCommitRenameEntry,
  onDirectoryBlankClick,
  onDirectoryListColumnOrderChange,
  onDirectoryListColumnVisibilityChange,
  onDirectoryListSortChange,
  onDirectoryListSortFieldClick,
  onEntryContextMenu,
  onEntryOpen,
  onEntrySelect,
  onFileNavigationRowKeyDown,
  onInlineEditInputBlur,
  onInlineEditMenuCloseAutoFocus,
  onParentDirectory,
  onRefresh,
  onRenameInputChange,
  onSetActiveFileRowKey,
  pendingCreate,
  renameInput,
  renameInputRef,
  renamingEntryPath,
  renderActionMenuItems,
  resolvedActiveFileRowKey,
  selectedPathSet,
  sessionId,
  sftpDimHiddenEntries,
  sftpShowHiddenEntries,
  status,
  visibleEntries,
}) => {
  const { formatDateTime } = useDateTimeFormatter();
  const visibleColumns = React.useMemo(
    () => resolveVisibleSftpDirectoryColumns(directoryListView),
    [directoryListView],
  );
  const directoryGridTemplate = React.useMemo(() => buildSftpDirectoryGridTemplate(visibleColumns), [visibleColumns]);
  const directoryGridStyle = React.useMemo<React.CSSProperties>(
    () => ({ gridTemplateColumns: directoryGridTemplate }),
    [directoryGridTemplate],
  );
  const directoryListStyle = React.useMemo<React.CSSProperties>(
    () => ({ minWidth: resolveSftpDirectoryListMinWidth(visibleColumns) }),
    [visibleColumns],
  );
  const headerColumnIds = React.useMemo(() => visibleColumns.map((column) => column.id), [visibleColumns]);
  const headerDragSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleHeaderDragEnd = React.useCallback(
    (event: DragEndEvent): void => {
      const activeId = event.active.id;
      const overId = event.over?.id;
      if (!isSftpDirectoryListColumnId(activeId) || !isSftpDirectoryListColumnId(overId) || activeId === overId) {
        return;
      }

      const currentColumnIds = directoryListView.columns.map((column) => column.id);
      const oldIndex = currentColumnIds.indexOf(activeId);
      const newIndex = currentColumnIds.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      onDirectoryListColumnOrderChange(arrayMove(currentColumnIds, oldIndex, newIndex));
    },
    [directoryListView.columns, onDirectoryListColumnOrderChange],
  );

  const renderPlaceholderCell = React.useCallback((column: SftpDirectoryColumnDefinition): React.ReactNode => {
    return (
      <span
        key={column.id}
        className={classNames(
          'min-w-0 truncate text-xs text-home-text-subtle',
          column.align === 'right' && 'text-right',
          column.monospace && 'font-mono',
        )}
      >
        -
      </span>
    );
  }, []);

  return (
    <main className={SFTP_CARD_CLASS_NAME}>
      {status === 'error' ? (
        <div className="flex h-full min-h-0 items-center justify-center px-6 text-center">
          <div className="flex max-w-[360px] flex-col items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-form-message-error" />
            <div className="text-home-text text-sm">{errorMessage || t('sftp.loadFailed')}</div>
            <Menubar>
              <Button
                variant="ghost"
                padding="mid"
                disabled={!sessionId}
                onClick={onRefresh}
              >
                {t('sftp.actions.retry')}
              </Button>
            </Menubar>
          </div>
        </div>
      ) : status === 'connecting' || status === 'loading' ? (
        <div className="flex h-full min-h-0 items-center justify-center gap-2 px-6 text-center text-sm text-home-text-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === 'connecting' ? t('sftp.connecting') : t('sftp.loading')}
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="h-full min-h-0 overflow-auto">
              <div
                className="flex min-h-full flex-col"
                style={directoryListStyle}
              >
                <DndContext
                  collisionDetection={closestCenter}
                  modifiers={[restrictToHorizontalAxis]}
                  sensors={headerDragSensors}
                  onDragEnd={handleHeaderDragEnd}
                >
                  <SortableContext
                    items={headerColumnIds}
                    strategy={horizontalListSortingStrategy}
                  >
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div
                          className="sticky top-0 z-10 grid h-[30px] shrink-0 items-center bg-ssh-card-bg-terminal px-3 text-xs font-medium text-home-text-subtle"
                          style={directoryGridStyle}
                        >
                          {visibleColumns.map((column) => (
                            <SortableHeaderCell
                              key={column.id}
                              column={column}
                              sort={directoryListView.sort}
                              onSortFieldClick={onDirectoryListSortFieldClick}
                            />
                          ))}
                          <span />
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent onCloseAutoFocus={onInlineEditMenuCloseAutoFocus}>
                        <SftpDirectoryViewMenuItems
                          columnsPlacement="inline"
                          directoryListView={directoryListView}
                          menuSurface="context"
                          onColumnVisibilityChange={onDirectoryListColumnVisibilityChange}
                          onSortChange={onDirectoryListSortChange}
                        />
                      </ContextMenuContent>
                    </ContextMenu>
                  </SortableContext>
                </DndContext>
                <div
                  className="min-h-0 flex-1"
                  onClick={(event) => {
                    if (event.button === 0 && event.currentTarget === event.target) {
                      onDirectoryBlankClick();
                    }
                  }}
                >
                  {status === 'idle' ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                      {t('sftp.noSession')}
                    </div>
                  ) : null}
                  {status === 'ready' && entries.length === 0 && !pendingCreate && !hasParentDirectoryListEntry ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                      {t('sftp.empty')}
                    </div>
                  ) : null}
                  {status === 'ready' &&
                  entries.length > 0 &&
                  visibleEntries.length === 0 &&
                  !hasParentDirectoryListEntry ? (
                    <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                      {t('sftp.searchEmpty')}
                    </div>
                  ) : null}
                  {status === 'ready' && hasParentDirectoryListEntry ? (
                    <div
                      ref={(element) => {
                        fileRowRefs.current[PARENT_DIRECTORY_ROW_KEY] = element;
                      }}
                      role="button"
                      aria-label={t('sftp.parentDirectoryEntryLabel')}
                      aria-disabled={!canActivateParentDirectoryListEntry}
                      tabIndex={
                        canActivateParentDirectoryListEntry && resolvedActiveFileRowKey === PARENT_DIRECTORY_ROW_KEY
                          ? 0
                          : -1
                      }
                      className={classNames(
                        'focus-visible:ring-form-ring grid h-[34px] w-full items-center rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
                        canActivateParentDirectoryListEntry
                          ? 'text-home-text hover:bg-home-card-hover'
                          : 'cursor-default text-home-text-subtle opacity-55',
                      )}
                      style={directoryGridStyle}
                      onDoubleClick={canActivateParentDirectoryListEntry ? onParentDirectory : undefined}
                      onFocus={() => {
                        if (canActivateParentDirectoryListEntry) {
                          onSetActiveFileRowKey(PARENT_DIRECTORY_ROW_KEY);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (canActivateParentDirectoryListEntry) {
                          onFileNavigationRowKeyDown(event, {
                            kind: 'parent',
                            key: PARENT_DIRECTORY_ROW_KEY,
                          });
                        }
                      }}
                    >
                      {visibleColumns.map((column) =>
                        column.id === 'name' ? (
                          <span
                            key={column.id}
                            className="flex min-w-0 items-center gap-2 overflow-hidden"
                          >
                            <Undo2
                              className={classNames(
                                'h-4 w-4 shrink-0',
                                canActivateParentDirectoryListEntry ? 'text-home-text' : 'text-home-text-subtle',
                              )}
                            />
                            <span className="truncate">..</span>
                          </span>
                        ) : (
                          renderPlaceholderCell(column)
                        ),
                      )}
                      <span />
                    </div>
                  ) : null}
                  {pendingCreate ? (
                    <div
                      className={classNames(
                        'text-home-text grid h-[34px] w-full items-center rounded-lg bg-home-card-hover px-3 text-left text-sm',
                      )}
                      style={directoryGridStyle}
                    >
                      {visibleColumns.map((column) =>
                        column.id === 'name' ? (
                          <span
                            key={column.id}
                            className="flex min-w-0 items-center gap-2 overflow-hidden"
                          >
                            {pendingCreate.type === 'directory' ? (
                              <Folder className="text-home-text h-4 w-4 shrink-0" />
                            ) : (
                              <File className="text-home-text h-4 w-4 shrink-0" />
                            )}
                            <Input
                              ref={renameInputRef}
                              aria-label={t('sftp.renameInputLabel')}
                              className="h-[26px] min-w-0 flex-1 rounded-sm-2 px-0 text-sm"
                              value={renameInput}
                              onBlur={() => {
                                onInlineEditInputBlur(onCommitPendingCreate);
                              }}
                              onChange={(event) => onRenameInputChange(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void onCommitPendingCreate();
                                }

                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  onCancelInlineEdit();
                                }
                              }}
                            />
                          </span>
                        ) : (
                          renderPlaceholderCell(column)
                        ),
                      )}
                      <span />
                    </div>
                  ) : null}
                  {status === 'ready' && visibleEntries.length > 0
                    ? visibleEntries.map((entry, index) => {
                        const isSelected = selectedPathSet.has(entry.path);
                        const hasSelectedPreviousEntry =
                          isSelected && index > 0 && selectedPathSet.has(visibleEntries[index - 1]?.path ?? '');
                        const hasSelectedNextEntry =
                          isSelected &&
                          index < visibleEntries.length - 1 &&
                          selectedPathSet.has(visibleEntries[index + 1]?.path ?? '');
                        const isCut = clipboardMode === 'cut' ? clipboardPaths.has(entry.path) : false;
                        const shouldDimHiddenEntry = sftpShowHiddenEntries && sftpDimHiddenEntries && entry.isHidden;
                        const hiddenEntryVisualClassName = shouldDimHiddenEntry ? 'opacity-80' : undefined;

                        return (
                          <ContextMenu key={entry.path}>
                            <ContextMenuTrigger asChild>
                              <div
                                ref={(element) => {
                                  fileRowRefs.current[entry.path] = element;
                                }}
                                role="button"
                                aria-selected={isSelected}
                                tabIndex={resolvedActiveFileRowKey === entry.path ? 0 : -1}
                                className={classNames(
                                  'grid h-[34px] w-full items-center px-3 text-left text-sm transition-colors hover:bg-home-card-hover',
                                  hasSelectedPreviousEntry && hasSelectedNextEntry
                                    ? 'rounded-none'
                                    : hasSelectedPreviousEntry
                                      ? 'rounded-b-lg rounded-t-none'
                                      : hasSelectedNextEntry
                                        ? 'rounded-b-none rounded-t-lg'
                                        : 'rounded-lg',
                                  isSelected ? 'text-home-text bg-home-card-hover' : 'text-home-text',
                                  isCut ? 'opacity-55' : '',
                                )}
                                style={directoryGridStyle}
                                onClick={(event) => {
                                  onSetActiveFileRowKey(entry.path);
                                  onEntrySelect(entry, event);
                                }}
                                onDoubleClick={() => onEntryOpen(entry)}
                                onContextMenu={() => onEntryContextMenu(entry)}
                                onFocus={() => onSetActiveFileRowKey(entry.path)}
                                onKeyDown={(event) => {
                                  onFileNavigationRowKeyDown(event, {
                                    kind: 'entry',
                                    key: entry.path,
                                    entry,
                                  });
                                }}
                              >
                                {visibleColumns.map((column) =>
                                  column.id === 'name' ? (
                                    <span
                                      key={column.id}
                                      className="flex min-w-0 items-center gap-2 overflow-hidden"
                                    >
                                      {resolveEntryIcon(entry, hiddenEntryVisualClassName)}
                                      {renamingEntryPath === entry.path ? (
                                        <Input
                                          ref={renameInputRef}
                                          aria-label={t('sftp.renameInputLabel')}
                                          className="h-[26px] min-w-0 flex-1 rounded-sm-2 px-0 text-sm"
                                          value={renameInput}
                                          onClick={(event) => event.stopPropagation()}
                                          onBlur={() => {
                                            onInlineEditInputBlur(() => onCommitRenameEntry(entry));
                                          }}
                                          onChange={(event) => onRenameInputChange(event.target.value)}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              event.preventDefault();
                                              void onCommitRenameEntry(entry);
                                            }

                                            if (event.key === 'Escape') {
                                              event.preventDefault();
                                              onCancelInlineEdit();
                                            }
                                          }}
                                        />
                                      ) : (
                                        <span className={classNames('truncate', hiddenEntryVisualClassName)}>
                                          {entry.name}
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span
                                      key={column.id}
                                      className={classNames(
                                        'min-w-0 truncate text-xs text-home-text-subtle',
                                        column.align === 'right' && 'text-right',
                                        column.monospace && 'font-mono',
                                        hiddenEntryVisualClassName,
                                      )}
                                    >
                                      {formatSftpDirectoryColumnValue(column.id, entry, formatDateTime)}
                                    </span>
                                  ),
                                )}
                                <span />
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent onCloseAutoFocus={onInlineEditMenuCloseAutoFocus}>
                              {renderActionMenuItems({
                                contextEntry: entry,
                                menuSurface: 'context',
                                scope: 'entry',
                                showShortcuts: true,
                              })}
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })
                    : null}
                </div>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent onCloseAutoFocus={onInlineEditMenuCloseAutoFocus}>
            {renderActionMenuItems({
              contextEntry: null,
              menuSurface: 'context',
              scope: 'directory',
              showShortcuts: true,
            })}
          </ContextMenuContent>
        </ContextMenu>
      )}
    </main>
  );
};
