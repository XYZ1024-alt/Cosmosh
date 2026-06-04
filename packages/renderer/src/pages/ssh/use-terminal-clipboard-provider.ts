import { DEFAULT_TERMINAL_CLIPBOARD_ACCESS, type TerminalClipboardAccess } from '@cosmosh/api-contract';
import type { IClipboardProvider } from '@xterm/addon-clipboard';
import React from 'react';

import { t } from '../../lib/i18n';
import type { ToastContextValue } from '../../lib/toast-context';
import type { ResolvedTerminalTarget } from './ssh-types';

type TerminalClipboardOperation = 'read' | 'write';

type TerminalClipboardPrompt = {
  id: string;
  operation: TerminalClipboardOperation;
  sourceLabel: string;
  preview: string;
};

export type TerminalClipboardPromptState = TerminalClipboardPrompt | null;

export type TerminalClipboardPromptResolver = (accepted: boolean) => void;

export type TerminalClipboardPromptResolution = {
  prompt: TerminalClipboardPromptState;
  resolvePrompt: TerminalClipboardPromptResolver;
};

type TerminalClipboardProviderOptions = {
  localTerminalClipboardAccess: TerminalClipboardAccess;
  toast: Pick<ToastContextValue, 'info' | 'warning' | 'error'>;
};

type TerminalClipboardAccessSnapshot = {
  mode: TerminalClipboardAccess;
  sourceLabel: string;
} | null;

export type TerminalClipboardProvider = IClipboardProvider & {
  setActiveTarget: (target: ResolvedTerminalTarget | null) => void;
};

const CLIPBOARD_PREVIEW_MAX_LENGTH = 120;

/**
 * Formats a compact preview for permission prompts without flooding the dialog.
 *
 * @param text Clipboard payload text.
 * @returns One-line preview.
 */
const formatClipboardPreview = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= CLIPBOARD_PREVIEW_MAX_LENGTH) {
    return compact;
  }

  return `${compact.slice(0, CLIPBOARD_PREVIEW_MAX_LENGTH - 3)}...`;
};

/**
 * Resolves whether an operation should run automatically for one access mode.
 *
 * @param mode Clipboard access mode.
 * @param operation Clipboard operation.
 * @returns True when the operation is allowed without a prompt.
 */
const isClipboardOperationAllowedWithoutPrompt = (
  mode: TerminalClipboardAccess,
  operation: TerminalClipboardOperation,
): boolean => {
  if (mode === 'readWrite') {
    return true;
  }

  return mode === 'writeAskRead' && operation === 'write';
};

/**
 * Resolves whether an operation should ask the user for one access mode.
 *
 * @param mode Clipboard access mode.
 * @param operation Clipboard operation.
 * @returns True when the operation should open a confirmation dialog.
 */
const shouldAskForClipboardOperation = (
  mode: TerminalClipboardAccess,
  operation: TerminalClipboardOperation,
): boolean => {
  if (mode === 'askAlways') {
    return true;
  }

  return mode === 'writeAskRead' && operation === 'read';
};

/**
 * Creates a terminal clipboard provider with policy-aware OSC 52 access checks.
 *
 * @param options Global settings and toast callbacks.
 * @param requestPermission Prompt callback used for ask modes.
 * @returns Clipboard provider plus active-target setter.
 */
const createTerminalClipboardProvider = (
  optionsRef: React.RefObject<TerminalClipboardProviderOptions>,
  requestPermission: (operation: TerminalClipboardOperation, sourceLabel: string, preview: string) => Promise<boolean>,
): TerminalClipboardProvider => {
  let activeTarget: ResolvedTerminalTarget | null = null;

  const resolveAccessSnapshot = (): TerminalClipboardAccessSnapshot => {
    if (!activeTarget) {
      return null;
    }

    if (activeTarget.type === 'local-terminal') {
      return {
        mode: optionsRef.current.localTerminalClipboardAccess,
        sourceLabel: activeTarget.profileName?.trim() || t('tabs.page.localTerminal'),
      };
    }

    return {
      mode: activeTarget.server.terminalClipboardAccess ?? DEFAULT_TERMINAL_CLIPBOARD_ACCESS,
      sourceLabel: activeTarget.server.name.trim() || t('tabs.page.ssh'),
    };
  };

  const ensureAllowed = async (
    operation: TerminalClipboardOperation,
    preview: string,
  ): Promise<{ allowed: boolean; prompted: boolean; sourceLabel: string }> => {
    const snapshot = resolveAccessSnapshot();
    const sourceLabel = snapshot?.sourceLabel ?? t('tabs.page.ssh');
    const { toast } = optionsRef.current;

    if (!snapshot || snapshot.mode === 'off') {
      toast.warning(t(`ssh.terminalClipboard.${operation}Blocked`, { source: sourceLabel }));
      return { allowed: false, prompted: false, sourceLabel };
    }

    if (isClipboardOperationAllowedWithoutPrompt(snapshot.mode, operation)) {
      return { allowed: true, prompted: false, sourceLabel };
    }

    if (shouldAskForClipboardOperation(snapshot.mode, operation)) {
      const accepted = await requestPermission(operation, sourceLabel, preview);
      if (!accepted) {
        toast.warning(t(`ssh.terminalClipboard.${operation}Denied`, { source: sourceLabel }));
      }
      return { allowed: accepted, prompted: accepted, sourceLabel };
    }

    toast.warning(t(`ssh.terminalClipboard.${operation}Blocked`, { source: sourceLabel }));
    return { allowed: false, prompted: false, sourceLabel };
  };

  return {
    setActiveTarget: (target) => {
      activeTarget = target;
    },
    readText: async (selection) => {
      if (selection !== 'c') {
        return '';
      }

      const permission = await ensureAllowed('read', '');
      if (!permission.allowed) {
        return '';
      }

      try {
        const text = await navigator.clipboard.readText();
        if (!permission.prompted) {
          optionsRef.current.toast.info(t('ssh.terminalClipboard.readAllowed', { source: permission.sourceLabel }));
        }
        return text;
      } catch (error: unknown) {
        optionsRef.current.toast.error(
          error instanceof Error
            ? error.message
            : t('ssh.terminalClipboard.readFailed', { source: permission.sourceLabel }),
        );
        return '';
      }
    },
    writeText: async (selection, text) => {
      if (selection !== 'c') {
        return;
      }

      const permission = await ensureAllowed('write', formatClipboardPreview(text));
      if (!permission.allowed) {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        if (!permission.prompted) {
          optionsRef.current.toast.info(t('ssh.terminalClipboard.writeAllowed', { source: permission.sourceLabel }));
        }
      } catch (error: unknown) {
        optionsRef.current.toast.error(
          error instanceof Error
            ? error.message
            : t('ssh.terminalClipboard.writeFailed', { source: permission.sourceLabel }),
        );
      }
    },
  };
};

/**
 * Creates the stable OSC 52 clipboard provider used by all SSH page panes.
 *
 * @param options Settings and toast callbacks.
 * @returns Provider object plus confirmation prompt state.
 */
export const useTerminalClipboardProvider = (
  options: TerminalClipboardProviderOptions,
): { provider: TerminalClipboardProvider; promptState: TerminalClipboardPromptResolution } => {
  const optionsRef = React.useRef<TerminalClipboardProviderOptions>(options);
  const promptResolverRef = React.useRef<TerminalClipboardPromptResolver | null>(null);
  const [prompt, setPrompt] = React.useState<TerminalClipboardPromptState>(null);

  React.useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const requestPermission = React.useCallback(
    (operation: TerminalClipboardOperation, sourceLabel: string, preview: string): Promise<boolean> => {
      return new Promise((resolve) => {
        promptResolverRef.current?.(false);
        promptResolverRef.current = resolve;
        setPrompt({
          id:
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          operation,
          sourceLabel,
          preview,
        });
      });
    },
    [],
  );

  const providerRef = React.useRef<TerminalClipboardProvider | null>(null);
  if (!providerRef.current) {
    providerRef.current = createTerminalClipboardProvider(optionsRef, async (operation, sourceLabel, preview) =>
      requestPermission(operation, sourceLabel, preview),
    );
  }

  const resolvePrompt = React.useCallback((accepted: boolean): void => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPrompt(null);
    resolver?.(accepted);
  }, []);

  React.useEffect(() => {
    return () => {
      promptResolverRef.current?.(false);
      promptResolverRef.current = null;
    };
  }, []);

  return {
    provider: providerRef.current,
    promptState: {
      prompt,
      resolvePrompt,
    },
  };
};
