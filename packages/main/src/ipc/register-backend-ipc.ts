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
import { API_PATHS, appendApiQueryParams, replaceApiPathToken } from '@cosmosh/api-contract';
import { ipcMain } from 'electron';

import type { SftpDownloadTargetAuthorizationRegistry } from './sftp-download-target-authorizations';

/**
 * Runtime dependencies required by backend IPC registration.
 */
export type RegisterBackendIpcHandlersOptions = {
  /**
   * Generic backend request adapter used by most channels.
   * Keeps channel implementation focused on route/payload mapping.
   */
  requestBackend: <TSuccess>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT';
      body?: unknown;
    },
  ) => Promise<TSuccess | ApiErrorResponse>;
  /** Generic backend request adapter for status-sensitive calls such as DELETE. */
  requestBackendRaw: (
    path: string,
    options: {
      method: 'DELETE';
    },
  ) => Promise<{ status: number }>;
  /** Returns and clears one-shot launch working directory context. */
  consumePendingLaunchWorkingDirectory: () => string | null;
  /** Validates renderer-owned local paths before proxying SFTP downloads. */
  sftpDownloadTargetAuthorizations: SftpDownloadTargetAuthorizationRegistry;
};

/**
 * Sends an authenticated backend DELETE request and maps HTTP 204 to success flag.
 */
const requestBackendDeleteSuccess = async (
  options: RegisterBackendIpcHandlersOptions,
  path: string,
): Promise<{ success: boolean }> => {
  try {
    const response = await options.requestBackendRaw(path, {
      method: 'DELETE',
    });

    return {
      success: response.status === 204,
    };
  } catch {
    return {
      success: false,
    };
  }
};

/**
 * Registers a DELETE-based backend IPC handler that maps HTTP 204 to success response.
 *
 * @param options Backend runtime dependencies.
 * @param channel IPC channel name.
 * @param pathTemplate API path template containing one route parameter.
 * @param token Path token name in template.
 * @returns void.
 */
const registerDeleteHandler = (
  options: RegisterBackendIpcHandlersOptions,
  channel: string,
  pathTemplate: string,
  token: string,
): void => {
  ipcMain.handle(channel, async (_event, tokenValue: string): Promise<{ success: boolean }> => {
    const path = replaceApiPathToken(pathTemplate, token, tokenValue);
    return requestBackendDeleteSuccess(options, path);
  });
};

/**
 * Registers all backend-related IPC handlers (settings/SSH/local terminal).
 */
export const registerBackendIpcHandlers = (options: RegisterBackendIpcHandlersOptions): void => {
  // Settings, SSH, and local terminal channels share API_PATHS contract from api-contract package.
  registerBackendSshAndSettingsHandlers(options);
  registerBackendLocalTerminalHandlers(options);
};

/**
 * Registers SSH/settings handlers backed by backend HTTP API.
 */
const registerBackendSshAndSettingsHandlers = (options: RegisterBackendIpcHandlersOptions): void => {
  ipcMain.handle('backend:test-ping', async (): Promise<ApiTestPingResponse | ApiErrorResponse> => {
    return options.requestBackend<ApiTestPingResponse>(API_PATHS.testPing, {
      method: 'GET',
    });
  });

  ipcMain.handle('backend:settings-get', async (): Promise<ApiSettingsGetResponse | ApiErrorResponse> => {
    return options.requestBackend<ApiSettingsGetResponse>(API_PATHS.settingsGet, { method: 'GET' });
  });

  ipcMain.handle(
    'backend:settings-update',
    async (_event, payload: ApiSettingsUpdateRequest): Promise<ApiSettingsUpdateResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiSettingsUpdateResponse>(API_PATHS.settingsUpdate, {
        method: 'PUT',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:audit-list-events',
    async (_event, query?: ApiAuditEventListQuery): Promise<ApiAuditEventListResponse | ApiErrorResponse> => {
      const path = appendApiQueryParams(API_PATHS.auditListEvents, query);
      return options.requestBackend<ApiAuditEventListResponse>(path, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle(
    'backend:audit-get-event-by-id',
    async (_event, eventId: string): Promise<ApiAuditEventDetailResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.auditGetEventById, 'eventId', eventId);
      return options.requestBackend<ApiAuditEventDetailResponse>(path, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle('backend:ssh-list-servers', async (): Promise<ApiSshListServersResponse | ApiErrorResponse> => {
    return options.requestBackend<ApiSshListServersResponse>(API_PATHS.sshListServers, { method: 'GET' });
  });

  ipcMain.handle(
    'backend:ssh-create-server',
    async (_event, payload: ApiSshCreateServerRequest): Promise<ApiSshCreateServerResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiSshCreateServerResponse>(API_PATHS.sshCreateServer, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-update-server',
    async (
      _event,
      serverId: string,
      payload: ApiSshUpdateServerRequest,
    ): Promise<ApiSshUpdateServerResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sshUpdateServer, 'serverId', serverId);
      return options.requestBackend<ApiSshUpdateServerResponse>(path, {
        method: 'PUT',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-get-server-credentials',
    async (_event, serverId: string): Promise<ApiSshGetServerCredentialsResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sshGetServerCredentials, 'serverId', serverId);
      return options.requestBackend<ApiSshGetServerCredentialsResponse>(path, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle('backend:ssh-list-folders', async (): Promise<ApiSshListFoldersResponse | ApiErrorResponse> => {
    return options.requestBackend<ApiSshListFoldersResponse>(API_PATHS.sshListFolders, { method: 'GET' });
  });

  ipcMain.handle(
    'backend:ssh-create-folder',
    async (_event, payload: ApiSshCreateFolderRequest): Promise<ApiSshCreateFolderResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiSshCreateFolderResponse>(API_PATHS.sshCreateFolder, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-update-folder',
    async (
      _event,
      folderId: string,
      payload: ApiSshUpdateFolderRequest,
    ): Promise<ApiSshUpdateFolderResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sshUpdateFolder, 'folderId', folderId);
      return options.requestBackend<ApiSshUpdateFolderResponse>(path, {
        method: 'PUT',
        body: payload,
      });
    },
  );

  ipcMain.handle('backend:ssh-list-tags', async (): Promise<ApiSshListTagsResponse | ApiErrorResponse> => {
    return options.requestBackend<ApiSshListTagsResponse>(API_PATHS.sshListTags, { method: 'GET' });
  });

  ipcMain.handle(
    'backend:ssh-create-tag',
    async (_event, payload: ApiSshCreateTagRequest): Promise<ApiSshCreateTagResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiSshCreateTagResponse>(API_PATHS.sshCreateTag, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle('backend:ssh-list-keychains', async (): Promise<ApiSshListKeychainsResponse | ApiErrorResponse> => {
    return options.requestBackend<ApiSshListKeychainsResponse>(API_PATHS.sshListKeychains, { method: 'GET' });
  });

  ipcMain.handle(
    'backend:ssh-create-keychain',
    async (_event, payload: ApiSshCreateKeychainRequest): Promise<ApiSshCreateKeychainResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiSshCreateKeychainResponse>(API_PATHS.sshCreateKeychain, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-update-keychain',
    async (
      _event,
      keychainId: string,
      payload: ApiSshUpdateKeychainRequest,
    ): Promise<ApiSshUpdateKeychainResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sshUpdateKeychain, 'keychainId', keychainId);
      return options.requestBackend<ApiSshUpdateKeychainResponse>(path, {
        method: 'PUT',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-get-keychain-credentials',
    async (_event, keychainId: string): Promise<ApiSshGetKeychainCredentialsResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sshGetKeychainCredentials, 'keychainId', keychainId);
      return options.requestBackend<ApiSshGetKeychainCredentialsResponse>(path, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-create-session',
    async (
      _event,
      payload: ApiSshCreateSessionRequest,
    ): Promise<
      ApiSshCreateSessionResponse | ApiSshCreateSessionHostVerificationRequiredResponse | ApiErrorResponse
    > => {
      return options.requestBackend<ApiSshCreateSessionResponse | ApiSshCreateSessionHostVerificationRequiredResponse>(
        API_PATHS.sshCreateSession,
        {
          method: 'POST',
          body: payload,
        },
      );
    },
  );

  ipcMain.handle(
    'backend:ssh-trust-fingerprint',
    async (
      _event,
      payload: ApiSshTrustFingerprintRequest,
    ): Promise<ApiSshTrustFingerprintResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiSshTrustFingerprintResponse>(API_PATHS.sshTrustFingerprint, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-create-session',
    async (
      _event,
      payload: ApiSftpCreateSessionRequest,
    ): Promise<
      ApiSftpCreateSessionResponse | ApiSftpCreateSessionHostVerificationRequiredResponse | ApiErrorResponse
    > => {
      return options.requestBackend<
        ApiSftpCreateSessionResponse | ApiSftpCreateSessionHostVerificationRequiredResponse
      >(API_PATHS.sftpCreateSession, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-list-directory',
    async (
      _event,
      sessionId: string,
      query?: ApiSftpListDirectoryQuery,
    ): Promise<ApiSftpListDirectoryResponse | ApiErrorResponse> => {
      const pathTemplate = replaceApiPathToken(API_PATHS.sftpListDirectory, 'sessionId', sessionId);
      const path = appendApiQueryParams(pathTemplate, query);
      return options.requestBackend<ApiSftpListDirectoryResponse>(path, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-get-entry-details',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpEntryDetailsRequest,
    ): Promise<ApiSftpEntryDetailsResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpGetEntryDetails, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpEntryDetailsResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-read-file',
    async (
      _event,
      sessionId: string,
      query: ApiSftpReadFileQuery,
    ): Promise<ApiSftpReadFileResponse | ApiErrorResponse> => {
      const pathTemplate = replaceApiPathToken(API_PATHS.sftpReadFile, 'sessionId', sessionId);
      const path = appendApiQueryParams(pathTemplate, query);
      return options.requestBackend<ApiSftpReadFileResponse>(path, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-write-file',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpWriteFileRequest,
    ): Promise<ApiSftpWriteFileResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpWriteFile, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpWriteFileResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-download-file',
    async (
      event,
      sessionId: string,
      payload: ApiSftpDownloadFileRequest,
    ): Promise<ApiSftpDownloadFileResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpDownloadFile, 'sessionId', sessionId);
      const localPath = options.sftpDownloadTargetAuthorizations.consume(event.sender.id, payload.localPath);
      return options.requestBackend<ApiSftpDownloadFileResponse>(path, {
        method: 'POST',
        body: {
          ...payload,
          localPath,
        },
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-upload-file',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpUploadFileRequest,
    ): Promise<ApiSftpUploadFileResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpUploadFile, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpUploadFileResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-create-directory',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpCreateDirectoryRequest,
    ): Promise<ApiSftpCreateDirectoryResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpCreateDirectory, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpCreateDirectoryResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-create-file',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpCreateFileRequest,
    ): Promise<ApiSftpCreateFileResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpCreateFile, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpCreateFileResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-rename-entry',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpRenameRequest,
    ): Promise<ApiSftpRenameResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpRenameEntry, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpRenameResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-copy-entry',
    async (_event, sessionId: string, payload: ApiSftpCopyRequest): Promise<ApiSftpCopyResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpCopyEntry, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpCopyResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-delete-entry',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpDeleteRequest,
    ): Promise<ApiSftpDeleteResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpDeleteEntry, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpDeleteResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-batch-operation',
    async (
      _event,
      sessionId: string,
      payload: ApiSftpBatchOperationRequest,
    ): Promise<ApiSftpBatchOperationResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.sftpBatchOperation, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpBatchOperationResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  registerDeleteHandler(options, 'backend:ssh-close-session', API_PATHS.sshCloseSession, 'sessionId');
  registerDeleteHandler(options, 'backend:sftp-close-session', API_PATHS.sftpCloseSession, 'sessionId');
  registerDeleteHandler(options, 'backend:ssh-delete-server', API_PATHS.sshDeleteServer, 'serverId');
  registerDeleteHandler(options, 'backend:ssh-delete-folder', API_PATHS.sshDeleteFolder, 'folderId');
  registerDeleteHandler(options, 'backend:ssh-delete-keychain', API_PATHS.sshDeleteKeychain, 'keychainId');

  ipcMain.handle(
    'backend:port-forward-list-rules',
    async (): Promise<ApiPortForwardListRulesResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiPortForwardListRulesResponse>(API_PATHS.portForwardListRules, { method: 'GET' });
    },
  );

  ipcMain.handle(
    'backend:port-forward-create-rule',
    async (
      _event,
      payload: ApiPortForwardCreateRuleRequest,
    ): Promise<ApiPortForwardCreateRuleResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiPortForwardCreateRuleResponse>(API_PATHS.portForwardCreateRule, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:port-forward-update-rule',
    async (
      _event,
      ruleId: string,
      payload: ApiPortForwardUpdateRuleRequest,
    ): Promise<ApiPortForwardUpdateRuleResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.portForwardUpdateRule, 'ruleId', ruleId);
      return options.requestBackend<ApiPortForwardUpdateRuleResponse>(path, {
        method: 'PUT',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:port-forward-start-rule',
    async (
      _event,
      ruleId: string,
      payload: ApiPortForwardStartRuleRequest,
    ): Promise<ApiPortForwardStartRuleResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.portForwardStartRule, 'ruleId', ruleId);
      return options.requestBackend<ApiPortForwardStartRuleResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:port-forward-stop-rule',
    async (_event, ruleId: string): Promise<ApiPortForwardStopRuleResponse | ApiErrorResponse> => {
      const path = replaceApiPathToken(API_PATHS.portForwardStopRule, 'ruleId', ruleId);
      return options.requestBackend<ApiPortForwardStopRuleResponse>(path, {
        method: 'POST',
      });
    },
  );

  registerDeleteHandler(options, 'backend:port-forward-delete-rule', API_PATHS.portForwardDeleteRule, 'ruleId');
};

/**
 * Registers local terminal handlers backed by backend HTTP API.
 */
const registerBackendLocalTerminalHandlers = (options: RegisterBackendIpcHandlersOptions): void => {
  ipcMain.handle(
    'backend:local-terminal-list-profiles',
    async (): Promise<ApiLocalTerminalListProfilesResponse | ApiErrorResponse> => {
      return options.requestBackend<ApiLocalTerminalListProfilesResponse>(API_PATHS.localTerminalListProfiles, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle(
    'backend:local-terminal-create-session',
    async (
      _event,
      payload: ApiLocalTerminalCreateSessionRequest,
    ): Promise<ApiLocalTerminalCreateSessionResponse | ApiErrorResponse> => {
      const launchWorkingDirectory = options.consumePendingLaunchWorkingDirectory();
      return options.requestBackend<ApiLocalTerminalCreateSessionResponse>(API_PATHS.localTerminalCreateSession, {
        method: 'POST',
        body: {
          ...payload,
          ...(launchWorkingDirectory ? { cwd: launchWorkingDirectory } : {}),
        },
      });
    },
  );

  ipcMain.handle(
    'backend:local-terminal-close-session',
    async (_event, sessionId: string): Promise<{ success: boolean }> => {
      const path = replaceApiPathToken(API_PATHS.localTerminalCloseSession, 'sessionId', sessionId);
      return requestBackendDeleteSuccess(options, path);
    },
  );
};
