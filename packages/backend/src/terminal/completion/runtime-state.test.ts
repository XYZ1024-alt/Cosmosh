import assert from 'node:assert/strict';
import test from 'node:test';

import {
  replayRemoteCompletionCwdCommands,
  resolveRemotePromptCwd,
  updateRemoteCompletionCwd,
} from './runtime-state.js';

test('remote cwd replay applies early cd commands once base cwd is known', () => {
  const replayedCwd = replayRemoteCompletionCwdCommands('/home/dev', ['cd project', 'cat package.json'], {
    homeDirectory: '/home/dev',
  });

  assert.equal(replayedCwd, '/home/dev/project');
});

test('remote cwd update resolves home-relative cd targets', () => {
  assert.equal(
    updateRemoteCompletionCwd('/var/log', 'cd ~/workspace', {
      homeDirectory: '/home/dev',
    }),
    '/home/dev/workspace',
  );
});

test('remote prompt cwd resolves home-relative prompt fragments when home is known', () => {
  assert.equal(resolveRemotePromptCwd('dev@host:~/workspace$ ', '/tmp', '/home/dev'), '/home/dev/workspace');
});
