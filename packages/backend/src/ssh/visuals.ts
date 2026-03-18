import type { components } from '@cosmosh/api-contract';

type SshVisualColorKey = components['schemas']['SshVisualColorKey'];

const colorKeys: readonly SshVisualColorKey[] = [
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

/**
 * Narrows persisted color strings to the API contract enum.
 */
export const normalizeSshVisualColorKey = (
  value: string,
  fallbackColor: SshVisualColorKey = 'blue',
): SshVisualColorKey => {
  return colorKeys.includes(value as SshVisualColorKey) ? (value as SshVisualColorKey) : fallbackColor;
};
