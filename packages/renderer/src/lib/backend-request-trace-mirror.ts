import type { BackendRequestTrace } from '@cosmosh/api-contract';

const MAX_RENDERER_TRACE_COUNT = 300;

type BackendRequestTraceBridge = {
  getBackendRequestTraces?: () => Promise<BackendRequestTrace[]>;
  clearBackendRequestTraces?: () => Promise<boolean>;
  onBackendRequestTrace?: (listener: (trace: BackendRequestTrace) => void) => () => void;
};

type BackendRequestTraceMirror = NonNullable<Window['__COSMOSH_BACKEND_REQUEST_TRACE__']>;

/**
 * Initializes the renderer-side cache read by the Cosmosh Requests DevTools panel.
 *
 * @returns Promise that resolves after the initial trace snapshot attempt.
 */
export const initializeBackendRequestTraceMirror = async (): Promise<void> => {
  const bridge = window.electron as BackendRequestTraceBridge | undefined;
  const mirror = createBackendRequestTraceMirror(bridge);
  window.__COSMOSH_BACKEND_REQUEST_TRACE__ = mirror;

  if (!bridge?.getBackendRequestTraces || !bridge.onBackendRequestTrace) {
    return;
  }

  try {
    setMirrorTraces(mirror, await bridge.getBackendRequestTraces());
    mirror.enabled = true;
  } catch {
    mirror.enabled = false;
    return;
  }

  bridge.onBackendRequestTrace((trace) => {
    mirror.traces.push(trace);
    if (mirror.traces.length > MAX_RENDERER_TRACE_COUNT) {
      mirror.traces.splice(0, mirror.traces.length - MAX_RENDERER_TRACE_COUNT);
    }
    mirror.updatedAt = new Date().toISOString();
  });
};

/**
 * Creates the mutable mirror object intentionally exposed on window for DevTools eval.
 *
 * @param bridge Optional preload bridge diagnostics methods.
 * @returns Renderer-side trace mirror object.
 */
const createBackendRequestTraceMirror = (bridge: BackendRequestTraceBridge | undefined): BackendRequestTraceMirror => {
  const mirror: BackendRequestTraceMirror = {
    traces: [],
    enabled: false,
    updatedAt: null,
    refresh: async () => {
      if (!bridge?.getBackendRequestTraces) {
        return mirror.traces;
      }

      const traces = await bridge.getBackendRequestTraces();
      setMirrorTraces(mirror, traces);
      mirror.enabled = true;
      return mirror.traces;
    },
    clear: async () => {
      if (!bridge?.clearBackendRequestTraces) {
        setMirrorTraces(mirror, []);
        return false;
      }

      const didClear = await bridge.clearBackendRequestTraces();
      if (didClear) {
        setMirrorTraces(mirror, []);
      }
      return didClear;
    },
  };

  return mirror;
};

/**
 * Replaces the mirror trace list in-place so DevTools keeps a stable object reference.
 *
 * @param mirror Renderer-side trace mirror object.
 * @param traces Sanitized traces from main.
 * @returns void.
 */
const setMirrorTraces = (mirror: BackendRequestTraceMirror, traces: BackendRequestTrace[]): void => {
  mirror.traces.splice(0, mirror.traces.length, ...traces.slice(-MAX_RENDERER_TRACE_COUNT));
  mirror.updatedAt = new Date().toISOString();
};
