import type {
  SettingsValues,
  SftpAuxiliarySidebarMode,
  SftpDirectoryListColumnId,
  SftpDirectoryListSortDirection,
  SftpDirectoryListViewSetting,
} from '@cosmosh/api-contract';
import React from 'react';

import { updateAppSettings } from '../../lib/backend';
import { t } from '../../lib/i18n';
import { updateSettingsStoreValues } from '../../lib/settings-store';
import { isDirtySftpTextPreviewState, stringifySftpDirectoryListView } from './sftp-page-utils';
import type { SftpPreviewState } from './sftp-types';

/**
 * Inputs needed to persist SFTP browser display preferences.
 */
type UseSftpDirectoryListPreferencesParams = {
  settingsValues: SettingsValues;
  registrySftpDirectoryListView: SftpDirectoryListViewSetting;
  previewStateRef: React.MutableRefObject<SftpPreviewState | null>;
  notifyError: (message: string) => void;
};

/**
 * SFTP preference state and mutators consumed by toolbar and directory controls.
 */
type UseSftpDirectoryListPreferencesResult = {
  sftpDirectoryListView: SftpDirectoryListViewSetting;
  setSftpHiddenEntriesVisibility: (showHiddenEntries: boolean) => Promise<void>;
  setSftpAuxiliarySidebarMode: (mode: SftpAuxiliarySidebarMode) => Promise<void>;
  setSftpAddressDisplayMode: (showAddressAsText: boolean) => Promise<void>;
  setSftpDirectoryListSort: (sort: {
    field: SftpDirectoryListColumnId;
    direction: SftpDirectoryListSortDirection;
  }) => void;
  handleSftpDirectoryListSortFieldClick: (columnId: SftpDirectoryListColumnId) => void;
  setSftpDirectoryListColumnVisibility: (columnId: SftpDirectoryListColumnId, visible: boolean) => void;
  setSftpDirectoryListColumnOrder: (columnIds: SftpDirectoryListColumnId[]) => void;
};

/**
 * Persists SFTP page display preferences while keeping optimistic local drafts scoped to this tab.
 *
 * @param params Settings snapshot, preview guard, and error reporter.
 * @returns Display preference values and mutators.
 */
export const useSftpDirectoryListPreferences = ({
  settingsValues,
  registrySftpDirectoryListView,
  previewStateRef,
  notifyError,
}: UseSftpDirectoryListPreferencesParams): UseSftpDirectoryListPreferencesResult => {
  const [directoryListViewDraft, setDirectoryListViewDraft] = React.useState<SftpDirectoryListViewSetting | null>(null);
  const sftpDirectoryListView = directoryListViewDraft ?? registrySftpDirectoryListView;

  React.useEffect(() => {
    if (!directoryListViewDraft) {
      return;
    }

    if (
      stringifySftpDirectoryListView(directoryListViewDraft) ===
      stringifySftpDirectoryListView(registrySftpDirectoryListView)
    ) {
      setDirectoryListViewDraft(null);
    }
  }, [directoryListViewDraft, registrySftpDirectoryListView]);

  const setSftpHiddenEntriesVisibility = React.useCallback(
    async (showHiddenEntries: boolean): Promise<void> => {
      if (settingsValues.sftpShowHiddenEntries === showHiddenEntries) {
        return;
      }

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpShowHiddenEntries: showHiddenEntries,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [notifyError, settingsValues],
  );

  const setSftpAuxiliarySidebarMode = React.useCallback(
    async (mode: SftpAuxiliarySidebarMode): Promise<void> => {
      if (mode !== 'preview' && isDirtySftpTextPreviewState(previewStateRef.current)) {
        notifyError(t('sftp.previewUnsavedChanges'));
        return;
      }

      if (settingsValues.sftpAuxiliarySidebarMode === mode) {
        return;
      }

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpAuxiliarySidebarMode: mode,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [notifyError, previewStateRef, settingsValues],
  );

  const setSftpAddressDisplayMode = React.useCallback(
    async (showAddressAsText: boolean): Promise<void> => {
      if (settingsValues.sftpShowAddressAsText === showAddressAsText) {
        return;
      }

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpShowAddressAsText: showAddressAsText,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [notifyError, settingsValues],
  );

  const persistSftpDirectoryListView = React.useCallback(
    async (nextDirectoryListView: SftpDirectoryListViewSetting): Promise<void> => {
      const currentDirectoryListView = directoryListViewDraft ?? settingsValues.sftpDirectoryListView;
      if (
        stringifySftpDirectoryListView(currentDirectoryListView) ===
        stringifySftpDirectoryListView(nextDirectoryListView)
      ) {
        return;
      }

      setDirectoryListViewDraft(nextDirectoryListView);

      try {
        const response = await updateAppSettings({
          values: {
            ...settingsValues,
            sftpDirectoryListView: nextDirectoryListView,
          },
        });

        await updateSettingsStoreValues(response.data.item.values);
      } catch (error: unknown) {
        setDirectoryListViewDraft(null);
        notifyError(error instanceof Error ? error.message : t('settings.saveFailed'));
      }
    },
    [directoryListViewDraft, notifyError, settingsValues],
  );

  const setSftpDirectoryListSort = React.useCallback(
    (sort: { field: SftpDirectoryListColumnId; direction: SftpDirectoryListSortDirection }): void => {
      void persistSftpDirectoryListView({
        ...sftpDirectoryListView,
        sort,
      });
    },
    [persistSftpDirectoryListView, sftpDirectoryListView],
  );

  const handleSftpDirectoryListSortFieldClick = React.useCallback(
    (columnId: SftpDirectoryListColumnId): void => {
      const isCurrentSortField = sftpDirectoryListView.sort.field === columnId;
      const nextDirection: SftpDirectoryListSortDirection =
        isCurrentSortField && sftpDirectoryListView.sort.direction === 'asc' ? 'desc' : 'asc';

      setSftpDirectoryListSort({
        field: columnId,
        direction: isCurrentSortField ? nextDirection : 'asc',
      });
    },
    [setSftpDirectoryListSort, sftpDirectoryListView.sort],
  );

  const setSftpDirectoryListColumnVisibility = React.useCallback(
    (columnId: SftpDirectoryListColumnId, visible: boolean): void => {
      void persistSftpDirectoryListView({
        ...sftpDirectoryListView,
        columns: sftpDirectoryListView.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                visible: column.id === 'name' ? true : visible,
              }
            : column,
        ),
      });
    },
    [persistSftpDirectoryListView, sftpDirectoryListView],
  );

  const setSftpDirectoryListColumnOrder = React.useCallback(
    (columnIds: SftpDirectoryListColumnId[]): void => {
      const currentColumnsById = new Map(sftpDirectoryListView.columns.map((column) => [column.id, column]));
      const nextColumns = columnIds.map((columnId) => {
        const currentColumn = currentColumnsById.get(columnId);
        return {
          id: columnId,
          visible: columnId === 'name' ? true : Boolean(currentColumn?.visible),
        };
      });

      void persistSftpDirectoryListView({
        ...sftpDirectoryListView,
        columns: nextColumns,
      });
    },
    [persistSftpDirectoryListView, sftpDirectoryListView],
  );

  return {
    sftpDirectoryListView,
    setSftpHiddenEntriesVisibility,
    setSftpAuxiliarySidebarMode,
    setSftpAddressDisplayMode,
    setSftpDirectoryListSort,
    handleSftpDirectoryListSortFieldClick,
    setSftpDirectoryListColumnVisibility,
    setSftpDirectoryListColumnOrder,
  };
};
