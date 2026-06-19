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
  SftpUploadFileSelection,
} from '@cosmosh/api-contract';

type LocalTerminalListResponse = ApiLocalTerminalListProfilesResponse;
type LocalTerminalCreateSessionRequest = ApiLocalTerminalCreateSessionRequest;
type LocalTerminalCreateSessionResponse = ApiLocalTerminalCreateSessionResponse;

declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly VITE_ENABLE_STRICT_MODE?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    electron?: {
      closeWindow: () => void;
      getLocale: () => Promise<string>;
      setLocale: (locale: string) => Promise<string>;
      getRuntimeUserName: () => Promise<string>;
      getAppVersionInfo: () => Promise<{
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
      }>;
      getPendingLaunchWorkingDirectory: () => Promise<string | null>;
      getDownloadsPath: () => Promise<string>;
      createSftpTemporaryFile: (fileName: string) => Promise<string>;
      createSftpDownloadsFile: (fileName: string) => Promise<string>;
      selectSftpUploadFiles: () => Promise<SftpUploadFileSelection>;
      cleanupSftpTemporaryFiles: (localPaths: string[]) => Promise<boolean>;
      openSftpTemporaryFile: (localPath: string) => Promise<boolean>;
      readSftpTemporaryImagePreview: (localPath: string) => Promise<string>;
      startSftpTemporaryFileWatch: (localPath: string) => Promise<string>;
      stopSftpTemporaryFileWatch: (watchId: string) => Promise<boolean>;
      onSftpTemporaryFileChanged: (listener: (change: SftpTemporaryFileWatchChange) => void) => () => void;
      showSftpOpenWithDialog: (localPath: string) => Promise<boolean>;
      listSftpOpenWithApplications: (localPath: string) => Promise<SftpOpenWithApplication[]>;
      openSftpFileWithApplication: (localPath: string, applicationPath: string) => Promise<boolean>;
      getDatabaseSecurityInfo: () => Promise<{
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
      }>;
      onLaunchWorkingDirectory: (listener: (cwd: string) => void) => () => void;
      onAppMenuAction: (listener: (action: AppMenuAction) => void) => () => void;
      openDevTools: () => Promise<boolean>;
      toggleDevTools: () => Promise<boolean>;
      reloadWebView: () => Promise<boolean>;
      restartBackendRuntime: () => Promise<boolean>;
      showInFileManager: (targetPath?: string) => Promise<boolean>;
      openExternalUrl: (targetUrl: string) => Promise<boolean>;
      setWindowsSystemMenuSymbolColor: (symbolColor: string) => Promise<boolean>;
      showSaveFileDialog: (defaultPath?: string) => Promise<{ canceled: boolean; filePath?: string }>;
      importPrivateKeyFromFile: () => Promise<{ canceled: boolean; content?: string }>;
      getProcessPerformanceStats: () => Promise<{
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
      }>;
      exportMainHeapSnapshot: () => Promise<{ ok: boolean; filePath?: string; message?: string }>;
      backendTestPing: () => Promise<ApiTestPingResponse | ApiErrorResponse>;
      backendSettingsGet: () => Promise<ApiSettingsGetResponse | ApiErrorResponse>;
      backendSettingsUpdate: (
        payload: ApiSettingsUpdateRequest,
      ) => Promise<ApiSettingsUpdateResponse | ApiErrorResponse>;
      backendAuditListEvents: (query?: ApiAuditEventListQuery) => Promise<ApiAuditEventListResponse | ApiErrorResponse>;
      backendAuditGetEventById: (eventId: string) => Promise<ApiAuditEventDetailResponse | ApiErrorResponse>;
      backendSshListServers: () => Promise<ApiSshListServersResponse | ApiErrorResponse>;
      backendSshCreateServer: (
        payload: ApiSshCreateServerRequest,
      ) => Promise<ApiSshCreateServerResponse | ApiErrorResponse>;
      backendSshUpdateServer: (
        serverId: string,
        payload: ApiSshUpdateServerRequest,
      ) => Promise<ApiSshUpdateServerResponse | ApiErrorResponse>;
      backendSshGetServerCredentials: (
        serverId: string,
      ) => Promise<ApiSshGetServerCredentialsResponse | ApiErrorResponse>;
      backendSshListFolders: () => Promise<ApiSshListFoldersResponse | ApiErrorResponse>;
      backendSshCreateFolder: (
        payload: ApiSshCreateFolderRequest,
      ) => Promise<ApiSshCreateFolderResponse | ApiErrorResponse>;
      backendSshUpdateFolder: (
        folderId: string,
        payload: ApiSshUpdateFolderRequest,
      ) => Promise<ApiSshUpdateFolderResponse | ApiErrorResponse>;
      backendSshListTags: () => Promise<ApiSshListTagsResponse | ApiErrorResponse>;
      backendSshCreateTag: (payload: ApiSshCreateTagRequest) => Promise<ApiSshCreateTagResponse | ApiErrorResponse>;
      backendSshListKeychains: () => Promise<ApiSshListKeychainsResponse | ApiErrorResponse>;
      backendSshCreateKeychain: (
        payload: ApiSshCreateKeychainRequest,
      ) => Promise<ApiSshCreateKeychainResponse | ApiErrorResponse>;
      backendSshUpdateKeychain: (
        keychainId: string,
        payload: ApiSshUpdateKeychainRequest,
      ) => Promise<ApiSshUpdateKeychainResponse | ApiErrorResponse>;
      backendSshGetKeychainCredentials: (
        keychainId: string,
      ) => Promise<ApiSshGetKeychainCredentialsResponse | ApiErrorResponse>;
      backendSshCreateSession: (
        payload: ApiSshCreateSessionRequest,
      ) => Promise<
        ApiSshCreateSessionResponse | ApiSshCreateSessionHostVerificationRequiredResponse | ApiErrorResponse
      >;
      backendSshTrustFingerprint: (
        payload: ApiSshTrustFingerprintRequest,
      ) => Promise<ApiSshTrustFingerprintResponse | ApiErrorResponse>;
      backendSshCloseSession: (sessionId: string) => Promise<{ success: boolean }>;
      backendSftpCreateSession: (
        payload: ApiSftpCreateSessionRequest,
      ) => Promise<
        ApiSftpCreateSessionResponse | ApiSftpCreateSessionHostVerificationRequiredResponse | ApiErrorResponse
      >;
      backendSftpListDirectory: (
        sessionId: string,
        query?: ApiSftpListDirectoryQuery,
      ) => Promise<ApiSftpListDirectoryResponse | ApiErrorResponse>;
      backendSftpGetEntryDetails: (
        sessionId: string,
        payload: ApiSftpEntryDetailsRequest,
      ) => Promise<ApiSftpEntryDetailsResponse | ApiErrorResponse>;
      backendSftpReadFile: (
        sessionId: string,
        query: ApiSftpReadFileQuery,
      ) => Promise<ApiSftpReadFileResponse | ApiErrorResponse>;
      backendSftpWriteFile: (
        sessionId: string,
        payload: ApiSftpWriteFileRequest,
      ) => Promise<ApiSftpWriteFileResponse | ApiErrorResponse>;
      backendSftpDownloadFile: (
        sessionId: string,
        payload: ApiSftpDownloadFileRequest,
      ) => Promise<ApiSftpDownloadFileResponse | ApiErrorResponse>;
      backendSftpUploadFile: (
        sessionId: string,
        payload: ApiSftpUploadFileRequest,
      ) => Promise<ApiSftpUploadFileResponse | ApiErrorResponse>;
      backendSftpCreateDirectory: (
        sessionId: string,
        payload: ApiSftpCreateDirectoryRequest,
      ) => Promise<ApiSftpCreateDirectoryResponse | ApiErrorResponse>;
      backendSftpCreateFile: (
        sessionId: string,
        payload: ApiSftpCreateFileRequest,
      ) => Promise<ApiSftpCreateFileResponse | ApiErrorResponse>;
      backendSftpRenameEntry: (
        sessionId: string,
        payload: ApiSftpRenameRequest,
      ) => Promise<ApiSftpRenameResponse | ApiErrorResponse>;
      backendSftpCopyEntry: (
        sessionId: string,
        payload: ApiSftpCopyRequest,
      ) => Promise<ApiSftpCopyResponse | ApiErrorResponse>;
      backendSftpDeleteEntry: (
        sessionId: string,
        payload: ApiSftpDeleteRequest,
      ) => Promise<ApiSftpDeleteResponse | ApiErrorResponse>;
      backendSftpBatchOperation: (
        sessionId: string,
        payload: ApiSftpBatchOperationRequest,
      ) => Promise<ApiSftpBatchOperationResponse | ApiErrorResponse>;
      backendSftpCloseSession: (sessionId: string) => Promise<{ success: boolean }>;
      backendSshDeleteServer: (serverId: string) => Promise<{ success: boolean }>;
      backendSshDeleteFolder: (folderId: string) => Promise<{ success: boolean }>;
      backendSshDeleteKeychain: (keychainId: string) => Promise<{ success: boolean }>;
      backendPortForwardListRules: () => Promise<ApiPortForwardListRulesResponse | ApiErrorResponse>;
      backendPortForwardCreateRule: (
        payload: ApiPortForwardCreateRuleRequest,
      ) => Promise<ApiPortForwardCreateRuleResponse | ApiErrorResponse>;
      backendPortForwardUpdateRule: (
        ruleId: string,
        payload: ApiPortForwardUpdateRuleRequest,
      ) => Promise<ApiPortForwardUpdateRuleResponse | ApiErrorResponse>;
      backendPortForwardStartRule: (ruleId: string) => Promise<ApiPortForwardStartRuleResponse | ApiErrorResponse>;
      backendPortForwardStopRule: (ruleId: string) => Promise<ApiPortForwardStopRuleResponse | ApiErrorResponse>;
      backendPortForwardDeleteRule: (ruleId: string) => Promise<{ success: boolean }>;
      backendLocalTerminalListProfiles: () => Promise<LocalTerminalListResponse | ApiErrorResponse>;
      backendLocalTerminalCreateSession: (
        payload: LocalTerminalCreateSessionRequest,
      ) => Promise<LocalTerminalCreateSessionResponse | ApiErrorResponse>;
      backendLocalTerminalCloseSession: (sessionId: string) => Promise<{ success: boolean }>;
      platform: NodeJS.Platform;
    };
  }
}

export {};

declare module '*.worker?worker' {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

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
