import { Bug, RefreshCcw, Settings2 } from 'lucide-react';
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
import { useSettingsValue } from '../lib/settings-store';
import { renderTabIconByKey } from '../lib/tab-icon';
import { useToast } from '../lib/toast-context';
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
  showSystemMonitorOverlay: boolean;
  onShowSystemMonitorOverlayChange: (nextVisible: boolean) => void;
  enableMainHeapSnapshotExport: boolean;
  onEnableMainHeapSnapshotExportChange: (nextEnabled: boolean) => void;
  isDevBuild: boolean;
  devToolsEnabled: boolean;
  userMenuDebugEntryEnabled: boolean;
  notifySuccess: (message: string) => void;
  notifyWarning: (message: string) => void;
};

type AppCommandPaletteHostProps = Omit<
  AppCommandPaletteContext,
  'locale' | 'isDevBuild' | 'devToolsEnabled' | 'userMenuDebugEntryEnabled' | 'notifySuccess' | 'notifyWarning'
>;

type BilingualCommandLabel = {
  primary: string;
  english: string;
  secondary?: string;
};

type CommandPaletteScopeId = 'tabs' | 'settings' | 'developer';

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
 * Resolves localized scope labels for command palette titles.
 *
 * @param domainId Command domain identifier.
 * @param locale Active renderer locale.
 * @returns Localized scope label metadata or undefined when not available.
 */
const resolveCommandPaletteScopeLabel = (domainId: string, locale: string): BilingualCommandLabel | undefined => {
  const scopedDomainId = domainId as CommandPaletteScopeId;

  if (scopedDomainId === 'tabs') {
    return resolveBilingualCommandLabel('commandPalette.scopes.tabs', locale);
  }

  if (scopedDomainId === 'settings') {
    return resolveBilingualCommandLabel('commandPalette.scopes.settings', locale);
  }

  if (scopedDomainId === 'developer') {
    return resolveBilingualCommandLabel('commandPalette.scopes.developer', locale);
  }

  return undefined;
};

/**
 * Builds searchable tokens for a command scope label.
 *
 * This ensures typing a scope name (with or without a trailing separator) can
 * match commands belonging to that domain.
 *
 * @param scopeLabel Scope label metadata.
 * @returns Searchable tokens for the scope label.
 */
const buildScopeSearchTerms = (scopeLabel: BilingualCommandLabel): string[] => {
  return buildSearchTerms(
    [scopeLabel.primary, scopeLabel.english],
    [`${scopeLabel.primary}:`],
    [`${scopeLabel.english}:`],
  );
};

/**
 * Formats a command title with a localized scope prefix.
 *
 * @param scopeLabel Localized label shown as prefix.
 * @param title Command title.
 * @returns Scoped title string.
 */
const formatScopedCommandTitle = (scopeLabel: string, title: string): string => {
  const hasNonAscii = Array.from(scopeLabel).some((character) => character.charCodeAt(0) > 0x7f);
  const prefix = hasNonAscii ? `${scopeLabel}：` : `${scopeLabel}: `;

  if (title.startsWith(prefix)) {
    return title;
  }

  return `${prefix}${title}`;
};

/**
 * Creates the tab-domain provider for command palette actions.
 *
 * @returns Provider with new/switch/close tab commands.
 */
const createTabsCommandPaletteProvider = (): CommandPaletteProvider<AppCommandPaletteContext> => {
  return createCommandPaletteProvider('tabs', (context) => {
    const scopeLabel = resolveBilingualCommandLabel('commandPalette.scopes.tabs', context.locale);
    const scopeSearchTerms = buildScopeSearchTerms(scopeLabel);

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
        searchTerms: buildSearchTerms(['tabs.new', 'tab.create', 'tab.home'], scopeSearchTerms, [newTabLabel.english]),
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
        searchTerms: buildSearchTerms(['close tab', 'close current tab'], scopeSearchTerms, [
          closeCurrentTabLabel.english,
        ]),
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
        searchTerms: buildSearchTerms(['close right tabs', 'close tabs right'], scopeSearchTerms, [
          closeRightTabsLabel.english,
        ]),
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
      icon: renderTabIconByKey(tab.iconKey, tab.iconColorKey, false),
      searchTerms: buildSearchTerms([tab.id, tab.page, tab.title, 'tabs.switch', 'tab.activate'], scopeSearchTerms, [
        currentTabLabel.english,
        switchToTabLabel.english,
      ]),
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
    const scopeLabel = resolveBilingualCommandLabel('commandPalette.scopes.settings', context.locale);
    const scopeSearchTerms = buildScopeSearchTerms(scopeLabel);

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
          scopeSearchTerms,
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
 * Creates the developer-domain provider for runtime/debug commands.
 *
 * @returns Provider with command-palette developer actions.
 */
const createDeveloperCommandPaletteProvider = (): CommandPaletteProvider<AppCommandPaletteContext> => {
  return createCommandPaletteProvider('developer', (context) => {
    const scopeLabel = resolveBilingualCommandLabel('commandPalette.scopes.developer', context.locale);
    const scopeSearchTerms = buildScopeSearchTerms(scopeLabel);

    const reloadBackendLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.developer.reloadBackend',
      context.locale,
    );
    const reloadWebViewLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.developer.reloadWebView',
      context.locale,
    );
    const toggleDevToolsLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.developer.toggleDevTools',
      context.locale,
    );
    const toggleSystemMonitorOverlayLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.developer.toggleSystemMonitorOverlay',
      context.locale,
    );
    const toggleMainHeapSnapshotExportLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.developer.toggleMainHeapSnapshotExport',
      context.locale,
    );
    const captureMainHeapSnapshotLabel = resolveBilingualCommandLabel(
      'commandPalette.commands.developer.captureMainHeapSnapshot',
      context.locale,
    );

    const commands: CommandPaletteCommand[] = [];

    if (context.isDevBuild) {
      commands.push({
        kind: 'action',
        id: 'reload-backend',
        commandActionId: 'developer.reloadBackend',
        title: reloadBackendLabel.primary,
        subtitle: reloadBackendLabel.secondary,
        icon: <RefreshCcw className="h-4 w-4" />,
        searchTerms: buildSearchTerms(
          ['developer.reload-backend', 'reload backend', 'restart backend runtime'],
          scopeSearchTerms,
          [reloadBackendLabel.english],
        ),
        run: () => {
          void (async () => {
            try {
              const restarted = await window.electron?.restartBackendRuntime?.();
              if (restarted) {
                context.notifySuccess(t('header.restartBackendSuccess'));
                return;
              }
            } catch {
              // Fall through to warning toast so command failures stay visible.
            }

            context.notifyWarning(t('header.restartBackendFailed'));
          })();
        },
      });
    }

    if (context.isDevBuild || context.userMenuDebugEntryEnabled) {
      commands.push({
        kind: 'action',
        id: 'reload-webview',
        commandActionId: 'developer.reloadWebView',
        title: reloadWebViewLabel.primary,
        subtitle: reloadWebViewLabel.secondary,
        icon: <RefreshCcw className="h-4 w-4" />,
        searchTerms: buildSearchTerms(
          ['developer.reload-webview', 'reload webview', 'reload renderer'],
          scopeSearchTerms,
          [reloadWebViewLabel.english],
        ),
        run: () => {
          const electronBridge = window.electron;
          if (!electronBridge?.reloadWebView) {
            window.location.reload();
            return;
          }

          void (async () => {
            try {
              const reloaded = await electronBridge.reloadWebView();
              if (!reloaded) {
                context.notifyWarning(t('commandPalette.feedback.reloadWebViewFailed'));
              }
            } catch {
              context.notifyWarning(t('commandPalette.feedback.reloadWebViewFailed'));
            }
          })();
        },
      });
    }

    if (context.isDevBuild || context.devToolsEnabled) {
      commands.push({
        kind: 'action',
        id: 'toggle-devtools',
        commandActionId: 'developer.toggleDevTools',
        title: toggleDevToolsLabel.primary,
        subtitle: toggleDevToolsLabel.secondary,
        icon: <Bug className="h-4 w-4" />,
        searchTerms: buildSearchTerms(
          ['developer.toggle-devtools', 'toggle devtools', 'open devtools'],
          scopeSearchTerms,
          [toggleDevToolsLabel.english],
        ),
        run: () => {
          const electronBridge = window.electron;
          if (!electronBridge) {
            return;
          }

          if (electronBridge.toggleDevTools) {
            void electronBridge.toggleDevTools();
            return;
          }

          void electronBridge.openDevTools?.();
        },
      });
    }

    if (context.isDevBuild || context.userMenuDebugEntryEnabled) {
      commands.push(
        {
          kind: 'action',
          id: 'toggle-system-monitor-overlay',
          commandActionId: 'developer.toggleSystemMonitorOverlay',
          title: toggleSystemMonitorOverlayLabel.primary,
          subtitle: toggleSystemMonitorOverlayLabel.secondary,
          icon: <Bug className="h-4 w-4" />,
          searchTerms: buildSearchTerms(
            ['developer.toggle-system-monitor-overlay', 'toggle system monitor overlay', 'debug overlay'],
            scopeSearchTerms,
            [toggleSystemMonitorOverlayLabel.english],
          ),
          run: () => {
            const nextVisible = !context.showSystemMonitorOverlay;
            context.onShowSystemMonitorOverlayChange(nextVisible);
            context.notifySuccess(
              t(
                nextVisible
                  ? 'commandPalette.feedback.systemMonitorOverlayEnabled'
                  : 'commandPalette.feedback.systemMonitorOverlayDisabled',
              ),
            );
          },
        },
        {
          kind: 'action',
          id: 'toggle-main-heap-snapshot-export',
          commandActionId: 'developer.toggleMainHeapSnapshotExport',
          title: toggleMainHeapSnapshotExportLabel.primary,
          subtitle: toggleMainHeapSnapshotExportLabel.secondary,
          icon: <Bug className="h-4 w-4" />,
          searchTerms: buildSearchTerms(
            ['developer.toggle-main-heap-snapshot-export', 'toggle heap snapshot', 'main heap snapshot export'],
            scopeSearchTerms,
            [toggleMainHeapSnapshotExportLabel.english],
          ),
          run: () => {
            const nextEnabled = !context.enableMainHeapSnapshotExport;
            context.onEnableMainHeapSnapshotExportChange(nextEnabled);
            context.notifySuccess(
              t(
                nextEnabled
                  ? 'commandPalette.feedback.mainHeapSnapshotExportEnabled'
                  : 'commandPalette.feedback.mainHeapSnapshotExportDisabled',
              ),
            );
          },
        },
        {
          kind: 'action',
          id: 'capture-main-heap-snapshot',
          commandActionId: 'developer.captureMainHeapSnapshot',
          title: captureMainHeapSnapshotLabel.primary,
          subtitle: captureMainHeapSnapshotLabel.secondary,
          icon: <Bug className="h-4 w-4" />,
          searchTerms: buildSearchTerms(
            ['developer.capture-main-heap-snapshot', 'capture main heap snapshot', 'export main heap snapshot'],
            scopeSearchTerms,
            [captureMainHeapSnapshotLabel.english],
          ),
          run: () => {
            if (!context.enableMainHeapSnapshotExport) {
              context.notifyWarning(t('commandPalette.feedback.mainHeapSnapshotDisabled'));
              return;
            }

            const electronBridge = window.electron;
            if (!electronBridge?.exportMainHeapSnapshot) {
              context.notifyWarning(t('commandPalette.feedback.mainHeapSnapshotUnavailable'));
              return;
            }

            void (async () => {
              try {
                const result = await electronBridge.exportMainHeapSnapshot();
                if (result.ok) {
                  if (result.filePath) {
                    context.notifySuccess(
                      t('commandPalette.feedback.mainHeapSnapshotExported', {
                        filePath: result.filePath,
                      }),
                    );
                    return;
                  }

                  context.notifySuccess(t('commandPalette.feedback.mainHeapSnapshotExportCompleted'));
                  return;
                }

                if (result.message) {
                  context.notifyWarning(result.message);
                  return;
                }

                context.notifyWarning(t('commandPalette.feedback.mainHeapSnapshotExportFailed'));
              } catch (error) {
                context.notifyWarning(
                  error instanceof Error ? error.message : t('commandPalette.feedback.mainHeapSnapshotExportFailed'),
                );
              }
            })();
          },
        },
      );
    }

    return commands;
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
  showSystemMonitorOverlay,
  onShowSystemMonitorOverlayChange,
  enableMainHeapSnapshotExport,
  onEnableMainHeapSnapshotExportChange,
}) => {
  const { success: notifySuccess, warning: notifyWarning } = useToast();
  const devToolsEnabled = useSettingsValue('devToolsEnabled');
  const userMenuDebugEntryEnabled = useSettingsValue('userMenuDebugEntryEnabled');
  const isDevBuild = import.meta.env.DEV;
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
      showSystemMonitorOverlay,
      onShowSystemMonitorOverlayChange,
      enableMainHeapSnapshotExport,
      onEnableMainHeapSnapshotExportChange,
      isDevBuild,
      devToolsEnabled,
      userMenuDebugEntryEnabled,
      notifySuccess,
      notifyWarning,
    }),
    [
      activeTabId,
      addTab,
      closeRightTabs,
      closeTab,
      devToolsEnabled,
      enableMainHeapSnapshotExport,
      isDevBuild,
      locale,
      notifySuccess,
      notifyWarning,
      onEnableMainHeapSnapshotExportChange,
      onShowSystemMonitorOverlayChange,
      setActiveTabId,
      showSystemMonitorOverlay,
      tabs,
      userMenuDebugEntryEnabled,
    ],
  );

  const commandPaletteProviders = React.useMemo<ReadonlyArray<CommandPaletteProvider<AppCommandPaletteContext>>>(
    () => [
      createTabsCommandPaletteProvider(),
      createSettingsCommandPaletteProvider(),
      createDeveloperCommandPaletteProvider(),
    ],
    [],
  );

  const commandPaletteCommands = React.useMemo(() => {
    return collectCommandPaletteCommands(commandPaletteProviders, commandPaletteContext);
  }, [commandPaletteContext, commandPaletteProviders]);

  const filteredCommandPaletteCommands = React.useMemo(() => {
    return filterCommandPaletteCommands(commandPaletteCommands, query);
  }, [commandPaletteCommands, query]);

  const commandPaletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    return filteredCommandPaletteCommands.map((command) => {
      const scopeLabel = resolveCommandPaletteScopeLabel(command.domainId, locale);

      return {
        key: command.key,
        title: scopeLabel ? formatScopedCommandTitle(scopeLabel.primary, command.title) : command.title,
        subtitle:
          scopeLabel && command.subtitle
            ? formatScopedCommandTitle(scopeLabel.english, command.subtitle)
            : command.subtitle,
        icon: command.icon,
        onSelect: () => {
          executeCommandPaletteCommand(command);
          closeCommandPalette();
        },
      };
    });
  }, [closeCommandPalette, filteredCommandPaletteCommands, locale]);

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
