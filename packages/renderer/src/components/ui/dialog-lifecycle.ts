import React from 'react';

type DialogExitAnimationHandler = React.AnimationEventHandler<HTMLDivElement>;

/**
 * Composes a consumer animation handler with the shared dialog exit-completion contract.
 *
 * @param onAnimationEnd Optional consumer animation handler.
 * @param onExitComplete Optional callback invoked after the closed-state animation finishes.
 * @returns Animation handler for a Radix dialog content element.
 */
export const composeDialogExitAnimationHandler = (
  onAnimationEnd?: DialogExitAnimationHandler,
  onExitComplete?: () => void,
): DialogExitAnimationHandler => {
  return (event): void => {
    onAnimationEnd?.(event);
    if (event.target === event.currentTarget && event.currentTarget.dataset.state === 'closed') {
      onExitComplete?.();
    }
  };
};

/**
 * Retains the last non-null dialog payload while the exit animation is running.
 *
 * @param value Current payload that also controls whether the dialog is open.
 * @returns The payload to render and a callback that releases the retained snapshot after exit.
 */
export const useDialogExitSnapshot = <T>(value: T | null): readonly [T | null, () => void] => {
  const snapshotRef = React.useRef<T | null>(value);

  React.useLayoutEffect(() => {
    if (value !== null) {
      snapshotRef.current = value;
    }
  }, [value]);

  const clearSnapshot = React.useCallback((): void => {
    snapshotRef.current = null;
  }, []);

  return [value ?? snapshotRef.current, clearSnapshot] as const;
};
