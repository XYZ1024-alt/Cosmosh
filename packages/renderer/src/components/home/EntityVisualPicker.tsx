import classNames from 'classnames';
import { Palette, Search } from 'lucide-react';
import React from 'react';

import {
  EntityColorKey,
  entityColorKeys,
  EntityVisual,
  getEntityColorClassName,
  lucideIconNames,
  renderEntityIcon,
} from '../../lib/entity-visuals';
import { useDirectionalNavigation } from '../../lib/use-directional-navigation';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Input } from '../ui/input';

type EntityVisualPickerProps = {
  visual: EntityVisual;
  label: string;
  onChange: (nextVisual: EntityVisual) => void;
  children?: React.ReactNode;
};

const EntityVisualPicker: React.FC<EntityVisualPickerProps> = ({ visual, label, onChange, children }) => {
  const [query, setQuery] = React.useState<string>('');
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const wasOpenRef = React.useRef<boolean>(false);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const colorButtonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const iconButtonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const filteredIcons = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return lucideIconNames;
    }

    return lucideIconNames.filter((iconName) => iconName.toLowerCase().includes(keyword));
  }, [query]);

  const selectedColorIndex = React.useMemo(() => {
    return Math.max(entityColorKeys.indexOf(visual.colorKey), 0);
  }, [visual.colorKey]);

  const selectedIconIndex = React.useMemo(() => {
    const matchedIndex = filteredIcons.indexOf(visual.iconKey);
    return matchedIndex >= 0 ? matchedIndex : 0;
  }, [filteredIcons, visual.iconKey]);

  const onPickColor = React.useCallback(
    (colorKey: EntityColorKey) => {
      onChange({ ...visual, colorKey });
    },
    [onChange, visual],
  );

  const onPickIcon = React.useCallback(
    (iconKey: string) => {
      onChange({ ...visual, iconKey });
    },
    [onChange, visual],
  );

  const colorNavigation = useDirectionalNavigation({
    itemCount: entityColorKeys.length,
    columns: entityColorKeys.length,
    initialIndex: selectedColorIndex,
  });
  const setColorActiveIndex = colorNavigation.setActiveIndex;
  const focusColorItem = colorNavigation.focusItem;

  const iconNavigation = useDirectionalNavigation({
    itemCount: filteredIcons.length,
    columns: 8,
    initialIndex: selectedIconIndex,
  });
  const setIconActiveIndex = iconNavigation.setActiveIndex;

  React.useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!isOpen) {
      return;
    }

    setColorActiveIndex(selectedColorIndex);

    if (!wasOpen) {
      requestAnimationFrame(() => {
        focusColorItem(selectedColorIndex);
      });
    }
  }, [focusColorItem, isOpen, selectedColorIndex, setColorActiveIndex]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    setIconActiveIndex(selectedIconIndex);
  }, [isOpen, selectedIconIndex, setIconActiveIndex]);

  const getSelectedColorButton = React.useCallback((): HTMLButtonElement | null => {
    return colorButtonRefs.current[selectedColorIndex] ?? null;
  }, [selectedColorIndex]);

  const getSelectedIconButton = React.useCallback((): HTMLButtonElement | null => {
    return iconButtonRefs.current[selectedIconIndex] ?? null;
  }, [selectedIconIndex]);

  React.useEffect(() => {
    colorButtonRefs.current = colorButtonRefs.current.slice(0, entityColorKeys.length);
  }, []);

  React.useEffect(() => {
    iconButtonRefs.current = iconButtonRefs.current.slice(0, filteredIcons.length);
  }, [filteredIcons.length]);

  const isFocusTargetInRefs = React.useCallback(
    (refs: Array<HTMLElement | null>, target: HTMLElement): boolean => refs.some((node) => node === target),
    [],
  );

  const onContentKeyDownCapture = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Tab') {
        return;
      }

      const target = event.target as HTMLElement;
      const isColorTarget = isFocusTargetInRefs(colorButtonRefs.current, target);
      const isIconTarget = isFocusTargetInRefs(iconButtonRefs.current, target);
      const isSearchTarget = searchInputRef.current === target;

      if (isColorTarget && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        searchInputRef.current?.focus();
        return;
      }

      if (isSearchTarget) {
        if (event.shiftKey) {
          const selectedColorButton = getSelectedColorButton();
          if (!selectedColorButton) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          selectedColorButton.focus();
          return;
        }

        const selectedIconButton = getSelectedIconButton();
        if (!selectedIconButton) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        selectedIconButton.focus();
        return;
      }

      if (isIconTarget && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        searchInputRef.current?.focus();
      }
    },
    [getSelectedColorButton, getSelectedIconButton, isFocusTargetInRefs],
  );

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <DropdownMenuTrigger asChild>
        {children ?? (
          <Button
            variant="ghost"
            className="h-8 gap-1.5 px-2"
            aria-label={label}
          >
            <Palette size={14} />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[360px] p-2"
        onKeyDownCapture={onContentKeyDownCapture}
      >
        <div className="m-1 mb-2 flex flex-wrap gap-2">
          {entityColorKeys.map((colorKey, colorIndex) => {
            const isActive = colorKey === visual.colorKey;
            const colorNavigationItemProps = colorNavigation.getItemProps(colorIndex);
            return (
              <button
                key={colorKey}
                type="button"
                aria-label={colorKey}
                {...colorNavigationItemProps}
                ref={(node) => {
                  colorNavigationItemProps.ref(node);
                  colorButtonRefs.current[colorIndex] = node;
                }}
                className={classNames(
                  'border-home-divider/60 h-6 w-6 rounded-full',
                  getEntityColorClassName(colorKey),
                  isActive && 'ring-1 ring-offset-1 ring-offset-transparent',
                )}
                onClick={() => onPickColor(colorKey)}
              />
            );
          })}
        </div>

        <div className="relative mb-2">
          <Input
            ref={searchInputRef}
            value={query}
            placeholder={label}
            className="h-8 pr-8"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Search className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-header-text-muted" />
        </div>

        <div className="max-h-[260px] overflow-auto pr-1">
          <div className="flex flex-wrap items-center gap-1">
            {filteredIcons.map((iconKey, iconIndex) => {
              const isActive = iconKey === visual.iconKey;
              const iconNavigationItemProps = iconNavigation.getItemProps(iconIndex);
              return (
                <button
                  key={iconKey}
                  type="button"
                  {...iconNavigationItemProps}
                  ref={(node) => {
                    iconNavigationItemProps.ref(node);
                    iconButtonRefs.current[iconIndex] = node;
                  }}
                  className={classNames(
                    'flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-form-control-hover',
                    isActive && 'bg-form-control-hover !text-text',
                  )}
                  aria-label={iconKey}
                  onClick={() => onPickIcon(iconKey)}
                >
                  {renderEntityIcon(iconKey)}
                </button>
              );
            })}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default EntityVisualPicker;
