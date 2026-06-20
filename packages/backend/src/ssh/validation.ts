import type {
  ApiSshCreateFolderRequest,
  ApiSshCreateServerRequest,
  ApiSshCreateSessionRequest,
  ApiSshCreateTagRequest,
  ApiSshTrustFingerprintRequest,
  ApiSshUpdateFolderRequest,
  ApiSshUpdateServerRequest,
} from '@cosmosh/api-contract';
import {
  DEFAULT_TERMINAL_CLIPBOARD_ACCESS,
  isTerminalClipboardAccess,
  type TerminalClipboardAccess,
} from '@cosmosh/api-contract';
import type { SshAuthType } from '@prisma/client';

import {
  buildValidationError,
  isRecord,
  isValidTcpPort as isValidPort,
  normalizeOptionalBoolean,
  normalizeOptionalString,
  normalizeOptionalUniqueStringIds as toOptionalUniqueIds,
  normalizeUniqueStringIds as toUniqueIds,
  type ValidationResult,
} from '../validation-utils.js';

type SshVisualColorKey =
  | 'slate'
  | 'blue'
  | 'emerald'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'cyan'
  | 'indigo'
  | 'teal'
  | 'lime';

const SSH_VISUAL_COLOR_KEY_SET: ReadonlySet<SshVisualColorKey> = new Set([
  'slate',
  'blue',
  'emerald',
  'violet',
  'amber',
  'rose',
  'cyan',
  'indigo',
  'teal',
  'lime',
]);

const normalizeOptionalIconKey = (value: unknown): string | undefined => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 64) {
    return undefined;
  }

  return normalized;
};

const normalizeOptionalColorKey = (value: unknown): SshVisualColorKey | undefined => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  return SSH_VISUAL_COLOR_KEY_SET.has(normalized as SshVisualColorKey) ? (normalized as SshVisualColorKey) : undefined;
};

const isSshAuthType = (value: unknown): value is SshAuthType => {
  return value === 'password' || value === 'key' || value === 'both';
};

/**
 * Normalizes optional terminal OSC 52 clipboard access values.
 *
 * @param value Raw request value.
 * @returns Supported access mode or undefined when omitted/invalid.
 */
const normalizeOptionalTerminalClipboardAccess = (value: unknown): TerminalClipboardAccess | undefined => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  return isTerminalClipboardAccess(normalized) ? normalized : undefined;
};

/**
 * Parses and validates SSH folder creation payload.
 */
export const parseCreateFolderRequest = (payload: unknown): ValidationResult<ApiSshCreateFolderRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const name = normalizeOptionalString(payload.name);
  if (!name || name.length > 120) {
    return {
      error: buildValidationError(
        'errors.validation.folderNameLength',
        'Folder name is required and must be 1-120 characters.',
      ),
    };
  }

  const note = normalizeOptionalString(payload.note);
  if (note && note.length > 1000) {
    return {
      error: buildValidationError(
        'errors.validation.folderNoteLength',
        'Folder note must be 1000 characters or fewer.',
      ),
    };
  }

  const iconKey = normalizeOptionalIconKey(payload.iconKey);
  if (payload.iconKey !== undefined && !iconKey) {
    return {
      error: buildValidationError(
        'errors.validation.iconKeyLength',
        'Icon key must be between 1 and 64 characters when provided.',
      ),
    };
  }

  const colorKey = normalizeOptionalColorKey(payload.colorKey);
  if (payload.colorKey !== undefined && !colorKey) {
    return {
      error: buildValidationError(
        'errors.validation.colorKeyInvalid',
        'Color key must be one of the predefined SSH visual colors when provided.',
      ),
    };
  }

  return {
    value: {
      name,
      iconKey,
      colorKey,
      note,
    },
  };
};

/**
 * Parses and validates SSH tag creation payload.
 */
export const parseCreateTagRequest = (payload: unknown): ValidationResult<ApiSshCreateTagRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const name = normalizeOptionalString(payload.name);
  if (!name || name.length > 64) {
    return {
      error: buildValidationError(
        'errors.validation.tagNameLength',
        'Tag name is required and must be 1-64 characters.',
      ),
    };
  }

  return { value: { name } };
};

/**
 * Parses and validates SSH folder update payload.
 */
export const parseUpdateFolderRequest = (payload: unknown): ValidationResult<ApiSshUpdateFolderRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const name = normalizeOptionalString(payload.name);
  if (!name || name.length > 120) {
    return {
      error: buildValidationError(
        'errors.validation.folderNameLength',
        'Folder name is required and must be 1-120 characters.',
      ),
    };
  }

  const note = normalizeOptionalString(payload.note);
  if (note && note.length > 1000) {
    return {
      error: buildValidationError(
        'errors.validation.folderNoteLength',
        'Folder note must be 1000 characters or fewer.',
      ),
    };
  }

  const iconKey = normalizeOptionalIconKey(payload.iconKey);
  if (payload.iconKey !== undefined && !iconKey) {
    return {
      error: buildValidationError(
        'errors.validation.iconKeyLength',
        'Icon key must be between 1 and 64 characters when provided.',
      ),
    };
  }

  const colorKey = normalizeOptionalColorKey(payload.colorKey);
  if (payload.colorKey !== undefined && !colorKey) {
    return {
      error: buildValidationError(
        'errors.validation.colorKeyInvalid',
        'Color key must be one of the predefined SSH visual colors when provided.',
      ),
    };
  }

  return {
    value: {
      name,
      iconKey,
      colorKey,
      note,
    },
  };
};

/**
 * Parses and validates SSH server creation payload.
 */
export const parseCreateServerRequest = (payload: unknown): ValidationResult<ApiSshCreateServerRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const name = normalizeOptionalString(payload.name);
  const host = normalizeOptionalString(payload.host);
  const username = normalizeOptionalString(payload.username);
  const authType = payload.authType;
  const keychainId = normalizeOptionalString(payload.keychainId);
  const port = typeof payload.port === 'number' ? payload.port : Number(payload.port);

  if (!name || name.length > 120) {
    return {
      error: buildValidationError(
        'errors.validation.serverNameLength',
        'Server name is required and must be 1-120 characters.',
      ),
    };
  }

  if (!host || host.length > 255) {
    return {
      error: buildValidationError('errors.validation.hostLength', 'Host is required and must be 1-255 characters.'),
    };
  }

  if (!username || username.length > 120) {
    return {
      error: buildValidationError(
        'errors.validation.usernameLength',
        'Username is required and must be 1-120 characters.',
      ),
    };
  }

  if (!isValidPort(port)) {
    return {
      error: buildValidationError('errors.validation.portRange', 'Port must be an integer in range 1-65535.'),
    };
  }

  if (!keychainId && !isSshAuthType(authType)) {
    return {
      error: buildValidationError('errors.validation.authTypeEnum', 'Auth type must be one of: password, key, both.'),
    };
  }

  const password = normalizeOptionalString(payload.password);
  const privateKey = normalizeOptionalString(payload.privateKey);
  const privateKeyPassphrase = normalizeOptionalString(payload.privateKeyPassphrase);
  const strictHostKey = normalizeOptionalBoolean(payload.strictHostKey);
  const enableSshCompression = normalizeOptionalBoolean(payload.enableSshCompression);
  const remoteEnhancementsEnabled = normalizeOptionalBoolean(payload.remoteEnhancementsEnabled);
  const disableCharacterWidthCompatibilityMode = normalizeOptionalBoolean(
    payload.disableCharacterWidthCompatibilityMode,
  );
  const terminalClipboardAccess = normalizeOptionalTerminalClipboardAccess(payload.terminalClipboardAccess);

  if (payload.strictHostKey !== undefined && strictHostKey === undefined) {
    return {
      error: buildValidationError('errors.validation.strictHostKeyType', 'strictHostKey must be a boolean value.'),
    };
  }

  if (payload.enableSshCompression !== undefined && enableSshCompression === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.enableSshCompressionType',
        'enableSshCompression must be a boolean value.',
      ),
    };
  }

  if (payload.remoteEnhancementsEnabled !== undefined && remoteEnhancementsEnabled === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.remoteEnhancementsEnabledType',
        'remoteEnhancementsEnabled must be a boolean value.',
      ),
    };
  }

  if (
    payload.disableCharacterWidthCompatibilityMode !== undefined &&
    disableCharacterWidthCompatibilityMode === undefined
  ) {
    return {
      error: buildValidationError(
        'errors.validation.disableCharacterWidthCompatibilityModeType',
        'disableCharacterWidthCompatibilityMode must be a boolean value.',
      ),
    };
  }

  if (payload.terminalClipboardAccess !== undefined && terminalClipboardAccess === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.terminalClipboardAccessEnum',
        'terminalClipboardAccess must be one of: off, writeAskRead, readWrite, askAlways.',
      ),
    };
  }

  const folderId = normalizeOptionalString(payload.folderId);
  const note = normalizeOptionalString(payload.note);
  const iconKey = normalizeOptionalIconKey(payload.iconKey);
  const colorKey = normalizeOptionalColorKey(payload.colorKey);

  if (payload.iconKey !== undefined && !iconKey) {
    return {
      error: buildValidationError(
        'errors.validation.iconKeyLength',
        'Icon key must be between 1 and 64 characters when provided.',
      ),
    };
  }

  if (payload.colorKey !== undefined && !colorKey) {
    return {
      error: buildValidationError(
        'errors.validation.colorKeyInvalid',
        'Color key must be one of the predefined SSH visual colors when provided.',
      ),
    };
  }

  if (note && note.length > 3000) {
    return {
      error: buildValidationError('errors.validation.noteLength', 'Note must be 3000 characters or fewer.'),
    };
  }

  const normalizedAuthType = keychainId ? undefined : (authType as SshAuthType);

  return {
    value: {
      name,
      host,
      port,
      username,
      authType: normalizedAuthType,
      keychainId,
      password,
      privateKey,
      privateKeyPassphrase,
      strictHostKey: strictHostKey ?? true,
      enableSshCompression: enableSshCompression ?? false,
      remoteEnhancementsEnabled: remoteEnhancementsEnabled ?? true,
      disableCharacterWidthCompatibilityMode: disableCharacterWidthCompatibilityMode ?? false,
      terminalClipboardAccess: terminalClipboardAccess ?? DEFAULT_TERMINAL_CLIPBOARD_ACCESS,
      folderId,
      iconKey,
      colorKey,
      tagIds: toUniqueIds(payload.tagIds),
      note,
    },
  };
};

/**
 * Parses and validates SSH server update payload.
 */
export const parseUpdateServerRequest = (payload: unknown): ValidationResult<ApiSshUpdateServerRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const name = normalizeOptionalString(payload.name);
  const host = normalizeOptionalString(payload.host);
  const username = normalizeOptionalString(payload.username);
  const authType = payload.authType;
  const keychainId = normalizeOptionalString(payload.keychainId);
  const port = typeof payload.port === 'number' ? payload.port : Number(payload.port);

  if (!name || name.length > 120) {
    return {
      error: buildValidationError(
        'errors.validation.serverNameLength',
        'Server name is required and must be 1-120 characters.',
      ),
    };
  }

  if (!host || host.length > 255) {
    return {
      error: buildValidationError('errors.validation.hostLength', 'Host is required and must be 1-255 characters.'),
    };
  }

  if (!username || username.length > 120) {
    return {
      error: buildValidationError(
        'errors.validation.usernameLength',
        'Username is required and must be 1-120 characters.',
      ),
    };
  }

  if (!isValidPort(port)) {
    return {
      error: buildValidationError('errors.validation.portRange', 'Port must be an integer in range 1-65535.'),
    };
  }

  if (!keychainId && !isSshAuthType(authType)) {
    return {
      error: buildValidationError('errors.validation.authTypeEnum', 'Auth type must be one of: password, key, both.'),
    };
  }

  const password = normalizeOptionalString(payload.password);
  const privateKey = normalizeOptionalString(payload.privateKey);
  const privateKeyPassphrase = normalizeOptionalString(payload.privateKeyPassphrase);
  const strictHostKey = normalizeOptionalBoolean(payload.strictHostKey);
  const enableSshCompression = normalizeOptionalBoolean(payload.enableSshCompression);
  const remoteEnhancementsEnabled = normalizeOptionalBoolean(payload.remoteEnhancementsEnabled);
  const disableCharacterWidthCompatibilityMode = normalizeOptionalBoolean(
    payload.disableCharacterWidthCompatibilityMode,
  );
  const terminalClipboardAccess = normalizeOptionalTerminalClipboardAccess(payload.terminalClipboardAccess);

  if (payload.strictHostKey !== undefined && strictHostKey === undefined) {
    return {
      error: buildValidationError('errors.validation.strictHostKeyType', 'strictHostKey must be a boolean value.'),
    };
  }

  if (payload.enableSshCompression !== undefined && enableSshCompression === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.enableSshCompressionType',
        'enableSshCompression must be a boolean value.',
      ),
    };
  }

  if (payload.remoteEnhancementsEnabled !== undefined && remoteEnhancementsEnabled === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.remoteEnhancementsEnabledType',
        'remoteEnhancementsEnabled must be a boolean value.',
      ),
    };
  }

  if (
    payload.disableCharacterWidthCompatibilityMode !== undefined &&
    disableCharacterWidthCompatibilityMode === undefined
  ) {
    return {
      error: buildValidationError(
        'errors.validation.disableCharacterWidthCompatibilityModeType',
        'disableCharacterWidthCompatibilityMode must be a boolean value.',
      ),
    };
  }

  if (payload.terminalClipboardAccess !== undefined && terminalClipboardAccess === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.terminalClipboardAccessEnum',
        'terminalClipboardAccess must be one of: off, writeAskRead, readWrite, askAlways.',
      ),
    };
  }
  const folderId = normalizeOptionalString(payload.folderId);
  const note = normalizeOptionalString(payload.note);
  const iconKey = normalizeOptionalIconKey(payload.iconKey);
  const colorKey = normalizeOptionalColorKey(payload.colorKey);

  if (payload.iconKey !== undefined && !iconKey) {
    return {
      error: buildValidationError(
        'errors.validation.iconKeyLength',
        'Icon key must be between 1 and 64 characters when provided.',
      ),
    };
  }

  if (payload.colorKey !== undefined && !colorKey) {
    return {
      error: buildValidationError(
        'errors.validation.colorKeyInvalid',
        'Color key must be one of the predefined SSH visual colors when provided.',
      ),
    };
  }

  if (note && note.length > 3000) {
    return {
      error: buildValidationError('errors.validation.noteLength', 'Note must be 3000 characters or fewer.'),
    };
  }

  const normalizedAuthType = keychainId ? undefined : (authType as SshAuthType);

  return {
    value: {
      name,
      host,
      port,
      username,
      authType: normalizedAuthType,
      keychainId,
      password,
      privateKey,
      privateKeyPassphrase,
      strictHostKey,
      enableSshCompression,
      remoteEnhancementsEnabled,
      disableCharacterWidthCompatibilityMode,
      terminalClipboardAccess,
      folderId,
      iconKey,
      colorKey,
      tagIds: toOptionalUniqueIds(payload.tagIds),
      note,
    },
  };
};

/**
 * Parses and validates SSH session creation payload.
 */
export const parseCreateSessionRequest = (payload: unknown): ValidationResult<ApiSshCreateSessionRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const serverId = normalizeOptionalString(payload.serverId);
  if (!serverId) {
    return {
      error: buildValidationError('errors.validation.serverIdRequired', 'serverId is required.'),
    };
  }

  const cols = typeof payload.cols === 'number' ? payload.cols : Number(payload.cols ?? 120);
  const rows = typeof payload.rows === 'number' ? payload.rows : Number(payload.rows ?? 32);
  const term = normalizeOptionalString(payload.term) ?? 'xterm-256color';
  const connectTimeoutSec =
    typeof payload.connectTimeoutSec === 'number' ? payload.connectTimeoutSec : Number(payload.connectTimeoutSec ?? 45);
  const strictHostKey = normalizeOptionalBoolean(payload.strictHostKey);
  const enableSshCompression = normalizeOptionalBoolean(payload.enableSshCompression);
  const remoteEnhancementsEnabled = normalizeOptionalBoolean(payload.remoteEnhancementsEnabled);

  if (payload.strictHostKey !== undefined && strictHostKey === undefined) {
    return {
      error: buildValidationError('errors.validation.strictHostKeyType', 'strictHostKey must be a boolean value.'),
    };
  }

  if (payload.enableSshCompression !== undefined && enableSshCompression === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.enableSshCompressionType',
        'enableSshCompression must be a boolean value.',
      ),
    };
  }

  if (payload.remoteEnhancementsEnabled !== undefined && remoteEnhancementsEnabled === undefined) {
    return {
      error: buildValidationError(
        'errors.validation.remoteEnhancementsEnabledType',
        'remoteEnhancementsEnabled must be a boolean value.',
      ),
    };
  }

  if (!Number.isInteger(cols) || cols < 20 || cols > 400) {
    return {
      error: buildValidationError('errors.validation.colsRange', 'cols must be an integer between 20 and 400.'),
    };
  }

  if (!Number.isInteger(rows) || rows < 10 || rows > 200) {
    return {
      error: buildValidationError('errors.validation.rowsRange', 'rows must be an integer between 10 and 200.'),
    };
  }

  if (term.length < 2 || term.length > 64) {
    return {
      error: buildValidationError('errors.validation.termLength', 'term must be a string between 2 and 64 characters.'),
    };
  }

  if (!Number.isInteger(connectTimeoutSec) || connectTimeoutSec < 5 || connectTimeoutSec > 180) {
    return {
      error: buildValidationError(
        'errors.validation.connectTimeoutRange',
        'connectTimeoutSec must be an integer between 5 and 180.',
      ),
    };
  }

  return {
    value: {
      serverId,
      cols,
      rows,
      term,
      connectTimeoutSec,
      strictHostKey,
      enableSshCompression,
      remoteEnhancementsEnabled,
    },
  };
};

/**
 * Parses and validates trusted host fingerprint request payload.
 */
export const parseTrustFingerprintRequest = (payload: unknown): ValidationResult<ApiSshTrustFingerprintRequest> => {
  if (!isRecord(payload)) {
    return {
      error: buildValidationError('errors.validation.requestBodyMustBeObject', 'Request body must be a JSON object.'),
    };
  }

  const serverId = normalizeOptionalString(payload.serverId);
  const fingerprintSha256 = normalizeOptionalString(payload.fingerprintSha256);
  const algorithm = normalizeOptionalString(payload.algorithm) ?? 'sha256';

  if (!serverId) {
    return {
      error: buildValidationError('errors.validation.serverIdRequired', 'serverId is required.'),
    };
  }

  if (!fingerprintSha256 || fingerprintSha256.length > 255) {
    return {
      error: buildValidationError(
        'errors.validation.fingerprintLength',
        'fingerprintSha256 is required and must be 1-255 characters.',
      ),
    };
  }

  if (algorithm.length < 1 || algorithm.length > 64) {
    return {
      error: buildValidationError('errors.validation.algorithmLength', 'algorithm must be 1-64 characters.'),
    };
  }

  if (algorithm !== 'sha256') {
    return {
      error: buildValidationError(
        'errors.validation.fingerprintAlgorithmUnsupported',
        'Only sha256 host fingerprint algorithm is supported.',
      ),
    };
  }

  return {
    value: {
      serverId,
      fingerprintSha256,
      algorithm,
    },
  };
};
