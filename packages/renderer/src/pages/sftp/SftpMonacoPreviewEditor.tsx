import MonacoEditor from '@monaco-editor/react';
import type { editor as MonacoEditorTypes } from 'monaco-editor';
import React from 'react';

import { configureMonacoEnvironment } from '../../lib/monaco';

configureMonacoEnvironment();

/**
 * Props for the lazily loaded SFTP Monaco preview editor.
 */
export type SftpMonacoPreviewEditorProps = {
  language: string;
  readOnly: boolean;
  value: string;
  onChange: (content: string) => void;
  onMount: (editorInstance: MonacoEditorTypes.IStandaloneCodeEditor) => void;
};

/**
 * Renders the editable Monaco instance for SFTP text previews.
 *
 * @param props Monaco value, language, and editor callbacks.
 * @returns Monaco preview editor.
 */
export const SftpMonacoPreviewEditor: React.FC<SftpMonacoPreviewEditorProps> = ({
  language,
  onChange,
  onMount,
  readOnly,
  value,
}) => {
  return (
    <MonacoEditor
      language={language}
      theme="vs-dark"
      value={value}
      options={{
        automaticLayout: true,
        contextmenu: true,
        fontSize: 12,
        lineHeight: 18,
        minimap: { enabled: false },
        readOnly,
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: 'on',
      }}
      onChange={(nextValue) => onChange(nextValue ?? '')}
      onMount={(editorInstance) => onMount(editorInstance)}
    />
  );
};

export default SftpMonacoPreviewEditor;
