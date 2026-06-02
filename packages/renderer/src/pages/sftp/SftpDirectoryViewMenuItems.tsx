import {
  type SftpDirectoryListColumnId,
  type SftpDirectoryListSortDirection,
  type SftpDirectoryListViewSetting,
} from '@cosmosh/api-contract';
import { ArrowDownUp, Columns3, ListFilter } from 'lucide-react';
import React from 'react';

import {
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../../components/ui/context-menu';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../../components/ui/dropdown-menu';
import { t } from '../../lib/i18n';
import { SFTP_DIRECTORY_COLUMN_DEFINITIONS } from './sftp-directory-view';

type SftpDirectoryViewMenuSurface = 'context' | 'dropdown';

type SftpDirectoryViewMenuItemsProps = {
  columnsPlacement?: 'inline' | 'submenu';
  directoryListView: SftpDirectoryListViewSetting;
  menuSurface: SftpDirectoryViewMenuSurface;
  onColumnVisibilityChange: (columnId: SftpDirectoryListColumnId, visible: boolean) => void;
  onSortChange: (sort: { field: SftpDirectoryListColumnId; direction: SftpDirectoryListSortDirection }) => void;
};

/**
 * Renders the shared SFTP directory list view menu for context and dropdown surfaces.
 *
 * @param props Current directory-list view setting and mutation callbacks.
 * @returns Menu items for sorting and column visibility.
 */
export const SftpDirectoryViewMenuItems: React.FC<SftpDirectoryViewMenuItemsProps> = ({
  columnsPlacement = 'submenu',
  directoryListView,
  menuSurface,
  onColumnVisibilityChange,
  onSortChange,
}) => {
  const MenuSub = menuSurface === 'context' ? ContextMenuSub : DropdownMenuSub;
  const MenuSubTrigger = menuSurface === 'context' ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const MenuSubContent = menuSurface === 'context' ? ContextMenuSubContent : DropdownMenuSubContent;
  const MenuCheckboxItem = menuSurface === 'context' ? ContextMenuCheckboxItem : DropdownMenuCheckboxItem;
  const MenuLabel = menuSurface === 'context' ? ContextMenuLabel : DropdownMenuLabel;
  const MenuSeparator = menuSurface === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;

  const visibleColumnIds = new Set(
    directoryListView.columns.filter((column) => column.visible).map((column) => column.id),
  );
  const columnItems = SFTP_DIRECTORY_COLUMN_DEFINITIONS.map((column) => (
    <MenuCheckboxItem
      key={column.id}
      checked={visibleColumnIds.has(column.id)}
      disabled={column.id === 'name'}
      onCheckedChange={(checked) => {
        onColumnVisibilityChange(column.id, Boolean(checked));
      }}
    >
      {t(column.labelI18nKey)}
    </MenuCheckboxItem>
  ));

  return (
    <>
      <MenuSub>
        <MenuSubTrigger icon={ArrowDownUp}>{t('sftp.viewMenu.sortBy')}</MenuSubTrigger>
        <MenuSubContent>
          {SFTP_DIRECTORY_COLUMN_DEFINITIONS.map((column) => (
            <MenuCheckboxItem
              key={column.id}
              checked={directoryListView.sort.field === column.id}
              onCheckedChange={(checked) => {
                if (checked) {
                  onSortChange({
                    field: column.id,
                    direction: directoryListView.sort.direction,
                  });
                }
              }}
            >
              {t(column.labelI18nKey)}
            </MenuCheckboxItem>
          ))}
        </MenuSubContent>
      </MenuSub>

      <MenuSub>
        <MenuSubTrigger icon={ListFilter}>{t('sftp.viewMenu.sortDirection')}</MenuSubTrigger>
        <MenuSubContent>
          <MenuCheckboxItem
            checked={directoryListView.sort.direction === 'asc'}
            onCheckedChange={(checked) => {
              if (checked) {
                onSortChange({
                  field: directoryListView.sort.field,
                  direction: 'asc',
                });
              }
            }}
          >
            {t('sftp.viewMenu.ascending')}
          </MenuCheckboxItem>
          <MenuCheckboxItem
            checked={directoryListView.sort.direction === 'desc'}
            onCheckedChange={(checked) => {
              if (checked) {
                onSortChange({
                  field: directoryListView.sort.field,
                  direction: 'desc',
                });
              }
            }}
          >
            {t('sftp.viewMenu.descending')}
          </MenuCheckboxItem>
        </MenuSubContent>
      </MenuSub>

      <MenuSeparator />

      {columnsPlacement === 'inline' ? (
        <>
          <MenuLabel>{t('sftp.viewMenu.columns')}</MenuLabel>
          {columnItems}
        </>
      ) : (
        <MenuSub>
          <MenuSubTrigger icon={Columns3}>{t('sftp.viewMenu.columns')}</MenuSubTrigger>
          <MenuSubContent className="w-[240px]">
            <MenuLabel>{t('sftp.viewMenu.columns')}</MenuLabel>
            {columnItems}
          </MenuSubContent>
        </MenuSub>
      )}
    </>
  );
};
