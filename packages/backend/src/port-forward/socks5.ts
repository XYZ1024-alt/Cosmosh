import type net from 'node:net';

export type Socks5ConnectRequest =
  | {
      type: 'connect';
      host: string;
      port: number;
      consumedBytes: number;
    }
  | {
      type: 'need-more-data';
    }
  | {
      type: 'unsupported';
      code: number;
      consumedBytes: number;
    }
  | {
      type: 'invalid';
      code: number;
      consumedBytes: number;
    };

const SOCKS_VERSION = 0x05;
const METHOD_NO_AUTH = 0x00;
const METHOD_NO_ACCEPTABLE = 0xff;
const COMMAND_CONNECT = 0x01;
const ADDRESS_TYPE_IPV4 = 0x01;
const ADDRESS_TYPE_DOMAIN = 0x03;
const ADDRESS_TYPE_IPV6 = 0x04;

/**
 * Handles the SOCKS5 greeting and selects no-auth when supported.
 *
 * @param socket Client socket receiving the greeting.
 * @param chunk First SOCKS5 greeting chunk.
 * @returns Remaining bytes after the greeting, or null when negotiation failed.
 */
export const handleSocks5Greeting = (socket: net.Socket, chunk: Buffer): Buffer | null => {
  if (chunk.length < 2 || chunk[0] !== SOCKS_VERSION) {
    socket.write(Buffer.from([SOCKS_VERSION, METHOD_NO_ACCEPTABLE]));
    return null;
  }

  const methodCount = chunk[1] ?? 0;
  const expectedLength = 2 + methodCount;
  if (chunk.length < expectedLength) {
    return Buffer.alloc(0);
  }

  const methods = chunk.subarray(2, expectedLength);
  if (!methods.includes(METHOD_NO_AUTH)) {
    socket.write(Buffer.from([SOCKS_VERSION, METHOD_NO_ACCEPTABLE]));
    return null;
  }

  socket.write(Buffer.from([SOCKS_VERSION, METHOD_NO_AUTH]));
  return chunk.subarray(expectedLength);
};

/**
 * Parses one SOCKS5 TCP CONNECT request.
 *
 * @param buffer Buffered request bytes after the greeting.
 * @returns Parsed CONNECT target or a normalized protocol failure.
 */
export const parseSocks5ConnectRequest = (buffer: Buffer): Socks5ConnectRequest => {
  if (buffer.length < 4) {
    return { type: 'need-more-data' };
  }

  if (buffer[0] !== SOCKS_VERSION) {
    return { type: 'invalid', code: 0x01, consumedBytes: buffer.length };
  }

  const command = buffer[1];
  const addressType = buffer[3];
  if (command !== COMMAND_CONNECT) {
    return { type: 'unsupported', code: 0x07, consumedBytes: buffer.length };
  }

  let offset = 4;
  let host = '';

  if (addressType === ADDRESS_TYPE_IPV4) {
    if (buffer.length < offset + 4 + 2) {
      return { type: 'need-more-data' };
    }

    host = [...buffer.subarray(offset, offset + 4)].join('.');
    offset += 4;
  } else if (addressType === ADDRESS_TYPE_DOMAIN) {
    if (buffer.length < offset + 1) {
      return { type: 'need-more-data' };
    }

    const domainLength = buffer[offset] ?? 0;
    offset += 1;
    if (buffer.length < offset + domainLength + 2) {
      return { type: 'need-more-data' };
    }

    host = buffer.subarray(offset, offset + domainLength).toString('utf8');
    offset += domainLength;
  } else if (addressType === ADDRESS_TYPE_IPV6) {
    if (buffer.length < offset + 16 + 2) {
      return { type: 'need-more-data' };
    }

    const segments: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      segments.push(buffer.readUInt16BE(offset + index).toString(16));
    }
    host = segments.join(':');
    offset += 16;
  } else {
    return { type: 'unsupported', code: 0x08, consumedBytes: buffer.length };
  }

  const port = buffer.readUInt16BE(offset);
  offset += 2;

  if (!host || port < 1 || port > 65535) {
    return { type: 'invalid', code: 0x04, consumedBytes: offset };
  }

  return {
    type: 'connect',
    host,
    port,
    consumedBytes: offset,
  };
};

/**
 * Writes a SOCKS5 CONNECT response with IPv4 zero bind address.
 *
 * @param socket Client socket.
 * @param code SOCKS5 reply code.
 * @returns void.
 */
export const writeSocks5Response = (socket: net.Socket, code: number): void => {
  socket.write(Buffer.from([SOCKS_VERSION, code, 0x00, ADDRESS_TYPE_IPV4, 0, 0, 0, 0, 0, 0]));
};
