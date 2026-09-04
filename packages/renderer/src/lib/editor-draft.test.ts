import assert from 'node:assert/strict';
import test from 'node:test';

import { hasUnsavedEditorChanges } from './editor-draft';

type TestDraft = {
  name: string;
  enabled: boolean;
  tagIds: string[];
};

const initialDraft: TestDraft = {
  name: 'Production',
  enabled: true,
  tagIds: ['critical', 'linux'],
};

test('detects edited primitive and array fields', () => {
  assert.equal(
    hasUnsavedEditorChanges(initialDraft, { ...initialDraft, name: 'Staging' }, new Set<keyof TestDraft>(['name'])),
    true,
  );
  assert.equal(
    hasUnsavedEditorChanges(
      initialDraft,
      { ...initialDraft, tagIds: ['critical'] },
      new Set<keyof TestDraft>(['tagIds']),
    ),
    true,
  );
});

test('ignores hydrated fields that the user did not edit', () => {
  assert.equal(
    hasUnsavedEditorChanges(initialDraft, { ...initialDraft, enabled: false }, new Set<keyof TestDraft>(['name'])),
    false,
  );
});

test('does not report a field that was restored to its initial value', () => {
  assert.equal(hasUnsavedEditorChanges(initialDraft, { ...initialDraft }, new Set<keyof TestDraft>(['name'])), false);
  assert.equal(
    hasUnsavedEditorChanges(
      initialDraft,
      { ...initialDraft, tagIds: [...initialDraft.tagIds] },
      new Set<keyof TestDraft>(['tagIds']),
    ),
    false,
  );
});
