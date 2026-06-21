import type { components, SettingsValues } from '@cosmosh/api-contract';

import { listSshServers } from './backend';
import { getSettingsValuesSnapshot } from './settings-store';

type SshServerListItem = components['schemas']['SshServerListItem'];

/**
 * Resolves whether one server connection inherits the system proxy.
 *
 * @param server Server connection metadata.
 * @param settings Current application settings.
 * @returns Whether Electron system proxy resolution is required.
 */
export const shouldResolveSystemProxy = (
  server: Pick<SshServerListItem, 'proxyMode'>,
  settings: Pick<SettingsValues, 'serverProxyMode'>,
): boolean => {
  const serverMode = server.proxyMode ?? 'default';
  return serverMode === 'default' && settings.serverProxyMode === 'system';
};

/**
 * Resolves Chromium system/PAC proxy rules for one server when required.
 *
 * @param server Server destination and proxy override fields.
 * @returns Proxy resolution string, or undefined when system mode is not effective.
 */
export const resolveSystemProxyRulesForServer = async (
  server: Pick<SshServerListItem, 'host' | 'port' | 'proxyMode'>,
): Promise<string | undefined> => {
  if (!shouldResolveSystemProxy(server, getSettingsValuesSnapshot())) {
    return undefined;
  }

  if (!window.electron?.resolveSystemProxy) {
    throw new Error('System proxy resolution is unavailable.');
  }

  const result = await window.electron.resolveSystemProxy({
    host: server.host,
    port: server.port,
  });
  return result.proxyRules;
};

/**
 * Loads one server and resolves its system/PAC proxy rules when required.
 *
 * @param serverId Server identifier.
 * @returns Proxy resolution string, or undefined when system mode is not effective.
 */
export const resolveSystemProxyRulesForServerId = async (serverId: string): Promise<string | undefined> => {
  const response = await listSshServers();
  const server = response.data.items.find((item) => item.id === serverId);
  if (!server) {
    throw new Error('Selected SSH server no longer exists.');
  }

  return await resolveSystemProxyRulesForServer(server);
};
