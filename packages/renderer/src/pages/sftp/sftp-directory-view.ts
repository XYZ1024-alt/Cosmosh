import {
  type ApiSftpEntry,
  compareSftpEntryNames,
  compareSftpNames,
  type SftpDirectoryListColumnId,
  type SftpDirectoryListSortSetting,
  type SftpDirectoryListViewSetting,
} from '@cosmosh/api-contract';

import { t } from '../../lib/i18n';
import type { DateTimeDisplayFormatter } from './sftp-utils';
import { formatFileSize, formatModifiedAt } from './sftp-utils';

export type SftpDirectoryColumnDefinition = {
  readonly id: SftpDirectoryListColumnId;
  readonly labelI18nKey: string;
  readonly gridTrack: string;
  readonly minWidth: number;
  readonly align: 'left' | 'right';
  readonly monospace: boolean;
};

export const SFTP_DIRECTORY_COLUMN_DEFINITIONS: ReadonlyArray<SftpDirectoryColumnDefinition> = [
  {
    id: 'name',
    labelI18nKey: 'sftp.columns.name',
    gridTrack: 'minmax(220px,1.6fr)',
    minWidth: 220,
    align: 'left',
    monospace: false,
  },
  {
    id: 'modifiedAt',
    labelI18nKey: 'sftp.columns.modifiedAt',
    gridTrack: 'minmax(148px,0.75fr)',
    minWidth: 148,
    align: 'left',
    monospace: false,
  },
  {
    id: 'type',
    labelI18nKey: 'sftp.columns.type',
    gridTrack: 'minmax(110px,0.55fr)',
    minWidth: 110,
    align: 'left',
    monospace: false,
  },
  {
    id: 'size',
    labelI18nKey: 'sftp.columns.size',
    gridTrack: 'minmax(92px,0.45fr)',
    minWidth: 92,
    align: 'right',
    monospace: false,
  },
  {
    id: 'accessedAt',
    labelI18nKey: 'sftp.columns.accessedAt',
    gridTrack: 'minmax(148px,0.75fr)',
    minWidth: 148,
    align: 'left',
    monospace: false,
  },
  {
    id: 'permissions',
    labelI18nKey: 'sftp.columns.permissions',
    gridTrack: 'minmax(100px,0.45fr)',
    minWidth: 100,
    align: 'left',
    monospace: true,
  },
  {
    id: 'permissionOctal',
    labelI18nKey: 'sftp.columns.permissionOctal',
    gridTrack: 'minmax(86px,0.35fr)',
    minWidth: 86,
    align: 'left',
    monospace: true,
  },
  {
    id: 'mode',
    labelI18nKey: 'sftp.columns.mode',
    gridTrack: 'minmax(78px,0.32fr)',
    minWidth: 78,
    align: 'right',
    monospace: true,
  },
  {
    id: 'uid',
    labelI18nKey: 'sftp.columns.uid',
    gridTrack: 'minmax(76px,0.32fr)',
    minWidth: 76,
    align: 'right',
    monospace: true,
  },
  {
    id: 'gid',
    labelI18nKey: 'sftp.columns.gid',
    gridTrack: 'minmax(76px,0.32fr)',
    minWidth: 76,
    align: 'right',
    monospace: true,
  },
  {
    id: 'extension',
    labelI18nKey: 'sftp.columns.extension',
    gridTrack: 'minmax(96px,0.4fr)',
    minWidth: 96,
    align: 'left',
    monospace: false,
  },
  {
    id: 'isHidden',
    labelI18nKey: 'sftp.columns.isHidden',
    gridTrack: 'minmax(84px,0.35fr)',
    minWidth: 84,
    align: 'left',
    monospace: false,
  },
  {
    id: 'path',
    labelI18nKey: 'sftp.columns.path',
    gridTrack: 'minmax(220px,1.1fr)',
    minWidth: 220,
    align: 'left',
    monospace: false,
  },
  {
    id: 'parentPath',
    labelI18nKey: 'sftp.columns.parentPath',
    gridTrack: 'minmax(220px,1.1fr)',
    minWidth: 220,
    align: 'left',
    monospace: false,
  },
  {
    id: 'shellEscapedPath',
    labelI18nKey: 'sftp.columns.shellEscapedPath',
    gridTrack: 'minmax(220px,1.1fr)',
    minWidth: 220,
    align: 'left',
    monospace: false,
  },
  {
    id: 'longname',
    labelI18nKey: 'sftp.columns.longname',
    gridTrack: 'minmax(260px,1.2fr)',
    minWidth: 260,
    align: 'left',
    monospace: true,
  },
];

const SFTP_DIRECTORY_COLUMN_DEFINITION_MAP = new Map<SftpDirectoryListColumnId, SftpDirectoryColumnDefinition>(
  SFTP_DIRECTORY_COLUMN_DEFINITIONS.map((definition) => [definition.id, definition]),
);

/**
 * Resolves a column definition by id.
 *
 * @param columnId Supported SFTP list column id.
 * @returns Column definition.
 */
export const getSftpDirectoryColumnDefinition = (
  columnId: SftpDirectoryListColumnId,
): SftpDirectoryColumnDefinition => {
  return SFTP_DIRECTORY_COLUMN_DEFINITION_MAP.get(columnId) ?? SFTP_DIRECTORY_COLUMN_DEFINITIONS[0]!;
};

/**
 * Resolves visible columns in the persisted user order.
 *
 * @param view User directory-list view setting.
 * @returns Visible column definitions.
 */
export const resolveVisibleSftpDirectoryColumns = (
  view: SftpDirectoryListViewSetting,
): SftpDirectoryColumnDefinition[] => {
  return view.columns.filter((column) => column.visible).map((column) => getSftpDirectoryColumnDefinition(column.id));
};

/**
 * Builds the CSS grid template used by the header and every row.
 *
 * @param columns Visible directory columns.
 * @returns CSS grid-template-columns value including the row action spacer.
 */
export const buildSftpDirectoryGridTemplate = (columns: ReadonlyArray<SftpDirectoryColumnDefinition>): string => {
  return `${columns.map((column) => column.gridTrack).join(' ')} 28px`;
};

/**
 * Resolves the minimum pixel width needed by the current column set.
 *
 * @param columns Visible directory columns.
 * @returns Minimum list width in pixels.
 */
export const resolveSftpDirectoryListMinWidth = (columns: ReadonlyArray<SftpDirectoryColumnDefinition>): number => {
  return Math.max(
    600,
    columns.reduce((total, column) => total + column.minWidth, 28),
  );
};

/**
 * Formats a non-name column value for the directory list.
 *
 * @param columnId Column id to render.
 * @param entry SFTP entry.
 * @param formatDateTime Shared application date-time formatter.
 * @returns Compact display text.
 */
export const formatSftpDirectoryColumnValue = (
  columnId: SftpDirectoryListColumnId,
  entry: ApiSftpEntry,
  formatDateTime: DateTimeDisplayFormatter,
): string => {
  switch (columnId) {
    case 'name':
      return entry.name;
    case 'size':
      return entry.type === 'directory' ? '-' : formatFileSize(entry.size);
    case 'modifiedAt':
      return formatModifiedAt(entry.modifiedAt, formatDateTime);
    case 'accessedAt':
      return formatModifiedAt(entry.accessedAt, formatDateTime);
    case 'type':
      return t(`sftp.entryType.${entry.type}`);
    case 'permissions':
      return entry.permissions || '-';
    case 'permissionOctal':
      return entry.permissionOctal || '-';
    case 'mode':
      return Number.isFinite(entry.mode) ? String(entry.mode) : '-';
    case 'uid':
      return Number.isFinite(entry.uid) ? String(entry.uid) : '-';
    case 'gid':
      return Number.isFinite(entry.gid) ? String(entry.gid) : '-';
    case 'extension':
      return entry.extension || '-';
    case 'isHidden':
      return entry.isHidden ? t('sftp.columns.hiddenValue.hidden') : t('sftp.columns.hiddenValue.visible');
    case 'path':
      return entry.path || '-';
    case 'parentPath':
      return entry.parentPath || '-';
    case 'shellEscapedPath':
      return entry.shellEscapedPath || '-';
    case 'longname':
      return entry.longname || '-';
    default:
      return '-';
  }
};

type SftpSortValue = string | number | boolean;

/**
 * Extracts the raw value used for list sorting.
 *
 * @param entry SFTP entry.
 * @param field Sort field.
 * @returns Comparable raw value.
 */
const getSftpDirectorySortValue = (entry: ApiSftpEntry, field: SftpDirectoryListColumnId): SftpSortValue => {
  switch (field) {
    case 'name':
      return entry.name;
    case 'size':
      return entry.size;
    case 'modifiedAt':
      return entry.modifiedAt;
    case 'accessedAt':
      return entry.accessedAt;
    case 'type':
      return entry.type;
    case 'permissions':
      return entry.permissions;
    case 'permissionOctal':
      return entry.permissionOctal;
    case 'mode':
      return entry.mode;
    case 'uid':
      return entry.uid;
    case 'gid':
      return entry.gid;
    case 'extension':
      return entry.extension;
    case 'isHidden':
      return entry.isHidden;
    case 'path':
      return entry.path;
    case 'parentPath':
      return entry.parentPath ?? '';
    case 'shellEscapedPath':
      return entry.shellEscapedPath;
    case 'longname':
      return entry.longname ?? '';
    default:
      return entry.name;
  }
};

/**
 * Compares two typed SFTP sort values.
 *
 * @param left Left value.
 * @param right Right value.
 * @returns Sort comparison value.
 */
const compareSftpDirectorySortValues = (left: SftpSortValue, right: SftpSortValue): number => {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }

  return compareSftpNames(String(left), String(right));
};

/**
 * Sorts SFTP entries with directories first and the configured field within each group.
 *
 * @param entries Directory entries.
 * @param sort Sort field and direction.
 * @returns New sorted entries array.
 */
export const sortSftpEntriesByDirectoryListView = (
  entries: ApiSftpEntry[],
  sort: SftpDirectoryListSortSetting,
): ApiSftpEntry[] => {
  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;

  return [...entries].sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') {
      return -1;
    }

    if (left.type !== 'directory' && right.type === 'directory') {
      return 1;
    }

    const valueDelta =
      compareSftpDirectorySortValues(
        getSftpDirectorySortValue(left, sort.field),
        getSftpDirectorySortValue(right, sort.field),
      ) * directionMultiplier;

    return valueDelta !== 0 ? valueDelta : compareSftpEntryNames(left, right);
  });
};
