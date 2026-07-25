const OOBE_COMPLETION_STORAGE_KEY = 'cosmosh.renderer.oobe.completed.v1';
const OOBE_COMPLETION_STORAGE_VALUE = 'completed';

type OobeReadableStorage = Pick<Storage, 'getItem'>;
type OobeWritableStorage = Pick<Storage, 'setItem'>;

/**
 * Resolves renderer local storage without letting storage access failures block startup.
 *
 * @returns Renderer storage, or `null` when unavailable.
 */
const resolveRendererStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Checks whether the first-run experience has been completed.
 *
 * @param storage Optional storage override used by deterministic tests.
 * @returns `true` only when the current OOBE completion marker is present.
 */
export const isOobeCompleted = (storage: OobeReadableStorage | null = resolveRendererStorage()): boolean => {
  try {
    return storage?.getItem(OOBE_COMPLETION_STORAGE_KEY) === OOBE_COMPLETION_STORAGE_VALUE;
  } catch {
    return false;
  }
};

/**
 * Persists the first-run completion marker before the renderer reloads.
 *
 * @param storage Optional storage override used by deterministic tests.
 * @returns Whether the marker was persisted successfully.
 */
export const markOobeCompleted = (storage: OobeWritableStorage | null = resolveRendererStorage()): boolean => {
  try {
    if (!storage) {
      return false;
    }

    storage.setItem(OOBE_COMPLETION_STORAGE_KEY, OOBE_COMPLETION_STORAGE_VALUE);
    return true;
  } catch {
    return false;
  }
};
