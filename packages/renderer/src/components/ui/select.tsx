import { ChevronDownIcon, ChevronUpIcon } from '@radix-ui/react-icons';
import * as SelectPrimitive from '@radix-ui/react-select';
import classNames from 'classnames';
import { Check } from 'lucide-react';
import React from 'react';

import {
  MenuIconSlotContext,
  resolveMenuHasLeadingVisual,
  useMenuIconSlot,
  useMenuSeparatorInset,
} from './menu-icon-slot';
import { MENU_AVAILABLE_SIZE_VARIABLES, normalizeCollisionPadding, resolveViewportMenuBounds } from './menu-position';
import { menuStyles } from './menu-styles';

type MenuIconComponent = React.ComponentType<{ className?: string }>;

type SelectProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>;

type SelectScrollDirection = 'up' | 'down';

type SelectViewportScrollState = {
  isScrollable: boolean;
  canScrollUp: boolean;
  canScrollDown: boolean;
};

const SELECT_CLOSE_ANIMATION_MS = 150;
const SELECT_SCROLL_EPSILON_PX = 1;
const SELECT_SCROLL_STEP_PX = 28;
const SELECT_SCROLL_INTERVAL_MS = 50;

const EMPTY_SELECT_SCROLL_STATE: SelectViewportScrollState = {
  isScrollable: false,
  canScrollUp: false,
  canScrollDown: false,
};

const SelectAnimationContext = React.createContext<{ isClosing: boolean }>({ isClosing: false });

/**
 * Resolves scroll affordance visibility from the Select viewport geometry.
 *
 * @param viewportElement Select viewport element managed by Radix.
 * @returns Stable scroll affordance state for both overlay indicators.
 */
const resolveSelectViewportScrollState = (viewportElement: HTMLDivElement): SelectViewportScrollState => {
  const maxScrollTop = Math.max(0, viewportElement.scrollHeight - viewportElement.clientHeight);
  const isScrollable = maxScrollTop > SELECT_SCROLL_EPSILON_PX;

  return {
    isScrollable,
    canScrollUp: isScrollable && viewportElement.scrollTop > SELECT_SCROLL_EPSILON_PX,
    canScrollDown: isScrollable && Math.ceil(viewportElement.scrollTop) < maxScrollTop,
  };
};

/**
 * Tracks Select viewport scroll state without using Radix scroll buttons.
 *
 * @param viewportElement Select viewport element to observe.
 * @returns Current scroll affordance state.
 */
const useSelectViewportScrollState = (viewportElement: HTMLDivElement | null): SelectViewportScrollState => {
  const [scrollState, setScrollState] = React.useState<SelectViewportScrollState>(EMPTY_SELECT_SCROLL_STATE);

  const updateScrollState = React.useCallback((): void => {
    if (!viewportElement) {
      setScrollState(EMPTY_SELECT_SCROLL_STATE);
      return;
    }

    const nextState = resolveSelectViewportScrollState(viewportElement);
    setScrollState((currentState) => {
      if (
        currentState.isScrollable === nextState.isScrollable &&
        currentState.canScrollUp === nextState.canScrollUp &&
        currentState.canScrollDown === nextState.canScrollDown
      ) {
        return currentState;
      }

      return nextState;
    });
  }, [viewportElement]);

  React.useLayoutEffect(() => {
    if (!viewportElement) {
      setScrollState(EMPTY_SELECT_SCROLL_STATE);
      return undefined;
    }

    updateScrollState();
    viewportElement.addEventListener('scroll', updateScrollState, { passive: true });

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState);
    resizeObserver?.observe(viewportElement);

    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(updateScrollState);
    mutationObserver?.observe(viewportElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      viewportElement.removeEventListener('scroll', updateScrollState);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [updateScrollState, viewportElement]);

  return scrollState;
};

type SelectScrollIndicatorProps = {
  direction: SelectScrollDirection;
  enabled: boolean;
  onStep: (direction: SelectScrollDirection) => void;
  children: React.ReactNode;
};

/**
 * Renders a non-focusable Select scroll affordance without Radix's remount side effects.
 *
 * @param props Scroll indicator direction, enabled state, callback, and icon.
 * @returns Stable Select scroll indicator.
 */
const SelectScrollIndicator: React.FC<SelectScrollIndicatorProps> = ({ direction, enabled, onStep, children }) => {
  const timerRef = React.useRef<number | null>(null);

  const stopAutoScroll = React.useCallback((): void => {
    if (timerRef.current === null) {
      return;
    }

    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const step = React.useCallback((): void => {
    onStep(direction);
  }, [direction, onStep]);

  const startAutoScroll = React.useCallback((): void => {
    if (!enabled || timerRef.current !== null) {
      return;
    }

    step();
    timerRef.current = window.setInterval(step, SELECT_SCROLL_INTERVAL_MS);
  }, [enabled, step]);

  React.useEffect(() => {
    if (!enabled) {
      stopAutoScroll();
    }

    return stopAutoScroll;
  }, [enabled, stopAutoScroll]);

  return (
    <div
      aria-hidden="true"
      className={classNames(
        menuStyles.selectScrollButton,
        direction === 'up' ? 'top-0' : 'bottom-0',
        enabled ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      onPointerDown={startAutoScroll}
      onPointerMove={startAutoScroll}
      onPointerUp={stopAutoScroll}
      onPointerCancel={stopAutoScroll}
      onPointerLeave={stopAutoScroll}
    >
      {children}
    </div>
  );
};

const Select: React.FC<SelectProps> = ({ open, defaultOpen, onOpenChange, ...props }) => {
  const isControlled = open !== undefined;
  const closeTimerRef = React.useRef<number | null>(null);
  const isClosingRef = React.useRef<boolean>(false);
  const [internalOpen, setInternalOpen] = React.useState<boolean>(defaultOpen ?? false);
  const [isClosing, setIsClosing] = React.useState<boolean>(false);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  if (isControlled) {
    return (
      <SelectAnimationContext.Provider value={{ isClosing: false }}>
        <SelectPrimitive.Root
          open={open}
          defaultOpen={defaultOpen}
          onOpenChange={onOpenChange}
          {...props}
        />
      </SelectAnimationContext.Provider>
    );
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      isClosingRef.current = false;
      setIsClosing(false);
      setInternalOpen(true);
      onOpenChange?.(true);
      return;
    }

    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    setIsClosing(true);

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      isClosingRef.current = false;
      setIsClosing(false);
      setInternalOpen(false);
      onOpenChange?.(false);
      closeTimerRef.current = null;
    }, SELECT_CLOSE_ANIMATION_MS);
  };

  return (
    <SelectAnimationContext.Provider value={{ isClosing }}>
      <SelectPrimitive.Root
        open={internalOpen || isClosing}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </SelectAnimationContext.Provider>
  );
};
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={classNames(menuStyles.control, 'w-full justify-between', className)}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon>
      <ChevronDownIcon className={menuStyles.iconSlot} />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', sideOffset = 6, collisionPadding = 8, style, ...props }, ref) => {
  const { isClosing } = React.useContext(SelectAnimationContext);
  const [viewportElement, setViewportElement] = React.useState<HTMLDivElement | null>(null);
  const viewportBoundsStyle = resolveViewportMenuBounds(MENU_AVAILABLE_SIZE_VARIABLES.select);
  const hasLeadingVisual = resolveMenuHasLeadingVisual(children);
  const scrollState = useSelectViewportScrollState(viewportElement);

  const scrollViewport = React.useCallback(
    (direction: SelectScrollDirection): void => {
      if (!viewportElement) {
        return;
      }

      viewportElement.scrollTop += direction === 'up' ? -SELECT_SCROLL_STEP_PX : SELECT_SCROLL_STEP_PX;
    },
    [viewportElement],
  );

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        avoidCollisions
        className={classNames(
          menuStyles.content,
          menuStyles.selectContent,
          isClosing && 'pointer-events-none',
          className,
        )}
        position={position}
        sideOffset={sideOffset}
        sticky="always"
        collisionPadding={normalizeCollisionPadding(collisionPadding)}
        style={{
          ...viewportBoundsStyle,
          opacity: isClosing ? 0 : 1,
          transform: isClosing ? 'scale(0.95)' : undefined,
          transformOrigin: 'var(--radix-select-content-transform-origin, center center)',
          transition: 'opacity 150ms ease-in, transform 150ms ease-in',
          ...style,
        }}
        {...props}
      >
        <SelectScrollIndicator
          direction="up"
          enabled={scrollState.canScrollUp}
          onStep={scrollViewport}
        >
          <ChevronUpIcon className={menuStyles.iconSlot} />
        </SelectScrollIndicator>
        <SelectPrimitive.Viewport
          ref={setViewportElement}
          className={menuStyles.selectViewport}
        >
          <MenuIconSlotContext.Provider value={hasLeadingVisual}>{children}</MenuIconSlotContext.Provider>
        </SelectPrimitive.Viewport>
        <SelectScrollIndicator
          direction="down"
          enabled={scrollState.canScrollDown}
          onStep={scrollViewport}
        >
          <ChevronDownIcon className={menuStyles.iconSlot} />
        </SelectScrollIndicator>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={classNames(menuStyles.label, className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & { icon?: MenuIconComponent; withIconSlot?: boolean }
>(({ className, children, icon: Icon, withIconSlot, ...props }, ref) => {
  const shouldShowIconSlot = useMenuIconSlot(withIconSlot, Icon);

  return (
    <SelectPrimitive.Item
      ref={ref}
      className={classNames(menuStyles.item, className)}
      {...props}
    >
      <span className={classNames(menuStyles.leadingIconSlot, 'shrink-0')}>
        <SelectPrimitive.ItemIndicator className="inline-flex h-4 w-4 items-center justify-center">
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      {shouldShowIconSlot ? (
        <span className={classNames(menuStyles.leadingIconSlot, !Icon && 'opacity-0')}>
          {Icon ? <Icon className="h-4 w-4" /> : null}
        </span>
      ) : null}
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => {
  const shouldInset = useMenuSeparatorInset(inset);

  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={classNames(shouldInset ? menuStyles.separatorInset : menuStyles.separator, className)}
      {...props}
    />
  );
});
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator };
