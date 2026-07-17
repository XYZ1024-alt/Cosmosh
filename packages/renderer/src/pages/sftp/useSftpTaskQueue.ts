import React from 'react';

import { t } from '../../lib/i18n';
import { SFTP_TASK_RETENTION_MS } from './sftp-constants';
import type { SftpQueuedTask, SftpTaskContext, SftpTaskOptions, SftpTaskState } from './sftp-types';
import { createSftpTaskId, formatSftpTaskToolbarLabel, SFTP_TASK_STATUS_ORDER } from './sftp-utils';

/**
 * Inputs for the tab-local SFTP task queue.
 */
type UseSftpTaskQueueParams = {
  canUseFileActions: boolean;
  notifyError: (message: string) => void;
};

/**
 * Task queue state and operation runners for one SFTP tab.
 */
type UseSftpTaskQueueResult = {
  activeTaskCount: number;
  queuedTaskCount: number;
  runningTaskCount: number;
  sortedSftpTasks: SftpTaskState[];
  sftpTasks: SftpTaskState[];
  taskToolbarLabel: string;
  resetTaskQueue: () => void;
  runSftpOperation: (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>) => void;
  runSftpReconnectTask: (operation: (context: SftpTaskContext) => Promise<string>) => Promise<string>;
};

/**
 * Owns serialized renderer-side SFTP operations and transient toolbar task state.
 *
 * @param params File-action readiness and error reporter.
 * @returns Queue state, derived toolbar values, and operation runners.
 */
export const useSftpTaskQueue = ({
  canUseFileActions,
  notifyError,
}: UseSftpTaskQueueParams): UseSftpTaskQueueResult => {
  const [sftpTasks, setSftpTasks] = React.useState<SftpTaskState[]>([]);
  const taskQueueRef = React.useRef<SftpQueuedTask[]>([]);
  const isTaskQueueRunningRef = React.useRef(false);
  const taskQueueGenerationRef = React.useRef(0);
  const taskRetentionTimersRef = React.useRef<Record<string, number>>({});

  const clearTaskRetentionTimer = React.useCallback((taskId: string): void => {
    const timerId = taskRetentionTimersRef.current[taskId];
    if (timerId === undefined) {
      return;
    }

    window.clearTimeout(timerId);
    delete taskRetentionTimersRef.current[taskId];
  }, []);

  const clearAllTaskRetentionTimers = React.useCallback((): void => {
    Object.values(taskRetentionTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    taskRetentionTimersRef.current = {};
  }, []);

  const scheduleTaskRetentionCleanup = React.useCallback(
    (taskId: string): void => {
      clearTaskRetentionTimer(taskId);
      taskRetentionTimersRef.current[taskId] = window.setTimeout(() => {
        delete taskRetentionTimersRef.current[taskId];
        setSftpTasks((previous) => previous.filter((task) => task.id !== taskId));
      }, SFTP_TASK_RETENTION_MS);
    },
    [clearTaskRetentionTimer],
  );

  const resetTaskQueue = React.useCallback((): void => {
    taskQueueGenerationRef.current += 1;
    taskQueueRef.current = [];
    isTaskQueueRunningRef.current = false;
    clearAllTaskRetentionTimers();
    setSftpTasks([]);
  }, [clearAllTaskRetentionTimers]);

  React.useEffect(() => {
    return () => {
      taskQueueGenerationRef.current += 1;
      taskQueueRef.current = [];
      isTaskQueueRunningRef.current = false;
      clearAllTaskRetentionTimers();
    };
  }, [clearAllTaskRetentionTimers]);

  const flushSftpTaskQueue = React.useCallback((): void => {
    if (isTaskQueueRunningRef.current || taskQueueRef.current.length === 0) {
      return;
    }

    isTaskQueueRunningRef.current = true;
    const activeGeneration = taskQueueGenerationRef.current;

    const runQueue = async (): Promise<void> => {
      try {
        while (taskQueueGenerationRef.current === activeGeneration) {
          const nextTask = taskQueueRef.current.shift();
          if (!nextTask) {
            return;
          }

          setSftpTasks((previous) =>
            previous.map((task) =>
              task.id === nextTask.id
                ? {
                    ...task,
                    status: 'running',
                    startedAt: Date.now(),
                  }
                : task,
            ),
          );

          try {
            await nextTask.run();
            if (taskQueueGenerationRef.current !== activeGeneration) {
              continue;
            }

            setSftpTasks((previous) =>
              previous.map((task) =>
                task.id === nextTask.id
                  ? {
                      ...task,
                      status: 'success',
                      finishedAt: Date.now(),
                    }
                  : task,
              ),
            );
          } catch (error: unknown) {
            if (taskQueueGenerationRef.current !== activeGeneration) {
              continue;
            }

            const message = error instanceof Error ? error.message : t('sftp.operationFailed');
            setSftpTasks((previous) =>
              previous.map((task) =>
                task.id === nextTask.id
                  ? {
                      ...task,
                      status: 'failed',
                      errorMessage: message,
                      finishedAt: Date.now(),
                    }
                  : task,
              ),
            );
            notifyError(t('sftp.tasks.failureFeedback', { operation: nextTask.label, reason: message }));
          } finally {
            if (taskQueueGenerationRef.current === activeGeneration) {
              scheduleTaskRetentionCleanup(nextTask.id);
            }
          }
        }
      } finally {
        if (taskQueueGenerationRef.current === activeGeneration) {
          isTaskQueueRunningRef.current = false;
        }
      }
    };

    void runQueue();
  }, [notifyError, scheduleTaskRetentionCleanup]);

  const enqueueSftpTask = React.useCallback(
    (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>): string => {
      const taskId = createSftpTaskId();
      const task: SftpTaskState = {
        id: taskId,
        label: options.label,
        detail: options.detail ?? t('sftp.tasks.pending'),
        status: 'queued',
        createdAt: Date.now(),
        progress: options.progress,
      };

      clearTaskRetentionTimer(taskId);
      const taskGeneration = taskQueueGenerationRef.current;
      setSftpTasks((previous) => [...previous, task]);
      taskQueueRef.current.push({
        id: taskId,
        label: options.label,
        run: async () => {
          const isCurrent = (): boolean => taskQueueGenerationRef.current === taskGeneration;
          const update = (patch: Partial<Pick<SftpTaskState, 'detail' | 'progress' | 'errorMessage'>>): void => {
            if (!isCurrent()) {
              return;
            }

            setSftpTasks((previous) =>
              previous.map((currentTask) => (currentTask.id === taskId ? { ...currentTask, ...patch } : currentTask)),
            );
          };

          await operation({ taskId, isCurrent, update });
        },
      });
      flushSftpTaskQueue();
      return taskId;
    },
    [clearTaskRetentionTimer, flushSftpTaskQueue],
  );

  const runSftpOperation = React.useCallback(
    (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>): void => {
      if (!canUseFileActions) {
        return;
      }

      enqueueSftpTask(options, operation);
    },
    [canUseFileActions, enqueueSftpTask],
  );

  const runSftpReconnectTask = React.useCallback(
    (operation: (context: SftpTaskContext) => Promise<string>): Promise<string> => {
      const taskId = createSftpTaskId();
      const task: SftpTaskState = {
        id: taskId,
        label: t('sftp.tasks.reconnect'),
        detail: t('sftp.tasks.reconnecting'),
        status: 'running',
        createdAt: Date.now(),
        startedAt: Date.now(),
        progress: { completed: 0, total: 1 },
      };

      clearTaskRetentionTimer(taskId);
      setSftpTasks((previous) => [...previous, task]);

      const taskGeneration = taskQueueGenerationRef.current;
      const isCurrent = (): boolean => taskQueueGenerationRef.current === taskGeneration;
      const update = (patch: Partial<Pick<SftpTaskState, 'detail' | 'progress'>>): void => {
        if (!isCurrent()) {
          return;
        }

        setSftpTasks((previous) =>
          previous.map((currentTask) => (currentTask.id === taskId ? { ...currentTask, ...patch } : currentTask)),
        );
      };

      return operation({ taskId, isCurrent, update })
        .then((nextSessionId) => {
          if (isCurrent()) {
            setSftpTasks((previous) =>
              previous.map((currentTask) =>
                currentTask.id === taskId
                  ? {
                      ...currentTask,
                      detail: t('sftp.tasks.reconnectComplete'),
                      status: 'success',
                      finishedAt: Date.now(),
                      progress: { completed: 1, total: 1 },
                    }
                  : currentTask,
              ),
            );
            scheduleTaskRetentionCleanup(taskId);
          }

          return nextSessionId;
        })
        .catch((error: unknown) => {
          if (isCurrent()) {
            const message = error instanceof Error ? error.message : t('sftp.reconnectFailed');
            setSftpTasks((previous) =>
              previous.map((currentTask) =>
                currentTask.id === taskId
                  ? {
                      ...currentTask,
                      detail: message,
                      status: 'failed',
                      finishedAt: Date.now(),
                    }
                  : currentTask,
              ),
            );
            scheduleTaskRetentionCleanup(taskId);
          }

          throw error;
        });
    },
    [clearTaskRetentionTimer, scheduleTaskRetentionCleanup],
  );

  const runningTaskCount = React.useMemo(
    () => sftpTasks.filter((task) => task.status === 'running').length,
    [sftpTasks],
  );
  const queuedTaskCount = React.useMemo(() => sftpTasks.filter((task) => task.status === 'queued').length, [sftpTasks]);
  const activeTaskCount = runningTaskCount + queuedTaskCount;
  const sortedSftpTasks = React.useMemo(() => {
    return [...sftpTasks].sort((left, right) => {
      const statusDelta = SFTP_TASK_STATUS_ORDER[left.status] - SFTP_TASK_STATUS_ORDER[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return left.createdAt - right.createdAt;
    });
  }, [sftpTasks]);
  const taskToolbarLabel = React.useMemo(
    () =>
      activeTaskCount > 0
        ? formatSftpTaskToolbarLabel(runningTaskCount, queuedTaskCount)
        : t('sftp.tasks.toolbarRecent', { count: sftpTasks.length }),
    [activeTaskCount, queuedTaskCount, runningTaskCount, sftpTasks.length],
  );

  return {
    activeTaskCount,
    queuedTaskCount,
    runningTaskCount,
    sortedSftpTasks,
    sftpTasks,
    taskToolbarLabel,
    resetTaskQueue,
    runSftpOperation,
    runSftpReconnectTask,
  };
};
