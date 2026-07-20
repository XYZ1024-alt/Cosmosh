import React from 'react';

import { t } from '../../lib/i18n';
import { INLINE_EDIT_MENU_HANDOFF_RELEASE_DELAY_MS } from './sftp-constants';
import type { InlineEditMenuAction } from './sftp-types';

/**
 * Inputs for the inline edit focus handoff hook.
 */
type UseSftpInlineEditFocusParams = {
  isInlineEditActive: boolean;
  notifyError: (message: string) => void;
};

/**
 * Inline edit focus refs and handlers shared by tree, directory, and action menus.
 */
type UseSftpInlineEditFocusResult = {
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  handleInlineEditMenuCloseAutoFocus: (event: Event) => void;
  handleInlineEditInputBlur: (commit: InlineEditMenuAction) => void;
  runInlineEditMenuActionAfterClose: (action: InlineEditMenuAction) => void;
};

/**
 * Coordinates Radix menu focus restoration with inline rename/create inputs.
 *
 * @param params Active inline-edit state and error reporter.
 * @returns Focus refs and event handlers for inline edit surfaces.
 */
export const useSftpInlineEditFocus = ({
  isInlineEditActive,
  notifyError,
}: UseSftpInlineEditFocusParams): UseSftpInlineEditFocusResult => {
  const renameInputRef = React.useRef<HTMLInputElement | null>(null);
  const shouldPreventMenuCloseAutoFocusRef = React.useRef(false);
  const inlineEditMenuActionTimerRef = React.useRef<number | null>(null);
  const inlineEditMenuFocusHandoffReleaseTimerRef = React.useRef<number | null>(null);

  const focusInlineEditInput = React.useCallback((): void => {
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, []);

  const releaseInlineEditMenuFocusHandoff = React.useCallback((): void => {
    if (inlineEditMenuFocusHandoffReleaseTimerRef.current !== null) {
      window.clearTimeout(inlineEditMenuFocusHandoffReleaseTimerRef.current);
      inlineEditMenuFocusHandoffReleaseTimerRef.current = null;
    }

    shouldPreventMenuCloseAutoFocusRef.current = false;
  }, []);

  const scheduleInlineEditMenuFocusHandoffRelease = React.useCallback((): void => {
    if (inlineEditMenuFocusHandoffReleaseTimerRef.current !== null) {
      window.clearTimeout(inlineEditMenuFocusHandoffReleaseTimerRef.current);
    }

    inlineEditMenuFocusHandoffReleaseTimerRef.current = window.setTimeout(() => {
      shouldPreventMenuCloseAutoFocusRef.current = false;
      inlineEditMenuFocusHandoffReleaseTimerRef.current = null;
    }, INLINE_EDIT_MENU_HANDOFF_RELEASE_DELAY_MS);
  }, []);

  const requestInlineEditMenuFocusHandoff = React.useCallback((): void => {
    shouldPreventMenuCloseAutoFocusRef.current = true;
    scheduleInlineEditMenuFocusHandoffRelease();
  }, [scheduleInlineEditMenuFocusHandoffRelease]);

  const handleInlineEditMenuCloseAutoFocus = React.useCallback(
    (event: Event): void => {
      if (!shouldPreventMenuCloseAutoFocusRef.current) {
        return;
      }

      event.preventDefault();
      scheduleInlineEditMenuFocusHandoffRelease();
    },
    [scheduleInlineEditMenuFocusHandoffRelease],
  );

  const runInlineEditMenuActionAfterClose = React.useCallback(
    (action: InlineEditMenuAction): void => {
      requestInlineEditMenuFocusHandoff();

      if (inlineEditMenuActionTimerRef.current !== null) {
        window.clearTimeout(inlineEditMenuActionTimerRef.current);
      }

      inlineEditMenuActionTimerRef.current = window.setTimeout(() => {
        inlineEditMenuActionTimerRef.current = null;

        void Promise.resolve()
          .then(action)
          .catch((error: unknown) => {
            releaseInlineEditMenuFocusHandoff();
            notifyError(error instanceof Error ? error.message : t('sftp.operationFailed'));
          });
      }, 0);
    },
    [notifyError, releaseInlineEditMenuFocusHandoff, requestInlineEditMenuFocusHandoff],
  );

  const handleInlineEditInputBlur = React.useCallback(
    (commit: InlineEditMenuAction): void => {
      if (shouldPreventMenuCloseAutoFocusRef.current) {
        window.requestAnimationFrame(focusInlineEditInput);
        scheduleInlineEditMenuFocusHandoffRelease();
        return;
      }

      void Promise.resolve()
        .then(commit)
        .catch((error: unknown) => {
          notifyError(error instanceof Error ? error.message : t('sftp.operationFailed'));
        });
    },
    [focusInlineEditInput, notifyError, scheduleInlineEditMenuFocusHandoffRelease],
  );

  React.useEffect(() => {
    if (!isInlineEditActive) {
      return undefined;
    }

    const focusFrameId = window.requestAnimationFrame(() => {
      focusInlineEditInput();
      scheduleInlineEditMenuFocusHandoffRelease();
    });

    return () => window.cancelAnimationFrame(focusFrameId);
  }, [focusInlineEditInput, isInlineEditActive, scheduleInlineEditMenuFocusHandoffRelease]);

  React.useEffect(() => {
    return () => {
      if (inlineEditMenuActionTimerRef.current !== null) {
        window.clearTimeout(inlineEditMenuActionTimerRef.current);
        inlineEditMenuActionTimerRef.current = null;
      }

      releaseInlineEditMenuFocusHandoff();
    };
  }, [releaseInlineEditMenuFocusHandoff]);

  return {
    renameInputRef,
    handleInlineEditMenuCloseAutoFocus,
    handleInlineEditInputBlur,
    runInlineEditMenuActionAfterClose,
  };
};
