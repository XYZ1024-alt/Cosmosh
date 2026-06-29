import { randomUUID } from 'node:crypto';

import type {
  ApiErrorResponse,
  BackendRequestTrace,
  BackendRequestTraceBody,
  BackendRequestTraceMethod,
} from '@cosmosh/api-contract';
import type { WebContents } from 'electron';

const MAX_TRACE_COUNT = 300;
const MAX_TRACE_BODY_BYTES = 64 * 1024;
const REDACTED_VALUE = '[REDACTED]';
const REDACTED_PATH_VALUE = '[REDACTED_LOCAL_PATH]';
const SECRET_KEY_PATTERN = /(authorization|credential|password|passphrase|privatekey|secret|token)/i;
const LOCAL_PATH_KEY_PATTERN = /(^|\.)(localPath|localFilePath|localDirectory|localDestinationPath)$/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const POSIX_ABSOLUTE_PATH_PATTERN = /^\/(Users|home|tmp|var|Volumes)\//;

/** Raw backend request metadata captured by the trace-aware HTTP helper. */
export type BackendRequestTraceInput = {
  method: BackendRequestTraceMethod;
  path: string;
  startedAtMs: number;
  requestBody?: unknown;
  responseText?: string;
  status: number | null;
  ok: boolean | null;
  error?: string;
};

/**
 * Tracks sanitized backend proxy request mirrors for development-only diagnostics.
 */
export class BackendRequestTraceStore {
  private readonly traces: BackendRequestTrace[] = [];

  private readonly subscribers = new Set<WebContents>();

  public readonly enabled: boolean;

  /**
   * Creates the trace store with an explicit runtime enable flag.
   *
   * @param enabled Whether request mirrors should be collected.
   */
  public constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Returns a stable snapshot of retained traces.
   *
   * @returns Sanitized traces ordered oldest to newest.
   */
  public list(): BackendRequestTrace[] {
    return [...this.traces];
  }

  /**
   * Clears retained traces and notifies subscribers through the existing list API.
   *
   * @returns void.
   */
  public clear(): void {
    this.traces.length = 0;
  }

  /**
   * Adds a DevTools/renderer webContents subscriber for future trace events.
   *
   * @param webContents Renderer webContents that should receive trace events.
   * @returns void.
   */
  public subscribe(webContents: WebContents): void {
    if (!this.enabled || webContents.isDestroyed()) {
      return;
    }

    if (this.subscribers.has(webContents)) {
      return;
    }

    this.subscribers.add(webContents);
    webContents.once('destroyed', () => {
      this.subscribers.delete(webContents);
    });
  }

  /**
   * Records one completed backend proxy request if tracing is enabled.
   *
   * @param input Raw request/response metadata from the main-process proxy.
   * @returns Sanitized trace when recorded, otherwise null.
   */
  public record(input: BackendRequestTraceInput): BackendRequestTrace | null {
    if (!this.enabled) {
      return null;
    }

    const completedAtMs = Date.now();
    const requestBody = toTraceBody(input.requestBody);
    const responseBody = toResponseTraceBody(input.responseText);
    const requestId = extractRequestId(input.responseText);
    const trace: BackendRequestTrace = {
      id: randomUUID(),
      startedAt: new Date(input.startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      method: input.method,
      path: input.path,
      status: input.status,
      ok: input.ok,
      durationMs: Math.max(0, completedAtMs - input.startedAtMs),
      requestBody,
      responseBody,
      ...(requestId ? { requestId } : {}),
      ...(input.error ? { error: input.error } : {}),
      truncated: requestBody.truncated || responseBody.truncated,
    };

    this.traces.push(trace);
    if (this.traces.length > MAX_TRACE_COUNT) {
      this.traces.splice(0, this.traces.length - MAX_TRACE_COUNT);
    }

    this.broadcast(trace);
    return trace;
  }

  /**
   * Broadcasts a trace to all active subscribers.
   *
   * @param trace Sanitized trace payload.
   * @returns void.
   */
  private broadcast(trace: BackendRequestTrace): void {
    this.subscribers.forEach((webContents) => {
      if (webContents.isDestroyed()) {
        this.subscribers.delete(webContents);
        return;
      }

      webContents.send('debug:backend-request-trace-event', trace);
    });
  }
}

/**
 * Converts an arbitrary request body into a bounded, redacted trace body.
 *
 * @param value Raw request body.
 * @returns Sanitized trace body.
 */
const toTraceBody = (value: unknown): BackendRequestTraceBody => {
  if (value === undefined) {
    return {
      kind: 'empty',
      sizeBytes: 0,
      truncated: false,
      value: null,
    };
  }

  const sanitized = sanitizeTraceValue(value, '');
  return boundTraceBody('json', sanitized);
};

/**
 * Converts raw response text into a bounded, redacted trace body.
 *
 * @param responseText Raw backend response text.
 * @returns Sanitized trace body.
 */
const toResponseTraceBody = (responseText: string | undefined): BackendRequestTraceBody => {
  if (responseText === undefined || responseText.length === 0) {
    return {
      kind: 'empty',
      sizeBytes: 0,
      truncated: false,
      value: null,
    };
  }

  try {
    return boundTraceBody('json', sanitizeTraceValue(JSON.parse(responseText) as unknown, ''));
  } catch {
    return toResponseSummaryTraceBody(responseText);
  }
};

/**
 * Creates a non-JSON response summary without exposing arbitrary response bytes.
 *
 * @param responseText Raw backend response text.
 * @returns Bounded summary trace body.
 */
const toResponseSummaryTraceBody = (responseText: string): BackendRequestTraceBody => {
  const sizeBytes = Buffer.byteLength(responseText, 'utf8');
  return {
    kind: 'text',
    sizeBytes,
    truncated: sizeBytes > MAX_TRACE_BODY_BYTES,
    value: `[non-json response omitted, ${sizeBytes} bytes]`,
  };
};

/**
 * Applies the trace body byte cap while preserving useful JSON/text summaries.
 *
 * @param kind Body format category.
 * @param value Sanitized body value.
 * @returns Bounded trace body.
 */
const boundTraceBody = (
  kind: Exclude<BackendRequestTraceBody['kind'], 'empty'>,
  value: unknown,
): BackendRequestTraceBody => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeBytes <= MAX_TRACE_BODY_BYTES) {
    return {
      kind,
      sizeBytes,
      truncated: false,
      value,
    };
  }

  return {
    kind: 'text',
    sizeBytes,
    truncated: true,
    value: truncateUtf8(serialized, MAX_TRACE_BODY_BYTES),
  };
};

/**
 * Truncates a string to a byte limit without splitting UTF-8 sequences.
 *
 * @param value Source string.
 * @param maxBytes Maximum UTF-8 byte length to keep.
 * @returns Byte-bounded string.
 */
const truncateUtf8 = (value: string, maxBytes: number): string => {
  return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8');
};

/**
 * Recursively redacts secret-like keys and local absolute paths from trace payloads.
 *
 * @param value Raw payload value.
 * @param pathKey Dot-separated key path used for contextual redaction.
 * @returns Redacted value.
 */
const sanitizeTraceValue = (value: unknown, pathKey: string): unknown => {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return shouldRedactLocalPath(pathKey, value) ? REDACTED_PATH_VALUE : value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeTraceValue(item, `${pathKey}.${index}`));
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, childValue]) => {
      const childPath = pathKey ? `${pathKey}.${key}` : key;
      if (SECRET_KEY_PATTERN.test(key)) {
        return [key, REDACTED_VALUE];
      }

      return [key, sanitizeTraceValue(childValue, childPath)];
    }),
  );
};

/**
 * Determines whether a string should be hidden because it is a local filesystem path.
 *
 * @param pathKey Dot-separated payload key path.
 * @param value String value to inspect.
 * @returns Whether the value should be redacted.
 */
const shouldRedactLocalPath = (pathKey: string, value: string): boolean => {
  if (!LOCAL_PATH_KEY_PATTERN.test(pathKey)) {
    return false;
  }

  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) || POSIX_ABSOLUTE_PATH_PATTERN.test(value);
};

/**
 * Extracts the backend requestId from a JSON response when available.
 *
 * @param responseText Raw backend response text.
 * @returns Request id or null.
 */
const extractRequestId = (responseText: string | undefined): string | null => {
  if (!responseText) {
    return null;
  }

  try {
    const parsed = JSON.parse(responseText) as Partial<ApiErrorResponse> & {
      requestId?: unknown;
    };
    return typeof parsed.requestId === 'string' ? parsed.requestId : null;
  } catch {
    return null;
  }
};
