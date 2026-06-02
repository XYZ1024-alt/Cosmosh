import type {
  ApiAuditEventDetailResponse,
  ApiAuditEventListQuery,
  ApiAuditEventListResponse,
} from '@cosmosh/api-contract';
import classNames from 'classnames';
import { ChevronLeft, ChevronRight, ClipboardList, RefreshCcw, Search } from 'lucide-react';
import React from 'react';

import HomeEmptyState from '../components/home/HomeEmptyState';
import SplitWorkbenchLayout, { SplitWorkbenchMainPanel } from '../components/layout/SplitWorkbenchLayout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { menuStyles } from '../components/ui/menu-styles';
import { Menubar, MenubarSeparator } from '../components/ui/menubar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getAuditEventById, listAuditEvents } from '../lib/backend';
import { useDateTimeFormatter } from '../lib/date-time-format';
import { t } from '../lib/i18n';
import { useToast } from '../lib/toast-context';

type TimeRangePreset = '24h' | '7d' | '30d' | '180d';

type AuditEventListItem = ApiAuditEventListResponse['data']['items'][number];
type AuditEventDetailItem = ApiAuditEventDetailResponse['data']['item'];

const DEFAULT_PAGE_SIZE = 50;
const ALL_CATEGORY_FILTER_VALUE = '__all_categories__';
const ALL_OUTCOME_FILTER_VALUE = '__all_outcomes__';
const AUDIT_EVENT_TABLE_GRID_CLASS =
  'grid w-full min-w-[860px] grid-cols-[170px_minmax(220px,1fr)_minmax(180px,0.85fr)_96px_120px] gap-2';
const AUDIT_DETAIL_ROW_CLASS = 'grid grid-cols-[110px_minmax(0,1fr)] items-start gap-2';

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
  const { formatDateTime } = useDateTimeFormatter();

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
        <>
          <div className="pb-3">
            <Menubar className="w-full">
              <div className="relative w-full">
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

              <MenubarSeparator vertical />

              <button
                type="button"
                aria-label={t('auditLogs.actions.refresh')}
                className={classNames(menuStyles.control, menuStyles.iconOnlyControl)}
                onClick={() => {
                  void refreshList();
                }}
              >
                <RefreshCcw className="h-4 w-4" />
              </button>
            </Menubar>
          </div>

          <div className="gutter-box-y min-h-0 flex-1 overflow-auto pb-2">
            <div className="space-y-3">
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
            </div>

            <div className="mt-4 rounded-lg-2 bg-bg-subtle p-3 text-xs text-home-text-subtle">
              {t('auditLogs.retentionHint')}
            </div>
          </div>
        </>
      }
      main={
        <SplitWorkbenchMainPanel
          header={
            <div className="items-top mx-auto flex min-h-[46px] justify-between gap-4 pb-1">
              <div className="grid gap-1">
                <h1 className="text-home-text ps-2 text-[24px] font-semibold">{t('auditLogs.title')}</h1>
                <p className="ps-2 text-sm text-home-text-subtle">
                  {t('auditLogs.countSummary', {
                    count: String(pagination?.total ?? 0),
                  })}
                </p>
              </div>

              <Menubar>
                <Button
                  variant="icon"
                  aria-label={t('auditLogs.pagination.page', { page: String(page - 1) })}
                  disabled={!pagination || page <= 1 || loadingList}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <span className="px-2 text-sm">
                  {t('auditLogs.pagination.page', {
                    page: String(pagination?.page ?? 1),
                  })}
                </span>

                <Button
                  variant="icon"
                  aria-label={t('auditLogs.pagination.page', { page: String(page + 1) })}
                  disabled={!pagination || !pagination.hasMore || loadingList}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Menubar>
            </div>
          }
          bodyClassName=""
          body={
            <div className="-mb-2 -me-3 -ms-1 grid h-full min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-3 overflow-hidden">
              <div className="min-h-0 min-w-0 overflow-auto rounded-lg-2 bg-bg-subtle">
                <div
                  className={classNames(
                    AUDIT_EVENT_TABLE_GRID_CLASS,
                    'sticky top-0 z-10 border-b border-home-divider bg-home-card-hover px-3 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-home-text-subtle backdrop-blur-md',
                  )}
                >
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
                  <HomeEmptyState
                    text={t('auditLogs.empty')}
                    icon={ClipboardList}
                  />
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
                            AUDIT_EVENT_TABLE_GRID_CLASS,
                            'border-b border-home-divider px-3 py-2 text-left text-[13px] transition-colors',
                            isActive ? 'text-home-text bg-home-card-active' : 'text-home-text hover:bg-home-card-hover',
                          )}
                          onClick={() => setSelectedEventId(item.eventId)}
                        >
                          <span className="truncate text-[12px] text-home-text-subtle">
                            {formatDateTime(item.occurredAt, item.occurredAt)}
                          </span>
                          <span className="truncate font-medium">{eventName}</span>
                          <span className="truncate text-home-text-subtle">{targetName}</span>
                          <span
                            className={classNames(
                              'truncate',
                              item.outcome === 'success' ? 'text-status-good' : 'text-status-bad',
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

              <div className="min-h-0 min-w-0 overflow-auto rounded-lg-2 bg-bg-subtle p-3">
                {loadingDetail ? <p className="text-sm text-home-text-subtle">{t('auditLogs.detailLoading')}</p> : null}

                {!loadingDetail && !detail ? (
                  <HomeEmptyState
                    text={t('auditLogs.detailEmpty')}
                    icon={ClipboardList}
                    className="py-4"
                  />
                ) : null}

                {!loadingDetail && detail ? (
                  <div className="space-y-4 text-[13px]">
                    <h2 className="text-home-text text-sm font-semibold">{t('auditLogs.detailTitle')}</h2>

                    <div className="py-1">
                      <div className="grid gap-2">
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">eventId</span>
                          <span className="text-home-text select-text break-all">{detail.eventId}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">occurredAt</span>
                          <span className="text-home-text select-text break-all">
                            {formatDateTime(detail.occurredAt, detail.occurredAt)}
                          </span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">category</span>
                          <span className="text-home-text select-text break-all">{detail.category}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">action</span>
                          <span className="text-home-text select-text break-all">{detail.action}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">outcome</span>
                          <span
                            className={classNames(
                              'select-text break-all',
                              detail.outcome === 'success' ? 'text-status-good' : 'text-status-bad',
                            )}
                          >
                            {detail.outcome}
                          </span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">severity</span>
                          <span className="text-home-text select-text break-all">{detail.severity}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">entity</span>
                          <span className="text-home-text select-text break-all">
                            {`${detail.entityType ?? '-'}:${detail.entityId ?? '-'}`}
                          </span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">sessionId</span>
                          <span className="text-home-text select-text break-all">{detail.sessionId ?? '-'}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">requestId</span>
                          <span className="text-home-text select-text break-all">{detail.requestId ?? '-'}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">correlationId</span>
                          <span className="text-home-text select-text break-all">{detail.correlationId ?? '-'}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">relatedRecordId</span>
                          <span className="text-home-text select-text break-all">{detail.relatedRecordId ?? '-'}</span>
                        </div>
                        <div className={AUDIT_DETAIL_ROW_CLASS}>
                          <span className="text-xs text-home-text-subtle">retentionUntilAt</span>
                          <span className="text-home-text select-text break-all">
                            {formatDateTime(detail.retentionUntilAt, detail.retentionUntilAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="pb-1.5 text-xs font-medium uppercase tracking-[0.04em] text-home-text-subtle">
                        {t('auditLogs.metadata')}
                      </h3>
                      <pre className="-mx-1 -mb-1 max-h-[300px] overflow-auto rounded-xl bg-bg p-2.5 text-[11px] leading-5 text-home-text-subtle">
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
