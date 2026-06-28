export const APP_MENU_ACTIONS = [
  'open-about',
  'open-settings',
  'new-tab',
  'close-current-tab',
  'close-right-tabs',
  'show-tab-switcher',
] as const;

export type AppMenuAction = (typeof APP_MENU_ACTIONS)[number];

export type SystemProxyResolveRequest = {
  host: string;
  port: number;
};

export type SystemProxyResolveResult = {
  proxyRules: string;
};

const APP_MENU_ACTION_SET: ReadonlySet<string> = new Set(APP_MENU_ACTIONS);

/**
 * Checks whether an IPC payload is a supported app menu action.
 *
 * @param value Unknown IPC payload.
 * @returns True when the payload matches a known app menu action.
 */
export const isAppMenuAction = (value: unknown): value is AppMenuAction => {
  return typeof value === 'string' && APP_MENU_ACTION_SET.has(value);
};

export type SftpOpenWithApplication = {
  id: string;
  name: string;
  path: string;
  bundleIdentifier?: string;
  iconDataUrl?: string;
};

export type SftpTemporaryFileWatchChange = {
  watchId: string;
  localPath: string;
  size: number;
  modifiedAt: string;
};

/**
 * One user-selected local file staged under the Cosmosh-controlled SFTP temp root.
 */
export type SftpUploadLocalFile = {
  name: string;
  localPath: string;
  size: number;
  modifiedAt: string;
};

/**
 * Result returned by the native SFTP upload file picker.
 */
export type SftpUploadFileSelection = {
  canceled: boolean;
  files: SftpUploadLocalFile[];
};

/** HTTP methods mirrored by the development backend request trace store. */
export type BackendRequestTraceMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Body representation categories used by the request trace DevTools panel. */
export type BackendRequestTraceBodyKind = 'empty' | 'json' | 'text';

/** Bounded, sanitized request or response body captured for development diagnostics. */
export type BackendRequestTraceBody = {
  kind: BackendRequestTraceBodyKind;
  sizeBytes: number;
  truncated: boolean;
  value: unknown;
};

/** Sanitized mirror of one completed main-process backend proxy request. */
export type BackendRequestTrace = {
  id: string;
  startedAt: string;
  completedAt: string;
  method: BackendRequestTraceMethod;
  path: string;
  status: number | null;
  ok: boolean | null;
  durationMs: number;
  requestBody: BackendRequestTraceBody;
  responseBody: BackendRequestTraceBody;
  requestId?: string;
  error?: string;
  truncated: boolean;
};
