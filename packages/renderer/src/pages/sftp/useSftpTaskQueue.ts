import React from 'react';

import { t } from '../../lib/i18n';
import { SFTP_TASK_RETENTION_MS } from './sftp-constants';
import type { SftpQueuedTask, SftpTaskAttention, SftpTaskContext, SftpTaskOptions, SftpTaskState } from './sftp-types';
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
  onTaskMenuOpenChange: (open: boolean) => void;
  resetTaskQueue: () => void;
  runSftpOperation: (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>) => void;
  runSftpReconnectTask: (operation: (context: SftpTaskContext) => Promise<string>) => Promise<string>;
};

/**
 * Signals that a queued task reached a confirmed cancelled backend state.
 */
export class SftpTaskCancelledError extends Error {
  /** Creates the renderer task cancellation sentinel. */
  public constructor() {
    super('SFTP task cancelled.');
    this.name = 'SftpTaskCancelledError';
  }
}

/**
 * Returns whether the task failure is exposed by the active application window.
 *
 * @returns Whether the document is visible and its window currently has focus.
 */
const isTaskFailureFocusExposed = (): boolean => {
  return document.visibilityState === 'visible' && document.hasFocus();
};

/**
 * Owns concurrent backend work, a serialized legacy lane, and transient toolbar task state.
 *
 * @param params File-action readiness and error reporter.
 * @returns Queue state, derived toolbar values, and operation runners.
 */
export const useSftpTaskQueue = ({
  canUseFileActions,
  notifyError,
}: UseSftpTaskQueueParams): UseSftpTaskQueueResult => {
  const [sftpTasks, setSftpTasks] = React.useState<SftpTaskState[]>([]);
  const sftpTasksRef = React.useRef<SftpTaskState[]>([]);
  const serialTaskQueueRef = React.useRef<SftpQueuedTask[]>([]);
  const isSerialTaskQueueRunningRef = React.useRef(false);
  const isTaskMenuOpenRef = React.useRef(false);
  const taskQueueGenerationRef = React.useRef(0);
  const taskRetentionTimersRef = React.useRef<Record<string, number>>({});

  React.useEffect(() => {
    sftpTasksRef.current = sftpTasks;
  }, [sftpTasks]);

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

  const resolveFailureAttention = React.useCallback((): SftpTaskAttention => {
    if (isTaskMenuOpenRef.current) {
      return 'viewed';
    }
    return isTaskFailureFocusExposed() ? 'focus-exposed' : 'unseen';
  }, []);

  const exposeUnseenFailures = React.useCallback(
    (attention: Exclude<SftpTaskAttention, 'unseen'>): void => {
      const taskIds = sftpTasksRef.current
        .filter((task) => task.status === 'failed' && task.attention === 'unseen')
        .map((task) => task.id);
      if (taskIds.length === 0) {
        return;
      }

      const taskIdSet = new Set(taskIds);
      setSftpTasks((previous) => previous.map((task) => (taskIdSet.has(task.id) ? { ...task, attention } : task)));
      taskIds.forEach(scheduleTaskRetentionCleanup);
    },
    [scheduleTaskRetentionCleanup],
  );

  const onTaskMenuOpenChange = React.useCallback(
    (open: boolean): void => {
      isTaskMenuOpenRef.current = open;
      if (open) {
        exposeUnseenFailures('viewed');
      }
    },
    [exposeUnseenFailures],
  );

  React.useEffect(() => {
    const exposeFocusedFailures = (): void => {
      if (isTaskFailureFocusExposed()) {
        exposeUnseenFailures('focus-exposed');
      }
    };

    window.addEventListener('focus', exposeFocusedFailures);
    document.addEventListener('visibilitychange', exposeFocusedFailures);
    return () => {
      window.removeEventListener('focus', exposeFocusedFailures);
      document.removeEventListener('visibilitychange', exposeFocusedFailures);
    };
  }, [exposeUnseenFailures]);

  const resetTaskQueue = React.useCallback((): void => {
    taskQueueGenerationRef.current += 1;
    serialTaskQueueRef.current = [];
    isSerialTaskQueueRunningRef.current = false;
    isTaskMenuOpenRef.current = false;
    clearAllTaskRetentionTimers();
    setSftpTasks([]);
  }, [clearAllTaskRetentionTimers]);

  React.useEffect(() => {
    return () => {
      taskQueueGenerationRef.current += 1;
      serialTaskQueueRef.current = [];
      isSerialTaskQueueRunningRef.current = false;
      clearAllTaskRetentionTimers();
    };
  }, [clearAllTaskRetentionTimers]);

  const executeSftpTask = React.useCallback(
    async (task: SftpQueuedTask, activeGeneration: number): Promise<void> => {
      setSftpTasks((previous) =>
        previous.map((currentTask) =>
          currentTask.id === task.id
            ? {
                ...currentTask,
                status: 'running',
                startedAt: Date.now(),
              }
            : currentTask,
        ),
      );

      try {
        await task.run();
        if (taskQueueGenerationRef.current !== activeGeneration) {
          return;
        }

        setSftpTasks((previous) =>
          previous.map((currentTask) =>
            currentTask.id === task.id
              ? {
                  ...currentTask,
                  status: 'success',
                  finishedAt: Date.now(),
                  cancel: undefined,
                }
              : currentTask,
          ),
        );
        scheduleTaskRetentionCleanup(task.id);
      } catch (error: unknown) {
        if (taskQueueGenerationRef.current !== activeGeneration) {
          return;
        }

        const isCancelled = error instanceof SftpTaskCancelledError;
        const message = error instanceof Error ? error.message : t('sftp.operationFailed');
        const attention = isCancelled ? undefined : resolveFailureAttention();
        setSftpTasks((previous) =>
          previous.map((currentTask) =>
            currentTask.id === task.id
              ? {
                  ...currentTask,
                  status: isCancelled ? 'cancelled' : 'failed',
                  attention,
                  errorMessage: isCancelled ? undefined : message,
                  finishedAt: Date.now(),
                  cancel: undefined,
                }
              : currentTask,
          ),
        );

        if (isCancelled) {
          scheduleTaskRetentionCleanup(task.id);
          return;
        }

        notifyError(t('sftp.tasks.failureFeedback', { operation: task.label, reason: message }));
        if (attention !== 'unseen') {
          scheduleTaskRetentionCleanup(task.id);
        }
      }
    },
    [notifyError, resolveFailureAttention, scheduleTaskRetentionCleanup],
  );

  const flushSerialSftpTaskQueue = React.useCallback((): void => {
    if (isSerialTaskQueueRunningRef.current || serialTaskQueueRef.current.length === 0) {
      return;
    }

    isSerialTaskQueueRunningRef.current = true;
    const activeGeneration = taskQueueGenerationRef.current;
    const runQueue = async (): Promise<void> => {
      try {
        while (taskQueueGenerationRef.current === activeGeneration) {
          const nextTask = serialTaskQueueRef.current.shift();
          if (!nextTask) {
            return;
          }
          await executeSftpTask(nextTask, activeGeneration);
        }
      } finally {
        if (taskQueueGenerationRef.current === activeGeneration) {
          isSerialTaskQueueRunningRef.current = false;
        }
      }
    };

    void runQueue();
  }, [executeSftpTask]);

  const enqueueSftpTask = React.useCallback(
    (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>): string => {
      const taskId = createSftpTaskId();
      const executionLane = options.executionLane ?? 'concurrent';
      const task: SftpTaskState = {
        id: taskId,
        label: options.label,
        detail: options.detail ?? t('sftp.tasks.pending'),
        status: executionLane === 'serial' ? 'queued' : 'running',
        createdAt: Date.now(),
        progress: options.progress,
      };

      clearTaskRetentionTimer(taskId);
      const taskGeneration = taskQueueGenerationRef.current;
      const queuedTask: SftpQueuedTask = {
        id: taskId,
        label: options.label,
        executionLane,
        run: async () => {
          const isCurrent = (): boolean => taskQueueGenerationRef.current === taskGeneration;
          const update: SftpTaskContext['update'] = (patch): void => {
            if (!isCurrent()) {
              return;
            }

            setSftpTasks((previous) =>
              previous.map((currentTask) => (currentTask.id === taskId ? { ...currentTask, ...patch } : currentTask)),
            );
          };

          const registerCancel = (cancel: () => void): void => {
            if (!isCurrent()) return;
            setSftpTasks((previous) =>
              previous.map((currentTask) => (currentTask.id === taskId ? { ...currentTask, cancel } : currentTask)),
            );
          };

          await operation({ taskId, isCurrent, registerCancel, update });
        },
      };

      setSftpTasks((previous) => [...previous, task]);
      if (executionLane === 'serial') {
        serialTaskQueueRef.current.push(queuedTask);
        flushSerialSftpTaskQueue();
      } else {
        void executeSftpTask(queuedTask, taskGeneration);
      }
      return taskId;
    },
    [clearTaskRetentionTimer, executeSftpTask, flushSerialSftpTaskQueue],
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
      const update: SftpTaskContext['update'] = (patch): void => {
        if (!isCurrent()) {
          return;
        }

        setSftpTasks((previous) =>
          previous.map((currentTask) => (currentTask.id === taskId ? { ...currentTask, ...patch } : currentTask)),
        );
      };

      return operation({ taskId, isCurrent, registerCancel: () => undefined, update })
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
            const attention = resolveFailureAttention();
            setSftpTasks((previous) =>
              previous.map((currentTask) =>
                currentTask.id === taskId
                  ? {
                      ...currentTask,
                      attention,
                      detail: message,
                      errorMessage: message,
                      status: 'failed',
                      finishedAt: Date.now(),
                    }
                  : currentTask,
              ),
            );
            if (attention !== 'unseen') {
              scheduleTaskRetentionCleanup(taskId);
            }
          }

          throw error;
        });
    },
    [clearTaskRetentionTimer, resolveFailureAttention, scheduleTaskRetentionCleanup],
  );

  const runningTaskCount = React.useMemo(
    () => sftpTasks.filter((task) => task.status === 'running' || task.status === 'waiting').length,
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
    onTaskMenuOpenChange,
    resetTaskQueue,
    runSftpOperation,
    runSftpReconnectTask,
  };
};
