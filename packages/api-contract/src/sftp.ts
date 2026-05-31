export type SftpSortableEntry = {
  name: string;
  type: string;
};

export type SftpNamedItem = {
  name: string;
};

const SFTP_NAME_COMPARE_OPTIONS: Intl.CollatorOptions = {
  sensitivity: 'base',
  numeric: true,
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
