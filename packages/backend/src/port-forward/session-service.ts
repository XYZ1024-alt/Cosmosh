import { randomUUID } from 'node:crypto';
import net from 'node:net';

import type { Prisma, PrismaClient } from '@prisma/client';
import type { Client, ClientChannel } from 'ssh2';

import type { AuditEventService } from '../audit/service.js';
import type { AuditEventInput } from '../audit/types.js';
import { createI18n, type I18nInstance, type Locale } from '../i18n-bridge.js';
import { openSshClient } from '../ssh/connect.js';
import { handleSocks5Greeting, parseSocks5ConnectRequest, writeSocks5Response } from './socks5.js';

type GetDbClient = () => PrismaClient;

type PortForwardRuleWithServer = Prisma.PortForwardRuleGetPayload<{
  include: {
    server: {
      include: {
        keychain: true;
      };
    };
  };
}>;

type PortForwardRuntimeState = {
  ruleId: string;
  client: Client;
  localServer: net.Server | null;
  localSockets: Set<net.Socket>;
  channels: Set<ClientChannel>;
  remoteSockets: Set<net.Socket>;
  activeConnectionCount: number;
  startedAt: Date;
  boundHost?: string;
  boundPort?: number;
  lastError?: string;
  tcpConnectionListener?: (
    details: { destIP: string; destPort: number; srcIP: string; srcPort: number },
    accept: () => ClientChannel,
    reject: () => void,
  ) => void;
};

export type PortForwardRuntime = {
  status: 'stopped' | 'running';
  activeConnectionCount: number;
  boundHost?: string;
  boundPort?: number;
  startedAt?: string;
  lastError?: string;
};

export type PortForwardRuleItem = {
  id: string;
  name: string;
  type: 'local' | 'remote' | 'dynamic';
  serverId: string;
  serverName?: string;
  localBindHost?: string;
  localBindPort?: number;
  remoteBindHost?: string;
  remoteBindPort?: number;
  targetHost?: string;
  targetPort?: number;
  note?: string;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  lastFailureMessage?: string;
  runtime: PortForwardRuntime;
  createdAt: string;
  updatedAt: string;
};

export type StartPortForwardRuleInput = {
  locale: Locale;
  requestId?: string;
  ruleId: string;
  connectTimeoutSec: number;
  systemProxyRules?: string;
};

export type StartPortForwardRuleResult =
  | {
      type: 'success';
      item: PortForwardRuleItem;
    }
  | {
      type: 'not-found';
    }
  | {
      type: 'active';
    }
  | {
      type: 'host-untrusted';
      serverId: string;
      host: string;
      port: number;
      algorithm: 'sha256';
      fingerprint: string;
    }
  | {
      type: 'failed';
      message: string;
    };

export type StopPortForwardRuleResult =
  | {
      type: 'success';
      item: PortForwardRuleItem;
    }
  | {
      type: 'not-found';
    };

const MAX_ACTIVE_CONNECTIONS_PER_RULE = 64;
const FORWARD_CONNECTION_TIMEOUT_MS = 15_000;

/**
 * Maps a persisted rule and in-memory runtime state into API item shape.
 */
const mapPortForwardRuleItem = (
  rule: PortForwardRuleWithServer,
  runtimeState: PortForwardRuntimeState | undefined,
): PortForwardRuleItem => {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    serverId: rule.serverId,
    serverName: rule.server.name,
    localBindHost: rule.localBindHost ?? undefined,
    localBindPort: rule.localBindPort ?? undefined,
    remoteBindHost: rule.remoteBindHost ?? undefined,
    remoteBindPort: rule.remoteBindPort ?? undefined,
    targetHost: rule.targetHost ?? undefined,
    targetPort: rule.targetPort ?? undefined,
    note: rule.note ?? undefined,
    lastStartedAt: rule.lastStartedAt?.toISOString(),
    lastStoppedAt: rule.lastStoppedAt?.toISOString(),
    lastFailureMessage: rule.lastFailureMessage ?? undefined,
    runtime: runtimeState
      ? {
          status: 'running',
          activeConnectionCount: runtimeState.activeConnectionCount,
          boundHost: runtimeState.boundHost,
          boundPort: runtimeState.boundPort,
          startedAt: runtimeState.startedAt.toISOString(),
          lastError: runtimeState.lastError,
        }
      : {
          status: 'stopped',
          activeConnectionCount: 0,
        },
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
};

/**
 * Manages active SSH local, remote, and dynamic port-forwarding sessions.
 */
export class PortForwardSessionService {
  private readonly getDbClient: GetDbClient;

  private readonly auditEventService: AuditEventService;

  private readonly credentialEncryptionKey: Buffer;

  private readonly activeRules = new Map<string, PortForwardRuntimeState>();

  private readonly startingRuleIds = new Set<string>();

  public constructor(options: {
    getDbClient: GetDbClient;
    auditEventService: AuditEventService;
    credentialEncryptionKey: Buffer;
  }) {
    this.getDbClient = options.getDbClient;
    this.auditEventService = options.auditEventService;
    this.credentialEncryptionKey = options.credentialEncryptionKey;
  }

  /**
   * Lists persisted rules with current in-memory runtime state.
   */
  public async listRules(): Promise<PortForwardRuleItem[]> {
    const rules = await this.getDbClient().portForwardRule.findMany({
      include: {
        server: {
          include: {
            keychain: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return rules.map((rule) => mapPortForwardRuleItem(rule, this.activeRules.get(rule.id)));
  }

  /**
   * Checks whether one rule has an active runtime entry.
   */
  public isRuleActive(ruleId: string): boolean {
    return this.activeRules.has(ruleId) || this.startingRuleIds.has(ruleId);
  }

  /**
   * Starts one stopped port-forwarding rule.
   */
  public async startRule(input: StartPortForwardRuleInput): Promise<StartPortForwardRuleResult> {
    if (this.isRuleActive(input.ruleId)) {
      return { type: 'active' };
    }

    this.startingRuleIds.add(input.ruleId);

    try {
      return await this.startRuleInternal(input);
    } finally {
      this.startingRuleIds.delete(input.ruleId);
    }
  }

  /**
   * Performs one exclusive rule startup after the in-flight guard is acquired.
   *
   * @param input Rule startup request.
   * @returns Normalized startup result.
   */
  private async startRuleInternal(input: StartPortForwardRuleInput): Promise<StartPortForwardRuleResult> {
    const i18n = createI18n({ locale: input.locale, fallbackLocale: 'en' });
    const db = this.getDbClient();
    const rule = await this.findRule(input.ruleId);
    if (!rule) {
      return { type: 'not-found' };
    }

    const trustedKeys = await db.sshKnownHost.findMany({
      where: {
        host: rule.server.host,
        port: rule.server.port,
        trusted: true,
        keyType: 'sha256',
      },
      select: {
        fingerprint: true,
      },
    });

    const strictHostKey = rule.server.strictHostKey;
    const openResult = await openSshClient(rule.server, {
      connectTimeoutSec: input.connectTimeoutSec,
      db,
      systemProxyRules: input.systemProxyRules,
      strictHostKey,
      trustedFingerprintSet: new Set(trustedKeys.map((item) => item.fingerprint)),
      credentialEncryptionKey: this.credentialEncryptionKey,
      t: i18n.t,
    });

    if (openResult.type === 'host-untrusted') {
      this.logAuditEvent({
        category: 'port-forward',
        action: 'start',
        outcome: 'failure',
        severity: 'warning',
        entityType: 'port-forward-rule',
        entityId: rule.id,
        requestId: input.requestId,
        metadata: {
          serverId: rule.serverId,
          host: rule.server.host,
          port: rule.server.port,
          strictHostKey,
          fingerprint: openResult.fingerprint,
          reason: openResult.message,
          proxyMode: openResult.proxyMetadata?.mode,
          proxyProtocol: openResult.proxyMetadata?.protocol,
        },
      });

      return {
        type: 'host-untrusted',
        serverId: rule.serverId,
        host: rule.server.host,
        port: rule.server.port,
        algorithm: 'sha256',
        fingerprint: openResult.fingerprint,
      };
    }

    if (openResult.type === 'failed') {
      await this.persistStartFailure(rule.id, openResult.message);
      this.logStartFailure(rule, input.requestId, openResult.message, openResult.proxyMetadata);
      return { type: 'failed', message: openResult.message };
    }

    const runtimeState: PortForwardRuntimeState = {
      ruleId: rule.id,
      client: openResult.client,
      localServer: null,
      localSockets: new Set(),
      channels: new Set(),
      remoteSockets: new Set(),
      activeConnectionCount: 0,
      startedAt: new Date(),
    };

    try {
      if (rule.type === 'local') {
        await this.startLocalRule(rule, runtimeState, i18n.t);
      } else if (rule.type === 'dynamic') {
        await this.startDynamicRule(rule, runtimeState, i18n.t);
      } else {
        await this.startRemoteRule(rule, runtimeState, i18n.t);
      }
    } catch (error: unknown) {
      const message = this.resolveErrorMessage(error, i18n.t('errors.portForward.startFailedNoReason'));
      await this.disposeRuntimeState(runtimeState);
      await this.persistStartFailure(rule.id, message);
      this.logStartFailure(rule, input.requestId, message, openResult.proxyMetadata);
      return { type: 'failed', message };
    }

    this.activeRules.set(rule.id, runtimeState);
    const updatedRule = await db.portForwardRule.update({
      where: {
        id: rule.id,
      },
      data: {
        lastStartedAt: runtimeState.startedAt,
        lastFailureMessage: null,
      },
      include: {
        server: {
          include: {
            keychain: true,
          },
        },
      },
    });

    openResult.client.on('close', () => {
      void this.handleUnexpectedClose(rule.id, i18n.t('errors.portForward.sshConnectionClosed'));
    });

    openResult.client.on('error', (error) => {
      void this.handleUnexpectedClose(rule.id, error.message);
    });

    this.logAuditEvent({
      category: 'port-forward',
      action: 'start',
      outcome: 'success',
      severity: 'warning',
      entityType: 'port-forward-rule',
      entityId: rule.id,
      requestId: input.requestId,
      metadata: {
        ...this.buildAuditMetadata(updatedRule),
        proxyMode: openResult.proxyMetadata.mode,
        proxyProtocol: openResult.proxyMetadata.protocol,
      },
    });

    return {
      type: 'success',
      item: mapPortForwardRuleItem(updatedRule, runtimeState),
    };
  }

  /**
   * Stops one active rule and keeps stopped rules idempotent.
   */
  public async stopRule(ruleId: string): Promise<StopPortForwardRuleResult> {
    const rule = await this.findRule(ruleId);
    if (!rule) {
      return { type: 'not-found' };
    }

    const runtimeState = this.activeRules.get(ruleId);
    if (runtimeState) {
      this.activeRules.delete(ruleId);
      await this.disposeRuntimeState(runtimeState);
    }

    const updatedRule = await this.getDbClient().portForwardRule.update({
      where: {
        id: ruleId,
      },
      data: {
        lastStoppedAt: new Date(),
      },
      include: {
        server: {
          include: {
            keychain: true,
          },
        },
      },
    });

    this.logAuditEvent({
      category: 'port-forward',
      action: 'stop',
      outcome: 'success',
      severity: 'info',
      entityType: 'port-forward-rule',
      entityId: rule.id,
      metadata: this.buildAuditMetadata(updatedRule),
    });

    return {
      type: 'success',
      item: mapPortForwardRuleItem(updatedRule, undefined),
    };
  }

  /**
   * Stops all active rules during backend shutdown.
   */
  public async stop(): Promise<void> {
    const entries = [...this.activeRules.values()];
    this.activeRules.clear();
    await Promise.all(entries.map((entry) => this.disposeRuntimeState(entry)));
  }

  private async findRule(ruleId: string): Promise<PortForwardRuleWithServer | null> {
    return await this.getDbClient().portForwardRule.findUnique({
      where: {
        id: ruleId,
      },
      include: {
        server: {
          include: {
            keychain: true,
          },
        },
      },
    });
  }

  private async startLocalRule(
    rule: PortForwardRuleWithServer,
    runtimeState: PortForwardRuntimeState,
    t: I18nInstance['t'],
  ): Promise<void> {
    if (!rule.localBindHost || !rule.localBindPort || !rule.targetHost || !rule.targetPort) {
      throw new Error(t('errors.validation.invalidPayload'));
    }

    const localServer = net.createServer((socket) => {
      this.handleLocalTcpConnection(rule, runtimeState, socket, rule.targetHost ?? '', rule.targetPort ?? 0);
    });
    runtimeState.localServer = localServer;
    await this.listen(localServer, rule.localBindHost, rule.localBindPort);
    runtimeState.boundHost = rule.localBindHost;
    runtimeState.boundPort = rule.localBindPort;
  }

  private async startDynamicRule(
    rule: PortForwardRuleWithServer,
    runtimeState: PortForwardRuntimeState,
    t: I18nInstance['t'],
  ): Promise<void> {
    if (!rule.localBindHost || !rule.localBindPort) {
      throw new Error(t('errors.validation.invalidPayload'));
    }

    const localServer = net.createServer((socket) => {
      this.handleDynamicTcpConnection(rule, runtimeState, socket);
    });
    runtimeState.localServer = localServer;
    await this.listen(localServer, rule.localBindHost, rule.localBindPort);
    runtimeState.boundHost = rule.localBindHost;
    runtimeState.boundPort = rule.localBindPort;
  }

  private async startRemoteRule(
    rule: PortForwardRuleWithServer,
    runtimeState: PortForwardRuntimeState,
    t: I18nInstance['t'],
  ): Promise<void> {
    if (!rule.remoteBindHost || !rule.remoteBindPort || !rule.targetHost || !rule.targetPort) {
      throw new Error(t('errors.validation.invalidPayload'));
    }

    runtimeState.tcpConnectionListener = (_details, accept, reject) => {
      if (runtimeState.activeConnectionCount >= MAX_ACTIVE_CONNECTIONS_PER_RULE) {
        reject();
        return;
      }

      let channel: ClientChannel;
      try {
        channel = accept();
      } catch {
        reject();
        return;
      }

      this.pipeRemoteForwardConnection(rule, runtimeState, channel);
    };
    runtimeState.client.on('tcp connection', runtimeState.tcpConnectionListener);
    await this.forwardIn(runtimeState.client, rule.remoteBindHost, rule.remoteBindPort);
    runtimeState.boundHost = rule.remoteBindHost;
    runtimeState.boundPort = rule.remoteBindPort;
  }

  private handleLocalTcpConnection(
    rule: PortForwardRuleWithServer,
    runtimeState: PortForwardRuntimeState,
    socket: net.Socket,
    targetHost: string,
    targetPort: number,
  ): void {
    if (runtimeState.activeConnectionCount >= MAX_ACTIVE_CONNECTIONS_PER_RULE) {
      socket.destroy();
      return;
    }

    const cleanup = this.trackLocalSocket(runtimeState, socket);

    socket.setTimeout(FORWARD_CONNECTION_TIMEOUT_MS);
    socket.once('timeout', () => socket.destroy());
    socket.once('close', cleanup);
    socket.once('error', (error) => {
      runtimeState.lastError = error.message;
    });

    runtimeState.client.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      targetHost,
      targetPort,
      (error, channel) => {
        if (error) {
          runtimeState.lastError = error.message;
          socket.destroy();
          return;
        }

        this.pipeSocketAndChannel(runtimeState, socket, channel);
      },
    );
  }

  private handleDynamicTcpConnection(
    rule: PortForwardRuleWithServer,
    runtimeState: PortForwardRuntimeState,
    socket: net.Socket,
  ): void {
    if (runtimeState.activeConnectionCount >= MAX_ACTIVE_CONNECTIONS_PER_RULE) {
      socket.destroy();
      return;
    }

    let stage: 'greeting' | 'request' | 'piping' = 'greeting';
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const cleanup = this.trackLocalSocket(runtimeState, socket);

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);

      if (stage === 'greeting') {
        if (buffer.length < 2) {
          return;
        }

        const methodCount = buffer[1] ?? 0;
        if (buffer.length < 2 + methodCount) {
          return;
        }

        const remaining = handleSocks5Greeting(socket, buffer);
        if (remaining === null) {
          socket.destroy();
          return;
        }

        buffer = remaining;
        stage = 'request';
      }

      if (stage !== 'request') {
        return;
      }

      const request = parseSocks5ConnectRequest(buffer);
      if (request.type === 'need-more-data') {
        return;
      }

      if (request.type === 'unsupported' || request.type === 'invalid') {
        writeSocks5Response(socket, request.code);
        socket.destroy();
        return;
      }

      stage = 'piping';
      socket.off('data', onData);
      const remaining = buffer.subarray(request.consumedBytes);
      this.handleSocksConnect(rule, runtimeState, socket, request.host, request.port, remaining);
    };

    socket.setTimeout(FORWARD_CONNECTION_TIMEOUT_MS);
    socket.on('data', onData);
    socket.once('timeout', () => socket.destroy());
    socket.once('close', cleanup);
    socket.once('error', (error) => {
      runtimeState.lastError = error.message;
    });
  }

  private handleSocksConnect(
    rule: PortForwardRuleWithServer,
    runtimeState: PortForwardRuntimeState,
    socket: net.Socket,
    targetHost: string,
    targetPort: number,
    initialData: Buffer<ArrayBufferLike>,
  ): void {
    socket.setTimeout(FORWARD_CONNECTION_TIMEOUT_MS);
    runtimeState.client.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      targetHost,
      targetPort,
      (error, channel) => {
        if (error) {
          runtimeState.lastError = error.message;
          writeSocks5Response(socket, 0x05);
          socket.destroy();
          return;
        }

        writeSocks5Response(socket, 0x00);
        if (initialData.length > 0) {
          channel.write(initialData);
        }
        this.pipeSocketAndChannel(runtimeState, socket, channel);
      },
    );
  }

  private pipeRemoteForwardConnection(
    rule: PortForwardRuleWithServer,
    runtimeState: PortForwardRuntimeState,
    channel: ClientChannel,
  ): void {
    if (!rule.targetHost || !rule.targetPort) {
      channel.destroy();
      return;
    }

    runtimeState.channels.add(channel);
    runtimeState.activeConnectionCount += 1;
    const socket = net.createConnection({ host: rule.targetHost, port: rule.targetPort });
    runtimeState.remoteSockets.add(socket);
    socket.setTimeout(FORWARD_CONNECTION_TIMEOUT_MS);

    const cleanup = (): void => {
      runtimeState.channels.delete(channel);
      runtimeState.remoteSockets.delete(socket);
      runtimeState.activeConnectionCount = Math.max(0, runtimeState.activeConnectionCount - 1);
    };

    socket.once('connect', () => {
      socket.pipe(channel);
      channel.pipe(socket);
    });
    socket.once('timeout', () => socket.destroy());
    socket.once('close', cleanup);
    socket.once('error', (error) => {
      runtimeState.lastError = error.message;
      channel.destroy();
    });
    channel.once('close', () => socket.destroy());
    channel.once('error', (error: Error) => {
      runtimeState.lastError = error.message;
      socket.destroy();
    });
  }

  private pipeSocketAndChannel(
    runtimeState: PortForwardRuntimeState,
    socket: net.Socket,
    channel: ClientChannel,
  ): void {
    runtimeState.channels.add(channel);
    socket.setTimeout(0);
    socket.pipe(channel);
    channel.pipe(socket);

    const cleanupChannel = (): void => {
      runtimeState.channels.delete(channel);
    };

    channel.once('close', cleanupChannel);
    channel.once('error', (error: Error) => {
      runtimeState.lastError = error.message;
      socket.destroy();
    });
    socket.once('close', () => {
      channel.destroy();
    });
  }

  /**
   * Tracks a locally accepted socket so stop/shutdown can always tear it down.
   *
   * @param runtimeState Rule runtime that owns the socket.
   * @param socket Accepted client socket.
   * @returns Cleanup callback that is safe to attach to the socket close event.
   */
  private trackLocalSocket(runtimeState: PortForwardRuntimeState, socket: net.Socket): () => void {
    runtimeState.localSockets.add(socket);
    runtimeState.activeConnectionCount += 1;

    return (): void => {
      runtimeState.localSockets.delete(socket);
      runtimeState.activeConnectionCount = Math.max(0, runtimeState.activeConnectionCount - 1);
    };
  }

  private async listen(server: net.Server, host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  private async forwardIn(client: Client, host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      client.forwardIn(host, port, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async unforwardIn(client: Client, host: string, port: number): Promise<void> {
    await new Promise<void>((resolve) => {
      client.unforwardIn(host, port, () => resolve());
    });
  }

  private async disposeRuntimeState(runtimeState: PortForwardRuntimeState): Promise<void> {
    if (runtimeState.tcpConnectionListener) {
      runtimeState.client.off('tcp connection', runtimeState.tcpConnectionListener);
    }

    if (runtimeState.boundHost && runtimeState.boundPort && !runtimeState.localServer) {
      await this.unforwardIn(runtimeState.client, runtimeState.boundHost, runtimeState.boundPort);
    }

    for (const socket of runtimeState.localSockets) {
      socket.destroy();
    }
    runtimeState.localSockets.clear();

    for (const socket of runtimeState.remoteSockets) {
      socket.destroy();
    }
    runtimeState.remoteSockets.clear();

    for (const channel of runtimeState.channels) {
      channel.destroy();
    }
    runtimeState.channels.clear();

    if (runtimeState.localServer) {
      await new Promise<void>((resolve) => {
        runtimeState.localServer?.close(() => resolve());
      });
      runtimeState.localServer = null;
    }

    runtimeState.client.end();
    runtimeState.activeConnectionCount = 0;
  }

  private async handleUnexpectedClose(ruleId: string, message: string): Promise<void> {
    try {
      const runtimeState = this.activeRules.get(ruleId);
      if (!runtimeState) {
        return;
      }

      runtimeState.lastError = message;
      this.activeRules.delete(ruleId);
      await this.disposeRuntimeState(runtimeState);
      await this.getDbClient().portForwardRule.update({
        where: {
          id: ruleId,
        },
        data: {
          lastStoppedAt: new Date(),
          lastFailureMessage: message,
        },
      });
    } catch (error: unknown) {
      console.error('[port-forward] Failed to finalize an unexpectedly closed rule.', {
        ruleId,
        message,
        error,
      });
    }
  }

  private async persistStartFailure(ruleId: string, message: string): Promise<void> {
    await this.getDbClient().portForwardRule.update({
      where: {
        id: ruleId,
      },
      data: {
        lastFailureMessage: message,
      },
    });
  }

  private logStartFailure(
    rule: PortForwardRuleWithServer,
    requestId: string | undefined,
    message: string,
    proxyMetadata?: { mode: string; protocol: string },
  ): void {
    this.logAuditEvent({
      category: 'port-forward',
      action: 'start',
      outcome: 'failure',
      severity: 'warning',
      entityType: 'port-forward-rule',
      entityId: rule.id,
      requestId,
      metadata: {
        ...this.buildAuditMetadata(rule),
        reason: message,
        proxyMode: proxyMetadata?.mode,
        proxyProtocol: proxyMetadata?.protocol,
      },
    });
  }

  private buildAuditMetadata(rule: PortForwardRuleWithServer): Record<string, string | number | boolean | undefined> {
    return {
      name: rule.name,
      type: rule.type,
      serverId: rule.serverId,
      localBindHost: rule.localBindHost ?? undefined,
      localBindPort: rule.localBindPort ?? undefined,
      remoteBindHost: rule.remoteBindHost ?? undefined,
      remoteBindPort: rule.remoteBindPort ?? undefined,
      targetHost: rule.targetHost ?? undefined,
      targetPort: rule.targetPort ?? undefined,
    };
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return fallback;
  }

  private logAuditEvent(input: AuditEventInput): void {
    void this.auditEventService.logEvent({
      ...input,
      requestId: input.requestId ?? randomUUID(),
    });
  }
}
