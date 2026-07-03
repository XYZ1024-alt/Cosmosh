import classNames from 'classnames';
import { Bug, X } from 'lucide-react';
import React from 'react';

import { Button } from '../../components/ui/button';
import { t } from '../../lib/i18n';
import type { RemoteBootstrapDebugEvent, RemoteBootstrapStatus } from './ssh-types';

type RemoteBootstrapDebugPanelProps = {
  latestStatus: RemoteBootstrapStatus | null;
  events: RemoteBootstrapDebugEvent[];
  formatTime: (value: string | number | Date, fallback?: string) => string;
  onClose: () => void;
};

/**
 * Formats a bootstrap status payload for exact debug inspection.
 *
 * @param payload Remote bootstrap status payload received from the side channel.
 * @returns Pretty-printed JSON payload text.
 */
const formatJsonPayload = (payload: RemoteBootstrapStatus): string => {
  return JSON.stringify(payload, null, 2);
};

/**
 * Reads the localized phase label for a bootstrap status payload.
 *
 * @param phase Remote bootstrap phase identifier.
 * @returns Localized phase label.
 */
const readBootstrapPhaseLabel = (phase: RemoteBootstrapStatus['phase']): string => {
  return t(`ssh.bootstrapPhases.${phase}`);
};

/**
 * Reads the localized state label for a bootstrap status payload.
 *
 * @param state Remote bootstrap state identifier.
 * @returns Localized state label.
 */
const readBootstrapStateLabel = (state: RemoteBootstrapStatus['state']): string => {
  return t(`ssh.bootstrapStates.${state}`);
};

/**
 * Maps bootstrap state to the same semantic text colors used by the status strip.
 *
 * @param state Latest bootstrap state, when available.
 * @returns Tailwind utility class for the state text.
 */
const resolveStatusTextColor = (state: RemoteBootstrapStatus['state'] | undefined): string => {
  if (state === 'failed') {
    return 'text-form-message-error';
  }

  if (state === 'ok') {
    return 'text-status-good';
  }

  return 'text-home-text';
};

/**
 * Renders the fixed in-terminal debug inspector for remote bootstrap side-channel events.
 *
 * @param props Latest bootstrap status, event history, formatter and close callback.
 * @param props.latestStatus Most recent bootstrap status event.
 * @param props.events Bootstrap status events received in this session attempt.
 * @param props.formatTime Shared application time formatter.
 * @param props.onClose Callback used to hide the panel.
 * @returns Fixed-position panel anchored inside the SSH terminal card.
 */
export const RemoteBootstrapDebugPanel: React.FC<RemoteBootstrapDebugPanelProps> = ({
  latestStatus,
  events,
  formatTime,
  onClose,
}) => {
  const latestStatusState = latestStatus?.state;

  return (
    <section className="text-home-text absolute right-3 top-3 z-30 flex max-h-[min(460px,calc(100%-24px))] w-[420px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-lg border border-home-divider bg-bg-subtle shadow-menu-content backdrop-blur-[4px]">
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-home-divider px-3">
        <Bug className="h-4 w-4 shrink-0 text-home-text-subtle" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{t('ssh.remoteBootstrapDebug.title')}</h2>
        <Button
          aria-label={t('ssh.remoteBootstrapDebug.close')}
          className="h-7 w-7"
          variant="ghostIcon"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <dl className="grid select-text grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-home-text-subtle">{t('ssh.remoteBootstrapDebug.latestPhase')}</dt>
          <dd className="min-w-0 truncate">
            {latestStatus ? readBootstrapPhaseLabel(latestStatus.phase) : t('ssh.remoteBootstrapDebug.emptyValue')}
          </dd>

          <dt className="text-home-text-subtle">{t('ssh.remoteBootstrapDebug.latestState')}</dt>
          <dd className={classNames('min-w-0 truncate', resolveStatusTextColor(latestStatusState))}>
            {latestStatus ? readBootstrapStateLabel(latestStatus.state) : t('ssh.remoteBootstrapDebug.emptyValue')}
          </dd>

          <dt className="text-home-text-subtle">{t('ssh.remoteBootstrapDebug.code')}</dt>
          <dd className="min-w-0 truncate font-mono">
            {latestStatus?.code ?? t('ssh.remoteBootstrapDebug.emptyValue')}
          </dd>

          <dt className="text-home-text-subtle">{t('ssh.remoteBootstrapDebug.version')}</dt>
          <dd className="min-w-0 truncate font-mono">
            {latestStatus?.version ?? t('ssh.remoteBootstrapDebug.emptyValue')}
          </dd>

          <dt className="text-home-text-subtle">{t('ssh.remoteBootstrapDebug.message')}</dt>
          <dd className="min-w-0 break-words">{latestStatus?.message ?? t('ssh.remoteBootstrapDebug.emptyValue')}</dd>
        </dl>

        <div className="mt-3 border-t border-home-divider pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase text-home-text-subtle">
              {t('ssh.remoteBootstrapDebug.events')}
            </h3>
            <span className="font-mono text-xs text-home-text-subtle">{events.length}</span>
          </div>

          {events.length === 0 ? (
            <div className="rounded-md border border-home-divider bg-bg px-2.5 py-2 text-xs text-home-text-subtle">
              {t('ssh.remoteBootstrapDebug.emptyEvents')}
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((event, index) => (
                <article
                  key={`${event.receivedAt}-${index}`}
                  className="select-text rounded-md border border-home-divider bg-bg p-2"
                >
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-home-text-subtle">
                    <span className="font-mono">#{index + 1}</span>
                    <span>{formatTime(event.receivedAt, t('ssh.remoteBootstrapDebug.emptyValue'))}</span>
                    <span className="ml-auto truncate">
                      {readBootstrapPhaseLabel(event.payload.phase)} / {readBootstrapStateLabel(event.payload.state)}
                    </span>
                  </div>
                  <pre className="max-h-40 select-text overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-home-text-subtle">
                    {formatJsonPayload(event.payload)}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
