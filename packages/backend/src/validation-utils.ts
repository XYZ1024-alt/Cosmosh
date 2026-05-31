export type ValidationError = {
  i18nKey: string;
  fallbackMessage: string;
  params?: Record<string, string | number | boolean>;
};

export type ValidationResult<TValue> = {
  value?: TValue;
  error?: ValidationError;
};

/**
 * Builds a route validation error descriptor shared by backend payload parsers.
 *
 * @param i18nKey Locale key describing the validation error.
 * @param fallbackMessage English fallback for logs and tests.
 * @param params Optional ICU params.
 * @returns Validation error descriptor.
 */
export const buildValidationError = (
  i18nKey: string,
  fallbackMessage: string,
  params?: Record<string, string | number | boolean>,
): ValidationError => {
  return {
    i18nKey,
    fallbackMessage,
    params,
  };
};

/**
 * Checks whether an unknown payload can be inspected as a JSON object map.
 *
 * @param value Unknown payload.
 * @returns True when the payload is a non-array object map.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Normalizes optional non-empty string fields.
 *
 * @param value Unknown field value.
 * @returns Trimmed string when present.
 */
export const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Normalizes optional boolean fields.
 *
 * @param value Unknown field value.
 * @returns Boolean when present.
 */
export const normalizeOptionalBoolean = (value: unknown): boolean | undefined => {
  return typeof value === 'boolean' ? value : undefined;
};

/**
 * Normalizes a required numeric port.
 *
 * @param value Unknown field value.
 * @returns Parsed port number.
 */
export const normalizePort = (value: unknown): number => {
  return typeof value === 'number' ? value : Number(value);
};

/**
 * Normalizes an optional positive integer field.
 *
 * @param value Unknown field value.
 * @returns Positive integer when present.
 */
export const normalizePositiveInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalizedValue = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(normalizedValue) && normalizedValue > 0 ? normalizedValue : undefined;
};

/**
 * Checks whether a numeric value is a valid TCP port.
 *
 * @param value Candidate port.
 * @returns True when port is in user-addressable TCP range.
 */
export const isValidTcpPort = (value: number): boolean => {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
};

/**
 * Normalizes a required string ID array into trimmed, unique IDs.
 *
 * @param ids Unknown field value.
 * @returns Unique string IDs, or an empty array when the input is not an array.
 */
export const normalizeUniqueStringIds = (ids: unknown): string[] => {
  if (!Array.isArray(ids)) {
    return [];
  }

  const values = ids.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  return [...new Set(values)];
};

/**
 * Normalizes an optional string ID array into trimmed, unique IDs.
 *
 * @param ids Unknown field value.
 * @returns Unique string IDs when the field is present as an array.
 */
export const normalizeOptionalUniqueStringIds = (ids: unknown): string[] | undefined => {
  if (!Array.isArray(ids)) {
    return undefined;
  }

  return normalizeUniqueStringIds(ids);
};
