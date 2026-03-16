import React from 'react';

type DirectionalNavigationOptions = {
  itemCount: number;
  columns?: number;
  initialIndex?: number;
};

type DirectionalNavigationItemProps = {
  ref: (node: HTMLDivElement | null) => void;
  tabIndex: number;
  onFocus: React.FocusEventHandler<HTMLDivElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
};

const clampIndex = (value: number, itemCount: number): number => {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(value, 0), itemCount - 1);
};

/**
 * Resolves the closest neighbor on a responsive CSS grid using actual element positions.
 */
const resolveGeometricNeighborIndex = (
  currentIndex: number,
  key: string,
  itemRefs: Array<HTMLDivElement | null>,
): number | null => {
  const currentNode = itemRefs[currentIndex];
  if (!currentNode) {
    return null;
  }

  const currentRect = currentNode.getBoundingClientRect();
  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentCenterY = currentRect.top + currentRect.height / 2;
  const rowTolerance = Math.max(4, currentRect.height * 0.5);

  let bestIndex: number | null = null;
  let bestPrimaryDistance = Number.POSITIVE_INFINITY;
  let bestSecondaryDistance = Number.POSITIVE_INFINITY;

  itemRefs.forEach((node, index) => {
    if (!node || index === currentIndex) {
      return;
    }

    const rect = node.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let primaryDistance = Number.POSITIVE_INFINITY;
    let secondaryDistance = Number.POSITIVE_INFINITY;

    if (key === 'ArrowRight') {
      const isSameRow = Math.abs(rect.top - currentRect.top) <= rowTolerance;
      if (!isSameRow || centerX <= currentCenterX) {
        return;
      }

      primaryDistance = centerX - currentCenterX;
      secondaryDistance = Math.abs(centerY - currentCenterY);
    } else if (key === 'ArrowLeft') {
      const isSameRow = Math.abs(rect.top - currentRect.top) <= rowTolerance;
      if (!isSameRow || centerX >= currentCenterX) {
        return;
      }

      primaryDistance = currentCenterX - centerX;
      secondaryDistance = Math.abs(centerY - currentCenterY);
    } else if (key === 'ArrowDown') {
      if (centerY <= currentCenterY) {
        return;
      }

      primaryDistance = centerY - currentCenterY;
      secondaryDistance = Math.abs(centerX - currentCenterX);
    } else if (key === 'ArrowUp') {
      if (centerY >= currentCenterY) {
        return;
      }

      primaryDistance = currentCenterY - centerY;
      secondaryDistance = Math.abs(centerX - currentCenterX);
    } else {
      return;
    }

    if (
      primaryDistance < bestPrimaryDistance ||
      (primaryDistance === bestPrimaryDistance && secondaryDistance < bestSecondaryDistance)
    ) {
      bestIndex = index;
      bestPrimaryDistance = primaryDistance;
      bestSecondaryDistance = secondaryDistance;
    }
  });

  return bestIndex;
};

export const useDirectionalNavigation = ({
  itemCount,
  columns = 1,
  initialIndex = 0,
}: DirectionalNavigationOptions) => {
  const [activeIndex, setActiveIndex] = React.useState<number>(() => clampIndex(initialIndex, itemCount));
  const itemRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  React.useEffect(() => {
    setActiveIndex((previous) => clampIndex(previous, itemCount));
  }, [itemCount]);

  const focusItem = React.useCallback(
    (index: number) => {
      const nextIndex = clampIndex(index, itemCount);
      const target = itemRefs.current[nextIndex];
      if (!target) {
        return;
      }

      target.focus();
      setActiveIndex(nextIndex);
    },
    [itemCount],
  );

  const resolveNextIndex = React.useCallback(
    (currentIndex: number, key: string): number => {
      if (itemCount <= 0) {
        return 0;
      }

      const geometricNeighborIndex = resolveGeometricNeighborIndex(currentIndex, key, itemRefs.current);
      if (geometricNeighborIndex !== null) {
        return geometricNeighborIndex;
      }

      const normalizedColumns = Math.max(columns, 1);

      if (key === 'ArrowRight') {
        const isRowEnd = (currentIndex + 1) % normalizedColumns === 0;
        if (isRowEnd || currentIndex + 1 >= itemCount) {
          return currentIndex;
        }

        return currentIndex + 1;
      }

      if (key === 'ArrowLeft') {
        const isRowStart = currentIndex % normalizedColumns === 0;
        if (isRowStart) {
          return currentIndex;
        }

        return currentIndex - 1;
      }

      if (key === 'ArrowDown') {
        const nextIndex = currentIndex + normalizedColumns;
        return nextIndex >= itemCount ? currentIndex : nextIndex;
      }

      if (key === 'ArrowUp') {
        const nextIndex = currentIndex - normalizedColumns;
        return nextIndex < 0 ? currentIndex : nextIndex;
      }

      return currentIndex;
    },
    [columns, itemCount],
  );

  const getItemProps = React.useCallback(
    (index: number): DirectionalNavigationItemProps => {
      return {
        ref: (node) => {
          itemRefs.current[index] = node;
        },
        tabIndex: index === activeIndex ? 0 : -1,
        onFocus: () => {
          setActiveIndex(index);
        },
        onKeyDown: (event) => {
          if (event.currentTarget !== event.target) {
            return;
          }

          if (
            event.key !== 'ArrowUp' &&
            event.key !== 'ArrowDown' &&
            event.key !== 'ArrowLeft' &&
            event.key !== 'ArrowRight'
          ) {
            return;
          }

          event.preventDefault();
          const nextIndex = resolveNextIndex(index, event.key);
          focusItem(nextIndex);
        },
      };
    },
    [activeIndex, focusItem, resolveNextIndex],
  );

  return {
    activeIndex,
    setActiveIndex,
    getItemProps,
  };
};
