import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import type { PrismaClient as PrismaClientType } from '@prisma/client';
import prismaClientPackage from '@prisma/client';

import {
  __sqlCipherTesting,
  assertEncryptedDatabaseFile,
  migratePlaintextDatabaseToSqlCipher,
  PrismaSqlCipherAdapterFactory,
  verifySqlCipherDatabase,
} from './sqlcipher.js';

const { PrismaClient } = prismaClientPackage;
const require = createRequire(import.meta.url);
const temporaryDirectories: string[] = [];

/**
 * Minimal plaintext SQLite fixture surface.
 */
type PlaintextSqliteDatabase = {
  close: () => void;
  exec: (statement: string) => unknown;
};

/**
 * Constructor contract used to create a plaintext migration fixture.
 */
type PlaintextSqliteDatabaseConstructor = new (filePath: string) => PlaintextSqliteDatabase;

/**
 * Creates an isolated database path and tracks it for cleanup.
 *
 * @returns Absolute temporary database path.
 */
const createTemporaryDatabasePath = async (): Promise<string> => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'cosmosh-sqlcipher-test-'));
  temporaryDirectories.push(directoryPath);
  return path.join(directoryPath, 'cosmosh.db');
};

/**
 * Creates a Prisma client whose actual connection is SQLCipher-capable.
 *
 * @param databaseFilePath Database file path.
 * @param databaseKey SQLCipher key.
 * @returns Prisma client ready to connect.
 */
const createSqlCipherTestClient = (databaseFilePath: string, databaseKey: string): PrismaClientType => {
  const normalizedPath = databaseFilePath.split(path.sep).join('/');
  return new PrismaClient({
    adapter: new PrismaSqlCipherAdapterFactory(`file:${normalizedPath}`, databaseKey),
  });
};

/**
 * Creates and seeds the small table used by adapter lifecycle tests.
 *
 * @param client Connected Prisma client.
 * @param value Value to insert.
 * @returns Promise that resolves after the insert.
 */
const seedVerificationRecord = async (client: PrismaClientType, value: string): Promise<void> => {
  await client.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "SqlCipherVerification" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "value" TEXT NOT NULL);',
  );
  await client.$executeRawUnsafe('INSERT INTO "SqlCipherVerification" ("value") VALUES (?);', value);
};

afterEach(async () => {
  __sqlCipherTesting.setCachedSqlCipherDriverForTesting(undefined);
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => await rm(directoryPath, { recursive: true })),
  );
});

test('SQLCipher verification rejects an unavailable native driver', () => {
  __sqlCipherTesting.setCachedSqlCipherDriverForTesting(null);

  assert.throws(
    () => verifySqlCipherDatabase('unused-cosmosh.db', 'unused-key'),
    /SQLCipher native driver is unavailable/u,
  );
});

test('Prisma SQLCipher adapter persists encrypted data across reconnects', async () => {
  const databaseFilePath = await createTemporaryDatabasePath();
  const databaseKey = 'adapter-reconnect-key';
  const firstClient = createSqlCipherTestClient(databaseFilePath, databaseKey);

  try {
    await firstClient.$connect();
    await seedVerificationRecord(firstClient, 'first');
  } finally {
    await firstClient.$disconnect();
  }

  await assertEncryptedDatabaseFile(databaseFilePath);
  assert.notEqual((await readFile(databaseFilePath)).subarray(0, 16).toString('ascii'), 'SQLite format 3\0');

  const secondClient = createSqlCipherTestClient(databaseFilePath, databaseKey);
  try {
    await secondClient.$connect();
    const rows = await secondClient.$queryRawUnsafe<Array<{ value: string }>>(
      'SELECT "value" FROM "SqlCipherVerification" ORDER BY "id" ASC;',
    );
    assert.deepEqual(rows, [{ value: 'first' }]);
  } finally {
    await secondClient.$disconnect();
  }
});

test('Prisma SQLCipher adapter rejects an incorrect key', async () => {
  const databaseFilePath = await createTemporaryDatabasePath();
  const validClient = createSqlCipherTestClient(databaseFilePath, 'valid-key');
  try {
    await validClient.$connect();
    await seedVerificationRecord(validClient, 'protected');
  } finally {
    await validClient.$disconnect();
  }

  const invalidClient = createSqlCipherTestClient(databaseFilePath, 'invalid-key');
  await assert.rejects(async () => await invalidClient.$connect(), /Failed to configure Prisma SQLCipher adapter/u);
});

test('migration probe defers an encrypted wrong-key database to bootstrap validation', async () => {
  const databaseFilePath = await createTemporaryDatabasePath();
  const validClient = createSqlCipherTestClient(databaseFilePath, 'valid-bootstrap-key');
  try {
    await validClient.$connect();
    await seedVerificationRecord(validClient, 'protected');
  } finally {
    await validClient.$disconnect();
  }

  assert.equal(await migratePlaintextDatabaseToSqlCipher(databaseFilePath, 'wrong-bootstrap-key'), false);
  assert.throws(() => verifySqlCipherDatabase(databaseFilePath, 'wrong-bootstrap-key'));
});

test('plaintext migration preserves data and replaces the source with SQLCipher', async () => {
  const databaseFilePath = await createTemporaryDatabasePath();
  const databaseKey = 'migration-key';
  const SqliteDriver = require('better-sqlite3-multiple-ciphers') as PlaintextSqliteDatabaseConstructor;
  const plaintextDatabase = new SqliteDriver(databaseFilePath);
  try {
    plaintextDatabase.exec(
      'CREATE TABLE "MigrationRecord" ("id" INTEGER NOT NULL PRIMARY KEY, "value" TEXT NOT NULL);' +
        'INSERT INTO "MigrationRecord" ("id", "value") VALUES (1, \'preserved\');',
    );
  } finally {
    plaintextDatabase.close();
  }

  assert.equal((await readFile(databaseFilePath)).subarray(0, 16).toString('ascii'), 'SQLite format 3\0');
  assert.equal(await migratePlaintextDatabaseToSqlCipher(databaseFilePath, databaseKey), true);
  await assertEncryptedDatabaseFile(databaseFilePath);
  assert.equal(verifySqlCipherDatabase(databaseFilePath, databaseKey).tableCount >= 1, true);

  const client = createSqlCipherTestClient(databaseFilePath, databaseKey);
  try {
    await client.$connect();
    const rows = await client.$queryRawUnsafe<Array<{ value: string }>>('SELECT "value" FROM "MigrationRecord";');
    assert.deepEqual(rows, [{ value: 'preserved' }]);
  } finally {
    await client.$disconnect();
  }
});

test('interrupted migration recovery promotes a verified encrypted copy over an empty target', async () => {
  const databaseFilePath = await createTemporaryDatabasePath();
  const databaseKey = 'recovery-key';
  const encryptedTempPath = `${databaseFilePath}.sqlcipher-migration`;
  const plaintextBackupPath = `${databaseFilePath}.plaintext-backup`;
  const SqliteDriver = require('better-sqlite3-multiple-ciphers') as PlaintextSqliteDatabaseConstructor;
  const plaintextDatabase = new SqliteDriver(databaseFilePath);
  try {
    plaintextDatabase.exec('CREATE TABLE "OriginalRecord" ("value" TEXT NOT NULL);');
  } finally {
    plaintextDatabase.close();
  }
  await copyFile(databaseFilePath, plaintextBackupPath);

  const encryptedTempClient = createSqlCipherTestClient(encryptedTempPath, databaseKey);
  try {
    await encryptedTempClient.$connect();
    await seedVerificationRecord(encryptedTempClient, 'recovered');
  } finally {
    await encryptedTempClient.$disconnect();
  }
  await writeFile(databaseFilePath, Buffer.alloc(0));

  await __sqlCipherTesting.recoverInterruptedSqlCipherMigration(databaseFilePath, databaseKey);
  await assertEncryptedDatabaseFile(databaseFilePath);
  await assert.rejects(async () => await stat(encryptedTempPath), /ENOENT/u);
  await assert.rejects(async () => await stat(plaintextBackupPath), /ENOENT/u);

  const recoveredClient = createSqlCipherTestClient(databaseFilePath, databaseKey);
  try {
    await recoveredClient.$connect();
    const rows = await recoveredClient.$queryRawUnsafe<Array<{ value: string }>>(
      'SELECT "value" FROM "SqlCipherVerification";',
    );
    assert.deepEqual(rows, [{ value: 'recovered' }]);
  } finally {
    await recoveredClient.$disconnect();
  }
});

test('interrupted migration recovery preserves artifacts when the supplied key is incorrect', async () => {
  const databaseFilePath = await createTemporaryDatabasePath();
  const validDatabaseKey = 'valid-recovery-key';
  const encryptedTempPath = `${databaseFilePath}.sqlcipher-migration`;
  const plaintextBackupPath = `${databaseFilePath}.plaintext-backup`;
  const SqliteDriver = require('better-sqlite3-multiple-ciphers') as PlaintextSqliteDatabaseConstructor;
  const plaintextDatabase = new SqliteDriver(databaseFilePath);
  try {
    plaintextDatabase.exec('CREATE TABLE "OriginalRecord" ("value" TEXT NOT NULL);');
  } finally {
    plaintextDatabase.close();
  }
  await copyFile(databaseFilePath, plaintextBackupPath);

  const encryptedTempClient = createSqlCipherTestClient(encryptedTempPath, validDatabaseKey);
  try {
    await encryptedTempClient.$connect();
    await seedVerificationRecord(encryptedTempClient, 'recover-with-original-key');
  } finally {
    await encryptedTempClient.$disconnect();
  }
  await rm(databaseFilePath);

  await assert.rejects(
    async () =>
      await __sqlCipherTesting.recoverInterruptedSqlCipherMigration(databaseFilePath, 'incorrect-recovery-key'),
    /Preserving migration artifacts for recovery/u,
  );
  await assert.rejects(async () => await stat(databaseFilePath), /ENOENT/u);
  assert.equal((await stat(encryptedTempPath)).isFile(), true);
  assert.equal((await stat(plaintextBackupPath)).isFile(), true);
  assert.equal((await readFile(plaintextBackupPath)).subarray(0, 16).toString('ascii'), 'SQLite format 3\0');
  assert.throws(() => verifySqlCipherDatabase(encryptedTempPath, 'incorrect-recovery-key'));
  assert.equal(verifySqlCipherDatabase(encryptedTempPath, validDatabaseKey).tableCount >= 1, true);

  await __sqlCipherTesting.recoverInterruptedSqlCipherMigration(databaseFilePath, validDatabaseKey);
  await assertEncryptedDatabaseFile(databaseFilePath);
  await assert.rejects(async () => await stat(encryptedTempPath), /ENOENT/u);
  await assert.rejects(async () => await stat(plaintextBackupPath), /ENOENT/u);

  const recoveredClient = createSqlCipherTestClient(databaseFilePath, validDatabaseKey);
  try {
    await recoveredClient.$connect();
    const rows = await recoveredClient.$queryRawUnsafe<Array<{ value: string }>>(
      'SELECT "value" FROM "SqlCipherVerification";',
    );
    assert.deepEqual(rows, [{ value: 'recover-with-original-key' }]);
  } finally {
    await recoveredClient.$disconnect();
  }
});
