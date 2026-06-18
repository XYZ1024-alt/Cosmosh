import type { Client, ClientChannel } from 'ssh2';

export const DEFAULT_SSH_EXEC_TIMEOUT_MS = 15_000;
export const DEFAULT_SSH_EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Executes a bounded background SSH command.
 *
 * The helper contains callback stalls, synchronous ssh2 errors, channel errors,
 * and excessive stdout so periodic telemetry/history jobs cannot accumulate
 * unbounded resources.
 *
 * @param client Connected ssh2 client.
 * @param command Remote command string.
 * @param options Optional timeout and stdout byte limits.
 * @returns UTF-8 stdout on success, otherwise null.
 */
export const executeBoundedSshCommand = async (
  client: Client,
  command: string,
  options?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
  },
): Promise<string | null> => {
  const timeoutMs = Math.max(1, options?.timeoutMs ?? DEFAULT_SSH_EXEC_TIMEOUT_MS);
  const maxOutputBytes = Math.max(1, options?.maxOutputBytes ?? DEFAULT_SSH_EXEC_MAX_OUTPUT_BYTES);

  return await new Promise<string | null>((resolve) => {
    let channel: ClientChannel | null = null;
    let output = '';
    let outputBytes = 0;
    let settled = false;

    const finish = (result: string | null, closeChannel = false): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      if (closeChannel && channel) {
        try {
          channel.close();
        } catch {
          // Ignore channel close races after the result is already determined.
        }
      }

      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish(null, true);
    }, timeoutMs);

    try {
      client.exec(command, (error, openedChannel) => {
        if (settled) {
          try {
            openedChannel?.close();
          } catch {
            // Ignore a late callback after timeout containment.
          }
          return;
        }

        if (error) {
          finish(null);
          return;
        }

        channel = openedChannel;
        channel.on('data', (chunk: Buffer | string) => {
          const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          outputBytes += Buffer.byteLength(data, 'utf8');
          if (outputBytes > maxOutputBytes) {
            finish(null, true);
            return;
          }

          output += data;
        });
        channel.once('error', () => {
          finish(null, true);
        });
        channel.once('close', () => {
          finish(output);
        });
      });
    } catch {
      finish(null);
    }
  });
};
