import type {
  ApiAuditEventDetailResponse,
  ApiAuditEventListQuery,
  ApiAuditEventListResponse,
  ApiErrorResponse,
  ApiLocalTerminalCreateSessionRequest,
  ApiLocalTerminalCreateSessionResponse,
  ApiLocalTerminalListProfilesResponse,
  ApiPortForwardCreateRuleRequest,
  ApiPortForwardCreateRuleResponse,
  ApiPortForwardListRulesResponse,
  ApiPortForwardStartRuleResponse,
  ApiPortForwardStopRuleResponse,
  ApiPortForwardUpdateRuleRequest,
  ApiPortForwardUpdateRuleResponse,
  ApiSettingsGetResponse,
  ApiSettingsUpdateRequest,
  ApiSettingsUpdateResponse,
  ApiSftpBatchOperationRequest,
  ApiSftpBatchOperationResponse,
  ApiSftpCopyRequest,
  ApiSftpCopyResponse,
  ApiSftpCreateDirectoryRequest,
  ApiSftpCreateDirectoryResponse,
  ApiSftpCreateFileRequest,
  ApiSftpCreateFileResponse,
  ApiSftpCreateSessionHostVerificationRequiredResponse,
  ApiSftpCreateSessionRequest,
  ApiSftpCreateSessionResponse,
  ApiSftpDeleteRequest,
  ApiSftpDeleteResponse,
  ApiSftpDownloadFileRequest,
  ApiSftpDownloadFileResponse,
  ApiSftpEntryDetailsRequest,
  ApiSftpEntryDetailsResponse,
  ApiSftpListDirectoryQuery,
  ApiSftpListDirectoryResponse,
  ApiSftpReadFileQuery,
  ApiSftpReadFileResponse,
  ApiSftpRenameRequest,
  ApiSftpRenameResponse,
  ApiSftpUploadFileRequest,
  ApiSftpUploadFileResponse,
  ApiSftpWriteFileRequest,
  ApiSftpWriteFileResponse,
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
  AppMenuAction,
  SftpOpenWithApplication,
  SftpTemporaryFileWatchChange,
} from '@cosmosh/api-contract';
import { contextBridge, ipcRenderer } from 'electron';

const PRELOAD_APP_MENU_ACTIONS: ReadonlySet<AppMenuAction> = new Set([
  'open-about',
  'open-settings',
  'new-tab',
  'close-current-tab',
  'close-right-tabs',
  'show-tab-switcher',
]);

/**
 * Checks whether an app-menu IPC payload is safe to forward into the renderer.
 *
 * @param value Unknown IPC payload.
 * @returns Whether the payload is a supported app menu action.
 */
const isAppMenuAction = (value: unknown): value is AppMenuAction => {
  return typeof value === 'string' && PRELOAD_APP_MENU_ACTIONS.has(value as AppMenuAction);
};

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
    if (!isAppMenuAction(action)) {
      return;
    }

    listener(action);
  };

  ipcRenderer.on('app:menu-action', handler);

  return () => {
    ipcRenderer.removeListener('app:menu-action', handler);
  };
};

/**
 * Checks whether an IPC payload is an SFTP temp-file change event.
 *
 * @param value Unknown IPC payload.
 * @returns Whether the payload matches the watched temp-file change shape.
 */
const isSftpTemporaryFileWatchChange = (value: unknown): value is SftpTemporaryFileWatchChange => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.watchId === 'string' &&
    typeof payload.localPath === 'string' &&
    typeof payload.size === 'number' &&
    typeof payload.modifiedAt === 'string'
  );
};

/**
 * Subscribes to validated SFTP temp-file change events.
 *
 * @param listener Callback invoked for changed temp files.
 * @returns Unsubscribe callback.
 */
const onSftpTemporaryFileChanged = (listener: (change: SftpTemporaryFileWatchChange) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    if (!isSftpTemporaryFileWatchChange(payload)) {
      return;
    }

    listener(payload);
  };

  ipcRenderer.on('app:sftp-temporary-file-changed', handler);

  return () => {
    ipcRenderer.removeListener('app:sftp-temporary-file-changed', handler);
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
  getDownloadsPath: () => {
    return invokeIpc<string>('app:get-downloads-path');
  },
  createSftpTemporaryFile: (fileName: string) => {
    return invokeIpc<string>('app:create-sftp-temporary-file', fileName);
  },
  openSftpTemporaryFile: (localPath: string) => {
    return invokeIpc<boolean>('app:open-sftp-temporary-file', localPath);
  },
  readSftpTemporaryImagePreview: (localPath: string) => {
    return invokeIpc<string>('app:read-sftp-temporary-image-preview', localPath);
  },
  startSftpTemporaryFileWatch: (localPath: string) => {
    return invokeIpc<string>('app:start-sftp-temporary-file-watch', localPath);
  },
  stopSftpTemporaryFileWatch: (watchId: string) => {
    return invokeIpc<boolean>('app:stop-sftp-temporary-file-watch', watchId);
  },
  onSftpTemporaryFileChanged: (listener: (change: SftpTemporaryFileWatchChange) => void) => {
    return onSftpTemporaryFileChanged(listener);
  },
  showSftpOpenWithDialog: (localPath: string) => {
    return invokeIpc<boolean>('app:show-sftp-open-with-dialog', localPath);
  },
  listSftpOpenWithApplications: (localPath: string) => {
    return invokeIpc<SftpOpenWithApplication[]>('app:list-sftp-open-with-applications', localPath);
  },
  openSftpFileWithApplication: (localPath: string, applicationPath: string) => {
    return invokeIpc<boolean>('app:open-sftp-file-with-application', localPath, applicationPath);
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
  showSaveFileDialog: (defaultPath?: string) => {
    return invokeIpc<{ canceled: boolean; filePath?: string }>('app:show-save-file-dialog', defaultPath);
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
  backendAuditListEvents: (query?: ApiAuditEventListQuery) => {
    return invokeIpc<ApiAuditEventListResponse | ApiErrorResponse>('backend:audit-list-events', query);
  },
  backendAuditGetEventById: (eventId: string) => {
    return invokeIpc<ApiAuditEventDetailResponse | ApiErrorResponse>('backend:audit-get-event-by-id', eventId);
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
  backendSftpCreateSession: (payload: ApiSftpCreateSessionRequest) => {
    return invokeIpc<
      ApiSftpCreateSessionResponse | ApiSftpCreateSessionHostVerificationRequiredResponse | ApiErrorResponse
    >('backend:sftp-create-session', payload);
  },
  backendSftpListDirectory: (sessionId: string, query?: ApiSftpListDirectoryQuery) => {
    return invokeIpc<ApiSftpListDirectoryResponse | ApiErrorResponse>('backend:sftp-list-directory', sessionId, query);
  },
  backendSftpGetEntryDetails: (sessionId: string, payload: ApiSftpEntryDetailsRequest) => {
    return invokeIpc<ApiSftpEntryDetailsResponse | ApiErrorResponse>(
      'backend:sftp-get-entry-details',
      sessionId,
      payload,
    );
  },
  backendSftpReadFile: (sessionId: string, query: ApiSftpReadFileQuery) => {
    return invokeIpc<ApiSftpReadFileResponse | ApiErrorResponse>('backend:sftp-read-file', sessionId, query);
  },
  backendSftpWriteFile: (sessionId: string, payload: ApiSftpWriteFileRequest) => {
    return invokeIpc<ApiSftpWriteFileResponse | ApiErrorResponse>('backend:sftp-write-file', sessionId, payload);
  },
  backendSftpDownloadFile: (sessionId: string, payload: ApiSftpDownloadFileRequest) => {
    return invokeIpc<ApiSftpDownloadFileResponse | ApiErrorResponse>('backend:sftp-download-file', sessionId, payload);
  },
  backendSftpUploadFile: (sessionId: string, payload: ApiSftpUploadFileRequest) => {
    return invokeIpc<ApiSftpUploadFileResponse | ApiErrorResponse>('backend:sftp-upload-file', sessionId, payload);
  },
  backendSftpCreateDirectory: (sessionId: string, payload: ApiSftpCreateDirectoryRequest) => {
    return invokeIpc<ApiSftpCreateDirectoryResponse | ApiErrorResponse>(
      'backend:sftp-create-directory',
      sessionId,
      payload,
    );
  },
  backendSftpCreateFile: (sessionId: string, payload: ApiSftpCreateFileRequest) => {
    return invokeIpc<ApiSftpCreateFileResponse | ApiErrorResponse>('backend:sftp-create-file', sessionId, payload);
  },
  backendSftpRenameEntry: (sessionId: string, payload: ApiSftpRenameRequest) => {
    return invokeIpc<ApiSftpRenameResponse | ApiErrorResponse>('backend:sftp-rename-entry', sessionId, payload);
  },
  backendSftpCopyEntry: (sessionId: string, payload: ApiSftpCopyRequest) => {
    return invokeIpc<ApiSftpCopyResponse | ApiErrorResponse>('backend:sftp-copy-entry', sessionId, payload);
  },
  backendSftpDeleteEntry: (sessionId: string, payload: ApiSftpDeleteRequest) => {
    return invokeIpc<ApiSftpDeleteResponse | ApiErrorResponse>('backend:sftp-delete-entry', sessionId, payload);
  },
  backendSftpBatchOperation: (sessionId: string, payload: ApiSftpBatchOperationRequest) => {
    return invokeIpc<ApiSftpBatchOperationResponse | ApiErrorResponse>(
      'backend:sftp-batch-operation',
      sessionId,
      payload,
    );
  },
  backendSftpCloseSession: (sessionId: string) => {
    return invokeIpc<{ success: boolean }>('backend:sftp-close-session', sessionId);
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
  backendPortForwardListRules: () => {
    return invokeIpc<ApiPortForwardListRulesResponse | ApiErrorResponse>('backend:port-forward-list-rules');
  },
  backendPortForwardCreateRule: (payload: ApiPortForwardCreateRuleRequest) => {
    return invokeIpc<ApiPortForwardCreateRuleResponse | ApiErrorResponse>('backend:port-forward-create-rule', payload);
  },
  backendPortForwardUpdateRule: (ruleId: string, payload: ApiPortForwardUpdateRuleRequest) => {
    return invokeIpc<ApiPortForwardUpdateRuleResponse | ApiErrorResponse>(
      'backend:port-forward-update-rule',
      ruleId,
      payload,
    );
  },
  backendPortForwardStartRule: (ruleId: string) => {
    return invokeIpc<ApiPortForwardStartRuleResponse | ApiErrorResponse>('backend:port-forward-start-rule', ruleId);
  },
  backendPortForwardStopRule: (ruleId: string) => {
    return invokeIpc<ApiPortForwardStopRuleResponse | ApiErrorResponse>('backend:port-forward-stop-rule', ruleId);
  },
  backendPortForwardDeleteRule: (ruleId: string) => {
    return invokeIpc<{ success: boolean }>('backend:port-forward-delete-rule', ruleId);
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
