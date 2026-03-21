import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';

import { app, type BrowserWindow } from 'electron';

export type MainProcessMemoryStats = {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
};

export type RendererProcessMemoryStats = {
  residentSetBytes: number;
  privateBytes: number;
  sharedBytes: number;
};

export type ProcessPerformanceStatsPayload = {
  sampledAt: number;
  cpuPercent: number | null;
  mainProcessMemory: MainProcessMemoryStats;
  rendererProcessMemory: RendererProcessMemoryStats | null;
};

export type HeapSnapshotExportResult = {
  ok: boolean;
  filePath?: string;
  message?: string;
};

/**
 * Creates a sampler for normalized main-process CPU usage percentage.
 *
 * @returns Sampling function that returns CPU usage percentage in [0, 100].
 */
export const createMainCpuUsagePercentSampler = (): (() => number | null) => {
  let previousCpuUsage = process.cpuUsage();
  let previousCpuSampleAt = process.hrtime.bigint();

  return () => {
    const nextCpuSampleAt = process.hrtime.bigint();
    const elapsedMicroseconds = Number(nextCpuSampleAt - previousCpuSampleAt) / 1_000;
    if (elapsedMicroseconds <= 0) {
      previousCpuUsage = process.cpuUsage();
      previousCpuSampleAt = nextCpuSampleAt;
      return null;
    }

    const cpuUsageDelta = process.cpuUsage(previousCpuUsage);
    previousCpuUsage = process.cpuUsage();
    previousCpuSampleAt = nextCpuSampleAt;

    const usedMicroseconds = cpuUsageDelta.user + cpuUsageDelta.system;
    const logicalCoreCount = Math.max(1, os.cpus().length);
    const normalizedPercent = (usedMicroseconds / elapsedMicroseconds / logicalCoreCount) * 100;

    if (!Number.isFinite(normalizedPercent)) {
      return null;
    }

    return Math.max(0, Math.min(100, normalizedPercent));
  };
};

/**
 * Reads a numeric key from a loose metrics object.
 *
 * @param source Unknown metrics object.
 * @param key Target key.
 * @returns Number value when present, otherwise null.
 */
const readMetricNumber = (source: unknown, key: string): number | null => {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const recordSource = source as Record<string, unknown>;
  const rawValue = recordSource[key];
  return typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;
};

/**
 * Normalizes memory metric units to bytes.
 * Electron app metrics usually report KB values, but some fields can already be bytes.
 *
 * @param rawValue Numeric metric value.
 * @returns Value normalized to bytes.
 */
const normalizeMetricBytes = (rawValue: number): number => {
  return rawValue > 10_000_000 ? rawValue : rawValue * 1_024;
};

/**
 * Converts Electron app metrics memory payload into bytes.
 *
 * @param memoryInfo Memory payload from Electron process metrics.
 * @returns Normalized renderer memory usage in bytes, or null when fields are missing.
 */
const toRendererMemoryBytes = (memoryInfo: unknown): RendererProcessMemoryStats | null => {
  const workingSetSize =
    readMetricNumber(memoryInfo, 'workingSetSize') ??
    readMetricNumber(memoryInfo, 'residentSet') ??
    readMetricNumber(memoryInfo, 'workingSet');
  const privateMemory =
    readMetricNumber(memoryInfo, 'privateBytes') ??
    readMetricNumber(memoryInfo, 'private') ??
    readMetricNumber(memoryInfo, 'privateWorkingSetSize') ??
    0;
  const sharedMemory = readMetricNumber(memoryInfo, 'sharedBytes') ?? readMetricNumber(memoryInfo, 'shared') ?? 0;

  if (workingSetSize === null) {
    return null;
  }

  return {
    residentSetBytes: normalizeMetricBytes(workingSetSize),
    privateBytes: normalizeMetricBytes(privateMemory),
    sharedBytes: normalizeMetricBytes(sharedMemory),
  };
};

/**
 * Resolves renderer process memory usage for a target window.
 *
 * @param targetWindow Browser window to inspect.
 * @returns Renderer memory stats when available.
 */
export const resolveRendererMemoryUsage = (targetWindow: BrowserWindow | null): RendererProcessMemoryStats | null => {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return null;
  }

  const rendererProcessId = targetWindow.webContents.getOSProcessId();
  if (!Number.isFinite(rendererProcessId) || rendererProcessId <= 0) {
    return null;
  }

  const processMetrics = app.getAppMetrics();
  const rendererMetrics = processMetrics.find((metric) => metric.pid === rendererProcessId);
  if (!rendererMetrics) {
    return null;
  }

  return toRendererMemoryBytes((rendererMetrics as { memory?: unknown }).memory ?? null);
};

/**
 * Collects main and renderer performance statistics for debug overlay sampling.
 *
 * @param targetWindow Browser window used for renderer memory resolution.
 * @param sampleCpuPercent CPU sampler function.
 * @returns Aggregated process performance stats.
 */
export const collectProcessPerformanceStats = (
  targetWindow: BrowserWindow | null,
  sampleCpuPercent: () => number | null,
): ProcessPerformanceStatsPayload => {
  const mainMemoryUsage = process.memoryUsage();

  return {
    sampledAt: Date.now(),
    cpuPercent: sampleCpuPercent(),
    mainProcessMemory: {
      rssBytes: mainMemoryUsage.rss,
      heapTotalBytes: mainMemoryUsage.heapTotal,
      heapUsedBytes: mainMemoryUsage.heapUsed,
      externalBytes: mainMemoryUsage.external,
      arrayBuffersBytes: mainMemoryUsage.arrayBuffers,
    },
    rendererProcessMemory: resolveRendererMemoryUsage(targetWindow),
  };
};

/**
 * Exports a V8 heap snapshot for the main process into the app user-data directory.
 *
 * @returns Heap snapshot export result.
 */
export const exportMainProcessHeapSnapshot = async (): Promise<HeapSnapshotExportResult> => {
  try {
    const snapshotsDirectory = path.join(app.getPath('userData'), 'debug-heap-snapshots');
    await fs.mkdir(snapshotsDirectory, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotFilePath = path.join(snapshotsDirectory, `main-${timestamp}.heapsnapshot`);
    const writtenFilePath = v8.writeHeapSnapshot(snapshotFilePath);

    return {
      ok: true,
      filePath: writtenFilePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      ok: false,
      message,
    };
  }
};
