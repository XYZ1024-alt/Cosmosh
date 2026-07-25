import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiSftpGetTaskResponse, ApiSftpTaskData } from '@cosmosh/api-contract';

import { isTerminalSftpTask, waitForSftpTask } from './sftp-task-runtime';

const createTask = (state: ApiSftpTaskData['state']): ApiSftpTaskData => ({
  sessionId: 'accepted-session',
  taskId: '0f47f2f2-e112-4d1a-b68e-b023ab00de52',
  operation: 'batch',
  state,
  remotePaths: ['/work'],
  createdAt: new Date(0).toISOString(),
  deadlineAt: new Date(60_000).toISOString(),
});

const createResponse = (task: ApiSftpTaskData): ApiSftpGetTaskResponse => ({
  success: true,
  code: 'SFTP_TASK_STATUS_OK',
  message: 'Task loaded.',
  requestId: 'request-1',
  timestamp: new Date(0).toISOString(),
  data: task,
});

test('task polling remains bound to the originally accepted session and task id', async () => {
  const observedCalls: Array<[string, string]> = [];
  const observedStates: ApiSftpTaskData['state'][] = [];
  const terminalTask = createTask('succeeded');

  const result = await waitForSftpTask({
    acceptedTask: createTask('queued'),
    getTask: async (sessionId, taskId) => {
      observedCalls.push([sessionId, taskId]);
      return createResponse(terminalTask);
    },
    onSnapshot: (task) => observedStates.push(task.state),
    wait: async () => undefined,
  });

  assert.equal(result, terminalTask);
  assert.deepEqual(observedCalls, [['accepted-session', terminalTask.taskId]]);
  assert.deepEqual(observedStates, ['queued', 'succeeded']);
});

test('terminal task classification includes success, failure, and cancellation only', () => {
  assert.equal(isTerminalSftpTask(createTask('queued')), false);
  assert.equal(isTerminalSftpTask(createTask('running')), false);
  assert.equal(isTerminalSftpTask(createTask('succeeded')), true);
  assert.equal(isTerminalSftpTask(createTask('failed')), true);
  assert.equal(isTerminalSftpTask(createTask('cancelled')), true);
});
