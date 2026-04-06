import type { components } from '@cosmosh/api-contract';

import { createSshKeychain, updateSshKeychain } from './backend';
import { isEntityColorKey } from './entity-visuals';
import type { KeychainFormState, SshAuthType, SshKeychainListItem } from './ssh-keychain-editor-shared';
import { createServerEditorTag } from './ssh-server-editor-actions';

type SshTag = components['schemas']['SshTag'];

type CreateKeychainEditorTagParams = {
  name: string;
  tags: SshTag[];
  onTagCreated: (tag: SshTag) => void;
  onError: (message: string) => void;
  createTagFailedMessage: string;
};

export type KeychainCredentialSubmission = {
  authType: SshAuthType;
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
};

type SaveKeychainFromEditorParams = {
  keychainId: string | null;
  activeKeychain: SshKeychainListItem | null;
  formState: KeychainFormState;
  requiresPassword: boolean;
  requiresPrivateKey: boolean;
  onWarning: (message: string) => void;
  validationRequiredFieldsMessage: string;
  validationPasswordRequiredMessage: string;
  validationPrivateKeyRequiredMessage: string;
};

export type SaveKeychainFromEditorResult = {
  savedKeychain: SshKeychainListItem;
  submittedCredentialPayload: KeychainCredentialSubmission;
};

/**
 * Resolves a tag for keychain editor by reusing the server editor tag creation flow.
 *
 * @param params Tag creation parameters.
 * @returns Existing/created tag, or null if creation is aborted/failed.
 */
export const createKeychainEditorTag = async (params: CreateKeychainEditorTagParams): Promise<SshTag | null> => {
  return createServerEditorTag(params);
};

/**
 * Persists keychain editor form state with validation shared by page editor and dialog editor.
 *
 * @param params Save parameters.
 * @param params.keychainId Keychain id in edit mode, null in create mode.
 * @param params.activeKeychain Active keychain metadata used for credential placeholder validation.
 * @param params.formState Current keychain form state.
 * @param params.requiresPassword Whether password is required by auth type.
 * @param params.requiresPrivateKey Whether private key is required by auth type.
 * @param params.onWarning Warning notifier callback.
 * @param params.validationRequiredFieldsMessage Localized required-fields warning.
 * @param params.validationPasswordRequiredMessage Localized password-required warning.
 * @param params.validationPrivateKeyRequiredMessage Localized private-key-required warning.
 * @returns Save result containing persisted keychain and submitted credential payload, or null if validation blocks save.
 */
export const saveKeychainFromEditor = async ({
  keychainId,
  activeKeychain,
  formState,
  requiresPassword,
  requiresPrivateKey,
  onWarning,
  validationRequiredFieldsMessage,
  validationPasswordRequiredMessage,
  validationPrivateKeyRequiredMessage,
}: SaveKeychainFromEditorParams): Promise<SaveKeychainFromEditorResult | null> => {
  if (!formState.name.trim()) {
    onWarning(validationRequiredFieldsMessage);
    return null;
  }

  if (requiresPassword && !formState.password.trim() && !activeKeychain?.hasPassword) {
    onWarning(validationPasswordRequiredMessage);
    return null;
  }

  if (requiresPrivateKey && !formState.privateKey.trim() && !activeKeychain?.hasPrivateKey) {
    onWarning(validationPrivateKeyRequiredMessage);
    return null;
  }

  const payload = {
    name: formState.name.trim(),
    iconKey: formState.iconKey,
    colorKey: isEntityColorKey(formState.colorKey) ? formState.colorKey : undefined,
    authType: formState.authType,
    visibility: 'shared' as const,
    password: formState.password.trim() || undefined,
    privateKey: formState.privateKey.trim() || undefined,
    privateKeyPassphrase: formState.privateKeyPassphrase.trim() || undefined,
    folderId: formState.folderId || undefined,
    tagIds: formState.tagIds,
    note: formState.note.trim() || undefined,
  };

  const submittedCredentialPayload: KeychainCredentialSubmission = {
    authType: payload.authType,
    password: payload.password,
    privateKey: payload.privateKey,
    privateKeyPassphrase: payload.privateKeyPassphrase,
  };

  const savedKeychain = keychainId
    ? (await updateSshKeychain(keychainId, payload)).data.item
    : (await createSshKeychain(payload)).data.item;

  return {
    savedKeychain,
    submittedCredentialPayload,
  };
};
