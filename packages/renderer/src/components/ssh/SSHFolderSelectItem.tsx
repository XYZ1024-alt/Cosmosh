import type { components } from '@cosmosh/api-contract';
import React from 'react';

import { renderEntityIcon } from '../../lib/entity-visuals';
import { SelectItem } from '../ui/select';

type SshFolder = components['schemas']['SshFolder'];

type SSHFolderSelectItemProps = {
  folder: SshFolder;
};

/**
 * Renders a folder select option with the folder's persisted visual identity.
 *
 * @param props Component props.
 * @returns Select item for a persisted SSH folder.
 */
const SSHFolderSelectItem: React.FC<SSHFolderSelectItemProps> = ({ folder }) => {
  return (
    <SelectItem
      value={folder.id}
      iconNode={renderEntityIcon(folder.iconKey)}
    >
      {folder.name}
    </SelectItem>
  );
};

export default SSHFolderSelectItem;
