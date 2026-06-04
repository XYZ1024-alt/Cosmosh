/**
 * Permission modes for terminal OSC 52 clipboard access.
 */
export type TerminalClipboardAccess = 'off' | 'writeAskRead' | 'readWrite' | 'askAlways';

/**
 * Default-deny OSC 52 mode used for newly created servers and local terminals.
 */
export const DEFAULT_TERMINAL_CLIPBOARD_ACCESS: TerminalClipboardAccess = 'off';

/**
 * Stable option list shared by settings, API validation, and renderer UI.
 */
export const TERMINAL_CLIPBOARD_ACCESS_OPTIONS: readonly TerminalClipboardAccess[] = [
  'off',
  'writeAskRead',
  'readWrite',
  'askAlways',
];

const TERMINAL_CLIPBOARD_ACCESS_SET: ReadonlySet<string> = new Set(TERMINAL_CLIPBOARD_ACCESS_OPTIONS);

/**
 * Checks whether a raw value is a supported terminal OSC 52 clipboard mode.
 *
 * @param value Candidate value.
 * @returns True when the value is a supported permission mode.
 */
export const isTerminalClipboardAccess = (value: unknown): value is TerminalClipboardAccess => {
  return typeof value === 'string' && TERMINAL_CLIPBOARD_ACCESS_SET.has(value);
};
