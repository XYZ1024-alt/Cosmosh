import { AUDIT_MAX_METADATA_BYTES, AUDIT_REDACTION_PLACEHOLDER } from './constants.js';

const SENSITIVE_METADATA_KEY_PATTERN =
  /(password|passphrase|private\s*key|private_key|token|secret|credential|authorization)/i;

type SanitizedMetadataResult = {
  metadataJson: string;
  metadataValue: Record<string, unknown>;
};

/**
 * Returns true when a value is a plain object and not an array.
 *
 * @param value Candidate value.
 * @returns True when value is a plain object.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Recursively redacts sensitive fields from metadata payloads.
 *
 * @param value Arbitrary metadata value.
 * @param key Optional property key used to detect sensitive fields.
 * @returns Sanitized metadata value.
 */
const redactSensitiveValue = (value: unknown, key?: string): unknown => {
  if (key && SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
    return AUDIT_REDACTION_PLACEHOLDER;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }

  if (isPlainObject(value)) {
    const nextValue: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      nextValue[nestedKey] = redactSensitiveValue(nestedValue, nestedKey);
    }

    return nextValue;
  }

  return value;
};

/**
 * Truncates a serialized metadata payload to a safe byte budget.
 *
 * @param serializedMetadata Metadata JSON string.
 * @param maxBytes Maximum allowed byte length.
 * @returns Truncated metadata object encoded as JSON.
 */
const truncateSerializedMetadata = (serializedMetadata: string, maxBytes: number): string => {
  const fullSize = Buffer.byteLength(serializedMetadata, 'utf8');
  const targetBudget = Math.max(256, Math.min(maxBytes, AUDIT_MAX_METADATA_BYTES));
  let preview = serializedMetadata.slice(0, targetBudget);

  // Keep shrinking preview until final envelope fits the configured byte limit.
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const payload = {
      notice: 'metadata-truncated',
      originalBytes: fullSize,
      preview,
    };
    const payloadJson = JSON.stringify(payload);

    if (Buffer.byteLength(payloadJson, 'utf8') <= maxBytes) {
      return payloadJson;
    }

    preview = preview.slice(0, Math.floor(preview.length * 0.75));
    if (preview.length === 0) {
      break;
    }
  }

  return JSON.stringify({
    notice: 'metadata-truncated',
    originalBytes: fullSize,
  });
};

/**
 * Sanitizes metadata and enforces maximum serialized size.
 *
 * @param metadata Source metadata object.
 * @param maxBytes Byte limit for serialized JSON.
 * @returns Sanitized metadata object and serialized JSON payload.
 */
export const sanitizeAuditMetadata = (
  metadata: Record<string, unknown> | undefined,
  maxBytes = AUDIT_MAX_METADATA_BYTES,
): SanitizedMetadataResult => {
  const sourceValue = metadata ?? {};

  try {
    const sanitizedValue = redactSensitiveValue(sourceValue);
    const normalizedValue = isPlainObject(sanitizedValue) ? sanitizedValue : { value: sanitizedValue };
    const serialized = JSON.stringify(normalizedValue);

    if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
      return {
        metadataValue: normalizedValue,
        metadataJson: serialized,
      };
    }

    const truncatedJson = truncateSerializedMetadata(serialized, maxBytes);
    const truncatedValue = JSON.parse(truncatedJson) as Record<string, unknown>;
    return {
      metadataValue: truncatedValue,
      metadataJson: truncatedJson,
    };
  } catch {
    const fallbackValue = {
      notice: 'metadata-serialization-failed',
    };

    return {
      metadataValue: fallbackValue,
      metadataJson: JSON.stringify(fallbackValue),
    };
  }
};

/**
 * Parses serialized metadata JSON into object form.
 *
 * @param metadataJson Serialized metadata payload from storage.
 * @returns Parsed metadata object.
 */
export const parseAuditMetadata = (metadataJson: string): Record<string, unknown> => {
  try {
    const parsedValue = JSON.parse(metadataJson) as unknown;
    return isPlainObject(parsedValue) ? parsedValue : { value: parsedValue };
  } catch {
    return {
      notice: 'metadata-parse-failed',
    };
  }
};
