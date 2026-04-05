import type { components } from '@cosmosh/api-contract';

import { createSshKeychain, createSshTag } from './backend';
import type { ServerEditorFormState } from './ssh-server-editor-shared';

type SshTag = components['schemas']['SshTag'];
type SshKeychainListItem = components['schemas']['SshKeychainListItem'];

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

type InlineCredentialFormState = Pick<
  ServerEditorFormState,
  'authType' | 'name' | 'password' | 'privateKey' | 'privateKeyPassphrase'
>;

type SaveInlineCredentialsParams = {
  isUsingInlineCredentials: boolean;
  formState: InlineCredentialFormState;
  setIsSubmitting: (isSubmitting: boolean) => void;
  onKeychainCreated: (keychain: SshKeychainListItem) => Promise<void> | void;
  onWarning: (message: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  validationRequiredFieldsMessage: string;
  validationPasswordRequiredMessage: string;
  validationPrivateKeyRequiredMessage: string;
  saveSuccessMessage: string;
  saveFailedMessage: string;
};

/**
 * Saves inline credentials into a newly created shared keychain with validation.
 *
 * @param params Save parameters.
 * @param params.isUsingInlineCredentials Whether current editor mode is inline credentials.
 * @param params.formState Current credential-related form values.
 * @param params.setIsSubmitting State setter used by the caller.
 * @param params.onKeychainCreated Callback invoked with created keychain.
 * @param params.onWarning Warning notifier callback.
 * @param params.onSuccess Success notifier callback.
 * @param params.onError Error notifier callback.
 * @param params.validationRequiredFieldsMessage Localized required-fields message.
 * @param params.validationPasswordRequiredMessage Localized password-required message.
 * @param params.validationPrivateKeyRequiredMessage Localized private-key-required message.
 * @param params.saveSuccessMessage Localized success message.
 * @param params.saveFailedMessage Localized failure message.
 * @returns Resolves when save flow is completed.
 */
export const saveInlineCredentialsToSharedKeychain = async ({
  isUsingInlineCredentials,
  formState,
  setIsSubmitting,
  onKeychainCreated,
  onWarning,
  onSuccess,
  onError,
  validationRequiredFieldsMessage,
  validationPasswordRequiredMessage,
  validationPrivateKeyRequiredMessage,
  saveSuccessMessage,
  saveFailedMessage,
}: SaveInlineCredentialsParams): Promise<void> => {
  if (!isUsingInlineCredentials) {
    return;
  }

  if (!formState.name.trim()) {
    onWarning(validationRequiredFieldsMessage);
    return;
  }

  const shouldUsePassword = formState.authType === 'password' || formState.authType === 'both';
  const shouldUsePrivateKey = formState.authType === 'key' || formState.authType === 'both';

  if (shouldUsePassword && !formState.password.trim()) {
    onWarning(validationPasswordRequiredMessage);
    return;
  }

  if (shouldUsePrivateKey && !formState.privateKey.trim()) {
    onWarning(validationPrivateKeyRequiredMessage);
    return;
  }

  setIsSubmitting(true);
  try {
    const created = await createSshKeychain({
      name: `${formState.name.trim()} Keychain`,
      authType: formState.authType,
      visibility: 'shared',
      password: formState.password.trim() || undefined,
      privateKey: formState.privateKey.trim() || undefined,
      privateKeyPassphrase: formState.privateKeyPassphrase.trim() || undefined,
    });

    await onKeychainCreated(created.data.item);
    onSuccess(saveSuccessMessage);
  } catch (error: unknown) {
    onError(error instanceof Error ? error.message : saveFailedMessage);
  } finally {
    setIsSubmitting(false);
  }
};
