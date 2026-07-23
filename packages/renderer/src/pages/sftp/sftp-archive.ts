import type {
  ApiSftpArchiveCompressionLevel,
  ApiSftpArchiveFormat,
  ApiSftpArchiveOperationStage,
  ApiSftpEntry,
} from '@cosmosh/api-contract';

const ARCHIVE_SUFFIXES: Record<ApiSftpArchiveFormat, readonly string[]> = {
  tar: ['.tar'],
  'tar-gzip': ['.tar.gz', '.tgz'],
  zip: ['.zip'],
  'tar-xz': ['.tar.xz', '.txz'],
  'tar-bzip2': ['.tar.bz2', '.tbz2'],
  '7z': ['.7z'],
};

/**
 * Keeps the compression level valid when the selected archive format changes.
 *
 * @param format Canonical archive format.
 * @param compressionLevel Previously selected compression level.
 * @returns A level accepted by the selected format.
 */
export const normalizeSftpArchiveCompressionLevel = (
  format: ApiSftpArchiveFormat,
  compressionLevel: ApiSftpArchiveCompressionLevel,
): ApiSftpArchiveCompressionLevel =>
  format === 'tar' ? 'store' : compressionLevel === 'store' ? 'standard' : compressionLevel;

/**
 * Returns the standard filename extension used when creating a format.
 *
 * @param format Canonical archive format.
 * @returns Standard extension including its leading dot.
 */
export const getArchiveStandardExtension = (format: ApiSftpArchiveFormat): string => ARCHIVE_SUFFIXES[format][0];

/**
 * Detects supported archive aliases from one remote filename.
 *
 * @param fileName Remote entry basename.
 * @returns Canonical archive format or null.
 */
export const detectSftpArchiveFormat = (fileName: string): ApiSftpArchiveFormat | null => {
  const normalized = fileName.toLowerCase();
  for (const [format, suffixes] of Object.entries(ARCHIVE_SUFFIXES) as Array<
    [ApiSftpArchiveFormat, readonly string[]]
  >) {
    if (suffixes.some((suffix) => normalized.endsWith(suffix))) return format;
  }
  return null;
};

/**
 * Removes one recognized compound archive extension from a filename.
 *
 * @param fileName Remote archive basename.
 * @returns Basename suitable for an archive-named extraction directory.
 */
export const stripSftpArchiveExtension = (fileName: string): string => {
  const format = detectSftpArchiveFormat(fileName);
  if (!format) return fileName;
  const extension = getMatchingArchiveExtension(fileName, format);
  return fileName.slice(0, -extension.length) || 'archive';
};

/**
 * Replaces a recognized archive extension while preserving the user's stem.
 *
 * @param fileName Current archive filename.
 * @param format Newly selected canonical format.
 * @returns Filename with the standard extension for the selected format.
 */
export const switchSftpArchiveExtension = (fileName: string, format: ApiSftpArchiveFormat): string => {
  const currentFormat = detectSftpArchiveFormat(fileName);
  let stem = fileName.trim();
  if (currentFormat) {
    const normalized = stem.toLowerCase();
    const suffix = ARCHIVE_SUFFIXES[currentFormat].find((candidate) => normalized.endsWith(candidate));
    if (suffix) stem = stem.slice(0, -suffix.length);
  }
  return `${stem || 'archive'}${getArchiveStandardExtension(format)}`;
};

/**
 * Computes the initial archive stem from selected entries and current directory.
 *
 * @param entries Ordered selected entries.
 * @param currentPath Current remote directory path.
 * @returns Initial filename stem without archive extension.
 */
export const buildSftpArchiveDefaultStem = (entries: ApiSftpEntry[], currentPath: string): string => {
  if (entries.length === 1) {
    const entry = entries[0];
    if (!entry) return 'archive';
    if (entry.type !== 'file') return entry.name || 'archive';
    const lastDot = entry.name.lastIndexOf('.');
    return lastDot > 0 ? entry.name.slice(0, lastDot) || 'archive' : entry.name || 'archive';
  }
  const segments = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.at(-1) ?? 'archive';
};

/**
 * Finds a numbered archive name that does not collide with the current directory snapshot.
 *
 * @param preferredName Desired standard archive filename.
 * @param existingNames Basenames already present in the directory.
 * @returns Preferred name or a `name (N)` variant.
 */
export const suggestAvailableSftpArchiveName = (preferredName: string, existingNames: ReadonlySet<string>): string => {
  if (!existingNames.has(preferredName)) return preferredName;
  const format = detectSftpArchiveFormat(preferredName);
  const extension = format ? getMatchingArchiveExtension(preferredName, format) : '';
  const stem = extension ? preferredName.slice(0, -extension.length) : preferredName;
  for (let attempt = 2; attempt < 10_000; attempt += 1) {
    const candidate = `${stem} (${attempt})${extension}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return preferredName;
};

/** Returns whether every selected entry can be passed to the remote archiver. */
export const canCompressSftpEntries = (entries: ApiSftpEntry[]): boolean =>
  entries.length > 0 &&
  entries.every((entry) => entry.type === 'file' || entry.type === 'directory' || entry.type === 'symlink');

/** Returns whether every selected entry is an extractable supported archive. */
export const canExtractSftpEntries = (
  entries: ApiSftpEntry[],
  supportedFormats: readonly ApiSftpArchiveFormat[],
): boolean =>
  entries.length > 0 &&
  entries.every((entry) => {
    const format = entry.type === 'file' ? detectSftpArchiveFormat(entry.name) : null;
    return Boolean(format && supportedFormats.includes(format));
  });

/**
 * Returns the localized stage suffix without letting polling erase cancellation feedback.
 *
 * @param stage Latest backend operation stage.
 * @param cancelling Whether cancellation is requested locally or acknowledged remotely.
 * @returns Backend stage or the renderer-only cancelling stage.
 */
export const getSftpArchiveTaskStageKey = (
  stage: ApiSftpArchiveOperationStage,
  cancelling: boolean,
): ApiSftpArchiveOperationStage | 'cancelling' => (cancelling ? 'cancelling' : stage);

/** Resolves the exact alias extension already present on a filename. */
const getMatchingArchiveExtension = (fileName: string, format: ApiSftpArchiveFormat): string => {
  const normalized = fileName.toLowerCase();
  return ARCHIVE_SUFFIXES[format].find((suffix) => normalized.endsWith(suffix)) ?? getArchiveStandardExtension(format);
};
