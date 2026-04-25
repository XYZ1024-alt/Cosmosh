import type {
  ApiAuditEventDetailResponse,
  ApiAuditEventListQuery,
  ApiAuditEventListResponse,
} from '@cosmosh/api-contract';
import classNames from 'classnames';
import { ChevronLeft, ChevronRight, RefreshCcw, Search } from 'lucide-react';
import React from 'react';

import SplitWorkbenchLayout, { SplitWorkbenchMainPanel } from '../components/layout/SplitWorkbenchLayout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getAuditEventById, listAuditEvents } from '../lib/backend';
import { t } from '../lib/i18n';
import { useToast } from '../lib/toast-context';

type TimeRangePreset = '24h' | '7d' | '30d' | '180d';

type AuditEventListItem = ApiAuditEventListResponse['data']['items'][number];
type AuditEventDetailItem = ApiAuditEventDetailResponse['data']['item'];

const DEFAULT_PAGE_SIZE = 50;
const ALL_CATEGORY_FILTER_VALUE = '__all_categories__';
const ALL_OUTCOME_FILTER_VALUE = '__all_outcomes__';

/**
 * Resolves list query start time from a preset value.
 *
 * @param preset Time range preset.
 * @returns Date object used for list filtering.
 */
const resolvePresetStartAt = (preset: TimeRangePreset): Date => {
  const now = Date.now();

  if (preset === '24h') {
    return new Date(now - 24 * 60 * 60 * 1000);
  }

  if (preset === '7d') {
    return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }

  if (preset === '30d') {
    return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }

  return new Date(now - 180 * 24 * 60 * 60 * 1000);
};

/**
 * Formats ISO timestamp into compact local display.
 *
 * @param isoValue ISO date-time string.
 * @returns Localized timestamp text.
 */
const formatOccurredAt = (isoValue: string): string => {
  const parsedDate = new Date(isoValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return isoValue;
  }

  return parsedDate.toLocaleString();
};

/**
 * Formats metadata object to readable JSON block.
 *
 * @param metadata Metadata object.
 * @returns Pretty JSON string.
 */
const formatMetadataJson = (metadata: Record<string, unknown>): string => {
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return '{}';
  }
};

const AuditLogs: React.FC = () => {
  const { warning: notifyWarning } = useToast();

  const [searchKeyword, setSearchKeyword] = React.useState<string>('');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('');
  const [outcomeFilter, setOutcomeFilter] = React.useState<string>('');
  const [timeRangePreset, setTimeRangePreset] = React.useState<TimeRangePreset>('180d');
  const [page, setPage] = React.useState<number>(1);

  const [loadingList, setLoadingList] = React.useState<boolean>(false);
  const [listResponse, setListResponse] = React.useState<ApiAuditEventListResponse | null>(null);
  const [selectedEventId, setSelectedEventId] = React.useState<string>('');

  const [loadingDetail, setLoadingDetail] = React.useState<boolean>(false);
  const [detail, setDetail] = React.useState<AuditEventDetailItem | null>(null);

  const query = React.useMemo<ApiAuditEventListQuery>(() => {
    const startAt = resolvePresetStartAt(timeRangePreset);
    const endAt = new Date();

    return {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      ...(searchKeyword.trim().length > 0 ? { keyword: searchKeyword.trim() } : {}),
      ...(categoryFilter.trim().length > 0 ? { category: categoryFilter } : {}),
      ...(outcomeFilter.trim().length > 0 ? { outcome: outcomeFilter } : {}),
    };
  }, [categoryFilter, outcomeFilter, page, searchKeyword, timeRangePreset]);

  const refreshList = React.useCallback(async () => {
    setLoadingList(true);

    try {
      const response = await listAuditEvents(query);
      setListResponse(response);

      const firstEventId = response.data.items[0]?.eventId ?? '';
      const selectedStillVisible = response.data.items.some((item) => item.eventId === selectedEventId);
      if (!selectedStillVisible) {
        setSelectedEventId(firstEventId);
      }
    } catch (error: unknown) {
      notifyWarning(error instanceof Error ? error.message : t('auditLogs.loadFailed'));
      setListResponse(null);
      setSelectedEventId('');
    } finally {
      setLoadingList(false);
    }
  }, [notifyWarning, query, selectedEventId]);

  React.useEffect(() => {
    void refreshList();
  }, [refreshList]);

  React.useEffect(() => {
    if (!selectedEventId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);

    void getAuditEventById(selectedEventId)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setDetail(response.data.item);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        notifyWarning(error instanceof Error ? error.message : t('auditLogs.detailLoadFailed'));
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [notifyWarning, selectedEventId]);

  const listItems: AuditEventListItem[] = listResponse?.data.items ?? [];
  const pagination = listResponse?.data.pagination;

  return (
    <SplitWorkbenchLayout
      sidebar={
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 pb-3">
            <div className="relative">
              <Input
                value={searchKeyword}
                placeholder={t('auditLogs.filters.keywordPlaceholder')}
                className="pr-9"
                onChange={(event) => {
                  setPage(1);
                  setSearchKeyword(event.target.value);
                }}
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-header-text-muted" />
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor="audit-logs-category-filter"
                className="px-0 text-xs font-medium text-home-text-subtle"
              >
                {t('auditLogs.filters.category')}
              </Label>
              <Select
                value={categoryFilter || ALL_CATEGORY_FILTER_VALUE}
                onValueChange={(value) => {
                  setPage(1);
                  setCategoryFilter(value === ALL_CATEGORY_FILTER_VALUE ? '' : value);
                }}
              >
                <SelectTrigger id="audit-logs-category-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORY_FILTER_VALUE}>{t('auditLogs.filters.allCategories')}</SelectItem>
                  <SelectItem value="ssh-session">{t('auditLogs.categories.sshSession')}</SelectItem>
                  <SelectItem value="ssh-server">{t('auditLogs.categories.sshServer')}</SelectItem>
                  <SelectItem value="ssh-keychain">{t('auditLogs.categories.sshKeychain')}</SelectItem>
                  <SelectItem value="settings">{t('auditLogs.categories.settings')}</SelectItem>
                  <SelectItem value="ssh-host-trust">{t('auditLogs.categories.hostTrust')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor="audit-logs-outcome-filter"
                className="px-0 text-xs font-medium text-home-text-subtle"
              >
                {t('auditLogs.filters.outcome')}
              </Label>
              <Select
                value={outcomeFilter || ALL_OUTCOME_FILTER_VALUE}
                onValueChange={(value) => {
                  setPage(1);
                  setOutcomeFilter(value === ALL_OUTCOME_FILTER_VALUE ? '' : value);
                }}
              >
                <SelectTrigger id="audit-logs-outcome-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_OUTCOME_FILTER_VALUE}>{t('auditLogs.filters.allOutcomes')}</SelectItem>
                  <SelectItem value="success">{t('auditLogs.outcomes.success')}</SelectItem>
                  <SelectItem value="failure">{t('auditLogs.outcomes.failure')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor="audit-logs-time-range-filter"
                className="px-0 text-xs font-medium text-home-text-subtle"
              >
                {t('auditLogs.filters.timeRange')}
              </Label>
              <Select
                value={timeRangePreset}
                onValueChange={(value) => {
                  setPage(1);
                  setTimeRangePreset(value as TimeRangePreset);
                }}
              >
                <SelectTrigger id="audit-logs-time-range-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">{t('auditLogs.timeRange.last24h')}</SelectItem>
                  <SelectItem value="7d">{t('auditLogs.timeRange.last7d')}</SelectItem>
                  <SelectItem value="30d">{t('auditLogs.timeRange.last30d')}</SelectItem>
                  <SelectItem value="180d">{t('auditLogs.timeRange.last180d')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="ghost"
              className="w-full !justify-start"
              onClick={() => {
                void refreshList();
              }}
            >
              <RefreshCcw className="h-4 w-4" />
              {t('auditLogs.actions.refresh')}
            </Button>
          </div>

          <div className="mt-auto rounded-[12px] border border-home-divider bg-bg-subtle p-3 text-xs text-home-text-subtle">
            {t('auditLogs.retentionHint')}
          </div>
        </div>
      }
      main={
        <SplitWorkbenchMainPanel
          header={
            <div className="flex items-center justify-between gap-3 pb-2">
              <div>
                <h1 className="text-home-text text-[22px] font-semibold">{t('auditLogs.title')}</h1>
                <p className="text-xs text-home-text-subtle">
                  {t('auditLogs.countSummary', {
                    count: String(pagination?.total ?? 0),
                  })}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="h-8 px-2"
                  disabled={!pagination || page <= 1 || loadingList}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[90px] text-center text-xs text-home-text-subtle">
                  {t('auditLogs.pagination.page', {
                    page: String(pagination?.page ?? 1),
                  })}
                </span>
                <Button
                  variant="ghost"
                  className="h-8 px-2"
                  disabled={!pagination || !pagination.hasMore || loadingList}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          }
          body={
            <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-3">
              <div className="min-h-0 overflow-auto rounded-[12px] border border-home-divider bg-bg-subtle">
                <div className="sticky top-0 z-10 grid grid-cols-[170px_minmax(0,1fr)_170px_120px_120px] gap-2 border-b border-home-divider bg-bg px-3 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-home-text-subtle">
                  <span>{t('auditLogs.columns.time')}</span>
                  <span>{t('auditLogs.columns.event')}</span>
                  <span>{t('auditLogs.columns.target')}</span>
                  <span>{t('auditLogs.columns.outcome')}</span>
                  <span>{t('auditLogs.columns.device')}</span>
                </div>

                {loadingList ? (
                  <div className="px-3 py-4 text-sm text-home-text-subtle">{t('auditLogs.loading')}</div>
                ) : null}

                {!loadingList && listItems.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-home-text-subtle">{t('auditLogs.empty')}</div>
                ) : null}

                {!loadingList
                  ? listItems.map((item) => {
                      const isActive = item.eventId === selectedEventId;
                      const eventName = `${item.category}.${item.action}`;
                      const targetName =
                        item.entityType && item.entityId
                          ? `${item.entityType}:${item.entityId}`
                          : t('auditLogs.columns.noneTarget');

                      return (
                        <button
                          key={item.eventId}
                          type="button"
                          className={classNames(
                            'border-home-divider/70 grid w-full grid-cols-[170px_minmax(0,1fr)_170px_120px_120px] gap-2 border-b px-3 py-2 text-left text-[13px] transition-colors',
                            isActive ? 'bg-home-selection text-home-text' : 'text-home-text hover:bg-bg',
                          )}
                          onClick={() => setSelectedEventId(item.eventId)}
                        >
                          <span className="truncate text-[12px] text-home-text-subtle">
                            {formatOccurredAt(item.occurredAt)}
                          </span>
                          <span className="truncate font-medium">{eventName}</span>
                          <span className="truncate text-home-text-subtle">{targetName}</span>
                          <span
                            className={classNames(
                              'truncate',
                              item.outcome === 'success' ? 'text-emerald-400' : 'text-rose-400',
                            )}
                          >
                            {item.outcome === 'success'
                              ? t('auditLogs.outcomes.success')
                              : t('auditLogs.outcomes.failure')}
                          </span>
                          <span className="truncate text-home-text-subtle">{item.scopeDeviceId}</span>
                        </button>
                      );
                    })
                  : null}
              </div>

              <div className="min-h-0 overflow-auto rounded-[12px] border border-home-divider bg-bg-subtle p-3">
                {loadingDetail ? <p className="text-sm text-home-text-subtle">{t('auditLogs.detailLoading')}</p> : null}

                {!loadingDetail && !detail ? (
                  <p className="text-sm text-home-text-subtle">{t('auditLogs.detailEmpty')}</p>
                ) : null}

                {!loadingDetail && detail ? (
                  <div className="space-y-3 text-[13px]">
                    <h2 className="text-home-text text-sm font-semibold">{t('auditLogs.detailTitle')}</h2>

                    <div className="grid gap-1 text-home-text-subtle">
                      <div className="truncate">{`eventId: ${detail.eventId}`}</div>
                      <div className="truncate">{`occurredAt: ${formatOccurredAt(detail.occurredAt)}`}</div>
                      <div className="truncate">{`category: ${detail.category}`}</div>
                      <div className="truncate">{`action: ${detail.action}`}</div>
                      <div className="truncate">{`outcome: ${detail.outcome}`}</div>
                      <div className="truncate">{`severity: ${detail.severity}`}</div>
                      <div className="truncate">{`entity: ${detail.entityType ?? '-'}:${detail.entityId ?? '-'}`}</div>
                      <div className="truncate">{`sessionId: ${detail.sessionId ?? '-'}`}</div>
                      <div className="truncate">{`requestId: ${detail.requestId ?? '-'}`}</div>
                      <div className="truncate">{`correlationId: ${detail.correlationId ?? '-'}`}</div>
                      <div className="truncate">{`relatedRecordId: ${detail.relatedRecordId ?? '-'}`}</div>
                      <div className="truncate">{`retentionUntilAt: ${formatOccurredAt(detail.retentionUntilAt)}`}</div>
                    </div>

                    <div>
                      <h3 className="pb-1 text-xs font-medium uppercase tracking-[0.04em] text-home-text-subtle">
                        {t('auditLogs.metadata')}
                      </h3>
                      <pre className="max-h-[300px] overflow-auto rounded-[10px] border border-home-divider bg-bg p-2 text-[11px] leading-5 text-home-text-subtle">
                        {formatMetadataJson(detail.metadata)}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          }
        />
      }
    />
  );
};

export default AuditLogs;
