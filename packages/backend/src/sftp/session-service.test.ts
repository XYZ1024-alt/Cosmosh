import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
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

type TestSftpStats = {
  mode: number;
  size: number;
  mtime: number;
  atime: number;
  uid: number;
  gid: number;
  isFile(): boolean;
  isDirectory(): boolean;
};

type TestUploadSftp = EventEmitter & {
  stat(targetPath: string, callback: (error: Error | null, stats?: TestSftpStats) => void): void;
  createWriteStream(targetPath: string, options: { flags: string; mode: number }): Writable;
  rename(sourcePath: string, targetPath: string, callback: (error?: Error | null) => void): void;
  unlink(targetPath: string, callback: (error?: Error | null) => void): void;
  ext_openssh_rename?(sourcePath: string, targetPath: string, callback: (error?: Error | null) => void): void;
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

/**
 * Creates minimal ssh2-compatible stats for upload tests.
 *
 * @param options Stats options.
 * @returns Fake SFTP stats object.
 */
const createTestSftpStats = (options: { size: number; mtime: number; isFile?: boolean }): TestSftpStats => ({
  mode: options.isFile === false ? 0o040755 : 0o100644,
  size: options.size,
  mtime: options.mtime,
  atime: options.mtime,
  uid: 1000,
  gid: 1000,
  isFile: () => options.isFile !== false,
  isDirectory: () => options.isFile === false,
});

/**
 * Creates an SFTP stream mock that records upload replacement behavior.
 *
 * @param statsByPath Initial remote stats keyed by path.
 * @returns Mock SFTP wrapper and operation log.
 */
const createUploadSftpMock = (
  statsByPath: Record<string, TestSftpStats>,
  options: {
    posixRenameError?: Error;
    renameError?: Error;
    renameErrorCount?: number;
    unlinkError?: Error;
    withPosixRename?: boolean;
  } = {},
): {
  posixRenames: Array<{ sourcePath: string; targetPath: string }>;
  sftp: TestUploadSftp;
  unlinks: string[];
  writes: string[];
  writtenContentByPath: Map<string, string>;
  renames: Array<{ sourcePath: string; targetPath: string }>;
} => {
  const writes: string[] = [];
  const unlinks: string[] = [];
  const writtenContentByPath = new Map<string, string>();
  const renames: Array<{ sourcePath: string; targetPath: string }> = [];
  const posixRenames: Array<{ sourcePath: string; targetPath: string }> = [];
  const sftp = new EventEmitter() as TestUploadSftp;
  let renameErrorCount = options.renameErrorCount ?? (options.renameError ? Number.POSITIVE_INFINITY : 0);

  sftp.stat = (targetPath, callback): void => {
    const stats = statsByPath[targetPath];
    if (!stats) {
      const error = new Error('No such file') as Error & { code: number };
      error.code = 2;
      callback(error);
      return;
    }

    callback(null, stats);
  };
  sftp.createWriteStream = (targetPath, streamOptions): Writable => {
    const chunks: Buffer[] = [];
    writes.push(targetPath);
    return new Writable({
      write(chunk, _encoding, callback): void {
        chunks.push(Buffer.from(chunk));
        callback();
      },
      final(callback): void {
        const content = Buffer.concat(chunks).toString('utf8');
        writtenContentByPath.set(targetPath, content);
        statsByPath[targetPath] = createTestSftpStats({
          size: Buffer.byteLength(content),
          mtime: 1_710_000_010,
        });
        statsByPath[targetPath].mode = 0o100000 | streamOptions.mode;
        callback();
      },
    });
  };
  sftp.rename = (sourcePath, targetPath, callback): void => {
    renames.push({ sourcePath, targetPath });
    if (options.renameError && renameErrorCount > 0) {
      renameErrorCount -= 1;
      callback(options.renameError);
      return;
    }

    const sourceStats = statsByPath[sourcePath] ?? statsByPath[targetPath];
    statsByPath[targetPath] = createTestSftpStats({
      size: sourceStats?.size ?? 0,
      mtime: sourceStats?.mtime ?? Math.trunc(Date.now() / 1000),
    });
    callback(null);
  };
  sftp.unlink = (targetPath, callback): void => {
    unlinks.push(targetPath);
    if (options.unlinkError) {
      callback(options.unlinkError);
      return;
    }

    delete statsByPath[targetPath];
    callback(null);
  };
  if (options.withPosixRename) {
    sftp.ext_openssh_rename = (sourcePath, targetPath, callback): void => {
      posixRenames.push({ sourcePath, targetPath });
      if (options.posixRenameError) {
        callback(options.posixRenameError);
        return;
      }

      const sourceStats = statsByPath[sourcePath] ?? statsByPath[targetPath];
      statsByPath[targetPath] = createTestSftpStats({
        size: sourceStats?.size ?? 0,
        mtime: sourceStats?.mtime ?? Math.trunc(Date.now() / 1000),
      });
      callback(null);
    };
  }

  return { posixRenames, sftp, unlinks, writes, writtenContentByPath, renames };
};

/**
 * Creates a local test directory inside the controlled SFTP temp root.
 *
 * @returns Absolute temp directory path.
 */
const createSftpTemporaryTestDirectory = async (): Promise<string> => {
  const temporaryRootPath = path.join(os.tmpdir(), 'cosmosh-sftp');
  await fs.mkdir(temporaryRootPath, { recursive: true });
  return fs.mkdtemp(path.join(temporaryRootPath, 'upload-test-'));
};

/**
 * Builds an unused local path inside the controlled SFTP temp root.
 *
 * @returns Absolute temp-root path that does not need to exist.
 */
const resolveUnusedSftpTemporaryTestPath = (): string => {
  return path.join(os.tmpdir(), 'cosmosh-sftp', 'unused-local-path');
};

/**
 * Creates one uploadable local temp file.
 *
 * @param fileName Local file name.
 * @param content File content.
 * @returns Local file path and cleanup callback.
 */
const createUploadableTempFile = async (
  fileName: string,
  content: string,
): Promise<{ cleanup: () => Promise<void>; localPath: string }> => {
  const temporaryDirectoryPath = await createSftpTemporaryTestDirectory();
  const localPath = path.join(temporaryDirectoryPath, fileName);
  await fs.writeFile(localPath, content, 'utf8');

  return {
    localPath,
    cleanup: async (): Promise<void> => {
      await fs.rm(temporaryDirectoryPath, { force: true, recursive: true });
    },
  };
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

test('SftpSessionService uploadFile replaces a matching remote regular file', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/index.html';
  const openedMtime = 1_710_000_000;
  const uploadSftp = createUploadSftpMock({
    [remotePath]: createTestSftpStats({ size: 12, mtime: openedMtime }),
  });
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const uploadableFile = await createUploadableTempFile('index.html', 'locally edited');

  try {
    const result = await service.uploadFile(session.sessionId, remotePath, uploadableFile.localPath, {
      size: 12,
      modifiedAt: new Date(openedMtime * 1000).toISOString(),
    });

    assert.deepEqual(result, {
      type: 'success',
      sessionId: session.sessionId,
      path: remotePath,
      size: 14,
      modifiedAt: new Date(1_710_000_010 * 1000).toISOString(),
    });
    assert.equal(uploadSftp.writes.length, 1);
    assert.match(uploadSftp.writes[0] ?? '', /^\/var\/www\/\.index\.html\.cosmosh-.+\.tmp$/);
    assert.equal(uploadSftp.writtenContentByPath.get(uploadSftp.writes[0] ?? ''), 'locally edited');
    assert.deepEqual(uploadSftp.renames, [{ sourcePath: uploadSftp.writes[0], targetPath: remotePath }]);
  } finally {
    await uploadableFile.cleanup();
  }
});

test('SftpSessionService uploadFile creates a new remote file without an opening snapshot', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/new-file.txt';
  const uploadSftp = createUploadSftpMock({});
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const uploadableFile = await createUploadableTempFile('new-file.txt', 'new upload');

  try {
    const result = await service.uploadFile(session.sessionId, remotePath, uploadableFile.localPath);

    assert.equal(result.type, 'success');
    assert.deepEqual(uploadSftp.writes, [remotePath]);
    assert.deepEqual(uploadSftp.renames, []);
    assert.equal(uploadSftp.writtenContentByPath.get(remotePath), 'new upload');
  } finally {
    await uploadableFile.cleanup();
  }
});

test('SftpSessionService uploadFile requires confirmation before replacing an existing upload target', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/existing.txt';
  const uploadSftp = createUploadSftpMock({
    [remotePath]: createTestSftpStats({ size: 8, mtime: 1_710_000_000 }),
  });
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const result = await service.uploadFile(session.sessionId, remotePath, resolveUnusedSftpTemporaryTestPath());

  assert.deepEqual(result, {
    type: 'failed',
    message: 'errors.sftp.fileUploadTargetExists',
    reason: 'remote-conflict',
  });
  assert.deepEqual(uploadSftp.writes, []);
  assert.deepEqual(uploadSftp.renames, []);
});

test('SftpSessionService uploadFile treats a deleted opened file as a remote conflict', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/deleted-after-open.txt';
  const uploadSftp = createUploadSftpMock({});
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const result = await service.uploadFile(session.sessionId, remotePath, resolveUnusedSftpTemporaryTestPath(), {
    size: 8,
    modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
  });

  assert.deepEqual(result, {
    type: 'failed',
    message: 'errors.sftp.fileUploadRemoteChanged',
    reason: 'remote-conflict',
  });
  assert.deepEqual(uploadSftp.writes, []);
});

test('SftpSessionService uploadFile prefers OpenSSH posix rename when replacing existing files', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/index.html';
  const openedMtime = 1_710_000_000;
  const uploadSftp = createUploadSftpMock(
    {
      [remotePath]: createTestSftpStats({ size: 12, mtime: openedMtime }),
    },
    {
      withPosixRename: true,
    },
  );
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const uploadableFile = await createUploadableTempFile('index.html', 'posix edited');

  try {
    const result = await service.uploadFile(session.sessionId, remotePath, uploadableFile.localPath, {
      size: 12,
      modifiedAt: new Date(openedMtime * 1000).toISOString(),
    });

    assert.equal(result.type, 'success');
    assert.equal(uploadSftp.posixRenames.length, 1);
    assert.deepEqual(uploadSftp.renames, []);
    assert.equal(uploadSftp.writtenContentByPath.get(uploadSftp.writes[0] ?? ''), 'posix edited');
  } finally {
    await uploadableFile.cleanup();
  }
});

test('SftpSessionService uploadFile falls back when servers reject overwrite rename with failure', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/index.html';
  const openedMtime = 1_710_000_000;
  const uploadSftp = createUploadSftpMock(
    {
      [remotePath]: createTestSftpStats({ size: 12, mtime: openedMtime }),
    },
    {
      renameError: new Error('failure'),
      renameErrorCount: 1,
    },
  );
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const uploadableFile = await createUploadableTempFile('index.html', 'fallback edited');

  try {
    const result = await service.uploadFile(session.sessionId, remotePath, uploadableFile.localPath, {
      size: 12,
      modifiedAt: new Date(openedMtime * 1000).toISOString(),
    });

    assert.equal(result.type, 'success');
    assert.equal(uploadSftp.renames.length, 2);
    assert.deepEqual(uploadSftp.unlinks, [remotePath]);
    assert.deepEqual(uploadSftp.renames[1], { sourcePath: uploadSftp.writes[0], targetPath: remotePath });
  } finally {
    await uploadableFile.cleanup();
  }
});

test('SftpSessionService uploadFile blocks fallback replacement if remote changed after first rename failure', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/index.html';
  const openedMtime = 1_710_000_000;
  const uploadSftp = createUploadSftpMock(
    {
      [remotePath]: createTestSftpStats({ size: 12, mtime: openedMtime }),
    },
    {
      renameError: new Error('failure'),
      renameErrorCount: 1,
    },
  );
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const uploadableFile = await createUploadableTempFile('index.html', 'conflict edited');

  try {
    const originalStat = uploadSftp.sftp.stat;
    let statCallCount = 0;
    uploadSftp.sftp.stat = (targetPath, callback): void => {
      statCallCount += 1;
      if (targetPath === remotePath && statCallCount >= 2) {
        callback(null, createTestSftpStats({ size: 13, mtime: 1_710_000_001 }));
        return;
      }

      originalStat(targetPath, callback);
    };

    const result = await service.uploadFile(session.sessionId, remotePath, uploadableFile.localPath, {
      size: 12,
      modifiedAt: new Date(openedMtime * 1000).toISOString(),
    });

    assert.deepEqual(result, {
      type: 'failed',
      message: 'errors.sftp.fileUploadRemoteChanged',
      reason: 'remote-conflict',
    });
    assert.deepEqual(uploadSftp.unlinks, [uploadSftp.writes[0]]);
    assert.equal(uploadSftp.renames.length, 1);
  } finally {
    await uploadableFile.cleanup();
  }
});

test('SftpSessionService uploadFile blocks remote size or mtime conflicts before writing', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/app.js';
  const uploadSftp = createUploadSftpMock({
    [remotePath]: createTestSftpStats({ size: 13, mtime: 1_710_000_005 }),
  });
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const result = await service.uploadFile(session.sessionId, remotePath, resolveUnusedSftpTemporaryTestPath(), {
    size: 12,
    modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
  });

  assert.deepEqual(result, {
    type: 'failed',
    message: 'errors.sftp.fileUploadRemoteChanged',
    reason: 'remote-conflict',
  });
  assert.deepEqual(uploadSftp.writes, []);
  assert.deepEqual(uploadSftp.renames, []);
});

test('SftpSessionService uploadFile overwrites after explicit conflict confirmation', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/app.js';
  const uploadSftp = createUploadSftpMock({
    [remotePath]: createTestSftpStats({ size: 13, mtime: 1_710_000_005 }),
  });
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const uploadableFile = await createUploadableTempFile('app.js', 'overwrite edited');

  try {
    const result = await service.uploadFile(
      session.sessionId,
      remotePath,
      uploadableFile.localPath,
      {
        size: 12,
        modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
      },
      {
        overwrite: true,
      },
    );

    assert.equal(result.type, 'success');
    assert.equal(uploadSftp.writes.length, 1);
    assert.deepEqual(uploadSftp.renames, [{ sourcePath: uploadSftp.writes[0], targetPath: remotePath }]);
    assert.equal(uploadSftp.writtenContentByPath.get(uploadSftp.writes[0] ?? ''), 'overwrite edited');
  } finally {
    await uploadableFile.cleanup();
  }
});

test('SftpSessionService uploadFile rejects non-file remote targets', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/var/www/assets';
  const uploadSftp = createUploadSftpMock({
    [remotePath]: createTestSftpStats({ size: 0, mtime: 1_710_000_000, isFile: false }),
  });
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const result = await service.uploadFile(session.sessionId, remotePath, resolveUnusedSftpTemporaryTestPath(), {
    size: 0,
    modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
  });

  assert.deepEqual(result, {
    type: 'failed',
    message: 'errors.sftp.fileUploadUnsupported',
  });
  assert.deepEqual(uploadSftp.writes, []);
  assert.deepEqual(uploadSftp.renames, []);
});

test('SftpSessionService uploadFile reports missing sessions without touching the filesystem', async () => {
  const service = createTestSftpSessionService();

  const result = await service.uploadFile('missing-session', '/tmp/file.txt', resolveUnusedSftpTemporaryTestPath(), {
    size: 1,
    modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
  });

  assert.deepEqual(result, { type: 'not-found' });
});

test('SftpSessionService uploadFile requires a local file path', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/tmp/file.txt';
  const uploadSftp = createUploadSftpMock({
    [remotePath]: createTestSftpStats({ size: 1, mtime: 1_710_000_000 }),
  });
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const result = await service.uploadFile(session.sessionId, remotePath, '', {
    size: 1,
    modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
  });

  assert.deepEqual(result, {
    type: 'failed',
    message: 'errors.sftp.localPathRequired',
  });
  assert.deepEqual(uploadSftp.writes, []);
  assert.deepEqual(uploadSftp.renames, []);
});

test('SftpSessionService uploadFile rejects local paths outside the controlled SFTP temp root', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/tmp/file.txt';
  const uploadSftp = createUploadSftpMock({
    [remotePath]: createTestSftpStats({ size: 1, mtime: 1_710_000_000 }),
  });
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const result = await service.uploadFile(session.sessionId, remotePath, path.join(os.tmpdir(), 'outside.txt'), {
    size: 1,
    modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
  });

  assert.deepEqual(result, {
    type: 'failed',
    message: 'errors.sftp.localFileReadUnsupported',
  });
  assert.deepEqual(uploadSftp.writes, []);
  assert.deepEqual(uploadSftp.renames, []);
});

test('SftpSessionService uploadFile keeps the primary error when temp cleanup also fails', async () => {
  const service = createTestSftpSessionService();
  const session = createTestSftpSession();
  const remotePath = '/tmp/file.txt';
  const uploadSftp = createUploadSftpMock(
    {
      [remotePath]: createTestSftpStats({ size: 5, mtime: 1_710_000_000 }),
    },
    {
      renameError: new Error('rename failed'),
      unlinkError: new Error('unlink failed'),
    },
  );
  session.sftp = uploadSftp.sftp;
  registerTestSession(service, session);

  const temporaryDirectoryPath = await createSftpTemporaryTestDirectory();
  const localPath = path.join(temporaryDirectoryPath, 'file.txt');
  await fs.writeFile(localPath, 'hello', 'utf8');

  try {
    const result = await service.uploadFile(session.sessionId, remotePath, localPath, {
      size: 5,
      modifiedAt: new Date(1_710_000_000 * 1000).toISOString(),
    });

    assert.deepEqual(result, {
      type: 'failed',
      message: 'rename failed',
    });
    assert.deepEqual(uploadSftp.unlinks, [uploadSftp.writes[0]]);
  } finally {
    await fs.rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
});
