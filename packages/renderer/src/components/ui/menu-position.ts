import type React from 'react';

type CollisionPaddingObject = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type CollisionPaddingInput = number | Partial<CollisionPaddingObject> | undefined;

type MenuAvailableSizeVariables = {
  width: string;
  height: string;
};

const MENU_MAX_WIDTH_PX = 420;
const MENU_MAX_HEIGHT_PX = 560;
const MENU_VIEWPORT_GUTTER_PX = 16;

/**
 * Radix exposes per-primitive available-size variables after collision handling.
 */
export const MENU_AVAILABLE_SIZE_VARIABLES = {
  contextMenu: {
    width: '--radix-context-menu-content-available-width',
    height: '--radix-context-menu-content-available-height',
  },
  dropdownMenu: {
    width: '--radix-dropdown-menu-content-available-width',
    height: '--radix-dropdown-menu-content-available-height',
  },
  menubar: {
    width: '--radix-menubar-content-available-width',
    height: '--radix-menubar-content-available-height',
  },
  select: {
    width: '--radix-select-content-available-width',
    height: '--radix-select-content-available-height',
  },
} as const satisfies Record<string, MenuAvailableSizeVariables>;

/**
 * Builds a CSS max-size cap from the design limit and the current collision-aware viewport.
 *
 * @param maxPixels Hard Cosmosh design-system cap for the floating menu axis.
 * @param viewportUnit Viewport unit used when Radix has not positioned the menu yet.
 * @param availableVariable Optional Radix custom property for the currently available axis.
 * @returns CSS max-size expression.
 */
const resolveMenuAxisLimit = (maxPixels: number, viewportUnit: 'vw' | 'vh', availableVariable?: string): string => {
  const viewportFallback = `calc(100${viewportUnit} - ${MENU_VIEWPORT_GUTTER_PX}px)`;

  if (!availableVariable) {
    return `min(${maxPixels}px, ${viewportFallback})`;
  }

  return `min(${maxPixels}px, var(${availableVariable}, ${viewportFallback}))`;
};

/**
 * Resolves floating menu bounds without relying on a stale JavaScript viewport snapshot.
 *
 * @param availableSizeVariables Radix custom properties for the concrete menu primitive.
 * @returns Inline CSS properties that keep menus inside the collision-aware viewport.
 */
export const resolveViewportMenuBounds = (
  availableSizeVariables?: Partial<MenuAvailableSizeVariables>,
): React.CSSProperties => {
  return {
    maxWidth: resolveMenuAxisLimit(MENU_MAX_WIDTH_PX, 'vw', availableSizeVariables?.width),
    maxHeight: resolveMenuAxisLimit(MENU_MAX_HEIGHT_PX, 'vh', availableSizeVariables?.height),
  };
};

/**
 * Normalizes Radix collision padding so every side has a stable default.
 *
 * @param collisionPadding Numeric or per-side padding from a menu wrapper.
 * @param defaultPadding Fallback padding when the wrapper omits a value.
 * @returns Collision padding object passed to Radix.
 */
export const normalizeCollisionPadding = (
  collisionPadding: CollisionPaddingInput,
  defaultPadding = 8,
): CollisionPaddingObject | Partial<CollisionPaddingObject> => {
  if (typeof collisionPadding === 'number') {
    return {
      top: collisionPadding,
      right: collisionPadding,
      bottom: collisionPadding,
      left: collisionPadding,
    };
  }

  if (collisionPadding && typeof collisionPadding === 'object') {
    return collisionPadding;
  }

  return {
    top: defaultPadding,
    right: defaultPadding,
    bottom: defaultPadding,
    left: defaultPadding,
  };
};
