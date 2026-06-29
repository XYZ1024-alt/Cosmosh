import type { components } from '@cosmosh/api-contract';

import { t } from './i18n';

type PortForwardRuleListItem = components['schemas']['PortForwardRuleListItem'];

/**
 * Builds the listen endpoint shown for a forwarding rule.
 *
 * @param rule Persisted rule plus runtime state.
 * @returns Human-readable bind endpoint.
 */
export const formatPortForwardBindEndpoint = (rule: PortForwardRuleListItem): string => {
  if (rule.type === 'remote') {
    return `${rule.remoteBindHost ?? '127.0.0.1'}:${rule.remoteBindPort ?? '-'}`;
  }

  return `${rule.localBindHost ?? '127.0.0.1'}:${rule.localBindPort ?? '-'}`;
};

/**
 * Builds the target endpoint shown for a forwarding rule.
 *
 * @param rule Persisted rule plus runtime state.
 * @returns Human-readable target endpoint.
 */
export const formatPortForwardTargetEndpoint = (rule: PortForwardRuleListItem): string => {
  if (rule.type === 'dynamic') {
    return t('home.portForwardingSocksTarget');
  }

  return `${rule.targetHost ?? '-'}:${rule.targetPort ?? '-'}`;
};

/**
 * Builds a clipboard-friendly endpoint for a forwarding rule.
 *
 * @param rule Persisted rule plus runtime state.
 * @returns Endpoint text copied by the row action.
 */
export const formatPortForwardCopyEndpoint = (rule: PortForwardRuleListItem): string => {
  if (rule.type === 'dynamic') {
    return `socks5://${rule.localBindHost ?? '127.0.0.1'}:${rule.localBindPort ?? ''}`;
  }

  return `${formatPortForwardBindEndpoint(rule)} -> ${formatPortForwardTargetEndpoint(rule)}`;
};
