const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '../../..');
const backendNodeModulesRoot = path.join(workspaceRoot, 'packages', 'backend', 'node_modules');
const mainNodeModulesRoot = path.join(workspaceRoot, 'packages', 'main', 'node_modules');
const packageName = 'better-sqlite3-multiple-ciphers';
const PROBE_OUTPUT_LIMIT = 8 * 1024;

/** @typedef {'electron' | 'node'} NativeRuntime */

/**
 * @typedef {object} NativeRuntimeOptions
 * @property {NativeRuntime} runtime Native addon target runtime.
 * @property {boolean} ifNeeded Whether a compatible existing binding may skip rebuild.
 */

/**
 * @typedef {object} NativeRuntimeDescriptor
 * @property {NativeRuntime} runtime Runtime identifier.
 * @property {string} version Runtime version.
 * @property {string} executablePath Runtime executable used for compatibility probes.
 * @property {NodeJS.ProcessEnv} buildEnvironment Environment used by node-gyp.
 * @property {NodeJS.ProcessEnv} probeEnvironment Environment used by the runtime probe.
 */

/**
 * @typedef {object} NativeProbeResult
 * @property {boolean} compatible Whether the native addon loaded successfully.
 * @property {string} diagnostic Bounded probe failure context.
 */

/**
 * Parses semver-like runtime strings used by glibc for lexical-safe compare.
 *
 * @param {string} value Dot-separated version string.
 * @returns {[number, number, number]} Three-part numeric version tuple.
 */
const parseVersionTuple = (value) => {
  const [major = '0', minor = '0', patch = '0'] = value.split('.');
  return [Number.parseInt(major, 10), Number.parseInt(minor, 10), Number.parseInt(patch, 10)];
};

/**
 * Compares two dot-separated version strings and returns comparison result.
 *
 * @param {string} left Left version.
 * @param {string} right Right version.
 * @returns {-1 | 0 | 1} Numeric version comparison result.
 */
const compareVersionStrings = (left, right) => {
  const leftTuple = parseVersionTuple(left);
  const rightTuple = parseVersionTuple(right);

  for (let index = 0; index < 3; index += 1) {
    const l = Number.isNaN(leftTuple[index]) ? 0 : leftTuple[index];
    const r = Number.isNaN(rightTuple[index]) ? 0 : rightTuple[index];
    if (l > r) {
      return 1;
    }
    if (l < r) {
      return -1;
    }
  }

  return 0;
};

/**
 * Returns runtime glibc version when Node report exposes it.
 *
 * @returns {string | null} Runtime glibc version or null when unavailable.
 */
const getRuntimeGlibcVersion = () => {
  try {
    const report = process.report?.getReport?.();
    const glibcVersionRuntime = report?.header?.glibcVersionRuntime;
    return typeof glibcVersionRuntime === 'string' ? glibcVersionRuntime : null;
  } catch {
    return null;
  }
};

/**
 * Validates Linux build environment glibc baseline when enforcement is enabled.
 *
 * @returns {void}
 */
const enforceLinuxGlibcBaselineIfConfigured = () => {
  if (process.platform !== 'linux') {
    return;
  }

  const shouldEnforce = process.env.COSMOSH_ENFORCE_GLIBC_BASELINE === '1';
  if (!shouldEnforce) {
    return;
  }

  const maxGlibcVersion = process.env.COSMOSH_MAX_GLIBC_VERSION || '2.35';
  const runtimeGlibcVersion = getRuntimeGlibcVersion();

  if (!runtimeGlibcVersion) {
    throw new Error(
      '[main:native] Unable to detect runtime glibc version. Refusing Linux build because GLIBC baseline enforcement is enabled.',
    );
  }

  if (compareVersionStrings(runtimeGlibcVersion, maxGlibcVersion) > 0) {
    throw new Error(
      `[main:native] Detected glibc ${runtimeGlibcVersion}, which exceeds max baseline ${maxGlibcVersion}. Build Linux artifacts on an older runner to avoid runtime ERR_DLOPEN_FAILED on target systems.`,
    );
  }

  console.log(`[main:native] GLIBC baseline check passed (runtime=${runtimeGlibcVersion}, max=${maxGlibcVersion}).`);
};

/**
 * Parses supported runtime-selection arguments.
 *
 * @param {string[]} args Command-line arguments after the script path.
 * @returns {NativeRuntimeOptions} Validated runtime options.
 */
const parseRuntimeOptions = (args) => {
  /** @type {NativeRuntime} */
  let runtime = 'electron';
  let ifNeeded = false;

  for (const argument of args) {
    if (argument === '--if-needed') {
      ifNeeded = true;
      continue;
    }

    if (argument.startsWith('--runtime=')) {
      const candidateRuntime = argument.slice('--runtime='.length);
      if (candidateRuntime !== 'electron' && candidateRuntime !== 'node') {
        throw new Error(`Unsupported SQLCipher native runtime: ${candidateRuntime}`);
      }
      runtime = candidateRuntime;
      continue;
    }

    throw new Error(`Unsupported SQLCipher native argument: ${argument}`);
  }

  return { runtime, ifNeeded };
};

/**
 * Walks upward from a resolved module entry until it finds package.json with expected name.
 *
 * @param {string} entryPath Resolved package entry path.
 * @param {string} expectedPackageName Expected package name.
 * @returns {Promise<string>} Resolved package root.
 */
const findPackageRootFromEntry = async (entryPath, expectedPackageName) => {
  let cursor = path.dirname(entryPath);

  while (true) {
    const packageJsonPath = path.join(cursor, 'package.json');

    try {
      const raw = await fs.readFile(packageJsonPath, 'utf8');
      const parsed = JSON.parse(raw);

      if (parsed?.name === expectedPackageName) {
        return cursor;
      }
    } catch {
      // Keep searching parent directories.
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`Unable to locate package root for ${expectedPackageName} from ${entryPath}`);
    }

    cursor = parent;
  }
};

/**
 * Executes a command and bubbles non-zero exits with contextual diagnostics.
 *
 * @param {string} command Executable path.
 * @param {string[]} args Command arguments.
 * @param {string} cwd Child working directory.
 * @param {NodeJS.ProcessEnv} environment Complete child-process environment.
 * @returns {Promise<void>} Resolves after a successful exit.
 */
const runCommand = async (command, args, cwd, environment) => {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`Command failed (code=${code ?? 'null'}, signal=${signal ?? 'null'}): ${command} ${args.join(' ')}`),
      );
    });
  });
};

/**
 * Removes inherited native-build target variables before selecting an explicit runtime.
 *
 * @returns {NodeJS.ProcessEnv} Sanitized child-process environment.
 */
const createBaseRuntimeEnvironment = () => {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.npm_config_disturl;
  delete environment.npm_config_runtime;
  delete environment.npm_config_target;
  return environment;
};

/**
 * Resolves the exact installed Electron version and executable.
 *
 * @returns {Promise<{ version: string, executablePath: string }>} Installed Electron runtime metadata.
 */
const resolveInstalledElectronRuntime = async () => {
  const electronPackageJsonPath = require.resolve('electron/package.json', {
    paths: [mainNodeModulesRoot],
  });
  const electronModulePath = require.resolve('electron', {
    paths: [mainNodeModulesRoot],
  });
  const electronPackageJson = JSON.parse(await fs.readFile(electronPackageJsonPath, 'utf8'));
  const electronExecutablePath = require(electronModulePath);

  if (typeof electronPackageJson.version !== 'string' || typeof electronExecutablePath !== 'string') {
    throw new Error('Unable to resolve installed Electron runtime metadata.');
  }

  return {
    version: electronPackageJson.version,
    executablePath: electronExecutablePath,
  };
};

/**
 * Resolves build and probe configuration for one native target runtime.
 *
 * @param {NativeRuntime} runtime Requested target runtime.
 * @returns {Promise<NativeRuntimeDescriptor>} Runtime descriptor.
 */
const resolveRuntimeDescriptor = async (runtime) => {
  const buildEnvironment = createBaseRuntimeEnvironment();
  const probeEnvironment = createBaseRuntimeEnvironment();

  if (runtime === 'node') {
    return {
      runtime,
      version: process.versions.node,
      executablePath: process.execPath,
      buildEnvironment,
      probeEnvironment,
    };
  }

  const electronRuntime = await resolveInstalledElectronRuntime();
  buildEnvironment.npm_config_runtime = 'electron';
  buildEnvironment.npm_config_target = electronRuntime.version;
  buildEnvironment.npm_config_disturl = 'https://electronjs.org/headers';
  probeEnvironment.ELECTRON_RUN_AS_NODE = '1';

  return {
    runtime,
    version: electronRuntime.version,
    executablePath: electronRuntime.executablePath,
    buildEnvironment,
    probeEnvironment,
  };
};

/**
 * Resolves node-gyp CLI path across common installation layouts.
 *
 * The project-pinned binary must take precedence over package-manager
 * injection because pnpm may expose an older internal node-gyp that does not
 * support the Visual Studio version installed on the CI runner.
 *
 * @returns {Promise<string>} Absolute node-gyp CLI path.
 */
const resolveNodeGypCliPath = async () => {
  const projectNodeGypCandidates = [
    path.join(mainNodeModulesRoot, 'node-gyp', 'bin', 'node-gyp.js'),
    path.join(workspaceRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  ];

  for (const candidate of projectNodeGypCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue searching fallback candidates.
    }
  }

  const configuredNodeGyp = process.env.npm_config_node_gyp;
  if (configuredNodeGyp) {
    try {
      await fs.access(configuredNodeGyp);
      return configuredNodeGyp;
    } catch {
      // Ignore invalid npm_config_node_gyp and continue searching.
    }
  }

  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue searching fallback candidates.
    }
  }

  const resolveFromPaths = [mainNodeModulesRoot, backendNodeModulesRoot, workspaceRoot];
  try {
    return require.resolve('node-gyp/bin/node-gyp.js', {
      paths: resolveFromPaths,
    });
  } catch {
    // Keep the dedicated error below for clearer guidance.
  }

  throw new Error(
    'Unable to locate node-gyp CLI. Install node-gyp or use a Node.js distribution that bundles npm/node-gyp.',
  );
};

/**
 * Bounds child stderr so a failed native probe cannot flood build diagnostics.
 *
 * @param {string} currentOutput Accumulated output.
 * @param {Buffer} chunk New stderr chunk.
 * @returns {string} Bounded output tail.
 */
const appendBoundedProbeOutput = (currentOutput, chunk) => {
  return `${currentOutput}${chunk.toString('utf8')}`.slice(-PROBE_OUTPUT_LIMIT);
};

/**
 * Reduces a probe stack to one bounded log line.
 *
 * @param {string} diagnostic Raw probe diagnostic.
 * @returns {string} Compact diagnostic text.
 */
const summarizeProbeDiagnostic = (diagnostic) => {
  const normalized = diagnostic.replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, 700) : 'runtime exited without diagnostics';
};

/**
 * Opens and closes an in-memory database under the requested runtime.
 *
 * @param {NativeRuntimeDescriptor} runtimeDescriptor Runtime probe configuration.
 * @param {string} packageRoot SQLCipher package root.
 * @returns {Promise<NativeProbeResult>} Compatibility result.
 */
const probeNativeAddon = async (runtimeDescriptor, packageRoot) => {
  const probeSource = [
    `const Database = require(${JSON.stringify(packageRoot)});`,
    "const database = new Database(':memory:');",
    'database.close();',
  ].join(' ');

  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const child = spawn(runtimeDescriptor.executablePath, ['-e', probeSource], {
      cwd: packageRoot,
      env: runtimeDescriptor.probeEnvironment,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      windowsHide: true,
    });

    /**
     * Resolves the probe exactly once across spawn-error and exit paths.
     *
     * @param {NativeProbeResult} result Probe result.
     * @returns {void}
     */
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.stderr.on('data', (chunk) => {
      stderr = appendBoundedProbeOutput(stderr, chunk);
    });

    child.once('error', (error) => {
      finish({ compatible: false, diagnostic: error.message });
    });

    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish({ compatible: true, diagnostic: '' });
        return;
      }

      finish({
        compatible: false,
        diagnostic: stderr || `runtime exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      });
    });
  });
};

/**
 * Rebuilds and validates the SQLCipher addon for the selected runtime.
 *
 * @param {NativeRuntimeOptions} options Runtime selection and skip policy.
 * @returns {Promise<void>} Resolves when the target runtime can open the addon.
 */
const ensureSqlCipherNativeAddon = async ({ runtime, ifNeeded }) => {
  enforceLinuxGlibcBaselineIfConfigured();

  const packageEntry = require.resolve(packageName, {
    paths: [backendNodeModulesRoot, path.join(workspaceRoot, 'node_modules')],
  });
  const packageRoot = await findPackageRootFromEntry(packageEntry, packageName);
  const nativeBindingPath = path.join(packageRoot, 'build', 'Release', 'better_sqlite3.node');
  const runtimeDescriptor = await resolveRuntimeDescriptor(runtime);
  const runtimeLabel = `${runtimeDescriptor.runtime} ${runtimeDescriptor.version}`;

  if (ifNeeded) {
    const existingProbe = await probeNativeAddon(runtimeDescriptor, packageRoot);
    if (existingProbe.compatible) {
      console.log(`[main:native] SQLCipher addon already matches ${runtimeLabel}. Skipping rebuild.`);
      return;
    }

    console.log(
      `[main:native] SQLCipher addon does not match ${runtimeLabel}; rebuilding. Probe: ${summarizeProbeDiagnostic(existingProbe.diagnostic)}`,
    );
  }

  console.log(`[main:native] Building SQLCipher native addon for ${runtimeLabel}.`);
  const nodeGypCliPath = await resolveNodeGypCliPath();
  await runCommand(
    process.execPath,
    [nodeGypCliPath, 'rebuild', '--release'],
    packageRoot,
    runtimeDescriptor.buildEnvironment,
  );

  await fs.access(nativeBindingPath);
  const rebuiltProbe = await probeNativeAddon(runtimeDescriptor, packageRoot);
  if (!rebuiltProbe.compatible) {
    throw new Error(
      `SQLCipher native addon was built for ${runtimeLabel} but failed its runtime probe: ${summarizeProbeDiagnostic(rebuiltProbe.diagnostic)}`,
    );
  }

  console.log(`[main:native] SQLCipher addon is compatible with ${runtimeLabel}: ${nativeBindingPath}`);
};

let runtimeOptions;
try {
  runtimeOptions = parseRuntimeOptions(process.argv.slice(2));
} catch (error) {
  console.error('[main:native] Invalid SQLCipher native options.', error);
  process.exitCode = 1;
}

if (runtimeOptions) {
  ensureSqlCipherNativeAddon(runtimeOptions).catch((error) => {
    console.error('[main:native] Failed to ensure SQLCipher native addon.', error);
    process.exitCode = 1;
  });
}
