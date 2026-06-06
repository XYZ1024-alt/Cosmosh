/**
 * Terminal right-click action policy values.
 */
export type TerminalRightClickAction = 'contextMenu' | 'paste' | 'copyOnSelectionElsePaste';

/**
 * Default terminal right-click behavior keeps the existing context menu surface.
 */
export const DEFAULT_TERMINAL_RIGHT_CLICK_ACTION: TerminalRightClickAction = 'contextMenu';

/**
 * Stable option list shared by settings, validation, and renderer behavior.
 */
export const TERMINAL_RIGHT_CLICK_ACTION_OPTIONS: readonly TerminalRightClickAction[] = [
  'contextMenu',
  'paste',
  'copyOnSelectionElsePaste',
];

/**
 * Terminal modifier values used to force text selection while mouse mode is active.
 */
export type TerminalForceSelectionModifier = 'off' | 'alt' | 'shift' | 'ctrl';

/**
 * Default mouse-mode selection override leaves xterm's normal mouse reporting untouched.
 */
export const DEFAULT_TERMINAL_FORCE_SELECTION_MODIFIER: TerminalForceSelectionModifier = 'off';

/**
 * Stable option list shared by settings, validation, and renderer behavior.
 */
export const TERMINAL_FORCE_SELECTION_MODIFIER_OPTIONS: readonly TerminalForceSelectionModifier[] = [
  'off',
  'alt',
  'shift',
  'ctrl',
];
