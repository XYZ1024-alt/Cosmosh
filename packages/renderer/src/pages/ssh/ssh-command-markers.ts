import type { ServerInboundMessage, TerminalPaneRuntime } from './ssh-types';

const COMMAND_MARKER_MAX_COUNT = 200;
const FALLBACK_MARKER_PROMOTION_WINDOW_MS = 2_000;
let fallbackMarkerSequence = 0;

/**
 * Records or completes a structured remote command marker for one pane.
 *
 * @param runtime Source pane runtime.
 * @param payload Trusted command lifecycle event.
 * @param receivedAt Local event receipt timestamp.
 * @returns `true` when the marker collection changed.
 */
export const applyRemoteCommandMarkerEvent = (
  runtime: TerminalPaneRuntime,
  payload: Extract<ServerInboundMessage, { type: 'remote-shell-event' }>,
  receivedAt: number,
): boolean => {
  if (payload.event === 'command-start') {
    const existing = runtime.commandMarkers.find((entry) => entry.commandId === payload.commandId);
    if (existing) {
      return false;
    }

    const fallbackCandidate = runtime.commandMarkers.at(-1);
    if (
      fallbackCandidate?.source === 'fallback' &&
      fallbackCandidate.endedAt === null &&
      receivedAt - fallbackCandidate.startedAt <= FALLBACK_MARKER_PROMOTION_WINDOW_MS
    ) {
      fallbackCandidate.commandId = payload.commandId;
      fallbackCandidate.command = payload.command;
      fallbackCandidate.source = 'remote';
      fallbackCandidate.startedAt = receivedAt;
      return true;
    }

    const marker = runtime.terminal.registerMarker(0);
    if (!marker) {
      return false;
    }

    runtime.commandMarkers.push({
      commandId: payload.commandId,
      command: payload.command,
      source: 'remote',
      marker,
      startedAt: receivedAt,
      endedAt: null,
      durationMs: null,
      exitCode: null,
    });
    trimCommandMarkers(runtime);
    return true;
  }

  if (payload.event !== 'command-end') {
    return false;
  }

  const existing = runtime.commandMarkers.find((entry) => entry.commandId === payload.commandId);
  if (!existing) {
    return false;
  }

  existing.command = payload.command;
  existing.endedAt = receivedAt;
  existing.durationMs = payload.durationMs;
  existing.exitCode = payload.exitCode;
  return true;
};

/**
 * Records a best-effort command location when structured lifecycle events are unavailable.
 *
 * @param runtime Source pane runtime.
 * @param recordedAt Local input timestamp.
 * @returns `true` when xterm accepted a marker.
 */
export const recordFallbackCommandMarker = (runtime: TerminalPaneRuntime, recordedAt: number): boolean => {
  const marker = runtime.terminal.registerMarker(0);
  if (!marker) {
    return false;
  }

  runtime.commandMarkers.push({
    commandId: `fallback-${recordedAt}-${(fallbackMarkerSequence += 1)}`,
    command: null,
    source: 'fallback',
    marker,
    startedAt: recordedAt,
    endedAt: null,
    durationMs: null,
    exitCode: null,
  });
  trimCommandMarkers(runtime);
  return true;
};

/**
 * Scrolls one pane to the nearest retained command marker, wrapping at timeline boundaries.
 *
 * @param runtime Active pane runtime.
 * @param direction Direction relative to the current viewport top.
 * @returns `true` when a target marker was found and revealed.
 */
export const navigateTerminalCommandMarker = (
  runtime: TerminalPaneRuntime,
  direction: 'previous' | 'next',
): boolean => {
  const currentLine = runtime.terminal.buffer.active.viewportY;
  const validMarkers = runtime.commandMarkers.filter((entry) => entry.marker.line >= 0);
  const target =
    direction === 'previous'
      ? ([...validMarkers].reverse().find((entry) => entry.marker.line < currentLine) ?? validMarkers.at(-1))
      : (validMarkers.find((entry) => entry.marker.line > currentLine) ?? validMarkers[0]);

  if (!target) {
    return false;
  }

  runtime.terminal.scrollToLine(target.marker.line);
  return true;
};

/**
 * Bounds marker memory and explicitly releases markers no longer used by navigation.
 *
 * @param runtime Pane runtime whose marker collection changed.
 * @returns Nothing.
 */
const trimCommandMarkers = (runtime: TerminalPaneRuntime): void => {
  const excessCount = runtime.commandMarkers.length - COMMAND_MARKER_MAX_COUNT;
  if (excessCount <= 0) {
    return;
  }

  const removed = runtime.commandMarkers.splice(0, excessCount);
  removed.forEach((entry) => entry.marker.dispose());
};
