import React from 'react';

import { getSshKeychainCredentials, getSshServerCredentials } from './backend';
import { mapCredentialSnapshotToCache, type ServerCredentialCache } from './ssh-server-editor-shared';

type CredentialsLoadedHandler = (credentials: ServerCredentialCache) => void;
type CredentialsLoadFailedHandler = () => void;

type LoadServerCredentialsOptions = {
  shouldCancel?: () => boolean;
  onCredentialsLoaded?: CredentialsLoadedHandler;
  onLoadFailed?: CredentialsLoadFailedHandler;
};

type UseServerCredentialsRefreshParams = {
  enabled?: boolean;
  serverId: string | null;
  onCredentialsLoaded: CredentialsLoadedHandler;
  onLoadFailed: CredentialsLoadFailedHandler;
};

type RefreshServerCredentials = (
  serverId: string,
  options?: Omit<LoadServerCredentialsOptions, 'shouldCancel'>,
) => Promise<void>;

/**
 * Shares server-credential loading for both effect-driven hydration and post-save refresh.
 *
 * @param params Hook configuration for target server and callbacks.
 * @param params.enabled Whether automatic loading is enabled.
 * @param params.serverId Active server id to auto-load.
 * @param params.onCredentialsLoaded Callback when credentials are loaded.
 * @param params.onLoadFailed Callback when credentials loading fails.
 * @returns A refresh function that can be called after save operations.
 */
export const useServerCredentialsRefresh = ({
  enabled = true,
  serverId,
  onCredentialsLoaded,
  onLoadFailed,
}: UseServerCredentialsRefreshParams): { refreshServerCredentials: RefreshServerCredentials } => {
  const requestVersionRef = React.useRef<number>(0);
  const onCredentialsLoadedRef = React.useRef<CredentialsLoadedHandler>(onCredentialsLoaded);
  const onLoadFailedRef = React.useRef<CredentialsLoadFailedHandler>(onLoadFailed);

  React.useEffect(() => {
    onCredentialsLoadedRef.current = onCredentialsLoaded;
  }, [onCredentialsLoaded]);

  React.useEffect(() => {
    onLoadFailedRef.current = onLoadFailed;
  }, [onLoadFailed]);

  /**
   * Loads credentials for a specific server id while guarding against stale responses.
   *
   * @param targetServerId The server id to load credentials for.
   * @param options Optional per-call overrides.
   * @param options.shouldCancel Predicate for local cancellation checks.
   * @param options.onCredentialsLoaded Optional callback overriding default success handler.
   * @param options.onLoadFailed Optional callback overriding default failure handler.
   * @returns Resolves when the request is completed or ignored as stale/cancelled.
   */
  const loadServerCredentials = React.useCallback(
    async (targetServerId: string, options: LoadServerCredentialsOptions = {}): Promise<void> => {
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;

      try {
        const response = await getSshServerCredentials(targetServerId);
        if (requestVersion !== requestVersionRef.current || options.shouldCancel?.()) {
          return;
        }

        const nextCredentials = mapCredentialSnapshotToCache(response.data);
        (options.onCredentialsLoaded ?? onCredentialsLoadedRef.current)(nextCredentials);
      } catch {
        if (requestVersion !== requestVersionRef.current || options.shouldCancel?.()) {
          return;
        }

        (options.onLoadFailed ?? onLoadFailedRef.current)();
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!enabled || !serverId) {
      return;
    }

    let cancelled = false;
    void loadServerCredentials(serverId, {
      shouldCancel: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, loadServerCredentials, serverId]);

  const refreshServerCredentials = React.useCallback<RefreshServerCredentials>(
    async (targetServerId, options) => {
      await loadServerCredentials(targetServerId, options);
    },
    [loadServerCredentials],
  );

  return {
    refreshServerCredentials,
  };
};

type UseKeychainCredentialsParams = {
  enabled?: boolean;
  keychainId: string | null;
  onCredentialsLoaded: CredentialsLoadedHandler;
  onLoadFailed: CredentialsLoadFailedHandler;
};

/**
 * Loads credentials of the selected keychain and applies cancellation when dependencies change.
 *
 * @param params Hook configuration for selected keychain credentials.
 * @param params.enabled Whether automatic loading is enabled.
 * @param params.keychainId Selected keychain id.
 * @param params.onCredentialsLoaded Callback when credentials are loaded.
 * @param params.onLoadFailed Callback when credentials loading fails.
 * @returns Void.
 */
export const useKeychainCredentials = ({
  enabled = true,
  keychainId,
  onCredentialsLoaded,
  onLoadFailed,
}: UseKeychainCredentialsParams): void => {
  const onCredentialsLoadedRef = React.useRef<CredentialsLoadedHandler>(onCredentialsLoaded);
  const onLoadFailedRef = React.useRef<CredentialsLoadFailedHandler>(onLoadFailed);

  React.useEffect(() => {
    onCredentialsLoadedRef.current = onCredentialsLoaded;
  }, [onCredentialsLoaded]);

  React.useEffect(() => {
    onLoadFailedRef.current = onLoadFailed;
  }, [onLoadFailed]);

  React.useEffect(() => {
    if (!enabled || !keychainId) {
      return;
    }

    let cancelled = false;

    const loadKeychainCredentials = async () => {
      try {
        const response = await getSshKeychainCredentials(keychainId);
        if (cancelled) {
          return;
        }

        onCredentialsLoadedRef.current(mapCredentialSnapshotToCache(response.data));
      } catch {
        if (!cancelled) {
          onLoadFailedRef.current();
        }
      }
    };

    void loadKeychainCredentials();

    return () => {
      cancelled = true;
    };
  }, [enabled, keychainId]);
};
