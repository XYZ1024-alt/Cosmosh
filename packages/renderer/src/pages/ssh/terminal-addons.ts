import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { type Terminal } from '@xterm/xterm';

/**
 * Per-SSH-page hardware acceleration state shared by primary and split panes.
 */
export type TerminalHardwareAccelerationState = {
  isEnabledBySettings: boolean;
  isRuntimeDisabled: boolean;
  hasShownContextLossWarning: boolean;
};

/**
 * Runtime add-ons owned by a single xterm instance.
 */
export type TerminalAddonRuntime = {
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  webglAddon: WebglAddon | null;
};

/**
 * Mutable WebGL handle slot used by long-lived terminal runtimes.
 */
export type TerminalWebglAddonRuntime = Pick<TerminalAddonRuntime, 'webglAddon'>;

type AttachTerminalAddonsParams = {
  terminal: Terminal;
  runtime: TerminalWebglAddonRuntime;
  hardwareAccelerationState: TerminalHardwareAccelerationState;
  notifyHardwareAccelerationContextLoss: () => void;
};

/**
 * Disposes an add-on while ignoring xterm teardown races.
 *
 * @param addon Add-on instance that may already be disposed by xterm.
 * @returns Nothing.
 */
const disposeAddonSafely = (addon: { dispose: () => void } | null): void => {
  if (!addon) {
    return;
  }

  try {
    addon.dispose();
  } catch {
    // Ignore add-on disposal races during terminal teardown.
  }
};

/**
 * Attaches optional WebGL rendering to one xterm instance.
 *
 * @param params Terminal, shared acceleration state, and warning callback.
 * @returns Loaded WebGL add-on, or `null` when unavailable.
 */
const attachWebglAddon = ({
  terminal,
  runtime,
  hardwareAccelerationState,
  notifyHardwareAccelerationContextLoss,
}: AttachTerminalAddonsParams): WebglAddon | null => {
  if (!hardwareAccelerationState.isEnabledBySettings || hardwareAccelerationState.isRuntimeDisabled) {
    return null;
  }

  let webglAddon: WebglAddon | null = null;

  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      hardwareAccelerationState.isRuntimeDisabled = true;
      if (runtime.webglAddon === webglAddon) {
        runtime.webglAddon = null;
      }
      disposeAddonSafely(webglAddon);
      notifyHardwareAccelerationContextLoss();
    });
    terminal.loadAddon(webglAddon);
    return webglAddon;
  } catch (error: unknown) {
    disposeAddonSafely(webglAddon);
    console.warn('Terminal hardware acceleration is unavailable; falling back to the default xterm renderer.', error);
    return null;
  }
};

/**
 * Creates and loads standard terminal add-ons shared by primary and split panes.
 * WebGL is synchronized after `terminal.open(...)` because it needs a mounted renderer.
 *
 * @param terminal Terminal instance that will own the add-ons.
 * @returns Runtime handles for loaded add-ons.
 */
export const loadTerminalAddons = (terminal: Terminal): TerminalAddonRuntime => {
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);

  return {
    fitAddon,
    searchAddon,
    webglAddon: null,
  };
};

/**
 * Disposes only the WebGL add-on for a terminal runtime.
 *
 * @param runtime Add-on runtime to update.
 * @returns Nothing.
 */
export const disposeTerminalWebglAddon = (runtime: TerminalWebglAddonRuntime): void => {
  disposeAddonSafely(runtime.webglAddon);
  runtime.webglAddon = null;
};

/**
 * Ensures one terminal runtime matches the current hardware acceleration state.
 *
 * @param terminal Terminal instance to update.
 * @param runtime Add-on runtime to update.
 * @param hardwareAccelerationState Shared acceleration state.
 * @param notifyHardwareAccelerationContextLoss One-shot user warning callback.
 * @returns Nothing.
 */
export const syncTerminalWebglAddon = (
  terminal: Terminal,
  runtime: TerminalWebglAddonRuntime,
  hardwareAccelerationState: TerminalHardwareAccelerationState,
  notifyHardwareAccelerationContextLoss: () => void,
): void => {
  if (!hardwareAccelerationState.isEnabledBySettings || hardwareAccelerationState.isRuntimeDisabled) {
    disposeTerminalWebglAddon(runtime);
    return;
  }

  if (runtime.webglAddon) {
    return;
  }

  runtime.webglAddon = attachWebglAddon({
    terminal,
    runtime,
    hardwareAccelerationState,
    notifyHardwareAccelerationContextLoss,
  });
};
