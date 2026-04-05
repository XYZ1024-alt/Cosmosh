import React from 'react';

import type { SshServerListItem } from './ssh-server-editor-shared';

type UseServerEditorDialogStateParams = {
  activeFolderId: string;
  servers: SshServerListItem[];
  localTerminalFolderId: string;
  onServerNotFound: () => void;
};

type UseServerEditorDialogStateResult = {
  isServerEditorDialogOpen: boolean;
  activeServerEditorId: string | null;
  serverEditorInitialFolderId?: string;
  openCreateServerDialog: () => void;
  openEditServerDialog: (serverId: string) => void;
  closeServerEditorDialog: () => void;
};

/**
 * Centralizes Home page state transitions for opening and closing the server editor dialog.
 *
 * @param params Hook parameters.
 * @param params.activeFolderId Current selected Home folder id.
 * @param params.servers Current server list used for edit-target validation.
 * @param params.localTerminalFolderId Sentinel folder id for local terminal collection.
 * @param params.onServerNotFound Callback fired when an edit target cannot be found.
 * @returns Dialog state values and handlers.
 */
export const useServerEditorDialogState = ({
  activeFolderId,
  servers,
  localTerminalFolderId,
  onServerNotFound,
}: UseServerEditorDialogStateParams): UseServerEditorDialogStateResult => {
  const [isServerEditorDialogOpen, setIsServerEditorDialogOpen] = React.useState<boolean>(false);
  const [activeServerEditorId, setActiveServerEditorId] = React.useState<string | null>(null);
  const [serverEditorInitialFolderId, setServerEditorInitialFolderId] = React.useState<string | undefined>(undefined);

  const openCreateServerDialog = React.useCallback(() => {
    setActiveServerEditorId(null);
    setServerEditorInitialFolderId(
      activeFolderId !== 'all' && activeFolderId !== localTerminalFolderId ? activeFolderId : undefined,
    );
    setIsServerEditorDialogOpen(true);
  }, [activeFolderId, localTerminalFolderId]);

  const openEditServerDialog = React.useCallback(
    (serverId: string) => {
      const targetServer = servers.find((server) => server.id === serverId);
      if (!targetServer) {
        onServerNotFound();
        return;
      }

      setActiveServerEditorId(serverId);
      setServerEditorInitialFolderId(undefined);
      setIsServerEditorDialogOpen(true);
    },
    [onServerNotFound, servers],
  );

  const closeServerEditorDialog = React.useCallback(() => {
    setIsServerEditorDialogOpen(false);
    setActiveServerEditorId(null);
    setServerEditorInitialFolderId(undefined);
  }, []);

  return {
    isServerEditorDialogOpen,
    activeServerEditorId,
    serverEditorInitialFolderId,
    openCreateServerDialog,
    openEditServerDialog,
    closeServerEditorDialog,
  };
};
