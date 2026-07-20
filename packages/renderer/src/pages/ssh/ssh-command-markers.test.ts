import assert from 'node:assert/strict';
import test from 'node:test';

import type { RemoteShellCapability, RemoteShellEventMessage } from '@cosmosh/api-contract';
import type { IMarker } from '@xterm/xterm';

import {
  applyRemoteCommandMarkerEvent,
  navigateTerminalCommandMarker,
  recordFallbackCommandMarker,
} from './ssh-command-markers';
import type { TerminalPaneRuntime } from './ssh-types';

type MarkerHarness = { marker: IMarker; wasDisposed: () => boolean };

/**
 * Creates the minimal pane runtime required by command marker utilities.
 *
 * @param markerLines Buffer lines returned by successive marker registrations.
 * @returns Runtime harness plus observable registered markers and scroll targets.
 */
const createRuntimeHarness = (
  markerLines: number[],
): {
  runtime: TerminalPaneRuntime;
  markers: MarkerHarness[];
  scrollTargets: number[];
  setViewportY: (line: number) => void;
} => {
  const markers: MarkerHarness[] = [];
  const scrollTargets: number[] = [];
  let viewportY = 0;
  const terminal = {
    buffer: {
      active: {
        get viewportY(): number {
          return viewportY;
        },
      },
    },
    registerMarker: () => {
      let disposed = false;
      let line = markerLines[markers.length] ?? markers.length;
      const marker: IMarker = {
        id: markers.length + 1,
        get isDisposed(): boolean {
          return disposed;
        },
        get line(): number {
          return line;
        },
        dispose: () => {
          disposed = true;
          line = -1;
        },
        onDispose: () => ({ dispose: () => undefined }),
      };
      markers.push({ marker, wasDisposed: () => disposed });
      return marker;
    },
    scrollToLine: (line: number) => {
      scrollTargets.push(line);
    },
  };

  return {
    runtime: {
      owner: 'secondary',
      terminal,
      commandMarkers: [],
    } as unknown as TerminalPaneRuntime,
    markers,
    scrollTargets,
    setViewportY: (line: number) => {
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
  capabilities: ['command-start', 'command-end'] as RemoteShellCapability[],
  timestamp: 100,
} as const;

test('structured command lifecycle promotes a recent fallback marker and deduplicates command id', () => {
  const { runtime, markers } = createRuntimeHarness([12, 18]);
  assert.equal(recordFallbackCommandMarker(runtime, 1_000), true);

  const commandStart: RemoteShellEventMessage = {
    ...REMOTE_EVENT_BASE,
    event: 'command-start',
    command: 'git',
    commandId: 'cmd-1',
  };
  assert.equal(applyRemoteCommandMarkerEvent(runtime, commandStart, 1_500), true);
  assert.equal(applyRemoteCommandMarkerEvent(runtime, commandStart, 1_600), false);
  assert.equal(markers.length, 1);
  assert.deepEqual(
    runtime.commandMarkers.map(({ commandId, command, source, startedAt }) => ({
      commandId,
      command,
      source,
      startedAt,
    })),
    [{ commandId: 'cmd-1', command: 'git', source: 'remote', startedAt: 1_500 }],
  );

  assert.equal(
    applyRemoteCommandMarkerEvent(
      runtime,
      {
        ...REMOTE_EVENT_BASE,
        event: 'command-end',
        command: 'git',
        commandId: 'cmd-1',
        durationMs: 250,
        exitCode: 0,
      },
      1_750,
    ),
    true,
  );
  assert.equal(runtime.commandMarkers[0]?.endedAt, 1_750);
  assert.equal(runtime.commandMarkers[0]?.durationMs, 250);
  assert.equal(runtime.commandMarkers[0]?.exitCode, 0);
});

test('command navigation selects the nearest marker and wraps at boundaries', () => {
  const { runtime, scrollTargets, setViewportY } = createRuntimeHarness([2, 8, 15]);
  recordFallbackCommandMarker(runtime, 1);
  recordFallbackCommandMarker(runtime, 2);
  recordFallbackCommandMarker(runtime, 3);

  setViewportY(10);
  assert.equal(navigateTerminalCommandMarker(runtime, 'previous'), true);
  assert.equal(navigateTerminalCommandMarker(runtime, 'next'), true);
  setViewportY(20);
  assert.equal(navigateTerminalCommandMarker(runtime, 'next'), true);

  assert.deepEqual(scrollTargets, [8, 15, 2]);
});

test('fallback command marker retention disposes entries beyond the bounded history', () => {
  const { runtime, markers } = createRuntimeHarness(Array.from({ length: 201 }, (_, index) => index));
  for (let index = 0; index < 201; index += 1) {
    recordFallbackCommandMarker(runtime, index);
  }

  assert.equal(runtime.commandMarkers.length, 200);
  assert.equal(markers[0]?.wasDisposed(), true);
  assert.equal(markers[1]?.wasDisposed(), false);
});
