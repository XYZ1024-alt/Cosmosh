import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual';

import type { TreeDirectoryNode } from './sftp-types';

/** Fixed height of the sticky SFTP directory-list header. */
export const SFTP_DIRECTORY_HEADER_HEIGHT_PX = 30;

/** Fixed height of one SFTP directory-list row. */
export const SFTP_DIRECTORY_ROW_HEIGHT_PX = 34;

/** Fixed height of one SFTP tree row. */
export const SFTP_TREE_ROW_HEIGHT_PX = 30;

/** Extra virtual rows mounted before and after each SFTP viewport. */
export const SFTP_VIRTUAL_OVERSCAN_ROWS = 8;

/**
 * One visible row in the flattened SFTP directory tree.
 */
export type SftpVirtualTreeRow = {
  /** Stable remote path and virtualizer key. */
  path: string;
  /** Visual nesting depth used by the fixed indentation ladder. */
  depth: number;
  /** One-based position within the row's logical sibling set. */
  positionInSet: number;
  /** Total rows in the row's logical sibling set. */
  setSize: number;
};

/**
 * Inclusive index range for fixed-height rows intersecting a vertical interval.
 */
export type SftpVirtualRowIndexRange = {
  /** First intersecting logical row index. */
  startIndex: number;
  /** Last intersecting logical row index. */
  endIndex: number;
};

/**
 * Flattens expanded SFTP tree nodes while retaining the depth required by row indentation.
 *
 * @param treeNodes Directory tree registry keyed by remote path.
 * @param rootPaths Top-level paths in visual order.
 * @returns Visible tree rows in visual and keyboard-navigation order.
 */
export const flattenVisibleSftpTreeRows = (
  treeNodes: Record<string, TreeDirectoryNode>,
  rootPaths: string[],
): SftpVirtualTreeRow[] => {
  const rows: SftpVirtualTreeRow[] = [];

  /**
   * Appends one node and its expanded descendants without materializing recursive React subtrees.
   *
   * @param nodePath Directory node path.
   * @param depth Visual nesting depth.
   * @returns void.
   */
  const appendNode = (nodePath: string, depth: number, positionInSet: number, setSize: number): void => {
    const node = treeNodes[nodePath];
    if (!node) {
      return;
    }

    rows.push({ path: node.path, depth, positionInSet, setSize });

    if (node.isExpanded) {
      node.children.forEach((childPath, childIndex) =>
        appendNode(childPath, depth + 1, childIndex + 1, node.children.length),
      );
    }
  };

  rootPaths.forEach((rootPath, rootIndex) => appendNode(rootPath, 0, rootIndex + 1, rootPaths.length));

  return rows;
};

/**
 * Extends TanStack Virtual's visible range with rows that must stay mounted for focus or editing.
 *
 * @param range Current virtualizer range.
 * @param pinnedIndexes Logical row indexes that must remain mounted.
 * @returns Sorted, unique row indexes constrained to the current item count.
 */
export const extractSftpVirtualRange = (range: Range, pinnedIndexes: readonly number[]): number[] => {
  const rowIndexes = new Set(defaultRangeExtractor(range));

  pinnedIndexes.forEach((index) => {
    if (index >= 0 && index < range.count) {
      rowIndexes.add(index);
    }
  });

  return Array.from(rowIndexes).sort((left, right) => left - right);
};

/**
 * Resolves fixed-height row indexes intersecting a content-coordinate interval.
 *
 * Boundary contact counts as an intersection to match DOMRect-based marquee selection semantics.
 *
 * @param rowCount Total logical row count.
 * @param rowHeight Fixed row height in pixels.
 * @param rowsStartOffset Content-coordinate offset of the first row.
 * @param intervalStart Smaller vertical content coordinate.
 * @param intervalEnd Larger vertical content coordinate.
 * @returns Inclusive intersecting index range, or null when the interval misses every row.
 */
export const resolveIntersectingSftpVirtualRowRange = (
  rowCount: number,
  rowHeight: number,
  rowsStartOffset: number,
  intervalStart: number,
  intervalEnd: number,
): SftpVirtualRowIndexRange | null => {
  if (rowCount <= 0 || rowHeight <= 0 || intervalEnd < intervalStart) {
    return null;
  }

  const startIndex = Math.max(0, Math.ceil((intervalStart - rowsStartOffset) / rowHeight) - 1);
  const endIndex = Math.min(rowCount - 1, Math.floor((intervalEnd - rowsStartOffset) / rowHeight));

  return startIndex <= endIndex ? { startIndex, endIndex } : null;
};

/**
 * Checks whether every requested fixed-height row fits inside the current viewport.
 *
 * @param rowIndexes Logical row indexes forming the context to inspect.
 * @param rowHeight Fixed row height in pixels.
 * @param scrollOffset Current scroll offset in pixels.
 * @param viewportSize Visible viewport height in pixels.
 * @returns Whether the complete row context is visible.
 */
export const isSftpVirtualRowContextVisible = (
  rowIndexes: readonly number[],
  rowHeight: number,
  scrollOffset: number,
  viewportSize: number,
): boolean => {
  if (rowIndexes.length === 0 || rowHeight <= 0 || viewportSize <= 0) {
    return false;
  }

  const contextStart = Math.min(...rowIndexes) * rowHeight;
  const contextEnd = (Math.max(...rowIndexes) + 1) * rowHeight;

  return contextStart >= scrollOffset && contextEnd <= scrollOffset + viewportSize;
};

/**
 * Resolves a clamped scroll offset that places one fixed-height row at a viewport ratio.
 *
 * @param rowIndex Logical row index to reveal.
 * @param rowHeight Fixed row height in pixels.
 * @param rowCount Total logical row count.
 * @param viewportSize Visible viewport height in pixels.
 * @param viewportRatio Desired row-center position within the viewport.
 * @returns Clamped scroll offset in pixels.
 */
export const resolveSftpVirtualRowScrollOffset = (
  rowIndex: number,
  rowHeight: number,
  rowCount: number,
  viewportSize: number,
  viewportRatio: number,
): number => {
  const totalSize = Math.max(0, rowCount * rowHeight);
  const maxScrollOffset = Math.max(0, totalSize - Math.max(0, viewportSize));
  const targetViewportTop = viewportSize * viewportRatio - rowHeight / 2;
  const desiredScrollOffset = rowIndex * rowHeight - targetViewportTop;

  return Math.min(Math.max(desiredScrollOffset, 0), maxScrollOffset);
};
