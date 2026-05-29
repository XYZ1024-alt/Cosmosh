import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { InputContextMenuProvider } from './components/ui/input-context-menu';
import { SelectionContextMenuProvider } from './components/ui/selection-context-menu';
import { initializeLocale } from './lib/i18n';
import { initializeSettingsStore } from './lib/settings-store';
import { isSftpEntryPropertiesWindow } from './pages/sftp/sftp-entry-properties-window';
import SftpEntryPropertiesPage from './pages/sftp/SftpEntryPropertiesPage';

const shouldUseStrictMode = !import.meta.env.DEV || import.meta.env.VITE_ENABLE_STRICT_MODE === 'true';

document.documentElement.dataset.theme = 'dark';

/**
 * Bootstraps locale/settings state before first render using fast local cache.
 *
 * @returns Nothing.
 */
const bootstrap = async (): Promise<void> => {
  await initializeLocale();

  const shouldRenderSftpPropertiesWindow = isSftpEntryPropertiesWindow();
  if (!shouldRenderSftpPropertiesWindow) {
    await initializeSettingsStore();
  }

  const appNode = shouldRenderSftpPropertiesWindow ? <SftpEntryPropertiesPage /> : <App />;
  const rootNode = (
    <InputContextMenuProvider>
      <SelectionContextMenuProvider>{appNode}</SelectionContextMenuProvider>
    </InputContextMenuProvider>
  );

  ReactDOM.createRoot(document.getElementById('root')!).render(
    shouldUseStrictMode ? <React.StrictMode>{rootNode}</React.StrictMode> : rootNode,
  );
};

void bootstrap();
