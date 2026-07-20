import assert from 'node:assert/strict';
import test from 'node:test';

import type { RemoteShellCapability, RemoteShellEventMessage } from '@cosmosh/api-contract';
import type { IBufferLine, IDisposable, IMarker } from '@xterm/xterm';

import {
  applyRemoteCommandMarkerEvent,
  clearTerminalCommandMarkers,
  createTerminalCommandTimelineModel,
  navigateTerminalCommandMarker,
  recordPendingCommandMarker,
  resolveCommandTimelineBarWidth,
  scrollToTerminalCommandMarker,
} from './ssh-command-markers';
import type { TerminalPaneRuntime } from './ssh-types';

type BufferLineSpec = {
  text: string;
  isWrapped?: boolean;
};

type MarkerHarness = {
  marker: IMarker;
  wasDisposed: () => boolean;
};

/**
 * Creates the minimal mutable xterm pane runtime required by marker utilities.
 *
 * @param initialLines Initial normal-buffer content.
 * @param terminalRows Visible terminal row count used for active-marker selection.
 * @returns Runtime plus controls for cursor, viewport, buffer, and marker state.
 */
const createRuntimeHarness = (
  initialLines: BufferLineSpec[] = [],
  terminalRows = 4,
): {
  runtime: TerminalPaneRuntime;
  markers: MarkerHarness[];
  scrollTargets: number[];
  getRefreshCount: () => number;
  setActiveBuffer: (type: 'normal' | 'alternate') => void;
  setCursorLine: (line: number) => void;
  setLine: (line: number, value: BufferLineSpec) => void;
  setViewportY: (line: number) => void;
} => {
  const lines = [...initialLines];
  const markers: MarkerHarness[] = [];
  const scrollTargets: number[] = [];
  let activeBufferType: 'normal' | 'alternate' = 'normal';
  let cursorLine = 0;
  let viewportY = 0;
  let refreshCount = 0;

  /**
   * Creates a lightweight immutable buffer-line facade.
   *
   * @param spec Rendered text and wrap state.
   * @returns Partial xterm line implementation used by command reconstruction.
   */
  const createBufferLine = (spec: BufferLineSpec): IBufferLine =>
    ({
      isWrapped: spec.isWrapped ?? false,
      length: spec.text.length,
      translateToString: () => spec.text,
    }) as unknown as IBufferLine;

  const normalBuffer = {
    type: 'normal' as const,
    get cursorY(): number {
      return cursorLine;
    },
    cursorX: 0,
    get viewportY(): number {
      return viewportY;
    },
    baseY: 0,
    get length(): number {
      return lines.length;
    },
    getLine: (line: number) => {
      const spec = lines[line];
      return spec ? createBufferLine(spec) : undefined;
    },
  };
  const alternateBuffer = {
    ...normalBuffer,
    type: 'alternate' as const,
  };
  const terminal = {
    rows: terminalRows,
    buffer: {
      get active() {
        return activeBufferType === 'normal' ? normalBuffer : alternateBuffer;
      },
      normal: normalBuffer,
      alternate: alternateBuffer,
    },
    registerMarker: (cursorYOffset = 0) => {
      let disposed = false;
      let markerLine = cursorLine + cursorYOffset;
      const disposeListeners = new Set<() => void>();
      const marker: IMarker = {
        id: markers.length + 1,
        get isDisposed(): boolean {
          return disposed;
        },
        get line(): number {
          return markerLine;
        },
        dispose: () => {
          if (disposed) {
            return;
          }

          disposed = true;
          markerLine = -1;
          disposeListeners.forEach((listener) => listener());
        },
        onDispose: (listener: () => void): IDisposable => {
          disposeListeners.add(listener);
          return {
            dispose: () => {
              disposeListeners.delete(listener);
            },
          };
        },
      };
      markers.push({ marker, wasDisposed: () => disposed });
      return marker;
    },
    scrollToLine: (line: number) => {
      scrollTargets.push(line);
      viewportY = line;
    },
  };

  return {
    runtime: {
      owner: 'secondary',
      terminal,
      pendingCommandMarkers: [],
      commandMarkers: [],
      refreshCommandTimeline: () => {
        refreshCount += 1;
      },
    } as unknown as TerminalPaneRuntime,
    markers,
    scrollTargets,
    getRefreshCount: () => refreshCount,
    setActiveBuffer: (type) => {
      activeBufferType = type;
    },
    setCursorLine: (line) => {
      cursorLine = line;
    },
    setLine: (line, value) => {
      lines[line] = value;
    },
    setViewportY: (line) => {
      viewportY = line;
    },
  };
};

/** Shared trusted helper event fields used by marker tests. */
const REMOTE_EVENT_BASE = {
  type: 'remote-shell-event',
  shell: 'bash',
  helperVersion: 'test-v2',
  protocolVersion: 2,
  capabilities: ['command-start', 'command-end', 'prompt-ready'] as RemoteShellCapability[],
  timestamp: 100,
} as const;

/**
 * Creates a trusted command-start event.
 *
 * @param commandId Stable helper command id.
 * @param command Sanitized executable name emitted by the helper.
 * @returns Typed command-start payload.
 */
const createCommandStart = (commandId: string, command: string): RemoteShellEventMessage => ({
  ...REMOTE_EVENT_BASE,
  event: 'command-start',
  command,
  commandId,
});

test('trusted lifecycle promotes pending input and retains the complete compound command', () => {
  const harness = createRuntimeHarness([{ text: 'dev@host:~$ echo a && git status' }, { text: '' }]);
  harness.setCursorLine(0);
  assert.equal(recordPendingCommandMarker(harness.runtime, 1_000), true);

  harness.setCursorLine(1);
  const commandStart = createCommandStart('cmd-1', 'echo');
  assert.equal(applyRemoteCommandMarkerEvent(harness.runtime, commandStart, 1_500), true);
  assert.equal(applyRemoteCommandMarkerEvent(harness.runtime, commandStart, 1_600), false);
  assert.equal(harness.runtime.pendingCommandMarkers.length, 0);
  assert.equal(harness.runtime.commandMarkers.length, 1);
  assert.equal(harness.runtime.commandMarkers[0]?.command, 'echo a && git status');
  assert.equal(harness.runtime.commandMarkers[0]?.inputMarker.line, 0);
  assert.equal(harness.runtime.commandMarkers[0]?.outputStartMarker.line, 1);

  harness.setCursorLine(5);
  assert.equal(
    applyRemoteCommandMarkerEvent(
      harness.runtime,
      {
        ...REMOTE_EVENT_BASE,
        event: 'command-end',
        command: 'echo',
        commandId: 'cmd-1',
        durationMs: 250,
        exitCode: 0,
      },
      1_750,
    ),
    true,
  );

  const model = createTerminalCommandTimelineModel(harness.runtime, true);
  assert.equal(model.items[0]?.outputRows, 4);
  assert.equal(model.items[0]?.barWidth, resolveCommandTimelineBarWidth(4));
  assert.equal(harness.runtime.commandMarkers[0]?.durationMs, 250);
  assert.equal(harness.runtime.commandMarkers[0]?.exitCode, 0);
});

test('wrapped input marker navigates to the first physical command row', () => {
  const harness = createRuntimeHarness([
    { text: "dev@host:~$ printf '%s' " },
    { text: 'very-long-value', isWrapped: true },
    { text: '' },
  ]);
  harness.setCursorLine(1);
  assert.equal(recordPendingCommandMarker(harness.runtime, 2_000), true);
  assert.equal(harness.runtime.pendingCommandMarkers[0]?.marker.line, 0);

  harness.setCursorLine(2);
  assert.equal(applyRemoteCommandMarkerEvent(harness.runtime, createCommandStart('cmd-wrap', 'printf'), 2_100), true);
  assert.equal(harness.runtime.commandMarkers[0]?.command, "printf '%s' very-long-value");
  assert.equal(harness.runtime.commandMarkers[0]?.inputMarker.line, 0);
});

test('prompt-ready clears unmatched input and alternate-screen input is ignored', () => {
  const harness = createRuntimeHarness([{ text: 'dev@host:~$ ' }]);
  assert.equal(recordPendingCommandMarker(harness.runtime, 1), true);
  assert.equal(
    applyRemoteCommandMarkerEvent(
      harness.runtime,
      {
        ...REMOTE_EVENT_BASE,
        event: 'prompt-ready',
        cwd: '/home/dev',
        promptGeneration: 2,
      },
      2,
    ),
    true,
  );
  assert.equal(harness.runtime.pendingCommandMarkers.length, 0);
  assert.equal(harness.markers[0]?.wasDisposed(), true);

  harness.setActiveBuffer('alternate');
  assert.equal(recordPendingCommandMarker(harness.runtime, 3), false);
  assert.equal(harness.markers.length, 1);
});

test('timeline navigation uses pane-local adjacent commands without wrapping', () => {
  const harness = createRuntimeHarness([], 4);
  const commands = [
    { id: 'cmd-1', inputLine: 2, outputLine: 3, command: 'one' },
    { id: 'cmd-2', inputLine: 8, outputLine: 9, command: 'two' },
    { id: 'cmd-3', inputLine: 15, outputLine: 16, command: 'three' },
  ];

  commands.forEach(({ id, inputLine, outputLine, command }) => {
    harness.setLine(inputLine, { text: `dev@host:~$ ${command}` });
    harness.setLine(outputLine, { text: '' });
    harness.setCursorLine(inputLine);
    assert.equal(recordPendingCommandMarker(harness.runtime, inputLine), true);
    harness.setCursorLine(outputLine);
    assert.equal(applyRemoteCommandMarkerEvent(harness.runtime, createCommandStart(id, command), outputLine), true);
  });

  harness.setViewportY(8);
  assert.equal(navigateTerminalCommandMarker(harness.runtime, 'previous'), true);
  assert.equal(navigateTerminalCommandMarker(harness.runtime, 'previous'), false);
  assert.equal(navigateTerminalCommandMarker(harness.runtime, 'next'), true);
  assert.equal(scrollToTerminalCommandMarker(harness.runtime, 'cmd-3'), true);
  assert.equal(navigateTerminalCommandMarker(harness.runtime, 'next'), false);
  assert.deepEqual(harness.scrollTargets, [2, 8, 15]);
});

test('timeline reserves alternate-screen state and clears command text with scrollback disposal', () => {
  const harness = createRuntimeHarness([{ text: 'dev@host:~$ secret --token value' }, { text: '' }]);
  harness.setCursorLine(0);
  recordPendingCommandMarker(harness.runtime, 1);
  harness.setCursorLine(1);
  applyRemoteCommandMarkerEvent(harness.runtime, createCommandStart('cmd-secret', 'secret'), 2);

  const retainedEntry = harness.runtime.commandMarkers[0];
  assert.ok(retainedEntry);
  harness.setActiveBuffer('alternate');
  const alternateModel = createTerminalCommandTimelineModel(harness.runtime, true);
  assert.equal(alternateModel.visible, true);
  assert.equal(alternateModel.alternateScreenActive, true);
  assert.equal(alternateModel.items.length, 1);

  retainedEntry.inputMarker.dispose();
  assert.equal(retainedEntry.command, '');
  assert.equal(retainedEntry.outputStartMarker.isDisposed, true);
  assert.equal(harness.runtime.commandMarkers.length, 0);
  assert.ok(harness.getRefreshCount() > 0);
});

test('connection cleanup disposes pending and confirmed markers and blanks retained command objects', () => {
  const harness = createRuntimeHarness([
    { text: 'dev@host:~$ visible-command' },
    { text: '' },
    { text: 'dev@host:~$ pending-command' },
  ]);
  harness.setCursorLine(0);
  recordPendingCommandMarker(harness.runtime, 1);
  harness.setCursorLine(1);
  applyRemoteCommandMarkerEvent(harness.runtime, createCommandStart('cmd-visible', 'visible-command'), 2);
  const retainedEntry = harness.runtime.commandMarkers[0];
  assert.ok(retainedEntry);

  harness.setCursorLine(2);
  recordPendingCommandMarker(harness.runtime, 3);
  assert.equal(clearTerminalCommandMarkers(harness.runtime), true);
  assert.equal(retainedEntry.command, '');
  assert.equal(harness.runtime.pendingCommandMarkers.length, 0);
  assert.equal(harness.runtime.commandMarkers.length, 0);
  assert.equal(
    harness.markers.every((entry) => entry.wasDisposed()),
    true,
  );
  assert.equal(clearTerminalCommandMarkers(harness.runtime), false);
});
