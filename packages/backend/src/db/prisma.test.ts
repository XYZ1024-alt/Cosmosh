import assert from 'node:assert/strict';
import test from 'node:test';

import { __dbPrismaTesting } from './prisma.js';

/**
 * Restores or clears one process environment variable.
 *
 * @param key Environment variable name.
 * @param value Previous environment variable value.
 * @returns void.
 */
const restoreEnvValue = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

/**
 * Builds a minimal migration SQL client backed by in-memory SQLite column metadata.
 *
 * @param tableColumns Mutable table-column map used by the mock.
 * @param executedStatements Captures SQL statements executed by the helper.
 * @returns Minimal client shape required by migration helper tests.
 */
const createMockMigrationSqlClient = (
  tableColumns: Map<string, Set<string>>,
  executedStatements: string[],
): Parameters<typeof __dbPrismaTesting.applyPrismaAddColumnMigrationStatements>[0] => {
  return {
    $executeRawUnsafe: async (statement: string): Promise<unknown> => {
      executedStatements.push(statement);
      const parsedStatements = __dbPrismaTesting.parsePrismaAddColumnMigrationStatements([statement]);
      assert.ok(parsedStatements);

      const parsedStatement = parsedStatements[0];
      tableColumns.get(parsedStatement.tableName)?.add(parsedStatement.columnName);
      return 0;
    },
    $queryRawUnsafe: async <T = unknown>(query: string): Promise<T> => {
      const match = query.match(/^PRAGMA table_info\("((?:[^"]|"")*)"\);$/u);
      assert.ok(match);

      const tableName = match[1].replace(/""/g, '"');
      return Array.from(tableColumns.get(tableName) ?? []).map((name) => ({ name })) as T;
    },
  };
};

/**
 * Minimal SQLCipher fixture that simulates a plaintext SQLite file opened with a SQLCipher key.
 */
class PlaintextDatabaseSqlCipherDriver {
  /**
   * Accepts SQLCipher pragmas without side effects.
   *
   * @returns void.
   */
  public pragma(): void {
    return undefined;
  }

  /**
   * Simulates SQLCipher rejecting an existing plaintext SQLite file.
   *
   * @returns Statement object whose `get` call throws the sqlite compatibility error.
   */
  public prepare(): { get: () => unknown } {
    return {
      get: (): unknown => {
        throw new Error('file is not a database');
      },
    };
  }

  /**
   * Matches the SQLCipher driver close contract.
   *
   * @returns void.
   */
  public close(): void {
    return undefined;
  }
}

test('runtime ADD COLUMN migration skips columns that already exist', async () => {
  const statements = __dbPrismaTesting.parsePrismaAddColumnMigrationStatements([
    'ALTER TABLE "SshServer"\nADD COLUMN "disableCharacterWidthCompatibilityMode" BOOLEAN NOT NULL DEFAULT false',
  ]);
  assert.ok(statements);

  const executedStatements: string[] = [];
  const tableColumns = new Map<string, Set<string>>([
    ['SshServer', new Set(['disableCharacterWidthCompatibilityMode'])],
  ]);

  const originalConsoleLog = console.log;
  console.log = () => undefined;

  try {
    await __dbPrismaTesting.applyPrismaAddColumnMigrationStatements(
      createMockMigrationSqlClient(tableColumns, executedStatements),
      statements,
      '20260604000200_character_width_compatibility',
    );
  } finally {
    console.log = originalConsoleLog;
  }

  assert.deepEqual(executedStatements, []);
});

test('runtime ADD COLUMN migration applies columns that are still missing', async () => {
  const statements = __dbPrismaTesting.parsePrismaAddColumnMigrationStatements([
    'ALTER TABLE "SshServer"\nADD COLUMN "disableCharacterWidthCompatibilityMode" BOOLEAN NOT NULL DEFAULT false',
  ]);
  assert.ok(statements);

  const executedStatements: string[] = [];
  const tableColumns = new Map<string, Set<string>>([['SshServer', new Set()]]);

  await __dbPrismaTesting.applyPrismaAddColumnMigrationStatements(
    createMockMigrationSqlClient(tableColumns, executedStatements),
    statements,
    '20260604000200_character_width_compatibility',
  );

  assert.deepEqual(executedStatements, [statements[0].statement]);
  assert.equal(tableColumns.get('SshServer')?.has('disableCharacterWidthCompatibilityMode'), true);
});

test('production SQLCipher bootstrap rejects a missing native driver', () => {
  const originalAppEnv = process.env.COSMOSH_APP_ENV;
  const originalNodeEnv = process.env.NODE_ENV;

  process.env.COSMOSH_APP_ENV = 'production';
  process.env.NODE_ENV = 'production';
  __dbPrismaTesting.setCachedSqlCipherDriverForTesting(null);

  try {
    assert.throws(
      () => __dbPrismaTesting.bootstrapSqlCipher('cosmosh.db', 'test-key'),
      /SQLCipher native driver is unavailable in production runtime/u,
    );
  } finally {
    restoreEnvValue('COSMOSH_APP_ENV', originalAppEnv);
    restoreEnvValue('NODE_ENV', originalNodeEnv);
    __dbPrismaTesting.setCachedSqlCipherDriverForTesting(undefined);
  }
});

test('development SQLCipher bootstrap keeps plaintext compatibility when the native driver is missing', () => {
  const originalAppEnv = process.env.COSMOSH_APP_ENV;
  const originalNodeEnv = process.env.NODE_ENV;

  process.env.COSMOSH_APP_ENV = 'development';
  process.env.NODE_ENV = 'development';
  __dbPrismaTesting.setCachedSqlCipherDriverForTesting(null);

  try {
    assert.equal(__dbPrismaTesting.bootstrapSqlCipher('cosmosh.db', 'test-key'), false);
  } finally {
    restoreEnvValue('COSMOSH_APP_ENV', originalAppEnv);
    restoreEnvValue('NODE_ENV', originalNodeEnv);
    __dbPrismaTesting.setCachedSqlCipherDriverForTesting(undefined);
  }
});

test('production SQLCipher bootstrap rejects plaintext sqlite compatibility fallback', () => {
  const originalAppEnv = process.env.COSMOSH_APP_ENV;
  const originalNodeEnv = process.env.NODE_ENV;

  process.env.COSMOSH_APP_ENV = 'production';
  process.env.NODE_ENV = 'production';
  __dbPrismaTesting.setCachedSqlCipherDriverForTesting(PlaintextDatabaseSqlCipherDriver);

  try {
    assert.throws(() => __dbPrismaTesting.bootstrapSqlCipher('cosmosh.db', 'test-key'), /file is not a database/u);
  } finally {
    restoreEnvValue('COSMOSH_APP_ENV', originalAppEnv);
    restoreEnvValue('NODE_ENV', originalNodeEnv);
    __dbPrismaTesting.setCachedSqlCipherDriverForTesting(undefined);
  }
});
