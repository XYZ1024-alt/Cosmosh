import type {
  ApiAuditEventDetailResponse,
  ApiAuditEventListQuery,
  ApiAuditEventListResponse,
  ApiErrorResponse,
  ApiPortForwardCreateRuleRequest,
  ApiPortForwardCreateRuleResponse,
  ApiPortForwardListRulesResponse,
  ApiPortForwardStartRuleRequest,
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
  ApiSftpTransferProgressResponse,
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
} from '@cosmosh/api-contract';

import {
  createApiTransport,
  LocalTerminalCreateSessionRequest,
  LocalTerminalCreateSessionResponse,
  LocalTerminalListResponse,
} from './transport';

export type BackendClient = {
  runtimeTarget: 'electron' | 'browser';
  testPing: () => Promise<ApiTestPingResponse>;
  listAuditEvents: (query?: ApiAuditEventListQuery) => Promise<ApiAuditEventListResponse>;
  getAuditEventById: (eventId: string) => Promise<ApiAuditEventDetailResponse>;
  getSettings: () => Promise<ApiSettingsGetResponse>;
  updateSettings: (payload: ApiSettingsUpdateRequest) => Promise<ApiSettingsUpdateResponse>;
  listSshServers: () => Promise<ApiSshListServersResponse>;
  createSshServer: (payload: ApiSshCreateServerRequest) => Promise<ApiSshCreateServerResponse>;
  updateSshServer: (serverId: string, payload: ApiSshUpdateServerRequest) => Promise<ApiSshUpdateServerResponse>;
  getSshServerCredentials: (serverId: string) => Promise<ApiSshGetServerCredentialsResponse>;
  listSshFolders: () => Promise<ApiSshListFoldersResponse>;
  createSshFolder: (payload: ApiSshCreateFolderRequest) => Promise<ApiSshCreateFolderResponse>;
  updateSshFolder: (folderId: string, payload: ApiSshUpdateFolderRequest) => Promise<ApiSshUpdateFolderResponse>;
  listSshTags: () => Promise<ApiSshListTagsResponse>;
  createSshTag: (payload: ApiSshCreateTagRequest) => Promise<ApiSshCreateTagResponse>;
  listSshKeychains: () => Promise<ApiSshListKeychainsResponse>;
  createSshKeychain: (payload: ApiSshCreateKeychainRequest) => Promise<ApiSshCreateKeychainResponse>;
  updateSshKeychain: (
    keychainId: string,
    payload: ApiSshUpdateKeychainRequest,
  ) => Promise<ApiSshUpdateKeychainResponse>;
  getSshKeychainCredentials: (keychainId: string) => Promise<ApiSshGetKeychainCredentialsResponse>;
  listPortForwardRules: () => Promise<ApiPortForwardListRulesResponse>;
  createPortForwardRule: (payload: ApiPortForwardCreateRuleRequest) => Promise<ApiPortForwardCreateRuleResponse>;
  updatePortForwardRule: (
    ruleId: string,
    payload: ApiPortForwardUpdateRuleRequest,
  ) => Promise<ApiPortForwardUpdateRuleResponse>;
  startPortForwardRule: (
    ruleId: string,
    payload: ApiPortForwardStartRuleRequest,
  ) => Promise<ApiPortForwardStartRuleResponse>;
  stopPortForwardRule: (ruleId: string) => Promise<ApiPortForwardStopRuleResponse>;
  deletePortForwardRule: (ruleId: string) => Promise<{ success: boolean }>;
  createSshSession: (
    payload: ApiSshCreateSessionRequest,
  ) => Promise<ApiSshCreateSessionResponse | ApiSshCreateSessionHostVerificationRequiredResponse>;
  createSftpSession: (
    payload: ApiSftpCreateSessionRequest,
  ) => Promise<ApiSftpCreateSessionResponse | ApiSftpCreateSessionHostVerificationRequiredResponse>;
  listSftpDirectory: (sessionId: string, query?: ApiSftpListDirectoryQuery) => Promise<ApiSftpListDirectoryResponse>;
  getSftpEntryDetails: (sessionId: string, payload: ApiSftpEntryDetailsRequest) => Promise<ApiSftpEntryDetailsResponse>;
  readSftpFile: (sessionId: string, query: ApiSftpReadFileQuery) => Promise<ApiSftpReadFileResponse>;
  writeSftpFile: (sessionId: string, payload: ApiSftpWriteFileRequest) => Promise<ApiSftpWriteFileResponse>;
  downloadSftpFile: (sessionId: string, payload: ApiSftpDownloadFileRequest) => Promise<ApiSftpDownloadFileResponse>;
  uploadSftpFile: (sessionId: string, payload: ApiSftpUploadFileRequest) => Promise<ApiSftpUploadFileResponse>;
  getSftpTransferProgress: (transferId: string) => Promise<ApiSftpTransferProgressResponse>;
  createSftpDirectory: (
    sessionId: string,
    payload: ApiSftpCreateDirectoryRequest,
  ) => Promise<ApiSftpCreateDirectoryResponse>;
  createSftpFile: (sessionId: string, payload: ApiSftpCreateFileRequest) => Promise<ApiSftpCreateFileResponse>;
  renameSftpEntry: (sessionId: string, payload: ApiSftpRenameRequest) => Promise<ApiSftpRenameResponse>;
  copySftpEntry: (sessionId: string, payload: ApiSftpCopyRequest) => Promise<ApiSftpCopyResponse>;
  deleteSftpEntry: (sessionId: string, payload: ApiSftpDeleteRequest) => Promise<ApiSftpDeleteResponse>;
  runSftpBatchOperation: (
    sessionId: string,
    payload: ApiSftpBatchOperationRequest,
  ) => Promise<ApiSftpBatchOperationResponse>;
  trustSshFingerprint: (payload: ApiSshTrustFingerprintRequest) => Promise<ApiSshTrustFingerprintResponse>;
  listLocalTerminalProfiles: () => Promise<LocalTerminalListResponse>;
  createLocalTerminalSession: (
    payload: LocalTerminalCreateSessionRequest,
  ) => Promise<LocalTerminalCreateSessionResponse>;
  closeLocalTerminalSession: (sessionId: string) => Promise<{ success: boolean }>;
  closeSshSession: (sessionId: string) => Promise<{ success: boolean }>;
  closeSftpSession: (sessionId: string) => Promise<{ success: boolean }>;
  deleteSshServer: (serverId: string) => Promise<{ success: boolean }>;
  deleteSshFolder: (folderId: string) => Promise<{ success: boolean }>;
  deleteSshKeychain: (keychainId: string) => Promise<{ success: boolean }>;
};

/**
 * Error thrown when the backend returns a structured API failure envelope.
 */
export class BackendApiError extends Error {
  public readonly code: ApiErrorResponse['code'];

  public readonly requestId: string;

  public readonly timestamp: string;

  /**
   * Creates a renderer error while preserving backend failure metadata.
   *
   * @param payload Backend API error response.
   */
  public constructor(payload: ApiErrorResponse) {
    super(payload.message);
    this.name = 'BackendApiError';
    this.code = payload.code;
    this.requestId = payload.requestId;
    this.timestamp = payload.timestamp;
  }
}

/**
 * Checks whether an unknown value is a structured backend API error.
 *
 * @param error Candidate error thrown by the backend client.
 * @returns Whether the error preserves backend API metadata.
 */
export const isBackendApiError = (error: unknown): error is BackendApiError => {
  return error instanceof BackendApiError;
};

/**
 * Throws a structured API error instead of losing the backend error code.
 *
 * @param payload Backend API error response.
 * @returns Never returns because it always throws.
 */
const throwBackendApiError = (payload: ApiErrorResponse): never => {
  throw new BackendApiError(payload);
};

/**
 * Returns a successful transport response or throws a structured backend error.
 *
 * @param payload Transport response envelope.
 * @returns Successful API response.
 */
const unwrapApiResponse = <TResponse extends { success: true }>(payload: TResponse | ApiErrorResponse): TResponse => {
  if (!payload.success) {
    throwBackendApiError(payload);
  }

  return payload as TResponse;
};

export const createBackendClient = (): BackendClient => {
  const transport = createApiTransport();

  return {
    runtimeTarget: transport.target,
    testPing: async () => {
      const payload = await transport.testPing();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    listAuditEvents: async (query) => {
      const payload = await transport.listAuditEvents(query);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    getAuditEventById: async (eventId) => {
      const payload = await transport.getAuditEventById(eventId);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    getSettings: async () => {
      const payload = await transport.getSettings();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    updateSettings: async (requestPayload) => {
      const payload = await transport.updateSettings(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    listSshServers: async () => {
      const payload = await transport.listSshServers();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    createSshServer: async (requestPayload) => {
      const payload = await transport.createSshServer(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    updateSshServer: async (serverId, requestPayload) => {
      const payload = await transport.updateSshServer(serverId, requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    getSshServerCredentials: async (serverId) => {
      const payload = await transport.getSshServerCredentials(serverId);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    listSshFolders: async () => {
      const payload = await transport.listSshFolders();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    createSshFolder: async (requestPayload) => {
      const payload = await transport.createSshFolder(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    updateSshFolder: async (folderId, requestPayload) => {
      const payload = await transport.updateSshFolder(folderId, requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    listSshTags: async () => {
      const payload = await transport.listSshTags();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    createSshTag: async (requestPayload) => {
      const payload = await transport.createSshTag(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    listSshKeychains: async () => {
      const payload = await transport.listSshKeychains();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    createSshKeychain: async (requestPayload) => {
      const payload = await transport.createSshKeychain(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    updateSshKeychain: async (keychainId, requestPayload) => {
      const payload = await transport.updateSshKeychain(keychainId, requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    getSshKeychainCredentials: async (keychainId) => {
      const payload = await transport.getSshKeychainCredentials(keychainId);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    listPortForwardRules: async () => {
      const payload = await transport.listPortForwardRules();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    createPortForwardRule: async (requestPayload) => {
      const payload = await transport.createPortForwardRule(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    updatePortForwardRule: async (ruleId, requestPayload) => {
      const payload = await transport.updatePortForwardRule(ruleId, requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    startPortForwardRule: async (ruleId, requestPayload) => {
      const payload = await transport.startPortForwardRule(ruleId, requestPayload);

      if (payload.success) {
        return payload;
      }

      if (payload.code === 'SSH_HOST_UNTRUSTED' && 'data' in payload) {
        return payload;
      }

      if (!payload.success) {
        throw new Error(payload.message);
      }

      throw new Error('Unexpected port forwarding start response.');
    },
    stopPortForwardRule: async (ruleId) => {
      const payload = await transport.stopPortForwardRule(ruleId);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    deletePortForwardRule: async (ruleId) => {
      return transport.deletePortForwardRule(ruleId);
    },
    createSshSession: async (requestPayload) => {
      const payload = await transport.createSshSession(requestPayload);

      if (payload.success) {
        return payload;
      }

      if (payload.code === 'SSH_HOST_UNTRUSTED' && 'data' in payload) {
        return payload;
      }

      if (!payload.success) {
        throw new Error(payload.message);
      }

      throw new Error('Unexpected SSH session response.');
    },
    trustSshFingerprint: async (requestPayload) => {
      const payload = await transport.trustSshFingerprint(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    createSftpSession: async (requestPayload) => {
      const payload = await transport.createSftpSession(requestPayload);

      if (payload.success) {
        return payload;
      }

      if (payload.code === 'SSH_HOST_UNTRUSTED' && 'data' in payload) {
        return payload;
      }

      if (!payload.success) {
        throw new Error(payload.message);
      }

      throw new Error('Unexpected SFTP session response.');
    },
    listSftpDirectory: async (sessionId, query) => {
      return unwrapApiResponse(await transport.listSftpDirectory(sessionId, query));
    },
    getSftpEntryDetails: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.getSftpEntryDetails(sessionId, requestPayload));
    },
    readSftpFile: async (sessionId, query) => {
      return unwrapApiResponse(await transport.readSftpFile(sessionId, query));
    },
    writeSftpFile: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.writeSftpFile(sessionId, requestPayload));
    },
    downloadSftpFile: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.downloadSftpFile(sessionId, requestPayload));
    },
    uploadSftpFile: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.uploadSftpFile(sessionId, requestPayload));
    },
    getSftpTransferProgress: async (transferId) => {
      return unwrapApiResponse(await transport.getSftpTransferProgress(transferId));
    },
    createSftpDirectory: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.createSftpDirectory(sessionId, requestPayload));
    },
    createSftpFile: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.createSftpFile(sessionId, requestPayload));
    },
    renameSftpEntry: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.renameSftpEntry(sessionId, requestPayload));
    },
    copySftpEntry: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.copySftpEntry(sessionId, requestPayload));
    },
    deleteSftpEntry: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.deleteSftpEntry(sessionId, requestPayload));
    },
    runSftpBatchOperation: async (sessionId, requestPayload) => {
      return unwrapApiResponse(await transport.runSftpBatchOperation(sessionId, requestPayload));
    },
    listLocalTerminalProfiles: async () => {
      const payload = await transport.listLocalTerminalProfiles();

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    createLocalTerminalSession: async (requestPayload) => {
      const payload = await transport.createLocalTerminalSession(requestPayload);

      if (!payload.success) {
        throw new Error(payload.message);
      }

      return payload;
    },
    closeLocalTerminalSession: async (sessionId) => {
      return transport.closeLocalTerminalSession(sessionId);
    },
    closeSshSession: async (sessionId) => {
      return transport.closeSshSession(sessionId);
    },
    closeSftpSession: async (sessionId) => {
      return transport.closeSftpSession(sessionId);
    },
    deleteSshServer: async (serverId) => {
      return transport.deleteSshServer(serverId);
    },
    deleteSshFolder: async (folderId) => {
      return transport.deleteSshFolder(folderId);
    },
    deleteSshKeychain: async (keychainId) => {
      return transport.deleteSshKeychain(keychainId);
    },
  };
};

export const backendClient = createBackendClient();
