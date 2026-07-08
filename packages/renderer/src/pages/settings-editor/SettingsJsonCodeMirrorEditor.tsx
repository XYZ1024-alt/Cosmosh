import { Compartment, EditorSelection, EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import React from 'react';

import { CodeMirrorTextContextMenu } from '../../components/ui/codemirror-text-context-menu';
import { createCodeMirrorSearchReplaceExtension } from '../../lib/codemirror-search';
import { createSettingsJsonLanguageExtensions, type JsonSchemaDocument } from './settingsJsonLanguage';

const editorEditableCompartment = new Compartment();
const editorReadOnlyCompartment = new Compartment();
const editorSchemaCompartment = new Compartment();

/**
 * Small imperative API exposed by the settings JSON CodeMirror editor.
 */
export type SettingsJsonCodeMirrorEditorHandle = {
  /**
   * Focuses the editor.
   *
   * @returns Nothing.
   */
  focus: () => void;
  /**
   * Selects and reveals one setting key.
   *
   * @param settingKey Settings registry key to reveal.
   * @returns Whether the setting key was found and revealed.
   */
  revealSettingKey: (settingKey: string) => boolean;
};

/**
 * Props for the settings JSON CodeMirror editor.
 */
export type SettingsJsonCodeMirrorEditorProps = {
  fontFamily: string;
  onChange: (content: string) => void;
  onMount: (editorHandle: SettingsJsonCodeMirrorEditorHandle) => void;
  onSave: () => Promise<void> | void;
  readOnly: boolean;
  schema: JsonSchemaDocument;
  value: string;
};

/**
 * Builds the dark workbench theme for the full settings JSON editor.
 *
 * @returns CodeMirror theme extension.
 */
const createSettingsEditorTheme = (): Extension =>
  EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: 'var(--color-text)',
        fontSize: '13px',
        height: '100%',
        lineHeight: '20px',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--color-command-item-active) 32%, transparent)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--color-text)',
      },
      '.cm-content': {
        caretColor: 'var(--color-text)',
        minHeight: '100%',
        padding: '10px 0',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-text)',
      },
      '.cm-diagnostic': {
        maxWidth: '420px',
      },
      '.cm-diagnosticText': {
        color: 'var(--color-text)',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        borderRightColor: 'var(--color-home-divider)',
        color: 'var(--color-home-text-subtle)',
      },
      '.cm-gutterElement': {
        padding: '0 10px 0 8px',
      },
      '.cm-line': {
        padding: '0 12px',
      },
      '.cm-line ::selection': {
        backgroundColor: 'var(--color-menu-selection-bar-border)',
      },
      '.cm-lintRange-error': {
        backgroundImage:
          'linear-gradient(135deg, transparent 66%, var(--color-form-message-error) 66%), linear-gradient(45deg, transparent 66%, var(--color-form-message-error) 66%)',
      },
      '.cm-scroller': {
        fontFamily: 'var(--cosmosh-settings-editor-font-family)',
        overflow: 'auto',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--color-menu-selection-bar-border)',
      },
      '.cm-matchingBracket, .cm-nonmatchingBracket': {
        backgroundColor: 'var(--color-menu-selection-bar-border)',
        outline: '1px solid var(--color-home-divider)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--color-menu-control)',
        borderColor: 'var(--color-menu-divider)',
        color: 'var(--color-text)',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--color-bg-subtle)',
        border: '0',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 8px 30px var(--shadow-soft)',
        color: 'var(--color-header-text)',
        overflow: 'hidden',
      },
      '.cm-tooltip:not(.cm-tooltip-autocomplete):not(.cm-completionInfo)': {
        backdropFilter: 'blur(4px)',
        padding: '4px 8px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete': {
        backdropFilter: 'blur(4px)',
        backgroundColor: 'var(--color-bg-subtle)',
        border: '0',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 30px var(--shadow-menu-content)',
        boxSizing: 'border-box',
        color: 'var(--color-header-text)',
        fontFamily: 'var(--font-sans)',
        maxWidth: 'min(420px, calc(100vw - 16px))',
        minWidth: '180px',
        padding: '4px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
        height: 'auto',
        listStyle: 'none',
        margin: '0',
        maxHeight: 'min(320px, calc(100vh - 16px))',
        maxWidth: 'none',
        minWidth: '0',
        overflowX: 'hidden',
        overflowY: 'auto',
        padding: '0',
        whiteSpace: 'nowrap',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        alignItems: 'center',
        borderRadius: 'var(--radius-md)',
        boxSizing: 'border-box',
        color: 'var(--color-header-text)',
        cursor: 'default',
        display: 'flex',
        fontFamily: 'var(--font-sans)',
        fontSize: '14px',
        gap: '10px',
        lineHeight: '20px',
        margin: '0',
        minHeight: '32px',
        overflow: 'hidden',
        padding: '6px 10px',
        textOverflow: 'ellipsis',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': {
        borderBottom: '0',
        color: 'var(--color-header-text-muted)',
        display: 'list-item',
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        lineHeight: '18px',
        opacity: '1',
        padding: '6px 10px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li:hover': {
        background: 'var(--color-menu-control-hover)',
        color: 'var(--color-header-text)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        background: 'var(--color-menu-control-hover)',
        color: 'var(--color-header-text)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]': {
        background: 'var(--color-menu-control-hover)',
        color: 'var(--color-header-text)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete .cm-completionIcon': {
        display: 'none',
      },
      '.cm-tooltip.cm-tooltip-autocomplete .cm-completionLabel': {
        flex: '1 1 auto',
        minWidth: '0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      '.cm-tooltip.cm-tooltip-autocomplete .cm-completionDetail': {
        color: 'var(--color-header-text-muted)',
        flex: '0 1 auto',
        fontSize: '12px',
        fontStyle: 'normal',
        lineHeight: '18px',
        marginLeft: 'auto',
        maxWidth: '160px',
        minWidth: '0',
        overflow: 'hidden',
        textAlign: 'right',
        textOverflow: 'ellipsis',
      },
      '.cm-tooltip.cm-tooltip-autocomplete .cm-completionMatchedText': {
        color: 'var(--color-header-text)',
        fontWeight: '600',
        textDecoration: 'none',
      },
      '.cm-tooltip.cm-completionInfo': {
        backdropFilter: 'blur(4px)',
        backgroundColor: 'var(--color-bg-subtle)',
        border: '0',
        borderRadius: 'var(--radius-md)',
        boxSizing: 'border-box',
        boxShadow: '0 8px 30px var(--shadow-soft)',
        color: 'var(--color-header-text)',
        padding: '4px 8px',
        whiteSpace: 'normal',
      },
      '.cosmosh-settings-json-tooltip': {
        maxWidth: '360px',
      },
      '.cosmosh-settings-json-tooltip-title': {
        color: 'var(--color-header-text)',
        fontSize: '12px',
        fontWeight: '600',
        lineHeight: '18px',
      },
      '.cosmosh-settings-json-tooltip-description': {
        color: 'var(--color-header-text-muted)',
        fontSize: '12px',
        lineHeight: '18px',
        marginTop: '4px',
        whiteSpace: 'pre-wrap',
      },
      '.cosmosh-settings-json-tooltip-details': {
        borderTop: '1px solid var(--color-menu-divider)',
        display: 'grid',
        gap: '2px',
        marginTop: '6px',
        paddingTop: '6px',
      },
      '.cosmosh-settings-json-tooltip-detail-row': {
        alignItems: 'baseline',
        display: 'grid',
        gap: '12px',
        gridTemplateColumns: 'max-content minmax(0, 1fr)',
      },
      '.cosmosh-settings-json-tooltip-detail-label': {
        color: 'var(--color-header-text-muted)',
        fontSize: '11px',
        lineHeight: '16px',
      },
      '.cosmosh-settings-json-tooltip-detail-value': {
        color: 'var(--color-header-text)',
        fontFamily: 'var(--cosmosh-settings-editor-font-family)',
        fontSize: '11px',
        lineHeight: '16px',
        margin: '0',
        minWidth: '0',
        overflowWrap: 'anywhere',
      },
      '.cm-button': {
        backgroundColor: 'var(--color-form-control)',
        backgroundImage: 'none',
        borderColor: 'var(--color-home-divider)',
        color: 'var(--color-form-text)',
      },
      '.cm-textfield': {
        backgroundColor: 'var(--color-form-control)',
        borderColor: 'var(--color-home-divider)',
        color: 'var(--color-form-text)',
      },
    },
    { dark: true },
  );

/**
 * Selects and centers one property key in the editor.
 *
 * @param view CodeMirror editor view.
 * @param settingKey Settings key to reveal.
 * @returns Whether the setting key was found and revealed.
 */
const revealSettingKeyInView = (view: EditorView, settingKey: string): boolean => {
  const keyToken = `"${settingKey}"`;
  const offset = view.state.doc.toString().indexOf(keyToken);
  if (offset < 0) {
    return false;
  }

  const from = offset + 1;
  const to = from + settingKey.length;
  view.dispatch({
    selection: EditorSelection.single(from, to),
    effects: EditorView.scrollIntoView(from, {
      y: 'center',
    }),
  });
  view.focus();
  return true;
};

/**
 * Creates the extension set for one settings JSON editor instance.
 *
 * @param options Editor callbacks and schema.
 * @returns CodeMirror extension list.
 */
const createEditorExtensions = (options: {
  onChange: (content: string) => void;
  onSave: () => void;
  readOnly: boolean;
  schema: JsonSchemaDocument;
}): Extension[] => [
  basicSetup,
  Prec.highest(
    keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          options.onSave();
          return true;
        },
      },
    ]),
  ),
  EditorView.lineWrapping,
  EditorState.tabSize.of(2),
  editorReadOnlyCompartment.of(EditorState.readOnly.of(options.readOnly)),
  editorEditableCompartment.of(EditorView.editable.of(!options.readOnly)),
  editorSchemaCompartment.of(createSettingsJsonLanguageExtensions(options.schema)),
  createSettingsEditorTheme(),
  createCodeMirrorSearchReplaceExtension(),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      options.onChange(update.state.doc.toString());
    }
  }),
];

/**
 * Renders the Settings Editor CodeMirror instance.
 *
 * @param props Editor value, schema, and callbacks.
 * @returns CodeMirror editor host.
 */
export const SettingsJsonCodeMirrorEditor: React.FC<SettingsJsonCodeMirrorEditorProps> = ({
  fontFamily,
  onChange,
  onMount,
  onSave,
  readOnly,
  schema,
  value,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const onChangeRef = React.useRef(onChange);
  const onMountRef = React.useRef(onMount);
  const onSaveRef = React.useRef(onSave);
  const readOnlyRef = React.useRef(readOnly);
  const schemaRef = React.useRef(schema);
  const valueRef = React.useRef(value);

  React.useEffect(() => {
    onChangeRef.current = onChange;
    onMountRef.current = onMount;
    onSaveRef.current = onSave;
    readOnlyRef.current = readOnly;
    schemaRef.current = schema;
    valueRef.current = value;
  }, [onChange, onMount, onSave, readOnly, schema, value]);

  React.useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const view = new EditorView({
      doc: valueRef.current,
      extensions: createEditorExtensions({
        onChange: (content) => onChangeRef.current(content),
        onSave: () => {
          void onSaveRef.current();
        },
        readOnly: readOnlyRef.current,
        schema: schemaRef.current,
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    onMountRef.current({
      focus: () => view.focus(),
      revealSettingKey: (settingKey) => revealSettingKeyInView(view, settingKey),
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: [
        editorReadOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
        editorEditableCompartment.reconfigure(EditorView.editable.of(!readOnly)),
      ],
    });
  }, [readOnly]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: editorSchemaCompartment.reconfigure(createSettingsJsonLanguageExtensions(schema)),
    });
  }, [schema]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        insert: value,
        to: currentValue.length,
      },
    });
  }, [value]);

  const getEditorView = React.useCallback((): EditorView | null => viewRef.current, []);

  return (
    <CodeMirrorTextContextMenu
      getEditorView={getEditorView}
      readOnly={readOnly}
    >
      <div
        ref={containerRef}
        className="h-full min-h-0"
        style={{ '--cosmosh-settings-editor-font-family': fontFamily } as React.CSSProperties}
      />
    </CodeMirrorTextContextMenu>
  );
};

export default SettingsJsonCodeMirrorEditor;
