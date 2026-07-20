const fs = require('node:fs/promises');
const path = require('node:path');

const mainPackageRoot = path.resolve(__dirname, '..');
const resourcesDir = path.join(mainPackageRoot, 'resources', 'remote-bootstrap');
const manifestUrlPath = path.join(resourcesDir, 'manifest-url.json');

/**
 * Resolves the manifest URL that release builds should package for backend runtime.
 *
 * @returns {string | null} Release manifest URL, or null when packaging should skip the resource.
 */
const resolveManifestUrl = () => {
  const configuredUrl = process.env.COSMOSH_REMOTE_BOOTSTRAP_MANIFEST_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  return null;
};

/**
 * Writes the packaged manifest URL resource consumed by the main process.
 *
 * @returns {Promise<void>} Resolves once the resource file has been written.
 */
const writeManifestUrlResource = async () => {
  const manifestUrl = resolveManifestUrl();
  if (!manifestUrl) {
    await fs.rm(manifestUrlPath, { force: true });
    console.log('[main:prebuild] No remote bootstrap manifest URL configured. Skipping packaged resource.');
    return;
  }

  const parsed = new URL(manifestUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Remote bootstrap manifest URL must use HTTPS for packaging.');
  }

  await fs.mkdir(resourcesDir, { recursive: true });
  await fs.writeFile(manifestUrlPath, `${JSON.stringify({ manifestUrl }, null, 2)}\n`, 'utf8');
  console.log(`[main:prebuild] Wrote remote bootstrap manifest URL resource: ${manifestUrl}`);
};

writeManifestUrlResource().catch((error) => {
  console.error('[main:prebuild] Failed to write remote bootstrap manifest URL resource.', error);
  process.exitCode = 1;
});
