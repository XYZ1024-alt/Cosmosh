import type { IMarker, Terminal } from '@xterm/xterm';

import type {
  ServerInboundMessage,
  TerminalCommandMarker,
  TerminalCommandTimelineModel,
  TerminalPaneRuntime,
} from './ssh-types';
import { resolvePromptCommandStartOffset } from './ssh-utils';

const COMMAND_TIMELINE_MIN_BAR_WIDTH = 8;
const COMMAND_TIMELINE_MAX_BAR_WIDTH = 28;
const COMMAND_TIMELINE_BAR_GROWTH = 4;
const COMMAND_TIMELINE_MIN_VISIBLE_COMMANDS = 3;

/**
 * Records the current normal-buffer input row until a trusted helper confirms
 * that the submitted line started a command.
 *
 * Wrapped rows are anchored at the first physical row so navigation reveals
 * the prompt and complete input instead of only the final wrapped segment.
 *
 * @param runtime Source pane runtime.
 * @param recordedAt Local input timestamp.
 * @returns `true` when xterm accepted a pending marker.
 */
export const recordPendingCommandMarker = (runtime: TerminalPaneRuntime, recordedAt: number): boolean => {
  const buffer = runtime.terminal.buffer.active;
  if (buffer.type !== 'normal') {
    return false;
  }

  const cursorLine = buffer.baseY + buffer.cursorY;
  let inputLine = cursorLine;
  while (inputLine > 0 && buffer.getLine(inputLine)?.isWrapped) {
    inputLine -= 1;
  }

  const marker = runtime.terminal.registerMarker(inputLine - cursorLine);
  if (!marker || marker.line < 0) {
    return false;
  }

  runtime.pendingCommandMarkers.push({ marker, recordedAt });
  marker.onDispose(() => {
    removeDisposedInputMarker(runtime, marker);
  });
  runtime.refreshCommandTimeline();
  return true;
};

/**
 * Applies a trusted remote shell lifecycle event to one pane's command markers.
 *
 * A command becomes visible only when `command-start` can consume a local Enter
 * marker. The helper's sanitized executable name is intentionally not used as
 * display text; the complete rendered input is reconstructed from xterm and
 * remains renderer-memory-only.
 *
 * @param runtime Source pane runtime.
 * @param payload Trusted command lifecycle or prompt event.
 * @param receivedAt Local event receipt timestamp.
 * @param promptPrefixRegex Optional user-configured prompt prefix matcher.
 * @returns `true` when the marker collection changed.
 */
export const applyRemoteCommandMarkerEvent = (
  runtime: TerminalPaneRuntime,
  payload: Extract<ServerInboundMessage, { type: 'remote-shell-event' }>,
  receivedAt: number,
  promptPrefixRegex: RegExp | null = null,
): boolean => {
  if (payload.event === 'prompt-ready') {
    return clearPendingCommandMarkers(runtime);
  }

  if (payload.event === 'command-start') {
    if (runtime.commandMarkers.some((entry) => entry.commandId === payload.commandId)) {
      return false;
    }

    const pendingCandidate = runtime.pendingCommandMarkers.find(
      (entry) => entry.marker.line >= 0 && entry.recordedAt <= receivedAt,
    );
    if (!pendingCandidate) {
      return false;
    }

    const outputStartMarker = runtime.terminal.registerMarker(0);
    if (!outputStartMarker || outputStartMarker.line < 0) {
      return false;
    }

    const command = readRenderedCommand(
      runtime.terminal,
      pendingCandidate.marker.line,
      outputStartMarker.line,
      promptPrefixRegex,
    );
    const consumedPendingMarkers = runtime.pendingCommandMarkers.filter((entry) => entry.recordedAt <= receivedAt);
    runtime.pendingCommandMarkers = runtime.pendingCommandMarkers.filter((entry) => entry.recordedAt > receivedAt);
    consumedPendingMarkers.forEach((entry) => {
      if (entry !== pendingCandidate) {
        disposeMarker(entry.marker);
      }
    });

    if (!command) {
      disposeMarker(pendingCandidate.marker);
      disposeMarker(outputStartMarker);
      runtime.refreshCommandTimeline();
      return true;
    }

    runtime.commandMarkers.push({
      commandId: payload.commandId,
      command,
      inputMarker: pendingCandidate.marker,
      outputStartMarker,
      outputEndMarker: null,
      startedAt: receivedAt,
      endedAt: null,
      durationMs: null,
      exitCode: null,
    });
    runtime.refreshCommandTimeline();
    return true;
  }

  if (payload.event !== 'command-end') {
    return false;
  }

  const existing = runtime.commandMarkers.find((entry) => entry.commandId === payload.commandId);
  if (!existing || existing.outputEndMarker) {
    return false;
  }

  const outputEndMarker = runtime.terminal.registerMarker(0);
  if (!outputEndMarker || outputEndMarker.line < 0) {
    return false;
  }

  existing.outputEndMarker = outputEndMarker;
  existing.endedAt = receivedAt;
  existing.durationMs = payload.durationMs;
  existing.exitCode = payload.exitCode;
  runtime.refreshCommandTimeline();
  return true;
};

/**
 * Clears every pending and confirmed command marker owned by one connection.
 *
 * Command strings are blanked before marker disposal so reconnects, trust loss,
 * and pane teardown do not leave sensitive input reachable through stale marker
 * objects.
 *
 * @param runtime Pane runtime whose command history must be released.
 * @returns `true` when any pending or confirmed marker was removed.
 */
export const clearTerminalCommandMarkers = (runtime: TerminalPaneRuntime): boolean => {
  const pendingMarkers = runtime.pendingCommandMarkers.splice(0);
  const commandMarkers = runtime.commandMarkers.splice(0);
  if (pendingMarkers.length === 0 && commandMarkers.length === 0) {
    return false;
  }

  commandMarkers.forEach((entry) => {
    entry.command = '';
  });
  pendingMarkers.forEach((entry) => disposeMarker(entry.marker));
  commandMarkers.forEach(disposeCommandMarker);
  runtime.refreshCommandTimeline();
  return true;
};

/**
 * Creates the pane-local model rendered by the right-side command timeline.
 *
 * @param runtime Source pane runtime.
 * @param railReserved Whether trusted Remote Enhancements currently reserve the command rail.
 * @returns Rail/content visibility, timeline items, active item, and navigation bounds.
 */
export const createTerminalCommandTimelineModel = (
  runtime: TerminalPaneRuntime,
  railReserved: boolean,
): TerminalCommandTimelineModel => {
  const alternateScreenActive = runtime.terminal.buffer.active.type === 'alternate';
  if (!railReserved) {
    return {
      railReserved: false,
      historyVisible: false,
      alternateScreenActive,
      items: [],
      activeCommandId: null,
      canNavigatePrevious: false,
      canNavigateNext: false,
    };
  }

  const entries = resolveValidCommandMarkers(runtime);
  const items = entries.map((entry) => {
    const outputRows = resolveOutputRowCount(runtime.terminal, entry);
    return {
      commandId: entry.commandId,
      command: entry.command,
      inputLine: entry.inputMarker.line,
      outputRows,
      barWidth: resolveCommandTimelineBarWidth(outputRows),
    };
  });
  const historyVisible =
    !alternateScreenActive &&
    entries.length >= COMMAND_TIMELINE_MIN_VISIBLE_COMMANDS &&
    runtime.terminal.buffer.normal.baseY > 0;
  const activeIndex = resolveActiveCommandIndex(runtime.terminal, entries);

  return {
    railReserved: true,
    historyVisible,
    alternateScreenActive,
    items,
    activeCommandId: historyVisible && activeIndex >= 0 ? (entries[activeIndex]?.commandId ?? null) : null,
    canNavigatePrevious: historyVisible && activeIndex > 0,
    canNavigateNext: historyVisible && activeIndex >= 0 && activeIndex < entries.length - 1,
  };
};

/**
 * Maps command output rows to the compact logarithmic marker width required by
 * the timeline visual contract.
 *
 * @param outputRows Number of normal-buffer rows produced by the command.
 * @returns Width in CSS pixels, clamped to the 8-28 px range.
 */
export const resolveCommandTimelineBarWidth = (outputRows: number): number => {
  const normalizedRows = Math.max(0, outputRows);
  return Math.min(
    COMMAND_TIMELINE_MAX_BAR_WIDTH,
    Math.max(
      COMMAND_TIMELINE_MIN_BAR_WIDTH,
      COMMAND_TIMELINE_MIN_BAR_WIDTH + COMMAND_TIMELINE_BAR_GROWTH * Math.log2(normalizedRows + 1),
    ),
  );
};

/**
 * Scrolls one pane to a specific trusted command input row.
 *
 * @param runtime Source pane runtime.
 * @param commandId Command marker identifier selected by the timeline.
 * @returns `true` when a retained input marker was revealed.
 */
export const scrollToTerminalCommandMarker = (runtime: TerminalPaneRuntime, commandId: string): boolean => {
  const target = resolveValidCommandMarkers(runtime).find((entry) => entry.commandId === commandId);
  if (!target) {
    return false;
  }

  runtime.terminal.scrollToLine(target.inputMarker.line);
  runtime.refreshCommandTimeline();
  return true;
};

/**
 * Scrolls one pane to the adjacent trusted command without wrapping at either
 * end of the timeline.
 *
 * @param runtime Source pane runtime.
 * @param direction Direction relative to the command at the viewport anchor.
 * @returns `true` when an adjacent marker was found and revealed.
 */
export const navigateTerminalCommandMarker = (
  runtime: TerminalPaneRuntime,
  direction: 'previous' | 'next',
): boolean => {
  const entries = resolveValidCommandMarkers(runtime);
  const activeIndex = resolveActiveCommandIndex(runtime.terminal, entries);
  const targetIndex = direction === 'previous' ? activeIndex - 1 : activeIndex + 1;
  const target = entries[targetIndex];
  if (!target) {
    return false;
  }

  runtime.terminal.scrollToLine(target.inputMarker.line);
  runtime.refreshCommandTimeline();
  return true;
};

/**
 * Removes a pending or confirmed entry after its input marker leaves xterm
 * scrollback.
 *
 * @param runtime Owning pane runtime.
 * @param marker Disposed input marker.
 * @returns Nothing.
 */
const removeDisposedInputMarker = (runtime: TerminalPaneRuntime, marker: IMarker): void => {
  const pendingIndex = runtime.pendingCommandMarkers.findIndex((entry) => entry.marker === marker);
  if (pendingIndex >= 0) {
    runtime.pendingCommandMarkers.splice(pendingIndex, 1);
    runtime.refreshCommandTimeline();
    return;
  }

  const commandIndex = runtime.commandMarkers.findIndex((entry) => entry.inputMarker === marker);
  if (commandIndex < 0) {
    return;
  }

  const [removed] = runtime.commandMarkers.splice(commandIndex, 1);
  if (!removed) {
    return;
  }

  removed.command = '';
  disposeMarker(removed.outputStartMarker);
  if (removed.outputEndMarker) {
    disposeMarker(removed.outputEndMarker);
  }
  runtime.refreshCommandTimeline();
};

/**
 * Clears unmatched Enter markers when the shell returns to a prompt without a
 * corresponding command-start event.
 *
 * @param runtime Source pane runtime.
 * @returns `true` when pending markers were removed.
 */
const clearPendingCommandMarkers = (runtime: TerminalPaneRuntime): boolean => {
  const pendingMarkers = runtime.pendingCommandMarkers.splice(0);
  if (pendingMarkers.length === 0) {
    return false;
  }

  pendingMarkers.forEach((entry) => disposeMarker(entry.marker));
  runtime.refreshCommandTimeline();
  return true;
};

/**
 * Reads the rendered command between its input and output-start markers.
 *
 * @param terminal Source terminal instance.
 * @param inputLine First physical row containing the prompt and command.
 * @param outputStartLine First physical output row after submitted input.
 * @param promptPrefixRegex Optional user prompt matcher.
 * @returns Complete displayed command with the leading prompt removed.
 */
const readRenderedCommand = (
  terminal: Terminal,
  inputLine: number,
  outputStartLine: number,
  promptPrefixRegex: RegExp | null,
): string => {
  const buffer = terminal.buffer.normal;
  const lastInputLine = Math.min(outputStartLine - 1, buffer.length - 1);
  if (inputLine < 0 || lastInputLine < inputLine) {
    return '';
  }

  let renderedInput = '';
  for (let lineIndex = inputLine; lineIndex <= lastInputLine; lineIndex += 1) {
    const line = buffer.getLine(lineIndex);
    if (!line) {
      continue;
    }

    if (lineIndex > inputLine && !line.isWrapped) {
      renderedInput += '\n';
    }
    renderedInput += line.translateToString(true);
  }

  const commandStartOffset = resolvePromptCommandStartOffset(renderedInput, { promptPrefixRegex });
  const command = renderedInput.slice(commandStartOffset).trimEnd();
  return command.trim().length > 0 ? command : '';
};

/**
 * Returns confirmed markers whose full navigation geometry remains retained.
 *
 * @param runtime Source pane runtime.
 * @returns Valid markers in submission order.
 */
const resolveValidCommandMarkers = (runtime: TerminalPaneRuntime): TerminalCommandMarker[] =>
  runtime.commandMarkers.filter(
    (entry) => entry.command.length > 0 && entry.inputMarker.line >= 0 && entry.outputStartMarker.line >= 0,
  );

/**
 * Resolves the command nearest the vertical center of the normal viewport.
 *
 * @param terminal Source terminal instance.
 * @param entries Valid command marker collection.
 * @returns Active entry index, or `-1` when no entries remain.
 */
const resolveActiveCommandIndex = (terminal: Terminal, entries: TerminalCommandMarker[]): number => {
  if (entries.length === 0) {
    return -1;
  }

  const normalBuffer = terminal.buffer.normal;
  if (normalBuffer.baseY > 0 && normalBuffer.viewportY === normalBuffer.baseY) {
    return entries.length - 1;
  }

  const viewportAnchorLine = normalBuffer.viewportY + Math.floor(terminal.rows / 2);
  let activeIndex = 0;
  entries.forEach((entry, index) => {
    if (entry.inputMarker.line <= viewportAnchorLine) {
      activeIndex = index;
    }
  });
  return activeIndex;
};

/**
 * Measures output using completed lifecycle geometry or the current normal
 * cursor for a running command.
 *
 * @param terminal Source terminal instance.
 * @param entry Confirmed command marker.
 * @returns Non-negative output row count.
 */
const resolveOutputRowCount = (terminal: Terminal, entry: TerminalCommandMarker): number => {
  const outputEndLine =
    entry.outputEndMarker && entry.outputEndMarker.line >= 0
      ? entry.outputEndMarker.line
      : terminal.buffer.normal.baseY + terminal.buffer.normal.cursorY;
  return Math.max(0, outputEndLine - entry.outputStartMarker.line);
};

/**
 * Disposes all structural markers owned by one confirmed command.
 *
 * @param entry Command marker to release.
 * @returns Nothing.
 */
const disposeCommandMarker = (entry: TerminalCommandMarker): void => {
  disposeMarker(entry.inputMarker);
  disposeMarker(entry.outputStartMarker);
  if (entry.outputEndMarker) {
    disposeMarker(entry.outputEndMarker);
  }
};

/**
 * Disposes an xterm marker only while it is still live.
 *
 * @param marker Marker to release.
 * @returns Nothing.
 */
const disposeMarker = (marker: IMarker): void => {
  if (!marker.isDisposed) {
    marker.dispose();
  }
};
