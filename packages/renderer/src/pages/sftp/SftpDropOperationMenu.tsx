import { Copy, Link2, MoveRight } from 'lucide-react';
import React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { t } from '../../lib/i18n';
import type { SftpInternalDragEntry, SftpResolvedDragOperation } from './sftp-drag-drop';
import { isSameParentMove, isUnsafeDirectorySelfDrop } from './sftp-drag-drop';

/**
 * Pointer-anchored menu state for choosing an internal SFTP drop operation.
 */
export type SftpPendingDropOperationMenu = {
  entries: SftpInternalDragEntry[];
  targetDirectoryPath: string;
  x: number;
  y: number;
};

/**
 * Props for the SFTP drag operation ask menu.
 */
type SftpDropOperationMenuProps = {
  pendingDropOperationMenu: SftpPendingDropOperationMenu | null;
  onDismiss: () => void;
  onOperationSelect: (operation: SftpResolvedDragOperation) => void;
};

/**
 * Renders the pointer-anchored menu shown when drag settings require an explicit operation choice.
 *
 * @param props Pending drop state and menu event handlers.
 * @returns SFTP drop operation menu.
 */
export const SftpDropOperationMenu: React.FC<SftpDropOperationMenuProps> = ({
  pendingDropOperationMenu,
  onDismiss,
  onOperationSelect,
}) => {
  const isMoveDisabled = pendingDropOperationMenu
    ? isUnsafeDirectorySelfDrop(pendingDropOperationMenu.entries, pendingDropOperationMenu.targetDirectoryPath) ||
      isSameParentMove(pendingDropOperationMenu.entries, pendingDropOperationMenu.targetDirectoryPath)
    : true;
  const isCopyDisabled = pendingDropOperationMenu
    ? isUnsafeDirectorySelfDrop(pendingDropOperationMenu.entries, pendingDropOperationMenu.targetDirectoryPath)
    : true;
  const isLinkDisabled = pendingDropOperationMenu
    ? isUnsafeDirectorySelfDrop(pendingDropOperationMenu.entries, pendingDropOperationMenu.targetDirectoryPath)
    : true;

  return (
    <DropdownMenu
      open={Boolean(pendingDropOperationMenu)}
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('sftp.drag.menuTrigger')}
          tabIndex={-1}
          className="pointer-events-none fixed h-px w-px opacity-0"
          style={
            pendingDropOperationMenu
              ? {
                  left: pendingDropOperationMenu.x,
                  top: pendingDropOperationMenu.y,
                }
              : undefined
          }
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-[220px]"
        horizontalAlign="left"
        sideOffset={0}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {pendingDropOperationMenu ? (
          <>
            <DropdownMenuLabel>
              {pendingDropOperationMenu.entries.length === 1
                ? t('sftp.drag.menuTitle', {
                    path: pendingDropOperationMenu.targetDirectoryPath,
                  })
                : t('sftp.drag.menuTitleMany', {
                    count: pendingDropOperationMenu.entries.length,
                    path: pendingDropOperationMenu.targetDirectoryPath,
                  })}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={MoveRight}
              disabled={isMoveDisabled}
              onSelect={() => onOperationSelect('move')}
            >
              {t('sftp.drag.moveHere')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Copy}
              disabled={isCopyDisabled}
              onSelect={() => onOperationSelect('copy')}
            >
              {t('sftp.drag.copyHere')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Link2}
              disabled={isLinkDisabled}
              onSelect={() => onOperationSelect('link')}
            >
              {t('sftp.drag.linkHere')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
