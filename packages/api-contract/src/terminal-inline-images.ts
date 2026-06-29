/**
 * Shared terminal inline image settings.
 *
 * These values intentionally expose only the SIXEL and iTerm image protocol
 * options supported in the first experimental pass.
 */

export const MAX_TERMINAL_INLINE_IMAGE_PIXEL_LIMIT = 268_435_456;
export const MAX_TERMINAL_INLINE_IMAGE_SIXEL_PALETTE_LIMIT = 4_096;
export const MAX_TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT = 100_000_000;
export const MAX_TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB = 2_048;

/**
 * Required Cosmosh settings object passed to xterm's image addon.
 */
export type TerminalInlineImageOptions = {
  enableSizeReports: boolean;
  pixelLimit: number;
  sixelSupport: boolean;
  sixelScrolling: boolean;
  sixelPaletteLimit: number;
  sixelSizeLimit: number;
  storageLimit: number;
  showPlaceholder: boolean;
  iipSupport: boolean;
  iipSizeLimit: number;
};

/**
 * Defaults mirrored from xterm/addon-image documentation.
 */
export const DEFAULT_TERMINAL_INLINE_IMAGE_OPTIONS: TerminalInlineImageOptions = {
  enableSizeReports: true,
  pixelLimit: 16_777_216,
  sixelSupport: true,
  sixelScrolling: true,
  sixelPaletteLimit: 256,
  sixelSizeLimit: 25_000_000,
  storageLimit: 128,
  showPlaceholder: true,
  iipSupport: true,
  iipSizeLimit: 20_000_000,
};

export const TERMINAL_INLINE_IMAGE_OPTION_KEYS = [
  'enableSizeReports',
  'pixelLimit',
  'sixelSupport',
  'sixelScrolling',
  'sixelPaletteLimit',
  'sixelSizeLimit',
  'storageLimit',
  'showPlaceholder',
  'iipSupport',
  'iipSizeLimit',
] as const satisfies ReadonlyArray<keyof TerminalInlineImageOptions>;

export const TERMINAL_INLINE_IMAGE_BOOLEAN_OPTION_KEYS = [
  'enableSizeReports',
  'sixelSupport',
  'sixelScrolling',
  'showPlaceholder',
  'iipSupport',
] as const satisfies ReadonlyArray<keyof TerminalInlineImageOptions>;

export const TERMINAL_INLINE_IMAGE_INTEGER_OPTION_LIMITS = {
  pixelLimit: {
    minimum: 1,
    maximum: MAX_TERMINAL_INLINE_IMAGE_PIXEL_LIMIT,
  },
  sixelPaletteLimit: {
    minimum: 1,
    maximum: MAX_TERMINAL_INLINE_IMAGE_SIXEL_PALETTE_LIMIT,
  },
  sixelSizeLimit: {
    minimum: 1,
    maximum: MAX_TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT,
  },
  storageLimit: {
    minimum: 1,
    maximum: MAX_TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB,
  },
  iipSizeLimit: {
    minimum: 1,
    maximum: MAX_TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT,
  },
} as const satisfies Readonly<
  Record<
    Exclude<keyof TerminalInlineImageOptions, (typeof TERMINAL_INLINE_IMAGE_BOOLEAN_OPTION_KEYS)[number]>,
    { minimum: number; maximum: number }
  >
>;
