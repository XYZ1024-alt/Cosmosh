type ApiPathTokenValue = string | number | boolean;
type ApiQueryValue = ApiPathTokenValue | null | undefined;

export type ApiPathParams = Record<string, ApiPathTokenValue>;
export type ApiQueryParams = Record<string, ApiQueryValue | readonly ApiQueryValue[]>;

const isPresentQueryValue = (value: ApiQueryValue): value is ApiPathTokenValue => {
  return value !== undefined && value !== null && value !== '';
};

/**
 * Replaces one REST-style path token with a URL-encoded value.
 *
 * @param templatePath API path containing a token such as `{sessionId}`.
 * @param token Token name without braces.
 * @param value Runtime token value.
 * @returns Path with encoded token replacement applied.
 */
export const replaceApiPathToken = (templatePath: string, token: string, value: ApiPathTokenValue): string => {
  return templatePath.replaceAll(`{${token}}`, encodeURIComponent(String(value)));
};

/**
 * Appends encoded query parameters while skipping undefined, null, and empty-string values.
 *
 * @param path Path without query string.
 * @param query Query key-value object.
 * @returns Path with encoded query string when parameters exist.
 */
export const appendApiQueryParams = (path: string, query?: ApiQueryParams): string => {
  if (!query) {
    return path;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (!isPresentQueryValue(item)) {
        continue;
      }

      searchParams.append(key, String(item));
    }
  }

  const queryString = searchParams.toString();
  return queryString.length > 0 ? `${path}?${queryString}` : path;
};

/**
 * Resolves path tokens and query parameters for an API path template.
 *
 * @param templatePath API path template from `API_PATHS`.
 * @param params Optional path token values keyed by token name.
 * @param query Optional query parameters.
 * @returns Fully resolved API path.
 */
export const resolveApiPath = (templatePath: string, params?: ApiPathParams, query?: ApiQueryParams): string => {
  const path = Object.entries(params ?? {}).reduce((currentPath, [token, value]) => {
    return replaceApiPathToken(currentPath, token, value);
  }, templatePath);

  return appendApiQueryParams(path, query);
};
