import { Buffer } from 'node:buffer';

import type { AuditEventService } from '../audit/service.js';

/** Phase names emitted by the remote bootstrap side-channel. */
export type RemoteBootstrapPhase = 'probe' | 'manifest' | 'download' | 'install' | 'verify';
/** State names emitted by the remote bootstrap side-channel. */
export type RemoteBootstrapState = 'started' | 'ok' | 'skipped' | 'failed';

/** WebSocket status payload forwarded to the renderer for remote bootstrap progress. */
export type RemoteBootstrapStatus = {
  type: 'bootstrap-status';
  phase: RemoteBootstrapPhase;
  state: RemoteBootstrapState;
  version?: string;
  code?: string;
  message?: string;
};

type RemoteBootstrapProbe = {
  os: 'linux';
  arch: 'amd64' | 'arm64';
  shell: 'ash' | 'bash' | 'fish' | 'sh' | 'zsh';
};

type RemoteBootstrapAsset = {
  os: string;
  arch: string;
  url: string;
  sha256: string;
};

type RemoteBootstrapManifest = {
  version: string;
  assets: RemoteBootstrapAsset[];
};

type RemoteBootstrapServiceOptions = {
  auditEventService: AuditEventService;
  manifestUrl?: string;
  fetchManifest?: (url: string) => Promise<unknown>;
};

type RunForSessionOptions = {
  serverId: string;
  sessionId: string;
  requestId?: string;
  executeCommand: (command: string) => Promise<string | null>;
  sendStatus: (status: RemoteBootstrapStatus) => void;
};

const REMOTE_BOOTSTRAP_COMMAND_TIMEOUT_MS = 60_000;
const REMOTE_BOOTSTRAP_OUTPUT_MAX_BYTES = 256 * 1024;
const REMOTE_BOOTSTRAP_SUPPORTED_SHELLS = new Set(['ash', 'bash', 'fish', 'sh', 'zsh']);
const REMOTE_BOOTSTRAP_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REMOTE_BOOTSTRAP_VERSION_PATTERN = /^[A-Za-z0-9._+-]+$/;

const PROBE_COMMAND =
  ' sh -lc \'os=$(uname -s 2>/dev/null | tr "[:upper:]" "[:lower:]"); arch=$(uname -m 2>/dev/null); shell_name=$(basename "${SHELL:-sh}"); case "$arch" in x86_64|amd64) arch=amd64;; aarch64|arm64) arch=arm64;; *) arch=unsupported;; esac; case "$shell_name" in zsh|fish|bash|ash|sh) shell="$shell_name";; *) shell=unsupported;; esac; printf "{\\"os\\":\\"%s\\",\\"arch\\":\\"%s\\",\\"shell\\":\\"%s\\"}\\n" "$os" "$arch" "$shell"\'';

/**
 * Orchestrates remote bootstrap probe, wrapper injection, and status parsing.
 */
export class RemoteBootstrapService {
  private readonly auditEventService: AuditEventService;

  private readonly manifestUrl: string | undefined;

  private readonly fetchManifest: (url: string) => Promise<unknown>;

  public constructor(options: RemoteBootstrapServiceOptions) {
    this.auditEventService = options.auditEventService;
    this.manifestUrl = options.manifestUrl;
    this.fetchManifest = options.fetchManifest ?? defaultFetchManifest;
  }

  /**
   * Runs bootstrap for one live SSH session without touching the interactive shell stream.
   *
   * @param options Session-scoped command executor and status callback.
   * @returns Nothing.
   */
  public async runForSession(options: RunForSessionOptions): Promise<void> {
    const emit = (status: RemoteBootstrapStatus): void => {
      options.sendStatus(status);
      this.logStatus(options, status);
    };

    emit({ type: 'bootstrap-status', phase: 'probe', state: 'started', message: 'probing remote host' });
    const probe = await this.probeRemote(options.executeCommand);
    if (!probe) {
      emit(this.failed('probe', 'PROBE_FAILED', 'remote platform or shell is unsupported'));
      return;
    }

    const manifest = await this.loadManifest(emit);
    if (!manifest) {
      return;
    }

    const asset = selectAsset(manifest, probe);
    if (!asset) {
      emit(this.failed('manifest', 'ASSET_NOT_FOUND', 'no matching linux bootstrap asset was found', manifest.version));
      return;
    }

    const output = await options.executeCommand(buildInstallCommand(probe, manifest, asset));
    this.forwardStatuses(output, emit, manifest.version);
  }

  private async probeRemote(
    executeCommand: RunForSessionOptions['executeCommand'],
  ): Promise<RemoteBootstrapProbe | null> {
    const output = await executeCommand(PROBE_COMMAND);
    if (!output) {
      return null;
    }

    return parseProbe(output);
  }

  private async loadManifest(emit: (status: RemoteBootstrapStatus) => void): Promise<RemoteBootstrapManifest | null> {
    if (!this.manifestUrl) {
      emit(this.failed('manifest', 'MANIFEST_URL_NOT_CONFIGURED', 'remote bootstrap manifest URL is not configured'));
      return null;
    }

    emit({ type: 'bootstrap-status', phase: 'manifest', state: 'started', message: 'loading bootstrap manifest' });
    let loaded: unknown;
    try {
      loaded = await this.fetchManifest(this.manifestUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'manifest request failed';
      emit(this.failed('manifest', 'MANIFEST_FETCH_FAILED', message));
      return null;
    }

    const manifest = parseManifest(loaded);
    if (!manifest) {
      emit(this.failed('manifest', 'MANIFEST_INVALID', 'remote bootstrap manifest is invalid'));
      return null;
    }

    emit({ type: 'bootstrap-status', phase: 'manifest', state: 'ok', version: manifest.version });
    return manifest;
  }

  private forwardStatuses(output: string | null, emit: (status: RemoteBootstrapStatus) => void, version: string): void {
    const statuses = parseStatusLines(output);
    if (statuses.length === 0) {
      emit(this.failed('install', 'NO_STATUS_OUTPUT', 'bootstrap wrapper did not emit status output', version));
      return;
    }

    statuses.forEach(emit);
  }

  private failed(phase: RemoteBootstrapPhase, code: string, message: string, version?: string): RemoteBootstrapStatus {
    return {
      type: 'bootstrap-status',
      phase,
      state: 'failed',
      version,
      code,
      message,
    };
  }

  private logStatus(options: RunForSessionOptions, status: RemoteBootstrapStatus): void {
    if (status.state !== 'failed' && status.state !== 'ok' && status.state !== 'skipped') {
      return;
    }

    void this.auditEventService.logEvent({
      category: 'ssh-session',
      action: 'remote-bootstrap',
      outcome: status.state === 'failed' ? 'failure' : 'success',
      severity: status.state === 'failed' ? 'warning' : 'info',
      entityType: 'ssh-server',
      entityId: options.serverId,
      sessionId: options.sessionId,
      requestId: options.requestId,
      metadata: status,
    });
  }
}

/** Bounded SSH exec limits for remote bootstrap side-channel commands. */
export const REMOTE_BOOTSTRAP_EXEC_OPTIONS = {
  timeoutMs: REMOTE_BOOTSTRAP_COMMAND_TIMEOUT_MS,
  maxOutputBytes: REMOTE_BOOTSTRAP_OUTPUT_MAX_BYTES,
} as const;

const defaultFetchManifest = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Remote bootstrap manifest request failed: ${response.status}`);
  }

  return await response.json();
};

const parseProbe = (output: string): RemoteBootstrapProbe | null => {
  const parsed = parseLastJsonObject(output);
  if (!parsed) {
    return null;
  }

  if (parsed.os !== 'linux' || (parsed.arch !== 'amd64' && parsed.arch !== 'arm64')) {
    return null;
  }

  if (typeof parsed.shell !== 'string' || !REMOTE_BOOTSTRAP_SUPPORTED_SHELLS.has(parsed.shell)) {
    return null;
  }

  return parsed as RemoteBootstrapProbe;
};

const parseManifest = (value: unknown): RemoteBootstrapManifest | null => {
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    !REMOTE_BOOTSTRAP_VERSION_PATTERN.test(value.version) ||
    !Array.isArray(value.assets)
  ) {
    return null;
  }

  const assets: RemoteBootstrapAsset[] = [];
  for (const asset of value.assets) {
    if (!isValidAsset(asset)) {
      return null;
    }

    assets.push(asset);
  }

  if (assets.length === 0) {
    return null;
  }

  return {
    version: value.version,
    assets,
  };
};

const isValidAsset = (value: unknown): value is RemoteBootstrapAsset => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.os === 'string' &&
    typeof value.arch === 'string' &&
    typeof value.url === 'string' &&
    typeof value.sha256 === 'string' &&
    isHttpsUrl(value.url) &&
    REMOTE_BOOTSTRAP_SHA256_PATTERN.test(value.sha256)
  );
};

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const selectAsset = (manifest: RemoteBootstrapManifest, probe: RemoteBootstrapProbe): RemoteBootstrapAsset | null => {
  return manifest.assets.find((asset) => asset.os === probe.os && asset.arch === probe.arch) ?? null;
};

const buildInstallCommand = (
  probe: RemoteBootstrapProbe,
  manifest: RemoteBootstrapManifest,
  asset: RemoteBootstrapAsset,
): string => {
  const wrapper = buildWrapperScript(probe, manifest, asset);
  const wrapperPayload = Buffer.from(wrapper, 'utf8').toString('base64');
  const interpreter = probe.shell === 'fish' || probe.shell === 'bash' ? probe.shell : 'sh';
  const base64MissingStatus = escapedJsonStatus(manifest.version, 'BASE64_NOT_FOUND', 'base64 is required');
  const mktempMissingStatus = escapedJsonStatus(manifest.version, 'MKTEMP_NOT_FOUND', 'mktemp is required');
  const mktempFailedStatus = escapedJsonStatus(manifest.version, 'MKTEMP_FAILED', 'mktemp failed');
  const shellMissingStatus = escapedJsonStatus(manifest.version, 'SHELL_NOT_FOUND', 'target shell is unavailable');
  const launcher = buildLauncherScript({
    base64MissingStatus,
    interpreter,
    mktempFailedStatus,
    mktempMissingStatus,
    shellMissingStatus,
    wrapperPayload,
  });
  return ` sh -lc ${quotePosixShell(launcher)}`;
};

/**
 * Builds the POSIX launcher that decodes and executes the shell-specific bootstrap wrapper.
 *
 * @param config Precomputed launcher payload and status strings.
 * @returns Shell source passed as one literal argument to `sh -lc`.
 */
const buildLauncherScript = (config: {
  base64MissingStatus: string;
  interpreter: string;
  mktempFailedStatus: string;
  mktempMissingStatus: string;
  shellMissingStatus: string;
  wrapperPayload: string;
}): string => {
  return `if ! command -v base64 >/dev/null 2>&1; then printf "${config.base64MissingStatus}"; exit 1; fi
if ! command -v mktemp >/dev/null 2>&1; then printf "${config.mktempMissingStatus}"; exit 1; fi
if ! command -v ${config.interpreter} >/dev/null 2>&1; then printf "${config.shellMissingStatus}"; exit 1; fi
umask 077
tmp="$(mktemp "\${TMPDIR:-/tmp}/cosmosh-wrapper.XXXXXX")" || { printf "${config.mktempFailedStatus}"; exit 1; }
trap 'rm -f "$tmp"' EXIT HUP INT TERM
printf %s "${config.wrapperPayload}" | base64 -d > "$tmp" && ${config.interpreter} "$tmp"
rc=$?
exit $rc`;
};

const escapedJsonStatus = (version: string, code: string, message: string): string => {
  const payload = JSON.stringify({
    type: 'bootstrap-status',
    phase: 'install',
    state: 'failed',
    version,
    code,
    message,
  });
  return `${payload.replace(/"/g, '\\$&')}\\n`;
};

const buildWrapperScript = (
  probe: RemoteBootstrapProbe,
  manifest: RemoteBootstrapManifest,
  asset: RemoteBootstrapAsset,
): string => {
  const helperPayload = Buffer.from(buildHelperScript(probe.shell), 'utf8').toString('base64');
  const config = {
    shell: probe.shell,
    version: manifest.version,
    url: asset.url,
    sha256: asset.sha256,
    helperPayload,
  };

  return probe.shell === 'fish' ? buildFishWrapper(config) : buildPosixWrapper(config);
};

const buildHelperScript = (shell: RemoteBootstrapProbe['shell']): string => {
  if (shell === 'fish') {
    return 'set -gx COSMOSH_BOOTSTRAP_READY 1\n';
  }

  return 'export COSMOSH_BOOTSTRAP_READY=1\n';
};

const buildPosixWrapper = (config: {
  shell: string;
  version: string;
  url: string;
  sha256: string;
  helperPayload: string;
}): string => {
  const shell = quotePosixShell(config.shell);
  const version = quotePosixShell(config.version);
  const url = quotePosixShell(config.url);
  const sha256 = quotePosixShell(config.sha256);
  const helperPayload = quotePosixShell(config.helperPayload);

  return `set -eu
cosmosh_shell=${shell}
cosmosh_version=${version}
cosmosh_asset_url=${url}
cosmosh_sha256=${sha256}
cosmosh_helper_payload_b64=${helperPayload}
cosmosh_fail() { printf '{"type":"bootstrap-status","phase":"%s","state":"failed","version":"%s","code":"%s","message":"%s"}\\n' "$1" "$cosmosh_version" "$2" "$3"; exit 1; }
if ! command -v mktemp >/dev/null 2>&1; then cosmosh_fail download MKTEMP_NOT_FOUND "mktemp is required"; fi
umask 077
tmp="$(mktemp -d "\${TMPDIR:-/tmp}/cosmosh-bootstrap.XXXXXX")" || cosmosh_fail download MKTEMP_FAILED "mktemp failed"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
bin="$tmp/cosmosh-bootstrap"
printf '{"type":"bootstrap-status","phase":"download","state":"started","version":"%s"}\\n' "$cosmosh_version"
if command -v curl >/dev/null 2>&1; then curl -fsSL "$cosmosh_asset_url" -o "$bin" || cosmosh_fail download DOWNLOAD_FAILED "curl download failed"; elif command -v wget >/dev/null 2>&1; then wget -q -O "$bin" "$cosmosh_asset_url" || cosmosh_fail download DOWNLOAD_FAILED "wget download failed"; else cosmosh_fail download DOWNLOADER_NOT_FOUND "curl or wget is required"; fi
printf '{"type":"bootstrap-status","phase":"verify","state":"started","version":"%s"}\\n' "$cosmosh_version"
if command -v sha256sum >/dev/null 2>&1; then printf '%s  %s\\n' "$cosmosh_sha256" "$bin" | sha256sum -c - >/dev/null || cosmosh_fail verify CHECKSUM_MISMATCH "sha256sum verification failed"; elif command -v shasum >/dev/null 2>&1; then printf '%s  %s\\n' "$cosmosh_sha256" "$bin" | shasum -a 256 -c - >/dev/null || cosmosh_fail verify CHECKSUM_MISMATCH "shasum verification failed"; else cosmosh_fail verify HASH_TOOL_NOT_FOUND "sha256sum or shasum is required"; fi
chmod 700 "$bin"
printf '{"type":"bootstrap-status","phase":"install","state":"started","version":"%s"}\\n' "$cosmosh_version"
"$bin" install --shell "$cosmosh_shell" --version "$cosmosh_version" --helper-payload-b64 "$cosmosh_helper_payload_b64"
`;
};

const buildFishWrapper = (config: {
  shell: string;
  version: string;
  url: string;
  sha256: string;
  helperPayload: string;
}): string => {
  const shell = quoteFishShell(config.shell);
  const version = quoteFishShell(config.version);
  const url = quoteFishShell(config.url);
  const sha256 = quoteFishShell(config.sha256);
  const helperPayload = quoteFishShell(config.helperPayload);

  return `function cosmosh_fail
  printf '{"type":"bootstrap-status","phase":"%s","state":"failed","version":"%s","code":"%s","message":"%s"}\\n' $argv[1] "$cosmosh_version" $argv[2] $argv[3]
  exit 1
end
set cosmosh_shell ${shell}
set cosmosh_version ${version}
set cosmosh_asset_url ${url}
set cosmosh_sha256 ${sha256}
set cosmosh_helper_payload_b64 ${helperPayload}
if not command -q mktemp
  cosmosh_fail download MKTEMP_NOT_FOUND "mktemp is required"
end
set tmpdir "$TMPDIR"
if test -z "$tmpdir"
  set tmpdir /tmp
end
umask 077
set tmp (mktemp -d "$tmpdir/cosmosh-bootstrap.XXXXXX"); or cosmosh_fail download MKTEMP_FAILED "mktemp failed"
function cosmosh_cleanup --on-event fish_exit
  rm -rf "$tmp"
end
set bin "$tmp/cosmosh-bootstrap"
printf '{"type":"bootstrap-status","phase":"download","state":"started","version":"%s"}\\n' "$cosmosh_version"
if command -q curl
  curl -fsSL "$cosmosh_asset_url" -o "$bin"; or cosmosh_fail download DOWNLOAD_FAILED "curl download failed"
else if command -q wget
  wget -q -O "$bin" "$cosmosh_asset_url"; or cosmosh_fail download DOWNLOAD_FAILED "wget download failed"
else
  cosmosh_fail download DOWNLOADER_NOT_FOUND "curl or wget is required"
end
printf '{"type":"bootstrap-status","phase":"verify","state":"started","version":"%s"}\\n' "$cosmosh_version"
if command -q sha256sum
  printf '%s  %s\\n' "$cosmosh_sha256" "$bin" | sha256sum -c - >/dev/null; or cosmosh_fail verify CHECKSUM_MISMATCH "sha256sum verification failed"
else if command -q shasum
  printf '%s  %s\\n' "$cosmosh_sha256" "$bin" | shasum -a 256 -c - >/dev/null; or cosmosh_fail verify CHECKSUM_MISMATCH "shasum verification failed"
else
  cosmosh_fail verify HASH_TOOL_NOT_FOUND "sha256sum or shasum is required"
end
chmod 700 "$bin"
printf '{"type":"bootstrap-status","phase":"install","state":"started","version":"%s"}\\n' "$cosmosh_version"
"$bin" install --shell "$cosmosh_shell" --version "$cosmosh_version" --helper-payload-b64 "$cosmosh_helper_payload_b64"
`;
};

/**
 * Converts arbitrary data into a POSIX single-quoted shell literal.
 *
 * @param value Data to embed in shell source.
 * @returns Literal that evaluates back to the original value without command evaluation.
 */
const quotePosixShell = (value: string): string => {
  return `'${value.replace(/'/g, "'\\''")}'`;
};

/**
 * Converts arbitrary data into a fish single-quoted shell literal.
 *
 * @param value Data to embed in fish source.
 * @returns Literal that evaluates back to the original value without command evaluation.
 */
const quoteFishShell = (value: string): string => {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
};

const parseStatusLines = (output: string | null): RemoteBootstrapStatus[] => {
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => parseStatusLine(line))
    .filter((status): status is RemoteBootstrapStatus => status !== null);
};

const parseStatusLine = (line: string): RemoteBootstrapStatus | null => {
  const parsed = parseJsonObject(line);
  if (!parsed || parsed.type !== 'bootstrap-status') {
    return null;
  }

  if (!isPhase(parsed.phase) || !isState(parsed.state)) {
    return null;
  }

  return {
    type: 'bootstrap-status',
    phase: parsed.phase,
    state: parsed.state,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    code: typeof parsed.code === 'string' ? parsed.code : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
  };
};

const parseLastJsonObject = (output: string): Record<string, unknown> | null => {
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonObject(lines[index] ?? '');
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isPhase = (value: unknown): value is RemoteBootstrapPhase => {
  return value === 'probe' || value === 'manifest' || value === 'download' || value === 'install' || value === 'verify';
};

const isState = (value: unknown): value is RemoteBootstrapState => {
  return value === 'started' || value === 'ok' || value === 'skipped' || value === 'failed';
};
