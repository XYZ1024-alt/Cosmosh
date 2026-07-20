import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConnectionCloseGuard,
  type ConnectionCloseGuardErrorStage,
  parseActiveConnectionSummary,
} from './window-close-guard';

test('active connection summary validation rejects malformed and inconsistent counts', () => {
  assert.deepEqual(parseActiveConnectionSummary({ sshCount: 2, sftpCount: 3, totalCount: 5 }), {
    sshCount: 2,
    sftpCount: 3,
    totalCount: 5,
  });
  assert.equal(parseActiveConnectionSummary({ sshCount: 2, sftpCount: 3, totalCount: 4 }), null);
  assert.equal(parseActiveConnectionSummary({ sshCount: -1, sftpCount: 0, totalCount: -1 }), null);
  assert.equal(parseActiveConnectionSummary({ sshCount: '1', sftpCount: 0, totalCount: 1 }), null);
});

test('close guard approves immediately when no SSH or SFTP connections are active', async () => {
  let confirmationCount = 0;
  let disconnectCount = 0;
  let preferenceReadCount = 0;
  const approvedIntents: string[] = [];
  const guard = new ConnectionCloseGuard({
    readActiveConnections: async () => ({ sshCount: 0, sftpCount: 0, totalCount: 0 }),
    readCloseConfirmationEnabled: async () => {
      preferenceReadCount += 1;
      return true;
    },
    confirmClose: async () => {
      confirmationCount += 1;
      return true;
    },
    closeActiveConnections: async () => {
      disconnectCount += 1;
    },
    onApproved: (intent) => {
      approvedIntents.push(intent);
    },
    onError: () => undefined,
  });

  await guard.requestClose('window');

  assert.equal(confirmationCount, 0);
  assert.equal(disconnectCount, 0);
  assert.equal(preferenceReadCount, 0);
  assert.deepEqual(approvedIntents, ['window']);
});

test('close guard preserves active connections when the user cancels', async () => {
  let disconnectCount = 0;
  let approvedCount = 0;
  const guard = new ConnectionCloseGuard({
    readActiveConnections: async () => ({ sshCount: 1, sftpCount: 2, totalCount: 3 }),
    readCloseConfirmationEnabled: async () => true,
    confirmClose: async ({ summary }) => {
      assert.deepEqual(summary, { sshCount: 1, sftpCount: 2, totalCount: 3 });
      return false;
    },
    closeActiveConnections: async () => {
      disconnectCount += 1;
    },
    onApproved: () => {
      approvedCount += 1;
    },
    onError: () => undefined,
  });

  await guard.requestClose('window');

  assert.equal(disconnectCount, 0);
  assert.equal(approvedCount, 0);
});

test('close guard disconnects active sessions before approving the close', async () => {
  const callOrder: string[] = [];
  const guard = new ConnectionCloseGuard({
    readActiveConnections: async () => ({ sshCount: 1, sftpCount: 1, totalCount: 2 }),
    readCloseConfirmationEnabled: async () => true,
    confirmClose: async () => true,
    closeActiveConnections: async () => {
      callOrder.push('disconnect');
    },
    onApproved: (intent) => {
      callOrder.push(`approve:${intent}`);
    },
    onError: () => undefined,
  });

  await guard.requestClose('quit');

  assert.deepEqual(callOrder, ['disconnect', 'approve:quit']);
});

test('close guard skips confirmation when the preference is disabled and still disconnects sessions', async () => {
  const callOrder: string[] = [];
  const guard = new ConnectionCloseGuard({
    readActiveConnections: async () => ({ sshCount: 1, sftpCount: 0, totalCount: 1 }),
    readCloseConfirmationEnabled: async () => false,
    confirmClose: async () => {
      callOrder.push('confirm');
      return false;
    },
    closeActiveConnections: async () => {
      callOrder.push('disconnect');
    },
    onApproved: () => {
      callOrder.push('approve');
    },
    onError: () => undefined,
  });

  await guard.requestClose('window');

  assert.deepEqual(callOrder, ['disconnect', 'approve']);
});

test('close guard conservatively confirms when the preference cannot be read', async () => {
  const errorStages: ConnectionCloseGuardErrorStage[] = [];
  let confirmationCount = 0;
  const guard = new ConnectionCloseGuard({
    readActiveConnections: async () => ({ sshCount: 0, sftpCount: 1, totalCount: 1 }),
    readCloseConfirmationEnabled: async () => {
      throw new Error('preference failed');
    },
    confirmClose: async () => {
      confirmationCount += 1;
      return false;
    },
    closeActiveConnections: async () => undefined,
    onApproved: () => undefined,
    onError: (stage) => {
      errorStages.push(stage);
    },
  });

  await guard.requestClose('window');

  assert.equal(confirmationCount, 1);
  assert.deepEqual(errorStages, ['preference']);
});

test('close guard warns on probe failure and still approves after a best-effort disconnect', async () => {
  const errorStages: ConnectionCloseGuardErrorStage[] = [];
  let receivedNullSummary = false;
  let approvedCount = 0;
  const guard = new ConnectionCloseGuard({
    readActiveConnections: async () => {
      throw new Error('probe failed');
    },
    readCloseConfirmationEnabled: async () => true,
    confirmClose: async ({ summary }) => {
      receivedNullSummary = summary === null;
      return true;
    },
    closeActiveConnections: async () => {
      throw new Error('disconnect failed');
    },
    onApproved: () => {
      approvedCount += 1;
    },
    onError: (stage) => {
      errorStages.push(stage);
    },
  });

  await guard.requestClose('window');

  assert.equal(receivedNullSummary, true);
  assert.equal(approvedCount, 1);
  assert.deepEqual(errorStages, ['probe', 'disconnect']);
});

test('close guard coalesces repeated requests into the first pending decision', async () => {
  let resolveProbe!: (summary: { sshCount: number; sftpCount: number; totalCount: number }) => void;
  const approvedIntents: string[] = [];
  const probePromise = new Promise<{ sshCount: number; sftpCount: number; totalCount: number }>((resolve) => {
    resolveProbe = resolve;
  });
  const guard = new ConnectionCloseGuard({
    readActiveConnections: async () => await probePromise,
    readCloseConfirmationEnabled: async () => true,
    confirmClose: async () => true,
    closeActiveConnections: async () => undefined,
    onApproved: (intent) => {
      approvedIntents.push(intent);
    },
    onError: () => undefined,
  });

  const firstRequest = guard.requestClose('window');
  const secondRequest = guard.requestClose('quit');

  assert.equal(firstRequest, secondRequest);
  resolveProbe({ sshCount: 0, sftpCount: 0, totalCount: 0 });
  await firstRequest;

  assert.deepEqual(approvedIntents, ['window']);
});
