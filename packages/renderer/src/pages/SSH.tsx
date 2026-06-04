import '@xterm/xterm/css/xterm.css';

import { type ITerminalOptions } from '@xterm/xterm';
import classNames from 'classnames';
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, RefreshCw, ScanSearch, TextSelect } from 'lucide-react';
import React from 'react';

import { TerminalAutocompleteMenu } from '../components/terminal/terminal-autocomplete-menu';
import { TerminalSelectionBar } from '../components/terminal/terminal-selection-bar';
import { TerminalTextDropZone } from '../components/terminal/terminal-text-drop-zone';
import { Button } from '../components/ui/button';
import { CommandPalette } from '../components/ui/command-palette';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from '../components/ui/dialog';
import { Menubar } from '../components/ui/menubar';
import { Toggle } from '../components/ui/toggle';
import { t } from '../lib/i18n';
import { useSettingsValues } from '../lib/settings-store';
import { useToast } from '../lib/toast-context';
import { useTerminalTextDropZone } from '../lib/use-terminal-text-drop-zone';
import type { SshConnectionIntent, TabIconColorKey, TabIconKey } from '../types/tabs';
import { INTERNAL_TERMINAL_TEXT_DRAG_MIME, type TerminalSelectionSettings } from './ssh/ssh-types';
import {
  parseOptionalNumberSetting,
  resolveSearchUrl,
  resolveSftpDirectoryPathFromSelection,
  resolveTerminalFontWeightSetting,
} from './ssh/ssh-utils';
import { SSHSidebar } from './ssh/SSHSidebar';
import { SSHTerminalPaneLayout } from './ssh/SSHTerminalPaneLayout';
import { type TerminalSearchDirection, useSshCore } from './ssh/use-ssh-core';
import { useTerminalClipboardProvider } from './ssh/use-terminal-clipboard-provider';

/**
 * SSH page props.
 */
type SSHProps = {
  tabId: string;
  isActive: boolean;
  connectionIntent: SshConnectionIntent;
  onConnectionIntentChange: (nextIntent: SshConnectionIntent) => void;
  onOpenDirectoryInSFTP?: (serverId: string, serverName: string, initialPath: string) => void;
  onTabTitleChange?: (title: string) => void;
  onTabVisualChange?: (visual: { iconKey: TabIconKey; iconColorKey?: TabIconColorKey }) => void;
};

/** Delay used to debounce query-driven xterm search jumps while typing. */
const TERMINAL_SEARCH_DEBOUNCE_MS = 80;
/** macOS copy shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_COPY_SHORTCUT_LABEL_MAC = '⌘C';
/** Non-macOS copy shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_COPY_SHORTCUT_LABEL_DEFAULT = 'Ctrl+Shift+C';
/** macOS paste shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_PASTE_SHORTCUT_LABEL_MAC = '⌘V';
/** Non-macOS paste shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_PASTE_SHORTCUT_LABEL_DEFAULT = 'Ctrl+Shift+V';
/** macOS find shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_FIND_SHORTCUT_LABEL_MAC = '⇧⌘F';
/** Non-macOS find shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_FIND_SHORTCUT_LABEL_DEFAULT = 'Ctrl+Shift+F';
/** macOS clear-screen shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_CLEAR_SHORTCUT_LABEL_MAC = '⌃L';
/** Non-macOS clear-screen shortcut label rendered in terminal context-menu hint slot. */
const TERMINAL_CLEAR_SHORTCUT_LABEL_DEFAULT = 'Ctrl+L';
/** Matches URL-looking selection strings with any scheme (including custom ones). */
const TERMINAL_SELECTION_LINK_PATTERN = /^[a-z][a-z0-9+.-]*:\S+$/i;
/** Matches Windows absolute paths that should not be treated as URLs. */
const TERMINAL_WINDOWS_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

/**
 * Resolves selection text into an external link when it is already a URL.
 *
 * @param text Raw selection text.
 * @returns Trimmed link string when the selection is a supported link, otherwise `null`.
 */
const resolveSelectionLink = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (TERMINAL_WINDOWS_PATH_PATTERN.test(trimmed)) {
    return null;
  }

  if (!TERMINAL_SELECTION_LINK_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
};

/**
 * SSH page that orchestrates terminal lifecycle, websocket sessions,
 * split-pane mirroring, and interaction overlays.
 */
const SSH: React.FC<SSHProps> = ({
  tabId,
  isActive,
  connectionIntent,
  onConnectionIntentChange,
  onOpenDirectoryInSFTP,
  onTabTitleChange,
  onTabVisualChange,
}) => {
  const { error: notifyError, info: notifyInfo, success: notifySuccess, warning: notifyWarning } = useToast();
  const settingsValues = useSettingsValues();

  // Derive terminal-relevant settings from the centralized store.
  const sshMaxRows = settingsValues.sshMaxRows;
  const sshConnectionTimeoutSec = settingsValues.sshConnectionTimeoutSec;
  const terminalTextDropMode = settingsValues.terminalTextDropMode;
  const terminalAutoCompleteEnabled = settingsValues.terminalAutoCompleteEnabled;
  const terminalAutoCompleteHistoryEnabled = settingsValues.terminalAutoCompleteHistoryEnabled;
  const terminalAutoCompleteBuiltInCommandsEnabled = settingsValues.terminalAutoCompleteBuiltInCommandsEnabled;
  const terminalAutoCompletePathEnabled = settingsValues.terminalAutoCompletePathEnabled;
  const terminalAutoCompletePasswordEnabled = settingsValues.terminalAutoCompletePasswordEnabled;
  const terminalAutoCompleteAcceptKeys = settingsValues.terminalAutoCompleteAcceptKeys;
  const terminalAutoCompleteMinChars = settingsValues.terminalAutoCompleteMinChars;
  const terminalAutoCompleteMaxItems = settingsValues.terminalAutoCompleteMaxItems;
  const terminalAutoCompleteFuzzyMatch = settingsValues.terminalAutoCompleteFuzzyMatch;
  const terminalAutoCompletePromptRegex = settingsValues.terminalAutoCompletePromptRegex;
  const terminalBracketedPasteEnabled = settingsValues.terminalBracketedPasteEnabled;
  const localTerminalClipboardAccess = settingsValues.localTerminalClipboardAccess;
  const terminalInitOptions = React.useMemo<ITerminalOptions>(() => {
    const terminalTextColor =
      getComputedStyle(document.documentElement).getPropertyValue('--color-ssh-terminal').trim() || '#cccccc';
    const terminalBackground =
      getComputedStyle(document.documentElement).getPropertyValue('--color-ssh-card-bg-terminal').trim() || '#000000';
    const cursorWidth = parseOptionalNumberSetting(settingsValues.terminalCursorWidth, { min: 1, max: 32 });
    const lineHeight = parseOptionalNumberSetting(settingsValues.terminalLineHeight, { min: 0.5, max: 3 });
    const scrollSensitivity = parseOptionalNumberSetting(settingsValues.terminalScrollSensitivity, {
      min: 0.1,
      max: 50,
    });
    const fastScrollSensitivity = parseOptionalNumberSetting(settingsValues.terminalFastScrollSensitivity, {
      min: 0.1,
      max: 200,
    });
    const minimumContrastRatio = parseOptionalNumberSetting(settingsValues.terminalMinimumContrastRatio, {
      min: 1,
      max: 21,
    });

    return {
      convertEol: true,
      altClickMovesCursor: settingsValues.terminalAltClickMovesCursor,
      cursorBlink: settingsValues.terminalCursorBlink,
      cursorInactiveStyle: settingsValues.terminalCursorInactiveStyle,
      cursorStyle: settingsValues.terminalCursorStyle,
      cursorWidth,
      customGlyphs: settingsValues.terminalCustomGlyphs,
      drawBoldTextInBrightColors: settingsValues.terminalDrawBoldTextInBrightColors,
      fastScrollSensitivity,
      fontFamily: settingsValues.terminalFontFamily,
      fontSize: settingsValues.terminalFontSize,
      fontWeight: resolveTerminalFontWeightSetting(settingsValues.terminalFontWeight, 'normal'),
      fontWeightBold: resolveTerminalFontWeightSetting(settingsValues.terminalFontWeightBold, 'bold'),
      ignoreBracketedPasteMode: !terminalBracketedPasteEnabled,
      letterSpacing: settingsValues.terminalLetterSpacing,
      lineHeight: lineHeight ?? 1,
      minimumContrastRatio,
      screenReaderMode: settingsValues.terminalScreenReaderMode,
      scrollback: sshMaxRows,
      scrollOnUserInput: settingsValues.terminalScrollOnUserInput,
      scrollSensitivity,
      smoothScrollDuration: settingsValues.terminalSmoothScrollDuration,
      tabStopWidth: settingsValues.terminalTabStopWidth,
      theme: {
        background: terminalBackground,
        foreground: terminalTextColor,
      },
    };
  }, [
    settingsValues.terminalAltClickMovesCursor,
    settingsValues.terminalCursorBlink,
    settingsValues.terminalCursorInactiveStyle,
    settingsValues.terminalCursorStyle,
    settingsValues.terminalCursorWidth,
    settingsValues.terminalCustomGlyphs,
    settingsValues.terminalDrawBoldTextInBrightColors,
    settingsValues.terminalFastScrollSensitivity,
    settingsValues.terminalFontFamily,
    settingsValues.terminalFontSize,
    settingsValues.terminalFontWeight,
    settingsValues.terminalFontWeightBold,
    terminalBracketedPasteEnabled,
    settingsValues.terminalLetterSpacing,
    settingsValues.terminalLineHeight,
    settingsValues.terminalMinimumContrastRatio,
    settingsValues.terminalScreenReaderMode,
    settingsValues.terminalScrollOnUserInput,
    settingsValues.terminalScrollSensitivity,
    settingsValues.terminalSmoothScrollDuration,
    settingsValues.terminalTabStopWidth,
    sshMaxRows,
  ]);
  const terminalSelectionSettings: TerminalSelectionSettings = React.useMemo(
    () => ({
      enabled: settingsValues.terminalSelectionBarEnabled,
      searchEngine: settingsValues.terminalSelectionSearchEngine,
      searchUrlTemplate: settingsValues.terminalSelectionSearchUrlTemplate,
    }),
    [
      settingsValues.terminalSelectionBarEnabled,
      settingsValues.terminalSelectionSearchEngine,
      settingsValues.terminalSelectionSearchUrlTemplate,
    ],
  );
  const sshReconnectOnFocus = settingsValues.sshReconnectOnFocus;
  const {
    provider: terminalClipboardProvider,
    promptState: { prompt: terminalClipboardPrompt, resolvePrompt: resolveTerminalClipboardPrompt },
  } = useTerminalClipboardProvider({
    localTerminalClipboardAccess,
    toast: {
      info: notifyInfo,
      warning: notifyWarning,
      error: notifyError,
    },
  });

  const sshCore = useSshCore({
    tabId,
    isActive,
    connectionIntent,
    onConnectionIntentChange,
    terminalInitOptions,
    sshConnectionTimeoutSec,
    terminalAutoCompleteEnabled,
    terminalAutoCompleteHistoryEnabled,
    terminalAutoCompleteBuiltInCommandsEnabled,
    terminalAutoCompletePathEnabled,
    terminalAutoCompletePasswordEnabled,
    terminalAutoCompleteAcceptKeys,
    terminalAutoCompleteMinChars,
    terminalAutoCompleteMaxItems,
    terminalAutoCompleteFuzzyMatch,
    terminalAutoCompletePromptRegex,
    terminalBracketedPasteEnabled,
    terminalClipboardProvider,
    terminalSelectionBarEnabled: terminalSelectionSettings.enabled,
    sshReconnectOnFocus,
    onTabTitleChange,
    onTabVisualChange,
    notifyWarning,
  });

  const {
    state: {
      terminalPaneIds,
      activePaneId,
      connectionState,
      connectionError,
      telemetryState,
      hostFingerprintPrompt,
      canSplitTerminal,
      selectionAnchor,
      selectionBarPosition,
      dismissedSelectionText,
      autocompleteItems,
      autocompleteAnchor,
    },
    actions: {
      activatePane,
      splitPane,
      closePane,
      retryConnection,
      sendInput,
      pasteInput,
      deleteHistoryCommand,
      selectAll,
      getSelectionText,
      focusActiveTerminal,
      clearTerminalScreen,
      findActiveTerminalText,
      clearActiveTerminalSearch,
      setPaneContainerElement,
      setPrimaryPaneContainer,
      resolveHostFingerprintPrompt,
      dismissSelectionBar,
      acceptAutocompleteAtIndex,
    },
    refs: { wrapperRef, terminalContainerRef, selectionBarRef, autocompleteMenuRef },
  } = sshCore;
  const terminalPaneIdsRef = React.useRef<string[]>(terminalPaneIds);
  const dispatchedStartupCommandIntentIdRef = React.useRef<string | null>(null);
  const [terminalSearchOpen, setTerminalSearchOpen] = React.useState<boolean>(false);
  const [terminalSearchQuery, setTerminalSearchQuery] = React.useState<string>('');
  const [terminalSearchCaseSensitive, setTerminalSearchCaseSensitive] = React.useState<boolean>(false);
  const [terminalSearchRegex, setTerminalSearchRegex] = React.useState<boolean>(false);
  /** Detects macOS so find uses the correct modifier path (Meta vs Ctrl). */
  const isMacOS = window.electron?.platform === 'darwin';
  /** Platform-resolved copy shortcut label shown in terminal context menus. */
  const terminalCopyShortcutLabel = isMacOS ? TERMINAL_COPY_SHORTCUT_LABEL_MAC : TERMINAL_COPY_SHORTCUT_LABEL_DEFAULT;
  /** Platform-resolved paste shortcut label shown in terminal context menus. */
  const terminalPasteShortcutLabel = isMacOS
    ? TERMINAL_PASTE_SHORTCUT_LABEL_MAC
    : TERMINAL_PASTE_SHORTCUT_LABEL_DEFAULT;
  /** Platform-resolved find shortcut label shown in terminal context menus. */
  const terminalFindShortcutLabel = isMacOS ? TERMINAL_FIND_SHORTCUT_LABEL_MAC : TERMINAL_FIND_SHORTCUT_LABEL_DEFAULT;
  /** Platform-resolved clear-screen shortcut label shown in terminal context menus. */
  const terminalClearShortcutLabel = isMacOS
    ? TERMINAL_CLEAR_SHORTCUT_LABEL_MAC
    : TERMINAL_CLEAR_SHORTCUT_LABEL_DEFAULT;
  /** Tracks last auto-search key to prevent debounce-triggered first-match resets. */
  const lastAutoSearchKeyRef = React.useRef<string>('');
  /** Holds deferred find-open timer id so pending callbacks can be canceled on unmount. */
  const deferredFindOpenTimeoutRef = React.useRef<number | null>(null);
  const terminalSearchOptions = React.useMemo(
    () => ({
      caseSensitive: terminalSearchCaseSensitive,
      regex: terminalSearchRegex,
    }),
    [terminalSearchCaseSensitive, terminalSearchRegex],
  );

  // Restore keyboard focus after the SSH tab becomes active so xterm can receive input again.
  React.useEffect(() => {
    if (!isActive) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      focusActiveTerminal();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [connectionState, focusActiveTerminal, isActive]);

  React.useEffect(() => {
    terminalPaneIdsRef.current = terminalPaneIds;
  }, [terminalPaneIds]);

  React.useEffect(() => {
    const startupCommand = connectionIntent.startupCommand?.trim();
    if (
      connectionState !== 'connected' ||
      !startupCommand ||
      dispatchedStartupCommandIntentIdRef.current === connectionIntent.intentId
    ) {
      return;
    }

    const dispatchFrame = window.requestAnimationFrame(() => {
      const didSend = sendInput(`${startupCommand}\r`);
      if (didSend) {
        dispatchedStartupCommandIntentIdRef.current = connectionIntent.intentId;
        focusActiveTerminal();
      }
    });

    return () => {
      window.cancelAnimationFrame(dispatchFrame);
    };
  }, [connectionIntent.intentId, connectionIntent.startupCommand, connectionState, focusActiveTerminal, sendInput]);

  /**
   * Suspends for one short async interval used by pane/socket polling loops.
   *
   * @param milliseconds Delay duration in milliseconds.
   * @returns Promise resolved after the requested delay.
   */
  const delay = React.useCallback((milliseconds: number): Promise<void> => {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }, []);

  /**
   * Waits until split-pane state includes the newly created pane id.
   *
   * @param expectedPaneCount Pane count expected after split.
   * @returns Newest pane id when available, otherwise `null` on timeout.
   */
  const waitForNewestPaneId = React.useCallback(
    async (expectedPaneCount: number): Promise<string | null> => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const currentPaneIds = terminalPaneIdsRef.current;
        if (currentPaneIds.length >= expectedPaneCount) {
          return currentPaneIds[currentPaneIds.length - 1] ?? null;
        }

        await delay(50);
      }

      return null;
    },
    [delay],
  );

  // ---------------------------------------------------------------------------
  // Shared terminal action helpers — used by both the Orbit Bar and the context
  // menu so that behavior is consistent across interaction surfaces.
  // ---------------------------------------------------------------------------

  const copyTextToClipboard = React.useCallback(
    async (text: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(text);
        notifySuccess(t('ssh.selectionBarCopySuccess'));
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('ssh.selectionBarCopyFailed'));
      }
    },
    [notifyError, notifySuccess],
  );

  /**
   * Opens an external URL via Electron shell or browser fallback.
   *
   * @param targetUrl External URL to open.
   * @param failureMessage Localized error message shown when open fails.
   * @returns Nothing.
   */
  const openExternalTarget = React.useCallback(
    (targetUrl: string, failureMessage: string): void => {
      try {
        if (window.electron?.openExternalUrl) {
          void window.electron.openExternalUrl(targetUrl).then((opened) => {
            if (!opened) {
              notifyError(failureMessage);
            }
          });
          return;
        }

        const openedWindow = window.open(targetUrl, '_blank', 'noopener,noreferrer');
        if (!openedWindow) {
          notifyError(failureMessage);
          return;
        }

        openedWindow.opener = null;
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : failureMessage);
      }
    },
    [notifyError],
  );

  const openSearchForText = React.useCallback(
    (text: string): void => {
      try {
        const resolvedSearchUrl = resolveSearchUrl(
          terminalSelectionSettings.searchEngine,
          text,
          terminalSelectionSettings.searchUrlTemplate,
        );
        openExternalTarget(resolvedSearchUrl, t('ssh.selectionBarSearchFailed'));
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('ssh.selectionBarSearchFailed'));
      }
    },
    [
      notifyError,
      openExternalTarget,
      terminalSelectionSettings.searchEngine,
      terminalSelectionSettings.searchUrlTemplate,
    ],
  );

  /**
   * Opens an SFTP tab for the SSH server behind this terminal selection.
   *
   * @param selectionText Terminal selection text to parse as a remote directory path.
   * @returns Nothing.
   */
  const openSelectionDirectoryInSftp = React.useCallback(
    (selectionText: string): void => {
      const directoryPath = resolveSftpDirectoryPathFromSelection(selectionText);
      const serverSnapshot = connectionIntent.lastResolvedSnapshot;

      if (!directoryPath || serverSnapshot?.type !== 'ssh-server' || !onOpenDirectoryInSFTP) {
        notifyWarning(t('ssh.selectionBarOpenDirectoryUnavailable'));
        return;
      }

      onOpenDirectoryInSFTP(serverSnapshot.serverId, serverSnapshot.serverName, directoryPath);
      dismissSelectionBar();
    },
    [connectionIntent.lastResolvedSnapshot, dismissSelectionBar, notifyWarning, onOpenDirectoryInSFTP],
  );

  // ---------------------------------------------------------------------------
  // Orbit Bar (TerminalSelectionBar) handlers
  // ---------------------------------------------------------------------------

  const handleSelectionBarCopy = React.useCallback(async () => {
    if (!selectionAnchor?.selectionText) {
      return;
    }

    await copyTextToClipboard(selectionAnchor.selectionText);
  }, [copyTextToClipboard, selectionAnchor]);

  const handleSelectionBarInsert = React.useCallback(() => {
    if (!selectionAnchor?.selectionText) {
      return;
    }

    pasteInput(selectionAnchor.selectionText);
    focusActiveTerminal();
  }, [focusActiveTerminal, pasteInput, selectionAnchor]);

  const handleSelectionBarSearch = React.useCallback(() => {
    const selectionText = selectionAnchor?.selectionText ?? '';
    if (!selectionText.trim()) {
      return;
    }

    const selectionLink = resolveSelectionLink(selectionText);
    if (selectionLink) {
      openExternalTarget(selectionLink, t('ssh.selectionBarOpenLinkFailed'));
      return;
    }

    openSearchForText(selectionText);
  }, [openExternalTarget, openSearchForText, selectionAnchor]);

  /**
   * Keeps terminal as the default keyboard target even if the selection bar gains focus.
   *
   * @param event Key event originating from within the selection bar subtree.
   * @returns Nothing.
   */
  const handleSelectionBarKeyDownCapture = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dismissSelectionBar();
      focusActiveTerminal();
    },
    [dismissSelectionBar, focusActiveTerminal],
  );

  // ---------------------------------------------------------------------------
  // Context menu handlers
  // ---------------------------------------------------------------------------

  const handleContextMenuCopy = React.useCallback(() => {
    const selectionText = getSelectionText();
    if (!selectionText) {
      return;
    }

    void copyTextToClipboard(selectionText);
  }, [copyTextToClipboard, getSelectionText]);

  const handleContextMenuPaste = React.useCallback(() => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text) {
          pasteInput(text);
          focusActiveTerminal();
        }
      })
      .catch(() => {
        // Clipboard read permission denied or unavailable; silently ignore.
      });
  }, [focusActiveTerminal, pasteInput]);

  const handleContextMenuSearchOnline = React.useCallback(() => {
    const selectionText = getSelectionText();
    if (!selectionText.trim()) {
      return;
    }

    const selectionLink = resolveSelectionLink(selectionText);
    if (selectionLink) {
      openExternalTarget(selectionLink, t('ssh.selectionBarOpenLinkFailed'));
      return;
    }

    openSearchForText(selectionText);
  }, [getSelectionText, openExternalTarget, openSearchForText]);

  const handleContextMenuOpenDirectoryInSftp = React.useCallback(() => {
    openSelectionDirectoryInSftp(getSelectionText());
  }, [getSelectionText, openSelectionDirectoryInSftp]);

  /**
   * Opens in-terminal search palette and optionally seeds query text.
   *
   * @param seedQuery Optional initial query from selection/context menu.
   * @returns Nothing.
   */
  const openTerminalSearchPalette = React.useCallback(
    (seedQuery?: string): void => {
      if (seedQuery && seedQuery.trim()) {
        setTerminalSearchQuery(seedQuery);
      }

      dismissSelectionBar();
      setTerminalSearchOpen(true);
    },
    [dismissSelectionBar],
  );

  const handleSelectionBarFind = React.useCallback(() => {
    openTerminalSearchPalette(selectionAnchor?.selectionText);
  }, [openTerminalSearchPalette, selectionAnchor]);

  /**
   * Executes one in-terminal search action.
   *
   * @param direction Search direction or boundary jump.
   * @returns `true` when a match is found.
   */
  const runTerminalSearch = React.useCallback(
    (direction: TerminalSearchDirection): boolean => {
      const didMatch = findActiveTerminalText(terminalSearchQuery, direction, terminalSearchOptions);
      dismissSelectionBar();

      return didMatch;
    },
    [dismissSelectionBar, findActiveTerminalText, terminalSearchOptions, terminalSearchQuery],
  );

  /**
   * Stable key prefix for query-driven auto-search dedupe across toggle/open state changes.
   */
  const terminalSearchAutoKeyPrefix = React.useMemo((): string => {
    const openToken = terminalSearchOpen ? 'open' : 'closed';
    const caseToken = terminalSearchCaseSensitive ? 'case' : 'nocase';
    const regexToken = terminalSearchRegex ? 'regex' : 'plain';
    return [openToken, caseToken, regexToken].join(':');
  }, [terminalSearchCaseSensitive, terminalSearchOpen, terminalSearchRegex]);

  /**
   * Determines whether keyboard event target is an editable text surface.
   *
   * @param target Native keyboard event target.
   * @returns `true` when the target can receive free-form text input.
   */
  const isEditableKeyboardTarget = React.useCallback((target: EventTarget | null): boolean => {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }, []);

  /**
   * Detects whether keyboard target is xterm's hidden capture textarea.
   *
   * @param target Native keyboard event target.
   * @returns `true` when target is the terminal input capture textarea.
   */
  const isTerminalKeyboardCaptureTarget = React.useCallback((target: EventTarget | null): boolean => {
    return target instanceof HTMLTextAreaElement && target.classList.contains('xterm-helper-textarea');
  }, []);

  /**
   * Detects whether keyboard target belongs to the active terminal surface.
   *
   * @param target Native keyboard event target.
   * @returns `true` when target is inside the terminal container subtree.
   */
  const isTerminalKeyboardTarget = React.useCallback(
    (target: EventTarget | null): boolean => {
      return target instanceof Node && Boolean(terminalContainerRef.current?.contains(target));
    },
    [terminalContainerRef],
  );

  /**
   * Resolves whether keyboard event contains the Cmd/Ctrl modifier for find shortcut.
   *
   * @param event Native keyboard event.
   * @returns `true` when Cmd or Ctrl is pressed.
   */
  const hasFindShortcutModifier = React.useCallback(
    (event: KeyboardEvent): boolean => {
      return isMacOS ? event.metaKey : event.ctrlKey;
    },
    [isMacOS],
  );

  const handleContextMenuFind = React.useCallback(() => {
    const seedQuery = getSelectionText();
    // Defer opening via macrotask so Radix context-menu focus restoration has
    // completed first; this keeps focus on the find palette input.
    if (deferredFindOpenTimeoutRef.current !== null) {
      window.clearTimeout(deferredFindOpenTimeoutRef.current);
    }

    deferredFindOpenTimeoutRef.current = window.setTimeout(() => {
      // Clear ref first so cleanup logic remains source-of-truth for pending timer state.
      deferredFindOpenTimeoutRef.current = null;
      openTerminalSearchPalette(seedQuery);
    }, 0);
  }, [getSelectionText, openTerminalSearchPalette]);

  const handleContextMenuSelectAll = React.useCallback(() => {
    selectAll();
  }, [selectAll]);

  const handleContextMenuClearTerminal = React.useCallback(() => {
    clearTerminalScreen();
    focusActiveTerminal();
  }, [clearTerminalScreen, focusActiveTerminal]);

  /**
   * Keeps query-driven search responsive by debouncing first-match jump with
   * `TERMINAL_SEARCH_DEBOUNCE_MS` while users are typing in the palette input.
   */
  React.useEffect(() => {
    const normalizedQuery = terminalSearchQuery.trim();
    if (!terminalSearchOpen || !normalizedQuery) {
      lastAutoSearchKeyRef.current = '';
      return;
    }

    const autoSearchKey = `${terminalSearchAutoKeyPrefix}:${normalizedQuery}`;
    if (lastAutoSearchKeyRef.current === autoSearchKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      lastAutoSearchKeyRef.current = autoSearchKey;
      runTerminalSearch('first');
    }, TERMINAL_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [runTerminalSearch, terminalSearchAutoKeyPrefix, terminalSearchOpen, terminalSearchQuery]);

  /**
   * Clears search highlights when query is empty or palette is closed.
   */
  React.useEffect(() => {
    const hasQuery = terminalSearchQuery.trim().length > 0;
    if (terminalSearchOpen && hasQuery) {
      return;
    }

    clearActiveTerminalSearch();
  }, [clearActiveTerminalSearch, terminalSearchOpen, terminalSearchQuery]);

  /**
   * Registers Cmd/Ctrl+Shift+F shortcut to open in-terminal search for the active SSH page.
   */
  React.useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent): void => {
      const isTerminalCaptureTarget = isTerminalKeyboardCaptureTarget(event.target);
      const isTerminalTarget = isTerminalKeyboardTarget(event.target);
      const isEditableTarget = isEditableKeyboardTarget(event.target);
      if (isEditableTarget && !isTerminalCaptureTarget && !isTerminalTarget) {
        return;
      }

      const isFindKey = event.code === 'KeyF' || event.key.toLowerCase() === 'f';
      if (!isActive || event.repeat || event.altKey || !event.shiftKey || !isFindKey) {
        return;
      }

      const hasModifier = hasFindShortcutModifier(event);
      if (!hasModifier) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openTerminalSearchPalette(getSelectionText());
    };

    window.addEventListener('keydown', handleSearchShortcut, true);

    return () => {
      window.removeEventListener('keydown', handleSearchShortcut, true);
    };
  }, [
    getSelectionText,
    hasFindShortcutModifier,
    isActive,
    isEditableKeyboardTarget,
    isTerminalKeyboardCaptureTarget,
    isTerminalKeyboardTarget,
    openTerminalSearchPalette,
  ]);

  /**
   * Registers Ctrl+Shift+C/V terminal clipboard shortcuts on non-macOS platforms.
   */
  React.useEffect(() => {
    if (isMacOS) {
      return;
    }

    const handleTerminalClipboardShortcut = (event: KeyboardEvent): void => {
      const isTerminalCaptureTarget = isTerminalKeyboardCaptureTarget(event.target);
      const isTerminalTarget = isTerminalKeyboardTarget(event.target);
      const isEditableTarget = isEditableKeyboardTarget(event.target);
      if (isEditableTarget && !isTerminalCaptureTarget && !isTerminalTarget) {
        return;
      }

      if (!isActive || event.repeat || event.altKey || event.metaKey || !event.ctrlKey || !event.shiftKey) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();
      const isCopyKey = normalizedKey === 'c' || event.code === 'KeyC';
      if (isCopyKey) {
        const selectionText = getSelectionText();
        if (!selectionText) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void copyTextToClipboard(selectionText);
        return;
      }

      const isPasteKey = normalizedKey === 'v' || event.code === 'KeyV';
      if (!isPasteKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleContextMenuPaste();
    };

    window.addEventListener('keydown', handleTerminalClipboardShortcut, true);

    return () => {
      window.removeEventListener('keydown', handleTerminalClipboardShortcut, true);
    };
  }, [
    copyTextToClipboard,
    getSelectionText,
    handleContextMenuPaste,
    isActive,
    isEditableKeyboardTarget,
    isMacOS,
    isTerminalKeyboardCaptureTarget,
    isTerminalKeyboardTarget,
  ]);

  React.useEffect(() => {
    return () => {
      if (deferredFindOpenTimeoutRef.current !== null) {
        window.clearTimeout(deferredFindOpenTimeoutRef.current);
        deferredFindOpenTimeoutRef.current = null;
      }
    };
  }, []);

  const handleDeleteRecentCommand = React.useCallback(
    (command: string) => {
      deleteHistoryCommand(command);
    },
    [deleteHistoryCommand],
  );

  /**
   * Converts sidebar command actions into terminal input payloads.
   *
   * @param command Raw command text selected from history.
   * @param shouldRun Whether command should auto-submit with Enter.
   * @returns Input payload written to terminal websocket.
   */
  const buildRecentCommandPayload = React.useCallback((command: string, shouldRun: boolean): string => {
    return shouldRun ? `${command}\r` : command;
  }, []);

  /**
   * Sends a history command to one pane and focuses that pane terminal.
   *
   * @param command Command text selected in history panel.
   * @param paneId Target pane id.
   * @param shouldRun Whether command should auto-submit with Enter.
   * @returns `true` when command payload is sent to an open socket.
   */
  const dispatchRecentCommandToPane = React.useCallback(
    (command: string, paneId: string, shouldRun: boolean): boolean => {
      activatePane(paneId);
      const didSend = sendInput(buildRecentCommandPayload(command, shouldRun));
      focusActiveTerminal();
      return didSend;
    },
    [activatePane, buildRecentCommandPayload, focusActiveTerminal, sendInput],
  );

  /**
   * Splits one pane and retries command dispatch to the new pane until ready.
   *
   * @param command Command text selected in history panel.
   * @param shouldRun Whether command should auto-submit with Enter.
   * @returns Nothing.
   */
  const splitTerminalAndDispatchRecentCommand = React.useCallback(
    (command: string, shouldRun: boolean): void => {
      if (!canSplitTerminal) {
        return;
      }

      const expectedPaneCount = terminalPaneIdsRef.current.length + 1;
      splitPane();

      void (async () => {
        const newestPaneId = await waitForNewestPaneId(expectedPaneCount);
        if (!newestPaneId) {
          notifyWarning(t(shouldRun ? 'ssh.historySplitTerminalAndRunFailed' : 'ssh.historySplitTerminalAndAddFailed'));
          return;
        }

        for (let attempt = 0; attempt < 30; attempt += 1) {
          const didSend = dispatchRecentCommandToPane(command, newestPaneId, shouldRun);
          if (didSend) {
            return;
          }

          await delay(75);
        }

        notifyWarning(t(shouldRun ? 'ssh.historySplitTerminalAndRunFailed' : 'ssh.historySplitTerminalAndAddFailed'));
      })();
    },
    [canSplitTerminal, delay, dispatchRecentCommandToPane, notifyWarning, splitPane, waitForNewestPaneId],
  );

  const handleInsertRecentCommand = React.useCallback(
    (command: string) => {
      dispatchRecentCommandToPane(command, activePaneId, false);
    },
    [activePaneId, dispatchRecentCommandToPane],
  );

  const handleInsertRecentCommandToPane = React.useCallback(
    (command: string, paneId: string) => {
      dispatchRecentCommandToPane(command, paneId, false);
    },
    [dispatchRecentCommandToPane],
  );

  const handleRunRecentCommand = React.useCallback(
    (command: string) => {
      dispatchRecentCommandToPane(command, activePaneId, true);
    },
    [activePaneId, dispatchRecentCommandToPane],
  );

  const handleRunRecentCommandToPane = React.useCallback(
    (command: string, paneId: string) => {
      dispatchRecentCommandToPane(command, paneId, true);
    },
    [dispatchRecentCommandToPane],
  );

  const handleSplitTerminalAndInsertRecentCommand = React.useCallback(
    (command: string) => {
      splitTerminalAndDispatchRecentCommand(command, false);
    },
    [splitTerminalAndDispatchRecentCommand],
  );

  const handleSplitTerminalAndRunRecentCommand = React.useCallback(
    (command: string) => {
      splitTerminalAndDispatchRecentCommand(command, true);
    },
    [splitTerminalAndDispatchRecentCommand],
  );

  const handleSelectionBarDragStart = React.useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      if (!selectionAnchor?.selectionText) {
        event.preventDefault();
        return;
      }

      const escapedHtml = selectionAnchor.selectionText
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
        .replaceAll('\n', '<br/>');

      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData(INTERNAL_TERMINAL_TEXT_DRAG_MIME, '1');
      event.dataTransfer.setData('text/plain', selectionAnchor.selectionText);
      event.dataTransfer.setData('text', selectionAnchor.selectionText);
      event.dataTransfer.setData('text/unicode', selectionAnchor.selectionText);
      event.dataTransfer.setData('text/html', `<pre>${escapedHtml}</pre>`);

      // Dragging the handle can steal focus from xterm; restore it so keyboard shortcuts keep working.
      focusActiveTerminal();
    },
    [focusActiveTerminal, selectionAnchor],
  );

  const handleSelectionBarClose = React.useCallback(() => {
    dismissSelectionBar();
  }, [dismissSelectionBar]);

  const handleSelectionOpenDirectory = React.useCallback(() => {
    openSelectionDirectoryInSftp(selectionAnchor?.selectionText ?? '');
  }, [openSelectionDirectoryInSftp, selectionAnchor]);

  const handleSelectionAskAi = React.useCallback(() => {
    notifyWarning(t('ssh.selectionBarAskAiComingSoon'));
  }, [notifyWarning]);

  const handleTerminalSearchPrevious = React.useCallback(() => {
    runTerminalSearch('previous');
  }, [runTerminalSearch]);

  const handleTerminalSearchNext = React.useCallback(() => {
    runTerminalSearch('next');
  }, [runTerminalSearch]);

  const handleTerminalSearchFirst = React.useCallback(() => {
    runTerminalSearch('first');
  }, [runTerminalSearch]);

  const handleTerminalSearchLast = React.useCallback(() => {
    runTerminalSearch('last');
  }, [runTerminalSearch]);

  const terminalSearchFooter = (
    <div className="flex w-full items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Toggle
          pressed={terminalSearchCaseSensitive}
          onPressedChange={setTerminalSearchCaseSensitive}
        >
          <TextSelect className="h-4 w-4" />
          {t('ssh.terminalSearchCaseSensitive')}
        </Toggle>
        <Toggle
          pressed={terminalSearchRegex}
          onPressedChange={setTerminalSearchRegex}
        >
          <ScanSearch className="h-4 w-4" />
          {t('ssh.terminalSearchRegex')}
        </Toggle>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button
          aria-label={t('ssh.terminalSearchFirst')}
          variant="ghostIcon"
          onClick={handleTerminalSearchFirst}
        >
          <ChevronsUp className="h-4 w-4" />
        </Button>
        <Button
          aria-label={t('ssh.terminalSearchPrevious')}
          variant="ghostIcon"
          onClick={handleTerminalSearchPrevious}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          aria-label={t('ssh.terminalSearchNext')}
          variant="ghostIcon"
          onClick={handleTerminalSearchNext}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          aria-label={t('ssh.terminalSearchLast')}
          variant="ghostIcon"
          onClick={handleTerminalSearchLast}
        >
          <ChevronsDown className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const handleTerminalTextDrop = React.useCallback(
    (droppedText: string) => {
      pasteInput(droppedText);
      focusActiveTerminal();
    },
    [focusActiveTerminal, pasteInput],
  );

  const selectionText = selectionAnchor?.selectionText ?? '';
  const selectionLink = resolveSelectionLink(selectionText);
  const selectedSftpDirectoryPath = resolveSftpDirectoryPathFromSelection(selectionText);
  const canOpenSelectionDirectoryInSftp =
    Boolean(selectedSftpDirectoryPath) &&
    connectionIntent.lastResolvedSnapshot?.type === 'ssh-server' &&
    Boolean(onOpenDirectoryInSFTP);
  const selectionBarSearchLabel = selectionLink ? t('ssh.selectionBarOpenLink') : t('ssh.selectionBarSearch');
  const contextMenuSearchLabel = selectionLink ? t('ssh.contextMenuOpenLink') : t('ssh.contextMenuSearchOnline');

  const {
    isVisible: isTextDropZoneVisible,
    isActive: isTextDropZoneActive,
    centerX: textDropZoneCenterX,
    handleWrapperDragEnter,
    handleWrapperDragOver,
    handleWrapperDragLeave,
    handleWrapperDrop,
    handleZoneDragEnter: handleTextDropZoneDragEnter,
    handleZoneDragOver: handleTextDropZoneDragOver,
    handleZoneDragLeave: handleTextDropZoneDragLeave,
    handleZoneDrop: handleTextDropZoneDrop,
  } = useTerminalTextDropZone({
    mode: terminalTextDropMode,
    isConnected: connectionState === 'connected',
    wrapperRef,
    terminalContainerRef,
    internalDragMimeType: INTERNAL_TERMINAL_TEXT_DRAG_MIME,
    onDropText: handleTerminalTextDrop,
  });

  // Card style
  const cardStyle = 'bg-ssh-card-bg-terminal h-full w-full flex-1 overflow-hidden rounded-[18px] p-1';
  const shouldSuppressOrbitBar = terminalSearchOpen;

  return (
    <div
      ref={wrapperRef}
      className="relative flex h-full w-full gap-2.5"
      onDragEnter={handleWrapperDragEnter}
      onDragOver={handleWrapperDragOver}
      onDragLeave={handleWrapperDragLeave}
      onDrop={handleWrapperDrop}
    >
      {/* SSH */}
      <div className={classNames(cardStyle, 'min-w-0')}>
        <SSHTerminalPaneLayout
          terminalPaneIds={terminalPaneIds}
          activePaneId={activePaneId}
          hasSelection={!!selectionAnchor?.selectionText}
          isConnected={connectionState === 'connected'}
          canSplitTerminal={canSplitTerminal}
          copyShortcutLabel={terminalCopyShortcutLabel}
          pasteShortcutLabel={terminalPasteShortcutLabel}
          findShortcutLabel={terminalFindShortcutLabel}
          clearTerminalShortcutLabel={terminalClearShortcutLabel}
          searchOnlineLabel={contextMenuSearchLabel}
          openDirectoryInSftpLabel={t('ssh.contextMenuOpenDirectoryInSftp')}
          canOpenDirectoryInSftp={canOpenSelectionDirectoryInSftp}
          setPaneContainerElement={setPaneContainerElement}
          setPrimaryPaneContainer={setPrimaryPaneContainer}
          onPaneActivate={activatePane}
          onCopy={(paneId) => {
            activatePane(paneId);
            handleContextMenuCopy();
          }}
          onPaste={(paneId) => {
            activatePane(paneId);
            handleContextMenuPaste();
          }}
          onSearchOnline={(paneId) => {
            activatePane(paneId);
            handleContextMenuSearchOnline();
          }}
          onOpenDirectoryInSftp={(paneId) => {
            activatePane(paneId);
            handleContextMenuOpenDirectoryInSftp();
          }}
          onFind={(paneId) => {
            activatePane(paneId);
            handleContextMenuFind();
          }}
          onSelectAll={(paneId) => {
            activatePane(paneId);
            handleContextMenuSelectAll();
          }}
          onClearTerminal={(paneId) => {
            activatePane(paneId);
            handleContextMenuClearTerminal();
          }}
          onSplitPane={(paneId) => {
            activatePane(paneId);
            splitPane();
          }}
          onClosePane={(paneId) => {
            activatePane(paneId);
            closePane(paneId);
          }}
        />
      </div>

      <TerminalAutocompleteMenu
        ref={autocompleteMenuRef}
        open={
          connectionState === 'connected' &&
          terminalAutoCompleteEnabled &&
          autocompleteItems.length > 0 &&
          autocompleteAnchor !== null
        }
        anchorTop={autocompleteAnchor?.top ?? 0}
        anchorLeft={autocompleteAnchor?.left ?? 0}
        panelWidth={autocompleteAnchor?.panelWidth ?? 340}
        renderAbove={autocompleteAnchor?.renderAbove ?? false}
        items={autocompleteItems}
        onItemSelect={acceptAutocompleteAtIndex}
      />

      {connectionState === 'connected' ? (
        <CommandPalette
          closeOnEsc
          hideItemList
          open={terminalSearchOpen}
          query={terminalSearchQuery}
          placeholder={t('ssh.terminalSearchPlaceholder')}
          items={[]}
          footer={terminalSearchFooter}
          onInputArrowUp={handleTerminalSearchPrevious}
          onInputArrowDown={handleTerminalSearchNext}
          onOpenChange={(open) => {
            setTerminalSearchOpen(open);
            if (!open) {
              setTerminalSearchQuery('');
            }
          }}
          onQueryChange={setTerminalSearchQuery}
        />
      ) : null}

      {connectionState === 'connected' &&
      terminalSelectionSettings.enabled &&
      selectionAnchor &&
      selectionBarPosition &&
      !shouldSuppressOrbitBar &&
      dismissedSelectionText !== selectionAnchor.selectionText ? (
        <div
          className="pointer-events-none absolute z-40"
          style={{
            top: `${selectionBarPosition.top}px`,
            left: `${selectionBarPosition.left}px`,
          }}
          onClick={focusActiveTerminal}
          onKeyDownCapture={handleSelectionBarKeyDownCapture}
        >
          <TerminalSelectionBar
            ref={selectionBarRef}
            selectedText={selectionAnchor.selectionText}
            canOpenDirectory={canOpenSelectionDirectoryInSftp}
            dragLabel={t('ssh.selectionBarDrag')}
            copyLabel={t('ssh.selectionBarCopy')}
            insertLabel={t('ssh.selectionBarInsert')}
            openDirectoryLabel={t('ssh.selectionBarOpenDirectory')}
            searchLabel={selectionBarSearchLabel}
            findLabel={t('ssh.selectionBarFind')}
            askAiLabel={t('ssh.selectionBarAskAiLabel')}
            closeLabel={t('ssh.selectionBarClose')}
            onDragStart={handleSelectionBarDragStart}
            onCopy={() => {
              void handleSelectionBarCopy();
            }}
            onInsert={handleSelectionBarInsert}
            onOpenDirectory={handleSelectionOpenDirectory}
            onSearch={handleSelectionBarSearch}
            onFind={handleSelectionBarFind}
            onAskAi={handleSelectionAskAi}
            onClose={handleSelectionBarClose}
          />
        </div>
      ) : null}

      {connectionState === 'connected' && isTextDropZoneVisible ? (
        <TerminalTextDropZone
          centerX={textDropZoneCenterX ?? 0}
          label={t('ssh.dropTextToTerminal')}
          active={isTextDropZoneActive}
          onDragEnter={handleTextDropZoneDragEnter}
          onDragOver={handleTextDropZoneDragOver}
          onDragLeave={handleTextDropZoneDragLeave}
          onDrop={handleTextDropZoneDrop}
        />
      ) : null}

      <SSHSidebar
        telemetryState={telemetryState}
        terminalPaneIds={terminalPaneIds}
        activePaneId={activePaneId}
        canSplitTerminal={canSplitTerminal}
        onInsertRecentCommand={handleInsertRecentCommand}
        onInsertRecentCommandToPane={handleInsertRecentCommandToPane}
        onSplitTerminalAndInsertRecentCommand={handleSplitTerminalAndInsertRecentCommand}
        onRunRecentCommand={handleRunRecentCommand}
        onRunRecentCommandToPane={handleRunRecentCommandToPane}
        onSplitTerminalAndRunRecentCommand={handleSplitTerminalAndRunRecentCommand}
        onDeleteRecentCommand={handleDeleteRecentCommand}
      />

      {connectionState !== 'connected' ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-between bg-bg px-4 py-12">
          <div></div>
          <div className="text-sm text-header-text">
            {connectionState === 'connecting' ? t('ssh.connecting') : connectionError}
          </div>
          <div
            className={classNames(
              'flex items-center justify-center',
              connectionState === 'connecting' ? 'invisible' : '',
            )}
          >
            <Menubar>
              <Button onClick={retryConnection}>
                <RefreshCw size={16} />
                {t('ssh.retry')}
              </Button>
            </Menubar>
          </div>
        </div>
      ) : null}

      <Dialog
        open={hostFingerprintPrompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            resolveHostFingerprintPrompt(false);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            resolveHostFingerprintPrompt(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('ssh.hostFingerprintDialogTitle')}</DialogTitle>
            <DialogDescription>{t('ssh.hostFingerprintDialogDescription')}</DialogDescription>
          </DialogHeader>

          {hostFingerprintPrompt ? (
            <div className="space-y-2 rounded-md border border-home-divider p-3 text-sm">
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogHost')}: </span>
                <span>
                  {hostFingerprintPrompt.host}:{hostFingerprintPrompt.port}
                </span>
              </div>
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogAlgorithm')}: </span>
                <span>{hostFingerprintPrompt.algorithm}</span>
              </div>
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogFingerprint')}: </span>
                <span className="break-all">{hostFingerprintPrompt.fingerprint}</span>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <DialogSecondaryButton onClick={() => resolveHostFingerprintPrompt(false)}>
              {t('ssh.hostFingerprintDialogCancel')}
            </DialogSecondaryButton>
            <DialogPrimaryButton onClick={() => resolveHostFingerprintPrompt(true)}>
              {t('ssh.hostFingerprintDialogTrustContinue')}
            </DialogPrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={terminalClipboardPrompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            resolveTerminalClipboardPrompt(false);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            resolveTerminalClipboardPrompt(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                terminalClipboardPrompt?.operation === 'read'
                  ? 'ssh.terminalClipboard.readPromptTitle'
                  : 'ssh.terminalClipboard.writePromptTitle',
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                terminalClipboardPrompt?.operation === 'read'
                  ? 'ssh.terminalClipboard.readPromptDescription'
                  : 'ssh.terminalClipboard.writePromptDescription',
                {
                  source: terminalClipboardPrompt?.sourceLabel ?? t('tabs.page.ssh'),
                },
              )}
            </DialogDescription>
          </DialogHeader>

          {terminalClipboardPrompt?.operation === 'write' && terminalClipboardPrompt.preview ? (
            <div className="rounded-md border border-home-divider p-3 text-sm text-home-text-subtle">
              <div className="text-home-text mb-1">{t('ssh.terminalClipboard.previewLabel')}</div>
              <div className="break-words">{terminalClipboardPrompt.preview}</div>
            </div>
          ) : null}

          <DialogFooter>
            <DialogSecondaryButton onClick={() => resolveTerminalClipboardPrompt(false)}>
              {t('ssh.terminalClipboard.deny')}
            </DialogSecondaryButton>
            <DialogPrimaryButton onClick={() => resolveTerminalClipboardPrompt(true)}>
              {t('ssh.terminalClipboard.allow')}
            </DialogPrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SSH;
