import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  escapeSftpShellPath,
  formatSftpPermissionOctal,
  formatSftpPermissions,
  joinSftpPath,
  normalizeSftpPathInput,
  resolveSftpEntryHiddenState,
  resolveSftpEntryType,
  SftpSessionService,
} from './session-service.js';

type TestSftpClient = EventEmitter & {
  end(): void;
};

type TestSftpSession = {
  sessionId: string;
  serverId: string;
  client: TestSftpClient;
  sftp: EventEmitter;
  isClosed: boolean;
  t: (key: string) => string;
};

type TestSftpSessionServiceInternals = {
  sessions: Map<string, TestSftpSession>;
  watchSessionTransport(session: TestSftpSession): void;
};

const createTestSftpSessionService = (): SftpSessionService => {
  return new SftpSessionService({
    getDbClient: () => ({}) as never,
    auditEventService: { logEvent: async () => null } as never,
    credentialEncryptionKey: Buffer.alloc(32),
  });
};

const createTestSftpSession = (): TestSftpSession => {
  const client = new EventEmitter() as TestSftpClient;
  client.end = (): void => undefined;

  return {
    sessionId: 'test-session',
    serverId: 'test-server',
    client,
    sftp: new EventEmitter(),
    isClosed: false,
    t: (key) => key,
  };
};

const getTestInternals = (service: SftpSessionService): TestSftpSessionServiceInternals => {
  return service as unknown as TestSftpSessionServiceInternals;
};

const registerTestSession = (service: SftpSessionService, session: TestSftpSession): void => {
  const internals = getTestInternals(service);
  internals.sessions.set(session.sessionId, session);
  internals.watchSessionTransport(session);
};

test('normalizeSftpPathInput keeps SFTP paths POSIX-oriented', () => {
  assert.equal(normalizeSftpPathInput(undefined), '.');
  assert.equal(normalizeSftpPathInput(''), '.');
  assert.equal(normalizeSftpPathInput(' /var/www/../log '), '/var/log');
  assert.equal(normalizeSftpPathInput('C:\\tmp\\site'), 'C:/tmp/site');
});

test('joinSftpPath builds stable remote child paths', () => {
  assert.equal(joinSftpPath('/', 'etc'), '/etc');
  assert.equal(joinSftpPath('/var/www', 'index.html'), '/var/www/index.html');
  assert.equal(joinSftpPath('.', 'relative'), 'relative');
});

test('resolveSftpEntryType maps POSIX file bits', () => {
  assert.equal(resolveSftpEntryType(0o040755), 'directory');
  assert.equal(resolveSftpEntryType(0o100644), 'file');
  assert.equal(resolveSftpEntryType(0o120777), 'symlink');
  assert.equal(resolveSftpEntryType(0o010000), 'other');
});

test('resolveSftpEntryHiddenState detects dot-prefixed entries', () => {
  assert.equal(resolveSftpEntryHiddenState('.env', { mode: 0o100644 } as never), true);
  assert.equal(resolveSftpEntryHiddenState('.config', { mode: 0o040755 } as never), true);
  assert.equal(resolveSftpEntryHiddenState('visible.txt', { mode: 0o100644 } as never), false);
});

test('resolveSftpEntryHiddenState detects server-provided extended hidden markers', () => {
  assert.equal(
    resolveSftpEntryHiddenState('server-hidden.txt', {
      mode: 0o100644,
      extended: {
        'is-hidden': Buffer.from('true'),
      },
    } as never),
    true,
  );
  assert.equal(
    resolveSftpEntryHiddenState('server-visible.txt', {
      mode: 0o100644,
      extended: {
        hidden: 'false',
      },
    } as never),
    false,
  );
});

test('formatSftpPermissions returns symbolic permissions', () => {
  assert.equal(formatSftpPermissions(0o040755), 'drwxr-xr-x');
  assert.equal(formatSftpPermissions(0o100640), '-rw-r-----');
  assert.equal(formatSftpPermissions(0o120777), 'lrwxrwxrwx');
});

test('formatSftpPermissionOctal returns chmod-ready octal permissions', () => {
  assert.equal(formatSftpPermissionOctal(0o100644), '0644');
  assert.equal(formatSftpPermissionOctal(0o040755), '0755');
  assert.equal(formatSftpPermissionOctal(0o041755), '1755');
});

test('escapeSftpShellPath returns single-quoted shell tokens', () => {
  assert.equal(escapeSftpShellPath('/var/www/current'), "'/var/www/current'");
  assert.equal(escapeSftpShellPath("/tmp/it's here"), "'/tmp/it'\\''s here'");
});

test('SftpSessionService evicts sessions when SSH transport closes', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  registerTestSession(service, session);

  session.client.emit('close');

  assert.equal(session.isClosed, true);
  assert.equal(getTestInternals(service).sessions.has(session.sessionId), false);
  assert.deepEqual(await service.listDirectory(session.sessionId, '/'), { type: 'not-found' });
});

test('SftpSessionService closeSession remains idempotent for evicted sessions', () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  let endCallCount = 0;
  session.client.end = (): void => {
    endCallCount += 1;
  };
  registerTestSession(service, session);

  assert.equal(service.closeSession(session.sessionId), true);
  assert.equal(service.closeSession(session.sessionId), false);
  assert.equal(session.isClosed, true);
  assert.equal(endCallCount, 1);
});
