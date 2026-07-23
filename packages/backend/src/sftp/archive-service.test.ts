import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';

import type { ApiSftpArchiveOperationData, ApiSftpArchiveOperationRequest } from '@cosmosh/api-contract';
import type { Client, ClientChannel, SFTPWrapper, Stats } from 'ssh2';

import type { AuditEventService } from '../audit/service.js';
import {
  buildArchiveCapabilities,
  detectArchiveFormatFromName,
  isSafeArchiveMember,
  quotePosixShellToken,
  SftpArchiveError,
  SftpArchiveService,
  type SftpArchiveSession,
  stripArchiveExtension,
  validateStagedTree,
} from './archive-service.js';

const POSIX_PATH = path.posix;
const DIRECTORY_MODE = 0o040755;
const FILE_MODE = 0o100644;

type MockRemoteNode = {
  data: Buffer;
  mode: number;
};

/** Minimal evented channel used to drive ssh2 exec lifecycle behavior. */
class MockClientChannel extends EventEmitter {
  public readonly stderr = new EventEmitter();

  public signalCount = 0;

  public signalError: Error | null = null;

  private completed = false;

  /** Completes one remote command through the same exit/close events as ssh2. */
  public complete(stdout = '', exitCode = 0): void {
    if (this.completed) return;
    this.completed = true;
    if (stdout) this.emit('data', Buffer.from(stdout));
    this.emit('exit', exitCode, null);
    this.emit('close');
  }

  /** Records TERM and lets the held command close on the next microtask. */
  public signal(signalName: string): void {
    assert.equal(signalName, 'TERM');
    this.signalCount += 1;
    if (this.signalError) throw this.signalError;
    queueMicrotask(() => this.complete('', 143));
  }

  /** Forces a held channel closed. */
  public close(): void {
    this.complete('', 143);
  }

  /** Mirrors the Duplex destroy fallback used after a remote channel ignores close. */
  public destroy(): this {
    this.complete('', 143);
    return this;
  }
}

/** In-memory POSIX host supporting the SFTP calls used by archive operations. */
class MockArchiveHost {
  public readonly commands: string[] = [];

  public readonly nodes = new Map<string, MockRemoteNode>();

  public extractMembers: string[] = [];

  public probeTools = ['sh', 'tar', 'gzip', 'xz', 'bzip2', 'zip', 'unzip', '7zz'];

  public execError: Error | null = null;

  public holdArchiveCommands = false;

  public holdArchiveExecCallback = false;

  public holdStagingReaddir = false;

  public holdProbe = false;

  public heldArchiveChannel: MockClientChannel | null = null;

  public heldProbeChannel: MockClientChannel | null = null;

  public pendingArchiveExec: (() => void) | null = null;

  public pendingArchiveChannel: MockClientChannel | null = null;

  public afterRename: ((sourcePath: string, targetPath: string) => void) | null = null;

  private readonly pendingStagingReaddirs: Array<() => void> = [];

  public readonly lstatPaths: string[] = [];

  public readonly client: Client;

  public readonly sftp: SFTPWrapper;

  /** Returns the oldest staged-tree listing currently held by the mock host. */
  public get pendingStagingReaddir(): (() => void) | null {
    return this.pendingStagingReaddirs[0] ?? null;
  }

  /** Creates a host rooted at `/srv`. */
  public constructor() {
    this.addDirectory('/srv');
    this.client = {
      exec: (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
        this.commands.push(command);
        if (this.execError) {
          callback(this.execError, undefined as unknown as ClientChannel);
          return undefined as unknown as ClientChannel;
        }
        const channel = new MockClientChannel();
        const startCommand = (): void => {
          callback(undefined, channel as unknown as ClientChannel);
          if (command.startsWith('for c in sh tar')) {
            if (this.holdProbe) this.heldProbeChannel = channel;
            else queueMicrotask(() => channel.complete(`${this.probeTools.join('\n')}\n`));
            return;
          }
          if (/^exec (gzip|xz|bzip2) -dc /.test(command)) {
            const outputPath = /> '([^']+)'$/.exec(command)?.[1];
            if (outputPath) this.addFile(outputPath, Buffer.alloc(1_024));
            queueMicrotask(() => channel.complete());
            return;
          }
          if (command.includes('unzip -Z1') || command.includes(' l -slt ') || command.includes('tar -tf')) {
            queueMicrotask(() => channel.complete(`${this.extractMembers.join('\n')}\n`));
            return;
          }
          if (
            (command.includes('unzip') && command.includes(' -qq -n ')) ||
            command.includes(' x -bd ') ||
            command.includes('tar -xf')
          ) {
            const stagingPath =
              /-d '([^']+)'/.exec(command)?.[1] ??
              /-o'([^']+)'/.exec(command)?.[1] ??
              /-C '([^']+)'/.exec(command)?.[1];
            if (stagingPath) {
              for (const member of this.extractMembers) this.addFile(POSIX_PATH.join(stagingPath, member), 'new');
            }
            queueMicrotask(() => channel.complete());
            return;
          }
          if (this.holdArchiveCommands) this.heldArchiveChannel = channel;
          else queueMicrotask(() => channel.complete());
        };
        if (this.holdArchiveExecCallback && !command.startsWith('for c in sh tar')) {
          this.pendingArchiveChannel = channel;
          this.pendingArchiveExec = () => {
            this.pendingArchiveExec = null;
            this.holdArchiveExecCallback = false;
            startCommand();
          };
          return channel as unknown as ClientChannel;
        }
        startCommand();
        return channel as unknown as ClientChannel;
      },
    } as unknown as Client;
    this.sftp = {
      close: (_handle: Buffer, callback: (error?: Error | null) => void) => callback(),
      lstat: (targetPath: string, callback: (error: Error | null, stats: Stats) => void) => {
        const normalizedPath = POSIX_PATH.normalize(targetPath);
        this.lstatPaths.push(normalizedPath);
        const node = this.nodes.get(normalizedPath);
        if (!node) {
          callback(this.missingPathError(), this.stats(FILE_MODE));
          return;
        }
        callback(null, this.stats(node.mode, node.data.length));
      },
      mkdir: (targetPath: string, _attributes: unknown, callback: (error?: Error | null) => void) => {
        this.addDirectory(targetPath);
        callback();
      },
      open: (targetPath: string, _flags: string, callback: (error: Error | null, handle: Buffer) => void) => {
        if (!this.nodes.has(POSIX_PATH.normalize(targetPath))) {
          callback(this.missingPathError(), Buffer.alloc(0));
          return;
        }
        callback(null, Buffer.from(POSIX_PATH.normalize(targetPath)));
      },
      read: (
        handle: Buffer,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
        callback: (error: Error | null, bytesRead: number, data: Buffer) => void,
      ) => {
        const data = this.nodes.get(handle.toString())?.data ?? Buffer.alloc(0);
        const bytes = data.subarray(position, position + length);
        bytes.copy(buffer, offset);
        callback(null, bytes.length, buffer);
      },
      readdir: (
        targetPath: string,
        callback: (error: Error | null, entries: Array<{ filename: string; attrs: Stats }>) => void,
      ) => {
        const normalized = POSIX_PATH.normalize(targetPath);
        const complete = (): void => {
          if (!this.nodes.has(normalized)) {
            callback(this.missingPathError(), []);
            return;
          }
          const prefix = normalized === '/' ? '/' : `${normalized}/`;
          const names = new Set<string>();
          for (const candidate of this.nodes.keys()) {
            if (!candidate.startsWith(prefix)) continue;
            const childName = candidate.slice(prefix.length).split('/')[0];
            if (childName) names.add(childName);
          }
          callback(
            null,
            [...names].map((filename) => {
              const node = this.nodes.get(POSIX_PATH.join(normalized, filename));
              return { filename, attrs: this.stats(node?.mode ?? DIRECTORY_MODE, node?.data.length ?? 0) };
            }),
          );
        };
        if (this.holdStagingReaddir && POSIX_PATH.basename(normalized).startsWith('.cosmosh-')) {
          this.holdStagingReaddir = false;
          this.pendingStagingReaddirs.push(complete);
          return;
        }
        complete();
      },
      rename: (sourcePath: string, targetPath: string, callback: (error?: Error | null) => void) => {
        this.renameTree(sourcePath, targetPath);
        this.afterRename?.(POSIX_PATH.normalize(sourcePath), POSIX_PATH.normalize(targetPath));
        callback();
      },
      rmdir: (targetPath: string, callback: (error?: Error | null) => void) => {
        this.nodes.delete(POSIX_PATH.normalize(targetPath));
        callback();
      },
      unlink: (targetPath: string, callback: (error?: Error | null) => void) => {
        this.nodes.delete(POSIX_PATH.normalize(targetPath));
        callback();
      },
    } as unknown as SFTPWrapper;
  }

  /** Adds a directory and missing parents. */
  public addDirectory(targetPath: string): void {
    const normalized = POSIX_PATH.normalize(targetPath);
    const parent = POSIX_PATH.dirname(normalized);
    if (normalized !== '/' && parent !== normalized && !this.nodes.has(parent)) this.addDirectory(parent);
    this.nodes.set(normalized, { data: Buffer.alloc(0), mode: DIRECTORY_MODE });
  }

  /** Adds a regular file and missing parent directories. */
  public addFile(targetPath: string, data: Buffer | string = ''): void {
    const normalized = POSIX_PATH.normalize(targetPath);
    this.addDirectory(POSIX_PATH.dirname(normalized));
    this.nodes.set(normalized, { data: Buffer.isBuffer(data) ? data : Buffer.from(data), mode: FILE_MODE });
  }

  /** Releases a deliberately delayed capability probe. */
  public releaseProbe(): void {
    this.heldProbeChannel?.complete('sh\ntar\ngzip\nxz\nbzip2\nzip\nunzip\n7zz\n');
    this.heldProbeChannel = null;
  }

  /** Releases one exec callback held before the service receives its channel. */
  public releaseArchiveExec(): void {
    this.pendingArchiveExec?.();
  }

  /** Releases one staged-tree directory listing. */
  public releaseStagingReaddir(): void {
    this.pendingStagingReaddirs.shift()?.();
  }

  /** Returns a compact ssh2-compatible stats value. */
  private stats(mode: number, size = 0): Stats {
    return { mode, size } as Stats;
  }

  /** Creates an error shape recognized by the service as a missing SFTP path. */
  private missingPathError(): Error {
    return Object.assign(new Error('No such file'), { code: 2 });
  }

  /** Moves a file or complete directory tree to a new path. */
  private renameTree(sourcePath: string, targetPath: string): void {
    const source = POSIX_PATH.normalize(sourcePath);
    const target = POSIX_PATH.normalize(targetPath);
    const entries = [...this.nodes.entries()].filter(
      ([candidate]) => candidate === source || candidate.startsWith(`${source}/`),
    );
    if (entries.length === 0) {
      this.addFile(target);
      return;
    }
    for (const [candidate] of entries) this.nodes.delete(candidate);
    for (const [candidate, node] of entries) this.nodes.set(`${target}${candidate.slice(source.length)}`, node);
  }
}

/** Creates a service and session using one in-memory remote host. */
const createArchiveTestContext = (
  host = new MockArchiveHost(),
  options: { operationTimeoutMs?: number; sessionCloseTimeoutMs?: number } = {},
): {
  host: MockArchiveHost;
  service: SftpArchiveService;
  session: SftpArchiveSession;
} => {
  const auditEventService = { logEvent: async () => undefined } as unknown as AuditEventService;
  return {
    host,
    service: new SftpArchiveService({ auditEventService, ...options }),
    session: {
      sessionId: 'session-test',
      serverId: 'server-test',
      client: host.client,
      sftp: host.sftp,
      isClosed: false,
    },
  };
};

/** Waits for an asynchronous archive task to expose a requested state. */
const waitForOperationState = async (
  service: SftpArchiveService,
  operation: ApiSftpArchiveOperationData,
  expectedState: ApiSftpArchiveOperationData['state'],
): Promise<ApiSftpArchiveOperationData> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const current = service.getOperation(operation.sessionId, operation.operationId);
    if (current.state === expectedState) return current;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Archive operation did not reach ${expectedState}.`);
};

const TAR_REQUEST: ApiSftpArchiveOperationRequest = {
  type: 'compress',
  sourcePaths: ['/srv/input.txt'],
  targetDirectoryPath: '/srv',
  archiveName: 'output.tar',
  format: 'tar',
  compressionLevel: 'store',
};

test('buildArchiveCapabilities maps a complete POSIX tool host', () => {
  const capabilities = buildArchiveCapabilities(
    new Set(['sh', 'tar', 'gzip', 'xz', 'bzip2', 'zip', 'unzip', '7zz']),
    'session-1',
  );

  assert.deepEqual(capabilities, {
    sessionId: 'session-1',
    canExec: true,
    createFormats: ['tar', 'tar-gzip', 'tar-xz', 'tar-bzip2', 'zip', '7z'],
    extractFormats: ['tar', 'tar-gzip', 'tar-xz', 'tar-bzip2', 'zip', '7z'],
  });
});

test('buildArchiveCapabilities limits a tar-only BusyBox-style host', () => {
  const capabilities = buildArchiveCapabilities(new Set(['sh', 'tar']), 'session-2');
  assert.deepEqual(capabilities.createFormats, ['tar']);
  assert.deepEqual(capabilities.extractFormats, ['tar']);
});

test('SftpArchiveService keeps available tools when trailing optional probe tools are missing', async () => {
  const host = new MockArchiveHost();
  host.probeTools = ['sh', 'tar'];
  const { service, session } = createArchiveTestContext(host);

  assert.deepEqual(await service.getCapabilities(session), {
    sessionId: session.sessionId,
    canExec: true,
    createFormats: ['tar'],
    extractFormats: ['tar'],
  });
  assert.match(host.commands[0] ?? '', /do if command -v "\$c" >\/dev\/null 2>&1; then printf .*; fi; done$/);
});

test('SftpArchiveService disables archive capabilities when remote exec is rejected', async () => {
  const host = new MockArchiveHost();
  host.execError = new Error('administratively prohibited');
  const { service, session } = createArchiveTestContext(host);

  assert.deepEqual(await service.getCapabilities(session), {
    sessionId: session.sessionId,
    canExec: false,
    createFormats: [],
    extractFormats: [],
  });
  await assert.rejects(
    service.startOperation(session, TAR_REQUEST),
    (error: unknown) => error instanceof SftpArchiveError && error.code === 'SFTP_ARCHIVE_UNSUPPORTED',
  );
});

test('quotePosixShellToken protects hostile remote basenames', () => {
  assert.equal(quotePosixShellToken("$(touch /tmp/pwned); it's"), "'$(touch /tmp/pwned); it'\\''s'");
});

test('isSafeArchiveMember rejects absolute and traversal members', () => {
  assert.equal(isSafeArchiveMember('app/index.js'), true);
  assert.equal(isSafeArchiveMember('../etc/passwd'), false);
  assert.equal(isSafeArchiveMember('/etc/passwd'), false);
  assert.equal(isSafeArchiveMember('C:\\Windows\\System32'), false);
  assert.equal(isSafeArchiveMember('safe/../../outside'), false);
});

test('archive name detection handles compound aliases', () => {
  assert.equal(detectArchiveFormatFromName('release.tgz'), 'tar-gzip');
  assert.equal(detectArchiveFormatFromName('release.txz'), 'tar-xz');
  assert.equal(detectArchiveFormatFromName('release.tbz2'), 'tar-bzip2');
  assert.equal(stripArchiveExtension('release.tar.gz'), 'release');
});

test('archive name detection uses locale-invariant case folding', () => {
  const localeSensitiveName = new String('BACKUP.ZIP');
  localeSensitiveName.toLocaleLowerCase = () => 'backup.z\u0131p';

  assert.equal(detectArchiveFormatFromName(localeSensitiveName as unknown as string), 'zip');
  assert.equal(stripArchiveExtension(localeSensitiveName as unknown as string), 'BACKUP');
});

test('SftpArchiveService reserves the session mutex while capabilities are probing', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/input.txt', 'input');
  host.holdProbe = true;
  host.holdArchiveCommands = true;

  const firstStart = service.startOperation(session, TAR_REQUEST);
  await assert.rejects(
    service.startOperation(session, TAR_REQUEST),
    (error: unknown) => error instanceof SftpArchiveError && error.code === 'SFTP_ARCHIVE_BUSY',
  );
  host.releaseProbe();
  const operation = await firstStart;
  service.cancelOperation(session.sessionId, operation.operationId);
  await waitForOperationState(service, operation, 'cancelled');
});

test('SftpArchiveService rejects compression levels that do not match the format', async () => {
  const { service, session } = createArchiveTestContext();
  await assert.rejects(
    service.startOperation(session, { ...TAR_REQUEST, compressionLevel: 'standard' }),
    (error: unknown) => error instanceof SftpArchiveError && error.code === 'SFTP_VALIDATION_FAILED',
  );
  await assert.rejects(
    service.startOperation(session, {
      ...TAR_REQUEST,
      archiveName: 'output.tar.gz',
      format: 'tar-gzip',
      compressionLevel: 'store',
    }),
    (error: unknown) => error instanceof SftpArchiveError && error.code === 'SFTP_VALIDATION_FAILED',
  );
});

test('SftpArchiveService compresses hostile basenames through quoted fixed command tokens', async () => {
  const { host, service, session } = createArchiveTestContext();
  const hostileName = "report '$(touch pwned)'.txt";
  host.addFile(`/srv/${hostileName}`, 'input');
  const operation = await service.startOperation(session, {
    ...TAR_REQUEST,
    sourcePaths: [`/srv/${hostileName}`],
  });

  const completed = await waitForOperationState(service, operation, 'succeeded');
  const archiveCommand = host.commands.find((command) => command.includes('tar -cf') && !command.includes('for c in'));
  assert.ok(archiveCommand);
  assert.match(archiveCommand, /'\.\/report '\\''\$\(touch pwned\)'\\''\.txt'/);
  assert.deepEqual(completed.resultPaths, ['/srv/output.tar']);
  assert.equal(host.nodes.has('/srv/output.tar'), true);
});

test('SftpArchiveService keeps a completed compression commit successful after late cancellation', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/input.txt', 'input');
  let operationId: string | null = null;
  host.afterRename = (_sourcePath, targetPath) => {
    if (targetPath === '/srv/output.tar' && operationId) {
      service.cancelOperation(session.sessionId, operationId);
    }
  };

  const operation = await service.startOperation(session, TAR_REQUEST);
  operationId = operation.operationId;
  const completed = await waitForOperationState(service, operation, 'succeeded');

  assert.equal(completed.cancelRequested, true);
  assert.deepEqual(completed.resultPaths, ['/srv/output.tar']);
  assert.equal(host.nodes.has('/srv/output.tar'), true);
});

test('SftpArchiveService publishes cancellation only after the held channel closes', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/input.txt', 'input');
  await service.getCapabilities(session);
  host.holdArchiveCommands = true;
  const operation = await service.startOperation(session, TAR_REQUEST);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const requested = service.cancelOperation(session.sessionId, operation.operationId);
  assert.equal(requested.cancelRequested, true);
  assert.equal(requested.state, 'running');
  const completed = await waitForOperationState(service, operation, 'cancelled');
  assert.equal(completed.stage, 'completed');
  assert.equal(host.heldArchiveChannel?.signalCount, 1);
});

test('SftpArchiveService signals a command whose exec callback arrives after cancellation', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/input.txt', 'input');
  await service.getCapabilities(session);
  host.holdArchiveExecCallback = true;
  const operation = await service.startOperation(session, TAR_REQUEST);
  for (let attempt = 0; attempt < 100 && !host.pendingArchiveExec; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(host.pendingArchiveExec);

  const requested = service.cancelOperation(session.sessionId, operation.operationId);
  assert.equal(requested.cancelRequested, true);
  host.releaseArchiveExec();

  const completed = await waitForOperationState(service, operation, 'cancelled');
  assert.equal(completed.stage, 'completed');
  assert.equal(host.pendingArchiveChannel?.signalCount, 1);
});

test('SftpArchiveService keeps cancellation available when TERM is rejected', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/input.txt', 'input');
  await service.getCapabilities(session);
  host.holdArchiveCommands = true;
  const operation = await service.startOperation(session, TAR_REQUEST);
  for (let attempt = 0; attempt < 100 && !host.heldArchiveChannel; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  const channel = host.heldArchiveChannel;
  assert.ok(channel);

  channel.signalError = new Error('TERM is unsupported');
  const requested = service.cancelOperation(session.sessionId, operation.operationId);
  assert.equal(requested.cancelRequested, true);
  assert.equal(channel.signalCount, 1);

  channel.close();
  const completed = await waitForOperationState(service, operation, 'cancelled');
  assert.equal(completed.stage, 'completed');
});

test('SftpArchiveService closeSession waits for active command cancellation and cleanup', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/input.txt', 'input');
  host.holdArchiveCommands = true;

  const operation = await service.startOperation(session, TAR_REQUEST);
  for (let attempt = 0; attempt < 100 && !host.heldArchiveChannel; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  const channel = host.heldArchiveChannel;
  assert.ok(channel);

  await service.closeSession(session.sessionId);

  assert.equal(channel.signalCount, 1);
  assert.equal(service.getOperation(session.sessionId, operation.operationId).state, 'cancelled');
  assert.equal(
    [...host.nodes.keys()].some((entryPath) => POSIX_PATH.basename(entryPath).startsWith('.cosmosh-')),
    false,
  );
});

test('SftpArchiveService closeSession stops waiting when remote cleanup stalls', async () => {
  const host = new MockArchiveHost();
  const { service, session } = createArchiveTestContext(host, { sessionCloseTimeoutMs: 50 });
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.extractMembers = ['nested/payload.txt'];
  host.holdStagingReaddir = true;
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });
  for (let attempt = 0; attempt < 100 && !host.pendingStagingReaddir; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(host.pendingStagingReaddir);

  service.cancelOperation(session.sessionId, operation.operationId);
  host.holdStagingReaddir = true;
  host.releaseStagingReaddir();
  for (
    let attempt = 0;
    attempt < 100 &&
    (service.getOperation(session.sessionId, operation.operationId).stage !== 'cleaning' ||
      !host.pendingStagingReaddir);
    attempt += 1
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(service.getOperation(session.sessionId, operation.operationId).stage, 'cleaning');
  assert.ok(host.pendingStagingReaddir);

  host.holdStagingReaddir = true;
  const closeStartedAt = Date.now();
  await service.closeSession(session.sessionId);
  assert.ok(Date.now() - closeStartedAt < 500);

  host.holdStagingReaddir = false;
  host.releaseStagingReaddir();
  const completed = await waitForOperationState(service, operation, 'cancelled');
  assert.equal(completed.stage, 'completed');
});

test('SftpArchiveService smart extraction numbers a multi-entry archive directory without prompting', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.addDirectory('/srv/archive');
  host.extractMembers = ['alpha.txt', 'beta.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'smart',
  });

  const completed = await waitForOperationState(service, operation, 'succeeded');
  assert.deepEqual(completed.resultPaths, ['/srv/archive (2)']);
  assert.equal(host.nodes.has('/srv/archive (2)/alpha.txt'), true);
  assert.equal(host.nodes.has('/srv/archive (2)/beta.txt'), true);
});

test('SftpArchiveService extracts to an existing custom remote directory', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.addDirectory('/srv/output');
  host.extractMembers = ['payload.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv/output',
    destinationMode: 'current-directory',
  });

  const completed = await waitForOperationState(service, operation, 'succeeded');
  assert.deepEqual(completed.resultPaths, ['/srv/output/payload.txt']);
  assert.equal(host.nodes.has('/srv/output/payload.txt'), true);
});

test('SftpArchiveService creates missing custom destination segments', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.extractMembers = ['payload.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv/new/output',
    destinationMode: 'current-directory',
  });

  const completed = await waitForOperationState(service, operation, 'succeeded');
  assert.deepEqual(completed.resultPaths, ['/srv/new/output/payload.txt']);
  assert.equal(host.nodes.has('/srv/new/output/payload.txt'), true);
});

test('SftpArchiveService removes empty destination segments after extraction failure', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/broken.zip', 'not-a-zip');
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/broken.zip',
    targetDirectoryPath: '/srv/new/output',
    destinationMode: 'current-directory',
  });

  const completed = await waitForOperationState(service, operation, 'failed');
  assert.equal(completed.errorCode, 'SFTP_ARCHIVE_UNSUPPORTED');
  assert.equal(host.nodes.has('/srv/new/output'), false);
  assert.equal(host.nodes.has('/srv/new'), false);
});

test('SftpArchiveService exposes cancellable post-extraction verification', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.extractMembers = ['nested/payload.txt'];
  host.holdStagingReaddir = true;
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });
  for (let attempt = 0; attempt < 100 && !host.pendingStagingReaddir; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(host.pendingStagingReaddir);
  assert.equal(service.getOperation(session.sessionId, operation.operationId).stage, 'verifying');

  service.cancelOperation(session.sessionId, operation.operationId);
  host.releaseStagingReaddir();

  const completed = await waitForOperationState(service, operation, 'cancelled');
  assert.equal(completed.stage, 'completed');
});

test('SftpArchiveService applies one absolute deadline to stalled SFTP requests and releases the session', async () => {
  const host = new MockArchiveHost();
  const { service, session } = createArchiveTestContext(host, { operationTimeoutMs: 100 });
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.extractMembers = ['nested/payload.txt'];
  host.holdStagingReaddir = true;
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });
  for (let attempt = 0; attempt < 100 && !host.pendingStagingReaddir; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(host.pendingStagingReaddir);

  const completed = await waitForOperationState(service, operation, 'failed');
  assert.equal(completed.errorCode, 'SFTP_ARCHIVE_TIMEOUT');
  assert.equal(completed.stage, 'completed');

  host.releaseStagingReaddir();
  host.addFile('/srv/input.txt', 'input');
  const nextOperation = await service.startOperation(session, TAR_REQUEST);
  const nextCompleted = await waitForOperationState(service, nextOperation, 'succeeded');
  assert.deepEqual(nextCompleted.resultPaths, ['/srv/output.tar']);
});

test('validateStagedTree reuses readdir modes for ordinary files', async () => {
  const host = new MockArchiveHost();
  host.addDirectory('/srv/staging');
  for (let index = 0; index < 250; index += 1) host.addFile(`/srv/staging/file-${index}.txt`, 'payload');

  await validateStagedTree(host.sftp, '/srv/staging', '/srv/staging', () => undefined, DIRECTORY_MODE);

  assert.deepEqual(host.lstatPaths, []);
});

test('SftpArchiveService accepts an empty tar and applies the smart empty-archive directory rule', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/empty.tar', Buffer.alloc(1_024));
  host.extractMembers = [];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/empty.tar',
    targetDirectoryPath: '/srv',
    destinationMode: 'smart',
  });

  const completed = await waitForOperationState(service, operation, 'succeeded');
  assert.deepEqual(completed.resultPaths, ['/srv/empty']);
  assert.equal(host.nodes.get('/srv/empty')?.mode, DIRECTORY_MODE);
});

test('SftpArchiveService expands compressed tar streams before ordinary tar validation and extraction', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.tgz', Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
  host.extractMembers = ['payload.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.tgz',
    targetDirectoryPath: '/srv',
    destinationMode: 'smart',
  });

  const completed = await waitForOperationState(service, operation, 'succeeded');
  assert.deepEqual(completed.resultPaths, ['/srv/payload.txt']);
  assert.equal(host.nodes.get('/srv/payload.txt')?.data.toString(), 'new');
  assert.equal(
    host.commands.some((command) => command.startsWith('exec gzip -dc -- ')),
    true,
  );
  assert.equal(
    host.commands.some((command) => command.startsWith('exec tar -tf ')),
    true,
  );
  assert.equal(
    host.commands.some((command) => command.startsWith('exec tar -xf ')),
    true,
  );
});

test('SftpArchiveService keep-both applies one conflict decision to extracted entries', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.addFile('/srv/report.txt', 'original');
  host.extractMembers = ['report.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });

  const waiting = await waitForOperationState(service, operation, 'awaiting-conflict');
  assert.equal(waiting.conflicts?.[0]?.targetPath, '/srv/report.txt');
  service.resolveConflict(session.sessionId, operation.operationId, 'keep-both');
  const completed = await waitForOperationState(service, operation, 'succeeded');
  assert.deepEqual(completed.resultPaths, ['/srv/report.txt (2)']);
  assert.equal(host.nodes.get('/srv/report.txt')?.data.toString(), 'original');
  assert.equal(host.nodes.get('/srv/report.txt (2)')?.data.toString(), 'new');
});

test('SftpArchiveService overwrite recursively merges directories and preserves unrelated files', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.addFile('/srv/config/keep.txt', 'keep');
  host.addFile('/srv/config/replace.txt', 'old');
  host.extractMembers = ['config/new.txt', 'config/replace.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });

  await waitForOperationState(service, operation, 'awaiting-conflict');
  service.resolveConflict(session.sessionId, operation.operationId, 'overwrite');
  await waitForOperationState(service, operation, 'succeeded');
  assert.equal(host.nodes.get('/srv/config/keep.txt')?.data.toString(), 'keep');
  assert.equal(host.nodes.get('/srv/config/new.txt')?.data.toString(), 'new');
  assert.equal(host.nodes.get('/srv/config/replace.txt')?.data.toString(), 'new');
});

test('SftpArchiveService keeps a completed recursive merge successful after late cancellation', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.addFile('/srv/config/keep.txt', 'keep');
  host.extractMembers = ['config/new.txt'];
  let operationId: string | null = null;
  host.afterRename = (_sourcePath, targetPath) => {
    if (targetPath === '/srv/config/new.txt' && operationId) {
      service.cancelOperation(session.sessionId, operationId);
    }
  };
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });
  operationId = operation.operationId;

  await waitForOperationState(service, operation, 'awaiting-conflict');
  service.resolveConflict(session.sessionId, operation.operationId, 'overwrite');
  const completed = await waitForOperationState(service, operation, 'succeeded');

  assert.equal(completed.cancelRequested, true);
  assert.deepEqual(completed.resultPaths, ['/srv/config']);
  assert.equal(host.nodes.get('/srv/config/keep.txt')?.data.toString(), 'keep');
  assert.equal(host.nodes.get('/srv/config/new.txt')?.data.toString(), 'new');
});

test('SftpArchiveService stops a recursive overwrite merge after cancellation', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.addFile('/srv/config/keep.txt', 'keep');
  host.extractMembers = ['config/new-a.txt', 'config/new-b.txt'];
  let operationId: string | null = null;
  host.afterRename = (_sourcePath, targetPath) => {
    if (targetPath === '/srv/config/new-a.txt' && operationId) {
      service.cancelOperation(session.sessionId, operationId);
    }
  };
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });
  operationId = operation.operationId;

  await waitForOperationState(service, operation, 'awaiting-conflict');
  service.resolveConflict(session.sessionId, operation.operationId, 'overwrite');
  const completed = await waitForOperationState(service, operation, 'cancelled');

  assert.equal(completed.stage, 'completed');
  assert.equal(host.nodes.get('/srv/config/keep.txt')?.data.toString(), 'keep');
  assert.equal(host.nodes.get('/srv/config/new-a.txt')?.data.toString(), 'new');
  assert.equal(host.nodes.has('/srv/config/new-b.txt'), false);
});

test('SftpArchiveService cancel conflict resolution preserves the target and removes staging', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.addFile('/srv/report.txt', 'original');
  host.extractMembers = ['report.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'current-directory',
  });

  await waitForOperationState(service, operation, 'awaiting-conflict');
  service.resolveConflict(session.sessionId, operation.operationId, 'cancel');
  await waitForOperationState(service, operation, 'cancelled');
  assert.equal(host.nodes.get('/srv/report.txt')?.data.toString(), 'original');
  assert.equal(
    [...host.nodes.keys()].some((candidate) => candidate.includes('.cosmosh-')),
    false,
  );
});

test('SftpArchiveService rejects unsafe archive members before creating a staging directory', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.extractMembers = ['../outside.txt'];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'smart',
  });

  const completed = await waitForOperationState(service, operation, 'failed');
  assert.equal(completed.errorCode, 'SFTP_ARCHIVE_UNSAFE_ENTRY');
  assert.equal(
    [...host.nodes.keys()].some((candidate) => candidate.includes('.cosmosh-')),
    false,
  );
});

test('SftpArchiveService rejects archive member lists that exceed the validation output bound', async () => {
  const { host, service, session } = createArchiveTestContext();
  host.addFile('/srv/archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  host.extractMembers = [
    ...Array.from({ length: 2_500 }, (_, index) => `safe/${index.toString().padStart(4, '0')}-${'x'.repeat(112)}.txt`),
    '../outside.txt',
  ];
  const operation = await service.startOperation(session, {
    type: 'extract',
    archivePath: '/srv/archive.zip',
    targetDirectoryPath: '/srv',
    destinationMode: 'smart',
  });

  const completed = await waitForOperationState(service, operation, 'failed');
  assert.equal(completed.errorCode, 'SFTP_ARCHIVE_UNSAFE_ENTRY');
  assert.equal(
    host.commands.some((command) => command.includes('unzip') && command.includes(' -qq -n ')),
    false,
  );
  assert.equal(
    [...host.nodes.keys()].some((candidate) => candidate.includes('.cosmosh-')),
    false,
  );
});
