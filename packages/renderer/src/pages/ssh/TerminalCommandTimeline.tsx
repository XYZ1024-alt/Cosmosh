import classNames from 'classnames';
import { ChevronDown, ChevronUp } from 'lucide-react';
import React from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { t } from '../../lib/i18n';
import type { TerminalCommandTimelineModel } from './ssh-types';

type TerminalCommandTimelineProps = {
  model: TerminalCommandTimelineModel;
  onNavigate: (direction: 'previous' | 'next') => void;
  onSelectCommand: (commandId: string) => void;
};

/**
 * Renders a compact pane-local command minimap beside an xterm surface.
 *
 * The rail remains mounted but visually hidden during alternate-screen programs
 * so TUI entry and exit cannot change PTY columns. Full command strings are used
 * only as in-memory tooltip content and accessible navigation labels.
 *
 * @param props Timeline model and pane-scoped navigation callbacks.
 * @param props.model Trusted command items and current viewport position.
 * @param props.onNavigate Callback for bounded previous/next navigation.
 * @param props.onSelectCommand Callback for selecting one command marker.
 * @returns Right-side command timeline rail.
 */
export const TerminalCommandTimeline: React.FC<TerminalCommandTimelineProps> = ({
  model,
  onNavigate,
  onSelectCommand,
}) => {
  return (
    <aside
      aria-label={t('ssh.commandTimelineLabel')}
      className="h-full w-10 shrink-0 py-2 pr-1"
    >
      <TooltipProvider delayDuration={160}>
        <div
          className={classNames(
            'flex h-full min-h-0 flex-col items-end',
            model.alternateScreenActive && 'pointer-events-none invisible',
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('ssh.commandTimelinePrevious')}
                disabled={!model.canNavigatePrevious}
                className="flex h-6 w-8 shrink-0 items-center justify-center rounded-sm text-ssh-terminal-command-timeline-control outline-none transition-colors hover:bg-menu-control-hover hover:text-ssh-terminal-command-timeline-control-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-outline disabled:pointer-events-none disabled:opacity-30"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onNavigate('previous')}
              >
                <ChevronUp
                  aria-hidden="true"
                  className="h-4 w-4"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{t('ssh.commandTimelinePrevious')}</TooltipContent>
          </Tooltip>

          <div
            className="grid min-h-0 w-full flex-1"
            style={{
              gridTemplateRows: `repeat(${Math.max(1, model.items.length)}, minmax(0, 1fr))`,
            }}
          >
            {model.items.map((item) => {
              const isActive = item.commandId === model.activeCommandId;
              return (
                <Tooltip key={item.commandId}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={t('ssh.commandTimelineJumpToCommand', { command: item.command })}
                      className="group flex min-h-0 w-full items-center justify-end px-1 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-outline"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => onSelectCommand(item.commandId)}
                    >
                      <span
                        aria-hidden="true"
                        className={classNames(
                          'h-px shrink-0 transition-colors',
                          isActive
                            ? 'bg-ssh-terminal-command-timeline-marker-active'
                            : 'bg-ssh-terminal-command-timeline-marker group-hover:bg-ssh-terminal-command-timeline-marker-hover group-focus-visible:bg-ssh-terminal-command-timeline-marker-hover',
                        )}
                        style={{ width: `${item.barWidth}px` }}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="left"
                    className="max-w-[420px] whitespace-pre-wrap break-all font-mono"
                  >
                    {item.command}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('ssh.commandTimelineNext')}
                disabled={!model.canNavigateNext}
                className="flex h-6 w-8 shrink-0 items-center justify-center rounded-sm text-ssh-terminal-command-timeline-control outline-none transition-colors hover:bg-menu-control-hover hover:text-ssh-terminal-command-timeline-control-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-outline disabled:pointer-events-none disabled:opacity-30"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onNavigate('next')}
              >
                <ChevronDown
                  aria-hidden="true"
                  className="h-4 w-4"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{t('ssh.commandTimelineNext')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </aside>
  );
};
