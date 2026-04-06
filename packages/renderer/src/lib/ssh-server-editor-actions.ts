import type { components } from '@cosmosh/api-contract';

import { createSshTag } from './backend';
import type { KeychainEditorInitialFormState } from './ssh-keychain-editor-shared';
import type { ServerEditorFormState } from './ssh-server-editor-shared';

type SshTag = components['schemas']['SshTag'];

type CreateServerEditorTagParams = {
  name: string;
  tags: SshTag[];
  onTagCreated: (tag: SshTag) => void;
  onError: (message: string) => void;
  createTagFailedMessage: string;
};

/**
 * Creates a tag by name only when it does not exist yet and returns the resolved tag.
 *
 * @param params Tag creation parameters.
 * @param params.name User-entered tag name.
 * @param params.tags Current known tags.
 * @param params.onTagCreated Callback to append a newly created tag.
 * @param params.onError Error notifier callback.
 * @param params.createTagFailedMessage Localized fallback error message.
 * @returns The existing/created tag, or null when creation is aborted/failed.
 */
export const createServerEditorTag = async ({
  name,
  tags,
  onTagCreated,
  onError,
  createTagFailedMessage,
}: CreateServerEditorTagParams): Promise<SshTag | null> => {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return null;
  }

  const existingTag = tags.find((tag) => tag.name.toLowerCase() === normalizedName.toLowerCase());
  if (existingTag) {
    return existingTag;
  }

  try {
    const createdResponse = await createSshTag({ name: normalizedName });
    const createdTag = createdResponse.data.item;
    onTagCreated(createdTag);
    return createdTag;
  } catch (error: unknown) {
    onError(error instanceof Error ? error.message : createTagFailedMessage);
    return null;
  }
};

type ImportPrivateKeyFromFileParams = {
  onPrivateKeyImported: (privateKey: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  importSuccessMessage: string;
  importFailedMessage: string;
};

/**
 * Imports a private key from file picker and applies it to editor state.
 *
 * @param params Import flow parameters.
 * @param params.onPrivateKeyImported Callback to write key content into form state.
 * @param params.onSuccess Success notifier callback.
 * @param params.onError Error notifier callback.
 * @param params.importSuccessMessage Localized success message.
 * @param params.importFailedMessage Localized failure message.
 * @returns Resolves when import handling is finished.
 */
export const importServerEditorPrivateKeyFromFile = async ({
  onPrivateKeyImported,
  onSuccess,
  onError,
  importSuccessMessage,
  importFailedMessage,
}: ImportPrivateKeyFromFileParams): Promise<void> => {
  try {
    const result = await window.electron?.importPrivateKeyFromFile?.();
    if (!result || result.canceled) {
      return;
    }

    if (typeof result.content !== 'string') {
      onError(importFailedMessage);
      return;
    }

    onPrivateKeyImported(result.content);
    onSuccess(importSuccessMessage);
  } catch (error: unknown) {
    onError(error instanceof Error ? error.message : importFailedMessage);
  }
};

type InlineCredentialKeychainDraftSource = Pick<
  ServerEditorFormState,
  | 'name'
  | 'iconKey'
  | 'colorKey'
  | 'authType'
  | 'password'
  | 'privateKey'
  | 'privateKeyPassphrase'
  | 'folderId'
  | 'tagIds'
>;

/**
 * Builds keychain editor draft values from inline server credential fields.
 *
 * @param formState Source server form values.
 * @returns Initial keychain dialog form state.
 */
export const buildInlineCredentialKeychainEditorFormState = (
  formState: InlineCredentialKeychainDraftSource,
): KeychainEditorInitialFormState => {
  return {
    name: formState.name.trim() ? `${formState.name.trim()} Keychain` : '',
    iconKey: formState.iconKey,
    colorKey: formState.colorKey,
    authType: formState.authType,
    password: formState.password,
    privateKey: formState.privateKey,
    privateKeyPassphrase: formState.privateKeyPassphrase,
    folderId: formState.folderId,
    tagIds: [...formState.tagIds],
  };
};
