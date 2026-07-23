import type {
  ApiSftpArchiveCapabilitiesData,
  ApiSftpArchiveCompressionLevel,
  ApiSftpArchiveConflictResolution,
  ApiSftpArchiveDestinationMode,
  ApiSftpArchiveFormat,
  ApiSftpArchiveOperationData,
  ApiSftpEntry,
} from '@cosmosh/api-contract';
import React from 'react';

import {
  cancelSftpArchiveOperation,
  getSftpArchiveCapabilities,
  getSftpArchiveOperation,
  resolveSftpArchiveConflict,
  startSftpArchiveOperation,
} from '../../lib/backend';
import { t } from '../../lib/i18n';
import {
  buildSftpArchiveDefaultStem,
  canCompressSftpEntries,
  canExtractSftpEntries,
  getArchiveStandardExtension,
  getSftpArchiveTaskStageKey,
  suggestAvailableSftpArchiveName,
} from './sftp-archive';
import type { SftpTaskContext, SftpTaskOptions } from './sftp-types';
import { SftpTaskCancelledError } from './useSftpTaskQueue';

const ARCHIVE_POLL_INTERVAL_MS = 750;

/**
 * Compression dialog state derived from the current selection and remote capabilities.
 */
export type SftpArchiveCompressionPrompt = {
  entries: ApiSftpEntry[];
  initialName: string;
  initialFormat: ApiSftpArchiveFormat;
  initialLevel: ApiSftpArchiveCompressionLevel;
  supportedFormats: ApiSftpArchiveFormat[];
  existingNames: ReadonlySet<string>;
};

/**
 * Destination dialog state for archives selected in the current directory.
 */
export type SftpArchiveDestinationPrompt = {
  entries: ApiSftpEntry[];
  initialPath: string;
};

/**
 * Conflict dialog state for one backend archive operation.
 */
export type SftpArchiveConflictPrompt = {
  operationId: string;
  conflicts: NonNullable<ApiSftpArchiveOperationData['conflicts']>;
};

type UseSftpArchiveActionsParams = {
  currentPath: string;
  directoryEntries: ApiSftpEntry[];
  notifyError: (message: string) => void;
  onOperationCompleted: () => void;
  runSftpOperation: (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>) => void;
  sessionId: string;
};

type StartCompressionInput = {
  archiveName: string;
  compressionLevel: ApiSftpArchiveCompressionLevel;
  format: ApiSftpArchiveFormat;
};

/**
 * Owns tab-local archive preferences, capability state, polling, and conflict prompts.
 *
 * @param params Active SFTP tab dependencies.
 * @returns Archive action state and handlers consumed by menus and dialogs.
 */
export const useSftpArchiveActions = ({
  currentPath,
  directoryEntries,
  notifyError,
  onOperationCompleted,
  runSftpOperation,
  sessionId,
}: UseSftpArchiveActionsParams) => {
  const [capabilities, setCapabilities] = React.useState<ApiSftpArchiveCapabilitiesData | null>(null);
  const [compressionPrompt, setCompressionPrompt] = React.useState<SftpArchiveCompressionPrompt | null>(null);
  const [conflictPrompt, setConflictPrompt] = React.useState<SftpArchiveConflictPrompt | null>(null);
  const [destinationPrompt, setDestinationPrompt] = React.useState<SftpArchiveDestinationPrompt | null>(null);
  const [preferredFormat, setPreferredFormat] = React.useState<ApiSftpArchiveFormat>('tar-gzip');
  const [preferredLevel, setPreferredLevel] = React.useState<ApiSftpArchiveCompressionLevel>('standard');
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setCapabilities(null);
    setCompressionPrompt(null);
    setConflictPrompt(null);
    setDestinationPrompt(null);
    if (!sessionId) return () => undefined;
    void getSftpArchiveCapabilities(sessionId)
      .then((response) => {
        if (!cancelled) setCapabilities(response.data);
      })
      .catch(() => {
        if (!cancelled) {
          setCapabilities({ sessionId, canExec: false, createFormats: [], extractFormats: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /** Polls one backend archive operation until its retained terminal state is observed. */
  const pollOperation = React.useCallback(
    async (operation: ApiSftpArchiveOperationData, context: SftpTaskContext): Promise<ApiSftpArchiveOperationData> => {
      let current = operation;
      let cancelRequestInFlight = false;
      context.registerCancel(() => {
        if (current.cancelRequested || cancelRequestInFlight) return;
        cancelRequestInFlight = true;
        context.update({ cancelRequested: true, detail: t('sftp.archive.stage.cancelling') });
        void cancelSftpArchiveOperation(sessionId, current.operationId)
          .then((response) => {
            current = response.data;
            context.update({
              cancelRequested: current.cancelRequested,
              detail: t('sftp.archive.stage.cancelling'),
            });
          })
          .catch((error: unknown) => {
            context.update({
              cancelRequested: false,
              detail: t(`sftp.archive.stage.${current.stage}`),
            });
            notifyError(error instanceof Error ? error.message : t('sftp.archive.cancelFailed'));
          })
          .finally(() => {
            cancelRequestInFlight = false;
          });
      });

      while (true) {
        if (!context.isCurrent()) throw new SftpTaskCancelledError();
        const isWaiting = current.state === 'awaiting-conflict';
        const isCancelling = current.cancelRequested || cancelRequestInFlight;
        context.update({
          status: isWaiting ? 'waiting' : 'running',
          detail: t(`sftp.archive.stage.${getSftpArchiveTaskStageKey(current.stage, isCancelling)}`),
          cancelRequested: isCancelling,
        });
        if (isWaiting && current.conflicts?.length) {
          setConflictPrompt({ operationId: current.operationId, conflicts: current.conflicts });
        } else {
          setConflictPrompt((previous) => (previous?.operationId === current.operationId ? null : previous));
        }
        if (current.state === 'succeeded') return current;
        if (current.state === 'cancelled') throw new SftpTaskCancelledError();
        if (current.state === 'failed') {
          throw new Error(current.errorMessage || t('sftp.archive.operationFailed'));
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, ARCHIVE_POLL_INTERVAL_MS));
        current = (await getSftpArchiveOperation(sessionId, current.operationId)).data;
      }
    },
    [notifyError, sessionId],
  );

  /** Queues one compress operation through the existing tab FIFO. */
  const startCompression = React.useCallback(
    (input: StartCompressionInput): void => {
      const prompt = compressionPrompt;
      if (!prompt || !sessionId) return;
      setCompressionPrompt(null);
      setPreferredFormat(input.format);
      setPreferredLevel(input.compressionLevel);
      runSftpOperation(
        {
          label: t('sftp.tasks.compress'),
          detail: t('sftp.archive.stage.preparing'),
        },
        async (context) => {
          const response = await startSftpArchiveOperation(sessionId, {
            type: 'compress',
            sourcePaths: prompt.entries.map((entry) => entry.path),
            targetDirectoryPath: currentPath,
            archiveName: input.archiveName,
            format: input.format,
            compressionLevel: input.compressionLevel,
          });
          await pollOperation(response.data, context);
          if (mountedRef.current) onOperationCompleted();
        },
      );
    },
    [compressionPrompt, currentPath, onOperationCompleted, pollOperation, runSftpOperation, sessionId],
  );

  /** Opens the compression form with collision-free defaults. */
  const openCompression = React.useCallback(
    (targetEntries: ApiSftpEntry[]): void => {
      if (!capabilities || !canCompressSftpEntries(targetEntries) || capabilities.createFormats.length === 0) return;
      const format = capabilities.createFormats.includes(preferredFormat)
        ? preferredFormat
        : capabilities.createFormats.includes('tar-gzip')
          ? 'tar-gzip'
          : capabilities.createFormats[0];
      if (!format) return;
      const existingNames = new Set(directoryEntries.map((entry) => entry.name));
      const preferredName = `${buildSftpArchiveDefaultStem(targetEntries, currentPath)}${getArchiveStandardExtension(format)}`;
      setCompressionPrompt({
        entries: [...targetEntries],
        initialName: suggestAvailableSftpArchiveName(preferredName, existingNames),
        initialFormat: format,
        initialLevel: format === 'tar' ? 'store' : preferredLevel === 'store' ? 'standard' : preferredLevel,
        supportedFormats: [...capabilities.createFormats],
        existingNames,
      });
    },
    [capabilities, currentPath, directoryEntries, preferredFormat, preferredLevel],
  );

  /** Queues selected archives in selection order for one validated destination. */
  const queueExtractions = React.useCallback(
    (
      targetEntries: ApiSftpEntry[],
      destinationMode: ApiSftpArchiveDestinationMode,
      targetDirectoryPath: string,
    ): void => {
      if (!sessionId || !capabilities || !canExtractSftpEntries(targetEntries, capabilities.extractFormats)) return;
      targetEntries.forEach((entry) => {
        runSftpOperation(
          {
            label: t('sftp.tasks.extract'),
            detail: t('sftp.archive.extractTaskDetail', { name: entry.name }),
          },
          async (context) => {
            const response = await startSftpArchiveOperation(sessionId, {
              type: 'extract',
              archivePath: entry.path,
              targetDirectoryPath,
              destinationMode,
            });
            await pollOperation(response.data, context);
            if (mountedRef.current) onOperationCompleted();
          },
        );
      });
    },
    [capabilities, onOperationCompleted, pollOperation, runSftpOperation, sessionId],
  );

  /** Queues extraction to the current visible directory. */
  const extractArchives = React.useCallback(
    (targetEntries: ApiSftpEntry[], destinationMode: ApiSftpArchiveDestinationMode): void => {
      queueExtractions(targetEntries, destinationMode, currentPath);
    },
    [currentPath, queueExtractions],
  );

  /** Opens the custom remote destination form for supported archive entries. */
  const openCustomExtraction = React.useCallback(
    (targetEntries: ApiSftpEntry[]): void => {
      if (!capabilities || !canExtractSftpEntries(targetEntries, capabilities.extractFormats)) return;
      setDestinationPrompt({
        entries: [...targetEntries],
        initialPath: currentPath,
      });
    },
    [capabilities, currentPath],
  );

  /** Queues current-directory extraction semantics for the custom remote target. */
  const startCustomExtraction = React.useCallback(
    (targetDirectoryPath: string): void => {
      const prompt = destinationPrompt;
      if (!prompt) return;
      setDestinationPrompt(null);
      queueExtractions(prompt.entries, 'current-directory', targetDirectoryPath);
    },
    [destinationPrompt, queueExtractions],
  );

  /** Submits the task-wide conflict decision and lets polling observe the resumed state. */
  const resolveConflict = React.useCallback(
    async (resolution: ApiSftpArchiveConflictResolution): Promise<void> => {
      const prompt = conflictPrompt;
      if (!prompt || !sessionId) return;
      try {
        setConflictPrompt(null);
        await resolveSftpArchiveConflict(sessionId, prompt.operationId, { resolution });
      } catch (error: unknown) {
        notifyError(error instanceof Error ? error.message : t('sftp.archive.conflictResolutionFailed'));
      }
    },
    [conflictPrompt, notifyError, sessionId],
  );

  return {
    capabilities,
    compressionPrompt,
    conflictPrompt,
    destinationPrompt,
    canCreateArchives: Boolean(capabilities?.canExec && capabilities.createFormats.length > 0),
    canExtractArchives: (targetEntries: ApiSftpEntry[]) =>
      canExtractSftpEntries(targetEntries, capabilities?.extractFormats ?? []),
    closeCompressionPrompt: () => setCompressionPrompt(null),
    closeDestinationPrompt: () => setDestinationPrompt(null),
    extractArchives,
    openCustomExtraction,
    openCompression,
    resolveConflict,
    startCustomExtraction,
    startCompression,
  };
};
