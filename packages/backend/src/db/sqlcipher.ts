import { constants as fsConstants, existsSync } from 'node:fs';
import { access, copyFile, open, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3';
import type { SqlDriverAdapter, SqlMigrationAwareDriverAdapterFactory, SqlQuery } from '@prisma/driver-adapter-utils';

const require = createRequire(import.meta.url);
const SQLITE_PLAINTEXT_HEADER = Buffer.from('SQLite format 3\0', 'ascii');
const SQLCIPHER_TEMP_SUFFIX = '.sqlcipher-migration';
const PLAINTEXT_BACKUP_SUFFIX = '.plaintext-backup';

/**
 * Minimal statement surface used by SQLCipher bootstrap and export helpers.
 */
type SqlCipherStatement = {
  get: () => unknown;
};

/**
 * Minimal SQLCipher-capable database surface exposed by better-sqlite3-multiple-ciphers.
 */
type SqlCipherDatabase = {
  close: () => void;
  exec: (statement: string) => unknown;
  pragma: (statement: string) => unknown;
  prepare: (statement: string) => SqlCipherStatement;
};

/**
 * Constructor contract shared by the SQLCipher package and focused test doubles.
 */
type SqlCipherDatabaseConstructor = new (filePath: string) => SqlCipherDatabase;

/**
 * Stable paths used to recover an interrupted plaintext-to-SQLCipher replacement.
 */
type SqlCipherMigrationPaths = {
  encryptedTempPath: string;
  plaintextBackupPath: string;
};

/**
 * Verification facts collected while an SQLCipher database is open with its key.
 */
type SqlCipherVerification = {
  tableCount: number;
};

let cachedSqlCipherDriver: SqlCipherDatabaseConstructor | null | undefined;
let cachedSqlCipherNativeBindingPath: string | undefined;

/**
 * Escapes a value embedded in a trusted SQLite string literal.
 *
 * @param input Raw value.
 * @returns SQLite-safe literal content.
 */
const escapeSqliteLiteral = (input: string): string => {
  return input.replace(/'/g, "''");
};

/**
 * Creates a parameter-free Prisma driver-adapter query.
 *
 * @param sql SQL statement to execute.
 * @returns Driver-adapter query payload.
 */
const createSqlQuery = (sql: string): SqlQuery => {
  return { sql, args: [], argTypes: [] };
};

/**
 * Resolves whether a filesystem path currently exists.
 *
 * @param targetPath Absolute path to inspect.
 * @returns True when the path exists.
 */
const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolves the native SQLCipher driver and refuses silent plaintext fallback.
 *
 * @returns SQLCipher database constructor.
 * @throws When the packaged native module cannot be loaded.
 */
const resolveSqlCipherDriver = (): SqlCipherDatabaseConstructor => {
  if (cachedSqlCipherDriver === null) {
    throw new Error('SQLCipher native driver is unavailable. Refusing plaintext SQLite access.');
  }

  if (cachedSqlCipherDriver) {
    return cachedSqlCipherDriver;
  }

  try {
    const loadedModule = require('better-sqlite3-multiple-ciphers') as SqlCipherDatabaseConstructor;
    cachedSqlCipherDriver = loadedModule;
    return loadedModule;
  } catch (error: unknown) {
    cachedSqlCipherDriver = null;
    throw new Error('SQLCipher native driver is unavailable. Refusing plaintext SQLite access.', { cause: error });
  }
};

/**
 * Locates the SQLCipher native binary passed to Prisma's better-sqlite3 adapter.
 *
 * Prisma's adapter owns the JavaScript query/transaction contract, while this binding
 * makes the adapter's actual SQLite connection SQLCipher-capable.
 *
 * @returns Absolute native binding path.
 * @throws When packaging omitted the SQLCipher binary.
 */
const resolveSqlCipherNativeBindingPath = (): string => {
  if (cachedSqlCipherNativeBindingPath) {
    return cachedSqlCipherNativeBindingPath;
  }

  const packageJsonPath = require.resolve('better-sqlite3-multiple-ciphers/package.json');
  const nativeBindingPath = path.join(path.dirname(packageJsonPath), 'build', 'Release', 'better_sqlite3.node');
  if (!existsSync(nativeBindingPath)) {
    throw new Error(`SQLCipher native binding is missing at ${nativeBindingPath}.`);
  }

  cachedSqlCipherNativeBindingPath = nativeBindingPath;
  return nativeBindingPath;
};

/**
 * Applies SQLCipher configuration before Prisma can issue any database query.
 *
 * @param adapter Newly opened Prisma SQLite driver adapter.
 * @param databaseKey SQLCipher key resolved by Electron Main.
 * @returns The configured adapter.
 * @throws When the binding is not SQLCipher-capable or the key cannot read the file.
 */
const configureSqlCipherAdapter = async (adapter: SqlDriverAdapter, databaseKey: string): Promise<SqlDriverAdapter> => {
  try {
    const cipherResult = await adapter.queryRaw(createSqlQuery("PRAGMA cipher = 'sqlcipher';"));
    if (cipherResult.rows.at(0)?.at(0) !== 'sqlcipher') {
      throw new Error('Prisma SQLite adapter loaded without SQLCipher codec support.');
    }

    const keyResult = await adapter.queryRaw(createSqlQuery(`PRAGMA key = '${escapeSqliteLiteral(databaseKey)}';`));
    if (keyResult.rows.at(0)?.at(0) !== 'ok') {
      throw new Error('SQLCipher adapter rejected the database key configuration.');
    }
    await adapter.queryRaw(createSqlQuery('SELECT count(*) AS tableCount FROM sqlite_master;'));
    return adapter;
  } catch (error: unknown) {
    await adapter.dispose().catch(() => undefined);
    throw new Error('Failed to configure Prisma SQLCipher adapter before first query.', { cause: error });
  }
};

/**
 * Prisma adapter factory that binds every production connection to SQLCipher before use.
 */
export class PrismaSqlCipherAdapterFactory implements SqlMigrationAwareDriverAdapterFactory {
  public readonly provider = 'sqlite';
  public readonly adapterName = '@cosmosh/prisma-sqlcipher';

  private readonly delegate: PrismaBetterSQLite3;
  private readonly databaseKey: string;

  /**
   * Creates a SQLCipher-backed Prisma adapter factory.
   *
   * @param databaseUrl Prisma SQLite file URL.
   * @param databaseKey SQLCipher database key.
   */
  public constructor(databaseUrl: string, databaseKey: string) {
    this.delegate = new PrismaBetterSQLite3({
      url: databaseUrl,
      nativeBinding: resolveSqlCipherNativeBindingPath(),
    });
    this.databaseKey = databaseKey;
  }

  /**
   * Opens and keys the primary Prisma connection.
   *
   * @returns Configured SQLCipher driver adapter.
   */
  public async connect(): Promise<SqlDriverAdapter> {
    return await configureSqlCipherAdapter(await this.delegate.connect(), this.databaseKey);
  }

  /**
   * Opens and keys a Prisma shadow-database connection when requested by tooling.
   *
   * @returns Configured SQLCipher shadow adapter.
   */
  public async connectToShadowDb(): Promise<SqlDriverAdapter> {
    return await configureSqlCipherAdapter(await this.delegate.connectToShadowDb(), this.databaseKey);
  }
}

/**
 * Reads only the fixed SQLite header without loading the database into memory.
 *
 * @param databaseFilePath Database file path.
 * @returns Bytes read from the file header.
 */
const readDatabaseHeader = async (databaseFilePath: string): Promise<Buffer> => {
  const fileHandle = await open(databaseFilePath, 'r');
  try {
    const header = Buffer.alloc(SQLITE_PLAINTEXT_HEADER.length);
    const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
};

/**
 * Detects a valid plaintext SQLite file by its canonical header.
 *
 * @param databaseFilePath Database file path.
 * @returns True only for non-empty plaintext SQLite files.
 */
const isPlaintextSqliteDatabase = async (databaseFilePath: string): Promise<boolean> => {
  if (!(await fileExists(databaseFilePath))) {
    return false;
  }

  const databaseStats = await stat(databaseFilePath);
  if (databaseStats.size < SQLITE_PLAINTEXT_HEADER.length) {
    return false;
  }

  return (await readDatabaseHeader(databaseFilePath)).equals(SQLITE_PLAINTEXT_HEADER);
};

/**
 * Converts a driver result into a safe table-count number.
 *
 * @param row Driver result row.
 * @returns Non-negative table count.
 */
const readTableCount = (row: unknown): number => {
  const value = (row as { tableCount?: unknown } | null)?.tableCount;
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  throw new Error('SQLCipher verification returned an invalid sqlite_master table count.');
};

/**
 * Reads the first scalar returned by better-sqlite3's default PRAGMA mode.
 *
 * @param pragmaResult Unknown PRAGMA result.
 * @returns First scalar value, or undefined when no row was returned.
 */
const readFirstPragmaValue = (pragmaResult: unknown): unknown => {
  if (!Array.isArray(pragmaResult)) {
    return undefined;
  }

  const firstRow = pragmaResult.at(0);
  if (typeof firstRow !== 'object' || firstRow === null) {
    return undefined;
  }

  return Object.values(firstRow).at(0);
};

/**
 * Verifies that a database is readable through SQLCipher with the supplied key.
 *
 * @param databaseFilePath Database file path.
 * @param databaseKey SQLCipher database key.
 * @returns Verification facts used by migration parity checks.
 */
export const verifySqlCipherDatabase = (databaseFilePath: string, databaseKey: string): SqlCipherVerification => {
  const SqlCipherDriver = resolveSqlCipherDriver();
  const database = new SqlCipherDriver(databaseFilePath);

  try {
    const cipher = readFirstPragmaValue(database.pragma("cipher = 'sqlcipher'"));
    if (cipher !== 'sqlcipher') {
      throw new Error('Loaded SQLite native binding does not expose SQLCipher codec support.');
    }

    const keyResult = readFirstPragmaValue(database.pragma(`key = '${escapeSqliteLiteral(databaseKey)}'`));
    if (keyResult !== 'ok') {
      throw new Error('SQLCipher native driver rejected the database key configuration.');
    }
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    const tableCount = readTableCount(
      database.prepare("SELECT count(*) AS tableCount FROM sqlite_master WHERE type = 'table'").get(),
    );
    const integrityRow = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    if (!Object.values(integrityRow).some((value) => value === 'ok')) {
      throw new Error('SQLCipher integrity_check did not return ok.');
    }

    return { tableCount };
  } finally {
    database.close();
  }
};

/**
 * Removes SQLite sidecar files after a successful checkpoint or abandoned migration.
 *
 * @param databaseFilePath Base database path.
 * @returns Promise that resolves after best-effort sidecar cleanup.
 */
const removeSqliteSidecars = async (databaseFilePath: string): Promise<void> => {
  await Promise.all([
    rm(`${databaseFilePath}-journal`, { force: true }),
    rm(`${databaseFilePath}-shm`, { force: true }),
    rm(`${databaseFilePath}-wal`, { force: true }),
  ]);
};

/**
 * Removes one database artifact and all of its SQLite sidecars.
 *
 * @param databaseFilePath Artifact database path.
 * @returns Promise that resolves after cleanup.
 */
const removeDatabaseArtifact = async (databaseFilePath: string): Promise<void> => {
  await removeSqliteSidecars(databaseFilePath);
  await rm(databaseFilePath, { force: true });
};

/**
 * Builds deterministic migration artifact paths beside the protected database.
 *
 * @param databaseFilePath Primary database path.
 * @returns Temporary encrypted and plaintext backup paths.
 */
const getSqlCipherMigrationPaths = (databaseFilePath: string): SqlCipherMigrationPaths => {
  return {
    encryptedTempPath: `${databaseFilePath}${SQLCIPHER_TEMP_SUFFIX}`,
    plaintextBackupPath: `${databaseFilePath}${PLAINTEXT_BACKUP_SUFFIX}`,
  };
};

/**
 * Recovers the only two non-atomic rename windows in the migration replacement.
 *
 * @param databaseFilePath Primary database path.
 * @param databaseKey SQLCipher database key.
 * @returns Promise that resolves after recovery or stale-artifact cleanup.
 */
const recoverInterruptedSqlCipherMigration = async (databaseFilePath: string, databaseKey: string): Promise<void> => {
  const { encryptedTempPath, plaintextBackupPath } = getSqlCipherMigrationPaths(databaseFilePath);
  const databaseExists = await fileExists(databaseFilePath);
  const encryptedTempExists = await fileExists(encryptedTempPath);
  const plaintextBackupExists = await fileExists(plaintextBackupPath);

  if (databaseExists) {
    const databaseStats = await stat(databaseFilePath);
    if (databaseStats.size === 0 && (encryptedTempExists || plaintextBackupExists)) {
      await removeDatabaseArtifact(databaseFilePath);
      console.warn('[db:init] Removed an empty interrupted-migration target before artifact recovery.');
      await recoverInterruptedSqlCipherMigration(databaseFilePath, databaseKey);
      return;
    }

    if (await isPlaintextSqliteDatabase(databaseFilePath)) {
      await removeDatabaseArtifact(encryptedTempPath);
      await removeDatabaseArtifact(plaintextBackupPath);
      return;
    }

    if (!encryptedTempExists && !plaintextBackupExists) {
      return;
    }

    verifySqlCipherDatabase(databaseFilePath, databaseKey);
    await removeDatabaseArtifact(encryptedTempPath);
    await removeDatabaseArtifact(plaintextBackupPath);
    return;
  }

  if (encryptedTempExists) {
    try {
      verifySqlCipherDatabase(encryptedTempPath, databaseKey);
    } catch (error: unknown) {
      throw new Error(
        'Interrupted SQLCipher migration temp could not be verified. Preserving migration artifacts for recovery.',
        { cause: error },
      );
    }

    await rename(encryptedTempPath, databaseFilePath);
    await removeSqliteSidecars(encryptedTempPath);
    await removeDatabaseArtifact(plaintextBackupPath);
    console.warn('[db:init] Recovered encrypted database from an interrupted SQLCipher migration.');
    return;
  }

  if (plaintextBackupExists) {
    await rename(plaintextBackupPath, databaseFilePath);
    await removeSqliteSidecars(plaintextBackupPath);
    console.warn('[db:init] Restored plaintext database after an interrupted SQLCipher migration.');
  }
};

/**
 * Checkpoints a plaintext SQLite database before copying it for encryption.
 *
 * @param databaseFilePath Plaintext source database.
 * @returns Source table count used to validate copy parity.
 */
const checkpointPlaintextDatabase = (databaseFilePath: string): number => {
  const SqlCipherDriver = resolveSqlCipherDriver();
  const sourceDatabase = new SqlCipherDriver(databaseFilePath);

  try {
    sourceDatabase.pragma('wal_checkpoint(FULL)');
    sourceDatabase.pragma('journal_mode = DELETE');
    return readTableCount(
      sourceDatabase.prepare("SELECT count(*) AS tableCount FROM sqlite_master WHERE type = 'table'").get(),
    );
  } finally {
    sourceDatabase.close();
  }
};

/**
 * Copies a checkpointed plaintext database and encrypts only the copy in place.
 *
 * SQLite3 Multiple Ciphers supports `rekey` for a plaintext connection, which
 * keeps the authoritative source untouched until the encrypted copy verifies.
 *
 * @param databaseFilePath Plaintext source database.
 * @param encryptedTempPath Destination SQLCipher file.
 * @param databaseKey SQLCipher database key.
 * @returns Source table count used to validate copy parity.
 */
const encryptPlaintextDatabaseCopy = async (
  databaseFilePath: string,
  encryptedTempPath: string,
  databaseKey: string,
): Promise<number> => {
  const sourceTableCount = checkpointPlaintextDatabase(databaseFilePath);
  await copyFile(databaseFilePath, encryptedTempPath, fsConstants.COPYFILE_EXCL);

  const SqlCipherDriver = resolveSqlCipherDriver();
  const destinationDatabase = new SqlCipherDriver(encryptedTempPath);
  try {
    destinationDatabase.pragma("cipher = 'sqlcipher'");
    destinationDatabase.pragma(`rekey = '${escapeSqliteLiteral(databaseKey)}'`);
    destinationDatabase.prepare('SELECT count(*) AS tableCount FROM sqlite_master').get();
  } finally {
    destinationDatabase.close();
  }

  return sourceTableCount;
};

/**
 * Migrates a valid legacy plaintext database to SQLCipher exactly once.
 *
 * The source remains authoritative until the encrypted copy passes key, integrity,
 * and schema-count verification. Fixed backup/temp names make interrupted rename
 * windows recoverable on the next startup.
 *
 * @param databaseFilePath Primary database path.
 * @param databaseKey SQLCipher database key.
 * @returns True when a plaintext database was migrated.
 */
export const migratePlaintextDatabaseToSqlCipher = async (
  databaseFilePath: string,
  databaseKey: string,
): Promise<boolean> => {
  await recoverInterruptedSqlCipherMigration(databaseFilePath, databaseKey);
  if (!(await isPlaintextSqliteDatabase(databaseFilePath))) {
    return false;
  }

  const { encryptedTempPath, plaintextBackupPath } = getSqlCipherMigrationPaths(databaseFilePath);
  await removeDatabaseArtifact(encryptedTempPath);
  await removeDatabaseArtifact(plaintextBackupPath);

  let sourceTableCount: number;
  try {
    sourceTableCount = await encryptPlaintextDatabaseCopy(databaseFilePath, encryptedTempPath, databaseKey);
  } catch (error: unknown) {
    await removeDatabaseArtifact(encryptedTempPath);
    throw error;
  }
  const encryptedVerification = verifySqlCipherDatabase(encryptedTempPath, databaseKey);
  if (sourceTableCount !== encryptedVerification.tableCount) {
    await removeDatabaseArtifact(encryptedTempPath);
    throw new Error(
      `SQLCipher copy table-count mismatch: source=${sourceTableCount}, encrypted=${encryptedVerification.tableCount}.`,
    );
  }

  await removeSqliteSidecars(databaseFilePath);
  await rename(databaseFilePath, plaintextBackupPath);
  try {
    await rename(encryptedTempPath, databaseFilePath);
    verifySqlCipherDatabase(databaseFilePath, databaseKey);
  } catch (error: unknown) {
    await removeDatabaseArtifact(databaseFilePath);
    await rename(plaintextBackupPath, databaseFilePath).catch((restoreError: unknown) => {
      throw new Error('SQLCipher replacement failed and the plaintext backup could not be restored.', {
        cause: restoreError,
      });
    });
    throw new Error('SQLCipher replacement failed; restored the original plaintext database.', { cause: error });
  }

  await removeDatabaseArtifact(plaintextBackupPath);
  await removeSqliteSidecars(encryptedTempPath);
  console.log('[db:init] Migrated legacy plaintext SQLite database to SQLCipher.');
  return true;
};

/**
 * Verifies that a persisted database no longer exposes the plaintext SQLite header.
 *
 * @param databaseFilePath Database file path.
 * @returns Promise that resolves only for a non-empty encrypted file.
 */
export const assertEncryptedDatabaseFile = async (databaseFilePath: string): Promise<void> => {
  const databaseStats = await stat(databaseFilePath);
  if (databaseStats.size < SQLITE_PLAINTEXT_HEADER.length) {
    throw new Error('SQLCipher database file remained empty after schema initialization.');
  }
  if (await isPlaintextSqliteDatabase(databaseFilePath)) {
    throw new Error('Database initialization produced a plaintext SQLite file.');
  }
};

/**
 * Converts an accidentally encrypted development profile back to plaintext.
 *
 * @param databaseFilePath Development database path.
 * @param databaseKey Development SQLCipher key.
 * @returns Void.
 */
export const ensureDevelopmentPlaintextDatabase = (databaseFilePath: string, databaseKey: string): void => {
  let SqlCipherDriver: SqlCipherDatabaseConstructor;
  try {
    SqlCipherDriver = resolveSqlCipherDriver();
  } catch (error: unknown) {
    console.warn('[db:init] SQLCipher native addon is unavailable in development runtime.', error);
    return;
  }

  const database = new SqlCipherDriver(databaseFilePath);
  try {
    database.pragma('wal_checkpoint(FULL)');
    database.pragma('journal_mode = DELETE');
    database.pragma("cipher = 'sqlcipher'");
    database.pragma(`key = '${escapeSqliteLiteral(databaseKey)}'`);
    database.prepare('SELECT count(*) AS tableCount FROM sqlite_master').get();
    database.pragma("rekey = ''");
    console.warn('[db:init] Development compatibility decrypted an SQLCipher database for Prisma SQLite.');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('file is not a database')) {
      throw error;
    }
  } finally {
    database.close();
  }
};

/**
 * Overrides the cached SQLCipher driver for focused failure tests.
 *
 * @param driver SQLCipher constructor, null to simulate absence, or undefined to reset lazy resolution.
 * @returns Void.
 */
const setCachedSqlCipherDriverForTesting = (driver: SqlCipherDatabaseConstructor | null | undefined): void => {
  cachedSqlCipherDriver = driver;
};

/**
 * Focused test hooks for SQLCipher failure and migration fixtures.
 */
export const __sqlCipherTesting = {
  isPlaintextSqliteDatabase,
  recoverInterruptedSqlCipherMigration,
  resolveSqlCipherNativeBindingPath,
  setCachedSqlCipherDriverForTesting,
} as const;
