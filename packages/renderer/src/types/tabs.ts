export type TabPage = string;

export type TabIconKey = string;

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
};

export type SshEditorState = {
  preferredServerId?: string;
  createMode?: boolean;
};

export type TabItem = {
  id: string;
  title: string;
  page: TabPage;
  iconKey: TabIconKey;
  closable?: boolean;
  state?: {
    settingsCategory?: string;
    settingsEditorSettingKey?: string;
    sshConnectionIntent?: SshConnectionIntent;
    sshEditor?: SshEditorState;
  };
};
