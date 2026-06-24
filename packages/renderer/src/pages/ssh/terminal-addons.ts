import type { TerminalInlineImageOptions } from '@cosmosh/api-contract';
import { FitAddon } from '@xterm/addon-fit';
import { type IImageAddonOptions, ImageAddon } from '@xterm/addon-image';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { type IDisposable, type ITerminalAddon, type ITerminalOptions, type Terminal } from '@xterm/xterm';
import { Terminal as XtermTerminal } from '@xterm/xterm';

import type { ResolvedTerminalTarget } from './ssh-types';

const UNICODE_VERSION_LEGACY = '6';
const UNICODE_VERSION_11 = '11';

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
  imageAddon: ImageAddon | null;
  webglAddon: WebglAddon | null;
};

/**
 * Handler used by xterm web links to open recognized URLs through Cosmosh.
 */
export type TerminalExternalLinkHandler = (targetUrl: string) => void;

/**
 * Platform values needed by terminal web-link modifier policy.
 */
export type TerminalWebLinksPlatform = 'darwin' | 'linux' | 'win32' | undefined;

/**
 * Settings that control terminal web-link click behavior.
 */
export type TerminalWebLinksSettings = {
  enabled: boolean;
  requireModifierKey: boolean;
  platform: TerminalWebLinksPlatform;
};

/**
 * Settings that control xterm inline image protocol support.
 */
export type TerminalInlineImageSettings = {
  enabled: boolean;
  options: TerminalInlineImageOptions;
};

/** Class applied by xterm when the active link should show a pointer cursor. */
const TERMINAL_LINK_POINTER_CURSOR_CLASS = 'xterm-cursor-pointer';
const TERMINAL_IMAGE_LAYER_CLASS = 'xterm-image-layer';

declare global {
  interface Window {
    __cosmoshTerminalImageLayerCanvasContextPatched?: boolean;
  }
}

/**
 * Determines whether the configured web-link modifier is pressed.
 *
 * @param settings Settings that control link activation policy.
 * @param event Mouse or keyboard event carrying modifier-key state.
 * @returns Whether the required modifier key is pressed for the current platform.
 */
const isTerminalWebLinksModifierPressed = (
  settings: TerminalWebLinksSettings,
  event: MouseEvent | KeyboardEvent,
): boolean => {
  if (settings.platform === 'darwin') {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey;
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
 * Applies Cosmosh's character-width compatibility mode to an existing xterm instance.
 *
 * @param terminal xterm instance with the Unicode 11 provider registered.
 * @param characterWidthCompatibilityModeEnabled Whether Unicode 11 width tables should be active.
 * @returns Nothing.
 */
export const applyTerminalCharacterWidthCompatibilityMode = (
  terminal: Terminal,
  characterWidthCompatibilityModeEnabled: boolean,
): void => {
  const targetVersion = characterWidthCompatibilityModeEnabled ? UNICODE_VERSION_11 : UNICODE_VERSION_LEGACY;
  if (terminal.unicode.versions.includes(targetVersion)) {
    terminal.unicode.activeVersion = targetVersion;
  }
};

/**
 * Resolves the terminal character-width rule for a concrete runtime target.
 *
 * @param target Resolved terminal target for the session being opened.
 * @param globalCharacterWidthCompatibilityModeEnabled Global settings-registry toggle.
 * @returns Effective compatibility-mode state for the target.
 */
export const resolveTerminalCharacterWidthCompatibilityMode = (
  target: ResolvedTerminalTarget,
  globalCharacterWidthCompatibilityModeEnabled: boolean,
): boolean => {
  if (target.type === 'local-terminal') {
    return globalCharacterWidthCompatibilityModeEnabled;
  }

  return globalCharacterWidthCompatibilityModeEnabled && !target.server.disableCharacterWidthCompatibilityMode;
};

/**
 * Creates one xterm instance with Unicode 11 support registered.
 *
 * @param options xterm initialization options derived from settings.
 * @param characterWidthCompatibilityModeEnabled Whether Unicode 11 width tables should be active initially.
 * @returns Terminal instance ready for standard add-on loading.
 */
export const createTerminalInstance = (
  options: ITerminalOptions,
  characterWidthCompatibilityModeEnabled: boolean,
): Terminal => {
  const terminal = new XtermTerminal({
    ...options,
    allowProposedApi: true,
  });

  terminal.loadAddon(new Unicode11Addon());
  applyTerminalCharacterWidthCompatibilityMode(terminal, characterWidthCompatibilityModeEnabled);

  return terminal;
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
 * Creates xterm's inline image add-on options without leaking registry objects into addon state.
 *
 * @param options Strict Cosmosh inline image options from settings.
 * @returns xterm image add-on options.
 */
const toImageAddonOptions = (options: TerminalInlineImageOptions): IImageAddonOptions => ({
  enableSizeReports: options.enableSizeReports,
  pixelLimit: options.pixelLimit,
  sixelSupport: options.sixelSupport,
  sixelScrolling: options.sixelScrolling,
  sixelPaletteLimit: options.sixelPaletteLimit,
  sixelSizeLimit: options.sixelSizeLimit,
  storageLimit: options.storageLimit,
  showPlaceholder: options.showPlaceholder,
  iipSupport: options.iipSupport,
  iipSizeLimit: options.iipSizeLimit,
});

/**
 * Checks whether a canvas context option value can be copied into 2D settings.
 *
 * @param options Canvas context options from the original caller.
 * @returns Whether the value is an object-like settings bag.
 */
const isCanvas2DSettings = (options: unknown): options is CanvasRenderingContext2DSettings =>
  typeof options === 'object' && options !== null;

/**
 * Keeps xterm's image layer transparent when it is composited above WebGL.
 *
 * @returns Nothing.
 */
const ensureTerminalImageLayerCanvasContextPatch = (): void => {
  if (
    typeof window === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    window.__cosmoshTerminalImageLayerCanvasContextPatched
  ) {
    return;
  }

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const patchedGetContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ): RenderingContext | null {
    if (contextId === '2d' && this.classList.contains(TERMINAL_IMAGE_LAYER_CLASS)) {
      const contextOptions: CanvasRenderingContext2DSettings = {
        ...(isCanvas2DSettings(options) ? options : {}),
        alpha: true,
        desynchronized: false,
      };
      const context = originalGetContext.call(this, '2d', contextOptions) as CanvasRenderingContext2D | null;
      context?.clearRect(0, 0, this.width, this.height);
      return context;
    }

    const contextArgs: [string] | [string, unknown] = options === undefined ? [contextId] : [contextId, options];
    return Reflect.apply(originalGetContext, this, contextArgs) as RenderingContext | null;
  };

  HTMLCanvasElement.prototype.getContext = patchedGetContext as typeof HTMLCanvasElement.prototype.getContext;
  window.__cosmoshTerminalImageLayerCanvasContextPatched = true;
};

/**
 * Attaches optional inline image protocol support to one xterm instance.
 *
 * @param terminal Terminal instance that will own the image add-on.
 * @param settings Settings that control inline image support and limits.
 * @returns Loaded image add-on, or `null` when disabled/unavailable.
 */
const attachImageAddon = (terminal: Terminal, settings: TerminalInlineImageSettings): ImageAddon | null => {
  if (!settings.enabled) {
    return null;
  }

  let imageAddon: ImageAddon | null = null;

  try {
    ensureTerminalImageLayerCanvasContextPatch();
    imageAddon = new ImageAddon(toImageAddonOptions(settings.options));
    terminal.loadAddon(imageAddon);
    return imageAddon;
  } catch (error: unknown) {
    disposeAddonSafely(imageAddon);
    console.warn('Terminal inline image support is unavailable; continuing without the image addon.', error);
    return null;
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

class TerminalWebLinksCursorAddon implements ITerminalAddon {
  private terminal: Terminal | null = null;
  private terminalElement: HTMLElement | null = null;
  private isHoveringLink = false;
  private isModifierPressed = false;
  private readonly disposables: IDisposable[] = [];

  /**
   * @param settings Settings that control link activation policy.
   */
  constructor(private readonly settings: TerminalWebLinksSettings) {}

  /**
   * Activates the cursor policy for one terminal instance.
   *
   * @param terminal Terminal whose link hover cursor should reflect modifier-key state.
   * @returns Nothing.
   */
  public activate(terminal: Terminal): void {
    this.terminal = terminal;
    this.terminalElement = terminal.element ?? null;
    window.addEventListener('keydown', this.handleKeyEvent);
    window.addEventListener('keyup', this.handleKeyEvent);
    window.addEventListener('blur', this.handleWindowBlur);
    this.disposables.push({
      dispose: (): void => {
        window.removeEventListener('keydown', this.handleKeyEvent);
        window.removeEventListener('keyup', this.handleKeyEvent);
        window.removeEventListener('blur', this.handleWindowBlur);
      },
    });
  }

  /**
   * Marks that xterm is hovering a web link and synchronizes its cursor.
   *
   * @param event Mouse event from xterm's link hover callback.
   * @returns Nothing.
   */
  public handleLinkHover = (event: MouseEvent): void => {
    this.isHoveringLink = true;
    this.isModifierPressed = isTerminalWebLinksModifierPressed(this.settings, event);
    this.syncPointerCursor();
  };

  /**
   * Marks that xterm has left the active web link.
   *
   * @returns Nothing.
   */
  public handleLinkLeave = (): void => {
    this.isHoveringLink = false;
    this.syncPointerCursor();
  };

  /**
   * Disposes DOM listeners owned by this add-on.
   *
   * @returns Nothing.
   */
  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.clearPointerCursor();
    this.terminal = null;
    this.terminalElement = null;
  }

  private readonly handleKeyEvent = (event: KeyboardEvent): void => {
    this.isModifierPressed = isTerminalWebLinksModifierPressed(this.settings, event);
    this.syncPointerCursor();
  };

  private readonly handleWindowBlur = (): void => {
    this.isModifierPressed = false;
    this.syncPointerCursor();
  };

  /**
   * Applies the pointer cursor only while hovering a link with the required modifier held.
   *
   * @returns Nothing.
   */
  private syncPointerCursor(): void {
    const shouldShowPointerCursor = this.isHoveringLink && this.isModifierPressed;
    if (shouldShowPointerCursor) {
      this.addPointerCursor();
      return;
    }

    this.clearPointerCursor();
  }

  /**
   * Adds xterm's pointer cursor marker to the terminal element.
   *
   * @returns Nothing.
   */
  private addPointerCursor(): void {
    const terminalElement = this.resolveTerminalElement();
    if (!terminalElement) {
      return;
    }

    terminalElement.classList.add(TERMINAL_LINK_POINTER_CURSOR_CLASS);
  }

  /**
   * Removes xterm's pointer cursor marker while keeping URL detection active.
   *
   * @returns Nothing.
   */
  private clearPointerCursor(): void {
    const terminalElement = this.resolveTerminalElement();
    if (!terminalElement) {
      return;
    }

    terminalElement.classList.remove(TERMINAL_LINK_POINTER_CURSOR_CLASS);
    for (const decoratedElement of terminalElement.querySelectorAll(`.${TERMINAL_LINK_POINTER_CURSOR_CLASS}`)) {
      decoratedElement.classList.remove(TERMINAL_LINK_POINTER_CURSOR_CLASS);
    }
  }

  /**
   * Resolves the terminal root after xterm has been opened.
   *
   * @returns Terminal root element, or `null` before mount/after disposal.
   */
  private resolveTerminalElement(): HTMLElement | null {
    if (this.terminalElement) {
      return this.terminalElement;
    }

    this.terminalElement = this.terminal?.element ?? null;
    return this.terminalElement;
  }
}

/**
 * Creates and loads standard terminal add-ons shared by primary and split panes.
 * Inline images are loaded before `terminal.open(...)`; WebGL is synchronized
 * after open because it needs a mounted renderer.
 *
 * @param terminal Terminal instance that will own the add-ons.
 * @param inlineImageSettings Settings that control inline image protocols and limits.
 * @param webLinksSettings Settings that control URL recognition and click behavior.
 * @param openExternalLink Secure external URL opener used by recognized terminal links.
 * @returns Runtime handles for loaded add-ons.
 */
export const loadTerminalAddons = (
  terminal: Terminal,
  inlineImageSettings: TerminalInlineImageSettings,
  webLinksSettings: TerminalWebLinksSettings,
  openExternalLink: TerminalExternalLinkHandler,
): TerminalAddonRuntime => {
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  const imageAddon = attachImageAddon(terminal, inlineImageSettings);

  if (webLinksSettings.enabled) {
    const webLinksCursorAddon = webLinksSettings.requireModifierKey
      ? new TerminalWebLinksCursorAddon(webLinksSettings)
      : null;
    const webLinksOptions = webLinksSettings.requireModifierKey
      ? {
          hover: webLinksCursorAddon?.handleLinkHover,
          leave: webLinksCursorAddon?.handleLinkLeave,
        }
      : undefined;

    if (webLinksCursorAddon) {
      terminal.loadAddon(webLinksCursorAddon);
    }

    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        if (event.button !== 0) {
          return;
        }

        // macOS treats Ctrl+Click as a context-menu gesture, so keep it out of link activation.
        if (webLinksSettings.platform === 'darwin' && event.ctrlKey) {
          return;
        }

        const hasRequiredModifier = isTerminalWebLinksModifierPressed(webLinksSettings, event);
        if (webLinksSettings.requireModifierKey && !hasRequiredModifier) {
          return;
        }

        openExternalLink(uri);
      }, webLinksOptions),
    );
  }

  return {
    fitAddon,
    searchAddon,
    imageAddon,
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
