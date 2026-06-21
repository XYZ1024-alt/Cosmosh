import type { Prisma, PrismaClient } from '@prisma/client';
import { Client, type ConnectConfig } from 'ssh2';

import type { I18nInstance } from '../i18n-bridge.js';
import { buildSshCompressionAlgorithms } from './compression.js';
import { decryptSensitiveValue } from './crypto.js';
import { prepareSshProxyTransport, SshProxyConnectionError, type SshProxyMetadata } from './proxy.js';

export type SshServerWithKeychain = Prisma.SshServerGetPayload<{
  include: {
    keychain: true;
  };
}>;

export type OpenSshClientResult =
  | {
      type: 'ready';
      client: Client;
      completionSecretValue: string | null;
      proxyMetadata: SshProxyMetadata;
    }
  | {
      type: 'host-untrusted';
      fingerprint: string;
      message: string;
      proxyMetadata?: SshProxyMetadata;
    }
  | {
      type: 'failed';
      message: string;
      proxyMetadata?: SshProxyMetadata;
    };

/**
 * Opens one authenticated ssh2 client for non-shell SSH subsystems.
 *
 * @param server SSH server record with resolved keychain material.
 * @param options Connection policy and localization dependencies.
 * @returns Ready ssh2 client or a normalized failure branch.
 */
export const openSshClient = async (
  server: SshServerWithKeychain,
  options: {
    connectTimeoutSec: number;
    db: PrismaClient;
    systemProxyRules?: string;
    strictHostKey: boolean;
    trustedFingerprintSet: Set<string>;
    credentialEncryptionKey: Buffer;
    t: I18nInstance['t'];
  },
): Promise<OpenSshClientResult> => {
  const client = new Client();
  let presentedFingerprint = '';

  const connectConfig: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: options.connectTimeoutSec * 1000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    algorithms: {
      compress: buildSshCompressionAlgorithms(server.enableSshCompression),
    },
    hostHash: 'sha256',
    hostVerifier: (hashedKey: string) => {
      presentedFingerprint = hashedKey;
      return !options.strictHostKey || options.trustedFingerprintSet.has(hashedKey);
    },
  };

  let completionSecretValue: string | null = null;

  try {
    if (server.keychain.authType === 'password' || server.keychain.authType === 'both') {
      if (!server.keychain.passwordEncrypted) {
        return {
          type: 'failed',
          message: options.t('errors.ssh.passwordNotConfigured'),
        };
      }

      connectConfig.password = decryptSensitiveValue(
        server.keychain.passwordEncrypted,
        options.credentialEncryptionKey,
      );
      completionSecretValue = typeof connectConfig.password === 'string' ? connectConfig.password : null;
    }

    if (server.keychain.authType === 'key' || server.keychain.authType === 'both') {
      if (!server.keychain.privateKeyEncrypted) {
        return {
          type: 'failed',
          message: options.t('errors.ssh.privateKeyNotConfigured'),
        };
      }

      connectConfig.privateKey = decryptSensitiveValue(
        server.keychain.privateKeyEncrypted,
        options.credentialEncryptionKey,
      );

      if (server.keychain.privateKeyPassphraseEncrypted) {
        connectConfig.passphrase = decryptSensitiveValue(
          server.keychain.privateKeyPassphraseEncrypted,
          options.credentialEncryptionKey,
        );
        if (!completionSecretValue && typeof connectConfig.passphrase === 'string') {
          completionSecretValue = connectConfig.passphrase;
        }
      }
    }
  } catch {
    return {
      type: 'failed',
      message: options.t('errors.ssh.decryptCredentialsFailed'),
    };
  }

  let proxyTransport;
  try {
    proxyTransport = await prepareSshProxyTransport(
      options.db,
      server,
      options.systemProxyRules,
      options.connectTimeoutSec * 1000,
    );
  } catch (error: unknown) {
    return {
      type: 'failed',
      message: error instanceof Error ? error.message : 'Proxy connection failed.',
      proxyMetadata: error instanceof SshProxyConnectionError ? error.metadata : undefined,
    };
  }

  connectConfig.readyTimeout = proxyTransport.readyTimeoutMs;
  if (proxyTransport.socket) {
    connectConfig.sock = proxyTransport.socket;
  }

  return await new Promise<OpenSshClientResult>((resolve) => {
    let settled = false;

    const settle = (result: OpenSshClientResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    client.once('ready', () => {
      settle({
        type: 'ready',
        client,
        completionSecretValue,
        proxyMetadata: proxyTransport.metadata,
      });
    });

    client.once('error', (error) => {
      client.end();

      if (options.strictHostKey && presentedFingerprint && !options.trustedFingerprintSet.has(presentedFingerprint)) {
        settle({
          type: 'host-untrusted',
          fingerprint: presentedFingerprint,
          message: error.message,
          proxyMetadata: proxyTransport.metadata,
        });
        return;
      }

      settle({
        type: 'failed',
        message: error.message,
        proxyMetadata: proxyTransport.metadata,
      });
    });

    client.connect(connectConfig);
  });
};
