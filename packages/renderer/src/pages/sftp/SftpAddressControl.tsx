import classNames from 'classnames';
import { ChevronRight, Copy, Edit3, MoreHorizontal, Server } from 'lucide-react';
import React from 'react';

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import type { InputContextMenuItem } from '../../components/ui/input-context-menu-registry';
import { t } from '../../lib/i18n';
import type { SftpDirectoryDropEventHandler, SftpDirectoryDropTarget } from './sftp-drag-drop';
import type { AddressBreadcrumbRenderState, SftpBreadcrumbItem, TreeDirectoryNode } from './sftp-types';

/**
 * Props for the controlled SFTP address bar.
 */
type SftpAddressControlProps = {
  activeDropTarget: SftpDirectoryDropTarget | null;
  addressBreadcrumbRenderState: AddressBreadcrumbRenderState;
  addressInputContextMenuItems: InputContextMenuItem[];
  addressInputRef: React.RefObject<HTMLInputElement | null>;
  currentPath: string;
  isAddressInputEditing: boolean;
  isBusy: boolean;
  pathInput: string;
  sessionId: string;
  sftpShowAddressAsText: boolean;
  getBreadcrumbDirectories: (breadcrumbPath: string) => TreeDirectoryNode[];
  isBreadcrumbLoading: (breadcrumbPath: string) => boolean;
  keepAddressInputDuringContextMenu: () => void;
  onDirectoryDropTargetDragEnter: SftpDirectoryDropEventHandler;
  onDirectoryDropTargetDragLeave: SftpDirectoryDropEventHandler;
  onDirectoryDropTargetDragOver: SftpDirectoryDropEventHandler;
  onDirectoryDropTargetDrop: SftpDirectoryDropEventHandler;
  onAddressInputPointerDown: (event: React.PointerEvent<HTMLInputElement>) => void;
  onCopyCurrentPath: () => Promise<void>;
  onEditCurrentPath: () => void;
  onNavigateToPath: (directoryPath: string) => Promise<boolean>;
  onPathInputBlur: () => void;
  onPathInputChange: (value: string) => void;
  onPathInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onPathSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onRequestBreadcrumbDirectories: (breadcrumbPath: string) => void;
  onShowAddressAsText: () => void;
};

/**
 * Renders the SFTP address field in either text-input or compact breadcrumb mode.
 *
 * @param props Controlled address state and callbacks.
 * @returns Address bar control.
 */
export const SftpAddressControl: React.FC<SftpAddressControlProps> = ({
  activeDropTarget,
  addressBreadcrumbRenderState,
  addressInputContextMenuItems,
  addressInputRef,
  currentPath,
  getBreadcrumbDirectories,
  isAddressInputEditing,
  isBreadcrumbLoading,
  isBusy,
  keepAddressInputDuringContextMenu,
  onDirectoryDropTargetDragEnter,
  onDirectoryDropTargetDragLeave,
  onDirectoryDropTargetDragOver,
  onDirectoryDropTargetDrop,
  onAddressInputPointerDown,
  onCopyCurrentPath,
  onEditCurrentPath,
  onNavigateToPath,
  onPathInputBlur,
  onPathInputChange,
  onPathInputKeyDown,
  onPathSubmit,
  onRequestBreadcrumbDirectories,
  onShowAddressAsText,
  pathInput,
  sessionId,
  sftpShowAddressAsText,
}) => {
  /**
   * Renders child-directory choices for one breadcrumb segment menu.
   *
   * @param breadcrumbPath Breadcrumb path whose cached children should be shown.
   * @returns Dropdown menu items for child directories.
   */
  const renderBreadcrumbDirectoryMenuItems = React.useCallback(
    (breadcrumbPath: string): React.ReactNode => {
      const directories = getBreadcrumbDirectories(breadcrumbPath);
      const isLoading = isBreadcrumbLoading(breadcrumbPath);

      if (directories.length === 0) {
        return (
          <DropdownMenuItem disabled>
            <span className="min-w-0 truncate">
              {isLoading ? t('sftp.addressMenuLoading') : t('sftp.addressMenuEmpty')}
            </span>
          </DropdownMenuItem>
        );
      }

      return directories.map((directory) => (
        <DropdownMenuItem
          key={directory.path}
          className={
            activeDropTarget?.surface === 'address-menu' && activeDropTarget.path === directory.path
              ? 'bg-menu-control-hover'
              : undefined
          }
          disabled={isBusy || directory.path === currentPath}
          onDragEnter={(event) =>
            onDirectoryDropTargetDragEnter(event, {
              path: directory.path,
              surface: 'address-menu',
            })
          }
          onDragLeave={(event) =>
            onDirectoryDropTargetDragLeave(event, {
              path: directory.path,
              surface: 'address-menu',
            })
          }
          onDragOver={(event) =>
            onDirectoryDropTargetDragOver(event, {
              path: directory.path,
              surface: 'address-menu',
            })
          }
          onDrop={(event) =>
            onDirectoryDropTargetDrop(event, {
              path: directory.path,
              surface: 'address-menu',
            })
          }
          onSelect={() => {
            void onNavigateToPath(directory.path);
          }}
        >
          <span
            className="min-w-0 flex-1 truncate"
            title={directory.path}
          >
            {directory.name}
          </span>
        </DropdownMenuItem>
      ));
    },
    [
      activeDropTarget,
      currentPath,
      getBreadcrumbDirectories,
      isBreadcrumbLoading,
      isBusy,
      onDirectoryDropTargetDragEnter,
      onDirectoryDropTargetDragLeave,
      onDirectoryDropTargetDragOver,
      onDirectoryDropTargetDrop,
      onNavigateToPath,
    ],
  );

  /**
   * Renders the collapsed ancestor menu behind the address ellipsis.
   *
   * @param items Hidden breadcrumb ancestors.
   * @returns Dropdown menu items for collapsed ancestors.
   */
  const renderCollapsedBreadcrumbMenuItems = React.useCallback(
    (items: SftpBreadcrumbItem[]): React.ReactNode => {
      if (items.length === 0) {
        return <DropdownMenuItem disabled>{t('sftp.addressMenuEmpty')}</DropdownMenuItem>;
      }

      return items.map((item) => (
        <DropdownMenuItem
          key={item.path}
          className={
            activeDropTarget?.surface === 'address-menu' && activeDropTarget.path === item.path
              ? 'bg-menu-control-hover'
              : undefined
          }
          disabled={isBusy || item.path === currentPath}
          onDragEnter={(event) =>
            onDirectoryDropTargetDragEnter(event, {
              path: item.path,
              surface: 'address-menu',
            })
          }
          onDragLeave={(event) =>
            onDirectoryDropTargetDragLeave(event, {
              path: item.path,
              surface: 'address-menu',
            })
          }
          onDragOver={(event) =>
            onDirectoryDropTargetDragOver(event, {
              path: item.path,
              surface: 'address-menu',
            })
          }
          onDrop={(event) =>
            onDirectoryDropTargetDrop(event, {
              path: item.path,
              surface: 'address-menu',
            })
          }
          onSelect={() => {
            void onNavigateToPath(item.path);
          }}
        >
          <span
            className="min-w-0 flex-1 truncate"
            title={item.path}
          >
            {item.label}
          </span>
        </DropdownMenuItem>
      ));
    },
    [
      activeDropTarget,
      currentPath,
      isBusy,
      onDirectoryDropTargetDragEnter,
      onDirectoryDropTargetDragLeave,
      onDirectoryDropTargetDragOver,
      onDirectoryDropTargetDrop,
      onNavigateToPath,
    ],
  );

  /**
   * Renders one clickable breadcrumb segment plus its sibling-directory menu.
   *
   * @param item Breadcrumb segment.
   * @param options Render options for current-path styling.
   * @returns Breadcrumb segment control.
   */
  const renderAddressBreadcrumbSegment = React.useCallback(
    (item: SftpBreadcrumbItem, options: { isCurrent: boolean }): React.ReactNode => {
      const isRootBreadcrumb = item.path === '/' && item.label === '/';
      const isActiveDropTarget =
        activeDropTarget?.surface === 'address-breadcrumb' && activeDropTarget.path === item.path;

      return (
        <div
          key={item.path}
          className="flex min-w-0 shrink items-center"
          onDragEnter={(event) =>
            onDirectoryDropTargetDragEnter(event, {
              path: item.path,
              surface: 'address-breadcrumb',
            })
          }
          onDragLeave={(event) =>
            onDirectoryDropTargetDragLeave(event, {
              path: item.path,
              surface: 'address-breadcrumb',
            })
          }
          onDragOver={(event) =>
            onDirectoryDropTargetDragOver(event, {
              path: item.path,
              surface: 'address-breadcrumb',
            })
          }
          onDrop={(event) =>
            onDirectoryDropTargetDrop(event, {
              path: item.path,
              surface: 'address-breadcrumb',
            })
          }
        >
          <button
            type="button"
            className={classNames(
              'text-home-text flex h-[28px] min-w-0 shrink items-center rounded-md px-2 text-sm transition-colors hover:bg-form-control-hover',
              options.isCurrent && 'bg-form-control-hover',
              isActiveDropTarget && 'bg-home-card-active',
            )}
            disabled={isBusy || item.path === currentPath}
            aria-label={isRootBreadcrumb ? t('sftp.addressRootLabel') : undefined}
            title={item.path}
            onClick={(event) => {
              event.stopPropagation();
              void onNavigateToPath(item.path);
            }}
          >
            {isRootBreadcrumb ? (
              <Server
                aria-hidden
                className="h-4 w-4 shrink-0"
              />
            ) : (
              <span className="min-w-0 max-w-[180px] truncate">{item.label}</span>
            )}
          </button>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) {
                onRequestBreadcrumbDirectories(item.path);
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('sftp.addressSegmentMenuLabel', { path: item.path })}
                className="hover:text-home-text focus-visible:text-home-text flex h-[28px] w-6 shrink-0 items-center justify-center rounded-md text-home-text-subtle transition-colors hover:bg-form-control-hover focus-visible:bg-form-control-hover disabled:cursor-default disabled:opacity-50"
                disabled={!sessionId}
                onClick={(event) => event.stopPropagation()}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[180px] max-w-[280px] overflow-y-auto"
              horizontalAlign="left"
            >
              {renderBreadcrumbDirectoryMenuItems(item.path)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
    [
      currentPath,
      isBusy,
      activeDropTarget,
      onDirectoryDropTargetDragEnter,
      onDirectoryDropTargetDragLeave,
      onDirectoryDropTargetDragOver,
      onDirectoryDropTargetDrop,
      onNavigateToPath,
      onRequestBreadcrumbDirectories,
      renderBreadcrumbDirectoryMenuItems,
      sessionId,
    ],
  );

  if (sftpShowAddressAsText || isAddressInputEditing) {
    return (
      <form
        className="min-w-0 flex-1"
        onSubmit={onPathSubmit}
      >
        <Input
          ref={addressInputRef}
          aria-label={t('sftp.pathInputLabel')}
          className="h-[34px] min-w-0 text-sm"
          contextMenuItems={addressInputContextMenuItems}
          disabled={!sessionId || isBusy}
          value={pathInput}
          onBlur={onPathInputBlur}
          onChange={(event) => onPathInputChange(event.target.value)}
          onContextMenu={keepAddressInputDuringContextMenu}
          onKeyDown={onPathInputKeyDown}
          onPointerDown={onAddressInputPointerDown}
        />
      </form>
    );
  }

  const addressContextMenu = (
    <>
      <ContextMenuItem
        icon={Copy}
        disabled={!sessionId}
        onSelect={() => {
          void onCopyCurrentPath();
        }}
      >
        {t('sftp.actions.copyAddress')}
      </ContextMenuItem>
      <ContextMenuItem
        icon={Edit3}
        disabled={!sessionId}
        onSelect={onEditCurrentPath}
      >
        {t('sftp.actions.editAddress')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem
        checked={sftpShowAddressAsText}
        onSelect={onShowAddressAsText}
      >
        {t('sftp.actions.showAddressAsText')}
      </ContextMenuCheckboxItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="group"
          aria-label={t('sftp.pathInputLabel')}
          className="menu-menubar-field flex h-[34px] min-w-0 flex-1 items-center overflow-hidden rounded-lg bg-form-control px-1 text-sm text-form-text outline-none [-webkit-app-region:no-drag] hover:bg-form-control-hover"
          onClick={onEditCurrentPath}
          onDoubleClick={onEditCurrentPath}
        >
          <div className="flex min-w-0 flex-1 items-center overflow-hidden">
            {addressBreadcrumbRenderState.leadingItem
              ? renderAddressBreadcrumbSegment(addressBreadcrumbRenderState.leadingItem, {
                  isCurrent: addressBreadcrumbRenderState.leadingItem.path === currentPath,
                })
              : null}
            {addressBreadcrumbRenderState.hiddenItems.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('sftp.addressCollapsedMenuLabel')}
                    className="text-home-text mx-0.5 flex h-[28px] w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-form-control-hover"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[180px] max-w-[280px] overflow-y-auto"
                  horizontalAlign="left"
                >
                  {renderCollapsedBreadcrumbMenuItems(addressBreadcrumbRenderState.hiddenItems)}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {addressBreadcrumbRenderState.visibleItems.map((item) =>
              renderAddressBreadcrumbSegment(item, { isCurrent: item.path === currentPath }),
            )}
            <button
              type="button"
              aria-label={t('sftp.actions.editAddress')}
              className="min-w-[16px] flex-1 self-stretch outline-none"
              onClick={onEditCurrentPath}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">{addressContextMenu}</ContextMenuContent>
    </ContextMenu>
  );
};
