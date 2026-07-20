import type { ApiSftpEntry } from '@cosmosh/api-contract';
import React from 'react';

import type { SftpSelectionModifierEvent } from './sftp-types';
import { resolveRangeSelectionPaths } from './sftp-utils';

/**
 * Inputs for the SFTP directory selection model.
 */
type UseSftpSelectionModelParams = {
  visibleEntries: ApiSftpEntry[];
  clearPreviewState: () => boolean;
  clearPreviewStateForSelection: (nextEntry: ApiSftpEntry | null) => boolean;
};

/**
 * SFTP directory selection state and desktop-style selection helpers.
 */
type UseSftpSelectionModelResult = {
  selectedPaths: string[];
  selectedPathSet: Set<string>;
  selectedEntries: ApiSftpEntry[];
  selectedEntry: ApiSftpEntry | null;
  primarySelectedEntry: ApiSftpEntry | null;
  selectedCount: number;
  hasSelection: boolean;
  hasSingleSelection: boolean;
  selectionAnchorPath: string;
  setSelectedPaths: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectionAnchorPath: React.Dispatch<React.SetStateAction<string>>;
  resetSelection: () => void;
  selectSingleEntry: (entry: ApiSftpEntry | null) => void;
  selectEntryWithModifiers: (
    entry: ApiSftpEntry,
    event: SftpSelectionModifierEvent,
    options?: { rangeAnchorPath?: string },
  ) => void;
  selectEntriesByPaths: (paths: string[], shouldExtendSelection: boolean) => void;
  pruneSelectionToEntries: (nextEntries: ApiSftpEntry[]) => void;
};

/**
 * Owns SFTP directory selection and range/toggle behavior.
 *
 * @param params Visible row set and preview-clear guards.
 * @returns Selection state plus action helpers.
 */
export const useSftpSelectionModel = ({
  visibleEntries,
  clearPreviewState,
  clearPreviewStateForSelection,
}: UseSftpSelectionModelParams): UseSftpSelectionModelResult => {
  const [selectedPaths, setSelectedPaths] = React.useState<string[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = React.useState<string>('');

  const selectedPathSet = React.useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const selectedEntries = React.useMemo(() => {
    return visibleEntries.filter((entry) => selectedPathSet.has(entry.path));
  }, [selectedPathSet, visibleEntries]);

  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const primarySelectedEntry = selectedEntries[0] ?? null;
  const selectedCount = selectedEntries.length;
  const hasSelection = selectedCount > 0;
  const hasSingleSelection = selectedCount === 1;

  React.useEffect(() => {
    const visiblePathSet = new Set(visibleEntries.map((entry) => entry.path));
    setSelectedPaths((previous) => previous.filter((path) => visiblePathSet.has(path)));
    setSelectionAnchorPath((previous) => (previous && visiblePathSet.has(previous) ? previous : ''));
  }, [visibleEntries]);

  const resetSelection = React.useCallback((): void => {
    if (!clearPreviewState()) {
      return;
    }

    setSelectedPaths([]);
    setSelectionAnchorPath('');
  }, [clearPreviewState]);

  const selectSingleEntry = React.useCallback(
    (entry: ApiSftpEntry | null): void => {
      if (!clearPreviewStateForSelection(entry)) {
        return;
      }

      if (!entry) {
        setSelectedPaths([]);
        setSelectionAnchorPath('');
        return;
      }

      setSelectedPaths([entry.path]);
      setSelectionAnchorPath(entry.path);
    },
    [clearPreviewStateForSelection],
  );

  const selectEntryRange = React.useCallback(
    (anchorPath: string, targetPath: string, shouldExtendSelection: boolean): void => {
      const rangePaths = resolveRangeSelectionPaths(visibleEntries, anchorPath, targetPath);
      if (rangePaths.length === 0) {
        return;
      }

      if (!clearPreviewState()) {
        return;
      }

      setSelectedPaths((previous) => {
        const nextPaths = shouldExtendSelection ? [...previous, ...rangePaths] : rangePaths;
        return Array.from(new Set(nextPaths));
      });
    },
    [clearPreviewState, visibleEntries],
  );

  const selectEntryWithModifiers = React.useCallback(
    (entry: ApiSftpEntry, event: SftpSelectionModifierEvent, options: { rangeAnchorPath?: string } = {}): void => {
      const shouldToggle = window.electron?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
      const shouldExtendRange = event.shiftKey;

      if (shouldExtendRange) {
        const anchorPath = options.rangeAnchorPath ?? selectionAnchorPath;
        selectEntryRange(anchorPath, entry.path, shouldToggle);
        if (!selectionAnchorPath) {
          setSelectionAnchorPath(anchorPath || entry.path);
        }
        return;
      }

      if (shouldToggle) {
        if (!clearPreviewState()) {
          return;
        }

        setSelectedPaths((previous) => {
          if (previous.includes(entry.path)) {
            return previous.filter((path) => path !== entry.path);
          }

          return [...previous, entry.path];
        });
        setSelectionAnchorPath(entry.path);
        return;
      }

      selectSingleEntry(entry);
    },
    [clearPreviewState, selectEntryRange, selectSingleEntry, selectionAnchorPath],
  );

  /**
   * Applies a pointer marquee selection while preserving preview safety guards.
   *
   * @param paths Visible entry paths intersecting the marquee rectangle.
   * @param shouldExtendSelection Whether the existing selection should be preserved.
   * @returns void.
   */
  const selectEntriesByPaths = React.useCallback(
    (paths: string[], shouldExtendSelection: boolean): void => {
      if (!clearPreviewState()) {
        return;
      }

      const visiblePathSet = new Set(visibleEntries.map((entry) => entry.path));
      const marqueePaths = paths.filter((path) => visiblePathSet.has(path));
      setSelectedPaths((previous) => {
        const nextPaths = shouldExtendSelection ? [...previous, ...marqueePaths] : marqueePaths;
        return Array.from(new Set(nextPaths));
      });
      setSelectionAnchorPath(marqueePaths.at(-1) ?? '');
    },
    [clearPreviewState, visibleEntries],
  );

  const pruneSelectionToEntries = React.useCallback((nextEntries: ApiSftpEntry[]): void => {
    const validPaths = new Set(nextEntries.map((entry) => entry.path));
    setSelectedPaths((previous) => previous.filter((path) => validPaths.has(path)));
    setSelectionAnchorPath((previous) => (previous && validPaths.has(previous) ? previous : ''));
  }, []);

  return {
    selectedPaths,
    selectedPathSet,
    selectedEntries,
    selectedEntry,
    primarySelectedEntry,
    selectedCount,
    hasSelection,
    hasSingleSelection,
    selectionAnchorPath,
    setSelectedPaths,
    setSelectionAnchorPath,
    resetSelection,
    selectSingleEntry,
    selectEntryWithModifiers,
    selectEntriesByPaths,
    pruneSelectionToEntries,
  };
};
