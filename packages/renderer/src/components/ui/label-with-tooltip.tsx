import classNames from 'classnames';
import { CircleHelp } from 'lucide-react';
import React from 'react';

import { Label } from './label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

type LabelWithTooltipProps = {
  htmlFor: string;
  tooltip: string;
  children: React.ReactNode;
  className?: string;
  labelClassName?: string;
};

/**
 * Renders a form label with a compact question-mark tooltip trigger.
 *
 * @param props - Component props.
 * @returns A label and tooltip trigger pair that stays visually attached.
 */
const LabelWithTooltip: React.FC<LabelWithTooltipProps> = ({
  htmlFor,
  tooltip,
  children,
  className,
  labelClassName,
}) => {
  return (
    <TooltipProvider delayDuration={180}>
      <div className={classNames('inline-flex items-center gap-0.5', className)}>
        <Label
          htmlFor={htmlFor}
          className={labelClassName}
        >
          {children}
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={tooltip}
              className="focus-visible:ring-form-active/60 inline-flex h-4 w-4 items-center justify-center rounded-full text-form-text-muted outline-none transition [-webkit-app-region:no-drag] hover:bg-form-control-hover hover:text-form-text focus-visible:ring-2"
            >
              <CircleHelp className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};

export { LabelWithTooltip };
