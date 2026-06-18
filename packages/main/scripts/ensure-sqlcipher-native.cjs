const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const workspaceRoot = path.resolve(__dirname, '../../..');
const backendNodeModulesRoot = path.join(workspaceRoot, 'packages', 'backend', 'node_modules');
const mainNodeModulesRoot = path.join(workspaceRoot, 'packages', 'main', 'node_modules');
const packageName = 'better-sqlite3-multiple-ciphers';
const mainPackageJsonPath = path.join(workspaceRoot, 'packages', 'main', 'package.json');

/**
 * Parses semver-like runtime strings used by glibc for lexical-safe compare.
 */
const parseVersionTuple = (value) => {
  const [major = '0', minor = '0', patch = '0'] = value.split('.');
  return [Number.parseInt(major, 10), Number.parseInt(minor, 10), Number.parseInt(patch, 10)];
};

/**
 * Compares two dot-separated version strings and returns comparison result.
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
      '[main:prebuild] Unable to detect runtime glibc version. Refusing Linux release build because GLIBC baseline enforcement is enabled.',
    );
  }

  if (compareVersionStrings(runtimeGlibcVersion, maxGlibcVersion) > 0) {
    throw new Error(
      `[main:prebuild] Detected glibc ${runtimeGlibcVersion}, which exceeds max baseline ${maxGlibcVersion}. Build Linux artifacts on an older runner to avoid runtime ERR_DLOPEN_FAILED on target systems.`,
    );
  }

  console.log(`[main:prebuild] GLIBC baseline check passed (runtime=${runtimeGlibcVersion}, max=${maxGlibcVersion}).`);
};

/**
 * Walks upward from a resolved module entry until it finds package.json with expected name.
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
 * Executes command and bubbles non-zero exits with contextual diagnostics.
 */
const runCommand = async (command, args, cwd, extraEnv = {}) => {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
      },
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

      reject(new Error(`Command failed (code=${code ?? 'null'}, signal=${signal ?? 'null'}): ${command} ${args.join(' ')}`));
    });
  });
};

/**
 * Reads Electron semver from main package devDependencies and extracts normalized version.
 */
const resolveElectronVersion = async () => {
  const raw = await fs.readFile(mainPackageJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  const declaredVersion = parsed?.devDependencies?.electron;

  if (typeof declaredVersion !== 'string') {
    throw new Error('Unable to resolve Electron version from packages/main/package.json.');
  }

  const matched = declaredVersion.match(/\d+\.\d+\.\d+/);
  if (!matched) {
    throw new Error(`Unable to parse Electron version from declaration: ${declaredVersion}`);
  }

  return matched[0];
};

/**
 * Resolves node-gyp CLI path across common installation layouts.
 *
 * The project-pinned binary must take precedence over package-manager
 * injection because pnpm may expose an older internal node-gyp that does not
 * support the Visual Studio version installed on the CI runner.
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

  throw new Error('Unable to locate node-gyp CLI. Install node-gyp or use a Node.js distribution that bundles npm/node-gyp.');
};

/**
 * Rebuilds SQLCipher addon for current Electron ABI to prevent runtime native binding mismatch.
 */
const ensureSqlCipherNativeAddon = async () => {
  enforceLinuxGlibcBaselineIfConfigured();

  const packageEntry = require.resolve(packageName, {
    paths: [backendNodeModulesRoot, path.join(workspaceRoot, 'node_modules')],
  });
  const packageRoot = await findPackageRootFromEntry(packageEntry, packageName);
  const nativeBindingPath = path.join(packageRoot, 'build', 'Release', 'better_sqlite3.node');

  const electronVersion = await resolveElectronVersion();
  console.log(
    `[main:prebuild] Building SQLCipher native addon for Electron ${electronVersion} (ensures ABI compatibility).`,
  );
  const nodeGypCliPath = await resolveNodeGypCliPath();

  await runCommand(process.execPath, [nodeGypCliPath, 'rebuild', '--release'], packageRoot, {
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: 'https://electronjs.org/headers',
  });

  await fs.access(nativeBindingPath);
  console.log(`[main:prebuild] Native SQLCipher addon built successfully: ${nativeBindingPath}`);
};

ensureSqlCipherNativeAddon().catch((error) => {
  console.error('[main:prebuild] Failed to ensure SQLCipher native addon.', error);
  process.exitCode = 1;
});
