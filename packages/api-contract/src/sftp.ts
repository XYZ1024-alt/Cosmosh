export type SftpSortableEntry = {
  name: string;
  type: string;
};

export type SftpNamedItem = {
  name: string;
};

export const SFTP_DIRECTORY_LIST_COLUMN_IDS = [
  'name',
  'modifiedAt',
  'type',
  'size',
  'accessedAt',
  'permissions',
  'permissionOctal',
  'mode',
  'uid',
  'gid',
  'extension',
  'isHidden',
  'path',
  'parentPath',
  'shellEscapedPath',
  'longname',
] as const;

export type SftpDirectoryListColumnId = (typeof SFTP_DIRECTORY_LIST_COLUMN_IDS)[number];

export type SftpDirectoryListSortDirection = 'asc' | 'desc';

export type SftpDirectoryListColumnSetting = {
  readonly id: SftpDirectoryListColumnId;
  readonly visible: boolean;
};

export type SftpDirectoryListSortSetting = {
  readonly field: SftpDirectoryListColumnId;
  readonly direction: SftpDirectoryListSortDirection;
};

export type SftpDirectoryListViewSetting = {
  readonly version: 1;
  readonly columns: ReadonlyArray<SftpDirectoryListColumnSetting>;
  readonly sort: SftpDirectoryListSortSetting;
};

const DEFAULT_SFTP_DIRECTORY_LIST_VISIBLE_COLUMN_IDS = new Set<SftpDirectoryListColumnId>([
  'name',
  'modifiedAt',
  'type',
  'size',
  'permissions',
]);

export const DEFAULT_SFTP_DIRECTORY_LIST_VIEW_SETTING: SftpDirectoryListViewSetting = {
  version: 1,
  columns: SFTP_DIRECTORY_LIST_COLUMN_IDS.map((id) => ({
    id,
    visible: DEFAULT_SFTP_DIRECTORY_LIST_VISIBLE_COLUMN_IDS.has(id),
  })),
  sort: {
    field: 'name',
    direction: 'asc',
  },
};

const SFTP_DIRECTORY_LIST_COLUMN_ID_SET = new Set<string>(SFTP_DIRECTORY_LIST_COLUMN_IDS as ReadonlyArray<string>);

const SFTP_NAME_COMPARE_OPTIONS: Intl.CollatorOptions = {
  sensitivity: 'base',
  numeric: true,
};

/**
 * Checks whether an unknown JSON value is a supported SFTP list column id.
 *
 * @param value Candidate value from settings JSON.
 * @returns Whether the value maps to a known SFTP list column.
 */
export const isSftpDirectoryListColumnId = (value: unknown): value is SftpDirectoryListColumnId => {
  return typeof value === 'string' && SFTP_DIRECTORY_LIST_COLUMN_ID_SET.has(value);
};

/**
 * Compares SFTP-style name strings using natural ordering.
 *
 * @param leftName Left entry name.
 * @param rightName Right entry name.
 * @returns Sort comparison value.
 */
export const compareSftpNames = (leftName: string, rightName: string): number => {
  return leftName.localeCompare(rightName, undefined, SFTP_NAME_COMPARE_OPTIONS);
};

/**
 * Compares SFTP-style names using the browser's natural ordering rules.
 *
 * @param left Left named item.
 * @param right Right named item.
 * @returns Sort comparison value.
 */
export const compareSftpEntryNames = <TItem extends SftpNamedItem>(left: TItem, right: TItem): number => {
  return compareSftpNames(left.name, right.name);
};

/**
 * Compares entries in the canonical SFTP browser order.
 *
 * @param left Left entry.
 * @param right Right entry.
 * @returns Sort comparison value with directories before non-directories.
 */
export const compareSftpEntriesByBrowserOrder = <TEntry extends SftpSortableEntry>(
  left: TEntry,
  right: TEntry,
): number => {
  if (left.type === 'directory' && right.type !== 'directory') {
    return -1;
  }

  if (left.type !== 'directory' && right.type === 'directory') {
    return 1;
  }

  return compareSftpEntryNames(left, right);
};

/**
 * Sorts entries in the canonical SFTP browser order.
 *
 * @param entries Entries to sort.
 * @returns New array sorted with directories first, then natural name order.
 */
export const sortSftpEntriesByBrowserOrder = <TEntry extends SftpSortableEntry>(
  entries: readonly TEntry[],
): TEntry[] => {
  return [...entries].sort(compareSftpEntriesByBrowserOrder);
};
