import assert from 'node:assert/strict';
import test from 'node:test';

import type React from 'react';

import { composeDialogExitAnimationHandler } from './dialog-lifecycle.ts';

test('dialog exit handler preserves the consumer handler and reports a completed close animation', () => {
  const calls: string[] = [];
  const content = { dataset: { state: 'closed' } };
  const event = { target: content, currentTarget: content } as unknown as React.AnimationEvent<HTMLDivElement>;
  const handler = composeDialogExitAnimationHandler(
    () => calls.push('animation'),
    () => calls.push('exit'),
  );

  handler(event);

  assert.deepEqual(calls, ['animation', 'exit']);
});

test('dialog exit handler ignores open-state and bubbled child animations', () => {
  let exitCount = 0;
  const openContent = { dataset: { state: 'open' } };
  const closedContent = { dataset: { state: 'closed' } };
  const handler = composeDialogExitAnimationHandler(undefined, () => {
    exitCount += 1;
  });

  handler({ target: openContent, currentTarget: openContent } as unknown as React.AnimationEvent<HTMLDivElement>);
  handler({ target: {}, currentTarget: closedContent } as unknown as React.AnimationEvent<HTMLDivElement>);

  assert.equal(exitCount, 0);
});
