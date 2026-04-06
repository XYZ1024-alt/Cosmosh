import type {
  ApiErrorResponse,
  ApiLocalTerminalCreateSessionRequest,
  ApiLocalTerminalCreateSessionResponse,
  ApiLocalTerminalListProfilesResponse,
  ApiSettingsGetResponse,
  ApiSettingsUpdateRequest,
  ApiSettingsUpdateResponse,
  ApiSshCreateFolderRequest,
  ApiSshCreateFolderResponse,
  ApiSshCreateKeychainRequest,
  ApiSshCreateKeychainResponse,
  ApiSshCreateServerRequest,
  ApiSshCreateServerResponse,
  ApiSshCreateSessionHostVerificationRequiredResponse,
  ApiSshCreateSessionRequest,
  ApiSshCreateSessionResponse,
  ApiSshCreateTagRequest,
  ApiSshCreateTagResponse,
  ApiSshGetKeychainCredentialsResponse,
  ApiSshGetServerCredentialsResponse,
  ApiSshListFoldersResponse,
  ApiSshListKeychainsResponse,
  ApiSshListServersResponse,
  ApiSshListTagsResponse,
  ApiSshTrustFingerprintRequest,
  ApiSshTrustFingerprintResponse,
  ApiSshUpdateFolderRequest,
  ApiSshUpdateFolderResponse,
  ApiSshUpdateKeychainRequest,
  ApiSshUpdateKeychainResponse,
  ApiSshUpdateServerRequest,
  ApiSshUpdateServerResponse,
  ApiTestPingResponse,
} from '@cosmosh/api-contract';
import { contextBridge, ipcRenderer } from 'electron';

type AppMenuAction =
  | 'open-about'
  | 'open-settings'
  | 'new-tab'
  | 'close-current-tab'
  | 'close-right-tabs'
  | 'show-tab-switcher';

const APP_MENU_ACTIONS: ReadonlySet<AppMenuAction> = new Set<AppMenuAction>([
  'open-about',
  'open-settings',
  'new-tab',
  'close-current-tab',
  'close-right-tabs',
  'show-tab-switcher',
]);

/**
 * Typed IPC invoke helper used by all bridge methods.
 * Centralizing this adapter keeps renderer-call transport swappable in future browser builds.
 *
 * @param channel IPC channel name.
 * @param args Optional IPC payload args.
 * @returns Promise resolving to typed response payload.
 */
const invokeIpc = <TResponse>(channel: string, ...args: unknown[]): Promise<TResponse> => {
  return ipcRenderer.invoke(channel, ...args) as Promise<TResponse>;
};

/**
 * Fire-and-forget IPC send helper.
 *
 * @param channel IPC channel name.
 * @param args Optional IPC payload args.
 * @returns void.
 */
const sendIpc = (channel: string, ...args: unknown[]): void => {
  ipcRenderer.send(channel, ...args);
};

/**
 * Subscribes to string payload events and returns an unsubscribe callback.
 *
 * @param channel IPC channel name.
 * @param listener Callback invoked only for valid string payloads.
 * @returns Unsubscribe callback.
 */
const onIpcStringPayload = (channel: string, listener: (payload: string) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    if (typeof payload !== 'string') {
      return;
    }

    listener(payload);
  };

  ipcRenderer.on(channel, handler);

  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

/**
 * Subscribes to validated application menu action events.
 *
 * @param listener Callback invoked for known app menu actions only.
 * @returns Unsubscribe callback.
 */
const onIpcAppMenuActionPayload = (listener: (action: AppMenuAction) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, action: unknown) => {
    if (typeof action !== 'string' || !APP_MENU_ACTIONS.has(action as AppMenuAction)) {
      return;
    }

    listener(action as AppMenuAction);
  };

  ipcRenderer.on('app:menu-action', handler);

  return () => {
    ipcRenderer.removeListener('app:menu-action', handler);
  };
};

/**
 * Exposes a minimal, allow-listed bridge API to renderer.
 * Security boundary: renderer never gets direct access to raw `ipcRenderer`.
 */
contextBridge.exposeInMainWorld('electron', {
  // ---------------------------------------------------------------------------
  // App window and locale controls
  // ---------------------------------------------------------------------------
  closeWindow: () => {
    sendIpc('app:close-window');
  },
  getLocale: () => {
    return invokeIpc<string>('i18n:get-locale');
  },
  setLocale: (locale: string) => {
    return invokeIpc<string>('i18n:set-locale', locale);
  },
  getRuntimeUserName: () => {
    return invokeIpc<string>('app:get-runtime-user-name');
  },
  getAppVersionInfo: () => {
    return invokeIpc<{
      appName: string;
      version: string;
      buildVersion: string;
      buildTime: string;
      commit: string;
      electron: string;
      chromium: string;
      node: string;
      v8: string;
      os: string;
    }>('app:get-version-info');
  },
  getPendingLaunchWorkingDirectory: () => {
    return invokeIpc<string | null>('app:get-pending-launch-working-directory');
  },
  getDatabaseSecurityInfo: () => {
    return invokeIpc<{
      runtimeMode: 'development' | 'production';
      resolverMode: 'development-fixed-key' | 'safe-storage' | 'master-password-fallback';
      safeStorageAvailable: boolean;
      databasePath: string;
      securityConfigPath: string;
      hasEncryptedDbMasterKey: boolean;
      hasMasterPasswordHash: boolean;
      hasMasterPasswordSalt: boolean;
      hasMasterPasswordEnv: boolean;
      fallbackReady: boolean;
    }>('app:get-database-security-info');
  },
  /**
   * Subscribes to launch cwd events emitted when a second instance forwards context.
   */
  onLaunchWorkingDirectory: (listener: (cwd: string) => void) => {
    return onIpcStringPayload('app:launch-working-directory', listener);
  },
  onAppMenuAction: (listener: (action: AppMenuAction) => void) => {
    return onIpcAppMenuActionPayload(listener);
  },
  openDevTools: () => {
    return invokeIpc<boolean>('app:open-devtools');
  },
  toggleDevTools: () => {
    return invokeIpc<boolean>('app:toggle-devtools');
  },
  reloadWebView: () => {
    return invokeIpc<boolean>('app:reload-webview');
  },
  restartBackendRuntime: () => {
    return invokeIpc<boolean>('app:restart-backend-runtime');
  },
  showInFileManager: (targetPath?: string) => {
    return invokeIpc<boolean>('app:show-in-file-manager', targetPath);
  },
  openExternalUrl: (targetUrl: string) => {
    return invokeIpc<boolean>('app:open-external-url', targetUrl);
  },
  setWindowsSystemMenuSymbolColor: (symbolColor: string) => {
    return invokeIpc<boolean>('app:set-windows-system-menu-symbol-color', symbolColor);
  },
  importPrivateKeyFromFile: () => {
    return invokeIpc<{ canceled: boolean; content?: string }>('app:import-private-key');
  },
  getProcessPerformanceStats: () => {
    return invokeIpc<{
      sampledAt: number;
      cpuPercent: number | null;
      mainProcessMemory: {
        rssBytes: number;
        heapTotalBytes: number;
        heapUsedBytes: number;
        externalBytes: number;
        arrayBuffersBytes: number;
      };
      rendererProcessMemory: {
        residentSetBytes: number;
        privateBytes: number;
        sharedBytes: number;
      } | null;
      backendProcess: {
        pid: number;
        cpuPercent: number | null;
        memoryRssBytes: number | null;
      } | null;
    }>('app:get-process-performance-stats');
  },
  exportMainHeapSnapshot: () => {
    return invokeIpc<{ ok: boolean; filePath?: string; message?: string }>('app:export-main-heap-snapshot');
  },

  // ---------------------------------------------------------------------------
  // Backend settings and SSH channels
  // ---------------------------------------------------------------------------
  backendTestPing: () => {
    return invokeIpc<ApiTestPingResponse | ApiErrorResponse>('backend:test-ping');
  },
  backendSettingsGet: () => {
    return invokeIpc<ApiSettingsGetResponse | ApiErrorResponse>('backend:settings-get');
  },
  backendSettingsUpdate: (payload: ApiSettingsUpdateRequest) => {
    return invokeIpc<ApiSettingsUpdateResponse | ApiErrorResponse>('backend:settings-update', payload);
  },
  backendSshListServers: () => {
    return invokeIpc<ApiSshListServersResponse | ApiErrorResponse>('backend:ssh-list-servers');
  },
  backendSshCreateServer: (payload: ApiSshCreateServerRequest) => {
    return invokeIpc<ApiSshCreateServerResponse | ApiErrorResponse>('backend:ssh-create-server', payload);
  },
  backendSshUpdateServer: (serverId: string, payload: ApiSshUpdateServerRequest) => {
    return invokeIpc<ApiSshUpdateServerResponse | ApiErrorResponse>('backend:ssh-update-server', serverId, payload);
  },
  backendSshGetServerCredentials: (serverId: string) => {
    return invokeIpc<ApiSshGetServerCredentialsResponse | ApiErrorResponse>(
      'backend:ssh-get-server-credentials',
      serverId,
    );
  },
  backendSshListFolders: () => {
    return invokeIpc<ApiSshListFoldersResponse | ApiErrorResponse>('backend:ssh-list-folders');
  },
  backendSshCreateFolder: (payload: ApiSshCreateFolderRequest) => {
    return invokeIpc<ApiSshCreateFolderResponse | ApiErrorResponse>('backend:ssh-create-folder', payload);
  },
  backendSshUpdateFolder: (folderId: string, payload: ApiSshUpdateFolderRequest) => {
    return invokeIpc<ApiSshUpdateFolderResponse | ApiErrorResponse>('backend:ssh-update-folder', folderId, payload);
  },
  backendSshListTags: () => {
    return invokeIpc<ApiSshListTagsResponse | ApiErrorResponse>('backend:ssh-list-tags');
  },
  backendSshCreateTag: (payload: ApiSshCreateTagRequest) => {
    return invokeIpc<ApiSshCreateTagResponse | ApiErrorResponse>('backend:ssh-create-tag', payload);
  },
  backendSshListKeychains: () => {
    return invokeIpc<ApiSshListKeychainsResponse | ApiErrorResponse>('backend:ssh-list-keychains');
  },
  backendSshCreateKeychain: (payload: ApiSshCreateKeychainRequest) => {
    return invokeIpc<ApiSshCreateKeychainResponse | ApiErrorResponse>('backend:ssh-create-keychain', payload);
  },
  backendSshUpdateKeychain: (keychainId: string, payload: ApiSshUpdateKeychainRequest) => {
    return invokeIpc<ApiSshUpdateKeychainResponse | ApiErrorResponse>(
      'backend:ssh-update-keychain',
      keychainId,
      payload,
    );
  },
  backendSshGetKeychainCredentials: (keychainId: string) => {
    return invokeIpc<ApiSshGetKeychainCredentialsResponse | ApiErrorResponse>(
      'backend:ssh-get-keychain-credentials',
      keychainId,
    );
  },
  backendSshCreateSession: (payload: ApiSshCreateSessionRequest) => {
    return invokeIpc<
      ApiSshCreateSessionResponse | ApiSshCreateSessionHostVerificationRequiredResponse | ApiErrorResponse
    >('backend:ssh-create-session', payload);
  },
  backendSshTrustFingerprint: (payload: ApiSshTrustFingerprintRequest) => {
    return invokeIpc<ApiSshTrustFingerprintResponse | ApiErrorResponse>('backend:ssh-trust-fingerprint', payload);
  },
  backendSshCloseSession: (sessionId: string) => {
    return invokeIpc<{ success: boolean }>('backend:ssh-close-session', sessionId);
  },
  backendSshDeleteServer: (serverId: string) => {
    return invokeIpc<{ success: boolean }>('backend:ssh-delete-server', serverId);
  },
  backendSshDeleteFolder: (folderId: string) => {
    return invokeIpc<{ success: boolean }>('backend:ssh-delete-folder', folderId);
  },
  backendSshDeleteKeychain: (keychainId: string) => {
    return invokeIpc<{ success: boolean }>('backend:ssh-delete-keychain', keychainId);
  },

  // ---------------------------------------------------------------------------
  // Local terminal channels
  // ---------------------------------------------------------------------------
  // Local terminal IPC proxy group.
  backendLocalTerminalListProfiles: () => {
    return invokeIpc<ApiLocalTerminalListProfilesResponse | ApiErrorResponse>('backend:local-terminal-list-profiles');
  },
  backendLocalTerminalCreateSession: (payload: ApiLocalTerminalCreateSessionRequest) => {
    return invokeIpc<ApiLocalTerminalCreateSessionResponse | ApiErrorResponse>(
      'backend:local-terminal-create-session',
      payload,
    );
  },
  backendLocalTerminalCloseSession: (sessionId: string) => {
    return invokeIpc<{ success: boolean }>('backend:local-terminal-close-session', sessionId);
  },
  platform: process.platform,
});
