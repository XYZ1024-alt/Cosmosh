import type {
  ApiAuditEventDetailResponse,
  ApiAuditEventListQuery,
  ApiAuditEventListResponse,
  ApiSettingsGetResponse,
  ApiSettingsUpdateRequest,
  ApiSettingsUpdateResponse,
  ApiSftpCreateSessionHostVerificationRequiredResponse,
  ApiSftpCreateSessionRequest,
  ApiSftpCreateSessionResponse,
  ApiSftpListDirectoryQuery,
  ApiSftpListDirectoryResponse,
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

import { backendClient } from './api/client';
import type {
  LocalTerminalCreateSessionRequest,
  LocalTerminalCreateSessionResponse,
  LocalTerminalListResponse,
} from './api/transport';

export const testBackendPing = async (): Promise<ApiTestPingResponse> => {
  return backendClient.testPing();
};

export const listAuditEvents = async (query?: ApiAuditEventListQuery): Promise<ApiAuditEventListResponse> => {
  return backendClient.listAuditEvents(query);
};

export const getAuditEventById = async (eventId: string): Promise<ApiAuditEventDetailResponse> => {
  return backendClient.getAuditEventById(eventId);
};

export const getBackendRuntimeTarget = (): 'electron' | 'browser' => {
  return backendClient.runtimeTarget;
};

export const getAppSettings = async (): Promise<ApiSettingsGetResponse> => {
  return backendClient.getSettings();
};

export const updateAppSettings = async (payload: ApiSettingsUpdateRequest): Promise<ApiSettingsUpdateResponse> => {
  return backendClient.updateSettings(payload);
};

export const listSshServers = async (): Promise<ApiSshListServersResponse> => {
  return backendClient.listSshServers();
};

export const createSshServer = async (payload: ApiSshCreateServerRequest): Promise<ApiSshCreateServerResponse> => {
  return backendClient.createSshServer(payload);
};

export const updateSshServer = async (
  serverId: string,
  payload: ApiSshUpdateServerRequest,
): Promise<ApiSshUpdateServerResponse> => {
  return backendClient.updateSshServer(serverId, payload);
};

export const getSshServerCredentials = async (serverId: string): Promise<ApiSshGetServerCredentialsResponse> => {
  return backendClient.getSshServerCredentials(serverId);
};

export const listSshFolders = async (): Promise<ApiSshListFoldersResponse> => {
  return backendClient.listSshFolders();
};

export const createSshFolder = async (payload: ApiSshCreateFolderRequest): Promise<ApiSshCreateFolderResponse> => {
  return backendClient.createSshFolder(payload);
};

export const updateSshFolder = async (
  folderId: string,
  payload: ApiSshUpdateFolderRequest,
): Promise<ApiSshUpdateFolderResponse> => {
  return backendClient.updateSshFolder(folderId, payload);
};

export const listSshTags = async (): Promise<ApiSshListTagsResponse> => {
  return backendClient.listSshTags();
};

export const createSshTag = async (payload: ApiSshCreateTagRequest): Promise<ApiSshCreateTagResponse> => {
  return backendClient.createSshTag(payload);
};

export const listSshKeychains = async (): Promise<ApiSshListKeychainsResponse> => {
  return backendClient.listSshKeychains();
};

export const createSshKeychain = async (
  payload: ApiSshCreateKeychainRequest,
): Promise<ApiSshCreateKeychainResponse> => {
  return backendClient.createSshKeychain(payload);
};

export const updateSshKeychain = async (
  keychainId: string,
  payload: ApiSshUpdateKeychainRequest,
): Promise<ApiSshUpdateKeychainResponse> => {
  return backendClient.updateSshKeychain(keychainId, payload);
};

export const getSshKeychainCredentials = async (keychainId: string): Promise<ApiSshGetKeychainCredentialsResponse> => {
  return backendClient.getSshKeychainCredentials(keychainId);
};

export const createSshSession = async (
  payload: ApiSshCreateSessionRequest,
): Promise<ApiSshCreateSessionResponse | ApiSshCreateSessionHostVerificationRequiredResponse> => {
  return backendClient.createSshSession(payload);
};

export const trustSshFingerprint = async (
  payload: ApiSshTrustFingerprintRequest,
): Promise<ApiSshTrustFingerprintResponse> => {
  return backendClient.trustSshFingerprint(payload);
};

export const closeSshSession = async (sessionId: string): Promise<{ success: boolean }> => {
  return backendClient.closeSshSession(sessionId);
};

export const createSftpSession = async (
  payload: ApiSftpCreateSessionRequest,
): Promise<ApiSftpCreateSessionResponse | ApiSftpCreateSessionHostVerificationRequiredResponse> => {
  return backendClient.createSftpSession(payload);
};

export const listSftpDirectory = async (
  sessionId: string,
  query?: ApiSftpListDirectoryQuery,
): Promise<ApiSftpListDirectoryResponse> => {
  return backendClient.listSftpDirectory(sessionId, query);
};

export const closeSftpSession = async (sessionId: string): Promise<{ success: boolean }> => {
  return backendClient.closeSftpSession(sessionId);
};

export const listLocalTerminalProfiles = async (): Promise<LocalTerminalListResponse> => {
  return backendClient.listLocalTerminalProfiles();
};

export const createLocalTerminalSession = async (
  payload: LocalTerminalCreateSessionRequest,
): Promise<LocalTerminalCreateSessionResponse> => {
  return backendClient.createLocalTerminalSession(payload);
};

export const closeLocalTerminalSession = async (sessionId: string): Promise<{ success: boolean }> => {
  return backendClient.closeLocalTerminalSession(sessionId);
};

export const deleteSshServer = async (serverId: string): Promise<{ success: boolean }> => {
  return backendClient.deleteSshServer(serverId);
};

export const deleteSshFolder = async (folderId: string): Promise<{ success: boolean }> => {
  return backendClient.deleteSshFolder(folderId);
};

export const deleteSshKeychain = async (keychainId: string): Promise<{ success: boolean }> => {
  return backendClient.deleteSshKeychain(keychainId);
};
