export const GLOBAL_SERVER_PROXY_MODES = ['off', 'system', 'custom'] as const;
export const SSH_SERVER_PROXY_MODES = ['default', 'off', 'custom'] as const;
export const SUPPORTED_PROXY_PROTOCOLS = ['http:', 'https:', 'socks5:'] as const;
export const MAX_PROXY_URL_LENGTH = 2048;
export const MAX_SYSTEM_PROXY_RULES_LENGTH = 4096;

export type GlobalServerProxyMode = (typeof GLOBAL_SERVER_PROXY_MODES)[number];
export type SshServerProxyMode = (typeof SSH_SERVER_PROXY_MODES)[number];
export type SupportedProxyProtocol = (typeof SUPPORTED_PROXY_PROTOCOLS)[number];

const GLOBAL_SERVER_PROXY_MODE_SET: ReadonlySet<string> = new Set(GLOBAL_SERVER_PROXY_MODES);
const SSH_SERVER_PROXY_MODE_SET: ReadonlySet<string> = new Set(SSH_SERVER_PROXY_MODES);
const SUPPORTED_PROXY_PROTOCOL_SET: ReadonlySet<string> = new Set(SUPPORTED_PROXY_PROTOCOLS);

export type ProxyUrlValidationResult =
  | {
      valid: true;
      normalizedUrl: string;
    }
  | {
      valid: false;
      reason: 'required' | 'too-long' | 'invalid-url' | 'unsupported-protocol' | 'invalid-path';
    };

/**
 * Checks whether a value is a supported global server proxy mode.
 *
 * @param value Candidate mode.
 * @returns Whether the candidate is supported.
 */
export const isGlobalServerProxyMode = (value: unknown): value is GlobalServerProxyMode => {
  return typeof value === 'string' && GLOBAL_SERVER_PROXY_MODE_SET.has(value);
};

/**
 * Checks whether a value is a supported per-server proxy mode.
 *
 * @param value Candidate mode.
 * @returns Whether the candidate is supported.
 */
export const isSshServerProxyMode = (value: unknown): value is SshServerProxyMode => {
  return typeof value === 'string' && SSH_SERVER_PROXY_MODE_SET.has(value);
};

/**
 * Validates and normalizes a custom proxy URL shared by settings and server APIs.
 *
 * @param value Candidate proxy URL.
 * @returns Validation result with a canonical URL when valid.
 */
export const validateProxyUrl = (value: unknown): ProxyUrlValidationResult => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { valid: false, reason: 'required' };
  }

  const normalizedInput = value.trim();
  if (normalizedInput.length > MAX_PROXY_URL_LENGTH) {
    return { valid: false, reason: 'too-long' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    return { valid: false, reason: 'invalid-url' };
  }

  if (!SUPPORTED_PROXY_PROTOCOL_SET.has(parsed.protocol)) {
    return { valid: false, reason: 'unsupported-protocol' };
  }

  if (
    !parsed.hostname ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (parsed.pathname.length > 0 && parsed.pathname !== '/')
  ) {
    return { valid: false, reason: 'invalid-path' };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
};
