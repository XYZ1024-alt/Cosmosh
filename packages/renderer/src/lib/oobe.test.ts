import assert from 'node:assert/strict';
import test from 'node:test';

import { isOobeCompleted, markOobeCompleted } from './oobe.ts';

/**
 * Creates a minimal in-memory storage implementation for OOBE marker tests.
 *
 * @returns Storage methods and the backing value accessor.
 */
const createMemoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

test('OOBE remains pending until completion is persisted', () => {
  const storage = createMemoryStorage();

  assert.equal(isOobeCompleted(storage), false);
  assert.equal(markOobeCompleted(storage), true);
  assert.equal(isOobeCompleted(storage), true);
});

test('OOBE storage failures keep the experience pending', () => {
  const storage = {
    getItem: () => {
      throw new Error('read failed');
    },
    setItem: () => {
      throw new Error('write failed');
    },
  };

  assert.equal(isOobeCompleted(storage), false);
  assert.equal(markOobeCompleted(storage), false);
});
