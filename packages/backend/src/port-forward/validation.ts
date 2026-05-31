import type { ApiPortForwardCreateRuleRequest, ApiPortForwardUpdateRuleRequest } from '@cosmosh/api-contract';

import {
  buildValidationError,
  isRecord,
  isValidTcpPort,
  normalizeOptionalString,
  normalizePort,
  type ValidationResult,
} from '../validation-utils.js';

export { isValidTcpPort } from '../validation-utils.js';

export type PortForwardRulePayload = ApiPortForwardCreateRuleRequest | ApiPortForwardUpdateRuleRequest;

const LOCALHOST_BIND_HOST = '127.0.0.1';

/**
 * Checks whether a host field satisfies v1 length constraints.
 *
 * @param value Host string.
 * @returns True when host is usable.
 */
const isValidHost = (value: string | undefined): value is string => {
  return Boolean(value && value.length >= 1 && value.length <= 255);
};

/**
 * Parses create/update rule payloads into a normalized persistence shape.
 *
 * @param payload Unknown route payload.
 * @returns Normalized port-forwarding rule payload or validation error.
 */
export const parsePortForwardRulePayload = (payload: unknown): ValidationResult<PortForwardRulePayload> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const name = normalizeOptionalString(payload.name);
  const serverId = normalizeOptionalString(payload.serverId);
  const type = payload.type;
  const note = normalizeOptionalString(payload.note);

  if (!name || name.length > 120) {
    return {
      error: buildValidationError(
        'errors.validation.portForwardRuleNameLength',
        'Rule name is required and must be 1-120 characters.',
      ),
    };
  }

  if (!serverId) {
    return {
      error: buildValidationError('errors.validation.serverIdRequired', 'serverId is required.'),
    };
  }

  if (type !== 'local' && type !== 'remote' && type !== 'dynamic') {
    return {
      error: buildValidationError(
        'errors.validation.portForwardRuleType',
        'type must be one of: local, remote, dynamic.',
      ),
    };
  }

  if (note && note.length > 3000) {
    return {
      error: buildValidationError('errors.validation.noteLength', 'Note must be 3000 characters or fewer.'),
    };
  }

  const localBindHost = normalizeOptionalString(payload.localBindHost) ?? LOCALHOST_BIND_HOST;
  const localBindPort = normalizePort(payload.localBindPort);
  const remoteBindHost = normalizeOptionalString(payload.remoteBindHost) ?? '127.0.0.1';
  const remoteBindPort = normalizePort(payload.remoteBindPort);
  const targetHost = normalizeOptionalString(payload.targetHost);
  const targetPort = normalizePort(payload.targetPort);

  if (type === 'local' || type === 'dynamic') {
    if (!isValidHost(localBindHost)) {
      return {
        error: buildValidationError('errors.validation.hostLength', 'Host is required and must be 1-255 characters.'),
      };
    }

    if (!isValidTcpPort(localBindPort)) {
      return {
        error: buildValidationError('errors.validation.portRange', 'Port must be an integer in range 1-65535.'),
      };
    }
  }

  if (type === 'remote') {
    if (!isValidHost(remoteBindHost)) {
      return {
        error: buildValidationError('errors.validation.hostLength', 'Host is required and must be 1-255 characters.'),
      };
    }

    if (!isValidTcpPort(remoteBindPort)) {
      return {
        error: buildValidationError('errors.validation.portRange', 'Port must be an integer in range 1-65535.'),
      };
    }
  }

  if (type === 'local' || type === 'remote') {
    if (!isValidHost(targetHost)) {
      return {
        error: buildValidationError('errors.validation.hostLength', 'Host is required and must be 1-255 characters.'),
      };
    }

    if (!isValidTcpPort(targetPort)) {
      return {
        error: buildValidationError('errors.validation.portRange', 'Port must be an integer in range 1-65535.'),
      };
    }
  }

  return {
    value: {
      name,
      serverId,
      type,
      localBindHost: type === 'local' || type === 'dynamic' ? localBindHost : undefined,
      localBindPort: type === 'local' || type === 'dynamic' ? localBindPort : undefined,
      remoteBindHost: type === 'remote' ? remoteBindHost : undefined,
      remoteBindPort: type === 'remote' ? remoteBindPort : undefined,
      targetHost: type === 'local' || type === 'remote' ? targetHost : undefined,
      targetPort: type === 'local' || type === 'remote' ? targetPort : undefined,
      note,
    },
  };
};
