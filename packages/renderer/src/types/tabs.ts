import type { components } from '@cosmosh/api-contract';

export type TabPage = string;

export type TabIconKey = string;
export type TabIconColorKey = components['schemas']['SshVisualColorKey'];

export type SshTargetSelection = {
  type: 'ssh-server' | 'local-terminal';
  id: string;
};

export type SshResolvedTargetSnapshot =
  | {
      type: 'ssh-server';
      serverId: string;
      serverName: string;
      strictHostKey: boolean;
      enableSshCompression: boolean;
      capturedAt: number;
    }
  | {
      type: 'local-terminal';
      profileId: string;
      profileName: string | null;
      capturedAt: number;
    };

export type SshConnectionIntent = {
  intentId: string;
  createdAt: number;
  target: SshTargetSelection | null;
  lastResolvedSnapshot: SshResolvedTargetSnapshot | null;
  startupCommand?: string;
};

export type SshEditorState = {
  preferredServerId?: string;
  createMode?: boolean;
};

export type SftpConnectionIntent = {
  serverId: string;
  serverName: string;
  initialPath?: string;
  createdAt: number;
};

export type TabItem = {
  id: string;
  title: string;
  page: TabPage;
  iconKey: TabIconKey;
  iconColorKey?: TabIconColorKey;
  closable?: boolean;
  state?: {
    settingsCategory?: string;
    settingsInitialSearch?: string;
    settingsEditorSettingKey?: string;
    sshConnectionIntent?: SshConnectionIntent;
    sftpConnectionIntent?: SftpConnectionIntent;
    sshEditor?: SshEditorState;
  };
};
