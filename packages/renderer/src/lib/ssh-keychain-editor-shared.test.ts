import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKeychainMetadataUpdatePayload,
  mergeKeychainListItems,
  type SshKeychainListItem,
} from './ssh-keychain-editor-shared.ts';

/**
 * Creates a keychain item with stable defaults for list-merge tests.
 *
 * @param overrides Keychain fields to override for a specific test fixture.
 * @returns A complete keychain list item fixture.
 */
const createKeychainFixture = (overrides: Partial<SshKeychainListItem>): SshKeychainListItem => ({
  id: 'keychain-a',
  name: 'Keychain A',
  iconKey: 'key-round',
  colorKey: 'blue',
  authType: 'password',
  visibility: 'shared',
  hasPassword: true,
  hasPrivateKey: false,
  tags: [],
  createdAt: '2026-06-29T00:00:00.000Z',
  updatedAt: '2026-06-29T00:00:00.000Z',
  ...overrides,
});

test('keychain list merge keeps locally saved items missing from a stale backend snapshot', () => {
  const backendKeychain = createKeychainFixture({ id: 'keychain-a', name: 'Backend Keychain' });
  const savedKeychain = createKeychainFixture({ id: 'keychain-b', name: 'Saved Keychain' });

  const mergedKeychains = mergeKeychainListItems([backendKeychain], [savedKeychain]);

  assert.deepEqual(
    mergedKeychains.map((keychain) => keychain.id),
    ['keychain-a', 'keychain-b'],
  );
});

test('keychain list merge lets locally saved items replace older backend copies', () => {
  const staleBackendKeychain = createKeychainFixture({ id: 'keychain-a', name: 'Stale Backend Name' });
  const savedKeychain = createKeychainFixture({ id: 'keychain-a', name: 'Saved Name' });

  const mergedKeychains = mergeKeychainListItems([staleBackendKeychain], [savedKeychain]);

  assert.equal(mergedKeychains.length, 1);
  assert.equal(mergedKeychains[0]?.name, 'Saved Name');
});

test('keychain metadata updates preserve metadata while excluding credential fields', () => {
  const keychain = createKeychainFixture({
    name: 'Production Keychain',
    iconKey: 'KeyRound',
    colorKey: 'emerald',
    authType: 'both',
    visibility: 'shared',
    folder: {
      id: 'folder-a',
      name: 'Production',
      iconKey: 'Folder',
      colorKey: 'blue',
      createdAt: '2026-06-29T00:00:00.000Z',
      updatedAt: '2026-06-29T00:00:00.000Z',
    },
    tags: [
      {
        id: 'tag-old',
        name: 'Old Tag',
        createdAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:00:00.000Z',
      },
    ],
    note: '  Restricted access  ',
  });

  const payload = buildKeychainMetadataUpdatePayload(keychain, ['tag-new']);

  assert.deepEqual(payload, {
    name: 'Production Keychain',
    iconKey: 'KeyRound',
    colorKey: 'emerald',
    authType: 'both',
    visibility: 'shared',
    folderId: 'folder-a',
    tagIds: ['tag-new'],
    note: 'Restricted access',
  });
  assert.equal('password' in payload, false);
  assert.equal('privateKey' in payload, false);
  assert.equal('privateKeyPassphrase' in payload, false);
});
