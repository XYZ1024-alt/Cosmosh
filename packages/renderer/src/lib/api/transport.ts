import type {
  ApiAuditEventDetailResponse,
  ApiAuditEventListQuery,
  ApiAuditEventListResponse,
  ApiErrorResponse,
  ApiLocalTerminalCreateSessionRequest,
  ApiLocalTerminalCreateSessionResponse,
  ApiLocalTerminalListProfilesResponse,
  ApiLocalTerminalProfile,
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
import { API_HEADERS, API_PATHS } from '@cosmosh/api-contract';

type RuntimeTarget = 'electron' | 'browser';

export type LocalTerminalProfile = ApiLocalTerminalProfile;
export type LocalTerminalListResponse = ApiLocalTerminalListProfilesResponse;
export type LocalTerminalCreateSessionRequest = ApiLocalTerminalCreateSessionRequest;
export type LocalTerminalCreateSessionResponse = ApiLocalTerminalCreateSessionResponse;

type ApiResponse =
  | ApiErrorResponse
  | ApiTestPingResponse
  | ApiAuditEventListResponse
  | ApiAuditEventDetailResponse
  | ApiSettingsGetResponse
  | ApiSettingsUpdateResponse
  | ApiSftpCreateSessionResponse
  | ApiSftpCreateSessionHostVerificationRequiredResponse
  | ApiSftpListDirectoryResponse
  | ApiSftpEntryDetailsResponse
  | ApiSftpReadFileResponse
  | ApiSftpDownloadFileResponse
  | ApiSftpCreateDirectoryResponse
  | ApiSftpCreateFileResponse
  | ApiSftpRenameResponse
  | ApiSftpCopyResponse
  | ApiSftpDeleteResponse
  | ApiSftpBatchOperationResponse
  | ApiSshListServersResponse
  | ApiSshCreateServerResponse
  | ApiSshUpdateServerResponse
  | ApiSshGetServerCredentialsResponse
  | ApiSshListFoldersResponse
  | ApiSshCreateFolderResponse
  | ApiSshUpdateFolderResponse
  | ApiSshListTagsResponse
  | ApiSshCreateTagResponse
  | ApiSshCreateSessionResponse
  | ApiSshCreateSessionHostVerificationRequiredResponse
  | ApiSshTrustFingerprintResponse
  | ApiSshListKeychainsResponse
  | ApiSshCreateKeychainResponse
  | ApiSshUpdateKeychainResponse
  | ApiSshGetKeychainCredentialsResponse
  | ApiPortForwardListRulesResponse
  | ApiPortForwardCreateRuleResponse
  | ApiPortForwardUpdateRuleResponse
  | ApiPortForwardStartRuleResponse
  | ApiPortForwardStopRuleResponse
  | ApiLocalTerminalListProfilesResponse
  | ApiLocalTerminalCreateSessionResponse;

export type ApiTransport = {
  target: RuntimeTarget;
  testPing: () => Promise<ApiTestPingResponse | ApiErrorResponse>;
  listAuditEvents: (query?: ApiAuditEventListQuery) => Promise<ApiAuditEventListResponse | ApiErrorResponse>;
  getAuditEventById: (eventId: string) => Promise<ApiAuditEventDetailResponse | ApiErrorResponse>;
  getSettings: () => Promise<ApiSettingsGetResponse | ApiErrorResponse>;
  updateSettings: (payload: ApiSettingsUpdateRequest) => Promise<ApiSettingsUpdateResponse | ApiErrorResponse>;
  listSshServers: () => Promise<ApiSshListServersResponse | ApiErrorResponse>;
  createSshServer: (payload: ApiSshCreateServerRequest) => Promise<ApiSshCreateServerResponse | ApiErrorResponse>;
  updateSshServer: (
    serverId: string,
    payload: ApiSshUpdateServerRequest,
  ) => Promise<ApiSshUpdateServerResponse | ApiErrorResponse>;
  getSshServerCredentials: (serverId: string) => Promise<ApiSshGetServerCredentialsResponse | ApiErrorResponse>;
  listSshFolders: () => Promise<ApiSshListFoldersResponse | ApiErrorResponse>;
  createSshFolder: (payload: ApiSshCreateFolderRequest) => Promise<ApiSshCreateFolderResponse | ApiErrorResponse>;
  updateSshFolder: (
    folderId: string,
    payload: ApiSshUpdateFolderRequest,
  ) => Promise<ApiSshUpdateFolderResponse | ApiErrorResponse>;
  listSshTags: () => Promise<ApiSshListTagsResponse | ApiErrorResponse>;
  createSshTag: (payload: ApiSshCreateTagRequest) => Promise<ApiSshCreateTagResponse | ApiErrorResponse>;
  listSshKeychains: () => Promise<ApiSshListKeychainsResponse | ApiErrorResponse>;
  createSshKeychain: (payload: ApiSshCreateKeychainRequest) => Promise<ApiSshCreateKeychainResponse | ApiErrorResponse>;
  updateSshKeychain: (
    keychainId: string,
    payload: ApiSshUpdateKeychainRequest,
  ) => Promise<ApiSshUpdateKeychainResponse | ApiErrorResponse>;
  getSshKeychainCredentials: (keychainId: string) => Promise<ApiSshGetKeychainCredentialsResponse | ApiErrorResponse>;
  listPortForwardRules: () => Promise<ApiPortForwardListRulesResponse | ApiErrorResponse>;
  createPortForwardRule: (
    payload: ApiPortForwardCreateRuleRequest,
  ) => Promise<ApiPortForwardCreateRuleResponse | ApiErrorResponse>;
  updatePortForwardRule: (
    ruleId: string,
    payload: ApiPortForwardUpdateRuleRequest,
  ) => Promise<ApiPortForwardUpdateRuleResponse | ApiErrorResponse>;
  startPortForwardRule: (ruleId: string) => Promise<ApiPortForwardStartRuleResponse | ApiErrorResponse>;
  stopPortForwardRule: (ruleId: string) => Promise<ApiPortForwardStopRuleResponse | ApiErrorResponse>;
  deletePortForwardRule: (ruleId: string) => Promise<{ success: boolean }>;
  createSshSession: (
    payload: ApiSshCreateSessionRequest,
  ) => Promise<ApiSshCreateSessionResponse | ApiSshCreateSessionHostVerificationRequiredResponse | ApiErrorResponse>;
  createSftpSession: (
    payload: ApiSftpCreateSessionRequest,
  ) => Promise<ApiSftpCreateSessionResponse | ApiSftpCreateSessionHostVerificationRequiredResponse | ApiErrorResponse>;
  listSftpDirectory: (
    sessionId: string,
    query?: ApiSftpListDirectoryQuery,
  ) => Promise<ApiSftpListDirectoryResponse | ApiErrorResponse>;
  getSftpEntryDetails: (
    sessionId: string,
    payload: ApiSftpEntryDetailsRequest,
  ) => Promise<ApiSftpEntryDetailsResponse | ApiErrorResponse>;
  readSftpFile: (sessionId: string, query: ApiSftpReadFileQuery) => Promise<ApiSftpReadFileResponse | ApiErrorResponse>;
  downloadSftpFile: (
    sessionId: string,
    payload: ApiSftpDownloadFileRequest,
  ) => Promise<ApiSftpDownloadFileResponse | ApiErrorResponse>;
  createSftpDirectory: (
    sessionId: string,
    payload: ApiSftpCreateDirectoryRequest,
  ) => Promise<ApiSftpCreateDirectoryResponse | ApiErrorResponse>;
  createSftpFile: (
    sessionId: string,
    payload: ApiSftpCreateFileRequest,
  ) => Promise<ApiSftpCreateFileResponse | ApiErrorResponse>;
  renameSftpEntry: (
    sessionId: string,
    payload: ApiSftpRenameRequest,
  ) => Promise<ApiSftpRenameResponse | ApiErrorResponse>;
  copySftpEntry: (sessionId: string, payload: ApiSftpCopyRequest) => Promise<ApiSftpCopyResponse | ApiErrorResponse>;
  deleteSftpEntry: (
    sessionId: string,
    payload: ApiSftpDeleteRequest,
  ) => Promise<ApiSftpDeleteResponse | ApiErrorResponse>;
  runSftpBatchOperation: (
    sessionId: string,
    payload: ApiSftpBatchOperationRequest,
  ) => Promise<ApiSftpBatchOperationResponse | ApiErrorResponse>;
  trustSshFingerprint: (
    payload: ApiSshTrustFingerprintRequest,
  ) => Promise<ApiSshTrustFingerprintResponse | ApiErrorResponse>;
  listLocalTerminalProfiles: () => Promise<LocalTerminalListResponse | ApiErrorResponse>;
  createLocalTerminalSession: (
    payload: LocalTerminalCreateSessionRequest,
  ) => Promise<LocalTerminalCreateSessionResponse | ApiErrorResponse>;
  closeLocalTerminalSession: (sessionId: string) => Promise<{ success: boolean }>;
  closeSshSession: (sessionId: string) => Promise<{ success: boolean }>;
  closeSftpSession: (sessionId: string) => Promise<{ success: boolean }>;
  deleteSshServer: (serverId: string) => Promise<{ success: boolean }>;
  deleteSshFolder: (folderId: string) => Promise<{ success: boolean }>;
  deleteSshKeychain: (keychainId: string) => Promise<{ success: boolean }>;
};

// Browser fallback uses build-time URL configuration to prepare for future web runtime.
const resolveBrowserBaseUrl = (): string => {
  const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_COSMOSH_API_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/$/, '');
  }

  return '';
};

// Browser auth is intentionally placeholder-only for now; token source is reserved here.
const resolveBrowserAuthToken = (): string | null => {
  try {
    return window.localStorage.getItem('cosmosh.accessToken');
  } catch {
    return null;
  }
};

const createBrowserFallbackError = (message: string): ApiErrorResponse => {
  return {
    success: false,
    code: 'AUTH_INVALID_TOKEN',
    message,
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
};

const createElectronTransport = (): ApiTransport => {
  return {
    target: 'electron',
    testPing: async () => {
      return (await window.electron!.backendTestPing()) as ApiTestPingResponse | ApiErrorResponse;
    },
    listAuditEvents: async (query) => {
      return (await window.electron!.backendAuditListEvents(query)) as ApiAuditEventListResponse | ApiErrorResponse;
    },
    getAuditEventById: async (eventId) => {
      return (await window.electron!.backendAuditGetEventById(eventId)) as
        | ApiAuditEventDetailResponse
        | ApiErrorResponse;
    },
    getSettings: async () => {
      return (await window.electron!.backendSettingsGet()) as ApiSettingsGetResponse | ApiErrorResponse;
    },
    updateSettings: async (payload) => {
      return (await window.electron!.backendSettingsUpdate(payload)) as ApiSettingsUpdateResponse | ApiErrorResponse;
    },
    listSshServers: async () => {
      return (await window.electron!.backendSshListServers()) as ApiSshListServersResponse | ApiErrorResponse;
    },
    createSshServer: async (payload) => {
      return (await window.electron!.backendSshCreateServer(payload)) as ApiSshCreateServerResponse | ApiErrorResponse;
    },
    updateSshServer: async (serverId, payload) => {
      return (await window.electron!.backendSshUpdateServer(serverId, payload)) as
        | ApiSshUpdateServerResponse
        | ApiErrorResponse;
    },
    getSshServerCredentials: async (serverId) => {
      return (await window.electron!.backendSshGetServerCredentials(serverId)) as
        | ApiSshGetServerCredentialsResponse
        | ApiErrorResponse;
    },
    listSshFolders: async () => {
      return (await window.electron!.backendSshListFolders()) as ApiSshListFoldersResponse | ApiErrorResponse;
    },
    createSshFolder: async (payload) => {
      return (await window.electron!.backendSshCreateFolder(payload)) as ApiSshCreateFolderResponse | ApiErrorResponse;
    },
    updateSshFolder: async (folderId, payload) => {
      return (await window.electron!.backendSshUpdateFolder(folderId, payload)) as
        | ApiSshUpdateFolderResponse
        | ApiErrorResponse;
    },
    listSshTags: async () => {
      return (await window.electron!.backendSshListTags()) as ApiSshListTagsResponse | ApiErrorResponse;
    },
    createSshTag: async (payload) => {
      return (await window.electron!.backendSshCreateTag(payload)) as ApiSshCreateTagResponse | ApiErrorResponse;
    },
    listSshKeychains: async () => {
      return (await window.electron!.backendSshListKeychains()) as ApiSshListKeychainsResponse | ApiErrorResponse;
    },
    createSshKeychain: async (payload) => {
      return (await window.electron!.backendSshCreateKeychain(payload)) as
        | ApiSshCreateKeychainResponse
        | ApiErrorResponse;
    },
    updateSshKeychain: async (keychainId, payload) => {
      return (await window.electron!.backendSshUpdateKeychain(keychainId, payload)) as
        | ApiSshUpdateKeychainResponse
        | ApiErrorResponse;
    },
    getSshKeychainCredentials: async (keychainId) => {
      return (await window.electron!.backendSshGetKeychainCredentials(keychainId)) as
        | ApiSshGetKeychainCredentialsResponse
        | ApiErrorResponse;
    },
    listPortForwardRules: async () => {
      return (await window.electron!.backendPortForwardListRules()) as
        | ApiPortForwardListRulesResponse
        | ApiErrorResponse;
    },
    createPortForwardRule: async (payload) => {
      return (await window.electron!.backendPortForwardCreateRule(payload)) as
        | ApiPortForwardCreateRuleResponse
        | ApiErrorResponse;
    },
    updatePortForwardRule: async (ruleId, payload) => {
      return (await window.electron!.backendPortForwardUpdateRule(ruleId, payload)) as
        | ApiPortForwardUpdateRuleResponse
        | ApiErrorResponse;
    },
    startPortForwardRule: async (ruleId) => {
      return (await window.electron!.backendPortForwardStartRule(ruleId)) as
        | ApiPortForwardStartRuleResponse
        | ApiErrorResponse;
    },
    stopPortForwardRule: async (ruleId) => {
      return (await window.electron!.backendPortForwardStopRule(ruleId)) as
        | ApiPortForwardStopRuleResponse
        | ApiErrorResponse;
    },
    deletePortForwardRule: async (ruleId) => {
      return await window.electron!.backendPortForwardDeleteRule(ruleId);
    },
    createSshSession: async (payload) => {
      return (await window.electron!.backendSshCreateSession(payload)) as
        | ApiSshCreateSessionResponse
        | ApiSshCreateSessionHostVerificationRequiredResponse
        | ApiErrorResponse;
    },
    trustSshFingerprint: async (payload) => {
      return (await window.electron!.backendSshTrustFingerprint(payload)) as
        | ApiSshTrustFingerprintResponse
        | ApiErrorResponse;
    },
    createSftpSession: async (payload) => {
      return (await window.electron!.backendSftpCreateSession(payload)) as
        | ApiSftpCreateSessionResponse
        | ApiSftpCreateSessionHostVerificationRequiredResponse
        | ApiErrorResponse;
    },
    listSftpDirectory: async (sessionId, query) => {
      return (await window.electron!.backendSftpListDirectory(sessionId, query)) as
        | ApiSftpListDirectoryResponse
        | ApiErrorResponse;
    },
    getSftpEntryDetails: async (sessionId, payload) => {
      return (await window.electron!.backendSftpGetEntryDetails(sessionId, payload)) as
        | ApiSftpEntryDetailsResponse
        | ApiErrorResponse;
    },
    readSftpFile: async (sessionId, query) => {
      return (await window.electron!.backendSftpReadFile(sessionId, query)) as
        | ApiSftpReadFileResponse
        | ApiErrorResponse;
    },
    downloadSftpFile: async (sessionId, payload) => {
      return (await window.electron!.backendSftpDownloadFile(sessionId, payload)) as
        | ApiSftpDownloadFileResponse
        | ApiErrorResponse;
    },
    createSftpDirectory: async (sessionId, payload) => {
      return (await window.electron!.backendSftpCreateDirectory(sessionId, payload)) as
        | ApiSftpCreateDirectoryResponse
        | ApiErrorResponse;
    },
    createSftpFile: async (sessionId, payload) => {
      return (await window.electron!.backendSftpCreateFile(sessionId, payload)) as
        | ApiSftpCreateFileResponse
        | ApiErrorResponse;
    },
    renameSftpEntry: async (sessionId, payload) => {
      return (await window.electron!.backendSftpRenameEntry(sessionId, payload)) as
        | ApiSftpRenameResponse
        | ApiErrorResponse;
    },
    copySftpEntry: async (sessionId, payload) => {
      return (await window.electron!.backendSftpCopyEntry(sessionId, payload)) as
        | ApiSftpCopyResponse
        | ApiErrorResponse;
    },
    deleteSftpEntry: async (sessionId, payload) => {
      return (await window.electron!.backendSftpDeleteEntry(sessionId, payload)) as
        | ApiSftpDeleteResponse
        | ApiErrorResponse;
    },
    runSftpBatchOperation: async (sessionId, payload) => {
      return (await window.electron!.backendSftpBatchOperation(sessionId, payload)) as
        | ApiSftpBatchOperationResponse
        | ApiErrorResponse;
    },
    listLocalTerminalProfiles: async () => {
      return (await window.electron!.backendLocalTerminalListProfiles()) as
        | LocalTerminalListResponse
        | ApiErrorResponse;
    },
    createLocalTerminalSession: async (payload) => {
      return (await window.electron!.backendLocalTerminalCreateSession(payload)) as
        | LocalTerminalCreateSessionResponse
        | ApiErrorResponse;
    },
    closeLocalTerminalSession: async (sessionId) => {
      return await window.electron!.backendLocalTerminalCloseSession(sessionId);
    },
    closeSshSession: async (sessionId) => {
      return await window.electron!.backendSshCloseSession(sessionId);
    },
    closeSftpSession: async (sessionId) => {
      return await window.electron!.backendSftpCloseSession(sessionId);
    },
    deleteSshServer: async (serverId) => {
      return await window.electron!.backendSshDeleteServer(serverId);
    },
    deleteSshFolder: async (folderId) => {
      return await window.electron!.backendSshDeleteFolder(folderId);
    },
    deleteSshKeychain: async (keychainId) => {
      return await window.electron!.backendSshDeleteKeychain(keychainId);
    },
  };
};

const createBrowserTransport = (): ApiTransport => {
  const callBrowserApi = async (
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: unknown,
  ): Promise<ApiResponse> => {
    const token = resolveBrowserAuthToken();
    const baseUrl = resolveBrowserBaseUrl();

    if (!token) {
      return createBrowserFallbackError('Browser auth flow is not implemented yet. Please sign in first.');
    }

    if (!baseUrl) {
      return createBrowserFallbackError('Browser API base URL is not configured. Set VITE_COSMOSH_API_BASE_URL.');
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        [API_HEADERS.locale]: navigator.language,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return (await response.json()) as ApiResponse;
  };

  return {
    target: 'browser',
    testPing: async () => {
      return (await callBrowserApi(API_PATHS.testPing, 'GET')) as ApiTestPingResponse | ApiErrorResponse;
    },
    listAuditEvents: async (query) => {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value === undefined || value === null || value === '') {
          continue;
        }

        searchParams.set(key, String(value));
      }

      const queryString = searchParams.toString();
      const path = queryString.length > 0 ? `${API_PATHS.auditListEvents}?${queryString}` : API_PATHS.auditListEvents;
      return (await callBrowserApi(path, 'GET')) as ApiAuditEventListResponse | ApiErrorResponse;
    },
    getAuditEventById: async (eventId) => {
      const path = API_PATHS.auditGetEventById.replace('{eventId}', encodeURIComponent(eventId));
      return (await callBrowserApi(path, 'GET')) as ApiAuditEventDetailResponse | ApiErrorResponse;
    },
    getSettings: async () => {
      return (await callBrowserApi(API_PATHS.settingsGet, 'GET')) as ApiSettingsGetResponse | ApiErrorResponse;
    },
    updateSettings: async (payload) => {
      return (await callBrowserApi(API_PATHS.settingsUpdate, 'PUT', payload)) as
        | ApiSettingsUpdateResponse
        | ApiErrorResponse;
    },
    listSshServers: async () => {
      return (await callBrowserApi(API_PATHS.sshListServers, 'GET')) as ApiSshListServersResponse | ApiErrorResponse;
    },
    createSshServer: async (payload) => {
      return (await callBrowserApi(API_PATHS.sshCreateServer, 'POST', payload)) as
        | ApiSshCreateServerResponse
        | ApiErrorResponse;
    },
    updateSshServer: async (serverId, payload) => {
      const path = API_PATHS.sshUpdateServer.replace('{serverId}', encodeURIComponent(serverId));
      return (await callBrowserApi(path, 'PUT', payload)) as ApiSshUpdateServerResponse | ApiErrorResponse;
    },
    getSshServerCredentials: async (serverId) => {
      const path = API_PATHS.sshGetServerCredentials.replace('{serverId}', encodeURIComponent(serverId));
      return (await callBrowserApi(path, 'GET')) as ApiSshGetServerCredentialsResponse | ApiErrorResponse;
    },
    listSshFolders: async () => {
      return (await callBrowserApi(API_PATHS.sshListFolders, 'GET')) as ApiSshListFoldersResponse | ApiErrorResponse;
    },
    createSshFolder: async (payload) => {
      return (await callBrowserApi(API_PATHS.sshCreateFolder, 'POST', payload)) as
        | ApiSshCreateFolderResponse
        | ApiErrorResponse;
    },
    updateSshFolder: async (folderId, payload) => {
      const path = API_PATHS.sshUpdateFolder.replace('{folderId}', encodeURIComponent(folderId));
      return (await callBrowserApi(path, 'PUT', payload)) as ApiSshUpdateFolderResponse | ApiErrorResponse;
    },
    listSshTags: async () => {
      return (await callBrowserApi(API_PATHS.sshListTags, 'GET')) as ApiSshListTagsResponse | ApiErrorResponse;
    },
    createSshTag: async (payload) => {
      return (await callBrowserApi(API_PATHS.sshCreateTag, 'POST', payload)) as
        | ApiSshCreateTagResponse
        | ApiErrorResponse;
    },
    listSshKeychains: async () => {
      return (await callBrowserApi(API_PATHS.sshListKeychains, 'GET')) as
        | ApiSshListKeychainsResponse
        | ApiErrorResponse;
    },
    createSshKeychain: async (payload) => {
      return (await callBrowserApi(API_PATHS.sshCreateKeychain, 'POST', payload)) as
        | ApiSshCreateKeychainResponse
        | ApiErrorResponse;
    },
    updateSshKeychain: async (keychainId, payload) => {
      const path = API_PATHS.sshUpdateKeychain.replace('{keychainId}', encodeURIComponent(keychainId));
      return (await callBrowserApi(path, 'PUT', payload)) as ApiSshUpdateKeychainResponse | ApiErrorResponse;
    },
    getSshKeychainCredentials: async (keychainId) => {
      const path = API_PATHS.sshGetKeychainCredentials.replace('{keychainId}', encodeURIComponent(keychainId));
      return (await callBrowserApi(path, 'GET')) as ApiSshGetKeychainCredentialsResponse | ApiErrorResponse;
    },
    listPortForwardRules: async () => {
      return (await callBrowserApi(API_PATHS.portForwardListRules, 'GET')) as
        | ApiPortForwardListRulesResponse
        | ApiErrorResponse;
    },
    createPortForwardRule: async (payload) => {
      return (await callBrowserApi(API_PATHS.portForwardCreateRule, 'POST', payload)) as
        | ApiPortForwardCreateRuleResponse
        | ApiErrorResponse;
    },
    updatePortForwardRule: async (ruleId, payload) => {
      const path = API_PATHS.portForwardUpdateRule.replace('{ruleId}', encodeURIComponent(ruleId));
      return (await callBrowserApi(path, 'PUT', payload)) as ApiPortForwardUpdateRuleResponse | ApiErrorResponse;
    },
    startPortForwardRule: async (ruleId) => {
      const path = API_PATHS.portForwardStartRule.replace('{ruleId}', encodeURIComponent(ruleId));
      return (await callBrowserApi(path, 'POST')) as ApiPortForwardStartRuleResponse | ApiErrorResponse;
    },
    stopPortForwardRule: async (ruleId) => {
      const path = API_PATHS.portForwardStopRule.replace('{ruleId}', encodeURIComponent(ruleId));
      return (await callBrowserApi(path, 'POST')) as ApiPortForwardStopRuleResponse | ApiErrorResponse;
    },
    deletePortForwardRule: async (ruleId) => {
      const path = API_PATHS.portForwardDeleteRule.replace('{ruleId}', encodeURIComponent(ruleId));
      const response = await fetch(`${resolveBrowserBaseUrl()}${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${resolveBrowserAuthToken() ?? ''}`,
          [API_HEADERS.locale]: navigator.language,
        },
      });

      return { success: response.status === 204 };
    },
    createSshSession: async (payload) => {
      return (await callBrowserApi(API_PATHS.sshCreateSession, 'POST', payload)) as
        | ApiSshCreateSessionResponse
        | ApiSshCreateSessionHostVerificationRequiredResponse
        | ApiErrorResponse;
    },
    trustSshFingerprint: async (payload) => {
      return (await callBrowserApi(API_PATHS.sshTrustFingerprint, 'POST', payload)) as
        | ApiSshTrustFingerprintResponse
        | ApiErrorResponse;
    },
    createSftpSession: async (payload) => {
      return (await callBrowserApi(API_PATHS.sftpCreateSession, 'POST', payload)) as
        | ApiSftpCreateSessionResponse
        | ApiSftpCreateSessionHostVerificationRequiredResponse
        | ApiErrorResponse;
    },
    listSftpDirectory: async (sessionId, query) => {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value === undefined || value === null || value === '') {
          continue;
        }

        searchParams.set(key, String(value));
      }

      const queryString = searchParams.toString();
      const basePath = API_PATHS.sftpListDirectory.replace('{sessionId}', encodeURIComponent(sessionId));
      const path = queryString.length > 0 ? `${basePath}?${queryString}` : basePath;
      return (await callBrowserApi(path, 'GET')) as ApiSftpListDirectoryResponse | ApiErrorResponse;
    },
    getSftpEntryDetails: async (sessionId, payload) => {
      const path = API_PATHS.sftpGetEntryDetails.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpEntryDetailsResponse | ApiErrorResponse;
    },
    readSftpFile: async (sessionId, query) => {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }

        searchParams.set(key, String(value));
      }

      const basePath = API_PATHS.sftpReadFile.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(`${basePath}?${searchParams.toString()}`, 'GET')) as
        | ApiSftpReadFileResponse
        | ApiErrorResponse;
    },
    downloadSftpFile: async (sessionId, payload) => {
      const path = API_PATHS.sftpDownloadFile.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpDownloadFileResponse | ApiErrorResponse;
    },
    createSftpDirectory: async (sessionId, payload) => {
      const path = API_PATHS.sftpCreateDirectory.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpCreateDirectoryResponse | ApiErrorResponse;
    },
    createSftpFile: async (sessionId, payload) => {
      const path = API_PATHS.sftpCreateFile.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpCreateFileResponse | ApiErrorResponse;
    },
    renameSftpEntry: async (sessionId, payload) => {
      const path = API_PATHS.sftpRenameEntry.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpRenameResponse | ApiErrorResponse;
    },
    copySftpEntry: async (sessionId, payload) => {
      const path = API_PATHS.sftpCopyEntry.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpCopyResponse | ApiErrorResponse;
    },
    deleteSftpEntry: async (sessionId, payload) => {
      const path = API_PATHS.sftpDeleteEntry.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpDeleteResponse | ApiErrorResponse;
    },
    runSftpBatchOperation: async (sessionId, payload) => {
      const path = API_PATHS.sftpBatchOperation.replace('{sessionId}', encodeURIComponent(sessionId));
      return (await callBrowserApi(path, 'POST', payload)) as ApiSftpBatchOperationResponse | ApiErrorResponse;
    },
    listLocalTerminalProfiles: async () => {
      return createBrowserFallbackError('Local terminal profiles are only available in Electron runtime.');
    },
    createLocalTerminalSession: async () => {
      return createBrowserFallbackError('Local terminal sessions are only available in Electron runtime.');
    },
    closeLocalTerminalSession: async () => {
      return { success: false };
    },
    closeSshSession: async (sessionId) => {
      const path = API_PATHS.sshCloseSession.replace('{sessionId}', encodeURIComponent(sessionId));
      const response = await fetch(`${resolveBrowserBaseUrl()}${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${resolveBrowserAuthToken() ?? ''}`,
          [API_HEADERS.locale]: navigator.language,
        },
      });

      return { success: response.status === 204 };
    },
    closeSftpSession: async (sessionId) => {
      const path = API_PATHS.sftpCloseSession.replace('{sessionId}', encodeURIComponent(sessionId));
      const response = await fetch(`${resolveBrowserBaseUrl()}${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${resolveBrowserAuthToken() ?? ''}`,
          [API_HEADERS.locale]: navigator.language,
        },
      });

      return { success: response.status === 204 };
    },
    deleteSshServer: async (serverId) => {
      const path = API_PATHS.sshDeleteServer.replace('{serverId}', encodeURIComponent(serverId));
      const response = await fetch(`${resolveBrowserBaseUrl()}${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${resolveBrowserAuthToken() ?? ''}`,
          [API_HEADERS.locale]: navigator.language,
        },
      });

      return { success: response.status === 204 };
    },
    deleteSshFolder: async (folderId) => {
      const path = API_PATHS.sshDeleteFolder.replace('{folderId}', encodeURIComponent(folderId));
      const response = await fetch(`${resolveBrowserBaseUrl()}${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${resolveBrowserAuthToken() ?? ''}`,
          [API_HEADERS.locale]: navigator.language,
        },
      });

      return { success: response.status === 204 };
    },
    deleteSshKeychain: async (keychainId) => {
      const path = API_PATHS.sshDeleteKeychain.replace('{keychainId}', encodeURIComponent(keychainId));
      const response = await fetch(`${resolveBrowserBaseUrl()}${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${resolveBrowserAuthToken() ?? ''}`,
          [API_HEADERS.locale]: navigator.language,
        },
      });

      return { success: response.status === 204 };
    },
  };
};

export const createApiTransport = (): ApiTransport => {
  if (window.electron?.backendTestPing) {
    return createElectronTransport();
  }

  return createBrowserTransport();
};
