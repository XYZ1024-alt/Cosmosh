import classNames from 'classnames';
import { ChevronRight, Folder, Loader2 } from 'lucide-react';
import React from 'react';

import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../../components/ui/context-menu';
import { t } from '../../lib/i18n';
import { SFTP_CARD_CLASS_NAME } from './sftp-constants';
import type { SftpActionMenuOptions, SftpConnectionStatus, TreeDirectoryNode } from './sftp-types';
import { resolveTreeDirectoryEntry, resolveTreeIndentClassName } from './sftp-utils';

/**
 * Props for the SFTP directory tree panel.
 */
type SftpTreePanelProps = {
  currentPath: string;
  resolvedActiveTreePath: string;
  status: SftpConnectionStatus;
  treeNodes: Record<string, TreeDirectoryNode>;
  treeRootPaths: string[];
  treeRowRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  onInlineEditMenuCloseAutoFocus: (event: Event) => void;
  onNavigateToPath: (directoryPath: string) => Promise<boolean>;
  onSetActiveTreePath: (nodePath: string) => void;
  onTreeNodeToggle: (nodePath: string) => void;
  onTreeRowKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, nodePath: string) => void;
  renderActionMenuItems: (options: SftpActionMenuOptions) => React.ReactNode;
};

/**
 * Renders the expandable left-side SFTP directory tree.
 *
 * @param props Tree state and navigation handlers.
 * @returns SFTP tree panel.
 */
export const SftpTreePanel: React.FC<SftpTreePanelProps> = ({
  currentPath,
  onInlineEditMenuCloseAutoFocus,
  onNavigateToPath,
  onSetActiveTreePath,
  onTreeNodeToggle,
  onTreeRowKeyDown,
  renderActionMenuItems,
  resolvedActiveTreePath,
  status,
  treeNodes,
  treeRootPaths,
  treeRowRefs,
}) => {
  /**
   * Recursively renders one visible tree node and its expanded descendants.
   *
   * @param nodePath Directory node path.
   * @param depth Visual tree depth.
   * @returns Tree row subtree.
   */
  const renderNode = React.useCallback(
    (nodePath: string, depth: number): React.ReactNode => {
      const node = treeNodes[nodePath];
      if (!node) {
        return null;
      }

      const isCurrent = node.path === currentPath;
      const isExpandable = node.isLoading || node.children.length > 0 || !node.isLoaded;
      const treeContextEntry = resolveTreeDirectoryEntry(node);

      return (
        <React.Fragment key={node.path}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={classNames(
                  'group flex h-[30px] w-full items-center rounded-lg text-sm transition-colors hover:bg-home-card-hover',
                  isCurrent ? 'bg-home-card-hover' : '',
                )}
              >
                <div
                  className={classNames(
                    'flex min-w-0 flex-1 items-center',
                    depth > 0 ? resolveTreeIndentClassName(depth) : '',
                  )}
                >
                  <button
                    type="button"
                    aria-label={t(node.isExpanded ? 'sftp.actions.collapse' : 'sftp.actions.expand')}
                    className="focus-visible:ring-form-ring flex h-[30px] w-5 shrink-0 items-center justify-center rounded-sm-2 text-home-text-subtle focus-visible:outline-none focus-visible:ring-2"
                    disabled={node.isLoading}
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      onTreeNodeToggle(node.path);
                    }}
                  >
                    {node.isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isExpandable ? (
                      <ChevronRight
                        className={classNames(
                          'h-3.5 w-3.5 transition-transform',
                          node.isExpanded && node.children.length > 0 ? 'rotate-90' : '',
                        )}
                      />
                    ) : (
                      <span className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    ref={(element) => {
                      treeRowRefs.current[node.path] = element;
                    }}
                    type="button"
                    className="focus-visible:ring-form-ring text-home-text flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left"
                    tabIndex={resolvedActiveTreePath === node.path ? 0 : -1}
                    onClick={() => {
                      onSetActiveTreePath(node.path);
                      void onNavigateToPath(node.path);
                    }}
                    onFocus={() => onSetActiveTreePath(node.path)}
                    onKeyDown={(event) => onTreeRowKeyDown(event, node.path)}
                  >
                    <Folder className="text-home-text h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{node.name}</span>
                  </button>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={onInlineEditMenuCloseAutoFocus}>
              {renderActionMenuItems({
                contextEntry: treeContextEntry,
                menuSurface: 'context',
                scope: 'treeDirectory',
                showShortcuts: false,
                targetDirectoryPath: node.path,
              })}
            </ContextMenuContent>
          </ContextMenu>
          {node.isExpanded ? node.children.map((childPath) => renderNode(childPath, depth + 1)) : null}
        </React.Fragment>
      );
    },
    [
      currentPath,
      onInlineEditMenuCloseAutoFocus,
      onNavigateToPath,
      onSetActiveTreePath,
      onTreeNodeToggle,
      onTreeRowKeyDown,
      renderActionMenuItems,
      resolvedActiveTreePath,
      treeNodes,
      treeRowRefs,
    ],
  );

  return (
    <aside className={SFTP_CARD_CLASS_NAME}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {status === 'connecting' && treeRootPaths.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-home-text-subtle">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('sftp.connecting')}
            </div>
          ) : (
            treeRootPaths.map((rootPath) => renderNode(rootPath, 0))
          )}
        </div>
      </div>
    </aside>
  );
};
