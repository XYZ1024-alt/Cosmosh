import type { BackendRequestTrace } from '@cosmosh/api-contract';
import { ipcMain } from 'electron';

import type { BackendRequestTraceStore } from './backend-request-trace-store';

/** Runtime dependencies required by debug IPC registration. */
export type RegisterDebugIpcHandlersOptions = {
  /** Development-only trace store used by the DevTools mirror panel. */
  backendRequestTraceStore: BackendRequestTraceStore;
};

/**
 * Registers development diagnostics IPC channels.
 *
 * @param options Debug runtime dependencies.
 * @returns void.
 */
export const registerDebugIpcHandlers = (options: RegisterDebugIpcHandlersOptions): void => {
  ipcMain.handle('debug:backend-request-trace-list', (event): BackendRequestTrace[] => {
    options.backendRequestTraceStore.subscribe(event.sender);
    return options.backendRequestTraceStore.list();
  });

  ipcMain.handle('debug:backend-request-trace-clear', (): boolean => {
    options.backendRequestTraceStore.clear();
    return true;
  });
};
