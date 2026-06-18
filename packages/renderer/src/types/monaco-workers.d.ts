declare module 'monaco-editor/esm/vs/language/css/css.worker?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module 'monaco-editor/esm/vs/language/html/html.worker?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js';

declare module 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js';

declare module 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';

declare module 'monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js';

declare module 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js';

declare module 'monaco-editor/esm/vs/language/json/monaco.contribution' {
  import type { json } from 'monaco-editor/esm/vs/editor/editor.main.js';

  export const jsonDefaults: typeof json.jsonDefaults;
}
