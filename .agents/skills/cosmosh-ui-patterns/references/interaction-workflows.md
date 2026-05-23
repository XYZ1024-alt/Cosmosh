# Cosmosh Interaction Workflows

## Home And Server Workflows

Home is a launch and organization surface for SSH/SFTP/local-terminal targets:

- Keep the sidebar for folders, quick filters, and high-level grouping.
- Keep the main panel for search, sort, grouping, tag filters, and server/local terminal cards.
- Use `EntityCard`, `EntityIcon`, `EntityVisualPicker`, and entity visual helpers instead of custom card visuals.
- Keep card actions discoverable through context menus and focused hover actions.
- Preserve drag/drop semantics for moving servers between folders.
- Use API contract types from `@cosmosh/api-contract`; do not duplicate payload schemas in the renderer.

## Tabs And Runtime Continuity

Tabs are visual containers for long-lived pages:

- Reorder tabs by id and preserve the current tab objects from state.
- Do not recreate SSH/xterm runtime when only tab order changes.
- Keep close-current, close-right, and close-others in the tab context menu.
- Preserve keyboard shortcuts while ignoring editable targets.
- Keep tab widths clamped and scroll behavior stable for many tabs.

## SSH Terminal Interactions

SSH/xterm surfaces are latency-sensitive and text-first:

- Keep terminal rendering readable and avoid overlays that cover selected text unless they are intentionally positioned.
- Use `TerminalContextMenu` for copy, paste, find, select all, clear, split, and close pane actions.
- Gate input actions on connection state and selection actions on active selection.
- Avoid redundant backend sessions for split panes when mirroring or sharing the live stream is feasible.
- Keep split progression predictable: 1 -> 2 -> 3 -> 4 panes.
- Use `border-ssh-terminal-split-divider` for SSH pane separators.

## Orbit Bar

Terminal selection actions use `TerminalSelectionBar`:

- Show it only while terminal selection exists.
- Prefer placement above the selection; move below if above would overlap selection or leave the viewport.
- Keep position synchronized with selection, viewport, pane, and layout changes.
- Use Menubar-like tokenized surface styling and `shadow-selection-bar`.
- Provide tooltip labels for every icon action.
- Localize labels through renderer i18n resources.
- For unfinished actions, provide explicit feedback rather than a silent no-op.

## Settings Workflows

Settings is registry-driven:

- Add settings to `packages/renderer/src/pages/settings-registry.ts` and render through existing page control logic where possible.
- Validate settings with generated or shared contract helpers before saving.
- Use the established category/section model, search indexing, helper text, reset-to-default actions, and editor handoff.
- Hide dependent controls only when their parent feature is inactive and that hiding matches the existing product contract.
- Keep auto-save behavior valid-first; do not persist invalid draft values.

## Localization

- Use `t(...)` from renderer i18n helpers for visible text.
- Add or update matching English and Chinese resource entries when adding UI copy.
- Keep command labels, tooltip labels, disabled hints, empty states, and error messages localized.
- In Chinese Markdown docs, do not add spaces around link syntax.

## Documentation Sync

Update docs in the same task when UI behavior or standards change:

- UI tokens/interactions/visual standards: `docs/developer/design/ui-ux-standards.md` and `docs/zh-CN/developer/design/ui-ux-standards.md`.
- IPC changes: `docs/developer/core/ipc-protocol.md` and Chinese sync.
- Architecture/runtime behavior: `docs/developer/core/architecture.md` and Chinese sync.
- SSH terminal protocol: `docs/developer/runtime/ssh-terminal.md` and Chinese sync.
- SFTP capability: `docs/developer/runtime/sftp-file-system.md` and Chinese sync.

## Validation

For narrow UI changes:

1. Run the relevant lint/typecheck command, normally starting with `pnpm lint`.
2. Use focused tests when logic changed.
3. Start the local app/dev server when visual verification is needed.
4. Check desktop and narrow viewport screenshots for overlap, clipping, stale disabled states, and focus issues.
5. Verify runtime continuity for SSH tabs, pane split/close, selection tools, and reorder behavior when touched.
