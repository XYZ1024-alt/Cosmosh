import assert from 'node:assert/strict';
import test from 'node:test';

import { __dbPrismaTesting } from './prisma.js';

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
