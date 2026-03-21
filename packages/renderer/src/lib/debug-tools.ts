const SHOW_SYSTEM_MONITOR_STORAGE_KEY = 'cosmosh.debug.show-system-monitor.v1';
const ENABLE_HEAP_SNAPSHOT_STORAGE_KEY = 'cosmosh.debug.enable-heap-snapshot-export.v1';

/**
 * Reads a persisted debug preference from localStorage.
 *
 * @param key Storage key.
 * @param fallbackValue Value returned when key is missing or malformed.
 * @returns Parsed boolean preference.
 */
const readBooleanPreference = (key: string, fallbackValue: boolean): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallbackValue;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    if (rawValue === 'true') {
      return true;
    }

    if (rawValue === 'false') {
      return false;
    }

    return fallbackValue;
  } catch {
    return fallbackValue;
  }
};

/**
 * Persists a debug preference into localStorage.
 *
 * @param key Storage key.
 * @param value Boolean value to persist.
 * @returns void.
 */
const writeBooleanPreference = (key: string, value: boolean): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage write failures to keep debug tools non-blocking.
  }
};

/**
 * Reads whether the system monitor overlay should be visible.
 *
 * @returns Visibility flag.
 */
export const readShowSystemMonitorOverlayPreference = (): boolean => {
  return readBooleanPreference(SHOW_SYSTEM_MONITOR_STORAGE_KEY, false);
};

/**
 * Persists system monitor overlay visibility preference.
 *
 * @param value Visibility flag.
 * @returns void.
 */
export const writeShowSystemMonitorOverlayPreference = (value: boolean): void => {
  writeBooleanPreference(SHOW_SYSTEM_MONITOR_STORAGE_KEY, value);
};

/**
 * Reads whether heap snapshot export controls are enabled.
 *
 * @returns Enabled flag.
 */
export const readEnableHeapSnapshotPreference = (): boolean => {
  return readBooleanPreference(ENABLE_HEAP_SNAPSHOT_STORAGE_KEY, false);
};

/**
 * Persists heap snapshot export control preference.
 *
 * @param value Enabled flag.
 * @returns void.
 */
export const writeEnableHeapSnapshotPreference = (value: boolean): void => {
  writeBooleanPreference(ENABLE_HEAP_SNAPSHOT_STORAGE_KEY, value);
};

/**
 * Converts byte counts into compact human-readable text.
 *
 * @param bytes Byte count.
 * @returns Formatted value with binary unit suffix.
 */
export const formatMemoryBytes = (bytes: number | null | undefined): string => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return 'N/A';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};
