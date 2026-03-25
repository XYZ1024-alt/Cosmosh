const fs = require('node:fs/promises');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '../../..');
const pnpmStoreDir = path.join(workspaceRoot, 'node_modules', '.pnpm');
const runtimeResourcesRoot = path.join(workspaceRoot, 'packages', 'main', 'resources-runtime', 'node_modules');
const targetDir = path.join(runtimeResourcesRoot, '.prisma');
const targetPrismaClientDir = path.join(runtimeResourcesRoot, '@prisma', 'client');
const supportedPackagedPlatforms = new Set(['win32', 'linux', 'darwin']);

/**
 * Resolves build target platform for runtime asset filtering.
 */
const resolvePackagedPlatform = () => {
  const override = process.env.COSMOSH_PACKAGE_PLATFORM?.trim().toLowerCase();
  if (override && supportedPackagedPlatforms.has(override)) {
    return override;
  }

  return process.platform;
};

const packagedPlatform = resolvePackagedPlatform();

const toNormalizedRelativePath = (baseDir, sourcePath) => path.relative(baseDir, sourcePath).split(path.sep).join('/');

/**
 * Returns true when a file name looks like a Prisma query engine native binary.
 */
const isPrismaQueryEngineBinary = (fileName) => {
  const normalized = fileName.toLowerCase();
  return normalized.includes('query_engine') && normalized.endsWith('.node');
};

/**
 * Checks whether a query engine binary matches the current packaged platform.
 */
const shouldKeepQueryEngineForPlatform = (fileName, platform) => {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith('.dll.node')) {
    return platform === 'win32';
  }

  if (normalized.endsWith('.so.node')) {
    return platform === 'linux';
  }

  if (normalized.endsWith('.dylib.node')) {
    return platform === 'darwin';
  }

  return true;
};

/**
 * Parses required Prisma binary targets from env.
 */
const getRequiredPrismaTargetsFromEnv = () => {
  const rawTargets = process.env.COSMOSH_REQUIRED_PRISMA_TARGETS;
  if (typeof rawTargets !== 'string' || rawTargets.trim().length === 0) {
    return [];
  }

  return rawTargets
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

/**
 * Validates that expected Linux Prisma engines are present in packaged runtime assets.
 */
const validateRequiredPrismaTargets = async (prismaRuntimeRoot) => {
  if (packagedPlatform !== 'linux') {
    return;
  }

  const requiredTargets = getRequiredPrismaTargetsFromEnv();
  if (requiredTargets.length === 0) {
    return;
  }

  const clientEngineDir = path.join(prismaRuntimeRoot, 'client');
  const missingFiles = [];

  for (const target of requiredTargets) {
    const fileName = `libquery_engine-${target}.so.node`;
    const filePath = path.join(clientEngineDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      missingFiles.push(fileName);
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(
      `[main:prebuild] Prisma runtime missing required engine binaries: ${missingFiles.join(', ')}. ` +
        'Update binaryTargets in packages/backend/prisma/schema.prisma and rerun prisma generate.',
    );
  }

  console.log(
    `[main:prebuild] Prisma target validation passed: ${requiredTargets.map((target) => `libquery_engine-${target}.so.node`).join(', ')}`,
  );
};

/**
 * Skips browser/WASM/typing artifacts that are unnecessary for Electron backend runtime.
 */
const shouldSkipPrismaArtifact = (sourcePath) => {
  const fileName = path.basename(sourcePath);
  const lowerFileName = fileName.toLowerCase();

  const skipExactFiles = new Set([
    'index-browser.js',
    'index-browser.mjs',
    'query_engine_bg.js',
    'query_engine_bg.wasm',
    'react-native.js',
    'wasm.js',
    'wasm.mjs',
    'wasm-worker-loader.mjs',
    'wasm-edge-light-loader.mjs',
  ]);

  if (skipExactFiles.has(lowerFileName)) {
    return true;
  }

  if (/\.tmp\d+$/i.test(fileName)) {
    return true;
  }

  if (isPrismaQueryEngineBinary(fileName) && !shouldKeepQueryEngineForPlatform(fileName, packagedPlatform)) {
    return true;
  }

  if (fileName.endsWith('.map') || lowerFileName.endsWith('.d.ts') || lowerFileName.endsWith('.d.mts')) {
    return true;
  }

  if (/^query_(engine|compiler)_bg\.[a-z0-9-]+\.wasm-base64\.(js|mjs)$/i.test(fileName)) {
    return true;
  }

  if (/^(edge|edge-esm|react-native)\.(js|mjs|d\.ts)$/i.test(fileName)) {
    return true;
  }

  if (/^wasm-(engine|compiler)-edge\.(js|mjs|d\.ts)$/i.test(fileName)) {
    return true;
  }

  return false;
};

/**
 * Lists synchronized Prisma query engine binaries to aid packaging diagnostics.
 */
const listPackagedPrismaEngines = async (prismaRuntimeRoot) => {
  const clientEngineDir = path.join(prismaRuntimeRoot, 'client');
  const entries = await fs.readdir(clientEngineDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && isPrismaQueryEngineBinary(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
};

/**
 * Locates prisma runtime directories from pnpm store layout.
 */
const findPrismaSourceDirs = async () => {
  const entries = await fs.readdir(pnpmStoreDir, { withFileTypes: true });
  const prismaClientPackageDir = entries.find(
    (entry) =>
      entry.isDirectory() &&
      (entry.name.startsWith('@prisma+client@') || entry.name.startsWith('%40prisma%2Bclient%40')),
  );

  if (!prismaClientPackageDir) {
    throw new Error('Unable to locate @prisma/client in node_modules/.pnpm.');
  }

  const sourceRoot = path.join(pnpmStoreDir, prismaClientPackageDir.name, 'node_modules');
  return {
    prismaRuntimeDir: path.join(sourceRoot, '.prisma'),
    prismaClientDir: path.join(sourceRoot, '@prisma', 'client'),
  };
};

/**
 * Synchronizes prisma runtime binaries and client package into packaged runtime node_modules.
 */
const syncPrismaClient = async () => {
  const { prismaRuntimeDir, prismaClientDir } = await findPrismaSourceDirs();

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.rm(targetPrismaClientDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.mkdir(path.dirname(targetPrismaClientDir), { recursive: true });
  await fs.cp(prismaRuntimeDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => !shouldSkipPrismaArtifact(sourcePath),
  });
  await fs.cp(prismaClientDir, targetPrismaClientDir, {
    recursive: true,
    filter: (sourcePath) => {
      const relativePath = toNormalizedRelativePath(prismaClientDir, sourcePath).toLowerCase();

      if (
        relativePath === 'generator-build' ||
        relativePath.startsWith('generator-build/') ||
        relativePath === 'scripts' ||
        relativePath.startsWith('scripts/') ||
        relativePath === 'node_modules' ||
        relativePath.startsWith('node_modules/')
      ) {
        return false;
      }

      return !shouldSkipPrismaArtifact(sourcePath);
    },
  });

  await validateRequiredPrismaTargets(targetDir);

  const packagedEngines = await listPackagedPrismaEngines(targetDir);

  console.log(`[main:prebuild] Synced Prisma runtime: ${prismaRuntimeDir} -> ${targetDir}`);
  console.log(`[main:prebuild] Synced Prisma package: ${prismaClientDir} -> ${targetPrismaClientDir}`);
  console.log(
    `[main:prebuild] Packaged Prisma engines for ${packagedPlatform}: ${packagedEngines.length > 0 ? packagedEngines.join(', ') : 'none'}`,
  );
};

syncPrismaClient().catch((error) => {
  console.error('[main:prebuild] Failed to sync Prisma runtime files.', error);
  process.exitCode = 1;
});
