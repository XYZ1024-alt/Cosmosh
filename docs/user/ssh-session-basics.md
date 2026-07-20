# SSH Session Basics

## Start a Session

1. Select the target server profile.
2. Start SSH session.
3. Wait for terminal prompt readiness.
4. Run a harmless verification command.

## During a Session

1. Keep one task context per active session.
2. Resize terminal when layout changes to avoid broken command views.
3. Prefer explicit command sequencing over long interactive drift.
4. Record important command outputs before switching sessions.

## Orbit Bar

- Select terminal text to show Orbit Bar near the current selection.
- Use Orbit Bar actions for quick copy, open link, and in-terminal find workflows.
- When the selection looks like a link (any URL scheme, including custom schemes), Orbit Bar shows Open Link instead of Search Online; Search Online follows the Settings search engine configuration.
- If Orbit Bar is not needed, disable it from Settings > Terminal.

## Quick Pick, Commands, and Tab Switching

- Press Ctrl+Tab (Control+Tab on macOS) to open the shared quick-pick overlay in tab-list mode.
- Keep holding Ctrl/Control and press Tab repeatedly to move forward through tabs.
- Hold Shift while pressing Tab to move backward.
- While the quick-pick overlay is open, use ArrowUp/ArrowDown to preview targets.
- Release Ctrl/Control to confirm and jump to the selected tab.
- Mouse click on a tab in the quick-pick overlay jumps immediately, even if Ctrl/Control is still held.
- Type ordinary text to filter open tabs.
- Type `>` to switch the same overlay to command mode.
- The tab-strip plus button and Header user menu entries always open new tabs at the end of the tab strip.
- Right-click a tab and choose New Tab to the Right to create a tab immediately beside that tab.
- New tabs opened from inside the active tab, such as SFTP or Settings editor follow-ups, open immediately to the right of their source tab.

## Command Palette

- Press Ctrl+Shift+P on Windows/Linux, or Cmd+Shift+P on macOS, to open the shared quick-pick overlay globally with `>` already entered.
- The shortcut works even when terminal focus or input focus is active.
- Delete the leading `>` to switch from commands back to the tab list.
- Use it to create tabs, switch tabs, close current tab, close right tabs, jump into Settings search, and open saved resources.
- Resource commands include `SSH: <server name> (<host>)`, `SFTP: <server name> (<host>)`, `Server: <server name> (<host>)`, `Keychain: <keychain name>`, and `Forward: <forward name>`.
- Server host text follows the Show Full Server Address setting, so masked addresses stay masked in command titles.
- Settings commands can be searched by localized label, English label, setting key, path, search terms, and command action id.

## Trust and Verification

- Review host fingerprint prompts carefully.
- Trust only verified hosts.

## End Session Safely

1. Complete or cancel running commands cleanly.
2. Exit remote shell.
3. Confirm session is fully closed in UI.
4. If reconnect is required, start a new clean session instead of reusing stale context.

## Common Mistakes

1. Connecting to the wrong environment due to similar host names.
2. Skipping fingerprint verification under time pressure.
3. Leaving sessions open unintentionally after task completion.
