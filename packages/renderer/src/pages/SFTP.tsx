import type { ApiSftpEntry } from '@cosmosh/api-contract';
import classNames from 'classnames';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  Info,
  Loader2,
  RefreshCcw,
  Search,
  Server,
  ShieldAlert,
} from 'lucide-react';
import React from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Menubar } from '../components/ui/menubar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { closeSftpSession, createSftpSession, listSftpDirectory, trustSshFingerprint } from '../lib/backend';
import { t } from '../lib/i18n';
import { useToast } from '../lib/toast-context';
import type { SftpConnectionIntent } from '../types/tabs';

type HostFingerprintPrompt = {
  serverId: string;
  host: string;
  port: number;
  algorithm: 'sha256';
  fingerprint: string;
};

type SFTPProps = {
  connectionIntent?: SftpConnectionIntent;
  onTabTitleChange: (title: string) => void;
};

type DirectoryLoadOptions = {
  forceRefresh?: boolean;
  isCancelled?: () => boolean;
};

type DirectoryCacheEntry = {
  path: string;
  parentPath?: string;
  entries: ApiSftpEntry[];
};

type TreeDirectoryNode = {
  path: string;
  name: string;
  parentPath?: string;
  children: string[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
};

type NavigationState = {
  paths: string[];
  index: number;
};

const TREE_INDENT_CLASS_NAMES = ['pl-2', 'pl-5', 'pl-8', 'pl-11', 'pl-14', 'pl-16'] as const;
const SFTP_CARD_CLASS_NAME = 'bg-ssh-card-bg-terminal h-full min-h-0 overflow-hidden rounded-[18px] p-1';
const DIRECTORY_LIST_MIN_WIDTH_CLASS_NAME = 'min-w-[600px]';
const DIRECTORY_ROW_GRID_CLASS_NAME = 'grid-cols-[minmax(0,1fr)_92px_148px_96px_28px]';

/**
 * Formats SFTP byte sizes for the compact file list.
 *
 * @param size Raw byte size from the SFTP server.
 * @returns Human-readable size label.
 */
const formatFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) {
    return '-';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

/**
 * Formats an SFTP timestamp for the local workstation locale.
 *
 * @param value ISO timestamp returned by the backend.
 * @returns Localized timestamp or a placeholder when parsing fails.
 */
const formatModifiedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
};

/**
 * Resolves the icon for a directory-list entry.
 *
 * @param entry SFTP entry.
 * @returns Icon element matching the entry type.
 */
const resolveEntryIcon = (entry: ApiSftpEntry): React.ReactNode => {
  if (entry.type === 'directory') {
    return <Folder className="text-home-text h-4 w-4 shrink-0" />;
  }

  return <File className="text-home-text h-4 w-4 shrink-0" />;
};

/**
 * Splits a normalized SFTP path into clickable breadcrumb items.
 *
 * @param directoryPath Current remote directory path.
 * @returns Ordered breadcrumb labels and paths.
 */
const buildBreadcrumbs = (directoryPath: string): Array<{ label: string; path: string }> => {
  if (!directoryPath || directoryPath === '.') {
    return [{ label: '.', path: '.' }];
  }

  const isAbsolute = directoryPath.startsWith('/');
  const parts = directoryPath.split('/').filter(Boolean);
  const breadcrumbs: Array<{ label: string; path: string }> = [];

  if (isAbsolute) {
    breadcrumbs.push({ label: '/', path: '/' });
  }

  parts.forEach((part, index) => {
    const path = `${isAbsolute ? '/' : ''}${parts.slice(0, index + 1).join('/')}`;
    breadcrumbs.push({ label: part, path });
  });

  return breadcrumbs.length > 0 ? breadcrumbs : [{ label: directoryPath, path: directoryPath }];
};

/**
 * Resolves a compact label for a path when no explicit SFTP entry name exists.
 *
 * @param directoryPath Remote directory path.
 * @returns Last path segment or root marker.
 */
const resolvePathLabel = (directoryPath: string): string => {
  if (!directoryPath || directoryPath === '.') {
    return '.';
  }

  if (directoryPath === '/') {
    return '/';
  }

  const parts = directoryPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? directoryPath;
};

/**
 * Sorts entries in the browser order used by the SFTP page.
 *
 * @param entries Directory entries returned by the backend.
 * @returns Entries sorted with directories first, then by name.
 */
const sortSftpEntries = (entries: ApiSftpEntry[]): ApiSftpEntry[] => {
  return [...entries].sort((left, right) => {
    const leftDirectoryRank = left.type === 'directory' ? 0 : 1;
    const rightDirectoryRank = right.type === 'directory' ? 0 : 1;
    if (leftDirectoryRank !== rightDirectoryRank) {
      return leftDirectoryRank - rightDirectoryRank;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
};

/**
 * Resolves the Tailwind indentation class for one tree row.
 *
 * @param depth Directory depth in the rendered tree.
 * @returns Stable padding class name.
 */
const resolveTreeIndentClassName = (depth: number): string => {
  return TREE_INDENT_CLASS_NAMES[Math.min(depth, TREE_INDENT_CLASS_NAMES.length - 1)];
};

/**
 * Resolves ancestor directories that should be loaded to keep the tree structure complete.
 *
 * @param directoryPath Current remote directory path.
 * @returns Parent directory paths ordered from root to nearest parent.
 */
const resolveAncestorDirectoryPaths = (directoryPath: string): string[] => {
  const breadcrumbs = buildBreadcrumbs(directoryPath);
  return breadcrumbs.slice(0, -1).map((breadcrumb) => breadcrumb.path);
};

/**
 * Adds breadcrumb ancestors for a path while preserving existing tree children.
 *
 * @param previous Previous tree node registry.
 * @param directoryPath Path that must be visible in the tree.
 * @returns Tree registry containing the path branch.
 */
const mergePathBranchIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  directoryPath: string,
): Record<string, TreeDirectoryNode> => {
  const breadcrumbs = buildBreadcrumbs(directoryPath);
  const next: Record<string, TreeDirectoryNode> = { ...previous };

  breadcrumbs.forEach((breadcrumb, index) => {
    const parentPath = index > 0 ? breadcrumbs[index - 1]?.path : undefined;
    const existing = next[breadcrumb.path];

    next[breadcrumb.path] = {
      path: breadcrumb.path,
      name: existing?.name ?? breadcrumb.label,
      parentPath,
      children: existing?.children ?? [],
      isExpanded: true,
      isLoaded: existing?.isLoaded ?? false,
      isLoading: existing?.isLoading ?? false,
    };

    if (parentPath) {
      const parent = next[parentPath];
      const childSet = new Set(parent.children);
      childSet.add(breadcrumb.path);
      next[parentPath] = {
        ...parent,
        children: Array.from(childSet),
        isExpanded: true,
      };
    }
  });

  return next;
};

/**
 * Merges a loaded directory listing into the left tree registry.
 *
 * @param previous Previous tree node registry.
 * @param directoryPath Loaded remote directory path.
 * @param entries Directory entries returned for the path.
 * @returns Updated tree registry.
 */
const mergeDirectoryEntriesIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  directoryPath: string,
  entries: ApiSftpEntry[],
): Record<string, TreeDirectoryNode> => {
  const next = mergePathBranchIntoTree(previous, directoryPath);
  const directoryChildren = sortSftpEntries(entries).filter((entry) => entry.type === 'directory');
  const childPaths = directoryChildren.map((entry) => entry.path);
  const existing = next[directoryPath] ?? {
    path: directoryPath,
    name: resolvePathLabel(directoryPath),
    children: [],
    isExpanded: true,
    isLoaded: false,
    isLoading: false,
  };

  next[directoryPath] = {
    ...existing,
    children: childPaths,
    isExpanded: true,
    isLoaded: true,
    isLoading: false,
  };

  directoryChildren.forEach((entry) => {
    const childExisting = next[entry.path];
    next[entry.path] = {
      path: entry.path,
      name: entry.name,
      parentPath: directoryPath,
      children: childExisting?.children ?? [],
      isExpanded: childExisting?.isExpanded ?? false,
      isLoaded: childExisting?.isLoaded ?? false,
      isLoading: childExisting?.isLoading ?? false,
    };
  });

  return next;
};

/**
 * Merges a resolved directory listing and removes any temporary requested-path placeholder.
 *
 * @param previous Previous tree node registry.
 * @param requestedPath Path used for the request.
 * @param resolvedPath Canonical path returned by the backend.
 * @param entries Directory entries returned for the canonical path.
 * @returns Updated tree registry.
 */
const mergeResolvedDirectoryIntoTree = (
  previous: Record<string, TreeDirectoryNode>,
  requestedPath: string,
  resolvedPath: string,
  entries: ApiSftpEntry[],
): Record<string, TreeDirectoryNode> => {
  const next = mergeDirectoryEntriesIntoTree(previous, resolvedPath, entries);
  const requestedNode = next[requestedPath];
  if (requestedPath !== resolvedPath && requestedNode) {
    if (!requestedNode.isLoaded && requestedNode.children.length === 0) {
      delete next[requestedPath];
    } else {
      next[requestedPath] = { ...requestedNode, isLoading: false };
    }
  }

  return next;
};

/**
 * Filters entries by file name for the toolbar search field.
 *
 * @param entries Current directory entries.
 * @param query Search query.
 * @returns Entries matching the query.
 */
const filterSftpEntries = (entries: ApiSftpEntry[], query: string): ApiSftpEntry[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedQuery));
};

/**
 * Read-only SFTP browser page bound to one renderer tab.
 *
 * @param props SFTP tab runtime props.
 * @returns SFTP workbench page.
 */
const SFTP: React.FC<SFTPProps> = ({ connectionIntent, onTabTitleChange }) => {
  const { error: notifyError } = useToast();
  const [sessionId, setSessionId] = React.useState<string>('');
  const [currentPath, setCurrentPath] = React.useState<string>('.');
  const [parentPath, setParentPath] = React.useState<string | undefined>(undefined);
  const [entries, setEntries] = React.useState<ApiSftpEntry[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string>('');
  const [status, setStatus] = React.useState<'idle' | 'connecting' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [pathInput, setPathInput] = React.useState<string>('.');
  const [filterQuery, setFilterQuery] = React.useState<string>('');
  const [treeNodes, setTreeNodes] = React.useState<Record<string, TreeDirectoryNode>>({});
  const [navigationState, setNavigationState] = React.useState<NavigationState>({ paths: [], index: -1 });
  const [hostFingerprintPrompt, setHostFingerprintPrompt] = React.useState<HostFingerprintPrompt | null>(null);
  const pendingPromptResolverRef = React.useRef<((accepted: boolean) => void) | null>(null);
  const directoryCacheRef = React.useRef<Record<string, DirectoryCacheEntry>>({});
  const sessionIdRef = React.useRef<string>('');
  const syncedTabTitleRef = React.useRef<string>('');

  React.useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  React.useEffect(() => {
    const nextTitle = connectionIntent?.serverName;
    if (nextTitle && syncedTabTitleRef.current !== nextTitle) {
      syncedTabTitleRef.current = nextTitle;
      onTabTitleChange(nextTitle);
    }
  }, [connectionIntent?.serverName, onTabTitleChange]);

  React.useEffect(() => {
    setPathInput(currentPath);
  }, [currentPath]);

  const selectedEntry = React.useMemo(() => {
    return entries.find((entry) => entry.path === selectedPath) ?? null;
  }, [entries, selectedPath]);

  const visibleEntries = React.useMemo(() => {
    return filterSftpEntries(entries, filterQuery);
  }, [entries, filterQuery]);

  const breadcrumbs = React.useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);
  const serverDisplayName = connectionIntent?.serverName ?? t('sftp.untitledServer');
  const isBusy = status === 'connecting' || status === 'loading';
  const canGoBack = navigationState.index > 0;
  const canGoForward = navigationState.index >= 0 && navigationState.index < navigationState.paths.length - 1;

  const requestHostFingerprintTrust = React.useCallback((prompt: HostFingerprintPrompt): Promise<boolean> => {
    return new Promise((resolve) => {
      pendingPromptResolverRef.current = resolve;
      setHostFingerprintPrompt(prompt);
    });
  }, []);

  const resolveHostFingerprintPrompt = React.useCallback((accepted: boolean): void => {
    pendingPromptResolverRef.current?.(accepted);
    pendingPromptResolverRef.current = null;
    setHostFingerprintPrompt(null);
  }, []);

  const setTreeNodeLoading = React.useCallback((directoryPath: string, isLoading: boolean): void => {
    setTreeNodes((previous) => {
      const existing = previous[directoryPath];
      if (!existing) {
        return previous;
      }

      return {
        ...previous,
        [directoryPath]: {
          ...existing,
          isExpanded: isLoading ? true : existing.isExpanded,
          isLoading,
        },
      };
    });
  }, []);

  const syncAncestorDirectories = React.useCallback(
    async (nextSessionId: string, directoryPath: string, isCancelled?: () => boolean): Promise<void> => {
      const ancestorPaths = resolveAncestorDirectoryPaths(directoryPath);

      for (const ancestorPath of ancestorPaths) {
        if (isCancelled?.()) {
          return;
        }

        const cachedDirectory = directoryCacheRef.current[ancestorPath];
        if (cachedDirectory) {
          setTreeNodes((previous) =>
            mergeResolvedDirectoryIntoTree(previous, ancestorPath, cachedDirectory.path, cachedDirectory.entries),
          );
          continue;
        }

        setTreeNodeLoading(ancestorPath, true);

        try {
          const response = await listSftpDirectory(nextSessionId, { path: ancestorPath });
          if (isCancelled?.()) {
            return;
          }

          const sortedEntries = sortSftpEntries(response.data.entries);
          directoryCacheRef.current = {
            ...directoryCacheRef.current,
            [ancestorPath]: {
              path: response.data.path,
              parentPath: response.data.parentPath,
              entries: sortedEntries,
            },
            [response.data.path]: {
              path: response.data.path,
              parentPath: response.data.parentPath,
              entries: sortedEntries,
            },
          };
          setTreeNodes((previous) =>
            mergeResolvedDirectoryIntoTree(previous, ancestorPath, response.data.path, sortedEntries),
          );
        } catch {
          setTreeNodeLoading(ancestorPath, false);
        }
      }
    },
    [setTreeNodeLoading],
  );

  const applyDirectoryCacheEntry = React.useCallback((cacheEntry: DirectoryCacheEntry): void => {
    setCurrentPath(cacheEntry.path);
    setParentPath(cacheEntry.parentPath);
    setEntries(cacheEntry.entries);
    setSelectedPath('');
    setFilterQuery('');
    setTreeNodes((previous) =>
      mergeResolvedDirectoryIntoTree(previous, cacheEntry.path, cacheEntry.path, cacheEntry.entries),
    );
    setStatus('ready');
    setErrorMessage('');
  }, []);

  const loadDirectory = React.useCallback(
    async (nextSessionId: string, directoryPath: string, options?: DirectoryLoadOptions): Promise<string | null> => {
      const cachedDirectory = directoryCacheRef.current[directoryPath];
      if (cachedDirectory && !options?.forceRefresh) {
        applyDirectoryCacheEntry(cachedDirectory);
        void syncAncestorDirectories(nextSessionId, cachedDirectory.path, options?.isCancelled);
        return cachedDirectory.path;
      }

      setStatus((previous) => (previous === 'connecting' ? 'connecting' : 'loading'));
      setErrorMessage('');
      setTreeNodeLoading(directoryPath, true);

      try {
        const response = await listSftpDirectory(nextSessionId, { path: directoryPath });
        if (options?.isCancelled?.()) {
          return null;
        }

        const sortedEntries = sortSftpEntries(response.data.entries);
        setCurrentPath(response.data.path);
        setParentPath(response.data.parentPath);
        setEntries(sortedEntries);
        setSelectedPath('');
        setFilterQuery('');
        setTreeNodes((previous) =>
          mergeResolvedDirectoryIntoTree(previous, directoryPath, response.data.path, sortedEntries),
        );
        directoryCacheRef.current = {
          ...directoryCacheRef.current,
          [directoryPath]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
          [response.data.path]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
        };
        setStatus('ready');
        void syncAncestorDirectories(nextSessionId, response.data.path, options?.isCancelled);
        return response.data.path;
      } catch (error: unknown) {
        if (options?.isCancelled?.()) {
          return null;
        }

        const message = error instanceof Error ? error.message : t('sftp.loadFailed');
        setTreeNodeLoading(directoryPath, false);
        void syncAncestorDirectories(nextSessionId, directoryPath, options?.isCancelled);
        setErrorMessage(message);
        setStatus('error');
        notifyError(message);
        return null;
      }
    },
    [applyDirectoryCacheEntry, notifyError, setTreeNodeLoading, syncAncestorDirectories],
  );

  const loadTreeDirectoryChildren = React.useCallback(
    async (nextSessionId: string, directoryPath: string): Promise<void> => {
      const cachedDirectory = directoryCacheRef.current[directoryPath];
      if (cachedDirectory) {
        setTreeNodes((previous) =>
          mergeResolvedDirectoryIntoTree(previous, directoryPath, cachedDirectory.path, cachedDirectory.entries),
        );
        return;
      }

      setTreeNodeLoading(directoryPath, true);

      try {
        const response = await listSftpDirectory(nextSessionId, { path: directoryPath });
        const sortedEntries = sortSftpEntries(response.data.entries);
        directoryCacheRef.current = {
          ...directoryCacheRef.current,
          [directoryPath]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
          [response.data.path]: {
            path: response.data.path,
            parentPath: response.data.parentPath,
            entries: sortedEntries,
          },
        };
        setTreeNodes((previous) =>
          mergeResolvedDirectoryIntoTree(previous, directoryPath, response.data.path, sortedEntries),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : t('sftp.loadFailed');
        setTreeNodeLoading(directoryPath, false);
        notifyError(message);
      }
    },
    [notifyError, setTreeNodeLoading],
  );

  const createSessionForIntent = React.useCallback(
    async (isCancelled = (): boolean => false): Promise<void> => {
      if (!connectionIntent?.serverId) {
        setStatus('idle');
        return;
      }

      setStatus('connecting');
      setErrorMessage('');

      let shouldRetry = true;
      while (shouldRetry) {
        shouldRetry = false;
        const response = await createSftpSession({
          serverId: connectionIntent.serverId,
          initialPath: '.',
          connectTimeoutSec: 45,
        });

        if (!response.success && response.code === 'SSH_HOST_UNTRUSTED') {
          const accepted = await requestHostFingerprintTrust({
            serverId: response.data.serverId,
            host: response.data.host,
            port: response.data.port,
            algorithm: response.data.algorithm,
            fingerprint: response.data.fingerprint,
          });

          if (!accepted) {
            throw new Error(t('ssh.hostFingerprintNotTrusted'));
          }

          await trustSshFingerprint({
            serverId: response.data.serverId,
            fingerprintSha256: response.data.fingerprint,
            algorithm: response.data.algorithm,
          });
          shouldRetry = true;
          continue;
        }

        const nextSessionId = response.data.sessionId;
        if (isCancelled()) {
          await closeSftpSession(nextSessionId).catch(() => undefined);
          return;
        }

        sessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        const loadedPath = await loadDirectory(nextSessionId, response.data.currentPath, { isCancelled });

        if (!isCancelled() && loadedPath) {
          setNavigationState({ paths: [loadedPath], index: 0 });
        }

        if (isCancelled()) {
          await closeSftpSession(nextSessionId).catch(() => undefined);
        }
      }
    },
    [connectionIntent?.serverId, loadDirectory, requestHostFingerprintTrust],
  );

  React.useEffect(() => {
    let isCancelled = false;

    const run = async (): Promise<void> => {
      if (!connectionIntent?.serverId) {
        return;
      }

      const previousSessionId = sessionIdRef.current;
      if (previousSessionId) {
        await closeSftpSession(previousSessionId).catch(() => undefined);
        if (!isCancelled) {
          setSessionId('');
        }
      }

      if (!isCancelled) {
        setEntries([]);
        setSelectedPath('');
        setTreeNodes({});
        directoryCacheRef.current = {};
        setNavigationState({ paths: [], index: -1 });
        setFilterQuery('');
      }

      try {
        await createSessionForIntent(() => isCancelled);
      } catch (error: unknown) {
        if (isCancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : t('sftp.sessionInitFailed');
        setErrorMessage(message);
        setStatus('error');
        notifyError(message);
      }
    };

    void run();

    return () => {
      isCancelled = true;
      resolveHostFingerprintPrompt(false);
    };
  }, [
    connectionIntent?.createdAt,
    connectionIntent?.serverId,
    createSessionForIntent,
    notifyError,
    resolveHostFingerprintPrompt,
  ]);

  React.useEffect(() => {
    return () => {
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) {
        void closeSftpSession(activeSessionId);
      }
    };
  }, []);

  const navigateToPath = React.useCallback(
    async (directoryPath: string): Promise<void> => {
      const trimmedPath = directoryPath.trim();
      if (!sessionId || !trimmedPath) {
        return;
      }

      const loadedPath = await loadDirectory(sessionId, trimmedPath);
      if (!loadedPath) {
        return;
      }

      setNavigationState((previous) => {
        const currentHistoryPath = previous.paths[previous.index];
        if (currentHistoryPath === loadedPath) {
          return previous;
        }

        const retainedPaths = previous.index >= 0 ? previous.paths.slice(0, previous.index + 1) : [];
        const nextPaths = [...retainedPaths, loadedPath];
        return { paths: nextPaths, index: nextPaths.length - 1 };
      });
    },
    [loadDirectory, sessionId],
  );

  const handleHistoryJump = React.useCallback(
    async (nextIndex: number): Promise<void> => {
      if (!sessionId || nextIndex < 0 || nextIndex >= navigationState.paths.length) {
        return;
      }

      const targetPath = navigationState.paths[nextIndex];
      if (!targetPath) {
        return;
      }

      const loadedPath = await loadDirectory(sessionId, targetPath);
      if (!loadedPath) {
        return;
      }

      setNavigationState((previous) => {
        const nextPaths = [...previous.paths];
        nextPaths[nextIndex] = loadedPath;
        return { paths: nextPaths, index: nextIndex };
      });
    },
    [loadDirectory, navigationState.paths, sessionId],
  );

  const handleRefresh = React.useCallback(() => {
    if (!sessionId) {
      return;
    }

    void loadDirectory(sessionId, currentPath, { forceRefresh: true });
  }, [currentPath, loadDirectory, sessionId]);

  const handlePathSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void navigateToPath(pathInput);
    },
    [navigateToPath, pathInput],
  );

  const handleParentDirectory = React.useCallback((): void => {
    if (!parentPath) {
      return;
    }

    void navigateToPath(parentPath);
  }, [navigateToPath, parentPath]);

  const handleEntrySelect = React.useCallback((entry: ApiSftpEntry): void => {
    setSelectedPath(entry.path);
  }, []);

  const handleEntryOpen = React.useCallback(
    (entry: ApiSftpEntry): void => {
      setSelectedPath(entry.path);
      if (entry.type === 'directory') {
        void navigateToPath(entry.path);
      }
    },
    [navigateToPath],
  );

  const handleTreeNodeToggle = React.useCallback(
    (nodePath: string): void => {
      const node = treeNodes[nodePath];
      if (!node || node.isLoading) {
        return;
      }

      const shouldExpand = !node.isExpanded;
      setTreeNodes((previous) => {
        const previousNode = previous[nodePath];
        if (!previousNode) {
          return previous;
        }

        return {
          ...previous,
          [nodePath]: {
            ...previousNode,
            isExpanded: shouldExpand,
          },
        };
      });

      if (shouldExpand && !node.isLoaded && sessionId) {
        void loadTreeDirectoryChildren(sessionId, nodePath);
      }
    },
    [loadTreeDirectoryChildren, sessionId, treeNodes],
  );

  const treeRootPaths = React.useMemo(() => {
    const rootPaths = Object.values(treeNodes)
      .filter((node) => !node.parentPath)
      .map((node) => node.path)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

    if (rootPaths.length > 0) {
      return rootPaths;
    }

    return breadcrumbs[0]?.path ? [breadcrumbs[0].path] : [];
  }, [breadcrumbs, treeNodes]);

  const treeContent = React.useMemo(() => {
    const renderNode = (nodePath: string, depth: number): React.ReactNode => {
      const node = treeNodes[nodePath];
      if (!node) {
        return null;
      }

      const isCurrent = node.path === currentPath;
      const isExpandable = node.isLoading || node.children.length > 0 || !node.isLoaded;

      return (
        <React.Fragment key={node.path}>
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
                onClick={(event) => {
                  event.stopPropagation();
                  handleTreeNodeToggle(node.path);
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
                type="button"
                className="focus-visible:ring-form-ring text-home-text flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-sm-2 pr-2 text-left focus-visible:outline-none focus-visible:ring-2"
                onClick={() => {
                  void navigateToPath(node.path);
                }}
              >
                <Folder className="text-home-text h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
          </div>
          {node.isExpanded ? node.children.map((childPath) => renderNode(childPath, depth + 1)) : null}
        </React.Fragment>
      );
    };

    return treeRootPaths.map((rootPath) => renderNode(rootPath, 0));
  }, [currentPath, handleTreeNodeToggle, navigateToPath, treeNodes, treeRootPaths]);

  const toolbar = (
    <TooltipProvider>
      <Menubar className="w-full shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('sftp.actions.back')}
                variant="ghostIcon"
                disabled={!canGoBack || isBusy}
                onClick={() => {
                  void handleHistoryJump(navigationState.index - 1);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('sftp.actions.back')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('sftp.actions.forward')}
                variant="ghostIcon"
                disabled={!canGoForward || isBusy}
                onClick={() => {
                  void handleHistoryJump(navigationState.index + 1);
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('sftp.actions.forward')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('sftp.actions.up')}
                variant="ghostIcon"
                disabled={!sessionId || !parentPath || isBusy}
                onClick={handleParentDirectory}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('sftp.actions.up')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('sftp.actions.refresh')}
                variant="ghostIcon"
                disabled={!sessionId || isBusy}
                onClick={handleRefresh}
              >
                <RefreshCcw className={classNames('h-4 w-4', isBusy && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('sftp.actions.refresh')}</TooltipContent>
          </Tooltip>

          <form
            className="mx-1 min-w-0 flex-1"
            onSubmit={handlePathSubmit}
          >
            <Input
              aria-label={t('sftp.pathInputLabel')}
              className="h-[34px] min-w-0 text-sm"
              disabled={!sessionId || isBusy}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
            />
          </form>

          <div className="relative w-[220px] shrink-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-home-text-subtle" />
            <Input
              aria-label={t('sftp.actions.search')}
              className="h-[34px] pl-8 text-sm"
              disabled={!sessionId}
              placeholder={t('sftp.searchPlaceholder')}
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
            />
          </div>
        </div>
      </Menubar>
    </TooltipProvider>
  );

  const treePanel = (
    <aside className={SFTP_CARD_CLASS_NAME}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[34px] shrink-0 items-center gap-2 px-2">
          <Server className="h-4 w-4 shrink-0 text-home-text-subtle" />
          <div className="text-home-text min-w-0 flex-1 truncate text-sm font-medium">{serverDisplayName}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {status === 'connecting' && treeRootPaths.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-home-text-subtle">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('sftp.connecting')}
            </div>
          ) : (
            treeContent
          )}
        </div>
      </div>
    </aside>
  );

  const directoryPanel = (
    <main className={SFTP_CARD_CLASS_NAME}>
      {status === 'error' ? (
        <div className="flex h-full min-h-0 items-center justify-center px-6 text-center">
          <div className="flex max-w-[360px] flex-col items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-form-message-error" />
            <div className="text-home-text text-sm">{errorMessage || t('sftp.loadFailed')}</div>
            <Menubar>
              <Button
                variant="ghost"
                padding="mid"
                disabled={!sessionId}
                onClick={handleRefresh}
              >
                {t('sftp.actions.retry')}
              </Button>
            </Menubar>
          </div>
        </div>
      ) : status === 'connecting' || status === 'loading' ? (
        <div className="flex h-full min-h-0 items-center justify-center gap-2 px-6 text-center text-sm text-home-text-subtle">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === 'connecting' ? t('sftp.connecting') : t('sftp.loading')}
        </div>
      ) : (
        <div className="h-full min-h-0 overflow-auto">
          <div className={classNames('flex min-h-full flex-col', DIRECTORY_LIST_MIN_WIDTH_CLASS_NAME)}>
            <div
              className={classNames(
                'sticky top-0 z-10 grid h-[30px] shrink-0 items-center bg-ssh-card-bg-terminal px-3 text-xs font-medium text-home-text-subtle',
                DIRECTORY_ROW_GRID_CLASS_NAME,
              )}
            >
              <span className="min-w-0 truncate">{t('sftp.columns.name')}</span>
              <span className="min-w-0 truncate">{t('sftp.columns.size')}</span>
              <span className="min-w-0 truncate">{t('sftp.columns.modified')}</span>
              <span className="min-w-0 truncate">{t('sftp.columns.mode')}</span>
              <span></span>
            </div>
            <div className="min-h-0 flex-1">
              {status === 'idle' ? (
                <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                  {t('sftp.noSession')}
                </div>
              ) : null}
              {status === 'ready' && entries.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                  {t('sftp.empty')}
                </div>
              ) : null}
              {status === 'ready' && entries.length > 0 && visibleEntries.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-sm text-home-text-subtle">
                  {t('sftp.searchEmpty')}
                </div>
              ) : null}
              {status === 'ready' && visibleEntries.length > 0
                ? visibleEntries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className={classNames(
                        'focus-visible:ring-form-ring grid h-[34px] w-full items-center rounded-lg px-3 text-left text-sm transition-colors hover:bg-home-card-hover focus-visible:outline-none focus-visible:ring-2',
                        DIRECTORY_ROW_GRID_CLASS_NAME,
                        selectedPath === entry.path ? 'text-home-text bg-home-card-hover' : 'text-home-text',
                      )}
                      onClick={() => handleEntrySelect(entry)}
                      onDoubleClick={() => handleEntryOpen(entry)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && entry.type === 'directory') {
                          event.preventDefault();
                          handleEntryOpen(entry);
                        }
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                        {resolveEntryIcon(entry)}
                        <span className="truncate">{entry.name}</span>
                      </span>
                      <span className="min-w-0 truncate text-xs text-home-text-subtle">
                        {entry.type === 'directory' ? '-' : formatFileSize(entry.size)}
                      </span>
                      <span className="truncate text-xs text-home-text-subtle">
                        {formatModifiedAt(entry.modifiedAt)}
                      </span>
                      <span className="min-w-0 truncate font-mono text-xs text-home-text-subtle">
                        {entry.permissions}
                      </span>
                      <Info className="h-3.5 w-3.5 shrink-0 justify-self-end text-home-text-subtle" />
                    </button>
                  ))
                : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );

  const detailPanel = (
    <aside className={SFTP_CARD_CLASS_NAME}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[34px] shrink-0 items-center gap-2 px-2">
          <Info className="h-4 w-4 shrink-0 text-home-text-subtle" />
          <div className="text-home-text text-sm font-medium">{t('sftp.detailTitle')}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {selectedEntry ? (
            <div className="space-y-4">
              <div className="flex min-w-0 items-center gap-2">
                {resolveEntryIcon(selectedEntry)}
                <div className="min-w-0">
                  <div className="text-home-text truncate text-sm font-medium">{selectedEntry.name}</div>
                  <div className="mt-0.5 text-xs text-home-text-subtle">
                    {t(`sftp.entryType.${selectedEntry.type}`)}
                  </div>
                </div>
              </div>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.path')}</dt>
                  <dd className="text-home-text mt-1 break-all font-mono text-xs">{selectedEntry.path}</dd>
                </div>
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.size')}</dt>
                  <dd className="text-home-text mt-1">{formatFileSize(selectedEntry.size)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.modified')}</dt>
                  <dd className="text-home-text mt-1">{formatModifiedAt(selectedEntry.modifiedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-home-text-subtle">{t('sftp.detail.permissions')}</dt>
                  <dd className="text-home-text mt-1 font-mono text-xs">{selectedEntry.permissions}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-sm text-home-text-subtle">
              {t('sftp.detailEmpty')}
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="flex h-full w-full flex-col gap-2.5 overflow-hidden">
        {toolbar}
        <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_minmax(240px,320px)] gap-2.5 overflow-hidden">
          {treePanel}
          {directoryPanel}
          {detailPanel}
        </div>
      </div>
      <Dialog
        open={Boolean(hostFingerprintPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            resolveHostFingerprintPrompt(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ssh.hostFingerprintDialogTitle')}</DialogTitle>
            <DialogDescription>{t('ssh.hostFingerprintDialogDescription')}</DialogDescription>
          </DialogHeader>
          {hostFingerprintPrompt ? (
            <div className="bg-home-card/70 space-y-2 rounded-lg border border-home-divider p-3 text-sm">
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogHost')}: </span>
                <span className="text-home-text font-medium">
                  {hostFingerprintPrompt.host}:{hostFingerprintPrompt.port}
                </span>
              </div>
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogAlgorithm')}: </span>
                <span className="text-home-text font-medium">{hostFingerprintPrompt.algorithm}</span>
              </div>
              <div>
                <span className="text-home-text-subtle">{t('ssh.hostFingerprintDialogFingerprint')}: </span>
                <span className="text-home-text break-all font-mono text-xs">{hostFingerprintPrompt.fingerprint}</span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <DialogSecondaryButton onClick={() => resolveHostFingerprintPrompt(false)}>
              {t('ssh.hostFingerprintDialogCancel')}
            </DialogSecondaryButton>
            <DialogPrimaryButton onClick={() => resolveHostFingerprintPrompt(true)}>
              {t('ssh.hostFingerprintDialogTrustContinue')}
            </DialogPrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SFTP;
