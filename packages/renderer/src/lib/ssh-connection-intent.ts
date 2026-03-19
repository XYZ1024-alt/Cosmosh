import type { SshConnectionIntent, SshResolvedTargetSnapshot, SshTargetSelection } from '../types/tabs';

export const LOCAL_TERMINAL_TARGET_PREFIX = 'local-terminal:';

/**
 * Converts local terminal profile id into serialized target id.
 *
 * @param profileId Local terminal profile id.
 * @returns Serialized target id.
 */
export const toLocalTerminalTargetId = (profileId: string): string => {
  return `${LOCAL_TERMINAL_TARGET_PREFIX}${profileId}`;
};

/**
 * Parses serialized target id into structured selection.
 *
 * @param targetId Serialized target identifier.
 * @returns Structured target selection or null when invalid.
 */
export const parseTerminalTarget = (targetId: string | null): SshTargetSelection | null => {
  if (!targetId) {
    return null;
  }

  if (targetId.startsWith(LOCAL_TERMINAL_TARGET_PREFIX)) {
    const profileId = targetId.slice(LOCAL_TERMINAL_TARGET_PREFIX.length).trim();
    if (!profileId) {
      return null;
    }

    return {
      type: 'local-terminal',
      id: profileId,
    };
  }

  const trimmed = targetId.trim();
  if (!trimmed) {
    return null;
  }

  return {
    type: 'ssh-server',
    id: trimmed,
  };
};

/**
 * Creates a new tab-scoped SSH connection intent.
 *
 * @param target Serialized target identifier.
 * @returns Fresh intent object with unique id.
 */
export const createSshConnectionIntent = (target: string | null): SshConnectionIntent => {
  return {
    intentId: crypto.randomUUID(),
    createdAt: Date.now(),
    target: parseTerminalTarget(target),
    lastResolvedSnapshot: null,
  };
};

/**
 * Updates one tab intent with a newly resolved target snapshot.
 *
 * @param intent Current tab-scoped intent.
 * @param snapshot Last successfully resolved snapshot.
 * @returns Updated intent.
 */
export const withResolvedSnapshot = (
  intent: SshConnectionIntent,
  snapshot: SshResolvedTargetSnapshot,
): SshConnectionIntent => {
  return {
    ...intent,
    lastResolvedSnapshot: snapshot,
  };
};

/**
 * Returns the retry snapshot for one tab intent.
 *
 * @param intent Tab-scoped connection intent.
 * @returns Last resolved snapshot.
 * @throws Error when no resolved snapshot exists.
 */
export const resolveRetrySnapshot = (intent: SshConnectionIntent): SshResolvedTargetSnapshot => {
  if (!intent.lastResolvedSnapshot) {
    throw new Error('Cannot retry without a resolved target snapshot.');
  }

  return intent.lastResolvedSnapshot;
};

/**
 * Resolves connect mode while preserving retry semantics when snapshot exists.
 *
 * @param intent Tab-scoped connection intent.
 * @param preferredMode Preferred connect mode.
 * @returns Effective connect mode.
 */
export const resolveConnectMode = (
  intent: SshConnectionIntent,
  preferredMode: 'initial' | 'retry',
): 'initial' | 'retry' => {
  if (preferredMode === 'retry' && intent.lastResolvedSnapshot) {
    return 'retry';
  }

  return 'initial';
};

/**
 * Returns whether one async result should be ignored due to stale attempt id.
 *
 * @param activeAttemptId Latest active attempt id.
 * @param resultAttemptId Attempt id attached to async result.
 * @returns True when result is stale and must be ignored.
 */
export const shouldIgnoreAttemptResult = (activeAttemptId: number, resultAttemptId: number): boolean => {
  return activeAttemptId !== resultAttemptId;
};

/**
 * Resolves mirror-pane snapshot source.
 *
 * @param primarySnapshot Primary pane snapshot.
 * @returns Snapshot that mirror panes must use.
 */
export const resolveMirrorPaneSnapshot = (primarySnapshot: SshResolvedTargetSnapshot): SshResolvedTargetSnapshot => {
  return primarySnapshot;
};
