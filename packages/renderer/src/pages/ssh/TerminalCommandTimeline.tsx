import classNames from 'classnames';
import { Copy, Plus } from 'lucide-react';
import React from 'react';

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../../components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { t } from '../../lib/i18n';
import type { TerminalCommandTimelineItem, TerminalCommandTimelineModel } from './ssh-types';
import {
  COMMAND_TIMELINE_IDLE_TIMEOUT_MS,
  COMMAND_TIMELINE_POINTER_LEAVE_GRACE_MS,
  COMMAND_TIMELINE_RAIL_WIDTH_PX,
  COMMAND_TIMELINE_SCROLLBAR_WIDTH_PX,
  resolveCommandTimelineEntryHitHeight,
  resolveCommandTimelineIdleDelay,
  selectCommandTimelineEntryItems,
  shouldAllowCommandTimelineEntryPointerEvents,
  shouldShowCommandTimelineEntry,
} from './terminal-command-timeline-state';

type TerminalCommandTimelineProps = {
  model: TerminalCommandTimelineModel;
  isConnected: boolean;
  children: React.ReactNode;
  onActivate: () => void;
  onCopyCommand: (command: string) => void;
  onFocusTerminal: () => void;
  onInsertCommand: (command: string) => void;
  onSelectCommand: (commandId: string) => void;
};

/** CSS variables that keep xterm relocation and rail layout on one geometry contract. */
type TerminalCommandTimelineRootStyle = React.CSSProperties & {
  '--terminal-command-timeline-rail-width': string;
  '--terminal-command-timeline-scrollbar-width': string;
};

/**
 * Checks whether a pointer transition stays inside another timeline surface.
 *
 * Radix portals are outside the trigger's DOM ancestry, so `relatedTarget`
 * must be checked explicitly before scheduling hover dismissal.
 *
 * @param element Timeline surface that may contain the next pointer target.
 * @param relatedTarget Native target receiving the pointer after the transition.
 * @returns `true` when the pointer moved directly into the supplied surface.
 */
const containsRelatedPointerTarget = (element: HTMLElement | null, relatedTarget: EventTarget | null): boolean =>
  relatedTarget instanceof Node && element?.contains(relatedTarget) === true;

/**
 * Renders one xterm surface with its activity-aware recent-command rail.
 *
 * The wrapper stays mounted for the complete pane lifetime so changes in trust,
 * activity, or menu state never remount xterm. The fixed rail remains reserved
 * while trusted command markers are supported, including alternate-screen mode,
 * which preserves terminal columns across visual-only state changes.
 *
 * @param props Timeline model, xterm host, and pane-scoped actions.
 * @param props.model Trusted command items and current viewport position.
 * @param props.isConnected Whether inserting command text is currently available.
 * @param props.children Stable xterm host element.
 * @param props.onActivate Callback that makes this pane active.
 * @param props.onCopyCommand Callback that copies a retained command.
 * @param props.onFocusTerminal Callback that restores focus to this pane's xterm.
 * @param props.onInsertCommand Callback that inserts a command without submitting it.
 * @param props.onSelectCommand Callback that reveals a retained command marker.
 * @returns Stable xterm surface and optional right-side command rail.
 */
export const TerminalCommandTimeline: React.FC<TerminalCommandTimelineProps> = ({
  model,
  isConnected,
  children,
  onActivate,
  onCopyCommand,
  onFocusTerminal,
  onInsertCommand,
  onSelectCommand,
}) => {
  const [activityVisible, setActivityVisible] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [pointerExitPortalMounted, setPointerExitPortalMounted] = React.useState(false);
  const [contextMenuResetKey, setContextMenuResetKey] = React.useState(0);
  const activityVisibleRef = React.useRef(false);
  const menuOpenRef = React.useRef(false);
  const actionMenuOpenRef = React.useRef(false);
  const actionCommandRef = React.useRef<TerminalCommandTimelineItem | null>(null);
  const lastActivityAtRef = React.useRef(0);
  const idleTimerRef = React.useRef<number | null>(null);
  const pointerCloseTimerRef = React.useRef<number | null>(null);
  const scrollFrameRef = React.useRef<number | null>(null);
  const pointerInsideTriggerRef = React.useRef(false);
  const pointerInsideContentRef = React.useRef(false);
  const pointerOpenedMenuRef = React.useRef(false);
  const pointerExitPortalMountedRef = React.useRef(false);
  const terminalFocusRequestedRef = React.useRef(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuContentRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * Schedules one idle check and lets that check reschedule itself only when
   * newer activity moved the deadline. Pointer movement therefore updates a
   * timestamp without continuously replacing timers or React state.
   *
   * @returns Nothing.
   */
  const scheduleIdleCheck = React.useCallback((): void => {
    if (idleTimerRef.current !== null) {
      return;
    }

    /**
     * Hides the entry at its latest deadline or waits for a newer deadline.
     *
     * @returns Nothing.
     */
    const checkActivityDeadline = (): void => {
      idleTimerRef.current = null;
      if (menuOpenRef.current) {
        return;
      }

      const remainingDelay = resolveCommandTimelineIdleDelay(lastActivityAtRef.current, Date.now());
      if (remainingDelay > 0) {
        idleTimerRef.current = window.setTimeout(checkActivityDeadline, remainingDelay);
        return;
      }

      activityVisibleRef.current = false;
      setActivityVisible(false);
    };

    idleTimerRef.current = window.setTimeout(checkActivityDeadline, COMMAND_TIMELINE_IDLE_TIMEOUT_MS);
  }, []);

  /**
   * Records terminal activity and reveals the entry without rerendering for
   * subsequent pointer events while it is already visible.
   *
   * @returns Nothing.
   */
  const markActivity = React.useCallback((): void => {
    lastActivityAtRef.current = Date.now();
    if (!activityVisibleRef.current) {
      activityVisibleRef.current = true;
      setActivityVisible(true);
    }

    if (!menuOpenRef.current) {
      scheduleIdleCheck();
    }
  }, [scheduleIdleCheck]);

  /**
   * Cancels a pending pointer-leave dismissal.
   *
   * @returns Nothing.
   */
  const cancelPointerClose = React.useCallback((): void => {
    if (pointerCloseTimerRef.current === null) {
      return;
    }

    window.clearTimeout(pointerCloseTimerRef.current);
    pointerCloseTimerRef.current = null;
  }, []);

  /**
   * Releases the portal retained only for an in-progress pointer exit.
   *
   * @returns Nothing.
   */
  const releasePointerExitPortal = React.useCallback((): void => {
    if (!pointerExitPortalMountedRef.current) {
      return;
    }

    pointerExitPortalMountedRef.current = false;
    setPointerExitPortalMounted(false);
  }, []);

  /**
   * Closes both menu layers and starts a fresh idle window.
   *
   * The dropdown portal is retained only for pointer-leave exits. Normal
   * selection, Escape, and programmatic closes keep Radix's immediate lifecycle.
   *
   * @param retainPointerExit Whether CSS needs the closed portal for exit motion.
   * @returns Nothing.
   */
  const closeMenus = React.useCallback(
    (retainPointerExit = false): void => {
      const shouldResetContextMenu = actionMenuOpenRef.current;
      const shouldRetainPointerExit =
        retainPointerExit &&
        pointerOpenedMenuRef.current &&
        menuOpenRef.current &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      actionMenuOpenRef.current = false;
      actionCommandRef.current = null;
      pointerInsideContentRef.current = false;
      menuOpenRef.current = false;

      if (shouldRetainPointerExit) {
        pointerExitPortalMountedRef.current = true;
        setPointerExitPortalMounted(true);
      } else {
        releasePointerExitPortal();
      }

      setMenuOpen(false);
      if (shouldResetContextMenu) {
        // Radix ContextMenu is intentionally uncontrolled; remounting its root is
        // the only close path needed for pointer-leave dismissal initiated by us.
        setContextMenuResetKey((previous) => previous + 1);
      }
      markActivity();
    },
    [markActivity, releasePointerExitPortal],
  );

  /**
   * Synchronizes Radix dropdown requests with the pinned activity state.
   *
   * @param open Requested dropdown state.
   * @returns Nothing.
   */
  const handleMenuOpenChange = React.useCallback(
    (open: boolean): void => {
      if (!open) {
        if (actionMenuOpenRef.current) {
          return;
        }
        closeMenus();
        return;
      }

      menuOpenRef.current = true;
      setMenuOpen(true);
      markActivity();
    },
    [closeMenus, markActivity],
  );

  /**
   * Opens the recent-command menu from pointer hover or pointer motion.
   *
   * Normal open mounting lets `@starting-style` provide a reliable first frame;
   * releasing an interrupted exit lets the same CSS transition retarget cleanly.
   *
   * @returns Nothing.
   */
  const openPointerMenu = React.useCallback((): void => {
    pointerInsideTriggerRef.current = true;
    pointerOpenedMenuRef.current = true;
    cancelPointerClose();
    if (menuOpenRef.current) {
      return;
    }

    releasePointerExitPortal();
    handleMenuOpenChange(true);
  }, [cancelPointerClose, handleMenuOpenChange, releasePointerExitPortal]);

  /**
   * Opens the menu when the pointer enters the compact line-group target.
   *
   * @returns Nothing.
   */
  const handleTriggerPointerEnter = React.useCallback((): void => {
    openPointerMenu();
  }, [openPointerMenu]);

  /**
   * Recovers hover opening when idle visibility changes beneath the pointer.
   *
   * `pointerenter` is not guaranteed when an existing target becomes visible,
   * while pointer movement is guaranteed by the interaction that reveals it.
   *
   * @returns Nothing.
   */
  const handleTriggerPointerMove = React.useCallback((): void => {
    openPointerMenu();
  }, [openPointerMenu]);

  /**
   * Marks keyboard opening as immediate so a frequent keyboard action never
   * waits for the pointer-oriented morph transition.
   *
   * @param event Keyboard event received by the shared menu trigger.
   * @returns Nothing.
   */
  const handleTriggerKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      pointerOpenedMenuRef.current = false;
    }
  }, []);

  /**
   * Defers hover dismissal briefly so the pointer can cross the portal boundary
   * between the compact trigger and its flush adjacent menu.
   *
   * @returns Nothing.
   */
  const schedulePointerClose = React.useCallback((): void => {
    if (pointerCloseTimerRef.current !== null || actionMenuOpenRef.current) {
      return;
    }

    pointerCloseTimerRef.current = window.setTimeout(() => {
      pointerCloseTimerRef.current = null;
      if (!pointerInsideTriggerRef.current && !pointerInsideContentRef.current && !actionMenuOpenRef.current) {
        closeMenus(true);
      }
    }, COMMAND_TIMELINE_POINTER_LEAVE_GRACE_MS);
  }, [closeMenus]);

  /**
   * Tracks pointer departure from the compact rail entry.
   *
   * @param event Pointer transition emitted by the compact trigger.
   * @returns Nothing.
   */
  const handleTriggerPointerLeave = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      pointerInsideTriggerRef.current = false;
      if (containsRelatedPointerTarget(menuContentRef.current, event.relatedTarget)) {
        pointerInsideContentRef.current = true;
        cancelPointerClose();
        return;
      }
      schedulePointerClose();
    },
    [cancelPointerClose, schedulePointerClose],
  );

  /**
   * Keeps the dropdown open while the pointer is inside its portaled content.
   *
   * @returns Nothing.
   */
  const handleContentPointerEnter = React.useCallback((): void => {
    pointerInsideContentRef.current = true;
    cancelPointerClose();
  }, [cancelPointerClose]);

  /**
   * Starts hover dismissal after the pointer leaves the recent-command list.
   *
   * @param event Pointer transition emitted by the portaled command card.
   * @returns Nothing.
   */
  const handleContentPointerLeave = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      pointerInsideContentRef.current = false;
      if (containsRelatedPointerTarget(triggerRef.current, event.relatedTarget)) {
        pointerInsideTriggerRef.current = true;
        cancelPointerClose();
        return;
      }
      schedulePointerClose();
    },
    [cancelPointerClose, schedulePointerClose],
  );

  /**
   * Unmounts pointer-retained content only after its visible close transition.
   *
   * @param event Transition event emitted by the shared menu surface.
   * @returns Nothing.
   */
  const handleMenuTransitionEnd = React.useCallback(
    (event: React.TransitionEvent<HTMLDivElement>): void => {
      if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || menuOpenRef.current) {
        return;
      }
      pointerOpenedMenuRef.current = false;
      releasePointerExitPortal();
    },
    [releasePointerExitPortal],
  );

  /**
   * Keeps Escape closure immediate even when the menu originally opened by pointer.
   *
   * @returns Nothing.
   */
  const handleContentEscapeKeyDown = React.useCallback((): void => {
    pointerOpenedMenuRef.current = false;
    cancelPointerClose();
    releasePointerExitPortal();
  }, [cancelPointerClose, releasePointerExitPortal]);

  /**
   * Resolves the command row under a native right-click before Radix opens the
   * shared context menu at that pointer position.
   *
   * @param event Captured context-menu event from the command list.
   * @returns Nothing.
   */
  const handleCommandContextMenuCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-command-id]') : null;
      const commandId = target?.dataset.commandId;
      const command = model.items.find((item) => item.commandId === commandId) ?? null;
      if (!command) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      actionCommandRef.current = command;
      actionMenuOpenRef.current = true;
      onActivate();
    },
    [model.items, onActivate],
  );

  /**
   * Closes the complete recent-command surface when the nested action menu is
   * dismissed, including its Escape path.
   *
   * @param open Requested context-menu state.
   * @returns Nothing.
   */
  const handleActionMenuOpenChange = React.useCallback(
    (open: boolean): void => {
      if (open) {
        actionMenuOpenRef.current = true;
        return;
      }
      terminalFocusRequestedRef.current = true;
      closeMenus();
      onFocusTerminal();
    },
    [closeMenus, onFocusTerminal],
  );

  /**
   * Copies the command selected by the nested context menu.
   *
   * @returns Nothing.
   */
  const handleCopyCommand = React.useCallback((): void => {
    const command = actionCommandRef.current?.command;
    if (command) {
      onCopyCommand(command);
    }
    terminalFocusRequestedRef.current = true;
    closeMenus();
    onFocusTerminal();
  }, [closeMenus, onCopyCommand, onFocusTerminal]);

  /**
   * Inserts the command selected by the nested context menu without Enter.
   *
   * @returns Nothing.
   */
  const handleInsertCommand = React.useCallback((): void => {
    const command = actionCommandRef.current?.command;
    if (command && isConnected) {
      onInsertCommand(command);
    }
    terminalFocusRequestedRef.current = true;
    closeMenus();
    onFocusTerminal();
  }, [closeMenus, isConnected, onFocusTerminal, onInsertCommand]);

  /**
   * Preserves xterm focus for pointer-opened menus and completed terminal
   * actions while allowing keyboard Escape to return focus to the rail trigger.
   *
   * @param event Radix close autofocus event.
   * @returns Nothing.
   */
  const handleDropdownCloseAutoFocus = React.useCallback((event: Event): void => {
    if (pointerOpenedMenuRef.current || terminalFocusRequestedRef.current) {
      event.preventDefault();
    }
    pointerOpenedMenuRef.current = false;
    terminalFocusRequestedRef.current = false;
  }, []);

  /**
   * Reveals one command and marks the resulting xterm focus as authoritative
   * over the dropdown trigger's default close restoration.
   *
   * @param commandId Retained command marker id.
   * @returns Nothing.
   */
  const handleSelectCommand = React.useCallback(
    (commandId: string): void => {
      terminalFocusRequestedRef.current = true;
      onSelectCommand(commandId);
    },
    [onSelectCommand],
  );

  /**
   * Closes a pointer-abandoned action menu and restores its source terminal.
   *
   * @returns Nothing.
   */
  const handleActionMenuPointerLeave = React.useCallback((): void => {
    terminalFocusRequestedRef.current = true;
    closeMenus();
    onFocusTerminal();
  }, [closeMenus, onFocusTerminal]);

  React.useLayoutEffect(() => {
    if (!menuOpen) {
      return;
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const content = menuContentRef.current;
      if (content) {
        content.scrollTop = content.scrollHeight;
      }
    });

    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [menuOpen, model.items.length]);

  React.useEffect(() => {
    if (!model.historyVisible && menuOpenRef.current) {
      terminalFocusRequestedRef.current = true;
      closeMenus();
      onFocusTerminal();
    }
  }, [closeMenus, model.historyVisible, onFocusTerminal]);

  React.useEffect(() => {
    if (model.historyVisible) {
      // A newly trusted marker is itself terminal activity. This also restores
      // the entry after a visual-only remount without waiting for another event.
      markActivity();
    }
  }, [markActivity, model.historyVisible]);

  React.useEffect(
    () => () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      if (pointerCloseTimerRef.current !== null) {
        window.clearTimeout(pointerCloseTimerRef.current);
      }
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  const entryItems = selectCommandTimelineEntryItems(model.items);
  const entryVisible = shouldShowCommandTimelineEntry(model.historyVisible, activityVisible, menuOpen);
  const entryPointerEnabled = shouldAllowCommandTimelineEntryPointerEvents(model.historyVisible);
  const entryHitHeight = resolveCommandTimelineEntryHitHeight(entryItems.length);
  const menuMotion = pointerOpenedMenuRef.current ? 'pointer' : 'instant';
  const rootStyle: TerminalCommandTimelineRootStyle = {
    '--terminal-command-timeline-rail-width': `${COMMAND_TIMELINE_RAIL_WIDTH_PX}px`,
    '--terminal-command-timeline-scrollbar-width': `${COMMAND_TIMELINE_SCROLLBAR_WIDTH_PX}px`,
  };
  return (
    <div
      data-rail-reserved={model.railReserved ? 'true' : 'false'}
      style={rootStyle}
      className="terminal-command-timeline relative flex h-full min-h-0 w-full min-w-0 pr-2"
      onMouseDown={onActivate}
      onContextMenu={onActivate}
      onPointerEnter={markActivity}
      onPointerMoveCapture={markActivity}
      onKeyDownCapture={markActivity}
      onInputCapture={markActivity}
      onPasteCapture={markActivity}
    >
      {children}

      {model.railReserved ? (
        <aside
          aria-hidden={entryVisible ? undefined : true}
          className="terminal-command-timeline-rail pointer-events-none absolute bottom-0 top-0 z-10"
        >
          <DropdownMenu
            modal={false}
            open={menuOpen}
            onOpenChange={handleMenuOpenChange}
          >
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                aria-label={t('ssh.commandTimelineLabel')}
                disabled={!entryPointerEnabled}
                tabIndex={entryVisible ? 0 : -1}
                data-motion={menuMotion}
                style={{ height: `${entryHitHeight}px` }}
                className={classNames(
                  'terminal-command-timeline-entry pointer-events-auto absolute left-0 top-1/2 flex max-h-full w-full -translate-y-1/2 items-center justify-center outline-none transition-opacity disabled:pointer-events-none',
                  entryVisible ? 'opacity-100' : 'opacity-0',
                )}
                onKeyDown={handleTriggerKeyDown}
                onPointerEnter={handleTriggerPointerEnter}
                onPointerLeave={handleTriggerPointerLeave}
                onPointerMove={handleTriggerPointerMove}
              >
                <span
                  aria-hidden="true"
                  className="terminal-command-timeline-entry-lines flex flex-col items-center gap-2.5"
                >
                  {entryItems.map((item) => (
                    <span
                      key={item.commandId}
                      className="h-0.5 w-3 shrink-0 bg-text opacity-60"
                    />
                  ))}
                </span>
              </button>
            </DropdownMenuTrigger>

            <ContextMenu
              key={contextMenuResetKey}
              modal={false}
              onOpenChange={handleActionMenuOpenChange}
            >
              <DropdownMenuContent
                ref={menuContentRef}
                side="left"
                align="center"
                sideOffset={-COMMAND_TIMELINE_RAIL_WIDTH_PX}
                closeMotion="none"
                forceMountPortal={pointerExitPortalMounted}
                data-motion={menuMotion}
                className="terminal-command-timeline-menu w-80"
                aria-label={t('ssh.commandTimelineLabel')}
                inert={menuOpen ? undefined : true}
                onPointerEnter={handleContentPointerEnter}
                onPointerLeave={handleContentPointerLeave}
                onEscapeKeyDown={handleContentEscapeKeyDown}
                onCloseAutoFocus={handleDropdownCloseAutoFocus}
                onTransitionCancel={handleMenuTransitionEnd}
                onTransitionEnd={handleMenuTransitionEnd}
              >
                <ContextMenuTrigger asChild>
                  <div
                    className="terminal-command-timeline-menu-items"
                    onContextMenuCapture={handleCommandContextMenuCapture}
                  >
                    {model.items.map((item) => {
                      const isActive = item.commandId === model.activeCommandId;
                      return (
                        <DropdownMenuItem
                          key={item.commandId}
                          data-command-id={item.commandId}
                          aria-current={isActive ? 'true' : undefined}
                          aria-label={t('ssh.commandTimelineJumpToCommand', { command: item.command })}
                          className={classNames(isActive && 'bg-menu-control-hover')}
                          onSelect={() => handleSelectCommand(item.commandId)}
                        >
                          <span className="min-w-0 flex-1 truncate">{item.command}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                </ContextMenuTrigger>
              </DropdownMenuContent>

              <ContextMenuContent
                onPointerLeave={handleActionMenuPointerLeave}
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <ContextMenuItem
                  icon={Copy}
                  onSelect={handleCopyCommand}
                >
                  {t('ssh.commandTimelineCopyCommand')}
                </ContextMenuItem>
                <ContextMenuItem
                  icon={Plus}
                  disabled={!isConnected}
                  onSelect={handleInsertCommand}
                >
                  {t('ssh.commandTimelineInsertCommand')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </DropdownMenu>
        </aside>
      ) : null}
    </div>
  );
};
