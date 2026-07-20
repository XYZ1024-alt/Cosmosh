import {
  type ApiSftpEntry,
  type ApiSftpWriteFileRequest,
  type ApiSftpWriteFileResponse,
  MAX_SFTP_IMAGE_PREVIEW_WARNING_THRESHOLD_BYTES,
  MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES,
} from '@cosmosh/api-contract';
import React from 'react';

import { readSftpFile, writeSftpFile } from '../../lib/backend';
import { t } from '../../lib/i18n';
import { isDirtySftpTextPreviewState, measureUtf8ByteLength, resolvePreviewStatePath } from './sftp-page-utils';
import type {
  SftpLargePreviewPrompt,
  SftpPreviewState,
  SftpPreviewTextState,
  SftpTaskContext,
  SftpTaskOptions,
} from './sftp-types';
import {
  formatFileSize,
  isSftpImagePreviewEntry,
  isSftpTextPreviewEntry,
  resolveEntryParentPath,
  resolveSftpPreviewLanguage,
} from './sftp-utils';
import type { SftpPreviewEditorHandle } from './SftpCodeMirrorPreviewEditor';

/**
 * Inputs for SFTP preview loading and save actions.
 */
type UseSftpPreviewActionsParams = {
  activeTextPreview: SftpPreviewTextState | null;
  canUseFileActions: boolean;
  downloadEntryToImagePreviewPath: (entry: ApiSftpEntry, options?: { shouldCache?: () => boolean }) => Promise<string>;
  forceClearPreviewState: () => void;
  hasSftpSession: boolean;
  isSftpUploadConflictError: (error: unknown) => boolean;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
  previewEditorRef: React.MutableRefObject<SftpPreviewEditorHandle | null>;
  previewLoadGenerationRef: React.MutableRefObject<number>;
  previewStateRef: React.MutableRefObject<SftpPreviewState | null>;
  refreshCurrentDirectoryAfterOperation: (affectedDirectoryPaths?: readonly string[]) => Promise<void>;
  requestUploadConflictConfirmation: (prompt: {
    remotePath: string;
    name: string;
    localPath: string;
    size: number;
    modifiedAt: string;
  }) => Promise<boolean>;
  runSftpOperation: (options: SftpTaskOptions, operation: (context: SftpTaskContext) => Promise<void>) => void;
  runWithSftpReconnect: <TResult>(operation: (activeSessionId: string) => Promise<TResult>) => Promise<TResult>;
  selectedCount: number;
  selectedEntry: ApiSftpEntry | null;
  setPreviewState: React.Dispatch<React.SetStateAction<SftpPreviewState | null>>;
  sftpAuxiliarySidebarMode: string;
  sftpImagePreviewWarningThresholdBytes: number;
  sftpTextPreviewWarningThresholdBytes: number;
};

/**
 * Preview action handlers consumed by the SFTP toolbar and detail panel.
 */
type UseSftpPreviewActionsResult = {
  handleConfirmLargePreview: (prompt: SftpLargePreviewPrompt) => void;
  handlePreviewContentChange: (content: string) => void;
  handlePreviewEditorMount: (editorHandle: SftpPreviewEditorHandle) => void;
  handlePreviewRedo: () => void;
  handlePreviewSave: () => Promise<void>;
  handlePreviewUndo: () => void;
};

/**
 * Owns SFTP preview loading, editor commands, and text save behavior.
 *
 * @param params Current preview state and runtime helpers.
 * @returns Preview action handlers for toolbar/detail surfaces.
 */
export const useSftpPreviewActions = ({
  activeTextPreview,
  canUseFileActions,
  downloadEntryToImagePreviewPath,
  forceClearPreviewState,
  hasSftpSession,
  isSftpUploadConflictError,
  notifyError,
  notifySuccess,
  previewEditorRef,
  previewLoadGenerationRef,
  previewStateRef,
  refreshCurrentDirectoryAfterOperation,
  requestUploadConflictConfirmation,
  runSftpOperation,
  runWithSftpReconnect,
  selectedCount,
  selectedEntry,
  setPreviewState,
  sftpAuxiliarySidebarMode,
  sftpImagePreviewWarningThresholdBytes,
  sftpTextPreviewWarningThresholdBytes,
}: UseSftpPreviewActionsParams): UseSftpPreviewActionsResult => {
  const loadPreviewForEntry = React.useCallback(
    async (entry: ApiSftpEntry, options: { force?: boolean } = {}): Promise<void> => {
      const generation = previewLoadGenerationRef.current + 1;
      previewLoadGenerationRef.current = generation;
      previewEditorRef.current = null;

      if (!hasSftpSession || entry.type !== 'file') {
        setPreviewState({ status: 'unsupported', entry });
        return;
      }

      if (isSftpTextPreviewEntry(entry)) {
        const thresholdBytes = Math.min(
          sftpTextPreviewWarningThresholdBytes,
          MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES,
        );
        if (entry.size > MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES && options.force) {
          setPreviewState({ status: 'error', entry, message: t('sftp.previewTooLargeToOpen') });
          return;
        }

        if (!options.force && entry.size > thresholdBytes) {
          setPreviewState({
            status: 'large-file',
            prompt: { entry, previewType: 'text', thresholdBytes },
          });
          return;
        }

        setPreviewState({ status: 'loading', entry, previewType: 'text' });
        try {
          const maxBytes = Math.max(1024, Math.min(MAX_SFTP_TEXT_PREVIEW_WARNING_THRESHOLD_BYTES, entry.size || 1024));
          const response = await runWithSftpReconnect((activeSessionId) =>
            readSftpFile(activeSessionId, {
              path: entry.path,
              maxBytes,
            }),
          );
          if (previewLoadGenerationRef.current !== generation) {
            return;
          }

          if (response.data.truncated) {
            setPreviewState({ status: 'error', entry, message: t('sftp.previewTooLargeToOpen') });
            return;
          }

          const nextEntry = { ...entry, size: response.data.size };
          setPreviewState({
            status: 'text',
            entry: nextEntry,
            content: response.data.content,
            savedContent: response.data.content,
            language: resolveSftpPreviewLanguage(entry),
            remoteSnapshot: {
              size: response.data.size,
              modifiedAt: entry.modifiedAt,
            },
            isSaving: false,
          });
        } catch (error: unknown) {
          if (previewLoadGenerationRef.current === generation) {
            setPreviewState({
              status: 'error',
              entry,
              message: error instanceof Error ? error.message : t('sftp.previewFailed'),
            });
          }
        }
        return;
      }

      if (isSftpImagePreviewEntry(entry)) {
        if (entry.size > MAX_SFTP_IMAGE_PREVIEW_WARNING_THRESHOLD_BYTES) {
          setPreviewState({
            status: 'error',
            entry,
            message: t('sftp.previewImageTooLargeToOpen', {
              limit: formatFileSize(MAX_SFTP_IMAGE_PREVIEW_WARNING_THRESHOLD_BYTES),
            }),
          });
          return;
        }

        if (!options.force && entry.size > sftpImagePreviewWarningThresholdBytes) {
          setPreviewState({
            status: 'large-file',
            prompt: { entry, previewType: 'image', thresholdBytes: sftpImagePreviewWarningThresholdBytes },
          });
          return;
        }

        setPreviewState({ status: 'loading', entry, previewType: 'image' });
        try {
          const localPath = await downloadEntryToImagePreviewPath(entry, {
            shouldCache: () => previewLoadGenerationRef.current === generation,
          });
          if (previewLoadGenerationRef.current !== generation) {
            return;
          }

          const sourceDataUrl = await window.electron?.readSftpTemporaryImagePreview(localPath);
          if (!sourceDataUrl) {
            throw new Error(t('sftp.previewFailed'));
          }
          if (previewLoadGenerationRef.current !== generation) {
            return;
          }

          setPreviewState({
            status: 'image',
            entry,
            localPath,
            sourceDataUrl,
          });
        } catch (error: unknown) {
          if (previewLoadGenerationRef.current === generation) {
            setPreviewState({
              status: 'error',
              entry,
              message: error instanceof Error ? error.message : t('sftp.previewFailed'),
            });
          }
        }
        return;
      }

      setPreviewState({ status: 'unsupported', entry });
    },
    [
      downloadEntryToImagePreviewPath,
      hasSftpSession,
      previewEditorRef,
      previewLoadGenerationRef,
      runWithSftpReconnect,
      setPreviewState,
      sftpImagePreviewWarningThresholdBytes,
      sftpTextPreviewWarningThresholdBytes,
    ],
  );

  const handleConfirmLargePreview = React.useCallback(
    (prompt: SftpLargePreviewPrompt): void => {
      void loadPreviewForEntry(prompt.entry, { force: true });
    },
    [loadPreviewForEntry],
  );

  const handlePreviewContentChange = React.useCallback(
    (content: string): void => {
      setPreviewState((previous) => (previous?.status === 'text' ? { ...previous, content } : previous));
    },
    [setPreviewState],
  );

  const handlePreviewEditorMount = React.useCallback(
    (editorHandle: SftpPreviewEditorHandle): void => {
      previewEditorRef.current = editorHandle;
    },
    [previewEditorRef],
  );

  const handlePreviewUndo = React.useCallback((): void => {
    previewEditorRef.current?.undo();
  }, [previewEditorRef]);

  const handlePreviewRedo = React.useCallback((): void => {
    previewEditorRef.current?.redo();
  }, [previewEditorRef]);

  const handlePreviewSave = React.useCallback(async (): Promise<void> => {
    const preview = activeTextPreview;
    if (!preview || preview.isSaving || preview.content === preview.savedContent) {
      return;
    }

    if (!canUseFileActions) {
      notifyError(t('sftp.operationFailed'));
      return;
    }

    const content = preview.content;
    const contentSize = measureUtf8ByteLength(content);
    const setPreviewSaving = (isSaving: boolean): void => {
      setPreviewState((previous) =>
        previous?.status === 'text' && previous.entry.path === preview.entry.path
          ? { ...previous, isSaving }
          : previous,
      );
    };

    setPreviewSaving(true);
    runSftpOperation(
      {
        label: t('sftp.tasks.save'),
        detail: preview.entry.name,
        progress: { completed: 0, total: 1 },
      },
      async ({ isCurrent, update }) => {
        try {
          const payload: ApiSftpWriteFileRequest = {
            path: preview.entry.path,
            content,
            expectedSize: preview.remoteSnapshot.size,
            expectedModifiedAt: preview.remoteSnapshot.modifiedAt,
          };
          let response: ApiSftpWriteFileResponse;
          try {
            response = await runWithSftpReconnect((activeSessionId) => writeSftpFile(activeSessionId, payload));
          } catch (error: unknown) {
            if (!isSftpUploadConflictError(error) || !isCurrent()) {
              throw error;
            }

            const shouldOverwrite = await requestUploadConflictConfirmation({
              remotePath: preview.entry.path,
              name: preview.entry.name,
              localPath: preview.entry.path,
              size: contentSize,
              modifiedAt: new Date().toISOString(),
            });
            if (!shouldOverwrite || !isCurrent()) {
              update({ detail: t('sftp.tasks.saveSkipped') });
              setPreviewSaving(false);
              return;
            }

            response = await runWithSftpReconnect((activeSessionId) =>
              writeSftpFile(activeSessionId, {
                ...payload,
                overwrite: true,
              }),
            );
          }

          update({ progress: { completed: 1, total: 1 } });
          if (!isCurrent()) {
            setPreviewSaving(false);
            return;
          }

          const nextSize = response.data.size ?? contentSize;
          const nextModifiedAt = response.data.modifiedAt ?? new Date().toISOString();
          const nextEntry = {
            ...preview.entry,
            size: nextSize,
            modifiedAt: nextModifiedAt,
          };
          setPreviewState((previous) =>
            previous?.status === 'text' && previous.entry.path === preview.entry.path
              ? {
                  ...previous,
                  entry: nextEntry,
                  content,
                  savedContent: content,
                  remoteSnapshot: {
                    size: nextSize,
                    modifiedAt: nextModifiedAt,
                  },
                  isSaving: false,
                }
              : previous,
          );
          notifySuccess(t('sftp.feedback.saved'));
          await refreshCurrentDirectoryAfterOperation([resolveEntryParentPath(preview.entry.path)]);
        } catch (error: unknown) {
          setPreviewSaving(false);
          throw error;
        }
      },
    );
  }, [
    activeTextPreview,
    canUseFileActions,
    isSftpUploadConflictError,
    notifyError,
    notifySuccess,
    refreshCurrentDirectoryAfterOperation,
    requestUploadConflictConfirmation,
    runSftpOperation,
    runWithSftpReconnect,
    setPreviewState,
  ]);

  React.useEffect(() => {
    if (sftpAuxiliarySidebarMode !== 'preview') {
      if (!isDirtySftpTextPreviewState(previewStateRef.current)) {
        forceClearPreviewState();
      }
      return;
    }

    if (!hasSftpSession || selectedCount !== 1 || !selectedEntry) {
      if (!isDirtySftpTextPreviewState(previewStateRef.current)) {
        forceClearPreviewState();
      }
      return;
    }

    if (
      resolvePreviewStatePath(previewStateRef.current) === selectedEntry.path &&
      isDirtySftpTextPreviewState(previewStateRef.current)
    ) {
      return;
    }

    void loadPreviewForEntry(selectedEntry);
  }, [
    forceClearPreviewState,
    hasSftpSession,
    loadPreviewForEntry,
    previewStateRef,
    selectedCount,
    selectedEntry,
    sftpAuxiliarySidebarMode,
  ]);

  return {
    handleConfirmLargePreview,
    handlePreviewContentChange,
    handlePreviewEditorMount,
    handlePreviewRedo,
    handlePreviewSave,
    handlePreviewUndo,
  };
};
