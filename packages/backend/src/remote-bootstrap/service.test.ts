import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuditEventService } from '../audit/service.js';
import type { AuditEventInput } from '../audit/types.js';
import { REMOTE_SHELL_PROTOCOL_VERSION, RemoteBootstrapService, type RemoteBootstrapStatus } from './service.js';

const TEST_SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADVERSARIAL_ASSET_URL = 'https://downloads.example.test/cosmosh bootstrap$(printf pwn)`whoami`\'";?line=%0Aafter';
const TEST_CAPABILITIES = ['cwd', 'command-start', 'command-end', 'foreground-command', 'prompt-ready'];

type WrapperRenderResult = {
  command: string;
  statuses: RemoteBootstrapStatus[];
  wrapper: string;
};

/**
 * Creates a no-op audit service for bootstrap service unit tests.
 *
 * @param onLogEvent Optional observer for emitted audit payloads.
 * @returns Minimal audit event service test double.
 */
const createAuditService = (onLogEvent?: (input: AuditEventInput) => void): AuditEventService => {
  return {
    logEvent: async (input: AuditEventInput) => {
      onLogEvent?.(input);
      return null;
    },
  } as unknown as AuditEventService;
};

/**
 * Serializes a current Go bootstrap status response.
 *
 * @param overrides Optional fields used to model stale or invalid installations.
 * @returns One newline-terminated JSON status object.
 */
const installedStatus = (overrides: Record<string, unknown> = {}): string => {
  return `${JSON.stringify({
    installed: true,
    version: '1.2.3',
    protocolVersion: REMOTE_SHELL_PROTOCOL_VERSION,
    capabilities: TEST_CAPABILITIES,
    helperCurrent: true,
    profileCurrent: true,
    binarySha256: TEST_SHA256,
    ...overrides,
  })}\n`;
};

/**
 * Extracts and decodes the wrapper script payload embedded in the install command.
 *
 * @param command Remote install command emitted by the bootstrap service.
 * @returns Decoded shell wrapper script.
 */
const decodeWrapperPayload = (command: string): string => {
  const payloadMatch = /printf %s "([^"]+)"/.exec(command);
  assert.ok(payloadMatch?.[1], 'expected wrapper payload in install command');
  return Buffer.from(payloadMatch[1], 'base64').toString('utf8');
};

/**
 * Runs the bootstrap service far enough to capture the generated install wrapper.
 *
 * @param options Remote shell and asset URL used for manifest-driven wrapper rendering.
 * @returns Generated install command, decoded wrapper, and emitted statuses.
 */
const renderWrapper = async (options: {
  assetUrl: string;
  shell: 'bash' | 'fish';
  initialStatus?: string;
}): Promise<WrapperRenderResult> => {
  const statuses: RemoteBootstrapStatus[] = [];
  const executedCommands: string[] = [];
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
    manifestUrl: 'https://downloads.example.test/manifest.json',
    fetchManifest: async () => ({
      version: '1.2.3',
      assets: [
        {
          os: 'linux',
          arch: 'amd64',
          url: options.assetUrl,
          sha256: TEST_SHA256,
        },
      ],
    }),
  });

  let statusReads = 0;
  await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      if (command.includes('uname -s')) {
        return `{"os":"linux","arch":"amd64","shell":"${options.shell}"}\n`;
      }

      if (command.includes(' status --shell')) {
        statusReads += 1;
        return statusReads === 1 ? (options.initialStatus ?? null) : installedStatus();
      }

      return '{"type":"bootstrap-status","phase":"verify","state":"ok","version":"1.2.3"}\n';
    },
    sendStatus: (status) => statuses.push(status),
  });

  const command = executedCommands.find((candidate) => candidate.includes('cosmosh-wrapper')) ?? '';
  return {
    command,
    statuses,
    wrapper: decodeWrapperPayload(command),
  };
};

test('RemoteBootstrapService reports session-owned terminal statuses through the shared audit path', () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const auditEvents: AuditEventInput[] = [];
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService((input) => auditEvents.push(input)),
  });
  const status: RemoteBootstrapStatus = {
    type: 'bootstrap-status',
    phase: 'install',
    state: 'failed',
    code: 'BOOTSTRAP_ENSURE_TIMEOUT',
    message: 'remote enhancement setup exceeded the connection budget',
  };

  service.reportStatus(
    {
      serverId: 'server-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      sendStatus: (payload) => statuses.push(payload),
    },
    status,
  );

  assert.deepEqual(statuses, [status]);
  assert.deepEqual(auditEvents, [
    {
      category: 'ssh-session',
      action: 'remote-bootstrap',
      outcome: 'failure',
      severity: 'warning',
      entityType: 'ssh-server',
      entityId: 'server-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      metadata: status,
    },
  ]);
});

test('RemoteBootstrapService does not probe remotes when the manifest URL is missing', async () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const executedCommands: string[] = [];
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
  });

  const result = await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      return null;
    },
    sendStatus: (status) => statuses.push(status),
  });

  assert.equal(executedCommands.length, 0);
  assert.equal(statuses.at(-1)?.code, 'MANIFEST_URL_NOT_CONFIGURED');
  assert.deepEqual(result, {
    state: 'disabled',
    code: 'MANIFEST_URL_NOT_CONFIGURED',
    message: 'remote bootstrap manifest URL is not configured',
  });
});

test('RemoteBootstrapService accepts bash remotes and installs through bash profile support', async () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const executedCommands: string[] = [];
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
    manifestUrl: 'https://downloads.example.test/manifest.json',
    fetchManifest: async () => ({
      version: '1.2.3',
      assets: [
        {
          os: 'linux',
          arch: 'amd64',
          url: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
          sha256: TEST_SHA256,
        },
      ],
    }),
  });

  let statusReads = 0;
  const result = await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      if (command.includes('uname -s')) {
        return '{"os":"linux","arch":"amd64","shell":"bash"}\n';
      }

      if (command.includes(' status --shell')) {
        statusReads += 1;
        return statusReads === 1 ? null : installedStatus();
      }

      return '{"type":"bootstrap-status","phase":"verify","state":"ok","version":"1.2.3"}\n';
    },
    sendStatus: (status) => statuses.push(status),
  });

  assert.equal(
    statuses.some((status) => status.code === 'PROBE_FAILED'),
    false,
  );
  assert.equal(result.state, 'ready');
  assert.equal(statuses.at(-1)?.state, 'ok');
  const installCommand = executedCommands.find((command) => command.includes('cosmosh-wrapper')) ?? '';
  assert.match(installCommand, /command -v bash/);
  assert.match(decodeWrapperPayload(installCommand), /install --shell "\$cosmosh_shell"/);
  assert.doesNotMatch(decodeWrapperPayload(installCommand), /helper-payload-b64/);
});

test('RemoteBootstrapService skips download when the installed runtime contract is current', async () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const executedCommands: string[] = [];
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
    manifestUrl: 'https://downloads.example.test/manifest.json',
    fetchManifest: async () => ({
      version: '1.2.3',
      assets: [
        {
          os: 'linux',
          arch: 'amd64',
          url: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
          sha256: TEST_SHA256,
        },
      ],
    }),
  });

  const result = await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      return command.includes('uname -s') ? '{"os":"linux","arch":"amd64","shell":"bash"}\n' : installedStatus();
    },
    sendStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(result, {
    state: 'ready',
    source: 'current',
    contract: {
      shell: 'bash',
      helperVersion: '1.2.3',
      protocolVersion: REMOTE_SHELL_PROTOCOL_VERSION,
      capabilities: TEST_CAPABILITIES,
    },
  });
  assert.equal(executedCommands.length, 2);
  assert.equal(
    executedCommands.some((command) => command.includes('cosmosh-wrapper')),
    false,
  );
  assert.equal(statuses.at(-1)?.state, 'skipped');
});

test('RemoteBootstrapService treats legacy installed status as stale and reinstalls', async () => {
  const result = await renderWrapper({
    assetUrl: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
    initialStatus: '{"binaryPath":"/home/dev/.local/share/cosmosh/bootstrap/bin/cosmosh-bootstrap"}\n',
    shell: 'bash',
  });

  assert.match(result.wrapper, /install --shell "\$cosmosh_shell" --version "\$cosmosh_version"/);
  assert.doesNotMatch(result.wrapper, /cosmosh_helper_payload_b64|helper-payload-b64/);
});

test('RemoteBootstrapService reinstalls when the installed binary digest differs from the manifest', async () => {
  const result = await renderWrapper({
    assetUrl: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
    initialStatus: installedStatus({ binarySha256: 'f'.repeat(64) }),
    shell: 'bash',
  });

  assert.match(result.wrapper, /curl -fsSL "\$cosmosh_asset_url"/);
});

test('RemoteBootstrapService rejects manifests that include invalid assets', async () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const executedCommands: string[] = [];
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
    manifestUrl: 'https://downloads.example.test/manifest.json',
    fetchManifest: async () => ({
      version: '1.2.3',
      assets: [
        {
          os: 'linux',
          arch: 'amd64',
          url: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
          sha256: TEST_SHA256,
        },
        {
          os: 'linux',
          arch: 'arm64',
          url: 'http://downloads.example.test/cosmosh-bootstrap-linux-arm64',
          sha256: TEST_SHA256,
        },
      ],
    }),
  });

  await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      return '{"os":"linux","arch":"amd64","shell":"bash"}\n';
    },
    sendStatus: (status) => statuses.push(status),
  });

  assert.equal(executedCommands.length, 0);
  assert.equal(statuses.at(-1)?.code, 'MANIFEST_INVALID');
});

test('RemoteBootstrapService quotes adversarial manifest URLs in bash wrappers', async () => {
  const result = await renderWrapper({ assetUrl: ADVERSARIAL_ASSET_URL, shell: 'bash' });

  assert.equal(result.statuses.at(-1)?.state, 'ok');
  assert.match(result.command, /mktemp "\$\{TMPDIR:-\/tmp\}\/cosmosh-wrapper\.XXXXXX"/);
  assert.match(result.command, /umask 077/);
  assert.match(result.command, /trap/);
  assert.doesNotMatch(result.command, /cosmosh-wrapper-\$\$/);
  assert.match(result.wrapper, /cosmosh_asset_url='https:\/\/downloads\.example\.test\//);
  assert.match(result.wrapper, /curl -fsSL "\$cosmosh_asset_url" -o "\$bin"/);
  assert.match(result.wrapper, /wget -q -O "\$bin" "\$cosmosh_asset_url"/);
  assert.match(result.wrapper, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/cosmosh-bootstrap\.XXXXXX"/);
  assert.match(result.wrapper, /trap 'rm -rf "\$tmp"'/);
  assert.doesNotMatch(result.wrapper, /curl -fsSL "https:\/\//);
  assert.doesNotMatch(result.wrapper, /wget -q -O "\$bin" "https:\/\//);
  assert.doesNotMatch(result.wrapper, /cosmosh-bootstrap-1\.2\.3-\$\$/);
  assert.doesNotMatch(result.wrapper, /mkdir -p "\$tmp"/);
});

test('RemoteBootstrapService quotes adversarial manifest URLs in fish wrappers', async () => {
  const result = await renderWrapper({ assetUrl: ADVERSARIAL_ASSET_URL, shell: 'fish' });

  assert.equal(result.statuses.at(-1)?.state, 'ok');
  assert.match(result.wrapper, /set cosmosh_asset_url 'https:\/\/downloads\.example\.test\//);
  assert.match(result.wrapper, /curl -fsSL "\$cosmosh_asset_url" -o "\$bin"/);
  assert.match(result.wrapper, /wget -q -O "\$bin" "\$cosmosh_asset_url"/);
  assert.match(result.wrapper, /mktemp -d "\$tmpdir\/cosmosh-bootstrap\.XXXXXX"/);
  assert.match(result.wrapper, /function cosmosh_cleanup --on-event fish_exit/);
  assert.doesNotMatch(result.wrapper, /curl -fsSL "https:\/\//);
  assert.doesNotMatch(result.wrapper, /wget -q -O "\$bin" "https:\/\//);
  assert.doesNotMatch(result.wrapper, /cosmosh-bootstrap-1\.2\.3/);
});

test('RemoteBootstrapService shares concurrent manifest loads and refreshes after TTL expiry', async () => {
  let fetchCount = 0;
  let nowMs = 10_000;
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
    manifestUrl: 'https://downloads.example.test/manifest.json',
    manifestCacheTtlMs: 5_000,
    now: () => nowMs,
    fetchManifest: async () => {
      fetchCount += 1;
      await Promise.resolve();
      return {
        version: '1.2.3',
        assets: [
          {
            os: 'linux',
            arch: 'amd64',
            url: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
            sha256: TEST_SHA256,
          },
        ],
      };
    },
  });
  const runSession = async (sessionId: string): Promise<void> => {
    const result = await service.runForSession({
      serverId: 'server-1',
      sessionId,
      executeCommand: async (command) => {
        if (command.includes('uname -s')) {
          return '{"os":"linux","arch":"amd64","shell":"bash"}\n';
        }
        return installedStatus();
      },
      sendStatus: () => undefined,
    });
    assert.equal(result.state, 'ready');
  };

  await Promise.all([runSession('session-1'), runSession('session-2')]);
  assert.equal(fetchCount, 1);

  await runSession('session-3');
  assert.equal(fetchCount, 1);

  nowMs += 5_001;
  await runSession('session-4');
  assert.equal(fetchCount, 2);
});

test('RemoteBootstrapService does not cache failed manifest requests', async () => {
  let fetchCount = 0;
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
    manifestUrl: 'https://downloads.example.test/manifest.json',
    fetchManifest: async () => {
      fetchCount += 1;
      throw new Error('temporary release service failure');
    },
  });
  const runSession = async (sessionId: string): Promise<void> => {
    const result = await service.runForSession({
      serverId: 'server-1',
      sessionId,
      executeCommand: async () => {
        throw new Error('remote probe must not run after manifest failure');
      },
      sendStatus: () => undefined,
    });
    assert.equal(result.state, 'disabled');
  };

  await runSession('session-1');
  await runSession('session-2');
  assert.equal(fetchCount, 2);
});

test('RemoteBootstrapService propagates a session budget abort without reporting a probe failure', async () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const abortController = new AbortController();
  const timeoutError = new Error('session bootstrap budget expired');
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
    manifestUrl: 'https://downloads.example.test/manifest.json',
    fetchManifest: async () => ({
      version: '1.2.3',
      assets: [
        {
          os: 'linux',
          arch: 'amd64',
          url: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
          sha256: TEST_SHA256,
        },
      ],
    }),
  });

  const resultPromise = service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async () => {
      abortController.abort(timeoutError);
      return null;
    },
    sendStatus: (status) => statuses.push(status),
    signal: abortController.signal,
  });

  await assert.rejects(resultPromise, (error: unknown) => error === timeoutError);
  assert.equal(
    statuses.some((status) => status.code === 'PROBE_FAILED'),
    false,
  );
});
