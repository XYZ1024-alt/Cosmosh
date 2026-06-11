import { loader } from '@monaco-editor/react';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

export { monacoEditor };

type MonacoWorkerEnvironment = {
  getWorker: (_moduleId: string, label: string) => Worker;
};

/**
 * Configures Monaco once for Vite/Electron worker loading.
 *
 * @returns void.
 */
export const configureMonacoEnvironment = (): void => {
  const globalWithEnvironment = globalThis as typeof globalThis & {
    MonacoEnvironment?: MonacoWorkerEnvironment;
  };

  if (!globalWithEnvironment.MonacoEnvironment) {
    globalWithEnvironment.MonacoEnvironment = {
      getWorker: (_moduleId: string, label: string): Worker => {
        if (label === 'json') {
          return new JsonWorker();
        }

        if (label === 'css' || label === 'scss' || label === 'less') {
          return new CssWorker();
        }

        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return new HtmlWorker();
        }

        if (label === 'typescript' || label === 'javascript') {
          return new TypeScriptWorker();
        }

        return new EditorWorker();
      },
    };
  }

  loader.config({
    monaco: monacoEditor,
  });
};
