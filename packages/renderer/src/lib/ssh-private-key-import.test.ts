import assert from 'node:assert/strict';
import test from 'node:test';

import { derivePrivateKeyNameFromFileName } from './ssh-private-key-import.ts';

test('private key import derives a default name without the final extension', () => {
  assert.equal(derivePrivateKeyNameFromFileName('id_rsa.pem'), 'id_rsa');
  assert.equal(derivePrivateKeyNameFromFileName('jump.host.key'), 'jump.host');
});

test('private key import keeps names without removable extensions', () => {
  assert.equal(derivePrivateKeyNameFromFileName('id_ed25519'), 'id_ed25519');
  assert.equal(derivePrivateKeyNameFromFileName('.ssh_private_key'), '.ssh_private_key');
});

test('private key import trims surrounding whitespace before deriving the name', () => {
  assert.equal(derivePrivateKeyNameFromFileName('  production.ppk  '), 'production');
});
