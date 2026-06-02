import React from 'react';

import { useDateTimeFormatter } from '../../lib/date-time-format';
import { formatMemoryBytes } from '../../lib/debug-tools';

type MainProcessStats = {
  sampledAt: number;
  cpuPercent: number | null;
  mainProcessMemory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
  rendererProcessMemory: {
    residentSetBytes: number;
    privateBytes: number;
    sharedBytes: number;
  } | null;
  backendProcess: {
    pid: number;
    cpuPercent: number | null;
    memoryRssBytes: number | null;
  } | null;
};

type OverlaySnapshot = {
  fps: number | null;
  mainCpuPercent: number | null;
  mainMemoryRssBytes: number | null;
  backendCpuPercent: number | null;
  backendMemoryRssBytes: number | null;
  rendererMemoryResidentSetBytes: number | null;
  rendererJsHeapUsedBytes: number | null;
  sampledAt: number | null;
};

type SystemPerformanceOverlayProps = {
  visible: boolean;
};

type OverlayPosition = {
  x: number;
  y: number;
};

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number;
  };
};

const OVERLAY_REFRESH_INTERVAL_MS = 1000;
const OVERLAY_MARGIN_PX = 12;
const OVERLAY_POSITION_STORAGE_KEY = 'cosmosh.debug.system-monitor-overlay-position.v1';

/**
 * Clamps the overlay position to stay inside viewport bounds.
 *
 * @param nextPosition Desired position.
 * @param overlayWidth Overlay width.
 * @param overlayHeight Overlay height.
 * @returns Clamped on-screen position.
 */
const clampPositionToViewport = (
  nextPosition: OverlayPosition,
  overlayWidth: number,
  overlayHeight: number,
): OverlayPosition => {
  const maxX = Math.max(OVERLAY_MARGIN_PX, window.innerWidth - overlayWidth - OVERLAY_MARGIN_PX);
  const maxY = Math.max(OVERLAY_MARGIN_PX, window.innerHeight - overlayHeight - OVERLAY_MARGIN_PX);

  return {
    x: Math.min(Math.max(nextPosition.x, OVERLAY_MARGIN_PX), maxX),
    y: Math.min(Math.max(nextPosition.y, OVERLAY_MARGIN_PX), maxY),
  };
};

/**
 * Reads persisted overlay position from localStorage.
 *
 * @returns Stored overlay position when available.
 */
const readStoredOverlayPosition = (): OverlayPosition | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(OVERLAY_POSITION_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<OverlayPosition>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null;
    }

    return {
      x: parsed.x,
      y: parsed.y,
    };
  } catch {
    return null;
  }
};

/**
 * Persists overlay position to localStorage.
 *
 * @param position Position to persist.
 * @returns void.
 */
const writeStoredOverlayPosition = (position: OverlayPosition): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(OVERLAY_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Ignore write failures for non-critical debug UI state.
  }
};

/**
 * Reads renderer JavaScript heap usage from browser performance API when supported.
 *
 * @returns Used JS heap bytes, or null when not supported.
 */
const readRendererJsHeapUsage = (): number | null => {
  const memory = (performance as PerformanceWithMemory).memory;

  if (!memory || typeof memory.usedJSHeapSize !== 'number') {
    return null;
  }

  return memory.usedJSHeapSize;
};

/**
 * Samples overlay metrics from main process IPC and renderer-side browser APIs.
 *
 * @returns Snapshot values for monitor display.
 */
const collectOverlaySnapshot = async (): Promise<OverlaySnapshot> => {
  const electronBridge = window.electron;
  const mainStats: MainProcessStats | null = electronBridge?.getProcessPerformanceStats
    ? await electronBridge.getProcessPerformanceStats()
    : null;

  return {
    fps: null,
    mainCpuPercent: mainStats?.cpuPercent ?? null,
    mainMemoryRssBytes: mainStats?.mainProcessMemory.rssBytes ?? null,
    backendCpuPercent: mainStats?.backendProcess?.cpuPercent ?? null,
    backendMemoryRssBytes: mainStats?.backendProcess?.memoryRssBytes ?? null,
    rendererMemoryResidentSetBytes: mainStats?.rendererProcessMemory?.residentSetBytes ?? null,
    rendererJsHeapUsedBytes: readRendererJsHeapUsage(),
    sampledAt: mainStats?.sampledAt ?? Date.now(),
  };
};

/**
 * Renders a compact floating system monitor for debug profiling.
 */
const SystemPerformanceOverlay: React.FC<SystemPerformanceOverlayProps> = ({ visible }) => {
  const { formatTime } = useDateTimeFormatter();
  const overlayRef = React.useRef<HTMLElement | null>(null);
  const dragPointerOffsetRef = React.useRef<OverlayPosition | null>(null);
  const [snapshot, setSnapshot] = React.useState<OverlaySnapshot>({
    fps: null,
    mainCpuPercent: null,
    mainMemoryRssBytes: null,
    backendCpuPercent: null,
    backendMemoryRssBytes: null,
    rendererMemoryResidentSetBytes: null,
    rendererJsHeapUsedBytes: null,
    sampledAt: null,
  });

  const fpsRef = React.useRef<number | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const [position, setPosition] = React.useState<OverlayPosition | null>(null);

  const ensureInitialPosition = React.useCallback((): void => {
    const overlayElement = overlayRef.current;
    if (!overlayElement) {
      return;
    }

    const overlayRect = overlayElement.getBoundingClientRect();
    const storedPosition = readStoredOverlayPosition();
    const fallbackPosition: OverlayPosition = {
      x: window.innerWidth - overlayRect.width - OVERLAY_MARGIN_PX,
      y: window.innerHeight - overlayRect.height - OVERLAY_MARGIN_PX,
    };

    const resolvedPosition = clampPositionToViewport(
      storedPosition ?? fallbackPosition,
      overlayRect.width,
      overlayRect.height,
    );

    setPosition(resolvedPosition);
    writeStoredOverlayPosition(resolvedPosition);
  }, []);

  React.useEffect(() => {
    if (!visible) {
      return;
    }

    const handleResize = (): void => {
      const overlayElement = overlayRef.current;
      if (!overlayElement) {
        return;
      }

      const rect = overlayElement.getBoundingClientRect();
      setPosition((previous) => {
        if (!previous) {
          return previous;
        }

        const nextPosition = clampPositionToViewport(previous, rect.width, rect.height);
        writeStoredOverlayPosition(nextPosition);
        return nextPosition;
      });
    };

    window.addEventListener('resize', handleResize);
    const animationHandle = window.requestAnimationFrame(() => {
      ensureInitialPosition();
    });

    return () => {
      window.cancelAnimationFrame(animationHandle);
      window.removeEventListener('resize', handleResize);
    };
  }, [ensureInitialPosition, visible]);

  React.useEffect(() => {
    if (!visible) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const dragOffset = dragPointerOffsetRef.current;
      const overlayElement = overlayRef.current;
      if (!dragOffset || !overlayElement) {
        return;
      }

      const nextPosition = clampPositionToViewport(
        {
          x: event.clientX - dragOffset.x,
          y: event.clientY - dragOffset.y,
        },
        overlayElement.offsetWidth,
        overlayElement.offsetHeight,
      );

      setPosition(nextPosition);
      writeStoredOverlayPosition(nextPosition);
    };

    const handlePointerUp = (): void => {
      dragPointerOffsetRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      dragPointerOffsetRef.current = null;
    };
  }, [visible]);

  React.useEffect(() => {
    if (!visible) {
      return;
    }

    let frameCount = 0;
    let windowStart = performance.now();

    const tick = (now: number): void => {
      frameCount += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 1000) {
        fpsRef.current = Math.round((frameCount * 1000) / elapsed);
        frameCount = 0;
        windowStart = now;
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = null;
      fpsRef.current = null;
    };
  }, [visible]);

  React.useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;

    const refreshSnapshot = async (): Promise<void> => {
      try {
        const nextSnapshot = await collectOverlaySnapshot();
        if (cancelled) {
          return;
        }

        setSnapshot({
          ...nextSnapshot,
          fps: fpsRef.current,
        });
      } catch {
        if (cancelled) {
          return;
        }

        setSnapshot((previous) => ({
          ...previous,
          fps: fpsRef.current,
          rendererJsHeapUsedBytes: readRendererJsHeapUsage(),
          sampledAt: Date.now(),
        }));
      }
    };

    void refreshSnapshot();
    const intervalId = window.setInterval(() => {
      void refreshSnapshot();
    }, OVERLAY_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const sampledAtText =
    typeof snapshot.sampledAt === 'number' ? formatTime(snapshot.sampledAt, '--:--:--') : '--:--:--';

  const style: React.CSSProperties = {
    left: position?.x ?? OVERLAY_MARGIN_PX,
    top: position?.y ?? OVERLAY_MARGIN_PX,
  };

  return (
    <aside
      ref={overlayRef}
      style={style}
      className="fixed z-[120] w-40 rounded-sm border border-menu-divider bg-bg p-2 text-[8px] text-command-text shadow-lg"
    >
      <div
        className="mb-1.5 flex cursor-grab items-center justify-between active:cursor-grabbing"
        onPointerDown={(event) => {
          const overlayElement = overlayRef.current;
          if (!overlayElement) {
            return;
          }

          dragPointerOffsetRef.current = {
            x: event.clientX - overlayElement.offsetLeft,
            y: event.clientY - overlayElement.offsetTop,
          };
        }}
      >
        <span className="font-semibold">System Monitor</span>
        <span className="text-command-text-muted">{sampledAtText}</span>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-x-1.5 gap-y-0.5">
        <span className="text-command-text-muted">FPS</span>
        <span>{snapshot.fps ?? 'N/A'}</span>

        <span className="text-command-text-muted">Main CPU</span>
        <span>{typeof snapshot.mainCpuPercent === 'number' ? `${snapshot.mainCpuPercent.toFixed(1)}%` : 'N/A'}</span>

        <span className="text-command-text-muted">Main Memory (RSS)</span>
        <span>{formatMemoryBytes(snapshot.mainMemoryRssBytes)}</span>

        <span className="text-command-text-muted">Backend CPU</span>
        <span>
          {typeof snapshot.backendCpuPercent === 'number' ? `${snapshot.backendCpuPercent.toFixed(1)}%` : 'N/A'}
        </span>

        <span className="text-command-text-muted">Backend Memory (RSS)</span>
        <span>{formatMemoryBytes(snapshot.backendMemoryRssBytes)}</span>

        <span className="text-command-text-muted">Renderer Memory (RSS)</span>
        <span>{formatMemoryBytes(snapshot.rendererMemoryResidentSetBytes)}</span>

        <span className="text-command-text-muted">Renderer JS Heap (V8)</span>
        <span>{formatMemoryBytes(snapshot.rendererJsHeapUsedBytes)}</span>
      </div>
    </aside>
  );
};

export default SystemPerformanceOverlay;
