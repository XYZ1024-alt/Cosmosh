import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import { EditorSelection, type EditorState, Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ClipboardPaste, Copy, Redo, Scissors, Search, TextSelect, Undo } from 'lucide-react';
import React from 'react';

import { openCodeMirrorSearchReplace } from '../../lib/codemirror-search';
import { t } from '../../lib/i18n';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from './context-menu';
import { readTextFromClipboard, textEditingShortcut, writeTextToClipboard } from './text-editing-context-menu-utils';

type CodeMirrorTextContextMenuSnapshot = {
  canCopy: boolean;
  canEditSelection: boolean;
  canFind: boolean;
  canRedo: boolean;
  canSelectAll: boolean;
  canUndo: boolean;
};

const emptyMenuSnapshot: CodeMirrorTextContextMenuSnapshot = {
  canCopy: false,
  canEditSelection: false,
  canFind: false,
  canRedo: false,
  canSelectAll: false,
  canUndo: false,
};

/**
 * Props for a shared CodeMirror text-editing context menu.
 */
export type CodeMirrorTextContextMenuProps = React.PropsWithChildren<{
  getEditorView: () => EditorView | null;
  readOnly: boolean;
}>;

/**
 * Resolves the active editor capability snapshot for context-menu disabled states.
 *
 * @param view CodeMirror editor view.
 * @param readOnly Whether editing commands should be disabled.
 * @returns Context-menu capability snapshot.
 */
const resolveContextMenuSnapshot = (view: EditorView | null, readOnly: boolean): CodeMirrorTextContextMenuSnapshot => {
  if (!view) {
    return emptyMenuSnapshot;
  }

  const hasSelection = view.state.selection.ranges.some((range) => !range.empty);

  return {
    canCopy: hasSelection,
    canEditSelection: !readOnly && hasSelection,
    canFind: true,
    canRedo: !readOnly && redoDepth(view.state) > 0,
    canSelectAll: view.state.doc.length > 0,
    canUndo: !readOnly && undoDepth(view.state) > 0,
  };
};

/**
 * Returns the selected text across every CodeMirror selection range.
 *
 * @param state CodeMirror editor state.
 * @returns Selected text joined by newlines, or an empty string when collapsed.
 */
const getSelectedEditorText = (state: EditorState): string => {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.doc.sliceString(range.from, range.to))
    .join('\n');
};

/**
 * Deletes selected ranges and collapses each cursor at the deletion point.
 *
 * @param view CodeMirror editor view.
 * @returns Nothing.
 */
const deleteEditorSelection = (view: EditorView): void => {
  const changes = view.state.changeByRange((range) => {
    if (range.empty) {
      return { range };
    }

    return {
      changes: { from: range.from, to: range.to, insert: '' },
      range: EditorSelection.cursor(range.from),
    };
  });

  view.dispatch({
    ...changes,
    annotations: Transaction.userEvent.of('delete.selection'),
    scrollIntoView: true,
  });
  view.focus();
};

/**
 * Inserts text at the current CodeMirror selection.
 *
 * @param view CodeMirror editor view.
 * @param text Text to insert.
 * @returns Nothing.
 */
const insertEditorText = (view: EditorView, text: string): void => {
  view.dispatch({
    ...view.state.replaceSelection(text),
    annotations: Transaction.userEvent.of('input.paste'),
    scrollIntoView: true,
  });
  view.focus();
};

/**
 * Renders the shared Cosmosh text-editing menu for CodeMirror editor surfaces.
 *
 * @param props Editor lookup, readonly state, and the editor host.
 * @returns CodeMirror editor wrapped with a context menu.
 */
export const CodeMirrorTextContextMenu: React.FC<CodeMirrorTextContextMenuProps> = ({
  children,
  getEditorView,
  readOnly,
}) => {
  const readOnlyRef = React.useRef(readOnly);
  const shouldKeepPanelFocusRef = React.useRef(false);

  React.useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  const [menuSnapshot, setMenuSnapshot] = React.useState<CodeMirrorTextContextMenuSnapshot>(emptyMenuSnapshot);

  const refreshMenuSnapshot = React.useCallback((): void => {
    setMenuSnapshot(resolveContextMenuSnapshot(getEditorView(), readOnlyRef.current));
  }, [getEditorView]);

  const runEditorCommand = React.useCallback(
    (command: (view: EditorView) => void): void => {
      const view = getEditorView();
      if (!view) {
        return;
      }

      command(view);
      setMenuSnapshot(resolveContextMenuSnapshot(view, readOnlyRef.current));
    },
    [getEditorView],
  );

  const handleCopy = React.useCallback((): void => {
    runEditorCommand((view) => {
      void writeTextToClipboard(getSelectedEditorText(view.state));
      view.focus();
    });
  }, [runEditorCommand]);

  const handleCut = React.useCallback((): void => {
    if (readOnlyRef.current) {
      return;
    }

    const view = getEditorView();
    if (!view) {
      return;
    }

    void (async () => {
      const copied = await writeTextToClipboard(getSelectedEditorText(view.state));
      if (!copied) {
        view.focus();
        return;
      }

      deleteEditorSelection(view);
      setMenuSnapshot(resolveContextMenuSnapshot(view, readOnlyRef.current));
    })();
  }, [getEditorView]);

  const handlePaste = React.useCallback((): void => {
    if (readOnlyRef.current) {
      return;
    }

    const view = getEditorView();
    if (!view) {
      return;
    }

    void (async () => {
      const clipboardText = await readTextFromClipboard();
      if (clipboardText === null) {
        view.focus();
        return;
      }

      insertEditorText(view, clipboardText);
      setMenuSnapshot(resolveContextMenuSnapshot(view, readOnlyRef.current));
    })();
  }, [getEditorView]);

  const handleFindReplace = React.useCallback((): void => {
    runEditorCommand((view) => {
      shouldKeepPanelFocusRef.current = true;
      openCodeMirrorSearchReplace(view);
    });
  }, [runEditorCommand]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="h-full min-h-0"
          data-input-context-menu-ignore="true"
          onContextMenuCapture={refreshMenuSnapshot}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (shouldKeepPanelFocusRef.current) {
            shouldKeepPanelFocusRef.current = false;
            return;
          }

          getEditorView()?.focus();
        }}
      >
        <ContextMenuItem
          icon={Undo}
          disabled={!menuSnapshot.canUndo}
          onSelect={() => runEditorCommand((view) => undo(view))}
        >
          {t('inputContextMenu.undo')}
          <ContextMenuShortcut>{textEditingShortcut.undo}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          icon={Redo}
          disabled={!menuSnapshot.canRedo}
          onSelect={() => runEditorCommand((view) => redo(view))}
        >
          {t('inputContextMenu.redo')}
          <ContextMenuShortcut>{textEditingShortcut.redo}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={Search}
          disabled={!menuSnapshot.canFind}
          onSelect={handleFindReplace}
        >
          {t('inputContextMenu.findReplace')}
          <ContextMenuShortcut>{textEditingShortcut.find}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={Scissors}
          disabled={!menuSnapshot.canEditSelection}
          onSelect={handleCut}
        >
          {t('inputContextMenu.cut')}
          <ContextMenuShortcut>{textEditingShortcut.cut}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          icon={Copy}
          disabled={!menuSnapshot.canCopy}
          onSelect={handleCopy}
        >
          {t('inputContextMenu.copy')}
          <ContextMenuShortcut>{textEditingShortcut.copy}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          icon={ClipboardPaste}
          disabled={readOnly}
          onSelect={handlePaste}
        >
          {t('inputContextMenu.paste')}
          <ContextMenuShortcut>{textEditingShortcut.paste}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={TextSelect}
          disabled={!menuSnapshot.canSelectAll}
          onSelect={() => runEditorCommand((view) => selectAll(view))}
        >
          {t('inputContextMenu.selectAll')}
          <ContextMenuShortcut>{textEditingShortcut.selectAll}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
