import assert from 'node:assert/strict';
import test from 'node:test';

import { createRemotePathProvider } from './path-providers.js';

test('remote path provider avoids non-portable basename flags and returns ranked entries', async () => {
  let capturedCommand = '';
  const provider = createRemotePathProvider({
    resolveCwd: async () => '/home/dev',
    executeCommand: async (command) => {
      capturedCommand = command;
      return 'F\tbeta.txt\nD\talpha\n';
    },
  });

  const entries = await provider({
    partialPath: '',
    directoriesOnly: false,
    fuzzyMatch: false,
    limit: 10,
  });

  assert.equal(capturedCommand.includes('basename --'), false);
  assert.ok(capturedCommand.includes('name=${p##*/}'));
  assert.deepEqual(entries, [
    {
      name: 'alpha/',
      kind: 'directory',
    },
    {
      name: 'beta.txt',
      kind: 'file',
    },
  ]);
});
