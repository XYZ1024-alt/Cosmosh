export const REMOTE_SHELL_EVENT_OSC_PAYLOAD_MAX_BYTES = 8 * 1024;

const ESCAPE = '\u001b';
const BELL = '\u0007';
const STRING_TERMINATOR = `${ESCAPE}\\`;
const COSMOSH_OSC_PREFIX = `${ESCAPE}]777;cosmosh;`;

const REMOTE_SHELL_EVENTS = new Set([
  'integration-ready',
  'prompt-ready',
  'cwd',
  'command-start',
  'command-end',
  'foreground-command',
] as const);

const REMOTE_SHELL_NAMES = new Set(['bash', 'zsh', 'fish', 'sh', 'ash'] as const);
const REMOTE_SHELL_HELPER_VERSION_PATTERN = /^[A-Za-z0-9._+-]+$/;
const REMOTE_SHELL_CAPABILITY_PATTERN = /^[a-z0-9-]+$/;
const REMOTE_SHELL_CAPABILITY_MAX_COUNT = 32;

export type RemoteShellEventName =
  | 'integration-ready'
  | 'prompt-ready'
  | 'cwd'
  | 'command-start'
  | 'command-end'
  | 'foreground-command';

export type RemoteShellName = 'bash' | 'zsh' | 'fish' | 'sh' | 'ash';

export type RemoteShellEventMessage = {
  type: 'remote-shell-event';
  event: RemoteShellEventName;
  shell: RemoteShellName;
  helperVersion: string;
  protocolVersion: number;
  capabilities: string[];
  cwd?: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
  commandId?: string;
  timestamp: number;
};

type ParseResult = {
  output: string;
  events: RemoteShellEventMessage[];
};

/**
 * Streams terminal output through the Cosmosh OSC 777 parser.
 *
 * SSH output arrives in arbitrary chunks, so OSC payloads may be split across
 * reads. This parser keeps only the active OSC sequence in memory and strips
 * recognized Cosmosh events before they reach xterm.
 */
export class RemoteShellEventOscParser {
  private pendingEscape = false;

  private pendingOsc: string | null = null;

  private discardingOversizedCosmoshOsc = false;

  private discardSawEscape = false;

  /**
   * Parses one SSH output chunk.
   *
   * @param chunk Raw UTF-8 terminal output chunk.
   * @returns Visible terminal output plus normalized remote shell events.
   */
  public parse(chunk: string): ParseResult {
    let output = '';
    const events: RemoteShellEventMessage[] = [];

    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index] ?? '';

      if (this.discardingOversizedCosmoshOsc) {
        this.consumeDiscardedOscChar(char);
        continue;
      }

      if (this.pendingOsc !== null) {
        const completedSequence = this.appendOscChar(char);
        if (completedSequence === null) {
          continue;
        }

        const parsed = this.parseCompletedOsc(completedSequence);
        output += parsed.output;
        events.push(...parsed.events);
        continue;
      }

      if (this.pendingEscape) {
        this.pendingEscape = false;
        if (char === ']') {
          this.pendingOsc = `${ESCAPE}]`;
          continue;
        }

        output += `${ESCAPE}${char}`;
        continue;
      }

      if (char === ESCAPE) {
        this.pendingEscape = true;
        continue;
      }

      output += char;
    }

    return { output, events };
  }

  /**
   * Flushes any incomplete sequence as visible output.
   *
   * This is intended for session teardown only; normal chunk parsing should
   * keep incomplete OSC data pending because the next SSH chunk may finish it.
   *
   * @returns Buffered visible output.
   */
  public flush(): string {
    let output = '';

    if (this.pendingEscape) {
      output += ESCAPE;
      this.pendingEscape = false;
    }

    if (this.pendingOsc !== null) {
      output += this.pendingOsc;
      this.pendingOsc = null;
    }

    this.discardingOversizedCosmoshOsc = false;
    this.discardSawEscape = false;

    return output;
  }

  /**
   * Appends one character while collecting an OSC sequence.
   *
   * @param char Next character in the SSH output stream.
   * @returns Completed sequence, or null while waiting for a terminator.
   */
  private appendOscChar(char: string): string | null {
    if (this.pendingOsc === null) {
      return null;
    }

    this.pendingOsc += char;

    if (this.pendingOsc.endsWith(BELL) || this.pendingOsc.endsWith(STRING_TERMINATOR)) {
      const completed = this.pendingOsc;
      this.pendingOsc = null;
      return completed;
    }

    if (this.isOversizedCosmoshOsc(this.pendingOsc)) {
      this.pendingOsc = null;
      this.discardingOversizedCosmoshOsc = true;
    }

    return null;
  }

  /**
   * Consumes characters until an oversized Cosmosh OSC reaches its terminator.
   *
   * @param char Next character from the stream.
   * @returns Nothing.
   */
  private consumeDiscardedOscChar(char: string): void {
    if (this.discardSawEscape) {
      this.discardSawEscape = false;
      if (char === '\\') {
        this.discardingOversizedCosmoshOsc = false;
      }
      return;
    }

    if (char === BELL) {
      this.discardingOversizedCosmoshOsc = false;
      return;
    }

    if (char === ESCAPE) {
      this.discardSawEscape = true;
    }
  }

  /**
   * Parses or preserves one completed OSC sequence.
   *
   * @param sequence Full OSC bytes including ESC prefix and terminator.
   * @returns Visible output plus any decoded Cosmosh events.
   */
  private parseCompletedOsc(sequence: string): ParseResult {
    if (!sequence.startsWith(COSMOSH_OSC_PREFIX)) {
      return { output: sequence, events: [] };
    }

    const payload = sequence.slice(COSMOSH_OSC_PREFIX.length, readSequencePayloadEnd(sequence));
    if (Buffer.byteLength(payload, 'utf8') > REMOTE_SHELL_EVENT_OSC_PAYLOAD_MAX_BYTES) {
      return { output: '', events: [] };
    }

    const event = parseRemoteShellEventPayload(payload);
    return {
      output: '',
      events: event ? [event] : [],
    };
  }

  /**
   * Checks whether a pending Cosmosh OSC has exceeded the event payload cap.
   *
   * @param sequence Pending OSC sequence.
   * @returns True when the parser should stop buffering and discard to terminator.
   */
  private isOversizedCosmoshOsc(sequence: string): boolean {
    return (
      sequence.startsWith(COSMOSH_OSC_PREFIX) &&
      Buffer.byteLength(sequence.slice(COSMOSH_OSC_PREFIX.length), 'utf8') > REMOTE_SHELL_EVENT_OSC_PAYLOAD_MAX_BYTES
    );
  }
}

/**
 * Parses a base64-encoded remote shell event payload.
 *
 * @param payload Base64 JSON payload from the OSC sequence.
 * @returns Normalized WebSocket message, or null when invalid.
 */
export const parseRemoteShellEventPayload = (payload: string): RemoteShellEventMessage | null => {
  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    if (Buffer.byteLength(decoded, 'utf8') > REMOTE_SHELL_EVENT_OSC_PAYLOAD_MAX_BYTES) {
      return null;
    }

    const parsed = JSON.parse(decoded) as unknown;
    return normalizeRemoteShellEvent(parsed);
  } catch {
    return null;
  }
};

/**
 * Converts unknown JSON into the trusted remote shell event contract.
 *
 * @param value Parsed JSON value.
 * @returns Normalized remote shell event message, or null when invalid.
 */
export const normalizeRemoteShellEvent = (value: unknown): RemoteShellEventMessage | null => {
  if (!isObjectRecord(value)) {
    return null;
  }

  const event = value.event;
  const shell = value.shell;
  const helperVersion = value.helperVersion;
  const protocolVersion = value.protocolVersion;
  const timestamp = value.timestamp;

  if (typeof event !== 'string' || !REMOTE_SHELL_EVENTS.has(event as RemoteShellEventName)) {
    return null;
  }

  if (typeof shell !== 'string' || !REMOTE_SHELL_NAMES.has(shell as RemoteShellName)) {
    return null;
  }

  if (
    typeof helperVersion !== 'string' ||
    !REMOTE_SHELL_HELPER_VERSION_PATTERN.test(helperVersion) ||
    typeof protocolVersion !== 'number' ||
    !Number.isInteger(protocolVersion) ||
    protocolVersion < 1
  ) {
    return null;
  }

  const capabilities = normalizeCapabilities(value.capabilities);
  if (!capabilities) {
    return null;
  }

  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return null;
  }

  const message: RemoteShellEventMessage = {
    type: 'remote-shell-event',
    event: event as RemoteShellEventName,
    shell: shell as RemoteShellName,
    helperVersion,
    protocolVersion,
    capabilities,
    timestamp,
  };

  if (typeof value.cwd === 'string' && value.cwd.length > 0 && value.cwd.length <= 4096) {
    message.cwd = value.cwd;
  }

  if (typeof value.command === 'string' && value.command.length > 0 && value.command.length <= 4096) {
    message.command = value.command;
  }

  if (typeof value.exitCode === 'number' && Number.isInteger(value.exitCode)) {
    message.exitCode = value.exitCode;
  }

  if (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0) {
    message.durationMs = Math.round(value.durationMs);
  }

  if (typeof value.commandId === 'string' && value.commandId.length > 0 && value.commandId.length <= 128) {
    message.commandId = value.commandId;
  }

  return message;
};

/**
 * Validates a bounded, unique helper capability list.
 *
 * @param value Unknown capabilities payload.
 * @returns Normalized capabilities, or null when malformed.
 */
const normalizeCapabilities = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > REMOTE_SHELL_CAPABILITY_MAX_COUNT) {
    return null;
  }

  const capabilities: string[] = [];
  for (const capability of value) {
    if (
      typeof capability !== 'string' ||
      !REMOTE_SHELL_CAPABILITY_PATTERN.test(capability) ||
      capabilities.includes(capability)
    ) {
      return null;
    }
    capabilities.push(capability);
  }

  return capabilities;
};

/**
 * Finds the end index of the payload inside a completed OSC sequence.
 *
 * @param sequence Completed OSC sequence.
 * @returns Exclusive payload end index.
 */
const readSequencePayloadEnd = (sequence: string): number => {
  if (sequence.endsWith(STRING_TERMINATOR)) {
    return sequence.length - STRING_TERMINATOR.length;
  }

  return sequence.length - BELL.length;
};

/**
 * Narrows an unknown value to a plain object record.
 *
 * @param value Unknown parsed JSON value.
 * @returns True when the value can be read as a record.
 */
const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
