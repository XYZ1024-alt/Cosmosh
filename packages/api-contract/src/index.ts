export type { components, operations, paths } from './generated';
export { createApiError, createApiSuccess } from './envelope';
export { appendApiQueryParams, replaceApiPathToken, resolveApiPath } from './http';
export type { ApiPathParams, ApiQueryParams } from './http';
export { APP_MENU_ACTIONS, isAppMenuAction } from './ipc';
export type { AppMenuAction, SftpOpenWithApplication, SftpTemporaryFileWatchChange } from './ipc';
export { API_CAPABILITIES, API_CODES, API_HEADERS, API_PATHS } from './protocol';
export {
  DEFAULT_SETTINGS_VALUES,
  normalizeSettingsValuesStrict,
  normalizeSettingsValuesWithDefaults,
} from './settings';
export type { SettingValidationError } from './settings';
export {
  DEFAULT_SFTP_DIRECTORY_LIST_VIEW_SETTING,
  SFTP_DIRECTORY_LIST_COLUMN_IDS,
  compareSftpEntriesByBrowserOrder,
  compareSftpEntryNames,
  compareSftpNames,
  isSftpDirectoryListColumnId,
  sortSftpEntriesByBrowserOrder,
} from './sftp';
export type {
  SftpDirectoryListColumnId,
  SftpDirectoryListColumnSetting,
  SftpDirectoryListSortDirection,
  SftpDirectoryListSortSetting,
  SftpDirectoryListViewSetting,
  SftpNamedItem,
  SftpSortableEntry,
} from './sftp';
export {
  getVisibleCategories,
  paginateSettingsByCategory,
  resolveCategoryId,
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_IDS,
  SETTINGS_DEFINITION_MAP,
  SETTINGS_REGISTRY,
} from './settings-registry';
export type {
  SettingDefinition,
  SettingKey,
  SettingsCategory,
  SettingsCategoryId,
  SettingsJsonSchemaNode,
  SettingsSection,
  SettingsValues,
} from './settings-registry';

import type { components, paths } from './generated';
import type { SettingsValues } from './settings-registry';

// ── Settings API types ───────────────────────────────────────
// Hand-crafted with strict SettingsValues from the registry.
// The OpenAPI SettingsValues schema is intentionally loose;
// these types provide compile-time safety the generated ones cannot.

type SettingsScope = components['schemas']['SettingsScope'];
export type { SettingsScope };

export interface SettingsResource {
  scope: SettingsScope;
  revision: number;
  updatedAt: string;
  values: SettingsValues;
}

interface ApiSuccessBase {
  success: true;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
}

export type ApiSettingsGetResponse = ApiSuccessBase & {
  data: { item: SettingsResource };
};

export type ApiSettingsUpdateRequest = {
  scope?: SettingsScope;
  values: SettingsValues;
};

export type ApiSettingsUpdateResponse = ApiSuccessBase & {
  data: { item: SettingsResource };
};

// ── Non-settings API types (generated) ───────────────────────

export type ApiErrorResponse = components['schemas']['ApiError'];
export type ApiTestPingResponse = paths['/api/v1/test/ping']['get']['responses']['200']['content']['application/json'];
export type ApiAuditEventListQuery = paths['/api/v1/audit/events']['get']['parameters']['query'];
export type ApiAuditEventListResponse =
  paths['/api/v1/audit/events']['get']['responses']['200']['content']['application/json'];
export type ApiAuditEventDetailResponse =
  paths['/api/v1/audit/events/{eventId}']['get']['responses']['200']['content']['application/json'];
export type ApiSshListServersResponse =
  paths['/api/v1/ssh/servers']['get']['responses']['200']['content']['application/json'];
export type ApiSshCreateServerRequest =
  paths['/api/v1/ssh/servers']['post']['requestBody']['content']['application/json'];
export type ApiSshCreateServerResponse =
  paths['/api/v1/ssh/servers']['post']['responses']['200']['content']['application/json'];
export type ApiSshUpdateServerRequest =
  paths['/api/v1/ssh/servers/{serverId}']['put']['requestBody']['content']['application/json'];
export type ApiSshUpdateServerResponse =
  paths['/api/v1/ssh/servers/{serverId}']['put']['responses']['200']['content']['application/json'];
export type ApiSshGetServerCredentialsResponse =
  paths['/api/v1/ssh/servers/{serverId}/credentials']['get']['responses']['200']['content']['application/json'];
export type ApiSshListKeychainsResponse =
  paths['/api/v1/ssh/keychains']['get']['responses']['200']['content']['application/json'];
export type ApiSshCreateKeychainRequest =
  paths['/api/v1/ssh/keychains']['post']['requestBody']['content']['application/json'];
export type ApiSshCreateKeychainResponse =
  paths['/api/v1/ssh/keychains']['post']['responses']['200']['content']['application/json'];
export type ApiSshUpdateKeychainRequest =
  paths['/api/v1/ssh/keychains/{keychainId}']['put']['requestBody']['content']['application/json'];
export type ApiSshUpdateKeychainResponse =
  paths['/api/v1/ssh/keychains/{keychainId}']['put']['responses']['200']['content']['application/json'];
export type ApiSshGetKeychainCredentialsResponse =
  paths['/api/v1/ssh/keychains/{keychainId}/credentials']['get']['responses']['200']['content']['application/json'];
export type ApiSshListFoldersResponse =
  paths['/api/v1/ssh/folders']['get']['responses']['200']['content']['application/json'];
export type ApiSshCreateFolderRequest =
  paths['/api/v1/ssh/folders']['post']['requestBody']['content']['application/json'];
export type ApiSshCreateFolderResponse =
  paths['/api/v1/ssh/folders']['post']['responses']['200']['content']['application/json'];
export type ApiSshUpdateFolderRequest =
  paths['/api/v1/ssh/folders/{folderId}']['put']['requestBody']['content']['application/json'];
export type ApiSshUpdateFolderResponse =
  paths['/api/v1/ssh/folders/{folderId}']['put']['responses']['200']['content']['application/json'];
export type ApiSshListTagsResponse =
  paths['/api/v1/ssh/tags']['get']['responses']['200']['content']['application/json'];
export type ApiSshCreateTagRequest = paths['/api/v1/ssh/tags']['post']['requestBody']['content']['application/json'];
export type ApiSshCreateTagResponse =
  paths['/api/v1/ssh/tags']['post']['responses']['200']['content']['application/json'];
export type ApiSshCreateSessionRequest =
  paths['/api/v1/ssh/sessions']['post']['requestBody']['content']['application/json'];
export type ApiSshCreateSessionResponse =
  paths['/api/v1/ssh/sessions']['post']['responses']['200']['content']['application/json'];
export type ApiSshCreateSessionHostVerificationRequiredResponse =
  paths['/api/v1/ssh/sessions']['post']['responses']['409']['content']['application/json'];
export type ApiSshTrustFingerprintRequest =
  paths['/api/v1/ssh/trusted-host-keys']['post']['requestBody']['content']['application/json'];
export type ApiSshTrustFingerprintResponse =
  paths['/api/v1/ssh/trusted-host-keys']['post']['responses']['200']['content']['application/json'];
export type ApiSshCloseSessionRequest = paths['/api/v1/ssh/sessions/{sessionId}']['delete']['parameters']['path'];
export type ApiPortForwardListRulesResponse =
  paths['/api/v1/port-forwards/rules']['get']['responses']['200']['content']['application/json'];
export type ApiPortForwardCreateRuleRequest =
  paths['/api/v1/port-forwards/rules']['post']['requestBody']['content']['application/json'];
export type ApiPortForwardCreateRuleResponse =
  paths['/api/v1/port-forwards/rules']['post']['responses']['200']['content']['application/json'];
export type ApiPortForwardUpdateRuleRequest =
  paths['/api/v1/port-forwards/rules/{ruleId}']['put']['requestBody']['content']['application/json'];
export type ApiPortForwardUpdateRuleResponse =
  paths['/api/v1/port-forwards/rules/{ruleId}']['put']['responses']['200']['content']['application/json'];
export type ApiPortForwardStartRuleResponse =
  | paths['/api/v1/port-forwards/rules/{ruleId}/start']['post']['responses']['200']['content']['application/json']
  | paths['/api/v1/port-forwards/rules/{ruleId}/start']['post']['responses']['409']['content']['application/json'];
export type ApiPortForwardStopRuleResponse =
  paths['/api/v1/port-forwards/rules/{ruleId}/stop']['post']['responses']['200']['content']['application/json'];
export type ApiSftpCreateSessionRequest =
  paths['/api/v1/sftp/sessions']['post']['requestBody']['content']['application/json'];
export type ApiSftpCreateSessionResponse =
  paths['/api/v1/sftp/sessions']['post']['responses']['200']['content']['application/json'];
export type ApiSftpCreateSessionHostVerificationRequiredResponse =
  paths['/api/v1/sftp/sessions']['post']['responses']['409']['content']['application/json'];
export type ApiSftpListDirectoryQuery =
  paths['/api/v1/sftp/sessions/{sessionId}/entries']['get']['parameters']['query'];
export type ApiSftpListDirectoryResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/entries']['get']['responses']['200']['content']['application/json'];
export type ApiSftpEntryDetailsRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/entries/details']['post']['requestBody']['content']['application/json'];
export type ApiSftpEntryDetailsResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/entries/details']['post']['responses']['200']['content']['application/json'];
export type ApiSftpReadFileQuery = paths['/api/v1/sftp/sessions/{sessionId}/file']['get']['parameters']['query'];
export type ApiSftpReadFileResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/file']['get']['responses']['200']['content']['application/json'];
export type ApiSftpDownloadFileRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/download']['post']['requestBody']['content']['application/json'];
export type ApiSftpDownloadFileResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/download']['post']['responses']['200']['content']['application/json'];
export type ApiSftpUploadFileRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/upload']['post']['requestBody']['content']['application/json'];
export type ApiSftpUploadFileResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/upload']['post']['responses']['200']['content']['application/json'];
export type ApiSftpCreateDirectoryRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/directories']['post']['requestBody']['content']['application/json'];
export type ApiSftpCreateDirectoryResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/directories']['post']['responses']['200']['content']['application/json'];
export type ApiSftpCreateFileRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/files']['post']['requestBody']['content']['application/json'];
export type ApiSftpCreateFileResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/files']['post']['responses']['200']['content']['application/json'];
export type ApiSftpRenameRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/rename']['post']['requestBody']['content']['application/json'];
export type ApiSftpRenameResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/rename']['post']['responses']['200']['content']['application/json'];
export type ApiSftpCopyRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/copy']['post']['requestBody']['content']['application/json'];
export type ApiSftpCopyResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/copy']['post']['responses']['200']['content']['application/json'];
export type ApiSftpDeleteRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/entries/delete']['post']['requestBody']['content']['application/json'];
export type ApiSftpDeleteResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/entries/delete']['post']['responses']['200']['content']['application/json'];
export type ApiSftpBatchOperationRequest =
  paths['/api/v1/sftp/sessions/{sessionId}/batch']['post']['requestBody']['content']['application/json'];
export type ApiSftpBatchOperationResponse =
  paths['/api/v1/sftp/sessions/{sessionId}/batch']['post']['responses']['200']['content']['application/json'];
export type ApiSftpBatchOperationItem = components['schemas']['SftpBatchOperationItemResult'];
export type ApiSftpCloseSessionRequest = paths['/api/v1/sftp/sessions/{sessionId}']['delete']['parameters']['path'];
export type ApiSftpEntry = components['schemas']['SftpEntry'];
export type ApiSftpEntryDetailsItem = components['schemas']['SftpEntryDetailsItem'];
export type ApiSftpEntryType = components['schemas']['SftpEntryType'];
export type ApiSftpSymlinkTarget = components['schemas']['SftpSymlinkTarget'];
export type ApiLocalTerminalProfile = components['schemas']['LocalTerminalProfile'];
export type ApiLocalTerminalListProfilesResponse =
  paths['/api/v1/local-terminals/profiles']['get']['responses']['200']['content']['application/json'];
export type ApiLocalTerminalCreateSessionRequest =
  paths['/api/v1/local-terminals/sessions']['post']['requestBody']['content']['application/json'];
export type ApiLocalTerminalCreateSessionResponse =
  paths['/api/v1/local-terminals/sessions']['post']['responses']['200']['content']['application/json'];
export type ApiLocalTerminalCloseSessionRequest =
  paths['/api/v1/local-terminals/sessions/{sessionId}']['delete']['parameters']['path'];
