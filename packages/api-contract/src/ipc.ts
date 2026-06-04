export const APP_MENU_ACTIONS = [
  'open-about',
  'open-settings',
  'new-tab',
  'close-current-tab',
  'close-right-tabs',
  'show-tab-switcher',
] as const;

export type AppMenuAction = (typeof APP_MENU_ACTIONS)[number];

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
