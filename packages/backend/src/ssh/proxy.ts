import net from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';

import {
  type GlobalServerProxyMode,
  type SshServerProxyMode,
  type SupportedProxyProtocol,
  validateProxyUrl,
} from '@cosmosh/api-contract';
import type { PrismaClient } from '@prisma/client';
import { SocksClient } from 'socks';

import { parseStoredSettingsValues } from '../settings/validation.js';

type ProxyAwareServer = {
  host: string;
  port: number;
  proxyMode: SshServerProxyMode;
  proxyUrl: string | null;
};

type ProxyCandidate =
  | {
      type: 'direct';
    }
  | {
      type: 'http';
      host: string;
      port: number;
      username?: string;
      password?: string;
    }
  | {
      type: 'https';
      host: string;
      port: number;
      username?: string;
      password?: string;
    }
  | {
      type: 'socks5';
      host: string;
      port: number;
      username?: string;
      password?: string;
    };

export type SshProxyMetadata = {
  mode: 'off' | 'system' | 'custom';
  protocol: 'unknown' | 'direct' | 'http' | 'https' | 'socks5';
};

export type PreparedSshProxyTransport = {
  socket?: Duplex;
  readyTimeoutMs: number;
  metadata: SshProxyMetadata;
};

export type EffectiveProxyPolicy = {
  mode: 'off' | 'system' | 'custom';
  proxyUrl?: string;
};

const DEFAULT_PROXY_PORTS: Readonly<Record<SupportedProxyProtocol, number>> = {
  'http:': 80,
  'https:': 443,
  'socks5:': 1080,
};
const HTTP_PROXY_HEADER_LIMIT_BYTES = 32 * 1024;

/**
 * Proxy failure that carries credential-safe connection metadata for auditing.
 */
export class SshProxyConnectionError extends Error {
  public readonly metadata: SshProxyMetadata;

  /**
   * Creates a proxy connection error.
   *
   * @param message Credential-safe failure message.
   * @param metadata Effective mode and attempted protocol.
   */
  public constructor(message: string, metadata: SshProxyMetadata) {
    super(message);
    this.name = 'SshProxyConnectionError';
    this.metadata = metadata;
  }
}

/**
 * Removes URL-only brackets from an IPv6 hostname before socket connection.
 *
 * @param hostname URL hostname value.
 * @returns Socket-compatible hostname.
 */
const normalizeUrlHostname = (hostname: string): string => {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
};

/**
 * Applies per-server proxy precedence over global settings.
 *
 * @param serverMode Persisted server override mode.
 * @param serverProxyUrl Persisted server custom proxy URL.
 * @param globalMode Persisted global proxy mode.
 * @param globalProxyUrl Persisted global custom proxy URL.
 * @returns Effective connection policy.
 */
export const resolveEffectiveProxyPolicy = (
  serverMode: SshServerProxyMode,
  serverProxyUrl: string | null,
  globalMode: GlobalServerProxyMode,
  globalProxyUrl: string,
): EffectiveProxyPolicy => {
  if (serverMode === 'off') {
    return { mode: 'off' };
  }

  if (serverMode === 'custom') {
    return {
      mode: 'custom',
      proxyUrl: serverProxyUrl ?? undefined,
    };
  }

  return {
    mode: globalMode,
    proxyUrl: globalMode === 'custom' ? globalProxyUrl : undefined,
  };
};

/**
 * Decodes one URL credential without allowing malformed escapes to break validation.
 *
 * @param value URL credential component.
 * @returns Decoded credential.
 */
const decodeUrlCredential = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Converts one validated custom proxy URL into a transport candidate.
 *
 * @param proxyUrl Valid custom proxy URL.
 * @returns Proxy candidate.
 */
const parseCustomProxyCandidate = (proxyUrl: string): ProxyCandidate => {
  const validation = validateProxyUrl(proxyUrl);
  if (!validation.valid) {
    throw new Error('Custom proxy configuration is invalid.');
  }

  const parsed = new URL(validation.normalizedUrl);
  const protocol = parsed.protocol as SupportedProxyProtocol;
  const type = protocol === 'socks5:' ? 'socks5' : protocol === 'https:' ? 'https' : 'http';

  return {
    type,
    host: normalizeUrlHostname(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : DEFAULT_PROXY_PORTS[protocol],
    username: parsed.username ? decodeUrlCredential(parsed.username) : undefined,
    password: parsed.password ? decodeUrlCredential(parsed.password) : undefined,
  };
};

/**
 * Parses one host:port endpoint emitted by Chromium proxy resolution.
 *
 * @param endpoint Proxy endpoint text.
 * @returns Parsed endpoint or null when malformed.
 */
const parseSystemProxyEndpoint = (endpoint: string): { host: string; port: number } | null => {
  try {
    const parsed = new URL(`http://${endpoint}`);
    const port = parsed.port ? Number(parsed.port) : 0;
    if (
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      return null;
    }

    return {
      host: normalizeUrlHostname(parsed.hostname),
      port,
    };
  } catch {
    return null;
  }
};

/**
 * Parses Electron/Chromium proxy resolution output while preserving candidate order.
 *
 * @param proxyRules Semicolon-separated proxy resolution result.
 * @returns Supported proxy candidates.
 */
export const parseSystemProxyRules = (proxyRules: string): ProxyCandidate[] => {
  const candidates: ProxyCandidate[] = [];

  for (const rawRule of proxyRules.split(';')) {
    const rule = rawRule.trim();
    if (!rule) {
      continue;
    }

    if (rule.toUpperCase() === 'DIRECT') {
      candidates.push({ type: 'direct' });
      continue;
    }

    const separatorIndex = rule.indexOf(' ');
    if (separatorIndex <= 0) {
      continue;
    }

    const directive = rule.slice(0, separatorIndex).toUpperCase();
    const endpoint = parseSystemProxyEndpoint(rule.slice(separatorIndex + 1).trim());
    if (!endpoint) {
      continue;
    }

    if (directive === 'PROXY') {
      candidates.push({ type: 'http', ...endpoint });
    } else if (directive === 'HTTPS') {
      candidates.push({ type: 'https', ...endpoint });
    } else if (directive === 'SOCKS5') {
      candidates.push({ type: 'socks5', ...endpoint });
    }
  }

  return candidates;
};

/**
 * Resolves the persisted global server proxy settings.
 *
 * @param db Prisma client.
 * @returns Global proxy mode and URL.
 */
const loadGlobalProxySettings = async (
  db: PrismaClient,
): Promise<{ mode: GlobalServerProxyMode; proxyUrl: string }> => {
  const row = await db.appSettings.findUnique({
    where: {
      scopeAccountId_scopeDeviceId: {
        scopeAccountId: '',
        scopeDeviceId: 'local-device',
      },
    },
    select: {
      payloadJson: true,
    },
  });
  const settings = parseStoredSettingsValues(row?.payloadJson);

  return {
    mode: settings.serverProxyMode,
    proxyUrl: settings.serverProxyUrl,
  };
};

/**
 * Opens a TCP socket with an explicit timeout.
 *
 * @param host Destination host.
 * @param port Destination port.
 * @param timeoutMs Remaining timeout budget.
 * @returns Connected socket.
 */
const connectTcpSocket = async (host: string, port: number, timeoutMs: number): Promise<net.Socket> => {
  return await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = (error: Error): void => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs, () => {
      onError(new Error('Connection timed out.'));
    });
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
};

/**
 * Opens a TLS socket to an HTTPS proxy with an explicit timeout.
 *
 * @param host Proxy host.
 * @param port Proxy port.
 * @param timeoutMs Remaining timeout budget.
 * @returns Connected TLS socket.
 */
const connectTlsSocket = async (host: string, port: number, timeoutMs: number): Promise<tls.TLSSocket> => {
  return await new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: net.isIP(host) === 0 ? host : undefined,
    });
    const onError = (error: Error): void => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs, () => {
      onError(new Error('Connection timed out.'));
    });
    socket.once('error', onError);
    socket.once('secureConnect', () => {
      socket.off('error', onError);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
};

/**
 * Reads the HTTP CONNECT response header without consuming tunneled bytes.
 *
 * @param socket Connected proxy socket.
 * @param timeoutMs Remaining timeout budget.
 * @returns HTTP status code.
 */
const readHttpConnectStatus = async (socket: Duplex, timeoutMs: number): Promise<number> => {
  return await new Promise<number>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Proxy handshake timed out.'));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('Proxy closed the connection during handshake.'));
    };
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > HTTP_PROXY_HEADER_LIMIT_BYTES) {
        cleanup();
        reject(new Error('Proxy response headers are too large.'));
        return;
      }

      const headerEndIndex = buffer.indexOf('\r\n\r\n');
      if (headerEndIndex < 0) {
        return;
      }

      cleanup();
      const header = buffer.subarray(0, headerEndIndex).toString('latin1');
      const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/i.exec(header);
      if (!statusMatch) {
        reject(new Error('Proxy returned an invalid CONNECT response.'));
        return;
      }

      const remaining = buffer.subarray(headerEndIndex + 4);
      if (remaining.length > 0 && 'unshift' in socket && typeof socket.unshift === 'function') {
        socket.unshift(remaining);
      }

      resolve(Number(statusMatch[1]));
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
};

/**
 * Establishes an HTTP CONNECT tunnel through an HTTP or HTTPS proxy.
 *
 * @param candidate HTTP-family proxy candidate.
 * @param targetHost SSH host.
 * @param targetPort SSH port.
 * @param timeoutMs Remaining timeout budget.
 * @returns Connected tunnel socket.
 */
const connectHttpProxy = async (
  candidate: Extract<ProxyCandidate, { type: 'http' | 'https' }>,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<Duplex> => {
  const startedAt = Date.now();
  const socket =
    candidate.type === 'https'
      ? await connectTlsSocket(candidate.host, candidate.port, timeoutMs)
      : await connectTcpSocket(candidate.host, candidate.port, timeoutMs);
  const authority = net.isIP(targetHost) === 6 ? `[${targetHost}]:${targetPort}` : `${targetHost}:${targetPort}`;
  const authorization =
    candidate.username !== undefined
      ? `Proxy-Authorization: Basic ${Buffer.from(`${candidate.username}:${candidate.password ?? ''}`).toString('base64')}\r\n`
      : '';

  socket.write(
    `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Connection: Keep-Alive\r\n${authorization}\r\n`,
  );

  const remainingTimeoutMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  const statusCode = await readHttpConnectStatus(socket, remainingTimeoutMs);
  if (statusCode < 200 || statusCode >= 300) {
    socket.destroy();
    throw new Error(`Proxy rejected CONNECT with status ${statusCode}.`);
  }

  return socket;
};

/**
 * Establishes a SOCKS5 tunnel.
 *
 * @param candidate SOCKS5 proxy candidate.
 * @param targetHost SSH host.
 * @param targetPort SSH port.
 * @param timeoutMs Remaining timeout budget.
 * @returns Connected tunnel socket.
 */
const connectSocks5Proxy = async (
  candidate: Extract<ProxyCandidate, { type: 'socks5' }>,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<Duplex> => {
  const result = await SocksClient.createConnection({
    command: 'connect',
    timeout: timeoutMs,
    proxy: {
      host: candidate.host,
      port: candidate.port,
      type: 5,
      userId: candidate.username,
      password: candidate.password,
    },
    destination: {
      host: targetHost,
      port: targetPort,
    },
  });

  return result.socket;
};

/**
 * Removes proxy credentials and URLs from transport error text.
 *
 * @param error Unknown connection error.
 * @returns Safe error detail.
 */
const sanitizeProxyError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Unknown proxy error.';
  return message.replace(/\b(?:https?|socks5):\/\/\S+/gi, '[redacted proxy]');
};

/**
 * Opens one candidate under the remaining shared timeout budget.
 *
 * @param candidate Proxy candidate.
 * @param targetHost SSH host.
 * @param targetPort SSH port.
 * @param timeoutMs Remaining timeout budget.
 * @returns Connected socket.
 */
const connectProxyCandidate = async (
  candidate: ProxyCandidate,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<Duplex> => {
  if (candidate.type === 'direct') {
    return await connectTcpSocket(targetHost, targetPort, timeoutMs);
  }

  if (candidate.type === 'socks5') {
    return await connectSocks5Proxy(candidate, targetHost, targetPort, timeoutMs);
  }

  return await connectHttpProxy(candidate, targetHost, targetPort, timeoutMs);
};

/**
 * Resolves effective server/global proxy policy and prepares an ssh2 socket.
 *
 * @param db Prisma client.
 * @param server Server proxy and destination fields.
 * @param systemProxyRules Electron-resolved system/PAC result when system mode is effective.
 * @param timeoutMs Total proxy plus SSH handshake timeout budget.
 * @returns Optional preconnected socket, remaining handshake timeout, and safe metadata.
 */
export const prepareSshProxyTransport = async (
  db: PrismaClient,
  server: ProxyAwareServer,
  systemProxyRules: string | undefined,
  timeoutMs: number,
): Promise<PreparedSshProxyTransport> => {
  const globalSettings = server.proxyMode === 'default' ? await loadGlobalProxySettings(db) : null;
  const effectivePolicy = resolveEffectiveProxyPolicy(
    server.proxyMode,
    server.proxyUrl,
    globalSettings?.mode ?? 'system',
    globalSettings?.proxyUrl ?? '',
  );
  const effectiveMode = effectivePolicy.mode;

  if (effectiveMode === 'off') {
    return {
      readyTimeoutMs: timeoutMs,
      metadata: {
        mode: 'off',
        protocol: 'direct',
      },
    };
  }

  let candidates: ProxyCandidate[];
  if (effectiveMode === 'custom') {
    const proxyUrl = effectivePolicy.proxyUrl;
    if (!proxyUrl) {
      throw new SshProxyConnectionError('Custom proxy mode requires a proxy URL.', {
        mode: 'custom',
        protocol: 'unknown',
      });
    }

    try {
      candidates = [parseCustomProxyCandidate(proxyUrl)];
    } catch (error: unknown) {
      throw new SshProxyConnectionError(
        error instanceof Error ? error.message : 'Custom proxy configuration is invalid.',
        {
          mode: 'custom',
          protocol: 'unknown',
        },
      );
    }
  } else {
    if (!systemProxyRules) {
      throw new SshProxyConnectionError('System proxy resolution is unavailable.', {
        mode: 'system',
        protocol: 'unknown',
      });
    }

    candidates = parseSystemProxyRules(systemProxyRules);
    if (candidates.length === 0) {
      throw new SshProxyConnectionError('System proxy resolution returned no supported proxy route.', {
        mode: 'system',
        protocol: 'unknown',
      });
    }
  }

  const startedAt = Date.now();
  const failures: string[] = [];

  for (const candidate of candidates) {
    const elapsedMs = Date.now() - startedAt;
    const remainingTimeoutMs = timeoutMs - elapsedMs;
    if (remainingTimeoutMs <= 0) {
      break;
    }

    try {
      const socket = await connectProxyCandidate(candidate, server.host, server.port, remainingTimeoutMs);
      const protocol = candidate.type;
      return {
        socket,
        readyTimeoutMs: Math.max(1, timeoutMs - (Date.now() - startedAt)),
        metadata: {
          mode: effectiveMode,
          protocol,
        },
      };
    } catch (error: unknown) {
      failures.push(`${candidate.type}: ${sanitizeProxyError(error)}`);
    }
  }

  throw new SshProxyConnectionError(`Proxy connection failed. ${failures.join(' | ') || 'Connection timed out.'}`, {
    mode: effectiveMode,
    protocol: candidates.at(-1)?.type ?? 'unknown',
  });
};
