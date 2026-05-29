import type { ApiSftpEntry, ApiSftpEntryDetailsItem } from '@cosmosh/api-contract';
import { Files, Loader2, ShieldAlert } from 'lucide-react';
import React from 'react';

import { Button } from '../../components/ui/button';
import { getBackendRuntimeTarget, getSftpEntryDetails } from '../../lib/backend';
import { t } from '../../lib/i18n';
import { SFTP_CARD_CLASS_NAME } from './sftp-constants';
import { formatFileSize, formatModifiedAt, formatRawDataJson, resolveEntryIcon } from './sftp-utils';

type SftpPropertiesParams = {
  entryName: string;
  entryPaths: string[];
  sessionId: string;
};

type PropertyRow = {
  label: string;
  value: React.ReactNode;
};

type SuccessfulDetailsItem = ApiSftpEntryDetailsItem & {
  entry: ApiSftpEntry;
};

const RAW_DATA_UNLOCK_CLICK_COUNT = 7;

/**
 * Reads and validates SFTP properties route params from the popup URL.
 *
 * @returns Parsed route params.
 */
const readSftpPropertiesParams = (): SftpPropertiesParams => {
  const searchParams = new URLSearchParams(window.location.search);
  const entryPaths = searchParams.getAll('path').filter((pathValue) => pathValue.trim().length > 0);

  return {
    entryName: searchParams.get('name') ?? '',
    entryPaths,
    sessionId: searchParams.get('sessionId') ?? '',
  };
};

/**
 * Checks whether a details item has displayable entry metadata.
 *
 * @param item Details item returned by the backend.
 * @returns Whether the item contains a successful entry payload.
 */
const isSuccessfulDetailsItem = (item: ApiSftpEntryDetailsItem): item is SuccessfulDetailsItem => {
  return item.status === 'success' && Boolean(item.entry);
};

/**
 * Formats numeric values for compact read-only property rows.
 *
 * @param value Numeric value returned by the SFTP API.
 * @returns Formatted number or placeholder.
 */
const formatNumericProperty = (value: number): string => {
  return Number.isFinite(value) ? String(value) : '-';
};

/**
 * Formats optional values for read-only property rows.
 *
 * @param value Optional SFTP metadata value.
 * @returns Displayable value or placeholder.
 */
const formatOptionalProperty = (value: string | undefined): string => {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : '-';
};

/**
 * Formats the hidden metadata flag for read-only property rows.
 *
 * @param isHidden Whether the SFTP entry is hidden.
 * @returns Localized hidden-state value.
 */
const formatHiddenStateProperty = (isHidden: boolean): string => {
  return t(isHidden ? 'sftp.properties.hiddenState.hidden' : 'sftp.properties.hiddenState.visible');
};

/**
 * Resolves a common string value, returning null when selected entries differ.
 *
 * @param values Values collected from selected entries.
 * @returns Shared value, empty string for shared missing values, or null for mixed values.
 */
const resolveCommonTextValue = (values: Array<string | undefined>): string | null => {
  if (values.length === 0) {
    return '';
  }

  const normalizedValues = values.map((value) => value?.trim() ?? '');
  const [firstValue] = normalizedValues;
  return normalizedValues.every((value) => value === firstValue) ? (firstValue ?? '') : null;
};

/**
 * Formats a common string value for multi-entry property rows.
 *
 * @param values Values collected from selected entries.
 * @returns Common value, mixed marker, or placeholder.
 */
const formatCommonProperty = (values: Array<string | undefined>): string => {
  const commonValue = resolveCommonTextValue(values);
  return commonValue === null ? t('sftp.properties.mixed') : formatOptionalProperty(commonValue);
};

/**
 * Formats a common numeric value for multi-entry property rows.
 *
 * @param values Numeric values collected from selected entries.
 * @returns Common value, mixed marker, or placeholder.
 */
const formatCommonNumericProperty = (values: number[]): string => {
  if (values.length === 0) {
    return '-';
  }

  const [firstValue] = values;
  return values.every((value) => value === firstValue)
    ? formatNumericProperty(firstValue ?? Number.NaN)
    : t('sftp.properties.mixed');
};

/**
 * Formats a common timestamp for multi-entry property rows.
 *
 * @param values Timestamp values collected from selected entries.
 * @returns Localized common timestamp, mixed marker, or placeholder.
 */
const formatCommonDateProperty = (values: string[]): string => {
  const commonValue = resolveCommonTextValue(values);
  if (commonValue === null) {
    return t('sftp.properties.mixed');
  }

  return commonValue ? formatModifiedAt(commonValue) : '-';
};

/**
 * Formats bytes with both compact and raw byte labels.
 *
 * @param size Byte size.
 * @returns Human-readable size plus raw bytes.
 */
const formatSizeProperty = (size: number): string => {
  return `${formatFileSize(size)} (${size} B)`;
};

/**
 * Resolves a page title for the popup document.
 *
 * @param entryName Remote entry name for single-entry windows.
 * @param entryCount Number of requested entries.
 * @returns Browser/Electron window title.
 */
const resolveDocumentTitle = (entryName: string, entryCount: number): string => {
  if (entryCount > 1) {
    return t('sftp.properties.windowTitleWithCount', { count: entryCount });
  }

  return entryName ? t('sftp.properties.windowTitleWithName', { name: entryName }) : t('sftp.properties.windowTitle');
};

/**
 * Counts loaded entries by SFTP entry type.
 *
 * @param entries Loaded SFTP entries.
 * @returns Entry counts keyed by type.
 */
const countEntriesByType = (entries: ApiSftpEntry[]): Record<ApiSftpEntry['type'], number> => {
  return entries.reduce<Record<ApiSftpEntry['type'], number>>(
    (counts, entry) => ({
      ...counts,
      [entry.type]: counts[entry.type] + 1,
    }),
    {
      directory: 0,
      file: 0,
      other: 0,
      symlink: 0,
    },
  );
};

/**
 * Renders a dense definition-list section using existing SFTP surface tokens.
 *
 * @param props Section title, rows, and optional footer.
 * @returns Properties section.
 */
const PropertiesSection: React.FC<{ footer?: React.ReactNode; rows: PropertyRow[]; title: string }> = ({
  footer,
  rows,
  title,
}) => {
  return (
    <section className="border-t border-home-divider pt-3">
      <div className="text-home-text min-w-0 truncate text-sm font-medium">{title}</div>
      <dl className="mt-3 space-y-3 text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[118px_minmax(0,1fr)] gap-3"
          >
            <dt className="select-text text-xs text-home-text-subtle">{row.label}</dt>
            <dd className="text-home-text min-w-0 select-text break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      {footer ? <div className="mt-3 flex justify-end">{footer}</div> : null}
    </section>
  );
};

/**
 * Renders the standalone SFTP entry properties window content.
 *
 * @returns SFTP entry properties page.
 */
const SftpEntryPropertiesPage: React.FC = () => {
  const params = React.useMemo(readSftpPropertiesParams, []);
  const [detailsItems, setDetailsItems] = React.useState<ApiSftpEntryDetailsItem[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [errorMessage, setErrorMessage] = React.useState<string>('');
  const [rawDataUnlockClickCount, setRawDataUnlockClickCount] = React.useState(0);
  const shouldShowRawData = rawDataUnlockClickCount >= RAW_DATA_UNLOCK_CLICK_COUNT;

  React.useEffect(() => {
    document.title = resolveDocumentTitle(params.entryName, params.entryPaths.length);
  }, [params.entryName, params.entryPaths.length]);

  React.useEffect(() => {
    if (getBackendRuntimeTarget() !== 'electron') {
      setStatus('unsupported');
      setErrorMessage(t('sftp.properties.browserUnsupported'));
      return;
    }

    if (!params.sessionId || params.entryPaths.length === 0) {
      setStatus('error');
      setErrorMessage(t('sftp.properties.missingPayload'));
      return;
    }

    let isCancelled = false;
    setStatus('loading');
    setErrorMessage('');
    setDetailsItems([]);
    setRawDataUnlockClickCount(0);

    void getSftpEntryDetails(params.sessionId, { paths: params.entryPaths })
      .then((response) => {
        if (isCancelled) {
          return;
        }

        const nextDetailsItems = response.data.entries;
        const successfulItems = nextDetailsItems.filter(isSuccessfulDetailsItem);
        setDetailsItems(nextDetailsItems);

        if (params.entryPaths.length === 1 && nextDetailsItems[0]?.status === 'failed') {
          setStatus('error');
          setErrorMessage(nextDetailsItems[0].message ?? t('sftp.properties.loadFailed'));
          return;
        }

        if (successfulItems.length === 0) {
          setStatus('error');
          setErrorMessage(t('sftp.properties.notFound'));
          return;
        }

        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }

        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : t('sftp.properties.loadFailed'));
      });

    return () => {
      isCancelled = true;
    };
  }, [params.entryPaths, params.sessionId]);

  const successfulItems = React.useMemo(() => detailsItems.filter(isSuccessfulDetailsItem), [detailsItems]);
  const entries = React.useMemo(() => successfulItems.map((item) => item.entry), [successfulItems]);
  const entry = entries[0] ?? null;
  const isMultiEntry = params.entryPaths.length > 1;
  const failedCount = detailsItems.filter((item) => item.status === 'failed').length;
  const typeCounts = React.useMemo(() => countEntriesByType(entries), [entries]);
  const totalSize = React.useMemo(() => entries.reduce((sum, currentEntry) => sum + currentEntry.size, 0), [entries]);

  const generalRows = React.useMemo<PropertyRow[]>(() => {
    if (entries.length === 0 || !entry) {
      return [];
    }

    if (isMultiEntry) {
      return [
        {
          label: t('sftp.properties.field.selected'),
          value: String(params.entryPaths.length),
        },
        ...(failedCount > 0
          ? [
              {
                label: t('sftp.properties.field.failed'),
                value: String(failedCount),
              },
            ]
          : []),
        {
          label: t('sftp.properties.field.type'),
          value: formatCommonProperty(entries.map((currentEntry) => t(`sftp.entryType.${currentEntry.type}`))),
        },
        {
          label: t('sftp.properties.field.hidden'),
          value: formatCommonProperty(entries.map((currentEntry) => formatHiddenStateProperty(currentEntry.isHidden))),
        },
        {
          label: t('sftp.properties.field.parentPath'),
          value: (
            <span className="font-mono text-xs">{formatCommonProperty(entries.map((item) => item.parentPath))}</span>
          ),
        },
        {
          label: t('sftp.properties.field.totalSize'),
          value: formatSizeProperty(totalSize),
        },
        ...(typeCounts.file > 0
          ? [
              {
                label: t('sftp.properties.field.files'),
                value: String(typeCounts.file),
              },
            ]
          : []),
        ...(typeCounts.directory > 0
          ? [
              {
                label: t('sftp.properties.field.directories'),
                value: String(typeCounts.directory),
              },
            ]
          : []),
        ...(typeCounts.symlink > 0
          ? [
              {
                label: t('sftp.properties.field.symlinks'),
                value: String(typeCounts.symlink),
              },
            ]
          : []),
        ...(typeCounts.other > 0
          ? [
              {
                label: t('sftp.properties.field.other'),
                value: String(typeCounts.other),
              },
            ]
          : []),
        {
          label: t('sftp.properties.field.extension'),
          value: formatCommonProperty(entries.map((currentEntry) => currentEntry.extension)),
        },
        {
          label: t('sftp.properties.field.modified'),
          value: formatCommonDateProperty(entries.map((currentEntry) => currentEntry.modifiedAt)),
        },
        {
          label: t('sftp.properties.field.accessed'),
          value: formatCommonDateProperty(entries.map((currentEntry) => currentEntry.accessedAt)),
        },
      ];
    }

    return [
      {
        label: t('sftp.properties.field.type'),
        value: t(`sftp.entryType.${entry.type}`),
      },
      {
        label: t('sftp.properties.field.hidden'),
        value: formatHiddenStateProperty(entry.isHidden),
      },
      {
        label: t('sftp.properties.field.path'),
        value: <span className="font-mono text-xs">{entry.path}</span>,
      },
      {
        label: t('sftp.properties.field.parentPath'),
        value: <span className="font-mono text-xs">{formatOptionalProperty(entry.parentPath)}</span>,
      },
      {
        label: t('sftp.properties.field.size'),
        value: entry.type === 'directory' ? '-' : formatSizeProperty(entry.size),
      },
      {
        label: t('sftp.properties.field.extension'),
        value: formatOptionalProperty(entry.extension),
      },
      {
        label: t('sftp.properties.field.modified'),
        value: formatModifiedAt(entry.modifiedAt),
      },
      {
        label: t('sftp.properties.field.accessed'),
        value: formatModifiedAt(entry.accessedAt),
      },
    ];
  }, [entries, entry, failedCount, isMultiEntry, params.entryPaths.length, totalSize, typeCounts]);

  const permissionRows = React.useMemo<PropertyRow[]>(() => {
    if (entries.length === 0 || !entry) {
      return [];
    }

    if (isMultiEntry) {
      return [
        {
          label: t('sftp.properties.field.permissions'),
          value: (
            <span className="font-mono text-xs">{formatCommonProperty(entries.map((item) => item.permissions))}</span>
          ),
        },
        {
          label: t('sftp.properties.field.octalMode'),
          value: (
            <span className="font-mono text-xs">
              {formatCommonProperty(entries.map((item) => item.permissionOctal))}
            </span>
          ),
        },
        {
          label: t('sftp.properties.field.rawMode'),
          value: (
            <span className="font-mono text-xs">{formatCommonNumericProperty(entries.map((item) => item.mode))}</span>
          ),
        },
        {
          label: t('sftp.properties.field.uid'),
          value: formatCommonNumericProperty(entries.map((item) => item.uid)),
        },
        {
          label: t('sftp.properties.field.gid'),
          value: formatCommonNumericProperty(entries.map((item) => item.gid)),
        },
      ];
    }

    return [
      {
        label: t('sftp.properties.field.permissions'),
        value: <span className="font-mono text-xs">{entry.permissions}</span>,
      },
      {
        label: t('sftp.properties.field.octalMode'),
        value: <span className="font-mono text-xs">{entry.permissionOctal}</span>,
      },
      {
        label: t('sftp.properties.field.rawMode'),
        value: <span className="font-mono text-xs">{formatNumericProperty(entry.mode)}</span>,
      },
      {
        label: t('sftp.properties.field.uid'),
        value: formatNumericProperty(entry.uid),
      },
      {
        label: t('sftp.properties.field.gid'),
        value: formatNumericProperty(entry.gid),
      },
    ];
  }, [entries, entry, isMultiEntry]);

  const symlinkRows = React.useMemo<PropertyRow[]>(() => {
    const target = isMultiEntry ? undefined : entry?.symlinkTarget;
    if (!target) {
      return [];
    }

    return [
      {
        label: t('sftp.properties.field.symlinkStatus'),
        value: t(`sftp.properties.symlinkStatus.${target.status}`),
      },
      {
        label: t('sftp.properties.field.symlinkTarget'),
        value: <span className="font-mono text-xs">{formatOptionalProperty(target.path)}</span>,
      },
      {
        label: t('sftp.properties.field.symlinkResolvedPath'),
        value: <span className="font-mono text-xs">{formatOptionalProperty(target.resolvedPath)}</span>,
      },
      {
        label: t('sftp.properties.field.symlinkTargetType'),
        value: target.type ? t(`sftp.entryType.${target.type}`) : '-',
      },
      {
        label: t('sftp.properties.field.symlinkTargetSize'),
        value: target.size === undefined ? '-' : formatSizeProperty(target.size),
      },
    ];
  }, [entry, isMultiEntry]);

  const rawDataPayload = React.useMemo(() => {
    return {
      request: {
        paths: params.entryPaths,
        requestedCount: params.entryPaths.length,
        sessionId: params.sessionId,
      },
      response: {
        entries: detailsItems,
      },
    };
  }, [detailsItems, params.entryPaths, params.sessionId]);

  /**
   * Unlocks raw metadata after an intentional repeated click gesture.
   *
   * @returns void.
   */
  const handleRawDataUnlockClick = React.useCallback((): void => {
    setRawDataUnlockClickCount((previousCount) => Math.min(RAW_DATA_UNLOCK_CLICK_COUNT, previousCount + 1));
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg p-2 text-text">
      <main className={`${SFTP_CARD_CLASS_NAME} w-full`}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {status === 'loading' ? (
              <div className="flex h-full min-h-0 items-center justify-center gap-2 text-sm text-home-text-subtle">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('sftp.properties.loading')}
              </div>
            ) : status === 'error' || status === 'unsupported' ? (
              <div className="flex h-full min-h-0 items-center justify-center px-6 text-center">
                <div className="flex max-w-[360px] flex-col items-center gap-3">
                  <ShieldAlert className="h-5 w-5 text-form-message-error" />
                  <div className="text-home-text text-sm">{errorMessage || t('sftp.properties.loadFailed')}</div>
                </div>
              </div>
            ) : entry ? (
              <div className="space-y-4">
                <section
                  className="flex min-w-0 items-center gap-3"
                  onClick={handleRawDataUnlockClick}
                >
                  {isMultiEntry ? <Files className="text-home-text h-4 w-4 shrink-0" /> : resolveEntryIcon(entry)}
                  <div className="min-w-0 flex-1">
                    <div className="text-home-text select-text truncate text-base font-medium">
                      {isMultiEntry
                        ? t('sftp.properties.multipleItemsTitle', { count: params.entryPaths.length })
                        : entry.name}
                    </div>
                    <div className="mt-0.5 select-text text-xs text-home-text-subtle">
                      {isMultiEntry ? t('sftp.properties.selectionSubtitle') : t(`sftp.entryType.${entry.type}`)}
                    </div>
                  </div>
                </section>

                <PropertiesSection
                  title={t('sftp.properties.generalTitle')}
                  rows={generalRows}
                />
                <PropertiesSection
                  title={t('sftp.properties.permissionsTitle')}
                  rows={permissionRows}
                  footer={<Button disabled>{t('sftp.properties.edit')}</Button>}
                />
                {symlinkRows.length > 0 ? (
                  <PropertiesSection
                    title={t('sftp.properties.symlinkTitle')}
                    rows={symlinkRows}
                  />
                ) : null}
                {shouldShowRawData ? (
                  <section className="border-t border-home-divider pt-3">
                    <div className="text-home-text min-w-0 select-text truncate text-sm font-medium">
                      {t('sftp.properties.rawDataTitle')}
                    </div>
                    <pre className="bg-home-card/60 text-home-text mt-3 max-h-[360px] select-text overflow-auto whitespace-pre-wrap break-words rounded-md border border-home-divider p-2 font-mono text-[11px] leading-4">
                      {formatRawDataJson(rawDataPayload)}
                    </pre>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center text-sm text-home-text-subtle">
                {t('sftp.properties.notFound')}
              </div>
            )}
          </div>
          <div className="flex h-[42px] shrink-0 justify-end border-t border-home-divider px-3 py-1.5">
            <Button
              variant="ghost"
              padding="mid"
              onClick={() => window.close()}
            >
              {t('sftp.properties.close')}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SftpEntryPropertiesPage;
