import type { ApiSftpEntry } from '@cosmosh/api-contract';

const SFTP_PROPERTIES_ROUTE_PARAM = 'sftp-entry-properties';

/**
 * Builds the URL used by the standalone SFTP entry properties window.
 *
 * @param sessionId Active SFTP session id.
 * @param entries Entries whose properties should be shown.
 * @returns Same-origin URL for the properties popup.
 */
export const buildSftpEntryPropertiesWindowUrl = (sessionId: string, entries: ApiSftpEntry[]): string => {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('cosmoshWindow', SFTP_PROPERTIES_ROUTE_PARAM);
  url.searchParams.set('sessionId', sessionId);
  entries.forEach((entry) => {
    url.searchParams.append('path', entry.path);
  });

  if (entries.length === 1) {
    const [entry] = entries;
    url.searchParams.set('name', entry.name);
    url.searchParams.set('type', entry.type);
  }

  return url.toString();
};

/**
 * Detects whether the current renderer document is an SFTP properties popup.
 *
 * @returns Whether the route params request the standalone properties page.
 */
export const isSftpEntryPropertiesWindow = (): boolean => {
  return new URLSearchParams(window.location.search).get('cosmoshWindow') === SFTP_PROPERTIES_ROUTE_PARAM;
};
