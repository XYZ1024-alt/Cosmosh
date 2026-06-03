import type { CompressionAlgorithm } from 'ssh2';

const SSH_COMPRESSION_DISABLED_ALGORITHMS: CompressionAlgorithm[] = ['none'];
const SSH_COMPRESSION_ENABLED_ALGORITHMS: CompressionAlgorithm[] = ['zlib@openssh.com', 'zlib', 'none'];

/**
 * Builds the SSH compression algorithm preference list for one server connection.
 *
 * @param enableSshCompression Whether the server should negotiate SSH transport compression.
 * @returns Ordered compression algorithms for ssh2 connection negotiation.
 */
export const buildSshCompressionAlgorithms = (enableSshCompression: boolean): CompressionAlgorithm[] => {
  return enableSshCompression ? [...SSH_COMPRESSION_ENABLED_ALGORITHMS] : [...SSH_COMPRESSION_DISABLED_ALGORITHMS];
};
