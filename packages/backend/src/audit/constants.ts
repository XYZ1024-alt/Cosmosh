/**
 * Default audit event retention period in days.
 */
export const AUDIT_DEFAULT_RETENTION_DAYS = 180;

/**
 * Default page size for audit list endpoint.
 */
export const AUDIT_DEFAULT_PAGE_SIZE = 50;

/**
 * Maximum page size accepted by audit list endpoint.
 */
export const AUDIT_MAX_PAGE_SIZE = 200;

/**
 * Maximum serialized metadata size for one audit event.
 */
export const AUDIT_MAX_METADATA_BYTES = 8 * 1024;

/**
 * Minimum delay between automatic retention cleanup passes.
 */
export const AUDIT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Default scope values used in local-first mode.
 */
export const AUDIT_DEFAULT_SCOPE_ACCOUNT_ID = '';
export const AUDIT_DEFAULT_SCOPE_DEVICE_ID = 'local-device';

/**
 * Placeholder written for redacted sensitive metadata values.
 */
export const AUDIT_REDACTION_PLACEHOLDER = '[REDACTED]';
