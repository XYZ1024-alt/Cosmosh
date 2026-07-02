import type { components } from '@cosmosh/api-contract';

import { pickRandomEntityVisual } from './entity-visuals';
import {
  applySubmittedCredentialsToCache as applySubmittedServerCredentialsToCache,
  type CredentialRequirementMode,
  deriveCredentialMode,
  mapCredentialSnapshotToCache as mapServerCredentialSnapshotToCache,
  type ServerCredentialCache,
} from './ssh-server-editor-shared';

export type SshAuthType = components['schemas']['SshAuthType'];
export type SshKeychainListItem = components['schemas']['SshKeychainListItem'];

export type KeychainFormState = {
  name: string;
  iconKey: string;
  colorKey: string;
  authType: SshAuthType;
  password: string;
  privateKey: string;
  privateKeyPassphrase: string;
  folderId: string;
  tagIds: string[];
  note: string;
};

export type KeychainEditorInitialFormState = Partial<KeychainFormState>;
export type KeychainCredentialCache = ServerCredentialCache;

export type KeychainEditorCredentialMode = CredentialRequirementMode;

/**
 * Normalizes a keychain credential snapshot from backend responses.
 *
 * @param snapshot Backend credential snapshot.
 * @returns Normalized credential cache shape used by the editor state.
 */
export const mapCredentialSnapshotToCache = mapServerCredentialSnapshotToCache;

/**
 * Applies submitted credential fields to the local cache while preserving existing values
 * for fields intentionally omitted from update payloads.
 *
 * @param previousCredentials The last cached credentials for the keychain.
 * @param submittedPayload The credential fields sent to the backend.
 * @returns The next cache snapshot that matches submitted intent.
 */
export const applySubmittedCredentialsToCache = applySubmittedServerCredentialsToCache;

export const createInitialKeychainFormState = (): KeychainFormState => {
  const visual = pickRandomEntityVisual('server', `${Date.now()}:${Math.random()}`);

  return {
    name: '',
    iconKey: visual.iconKey,
    colorKey: visual.colorKey,
    authType: 'password',
    password: '',
    privateKey: '',
    privateKeyPassphrase: '',
    folderId: '',
    tagIds: [],
    note: '',
  };
};

export const applyInitialKeychainEditorFormState = (
  initialFormState?: KeychainEditorInitialFormState,
): KeychainFormState => {
  const baseFormState = createInitialKeychainFormState();
  if (!initialFormState) {
    return baseFormState;
  }

  return {
    ...baseFormState,
    ...initialFormState,
    tagIds: initialFormState.tagIds ? [...initialFormState.tagIds] : baseFormState.tagIds,
  };
};

export const mapKeychainToFormState = (keychain: SshKeychainListItem): KeychainFormState => ({
  name: keychain.name,
  iconKey: keychain.iconKey,
  colorKey: keychain.colorKey,
  authType: keychain.authType,
  password: '',
  privateKey: '',
  privateKeyPassphrase: '',
  folderId: keychain.folder?.id ?? '',
  tagIds: (keychain.tags ?? []).map((tag) => tag.id),
  note: keychain.note ?? '',
});

/**
 * Merges a refreshed keychain snapshot into current form state while preserving edited fields.
 *
 * @param currentFormState The form state currently shown in the editor.
 * @param nextFormState The latest state derived from backend data.
 * @param dirtyFields The field keys edited locally since the current keychain was loaded.
 * @returns A merged form state that preserves unsaved local edits.
 */
export const mergeKeychainFormStatePreservingDirtyFields = (
  currentFormState: KeychainFormState,
  nextFormState: KeychainFormState,
  dirtyFields: ReadonlySet<keyof KeychainFormState>,
): KeychainFormState => {
  if (dirtyFields.size === 0) {
    return nextFormState;
  }

  const mergedFormState: KeychainFormState = { ...currentFormState };
  const mutableFormState = mergedFormState as Record<
    keyof KeychainFormState,
    KeychainFormState[keyof KeychainFormState]
  >;

  (Object.keys(nextFormState) as Array<keyof KeychainFormState>).forEach((fieldKey) => {
    if (!dirtyFields.has(fieldKey)) {
      mutableFormState[fieldKey] = nextFormState[fieldKey];
    }
  });

  return mergedFormState;
};

/**
 * Derives auth-dependent requirement flags from selected auth type.
 *
 * @param authType Selected auth type.
 * @returns Requirement flags for password/private-key fields.
 */
export const deriveKeychainEditorCredentialMode = (authType: SshAuthType): KeychainEditorCredentialMode => {
  return deriveCredentialMode(authType);
};

export const filterSharedKeychains = (keychains: SshKeychainListItem[]): SshKeychainListItem[] => {
  return keychains.filter((item) => item.visibility === 'shared');
};

export const upsertKeychainListItem = (
  keychains: SshKeychainListItem[],
  nextKeychain: SshKeychainListItem,
): SshKeychainListItem[] => {
  const index = keychains.findIndex((item) => item.id === nextKeychain.id);
  if (index < 0) {
    return [...keychains, nextKeychain];
  }

  const nextKeychains = [...keychains];
  nextKeychains[index] = nextKeychain;
  return nextKeychains;
};

/**
 * Merges a backend keychain snapshot with locally saved keychains that may not be visible
 * in an older in-flight list response yet.
 *
 * @param keychains Backend keychain snapshot used as the base list.
 * @param localKeychains Keychains saved by the current renderer flow.
 * @returns Keychain list with local saves applied after the backend snapshot.
 */
export const mergeKeychainListItems = (
  keychains: SshKeychainListItem[],
  localKeychains: SshKeychainListItem[],
): SshKeychainListItem[] => {
  return localKeychains.reduce<SshKeychainListItem[]>(
    (nextKeychains, keychain) => upsertKeychainListItem(nextKeychains, keychain),
    keychains,
  );
};

export const getKeychainSortTimestamp = (keychain: SshKeychainListItem): number => {
  return new Date(keychain.createdAt).getTime();
};
