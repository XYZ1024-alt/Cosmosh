import type {
  ApiAuditEventDetailResponse,
  ApiAuditEventListQuery,
  ApiAuditEventListResponse,
  ApiErrorResponse,
  ApiLocalTerminalCreateSessionRequest,
  ApiLocalTerminalCreateSessionResponse,
  ApiLocalTerminalListProfilesResponse,
  ApiSettingsGetResponse,
  ApiSettingsUpdateRequest,
  ApiSettingsUpdateResponse,
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
import { ipcMain } from 'electron';

/**
 * Runtime dependencies required by backend IPC registration.
 */
export type RegisterBackendIpcHandlersOptions = {
  /** Returns active app locale used for backend request headers. */
  getLocale: () => string;
  /** Ensures backend process startup is complete before making transport calls. */
  ensureBackendReady: () => Promise<void>;
  /** Returns backend connection config (port + internal token). */
  requireBackendConfig: () => { port: number; token: string };
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
  /** Returns and clears one-shot launch working directory context. */
  consumePendingLaunchWorkingDirectory: () => string | null;
};

/**
 * Sends an authenticated backend DELETE request and maps HTTP 204 to success flag.
 */
const requestBackendDeleteSuccess = async (
  options: RegisterBackendIpcHandlersOptions,
  path: string,
): Promise<{ success: boolean }> => {
  try {
    await options.ensureBackendReady();
    const { port, token } = options.requireBackendConfig();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'DELETE',
      headers: {
        [API_HEADERS.internalToken]: token,
        [API_HEADERS.locale]: options.getLocale(),
      },
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
 * Replaces one REST-style path token with URL-encoded value.
 *
 * @param templatePath API path containing token such as `{sessionId}`.
 * @param token Token name without braces.
 * @param value Runtime token value.
 * @returns Path with encoded token replacement applied.
 */
const replacePathToken = (templatePath: string, token: string, value: string): string => {
  return templatePath.replace(`{${token}}`, encodeURIComponent(value));
};

/**
 * Appends URL query parameters while skipping undefined/empty values.
 *
 * @param path Path without query string.
 * @param query Query key-value object.
 * @returns Path with encoded query string when parameters exist.
 */
const appendQueryParams = (path: string, query: Record<string, unknown> | undefined): string => {
  if (!query) {
    return path;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const queryString = searchParams.toString();
  return queryString.length > 0 ? `${path}?${queryString}` : path;
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
    const path = replacePathToken(pathTemplate, token, tokenValue);
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
    return options.requestBackend<ApiTestPingResponse>(API_PATHS.testPing, { method: 'GET' });
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
      const path = appendQueryParams(API_PATHS.auditListEvents, query as Record<string, unknown> | undefined);
      return options.requestBackend<ApiAuditEventListResponse>(path, {
        method: 'GET',
      });
    },
  );

  ipcMain.handle(
    'backend:audit-get-event-by-id',
    async (_event, eventId: string): Promise<ApiAuditEventDetailResponse | ApiErrorResponse> => {
      const path = replacePathToken(API_PATHS.auditGetEventById, 'eventId', eventId);
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
      const path = replacePathToken(API_PATHS.sshUpdateServer, 'serverId', serverId);
      return options.requestBackend<ApiSshUpdateServerResponse>(path, {
        method: 'PUT',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-get-server-credentials',
    async (_event, serverId: string): Promise<ApiSshGetServerCredentialsResponse | ApiErrorResponse> => {
      const path = replacePathToken(API_PATHS.sshGetServerCredentials, 'serverId', serverId);
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
      const path = replacePathToken(API_PATHS.sshUpdateFolder, 'folderId', folderId);
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
      const path = replacePathToken(API_PATHS.sshUpdateKeychain, 'keychainId', keychainId);
      return options.requestBackend<ApiSshUpdateKeychainResponse>(path, {
        method: 'PUT',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:ssh-get-keychain-credentials',
    async (_event, keychainId: string): Promise<ApiSshGetKeychainCredentialsResponse | ApiErrorResponse> => {
      const path = replacePathToken(API_PATHS.sshGetKeychainCredentials, 'keychainId', keychainId);
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
      const pathTemplate = replacePathToken(API_PATHS.sftpListDirectory, 'sessionId', sessionId);
      const path = appendQueryParams(pathTemplate, query as Record<string, unknown> | undefined);
      return options.requestBackend<ApiSftpListDirectoryResponse>(path, {
        method: 'GET',
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
      const pathTemplate = replacePathToken(API_PATHS.sftpReadFile, 'sessionId', sessionId);
      const path = appendQueryParams(pathTemplate, query as Record<string, unknown> | undefined);
      return options.requestBackend<ApiSftpReadFileResponse>(path, {
        method: 'GET',
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
      const path = replacePathToken(API_PATHS.sftpCreateDirectory, 'sessionId', sessionId);
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
      const path = replacePathToken(API_PATHS.sftpCreateFile, 'sessionId', sessionId);
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
      const path = replacePathToken(API_PATHS.sftpRenameEntry, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpRenameResponse>(path, {
        method: 'POST',
        body: payload,
      });
    },
  );

  ipcMain.handle(
    'backend:sftp-copy-entry',
    async (_event, sessionId: string, payload: ApiSftpCopyRequest): Promise<ApiSftpCopyResponse | ApiErrorResponse> => {
      const path = replacePathToken(API_PATHS.sftpCopyEntry, 'sessionId', sessionId);
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
      const path = replacePathToken(API_PATHS.sftpDeleteEntry, 'sessionId', sessionId);
      return options.requestBackend<ApiSftpDeleteResponse>(path, {
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
      const path = replacePathToken(API_PATHS.localTerminalCloseSession, 'sessionId', sessionId);
      return requestBackendDeleteSuccess(options, path);
    },
  );
};
