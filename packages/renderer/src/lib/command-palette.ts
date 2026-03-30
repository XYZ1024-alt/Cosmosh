import type { ReactNode } from 'react';

/**
 * Supported command kinds in the command palette runtime.
 *
 * `setting-toggle` is reserved for a follow-up milestone where settings can be
 * toggled directly from the palette.
 */
export type CommandPaletteCommandKind = 'action' | 'setting-toggle';

type CommandPaletteCommandBase = {
  id: string;
  commandActionId: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  searchTerms?: ReadonlyArray<string>;
};

export type CommandPaletteActionCommand = CommandPaletteCommandBase & {
  kind: 'action';
  run: () => void;
};

export type CommandPaletteSettingToggleCommand = CommandPaletteCommandBase & {
  kind: 'setting-toggle';
  settingKey: string;
  run?: () => void;
};

export type CommandPaletteCommand = CommandPaletteActionCommand | CommandPaletteSettingToggleCommand;

export type CommandPaletteProvider<Context> = {
  domainId: string;
  provideCommands: (context: Context) => ReadonlyArray<CommandPaletteCommand>;
};

export type RegisteredCommandPaletteCommand = CommandPaletteCommand & {
  domainId: string;
  key: string;
};

const normalizeSearchToken = (value: string): string => value.trim().toLowerCase();

/**
 * Creates a domain-scoped command provider.
 *
 * @param domainId Stable domain identifier (for example, `tabs` or `settings`).
 * @param provideCommands Domain command factory.
 * @returns Provider definition used by the palette aggregation pipeline.
 */
export const createCommandPaletteProvider = <Context>(
  domainId: string,
  provideCommands: (context: Context) => ReadonlyArray<CommandPaletteCommand>,
): CommandPaletteProvider<Context> => ({
  domainId,
  provideCommands,
});

/**
 * Collects all commands from registered providers and applies per-domain keying.
 *
 * @param providers Domain providers that register commands.
 * @param context Runtime context passed to each provider.
 * @returns Flattened command list with stable command keys.
 */
export const collectCommandPaletteCommands = <Context>(
  providers: ReadonlyArray<CommandPaletteProvider<Context>>,
  context: Context,
): ReadonlyArray<RegisteredCommandPaletteCommand> => {
  const dedupedCommands = new Map<string, RegisteredCommandPaletteCommand>();

  for (const provider of providers) {
    const providedCommands = provider.provideCommands(context);
    for (const command of providedCommands) {
      const key = `${provider.domainId}:${command.id}`;
      if (dedupedCommands.has(key)) {
        continue;
      }

      dedupedCommands.set(key, {
        ...command,
        domainId: provider.domainId,
        key,
      });
    }
  }

  return Array.from(dedupedCommands.values());
};

/**
 * Filters commands using command metadata text.
 *
 * @param commands Commands to filter.
 * @param query Raw search query from the palette input.
 * @returns Commands that match the normalized query.
 */
export const filterCommandPaletteCommands = (
  commands: ReadonlyArray<RegisteredCommandPaletteCommand>,
  query: string,
): ReadonlyArray<RegisteredCommandPaletteCommand> => {
  const normalizedQuery = normalizeSearchToken(query);
  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter((command) => {
    const haystack = [command.title, command.subtitle ?? '', command.commandActionId, ...(command.searchTerms ?? [])]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
};

/**
 * Executes the selected command.
 *
 * @param command Selected command entry.
 * @returns Nothing.
 */
export const executeCommandPaletteCommand = (command: RegisteredCommandPaletteCommand): void => {
  if (command.kind === 'action') {
    command.run();
    return;
  }

  command.run?.();
};
