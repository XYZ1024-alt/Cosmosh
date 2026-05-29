import type { ApiSftpEntry } from '@cosmosh/api-contract';
import { File, Info } from 'lucide-react';
import React from 'react';

import { t } from '../../lib/i18n';
import { SFTP_CARD_CLASS_NAME } from './sftp-constants';
import type { FilePreviewState } from './sftp-types';
import { formatFileSize, formatModifiedAt, resolveEntryIcon } from './sftp-utils';

/**
 * Props for the right-side SFTP details panel.
 */
type SftpDetailPanelProps = {
  filePreview: FilePreviewState | null;
  selectedCount: number;
  selectedEntry: ApiSftpEntry | null;
};

/**
 * Renders selected-entry details and file previews.
 *
 * @param props Selected entry and preview state.
 * @returns SFTP details panel.
 */
export const SftpDetailPanel: React.FC<SftpDetailPanelProps> = ({ filePreview, selectedCount, selectedEntry }) => {
  return (
    <aside className={SFTP_CARD_CLASS_NAME}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[34px] shrink-0 items-center gap-2 px-2">
          <Info className="h-4 w-4 shrink-0 text-home-text-subtle" />
          <div className="text-home-text min-w-0 flex-1 truncate text-sm font-medium">
            {filePreview ? t('sftp.previewTitle') : t('sftp.detailTitle')}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {filePreview ? (
            <div className="flex h-full min-h-0 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <File className="text-home-text h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-home-text truncate text-sm font-medium">{filePreview.name}</div>
                  <div className="mt-0.5 text-xs text-home-text-subtle">
                    {formatFileSize(filePreview.size)}
                    {filePreview.truncated ? ` · ${t('sftp.previewTruncated')}` : ''}
                  </div>
                </div>
              </div>
              <pre className="bg-home-card/70 text-home-text min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-home-divider p-2 font-mono text-xs leading-5">
                {filePreview.content || t('sftp.previewEmpty')}
              </pre>
            </div>
          ) : selectedCount > 1 ? (
            <div className="space-y-3">
              <div className="text-sm text-home-text-subtle">
                {t('sftp.detailSelectedMany', { count: selectedCount })}
              </div>
            </div>
          ) : selectedEntry ? (
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
};
