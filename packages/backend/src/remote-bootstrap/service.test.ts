import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuditEventService } from '../audit/service.js';
import { RemoteBootstrapService, type RemoteBootstrapStatus } from './service.js';

const TEST_SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADVERSARIAL_ASSET_URL = 'https://downloads.example.test/cosmosh bootstrap$(printf pwn)`whoami`\'";?line=%0Aafter';

type WrapperRenderResult = {
  command: string;
  statuses: RemoteBootstrapStatus[];
  wrapper: string;
};

/**
 * Creates a no-op audit service for bootstrap service unit tests.
 *
 * @returns Minimal audit event service test double.
 */
const createAuditService = (): AuditEventService => {
  return {
    logEvent: async () => null,
  } as unknown as AuditEventService;
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
const renderWrapper = async (options: { assetUrl: string; shell: 'bash' | 'fish' }): Promise<WrapperRenderResult> => {
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

  await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      if (executedCommands.length === 1) {
        return `{"os":"linux","arch":"amd64","shell":"${options.shell}"}\n`;
      }

      return '{"type":"bootstrap-status","phase":"install","state":"ok","version":"1.2.3"}\n';
    },
    sendStatus: (status) => statuses.push(status),
  });

  const command = executedCommands.at(-1) ?? '';
  return {
    command,
    statuses,
    wrapper: decodeWrapperPayload(command),
  };
};

test('RemoteBootstrapService does not probe remotes when the manifest URL is missing', async () => {
  const statuses: RemoteBootstrapStatus[] = [];
  const executedCommands: string[] = [];
  const service = new RemoteBootstrapService({
    auditEventService: createAuditService(),
  });

  await service.runForSession({
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

  await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      if (executedCommands.length === 1) {
        return '{"os":"linux","arch":"amd64","shell":"bash"}\n';
      }

      return '{"type":"bootstrap-status","phase":"install","state":"ok","version":"1.2.3"}\n';
    },
    sendStatus: (status) => statuses.push(status),
  });

  assert.equal(
    statuses.some((status) => status.code === 'PROBE_FAILED'),
    false,
  );
  assert.equal(statuses.at(-1)?.state, 'ok');
  assert.match(executedCommands.at(-1) ?? '', /command -v bash/);
  assert.match(decodeWrapperPayload(executedCommands.at(-1) ?? ''), /install --shell "\$cosmosh_shell"/);
});

test('RemoteBootstrapService embeds bash remote shell event hooks in helper payload', async () => {
  const result = await renderWrapper({
    assetUrl: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
    shell: 'bash',
  });
  const helperMatch = /cosmosh_helper_payload_b64='([^']+)'/.exec(result.wrapper);
  assert.ok(helperMatch?.[1], 'expected helper payload in wrapper');
  const helper = Buffer.from(helperMatch[1], 'base64').toString('utf8');

  assert.match(helper, /OSC 777|Remote Enhancements shell integration/);
  assert.match(helper, /__cosmosh_emit_remote_shell_event/);
  assert.match(helper, /PROMPT_COMMAND=.*__cosmosh_bash_prompt_command/);
  assert.match(helper, /trap '__cosmosh_bash_debug_trap' DEBUG/);
  assert.match(helper, /command-end/);
  assert.match(helper, /command-start/);
  assert.match(helper, /foreground-command/);
  assert.match(helper, /vim\|vimdiff/);
});

test('RemoteBootstrapService embeds zsh command start and foreground hooks in helper payload', async () => {
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

  await service.runForSession({
    serverId: 'server-1',
    sessionId: 'session-1',
    executeCommand: async (command) => {
      executedCommands.push(command);
      if (executedCommands.length === 1) {
        return '{"os":"linux","arch":"amd64","shell":"zsh"}\n';
      }

      return '{"type":"bootstrap-status","phase":"install","state":"ok","version":"1.2.3"}\n';
    },
    sendStatus: (status) => statuses.push(status),
  });

  const helperMatch = /cosmosh_helper_payload_b64='([^']+)'/.exec(decodeWrapperPayload(executedCommands.at(-1) ?? ''));
  assert.ok(helperMatch?.[1], 'expected helper payload in wrapper');
  const helper = Buffer.from(helperMatch[1], 'base64').toString('utf8');

  assert.equal(statuses.at(-1)?.state, 'ok');
  assert.match(helper, /add-zsh-hook preexec __cosmosh_zsh_preexec/);
  assert.match(helper, /command-start/);
  assert.match(helper, /foreground-command/);
});

test('RemoteBootstrapService embeds fish remote shell event hooks in helper payload', async () => {
  const result = await renderWrapper({
    assetUrl: 'https://downloads.example.test/cosmosh-bootstrap-linux-amd64',
    shell: 'fish',
  });
  const helperMatch = /set cosmosh_helper_payload_b64 '([^']+)'/.exec(result.wrapper);
  assert.ok(helperMatch?.[1], 'expected helper payload in fish wrapper');
  const helper = Buffer.from(helperMatch[1], 'base64').toString('utf8');

  assert.match(helper, /__cosmosh_emit_remote_shell_event/);
  assert.match(helper, /--on-event fish_prompt/);
  assert.match(helper, /--on-event fish_preexec/);
  assert.match(helper, /--on-event fish_postexec/);
  assert.match(helper, /--on-variable PWD/);
  assert.match(helper, /command-start/);
  assert.match(helper, /foreground-command/);
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
