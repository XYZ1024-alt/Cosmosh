import classNames from 'classnames';
import { icons } from 'lucide-react';
import React from 'react';

export type EntityColorKey =
  | 'slate'
  | 'blue'
  | 'emerald'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'cyan'
  | 'indigo'
  | 'teal'
  | 'lime';

export type EntityVisual = {
  iconKey: string;
  colorKey: EntityColorKey;
};

export type EntityVisualTarget = 'folder' | 'server';

const iconComponentMap = icons as Record<string, React.ComponentType<{ className?: string }>>;

const defaultFolderIconPool = ['Folder', 'Folders', 'Package2', 'Network', 'Cloud', 'Database'] as const;
const defaultServerIconPool = defaultFolderIconPool;

const colorPool: EntityColorKey[] = [
  'slate',
  'blue',
  'emerald',
  'violet',
  'amber',
  'rose',
  'cyan',
  'indigo',
  'teal',
  'lime',
];

const entityColorClassNameMap: Record<EntityColorKey, string> = {
  slate: 'bg-home-icon-slate text-home-icon-slate-ink',
  blue: 'bg-home-icon-blue text-home-icon-blue-ink',
  emerald: 'bg-home-icon-emerald text-home-icon-emerald-ink',
  violet: 'bg-home-icon-violet text-home-icon-violet-ink',
  amber: 'bg-home-icon-amber text-home-icon-amber-ink',
  rose: 'bg-home-icon-rose text-home-icon-rose-ink',
  cyan: 'bg-home-icon-cyan text-home-icon-cyan-ink',
  indigo: 'bg-home-icon-indigo text-home-icon-indigo-ink',
  teal: 'bg-home-icon-teal text-home-icon-teal-ink',
  lime: 'bg-home-icon-lime text-home-icon-lime-ink',
};

const hashString = (value: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return hash >>> 0;
};

function pickBySeed<T>(seed: string, pool: readonly T[]): T {
  const value = hashString(seed);
  return pool[value % pool.length] as T;
}

const resolveIcon = (iconKey: string): React.ComponentType<{ className?: string }> => {
  return iconComponentMap[iconKey] ?? iconComponentMap.Server;
};

/**
 * Builds a deterministic default visual for newly created entities.
 */
export const pickRandomEntityVisual = (target: EntityVisualTarget, seed: string): EntityVisual => {
  const iconPool = target === 'folder' ? defaultFolderIconPool : defaultServerIconPool;

  return {
    iconKey: pickBySeed(seed, iconPool),
    colorKey: pickBySeed(`${seed}:color`, colorPool),
  };
};

export const getEntityColorClassName = (colorKey: EntityColorKey): string => {
  return entityColorClassNameMap[colorKey];
};

export const isEntityColorKey = (value: string): value is EntityColorKey => {
  return colorPool.includes(value as EntityColorKey);
};

export const entityColorKeys = colorPool;
export const lucideIconNames = Object.keys(iconComponentMap).sort();

/**
 * Creates a consistent icon node used across Home and SSH editor cards.
 */
export const createEntityIconNode = (visual: EntityVisual, label: string): React.ReactNode => {
  const Icon = resolveIcon(visual.iconKey);

  return (
    <span
      aria-hidden
      className={classNames(
        'inline-flex h-full w-full items-center justify-center rounded-md',
        getEntityColorClassName(visual.colorKey),
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </span>
  );
};

export const renderEntityIcon = (iconKey: string, className = 'h-4 w-4'): React.ReactNode => {
  const Icon = resolveIcon(iconKey);
  return <Icon className={className} />;
};
