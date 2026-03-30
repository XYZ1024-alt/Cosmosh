import { Settings2 } from 'lucide-react';
import React from 'react';

import {
  collectCommandPaletteCommands,
  type CommandPaletteCommand,
  type CommandPaletteProvider,
  createCommandPaletteProvider,
  executeCommandPaletteCommand,
  filterCommandPaletteCommands,
} from '../lib/command-palette';
import { getLocale, onLocaleChange, t, tForLocale } from '../lib/i18n';
import { renderTabIconByKey } from '../lib/tab-icon';
import { resolveCategoryId, SETTINGS_REGISTRY } from '../pages/settings-registry';
import type { TabItem } from '../types/tabs';
import { CommandPalette, type CommandPaletteItem } from './ui/command-palette';

type AppCommandPaletteContext = {
  locale: string;
  activeTabId: string;
  tabs: ReadonlyArray<TabItem>;
  addTab: (page: string, overrides?: Partial<TabItem>) => string;
  closeTab: (tabId: string) => void;
  closeRightTabs: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
};

type AppCommandPaletteHostProps = Omit<AppCommandPaletteContext, 'locale'>;

type BilingualCommandLabel = {
  primary: string;
  english: string;
  secondary?: string;
};

/**
 * Resolves localized and English labels for command rendering.
 *
 * @param i18nKey Translation key.
 * @param locale Active renderer locale.
 * @returns Primary label, English fallback label, and optional secondary line.
 */
const resolveBilingualCommandLabel = (i18nKey: string, locale: string): BilingualCommandLabel => {
  const primary = t(i18nKey);
  const english = tForLocale('en', i18nKey);
  const secondary = locale === 'en' || english === primary ? undefined : english;

  return {
    primary,
    english,
    secondary,
  };
};

/**
 * Builds deduplicated command search terms while preserving insertion order.
 *
 * @param groups Search-term groups.
 * @returns Flattened and deduplicated search terms.
 */
const buildSearchTerms = (...groups: ReadonlyArray<string>[]): string[] => {
  const deduped = new Map<string, string>();

  for (const group of groups) {
    for (const candidate of group) {
      const normalized = candidate.trim();
      if (!normalized) {
        continue;
      }

      const lookupKey = normalized.toLowerCase();
      if (deduped.has(lookupKey)) {
        continue;
      }

      deduped.set(lookupKey, normalized);
    }
  }

  return Array.from(deduped.values());
};

/**
 * Creates the tab-domain provider for command palette actions.
 *
 * @returns Provider with new/switch/close tab commands.
 */
const createTabsCommandPaletteProvider = (): CommandPaletteProvider<AppCommandPaletteContext> => {
  return createCommandPaletteProvider('tabs', (context) => {
    const newTabLabel = resolveBilingualCommandLabel('commandPalette.commands.tabs.newTab', context.locale);
    const closeCurrentTabLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.tabs.closeCurrentTab',
      context.locale,
    );
    const closeRightTabsLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.tabs.closeRightTabs',
      context.locale,
    );
    const switchToTabLabel = resolveBilingualCommandLabel('commandPalette.commands.tabs.switchToTab', context.locale);
    const currentTabLabel = resolveBilingualCommandLabel('commandPalette.commands.tabs.currentTab', context.locale);

    const structuralCommands: CommandPaletteCommand[] = [
      {
        kind: 'action',
        id: 'new-tab',
        commandActionId: 'tabs.new',
        title: newTabLabel.primary,
        subtitle: newTabLabel.secondary,
        searchTerms: buildSearchTerms(['tabs.new', 'tab.create', 'tab.home'], [newTabLabel.english]),
        run: () => {
          context.addTab('home');
        },
      },
      {
        kind: 'action',
        id: 'close-current-tab',
        commandActionId: 'tabs.close.current',
        title: closeCurrentTabLabel.primary,
        subtitle: closeCurrentTabLabel.secondary,
        searchTerms: buildSearchTerms(['close tab', 'close current tab'], [closeCurrentTabLabel.english]),
        run: () => {
          context.closeTab(context.activeTabId);
        },
      },
      {
        kind: 'action',
        id: 'close-right-tabs',
        commandActionId: 'tabs.close.right',
        title: closeRightTabsLabel.primary,
        subtitle: closeRightTabsLabel.secondary,
        searchTerms: buildSearchTerms(['close right tabs', 'close tabs right'], [closeRightTabsLabel.english]),
        run: () => {
          context.closeRightTabs(context.activeTabId);
        },
      },
    ];

    const switchCommands: CommandPaletteCommand[] = context.tabs.map((tab) => ({
      kind: 'action',
      id: `switch:${tab.id}`,
      commandActionId: 'tabs.switch',
      title: tab.title,
      subtitle: tab.id === context.activeTabId ? currentTabLabel.secondary : switchToTabLabel.secondary,
      icon: renderTabIconByKey(tab.iconKey, tab.iconColorKey, true),
      searchTerms: buildSearchTerms(
        [tab.id, tab.page, tab.title, 'tabs.switch', 'tab.activate'],
        [currentTabLabel.english, switchToTabLabel.english],
      ),
      run: () => {
        context.setActiveTabId(tab.id);
      },
    }));

    return [...structuralCommands, ...switchCommands];
  });
};

/**
 * Creates the settings-domain provider for command palette actions.
 *
 * Each setting command opens a settings tab and injects the setting key into
 * the search box so the Settings page can perform exact-key matching.
 *
 * @returns Provider with all settings-search commands.
 */
const createSettingsCommandPaletteProvider = (): CommandPaletteProvider<AppCommandPaletteContext> => {
  return createCommandPaletteProvider('settings', (context) => {
    return SETTINGS_REGISTRY.map((item): CommandPaletteCommand => {
      const categoryId = resolveCategoryId(item.category);
      const settingLabel = resolveBilingualCommandLabel(item.nameI18nKey, context.locale);

      return {
        kind: 'action',
        id: item.key,
        commandActionId: item.commandActionId,
        title: settingLabel.primary,
        subtitle: settingLabel.secondary,
        icon: <Settings2 className="h-4 w-4" />,
        searchTerms: buildSearchTerms(
          [item.key, item.path, item.commandActionId, ...item.searchTerms],
          [settingLabel.english],
        ),
        run: () => {
          context.addTab('settings', {
            state: {
              settingsCategory: categoryId,
              settingsInitialSearch: item.key,
            },
          });
        },
      };
    });
  });
};

/**
 * Resolves whether the keyboard event carries the supported platform modifier
 * for opening command palette.
 *
 * @param event Native keyboard event.
 * @param isMacPlatform Whether the renderer runs on macOS.
 * @returns True when the event matches the primary command modifier.
 */
const hasSupportedShortcutModifier = (event: KeyboardEvent, isMacPlatform: boolean): boolean => {
  return isMacPlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
};

/**
 * App-scoped command palette host.
 *
 * This component centralizes global shortcut orchestration and provider-based
 * command registration so the root App component remains focused on layout and
 * runtime wiring.
 *
 * @param props Command context from App runtime.
 * @returns Command palette overlay element.
 */
const AppCommandPaletteHost: React.FC<AppCommandPaletteHostProps> = ({
  activeTabId,
  tabs,
  addTab,
  closeTab,
  closeRightTabs,
  setActiveTabId,
}) => {
  const isMacPlatform = React.useMemo(() => window.electron?.platform === 'darwin', []);
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const [query, setQuery] = React.useState<string>('');
  const [locale, setLocale] = React.useState<string>(() => getLocale());

  React.useEffect(() => {
    return onLocaleChange((nextLocale) => {
      setLocale(nextLocale);
    });
  }, []);

  const closeCommandPalette = React.useCallback((): void => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const openCommandPalette = React.useCallback((): void => {
    setQuery('');
    setIsOpen(true);
  }, []);

  const commandPaletteContext = React.useMemo<AppCommandPaletteContext>(
    () => ({
      locale,
      activeTabId,
      tabs,
      addTab,
      closeTab,
      closeRightTabs,
      setActiveTabId,
    }),
    [activeTabId, addTab, closeRightTabs, closeTab, locale, setActiveTabId, tabs],
  );

  const commandPaletteProviders = React.useMemo<ReadonlyArray<CommandPaletteProvider<AppCommandPaletteContext>>>(
    () => [createTabsCommandPaletteProvider(), createSettingsCommandPaletteProvider()],
    [],
  );

  const commandPaletteCommands = React.useMemo(() => {
    return collectCommandPaletteCommands(commandPaletteProviders, commandPaletteContext);
  }, [commandPaletteContext, commandPaletteProviders]);

  const filteredCommandPaletteCommands = React.useMemo(() => {
    return filterCommandPaletteCommands(commandPaletteCommands, query);
  }, [commandPaletteCommands, query]);

  const commandPaletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    return filteredCommandPaletteCommands.map((command) => ({
      key: command.key,
      title: command.title,
      subtitle: command.subtitle,
      icon: command.icon,
      onSelect: () => {
        executeCommandPaletteCommand(command);
        closeCommandPalette();
      },
    }));
  }, [closeCommandPalette, filteredCommandPaletteCommands]);

  React.useEffect(() => {
    const handleGlobalCommandPaletteShortcut = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }

      if (event.altKey || !event.shiftKey || event.key.toLowerCase() !== 'p') {
        return;
      }

      if (!hasSupportedShortcutModifier(event, isMacPlatform)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openCommandPalette();
    };

    window.addEventListener('keydown', handleGlobalCommandPaletteShortcut, true);

    return () => {
      window.removeEventListener('keydown', handleGlobalCommandPaletteShortcut, true);
    };
  }, [isMacPlatform, openCommandPalette]);

  return (
    <CommandPalette
      closeOnEsc
      open={isOpen}
      query={query}
      placeholder={t('commandPalette.placeholder')}
      emptyText={t('commandPalette.empty')}
      items={commandPaletteItems}
      onOpenChange={(open) => {
        if (!open) {
          closeCommandPalette();
          return;
        }

        setIsOpen(true);
      }}
      onQueryChange={setQuery}
    />
  );
};

export default AppCommandPaletteHost;
