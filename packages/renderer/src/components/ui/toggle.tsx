import * as TogglePrimitive from '@radix-ui/react-toggle';
import classNames from 'classnames';
import React from 'react';

import { formStyles } from './form-styles';

type ToggleVariant = 'default' | 'icon';

type ToggleProps = React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & {
  'data-state'?: string;
  variant?: ToggleVariant;
};

/**
 * Shared pressed-state toggle control styled with form tokens.
 *
 * Key controlled props:
 * - `variant`: visual density, with `icon` matching icon-only button sizing.
 * - `pressed`: current on/off state.
 * - `onPressedChange`: callback fired when pressed state changes.
 *
 * @param props Radix toggle root props including `pressed` and `onPressedChange`.
 * @param ref Forwarded ref to the underlying Radix toggle root element.
 * @returns Toggle root element.
 */
const Toggle = React.forwardRef<React.ElementRef<typeof TogglePrimitive.Root>, ToggleProps>(
  ({ className, 'data-state': externalDataState, variant = 'default', ...props }, ref) => {
    // TooltipTrigger asChild forwards its own data-state; Toggle must keep Radix Toggle's on/off state.
    void externalDataState;

    const isIconVariant = variant === 'icon';

    return (
      <TogglePrimitive.Root
        ref={ref}
        data-toggle-variant={variant}
        className={classNames(formStyles.toggle, isIconVariant && 'h-[34px] w-[34px] flex-shrink-0 !p-0', className)}
        {...props}
      />
    );
  },
);
Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle };
