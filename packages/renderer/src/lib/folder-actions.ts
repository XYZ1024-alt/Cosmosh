import type { components } from '@cosmosh/api-contract';

import { createSshFolder, deleteSshFolder, updateSshFolder } from './backend';
import type { EntityColorKey } from './entity-visuals';

type SshFolder = components['schemas']['SshFolder'];

type CreateFolderPayload = {
  name: string;
  iconKey: string;
  colorKey: EntityColorKey;
};

type UpdateFolderPayload = {
  iconKey?: string;
  colorKey?: EntityColorKey;
};

export const normalizeFolderName = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const createFolder = async (payload: CreateFolderPayload): Promise<SshFolder> => {
  const response = await createSshFolder(payload);
  return response.data.item;
};

export const renameFolder = async (
  folderId: string,
  name: string,
  payload: UpdateFolderPayload = {},
): Promise<void> => {
  await updateSshFolder(folderId, { name, ...payload });
};

export const removeFolder = async (folderId: string): Promise<void> => {
  const result = await deleteSshFolder(folderId);
  if (!result.success) {
    throw new Error('Failed to delete folder.');
  }
};
