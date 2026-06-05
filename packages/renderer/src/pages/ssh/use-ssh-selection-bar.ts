import { type IBufferRange, type Terminal } from '@xterm/xterm';
import React from 'react';

import type { TerminalSelectionAnchor, TerminalSelectionBarPosition, TerminalSelectionBounds } from './ssh-types';

const XTERM_SCREEN_SELECTOR = '.xterm-screen';
const XTERM_SELECTION_LAYER_SELECTOR = '.xterm-selection';

type TerminalSelectionPositionGeometryParams = {
  terminal: Terminal;
  containerElement: HTMLDivElement;
  selectionPosition: IBufferRange;
};

type NormalizedSelectionPosition = {
  startColumn: number;
  startRow: number;
  endColumn: number;
  endRow: number;
};

type VisibleSelectionRowColumns = {
  startColumn: number;
  endColumn: number;
};

/**
 * Normalizes xterm's exclusive selection end coordinate for geometry math.
 *
 * @param selectionPosition Selection range returned by xterm.
 * @param columnCount Current terminal column count.
 * @returns Ordered selection range using visible end-column semantics.
 */
const normalizeSelectionPosition = (
  selectionPosition: IBufferRange,
  columnCount: number,
): NormalizedSelectionPosition | null => {
  const startColumn = selectionPosition.start.x;
  const startRow = selectionPosition.start.y;
  let endColumn = selectionPosition.end.x;
  let endRow = selectionPosition.end.y;

  if (
    !Number.isFinite(startColumn) ||
    !Number.isFinite(startRow) ||
    !Number.isFinite(endColumn) ||
    !Number.isFinite(endRow)
  ) {
    return null;
  }

  if (endColumn <= 0 && endRow > startRow) {
    endColumn = columnCount;
    endRow -= 1;
  }

  return {
    startColumn: Math.max(0, Math.min(startColumn, columnCount)),
    startRow,
    endColumn: Math.max(0, Math.min(endColumn, columnCount)),
    endRow,
  };
};

/**
 * Resolves selected columns for one visible viewport row.
 *
 * @param row Buffer row to resolve.
 * @param selection Normalized selection range.
 * @param columnCount Current terminal column count.
 * @returns Selected start/end columns for the row.
 */
const resolveVisibleSelectionRowColumns = (
  row: number,
  selection: NormalizedSelectionPosition,
  columnCount: number,
): VisibleSelectionRowColumns => {
  if (selection.startRow === selection.endRow) {
    return {
      startColumn: selection.startColumn,
      endColumn: selection.endColumn,
    };
  }

  if (row === selection.startRow) {
    return {
      startColumn: selection.startColumn,
      endColumn: columnCount,
    };
  }

  if (row === selection.endRow) {
    return {
      startColumn: 0,
      endColumn: selection.endColumn,
    };
  }

  return {
    startColumn: 0,
    endColumn: columnCount,
  };
};

/**
 * Resolves terminal selection geometry from xterm buffer coordinates.
 *
 * WebGL renders selection directly into the canvas, so DOM selection blocks may
 * not exist. xterm's public selection position API remains renderer-agnostic.
 *
 * @param params Terminal, host element, and xterm selection position.
 * @returns Absolute selection bounds, or `null` when the selection is offscreen.
 */
const resolveSelectionBoundsFromPosition = ({
  terminal,
  containerElement,
  selectionPosition,
}: TerminalSelectionPositionGeometryParams): TerminalSelectionBounds | null => {
  const columnCount = terminal.cols;
  const rowCount = terminal.rows;
  if (columnCount <= 0 || rowCount <= 0) {
    return null;
  }

  const selection = normalizeSelectionPosition(selectionPosition, columnCount);
  if (!selection) {
    return null;
  }

  const viewportStartRow = terminal.buffer.active.viewportY;
  const selectionStartViewportRow = selection.startRow - viewportStartRow;
  const selectionEndViewportRow = selection.endRow - viewportStartRow;
  const visibleStartViewportRow = Math.max(selectionStartViewportRow, 0);
  const visibleEndViewportRow = Math.min(selectionEndViewportRow, rowCount - 1);

  if (visibleStartViewportRow > visibleEndViewportRow) {
    return null;
  }

  const screenElement = containerElement.querySelector<HTMLElement>(XTERM_SCREEN_SELECTOR);
  if (!screenElement) {
    return null;
  }

  const screenRect = screenElement.getBoundingClientRect();
  if (screenRect.width <= 0 || screenRect.height <= 0) {
    return null;
  }

  const cellWidth = screenRect.width / columnCount;
  const cellHeight = screenRect.height / rowCount;
  if (cellWidth <= 0 || cellHeight <= 0) {
    return null;
  }

  const topVisibleBufferRow = viewportStartRow + visibleStartViewportRow;
  const bottomVisibleBufferRow = viewportStartRow + visibleEndViewportRow;
  const topRowColumns = resolveVisibleSelectionRowColumns(topVisibleBufferRow, selection, columnCount);
  const bottomRowColumns = resolveVisibleSelectionRowColumns(bottomVisibleBufferRow, selection, columnCount);
  const hasMultipleVisibleRows = visibleStartViewportRow < visibleEndViewportRow;
  const unionStartColumn = hasMultipleVisibleRows ? 0 : topRowColumns.startColumn;
  const unionEndColumn = hasMultipleVisibleRows ? columnCount : topRowColumns.endColumn;

  return {
    anchorLeft: screenRect.left + topRowColumns.startColumn * cellWidth,
    anchorRight: screenRect.left + bottomRowColumns.endColumn * cellWidth,
    top: screenRect.top + visibleStartViewportRow * cellHeight,
    left: screenRect.left + unionStartColumn * cellWidth,
    right: screenRect.left + unionEndColumn * cellWidth,
    bottom: screenRect.top + (visibleEndViewportRow + 1) * cellHeight,
  };
};

type UseSshSelectionBarParams = {
  terminalRef: React.RefObject<Terminal | null>;
  terminalContainerRef: React.RefObject<HTMLDivElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  selectionBarRef: React.RefObject<HTMLDivElement | null>;
  selectionPointerClientXRef: React.RefObject<number | null>;
  enabled: boolean;
};

type UseSshSelectionBarResult = {
  selectionAnchor: TerminalSelectionAnchor | null;
  selectionBarPosition: TerminalSelectionBarPosition | null;
  dismissedSelectionText: string | null;
  refreshSelectionAnchor: () => void;
  dismissSelectionBar: () => void;
  clearSelectionOverlay: () => void;
};

/**
 * Computes terminal selection anchor and floating selection bar placement.
 *
 * @param params Hook inputs and ref handles used for geometry calculations.
 * @returns Selection state and interaction handlers for SSH selection toolbar.
 */
export const useSshSelectionBar = (params: UseSshSelectionBarParams): UseSshSelectionBarResult => {
  const { terminalRef, terminalContainerRef, wrapperRef, selectionBarRef, selectionPointerClientXRef, enabled } =
    params;

  const [selectionAnchor, setSelectionAnchor] = React.useState<TerminalSelectionAnchor | null>(null);
  const [selectionBarPosition, setSelectionBarPosition] = React.useState<TerminalSelectionBarPosition | null>(null);
  const [dismissedSelectionText, setDismissedSelectionText] = React.useState<string | null>(null);

  /**
   * Resolves aggregate bounds of current xterm selection blocks.
   *
   * @param containerElement Mounted terminal container element.
   * @returns Unified selection bounds or `null` when selection is unavailable.
   */
  const resolveSelectionBoundsFromDom = React.useCallback(
    (containerElement: HTMLDivElement): TerminalSelectionBounds | null => {
      const selectionLayer = containerElement.querySelector(XTERM_SELECTION_LAYER_SELECTOR);
      if (!selectionLayer) {
        return null;
      }

      const selectionBlocks = selectionLayer.querySelectorAll('div');
      if (selectionBlocks.length === 0) {
        return null;
      }

      let top = Number.POSITIVE_INFINITY;
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      let anchorLeft = Number.POSITIVE_INFINITY;
      let anchorRight = Number.NEGATIVE_INFINITY;

      selectionBlocks.forEach((block) => {
        const rect = block.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return;
        }

        if (rect.top < top - 0.5) {
          top = rect.top;
          anchorLeft = rect.left;
        } else if (Math.abs(rect.top - top) <= 0.5) {
          anchorLeft = Math.min(anchorLeft, rect.left);
        }

        if (rect.bottom > bottom + 0.5) {
          bottom = rect.bottom;
          anchorRight = rect.right;
        } else if (Math.abs(rect.bottom - bottom) <= 0.5) {
          anchorRight = Math.max(anchorRight, rect.right);
        }

        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
      });

      if (
        !Number.isFinite(top) ||
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        !Number.isFinite(bottom) ||
        !Number.isFinite(anchorLeft) ||
        !Number.isFinite(anchorRight)
      ) {
        return null;
      }

      return {
        anchorLeft,
        anchorRight,
        top,
        left,
        right,
        bottom,
      };
    },
    [],
  );

  /**
   * Resolves aggregate bounds of current xterm selection.
   *
   * @param terminal Active terminal instance.
   * @returns Unified selection bounds or `null` when selection is unavailable.
   */
  const resolveSelectionBounds = React.useCallback(
    (terminal: Terminal): TerminalSelectionBounds | null => {
      const containerElement = terminalContainerRef.current;
      if (!containerElement) {
        return null;
      }

      const selectionPosition = terminal.getSelectionPosition();
      if (selectionPosition) {
        const positionBounds = resolveSelectionBoundsFromPosition({
          terminal,
          containerElement,
          selectionPosition,
        });
        if (positionBounds) {
          return positionBounds;
        }
      }

      return resolveSelectionBoundsFromDom(containerElement);
    },
    [resolveSelectionBoundsFromDom, terminalContainerRef],
  );

  /**
   * Refreshes terminal text selection anchor state.
   *
   * @returns Nothing.
   */
  const refreshSelectionAnchor = React.useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      setSelectionAnchor(null);
      return;
    }

    const selectionText = terminal.getSelection();
    const normalizedText = selectionText.trim();
    if (normalizedText.length === 0) {
      setSelectionAnchor(null);
      return;
    }

    const bounds = resolveSelectionBounds(terminal);
    if (!bounds) {
      setSelectionAnchor(null);
      return;
    }

    setSelectionAnchor({
      selectionText,
      ...bounds,
      pointerClientX: selectionPointerClientXRef.current,
    });
  }, [resolveSelectionBounds, selectionPointerClientXRef, terminalRef]);

  React.useLayoutEffect(() => {
    if (!selectionAnchor || !enabled || dismissedSelectionText === selectionAnchor.selectionText) {
      setSelectionBarPosition(null);
      return;
    }

    const wrapperElement = wrapperRef.current;
    const selectionBarElement = selectionBarRef.current;
    if (!wrapperElement) {
      return;
    }

    const terminalBoundsElement = terminalContainerRef.current;

    const wrapperRect = wrapperElement.getBoundingClientRect();
    const placementBoundsRect = terminalBoundsElement?.getBoundingClientRect() ?? wrapperRect;
    const barWidth = selectionBarElement?.offsetWidth ?? 320;
    const barHeight = selectionBarElement?.offsetHeight ?? 42;
    const edgePadding = 8;
    const gap = 8;

    const selectionTop = selectionAnchor.top - wrapperRect.top;
    const selectionBottom = selectionAnchor.bottom - wrapperRect.top;
    const selectionLeft = selectionAnchor.anchorLeft - wrapperRect.left;
    const pointerBasedRight =
      selectionAnchor.pointerClientX !== null &&
      selectionAnchor.pointerClientX >= selectionAnchor.left &&
      selectionAnchor.pointerClientX <= selectionAnchor.right
        ? selectionAnchor.pointerClientX
        : null;
    const selectionRight = (pointerBasedRight ?? selectionAnchor.anchorRight) - wrapperRect.left;
    const boundsTop = placementBoundsRect.top - wrapperRect.top;
    const boundsBottom = placementBoundsRect.bottom - wrapperRect.top;

    const canPlaceAbove = selectionTop - gap - barHeight >= boundsTop + edgePadding;
    const canPlaceBelow = selectionBottom + gap + barHeight <= boundsBottom - edgePadding;
    const horizontalPadding = canPlaceAbove ? edgePadding : 0;
    const minLeftBound = placementBoundsRect.left - wrapperRect.left + horizontalPadding;
    const maxLeftBound = placementBoundsRect.right - wrapperRect.left - horizontalPadding - barWidth;

    if (!canPlaceAbove && !canPlaceBelow) {
      setSelectionBarPosition(null);
      return;
    }

    const unclampedLeft = canPlaceAbove ? selectionLeft : selectionRight - barWidth;
    const maxLeft = Math.max(minLeftBound, maxLeftBound);
    const left = Math.max(minLeftBound, Math.min(unclampedLeft, maxLeft));
    const top = canPlaceAbove ? selectionTop - gap - barHeight : selectionBottom + gap;

    setSelectionBarPosition({
      left,
      top,
    });
  }, [dismissedSelectionText, enabled, selectionAnchor, selectionBarRef, terminalContainerRef, wrapperRef]);

  React.useEffect(() => {
    if (!selectionAnchor) {
      setDismissedSelectionText(null);
      return;
    }

    if (dismissedSelectionText && dismissedSelectionText !== selectionAnchor.selectionText) {
      setDismissedSelectionText(null);
    }
  }, [dismissedSelectionText, selectionAnchor]);

  /**
   * Hides current selection bar until selection text changes.
   *
   * @returns Nothing.
   */
  const dismissSelectionBar = React.useCallback(() => {
    if (!selectionAnchor?.selectionText) {
      return;
    }

    setDismissedSelectionText(selectionAnchor.selectionText);
    setSelectionBarPosition(null);
  }, [selectionAnchor]);

  /**
   * Clears any rendered selection overlay state.
   *
   * @returns Nothing.
   */
  const clearSelectionOverlay = React.useCallback(() => {
    setSelectionAnchor(null);
    setSelectionBarPosition(null);
    setDismissedSelectionText(null);
  }, []);

  return {
    selectionAnchor,
    selectionBarPosition,
    dismissedSelectionText,
    refreshSelectionAnchor,
    dismissSelectionBar,
    clearSelectionOverlay,
  };
};
