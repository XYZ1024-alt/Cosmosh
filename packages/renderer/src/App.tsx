import classNames from 'classnames';
import { X } from 'lucide-react';
import React from 'react';

import AppCommandPaletteHost from './components/AppCommandPaletteHost';
import SystemPerformanceOverlay from './components/debug/SystemPerformanceOverlay';
import Header from './components/header/Header';
import { CommandPalette, type CommandPaletteItem } from './components/ui/command-palette';
import { InputContextMenuProvider } from './components/ui/input-context-menu';
import { listLocalTerminalProfiles } from './lib/backend';
import {
  readEnableHeapSnapshotPreference,
  readShowSystemMonitorOverlayPreference,
  writeEnableHeapSnapshotPreference,
  writeShowSystemMonitorOverlayPreference,
} from './lib/debug-tools';
import { getEntityColorClassName } from './lib/entity-visuals';
import { requestOpenLocalTerminalList } from './lib/home-target';
import { t } from './lib/i18n';
import { useSettingsValue } from './lib/settings-store';
import { createSshConnectionIntent, toLocalTerminalTargetId } from './lib/ssh-connection-intent';
import { renderTabIconByKey } from './lib/tab-icon';
import { AppToastProvider } from './lib/toast';
import { resolvePageDefaults, useTabs } from './lib/useTabs';
import Home from './pages/Home';
import type { TabItem } from './types/tabs';

const ComponentsField = React.lazy(() => import('./pages/ComponentsField'));
const AuditLogs = React.lazy(() => import('./pages/AuditLogs'));
const Debug = React.lazy(() => import('./pages/Debug'));
const Settings = React.lazy(() => import('./pages/Settings'));
const SettingsEditor = React.lazy(() => import('./pages/SettingsEditor'));
const SSH = React.lazy(() => import('./pages/SSH'));
const SSHEditor = React.lazy(() => import('./pages/SSHEditor'));
const SSHKeychains = React.lazy(() => import('./pages/SSHKeychains'));
const SFTP = React.lazy(() => import('./pages/SFTP'));

let hasCheckedInitialPendingLaunchWorkingDirectory = false;

const pageLoadingFallback = (
  <div
    className="h-full w-full"
    aria-hidden="true"
  />
);

type TabSwitcherOverlayProps = {
  tabs: TabItem[];
  activeTabId: string;
  applySshServerVisualStyle: boolean;
  onCloseTab: (tabId: string) => void;
  onCommitTab: (tabId: string) => void;
  openSignal: number;
};

const TabSwitcherOverlay: React.FC<TabSwitcherOverlayProps> = ({
  tabs,
  activeTabId,
  applySshServerVisualStyle,
  onCloseTab,
  onCommitTab,
  openSignal,
}) => {
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const [targetTabId, setTargetTabId] = React.useState<string>('');
  const modifierKeyName = 'Control';

  const closeSwitcher = React.useCallback(() => {
    setIsOpen(false);
    setTargetTabId('');
  }, []);

  const moveTarget = React.useCallback(
    (direction: -1 | 1) => {
      if (tabs.length === 0) {
        return;
      }

      const baseTabId = targetTabId || activeTabId;
      const baseIndex = tabs.findIndex((tab) => tab.id === baseTabId);
      const normalizedBaseIndex = baseIndex < 0 ? (direction > 0 ? 0 : tabs.length - 1) : baseIndex;
      const nextIndex = (normalizedBaseIndex + direction + tabs.length) % tabs.length;
      const nextTabId = tabs[nextIndex]?.id;
      if (nextTabId) {
        setTargetTabId(nextTabId);
      }
    },
    [activeTabId, tabs, targetTabId],
  );

  const commitTarget = React.useCallback(() => {
    if (targetTabId) {
      onCommitTab(targetTabId);
    }
  }, [onCommitTab, targetTabId]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!tabs.some((tab) => tab.id === targetTabId)) {
      setTargetTabId(activeTabId);
    }
  }, [activeTabId, isOpen, tabs, targetTabId]);

  React.useEffect(() => {
    if (openSignal <= 0 || tabs.length === 0) {
      return;
    }

    setIsOpen(true);
    setTargetTabId(activeTabId);
  }, [activeTabId, openSignal, tabs.length]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const hasModifier = event.ctrlKey;
      if (!hasModifier || event.key !== 'Tab') {
        return;
      }

      if (tabs.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!isOpen) {
        setIsOpen(true);
      }

      moveTarget(event.shiftKey ? -1 : 1);
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!isOpen || event.key !== modifierKeyName) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      commitTarget();
      closeSwitcher();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [closeSwitcher, commitTarget, isOpen, modifierKeyName, moveTarget, tabs.length]);

  const items = React.useMemo<CommandPaletteItem[]>(() => {
    return tabs.map((tab) => {
      const shouldApplySshTabVisual = applySshServerVisualStyle && tab.page === 'ssh' && Boolean(tab.iconColorKey);

      return {
        key: tab.id,
        title: tab.title,
        subtitle: (() => {
          const pageLabel = resolvePageDefaults(tab.page).title;
          return pageLabel === tab.title ? undefined : pageLabel;
        })(),
        icon: renderTabIconByKey(tab.iconKey, tab.iconColorKey, !shouldApplySshTabVisual),
        rowClassName: shouldApplySshTabVisual ? getEntityColorClassName(tab.iconColorKey!) : undefined,
        actions: tab.closable
          ? [
              {
                key: `${tab.id}-close`,
                icon: <X className="h-3.5 w-3.5" />,
                tooltip: t('tabs.closeCurrent'),
                onSelect: () => {
                  onCloseTab(tab.id);
                },
              },
            ]
          : undefined,
        onSelect: () => {
          onCommitTab(tab.id);
          closeSwitcher();
        },
      };
    });
  }, [applySshServerVisualStyle, closeSwitcher, onCloseTab, onCommitTab, tabs]);

  const activeIndex = React.useMemo(() => {
    if (items.length === 0) {
      return 0;
    }

    const targetIndex = items.findIndex((item) => item.key === targetTabId);
    if (targetIndex >= 0) {
      return targetIndex;
    }

    const currentActiveIndex = items.findIndex((item) => item.key === activeTabId);
    return currentActiveIndex >= 0 ? currentActiveIndex : 0;
  }, [activeTabId, items, targetTabId]);

  return (
    <CommandPalette
      closeOnEsc
      showInput={false}
      open={isOpen}
      query=""
      placeholder={t('tabs.switcherPlaceholder')}
      emptyText={t('tabs.switcherEmpty')}
      items={items}
      metadataLayout="inline"
      activeIndex={activeIndex}
      onActiveIndexChange={(index) => {
        const targetItem = items[index];
        if (targetItem) {
          setTargetTabId(targetItem.key);
        }
      }}
      onOpenChange={(open) => {
        if (!open) {
          closeSwitcher();
        }
      }}
      onQueryChange={() => {}}
    />
  );
};

const App: React.FC = () => {
  const terminalContextLaunchBehavior = useSettingsValue('terminalContextLaunchBehavior');
  const defaultLocalTerminalProfile = useSettingsValue('defaultLocalTerminalProfile');
  const applySshServerVisualStyle = useSettingsValue('sshTabApplyServerVisualStyle');
  const [showSystemMonitorOverlay, setShowSystemMonitorOverlay] = React.useState<boolean>(() => {
    return readShowSystemMonitorOverlayPreference();
  });
  const [enableMainHeapSnapshotExport, setEnableMainHeapSnapshotExport] = React.useState<boolean>(() => {
    return readEnableHeapSnapshotPreference();
  });
  const [tabSwitcherOpenSignal, setTabSwitcherOpenSignal] = React.useState<number>(0);

  const handleShowSystemMonitorOverlayChange = React.useCallback((nextVisible: boolean): void => {
    setShowSystemMonitorOverlay(nextVisible);
    writeShowSystemMonitorOverlayPreference(nextVisible);
  }, []);

  const handleEnableMainHeapSnapshotExportChange = React.useCallback((nextEnabled: boolean): void => {
    setEnableMainHeapSnapshotExport(nextEnabled);
    writeEnableHeapSnapshotPreference(nextEnabled);
  }, []);

  const handleLastTabClose = React.useCallback(() => {
    window.electron?.closeWindow();
  }, []);

  const {
    tabs,
    activeTabId,
    addTab,
    updateTab,
    openPageInTab,
    closeTab,
    closeRightTabs,
    closeOtherTabs,
    reorderTabs,
    setActiveTabId,
  } = useTabs({
    onLastTabClose: handleLastTabClose,
  });
  const tabsById = React.useMemo(() => {
    return new Map(tabs.map((tab) => [tab.id, tab] as const));
  }, [tabs]);
  const [contentTabOrder, setContentTabOrder] = React.useState<string[]>(() => tabs.map((tab) => tab.id));

  React.useEffect(() => {
    setContentTabOrder((previousOrder) => {
      const liveTabIds = new Set(tabs.map((tab) => tab.id));
      const nextOrder = previousOrder.filter((tabId) => liveTabIds.has(tabId));
      const nextOrderSet = new Set(nextOrder);

      for (const tab of tabs) {
        if (nextOrderSet.has(tab.id)) {
          continue;
        }

        nextOrder.push(tab.id);
        nextOrderSet.add(tab.id);
      }

      const isSameOrder =
        nextOrder.length === previousOrder.length && nextOrder.every((tabId, index) => tabId === previousOrder[index]);
      return isSameOrder ? previousOrder : nextOrder;
    });
  }, [tabs]);

  const handleOpenLocalTerminalList = React.useCallback(() => {
    requestOpenLocalTerminalList();
    addTab('home');
  }, [addTab]);

  const handleOpenDefaultLocalTerminal = React.useCallback(async () => {
    try {
      const response = await listLocalTerminalProfiles();
      const availableProfiles = response.data.items;
      const normalizedPreferredProfileId = defaultLocalTerminalProfile.trim();
      const targetProfile =
        normalizedPreferredProfileId.length === 0 || normalizedPreferredProfileId === 'auto'
          ? availableProfiles[0]
          : (availableProfiles.find((profile) => profile.id === normalizedPreferredProfileId) ?? availableProfiles[0]);

      if (!targetProfile) {
        handleOpenLocalTerminalList();
        return;
      }

      const targetId = toLocalTerminalTargetId(targetProfile.id);
      const tabId = addTab('ssh');
      updateTab(tabId, {
        title: targetProfile.name,
        iconKey: 'terminal',
        iconColorKey: undefined,
        state: {
          sshConnectionIntent: createSshConnectionIntent(targetId),
        },
      });
    } catch {
      handleOpenLocalTerminalList();
    }
  }, [addTab, defaultLocalTerminalProfile, handleOpenLocalTerminalList, updateTab]);

  const handleLaunchWorkingDirectory = React.useCallback(async () => {
    if (terminalContextLaunchBehavior === 'off') {
      return;
    }

    if (terminalContextLaunchBehavior === 'openLocalTerminalList') {
      handleOpenLocalTerminalList();
      return;
    }

    await handleOpenDefaultLocalTerminal();
  }, [handleOpenDefaultLocalTerminal, handleOpenLocalTerminalList, terminalContextLaunchBehavior]);

  const launchWorkingDirectoryHandlerRef = React.useRef<() => Promise<void>>(async () => undefined);

  React.useEffect(() => {
    launchWorkingDirectoryHandlerRef.current = handleLaunchWorkingDirectory;
  }, [handleLaunchWorkingDirectory]);

  React.useEffect(() => {
    const electronBridge = window.electron;
    if (!electronBridge) {
      return;
    }

    const unsubscribe = electronBridge.onLaunchWorkingDirectory(() => {
      void launchWorkingDirectoryHandlerRef.current();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    const electronBridge = window.electron;
    if (!electronBridge || hasCheckedInitialPendingLaunchWorkingDirectory) {
      return;
    }

    hasCheckedInitialPendingLaunchWorkingDirectory = true;

    void electronBridge.getPendingLaunchWorkingDirectory().then((cwd) => {
      if (!cwd) {
        return;
      }

      void launchWorkingDirectoryHandlerRef.current();
    });
  }, []);

  React.useEffect(() => {
    const electronBridge = window.electron;
    if (!electronBridge) {
      return;
    }

    const unsubscribe = electronBridge.onAppMenuAction((action) => {
      switch (action) {
        case 'open-about': {
          addTab('settings', {
            state: {
              settingsCategory: 'about',
            },
          });
          break;
        }
        case 'open-settings': {
          addTab('settings');
          break;
        }
        case 'new-tab': {
          addTab('home');
          break;
        }
        case 'close-current-tab': {
          closeTab(activeTabId);
          break;
        }
        case 'close-right-tabs': {
          closeRightTabs(activeTabId);
          break;
        }
        case 'show-tab-switcher': {
          setTabSwitcherOpenSignal((previous) => previous + 1);
          break;
        }
        default: {
          break;
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeTabId, addTab, closeRightTabs, closeTab]);

  const tabContent = React.useMemo(() => {
    return (
      <div className="flex min-h-0 w-full flex-1 p-2 pt-0">
        {contentTabOrder.map((tabId) => {
          const tab = tabsById.get(tabId);
          if (!tab) {
            return null;
          }

          return (
            <section
              key={tab.id}
              className={classNames('h-full min-h-0 w-full overflow-auto', tab.id === activeTabId ? 'block' : 'hidden')}
            >
              {tab.page === 'home' && (
                <Home
                  isActive={tab.id === activeTabId}
                  onOpenSSH={(serverId, tabTitle, options) => {
                    if (options?.openInNewTab) {
                      const newTabId = addTab('ssh');
                      updateTab(newTabId, {
                        ...(tabTitle ? { title: tabTitle } : {}),
                        state: {
                          sshConnectionIntent: createSshConnectionIntent(serverId),
                        },
                      });
                      return;
                    }

                    openPageInTab(tab.id, 'ssh');
                    updateTab(tab.id, {
                      ...(tabTitle ? { title: tabTitle } : {}),
                      state: {
                        ...(tab.state ?? {}),
                        sshConnectionIntent: createSshConnectionIntent(serverId),
                      },
                    });
                  }}
                  onOpenSFTP={(serverId, tabTitle, options) => {
                    const resolvedTitle = tabTitle?.trim() || t('tabs.page.sftp');
                    const nextIntent = {
                      serverId,
                      serverName: resolvedTitle,
                      createdAt: Date.now(),
                    };

                    if (!options?.openInNewTab) {
                      const existingSftpTab = tabs.find((item) => {
                        return item.page === 'sftp' && item.state?.sftpConnectionIntent?.serverId === serverId;
                      });

                      if (existingSftpTab) {
                        setActiveTabId(existingSftpTab.id);
                        return;
                      }
                    }

                    if (options?.openInNewTab) {
                      addTab('sftp', {
                        title: resolvedTitle,
                        iconKey: 'sftp',
                        state: {
                          sftpConnectionIntent: nextIntent,
                        },
                      });
                      return;
                    }

                    openPageInTab(tab.id, 'sftp');
                    updateTab(tab.id, {
                      title: resolvedTitle,
                      iconKey: 'sftp',
                      iconColorKey: undefined,
                      state: {
                        ...(tab.state ?? {}),
                        sftpConnectionIntent: nextIntent,
                      },
                    });
                  }}
                />
              )}
              {tab.page === 'ssh' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <SSH
                    tabId={tab.id}
                    isActive={tab.id === activeTabId}
                    connectionIntent={
                      tab.state?.sshConnectionIntent ?? {
                        intentId: `tab:${tab.id}:ssh`,
                        createdAt: 0,
                        target: null,
                        lastResolvedSnapshot: null,
                      }
                    }
                    onConnectionIntentChange={(nextIntent) => {
                      updateTab(tab.id, {
                        state: {
                          ...(tab.state ?? {}),
                          sshConnectionIntent: nextIntent,
                        },
                      });
                    }}
                    onTabTitleChange={(title) => {
                      updateTab(tab.id, { title });
                    }}
                    onTabVisualChange={(visual) => {
                      updateTab(tab.id, {
                        iconKey: visual.iconKey,
                        iconColorKey: visual.iconColorKey,
                      });
                    }}
                  />
                </React.Suspense>
              )}
              {tab.page === 'sftp' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <SFTP
                    connectionIntent={tab.state?.sftpConnectionIntent}
                    onOpenDirectoryInNewTab={(initialPath) => {
                      const intent = tab.state?.sftpConnectionIntent;
                      if (!intent) {
                        return;
                      }

                      addTab('sftp', {
                        title: intent.serverName,
                        iconKey: 'sftp',
                        state: {
                          sftpConnectionIntent: {
                            ...intent,
                            initialPath,
                            createdAt: Date.now(),
                          },
                        },
                      });
                    }}
                    onTabTitleChange={(title) => {
                      updateTab(tab.id, { title });
                    }}
                  />
                </React.Suspense>
              )}
              {tab.page === 'ssh-editor' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <SSHEditor
                    preferredServerId={tab.state?.sshEditor?.preferredServerId}
                    preferCreateMode={Boolean(tab.state?.sshEditor?.createMode)}
                  />
                </React.Suspense>
              )}
              {tab.page === 'ssh-keychains' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <SSHKeychains />
                </React.Suspense>
              )}
              {tab.page === 'settings' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <Settings
                    initialCategoryId={tab.state?.settingsCategory}
                    initialSearchQuery={tab.state?.settingsInitialSearch}
                    onOpenSettingInEditor={(settingKey) =>
                      addTab('settings-editor', {
                        state: {
                          settingsEditorSettingKey: settingKey,
                        },
                      })
                    }
                  />
                </React.Suspense>
              )}
              {tab.page === 'audit-logs' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <AuditLogs />
                </React.Suspense>
              )}
              {tab.page === 'settings-editor' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <SettingsEditor initialSettingKey={tab.state?.settingsEditorSettingKey} />
                </React.Suspense>
              )}
              {tab.page === 'components-field' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <ComponentsField />
                </React.Suspense>
              )}
              {tab.page === 'debug' && (
                <React.Suspense fallback={pageLoadingFallback}>
                  <Debug
                    activeTabTitle={tab.title}
                    activeTabIcon={tab.iconKey}
                    showSystemMonitorOverlay={showSystemMonitorOverlay}
                    onShowSystemMonitorOverlayChange={handleShowSystemMonitorOverlayChange}
                    onOpenSSH={(openInNewTab) => (openInNewTab ? addTab('ssh') : openPageInTab(tab.id, 'ssh'))}
                    onOpenSettings={(openInNewTab) =>
                      openInNewTab ? addTab('settings') : openPageInTab(tab.id, 'settings')
                    }
                    onOpenSettingsEditor={(openInNewTab) =>
                      openInNewTab ? addTab('settings-editor') : openPageInTab(tab.id, 'settings-editor')
                    }
                    onOpenComponentsField={(openInNewTab) =>
                      openInNewTab ? addTab('components-field') : openPageInTab(tab.id, 'components-field')
                    }
                    onOpenSshEditor={(openInNewTab) =>
                      openInNewTab ? addTab('ssh-editor') : openPageInTab(tab.id, 'ssh-editor')
                    }
                    onOpenSshKeychains={(openInNewTab) =>
                      openInNewTab ? addTab('ssh-keychains') : openPageInTab(tab.id, 'ssh-keychains')
                    }
                    onRenameTab={(title) => updateTab(tab.id, { title })}
                    onChangeIcon={(iconKey) => updateTab(tab.id, { iconKey })}
                  />
                </React.Suspense>
              )}
            </section>
          );
        })}
      </div>
    );
  }, [
    activeTabId,
    addTab,
    contentTabOrder,
    handleShowSystemMonitorOverlayChange,
    openPageInTab,
    setActiveTabId,
    showSystemMonitorOverlay,
    tabs,
    tabsById,
    updateTab,
  ]);

  return (
    <AppToastProvider>
      <InputContextMenuProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
          {/* Header */}
          <div
            className="flex-shrink-0"
            // @ts-expect-error React.CSSProperties
            style={{ WebkitAppRegion: 'drag' }}
          >
            <Header
              className="flex-shrink-0"
              tabs={tabs}
              activeTab={activeTabId}
              onActiveTabChange={setActiveTabId}
              onAddTab={() => addTab('home')}
              onCloseTab={closeTab}
              onCloseRightTabs={closeRightTabs}
              onCloseOtherTabs={closeOtherTabs}
              onReorderTabs={reorderTabs}
              onOpenSSHEditorTab={() => addTab('ssh-editor')}
              onOpenSSHKeychainsTab={() => addTab('ssh-keychains')}
              onOpenAuditLogsTab={() => addTab('audit-logs')}
              onOpenSettingsTab={(options) =>
                addTab('settings', {
                  state: {
                    settingsCategory: options?.categoryId,
                  },
                })
              }
              onOpenSettingsEditorTab={() => addTab('settings-editor')}
              onOpenDebugTab={() => addTab('debug')}
            />
          </div>
          {/* Content */}
          {tabContent}

          <AppCommandPaletteHost
            activeTabId={activeTabId}
            tabs={tabs}
            addTab={addTab}
            closeTab={closeTab}
            closeRightTabs={closeRightTabs}
            setActiveTabId={setActiveTabId}
            showSystemMonitorOverlay={showSystemMonitorOverlay}
            enableMainHeapSnapshotExport={enableMainHeapSnapshotExport}
            onShowSystemMonitorOverlayChange={handleShowSystemMonitorOverlayChange}
            onEnableMainHeapSnapshotExportChange={handleEnableMainHeapSnapshotExportChange}
          />

          <TabSwitcherOverlay
            tabs={tabs}
            activeTabId={activeTabId}
            applySshServerVisualStyle={applySshServerVisualStyle}
            openSignal={tabSwitcherOpenSignal}
            onCloseTab={closeTab}
            onCommitTab={setActiveTabId}
          />

          <SystemPerformanceOverlay visible={showSystemMonitorOverlay} />
        </div>
      </InputContextMenuProvider>
    </AppToastProvider>
  );
};

export default App;
