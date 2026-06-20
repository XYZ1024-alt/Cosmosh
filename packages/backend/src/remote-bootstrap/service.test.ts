import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuditEventService } from '../audit/service.js';
import { RemoteBootstrapService, type RemoteBootstrapStatus } from './service.js';

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
          sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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
  assert.match(decodeWrapperPayload(executedCommands.at(-1) ?? ''), /install --shell "bash"/);
});
