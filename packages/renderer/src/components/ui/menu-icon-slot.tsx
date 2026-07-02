import React from 'react';

type NodeWithProps = {
  icon?: unknown;
  iconNode?: unknown;
  withIconSlot?: boolean;
  children?: React.ReactNode;
};

const LEADING_VISUAL_ITEM_NAME_PATTERN = /(CheckboxItem|RadioItem)$/;

export const MenuIconSlotContext = React.createContext(false);

/**
 * Safely resolves a menu element display name from React element types, including fragments and symbols.
 *
 * @param elementType - The unknown React element type value to inspect.
 * @returns The display name when the element type exposes one.
 */
const resolveMenuElementDisplayName = (elementType: unknown): string | undefined => {
  if (typeof elementType === 'string') {
    return elementType;
  }

  if (typeof elementType !== 'function' && (typeof elementType !== 'object' || elementType === null)) {
    return undefined;
  }

  if (!('displayName' in elementType)) {
    return undefined;
  }

  const displayName = elementType.displayName;

  return typeof displayName === 'string' ? displayName : undefined;
};

export const resolveMenuHasLeadingVisual = (node: React.ReactNode): boolean =>
  React.Children.toArray(node).some((child) => {
    if (!React.isValidElement<NodeWithProps>(child)) {
      return false;
    }

    const props = child.props;
    const displayName = resolveMenuElementDisplayName(child.type);

    if (props.withIconSlot === true || Boolean(props.icon) || Boolean(props.iconNode)) {
      return true;
    }

    if (displayName && LEADING_VISUAL_ITEM_NAME_PATTERN.test(displayName)) {
      return true;
    }

    return resolveMenuHasLeadingVisual(props.children);
  });

export const useMenuIconSlot = (withIconSlot: boolean | undefined, icon: unknown): boolean => {
  const contextValue = React.useContext(MenuIconSlotContext);

  if (typeof withIconSlot === 'boolean') {
    return withIconSlot;
  }

  return contextValue || Boolean(icon);
};

export const useMenuSeparatorInset = (inset: boolean | undefined): boolean => {
  const contextValue = React.useContext(MenuIconSlotContext);

  if (typeof inset === 'boolean') {
    return inset;
  }

  return contextValue;
};
