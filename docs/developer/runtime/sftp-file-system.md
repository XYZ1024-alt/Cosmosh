# SFTP File System

## 1. Current Status

Cosmosh implements a tab-scoped SFTP file-system workbench.

Implemented in v1:

- Home server context menu and file action can open an SFTP tab.
- Each SFTP tab creates a backend SFTP session and owns that session lifecycle.
- Directory listing supports breadcrumb path navigation with editable text fallback, persistent text-address display mode, back/forward history, parent navigation, refresh, current-directory filtering, configurable metadata columns, header sorting, header drag-reorder, loading, empty, expired-session, and operation-failed states.
- The renderer shows directory entries, metadata details, editable text/code previews, image previews, and a standalone Properties window. Double-clicking a regular file downloads it into the Cosmosh-controlled SFTP temp directory and opens it with the OS default application.
- Opened regular files are watched from the Cosmosh-controlled SFTP temp directory. When a watched temp file changes, the renderer asks whether to upload the change back to the remote file. If the remote size or modified time no longer matches the version that was opened, the renderer asks for explicit overwrite confirmation before retrying.
- Preview mode follows a Windows Explorer-style auxiliary sidebar. Text/code previews use Monaco and can save UTF-8 changes back through SFTP; image previews materialize through the same controlled temp-file download path. Large text and image previews require explicit user confirmation before opening, with thresholds backed by settings.
- The left directory tree shows the current directory ancestry, caches loaded child directories as users browse, automatically scrolls the current directory row near the upper third of the tree viewport after directory navigation only when the mounted parent/current/expanded-child context is outside the visible viewport, and exposes directory-scoped right-click actions for open, new-tab open, refresh, paste, new file, and new folder.
- Center-list context menus and the top action bar expose open, open folder in a new tab, properties, open SSH here, copy path, copy relative path, save regular files locally, Open With where supported, cut, copy, paste, delete, new file, new folder, and inline rename. The directory list supports mouse and keyboard multi-selection with `Ctrl`/`Cmd` toggle, `Ctrl`/`Cmd+A` select-all, and `Shift` range selection.
- Renderer-managed file operations are queued per SFTP tab and surfaced in a compact toolbar task menu with queued, running, success, failed, and progress states.
- SFTP settings control reconnect mode, delete-confirmation scope, file-list column/sort view state, whether the center file list shows a leading `..` parent-directory row, whether the address bar always renders as text, the auxiliary sidebar mode, and the text/image preview warning thresholds.
- Backend write operations support empty-file creation, directory creation, rename/move, recursive copy, and recursive delete.

Intentionally not included in v1:

- directory download, chmod, drag/drop, global search, and backend-level transfer queues with cancellation/conflict handling.
- reuse of an active SSH terminal session. SFTP tabs establish their own SSH + SFTP connection.
- persisted SFTP history or additional database tables.

## 2. Runtime Architecture

```mermaid
flowchart LR
  UI[SFTP Workbench Page] --> BRIDGE[window.electron bridge]
  BRIDGE --> MAIN[Main IPC proxy]
  MAIN --> ROUTE[Backend SFTP HTTP routes]
  ROUTE --> SERVICE[SftpSessionService]
  SERVICE --> SSH2[ssh2 Client + sftp subsystem]
  SSH2 --> REMOTE[Remote file system]
```

### Ownership

- **API contract**: `packages/api-contract/openapi/cosmosh.openapi.yaml` defines SFTP paths, schemas, success codes, and error codes.
- **Backend**: `packages/backend/src/http/routes/sftp.ts` validates HTTP input and maps service results to API envelopes. `packages/backend/src/sftp/session-service.ts` owns SSH/SFTP connection setup, session registry, directory normalization, entry mapping, and cleanup.
- **Main/preload**: `packages/main/src/ipc/register-backend-ipc.ts` proxies SFTP requests to backend routes. `packages/main/src/ipc/register-app-utility-ipc.ts` owns native save/open helpers, validates Cosmosh SFTP temp paths, and launches platform Open With behavior. `packages/main/src/preload.ts` exposes the minimal renderer bridge.
- **Renderer**: `packages/renderer/src/pages/SFTP.tsx` owns tab-scoped UI state, file actions, inline rename/create state, and preview state.
- **Settings registry**: `packages/api-contract/src/settings-registry.ts` owns the SFTP reconnect, delete-confirmation, directory-list view, parent-directory-row, hidden-entry, address-display, auxiliary-sidebar, and preview-threshold preferences consumed by the renderer settings store.

## 3. API Contract

All callers must use generated exports from `@cosmosh/api-contract`, especially `API_PATHS` and generated request/response payload types.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/sftp/sessions` | Create an SFTP file-system session for one SSH server. |
| `GET` | `/api/v1/sftp/sessions/{sessionId}/entries?path=...` | List one remote directory for an active SFTP session. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/entries/details` | Fetch non-recursive metadata for selected remote entries, including `lstat` fields and symbolic-link target metadata. |
| `GET` | `/api/v1/sftp/sessions/{sessionId}/file?path=...&maxBytes=...` | Read a bounded UTF-8 preview for one remote file. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/file` | Save editable UTF-8 preview content back to one regular remote file after size/mtime conflict checks. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/download` | Stream one regular remote file to a local destination selected by main/preload. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/upload` | Stream one locally edited SFTP temp file back to the original remote file after conflict checks; `overwrite: true` is accepted only after renderer conflict confirmation. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/files` | Create one empty remote file. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/directories` | Create one remote directory. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/rename` | Rename or move one remote entry. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/copy` | Copy one remote file or directory tree. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/entries/delete` | Delete one remote file, symlink, or directory tree. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/batch` | Run one ordered batch copy, move, or delete operation across multiple remote entries. |
| `DELETE` | `/api/v1/sftp/sessions/{sessionId}` | Close one SFTP session and release the SSH connection. |

Success codes:

- `SFTP_SESSION_CREATE_OK`
- `SFTP_DIRECTORY_LIST_OK`
- `SFTP_ENTRY_DETAILS_OK`
- `SFTP_FILE_READ_OK`
- `SFTP_OPERATION_OK`

SFTP-specific error codes:

- `SFTP_SESSION_NOT_FOUND`
- `SFTP_VALIDATION_FAILED`
- `SFTP_OPERATION_FAILED`
- `SFTP_UPLOAD_CONFLICT`

Host fingerprint trust failures reuse the SSH host-trust envelope and code because SFTP uses the same SSH transport security model.

## 4. Session Lifecycle

```mermaid
sequenceDiagram
  participant Home as Home Page
  participant UI as SFTP Tab
  participant Main as Main IPC
  participant API as Backend Route
  participant SFTP as SftpSessionService

  Home->>UI: Open SFTP tab for serverId
  UI->>Main: backendSftpCreateSession(payload)
  Main->>API: POST /api/v1/sftp/sessions
  API->>SFTP: createSession(serverId)
  SFTP-->>API: sessionId + currentPath
  API-->>UI: session create success
  UI->>Main: backendSftpListDirectory(sessionId, path)
  Main->>API: GET /api/v1/sftp/sessions/{sessionId}/entries
  API->>SFTP: listDirectory(sessionId, path)
  SFTP-->>UI: normalized directory entries
  UI->>Main: backendSftpRenameEntry / backendSftpBatchOperation / ...
  Main->>API: POST /api/v1/sftp/sessions/{sessionId}/...
  API->>SFTP: Mutating operation on live session
  SFTP-->>UI: operation success or batch summary + background listing revalidation
  UI->>Main: backendSftpCloseSession(sessionId)
  Main->>API: DELETE /api/v1/sftp/sessions/{sessionId}
```

Lifecycle rules:

- A normal Home context-menu action reuses an existing SFTP tab for the same server when one is already open.
- SSH Orbit Bar and terminal context-menu handoffs always create a new SFTP tab with the selected directory path, even when another SFTP tab for the same server is already open.
- Explicit new-tab actions create a new SFTP tab and therefore a separate backend SFTP session.
- Hidden SFTP tabs remain mounted and keep their session alive.
- Closing the tab or changing its connection intent closes the previous SFTP session on a best-effort basis.
- `SftpSessionService` watches the underlying `ssh2` client and SFTP stream for `close`, `end`, and `error`. Once either transport becomes unusable, the session is evicted from the registry so later requests return `SFTP_SESSION_NOT_FOUND` quickly instead of hanging behind a dead socket.
- `sftpReconnectMode` defaults to `passive`. In passive mode, renderer SFTP requests that receive `SFTP_SESSION_NOT_FOUND` create one replacement session, update the tab `sessionId`, and retry the original request once.
- `active` is currently a user-selectable setting that uses the same reconnect pipeline when the page already knows the current session expired. It does not add backend push events or polling.
- `off` disables renderer retry. The backend still evicts closed sessions, so operations fail quickly with the session-not-found message instead of remaining pending.
- Backend shutdown closes all registered SFTP sessions.

## 5. Directory Listing And File Operations

The backend treats SFTP paths as POSIX paths regardless of the host OS running Cosmosh.

SSH-to-SFTP handoff accepts only explicit remote directory path selections: absolute paths, home-relative paths, dot-relative paths, and `file://` URLs. The renderer strips simple wrapping quotes and trailing punctuation before passing the path as structured `initialPath`; it does not execute shell commands or infer the terminal's current working directory for bare relative names.

Directory listing steps:

1. Normalize the requested path.
2. Resolve it with `realpath`.
3. Run `readdir` for the resolved directory.
4. Map each entry through the shared SFTP metadata mapper. The list response includes cheap, non-recursive fields: `name`, `path`, `parentPath`, `type`, `size`, `mode`, `permissions`, `permissionOctal`, `uid`, `gid`, `modifiedAt`, `accessedAt`, `extension`, `shellEscapedPath`, `isHidden`, and optional `longname`.
5. Store directory results in renderer memory and derive visible ordering with directories first, then the configured `sftpDirectoryListView.sort` field and direction. Name fallback uses numeric-aware locale comparison.

Entry types are reduced to:

- `directory`
- `file`
- `symlink`
- `other`

The backend sets `isHidden` when a server-provided SFTP extended attribute contains a recognizable hidden marker, or when the entry name starts with `.` and is not `.` or `..`. The renderer keeps full directory results in memory and applies the hidden-entry preference only to visible surfaces.

The center list uses configurable columns backed by `sftpDirectoryListView`, an internal JSON setting stored through the shared settings registry. Supported columns intentionally stay within fields already returned by the directory list response: `name`, `modifiedAt`, `type`, `size`, `accessedAt`, `permissions`, `permissionOctal`, `mode`, `uid`, `gid`, `extension`, `isHidden`, `path`, `parentPath`, `shellEscapedPath`, and `longname`. Showing these columns does not add per-entry `lstat`, `readlink`, `stat`, recursive size, or symlink-target calls. The Properties window remains the place for richer per-entry inspection because it uses the details endpoint and therefore can spend extra calls only for selected entries.

Column visibility, order, and sort are changed from the directory header context menu and the toolbar overflow menu. Header clicks sort by that column or toggle ascending/descending when the column is already active. Dragging visible headers updates the persisted column order. The list keeps directories grouped before non-directories for every supported sort field.

The directory panel supports filtering entries in the current directory only; it is not a remote recursive search. `sftpShowHiddenEntries` defaults to `true` and controls whether hidden files and folders appear in the center list, left tree, and breadcrumb directory menus. `sftpDimHiddenEntries` also defaults to `true`; when hidden entries are visible, it applies 80% opacity only to the entry icon and name, leaving row selection, metadata columns, hover state, and context menus unchanged. The top toolbar overflow menu contains a checkbox for `Show Hidden Files`; row, blank-area, and tree context menus do not expose this preference. The details panel shows metadata for a single selected entry and shows a selected-count summary for multiple entries. The row context-menu `Properties` item opens a standalone same-origin renderer popup that fetches selected entries through the existing details endpoint and renders Windows/macOS-style general, permissions, and symlink sections, including the entry hidden state. Multiple-entry properties show shared values, mixed markers, common parent directory, type counts, failed metadata count, hidden-state agreement, and total size. Raw metadata is no longer shown in the details sidebar; the Properties window can reveal the selected-entry details payload after an intentional seven-click gesture on its entry header. Electron popups use the current preload-backed SFTP session; browser popups show an explicit unsupported message until web SFTP runtime support exists. When `sftpShowParentDirectoryEntry` is enabled and the backend reports a parent path, the center list prepends a non-selectable `..` row that navigates to the parent directory without changing backend data.

The auxiliary sidebar is controlled by `sftpAuxiliarySidebarMode` and can be `details`, `preview`, or `off`. Details mode is the existing metadata sidebar. Preview mode renders one selected regular file when supported: text/code extensions open in Monaco with editing enabled, image extensions show an image preview, and unsupported entries show `No preview`. Multiple selection and empty selection do not issue preview reads or downloads.

Directory results are cached in the renderer for the lifetime of the SFTP tab. Revisiting an already loaded path uses that in-memory result immediately. The refresh action bypasses the cache and requests a fresh listing from the active backend session while preserving the visible list until the new result arrives.

Entry details use the same metadata mapper as the directory list and add only the fields that require entry-specific calls. The backend runs `lstat` for each selected path so symbolic links are described as links. For symlinks it also runs `readlink`, resolves relative targets against the link parent, and attempts `stat` on the target. Target status is reported as `exists`, `broken`, `permission-denied`, or `unknown`; target stats are included only when the target exists and is readable. Directory size is never calculated recursively by list or details requests.

Mutation rules:

- All mutating requests target the current live SFTP session and use POSIX-style paths.
- Empty files are created with exclusive write semantics so existing remote files are not overwritten.
- Directory copy is recursive. The backend chooses a `copy`, `copy 2`, ... suffix when the requested destination already exists.
- Copying a directory into itself or one of its descendants is rejected.
- Delete uses `lstat` so symlinks are removed as links instead of following their targets.
- Directory delete is recursive when requested by the renderer.
- Delete confirmation is a renderer-side safety gate controlled by `sftpDeleteConfirmationMode`: `always` asks before every delete, `batch` asks only when deleting more than one selected entry, `shortcut` asks only for keyboard-triggered deletes, and `off` calls the backend delete flow immediately.
- Renderer file operations enter a tab-local FIFO task queue before calling the backend. The queue keeps navigation, selection, filtering, and refresh usable while work is pending, and the toolbar task menu remains visible until completed tasks expire after a short inspection window.
- Passive reconnect is surfaced as a regular `Reconnect` task in the same task menu. Concurrent SFTP operations that observe the same stale session share one in-flight reconnect promise, then each operation retries once against the new session id. If reconnect succeeds but the original operation still fails, the renderer reports that operation failure and does not start a second reconnect loop.
- Reconnect prefers the tab's current path (`currentPathRef.current`) when creating the replacement session and falls back to the original connection intent path, or `.` when no initial path was provided.
- Multi-entry cut/copy/delete/paste uses one backend batch API request against the current SFTP session. The service executes entries in order, stops on the first failure, returns per-entry `success`/`failed`/`skipped` results, and does not roll back already completed entries. Rename, open, Open With, local save, empty-file creation, and directory creation remain single-entry tasks. Open-in-new-tab remains immediate because it does not mutate the current session.
- Local save actions remain single-entry actions and only support regular files. `Save to Downloads` asks main for the OS downloads path, `Save to...` asks main to show a native save dialog, and the backend streams the remote file through the live SFTP session into a temporary local file before replacing the final destination.
- Default file open and Open With actions also remain single-entry actions for regular files. The renderer asks main for a unique path under `app.getPath('temp')/cosmosh-sftp`, reuses the existing SFTP download endpoint to materialize the file, then asks main to open only that validated temp path.
- Preview reads are renderer-driven and single-entry only. Text/code preview reads call the bounded UTF-8 file endpoint; files above `sftpTextPreviewWarningThresholdBytes` require confirmation before reading, and reads are capped by the backend maximum. Image previews reuse the temp download path; images above `sftpImagePreviewWarningThresholdBytes` require confirmation before downloading, but confirmation never bypasses the hard image preview size cap checked before download.
- Monaco preview saves queue a `Save` task in the same tab-local FIFO queue. The request sends UTF-8 content plus the selected file's `size` and `modifiedAt` snapshot to `POST /api/v1/sftp/sessions/{sessionId}/file`. Remote snapshot mismatches return `SFTP_UPLOAD_CONFLICT`; the renderer then reuses the overwrite confirmation dialog and only retries with `overwrite: true` after explicit confirmation.
- Unsaved Monaco preview edits block selection changes and toolbar sidebar mode changes that would hide or replace the edited preview. Hard runtime resets such as opening a different SFTP connection still clear tab-local preview state because the original remote session context is no longer valid.
- After a default open or Open With action succeeds, main starts a debounced watcher for that exact temp file and pushes change events only to the owning renderer webContents. The renderer keeps one pending upload prompt per remote path, so repeated editor save events collapse into one prompt until the user uploads or ignores the change.
- Accepting an upload prompt queues an `Upload` task in the same tab-local FIFO task queue used by other SFTP operations. The upload request includes the opened remote file's `size` and `modifiedAt`; backend compares those values to the current remote `stat` before writing. If they differ, the backend returns `SFTP_UPLOAD_CONFLICT` and does not overwrite the remote file on that request.
- When the renderer receives `SFTP_UPLOAD_CONFLICT`, it keeps the same upload task running and opens a second confirmation dialog for overwriting remote changes. Canceling that dialog skips the upload. Confirming it retries the same upload with `overwrite: true`, which explicitly bypasses the original opening snapshot check while still requiring a regular remote target and a validated Cosmosh temp local file.
- Successful uploads write to a remote temp file in the target directory before replacing the original file. The backend prefers the OpenSSH POSIX rename extension, falls back to ordinary SFTP rename when supported, and only uses an `unlink` + `rename` compatibility path after rechecking the remote `size`/`modifiedAt` conflict guard for non-overwrite uploads. Explicit overwrite uploads skip that recheck because the user already confirmed the conflict. The renderer then refreshes the visible directory and updates the watched file's remote snapshot from the upload response and refreshed listing. Ignoring the prompt clears the pending change without stopping the watcher, so later local saves can prompt again.
- On Windows, `Open With...` is a plain menu item with no submenu and first uses the shell `openas` verb through a hidden PowerShell process; the validated temp file path is passed through the child process environment to avoid PowerShell argument parsing edge cases. If that shell verb is rejected by the OS for a file type, main falls back to `rundll32.exe shell32.dll,OpenAs_RunDLL`. On macOS, `Open With...` is a submenu populated by the NSWorkspace helper in `packages/main/resources/helpers`; `prebuild` compiles the helper binary on macOS, while development can fall back to the Swift source. Linux does not render the Open With action.
- Successful operations invalidate the current directory cache and revalidate the visible listing in the background, preserving the current list, filter, and selection until the server result arrives.

## 6. Security And Error Model

SFTP uses the same server, keychain, credential decryption, and host fingerprint trust model as SSH:

- Credentials are resolved from `SshServer` -> `SshKeychain` in the backend process.
- Decrypted secrets never cross into renderer or preload.
- Main injects the internal backend auth token and locale headers.
- Unknown or untrusted host fingerprints are returned through the same confirmation flow used by SSH.
- SSH transport compression follows the server's persisted `enableSshCompression` flag. It defaults off and is negotiated only when enabled on the server record.
- Reconnect creates a normal new SFTP session and therefore reuses the same host fingerprint trust confirmation flow. If the user rejects the fingerprint prompt, the reconnect task fails and the original operation is not retried.

Error mapping:

- Missing or invalid request data -> `SFTP_VALIDATION_FAILED`.
- Missing session id, evicted session, or closed SSH/SFTP transport -> `SFTP_SESSION_NOT_FOUND`.
- Connection failures, permission errors, unreadable paths, copy/delete/rename failures, and remote SFTP errors -> `SFTP_OPERATION_FAILED`.
- Unknown host fingerprint -> `SSH_HOST_UNTRUSTED` with fingerprint confirmation data.

Security constraints:

- Renderer and preload never receive decrypted SSH credentials.
- SFTP paths are passed as structured API payloads, not shell commands.
- Local save destinations are selected or resolved by main/preload and passed to backend as explicit paths; renderer does not receive filesystem write primitives.
- Local OS-open actions are restricted to paths under the Cosmosh SFTP temp root. Main normalizes the candidate path, verifies it stays inside that root, and checks that it is an existing file before calling `shell.openPath`, Windows `openas`, or the macOS helper.
- SFTP temp-file watchers use the same temp-root validation and are owned by the renderer webContents that requested them. Watchers stop when the tab runtime resets, the renderer is destroyed, or the renderer explicitly stops the watch.
- Image previews never load `file://` URLs directly. Main/preload validates the temp path under the Cosmosh SFTP temp root, checks the image extension and size cap, and returns a data URL for the renderer image element.
- Text preview writes accept UTF-8 strings only, enforce the backend preview-write size cap, require a regular remote file, and preserve the existing remote conflict guard before replacing the target through a remote temp file.
- Upload write-back only accepts local paths selected through the validated temp-file flow and rejects remote writes when the target is not a regular file. Non-overwrite writes are also rejected when the remote conflict snapshot no longer matches; overwrite writes require the renderer's explicit second confirmation and `overwrite: true`.
- Backend rejects empty mutable targets and root/current-directory markers for write operations.

## 7. Renderer UX Contract

The SFTP page follows Cosmosh workbench layout rules:

- Use up to three dense rounded workbench cards: left directory tree, center directory list, and the optional right details/preview sidebar.
- Keep the tree panel narrow and task-oriented, currently aligned to the 250 px Cosmosh sidebar rhythm.
- Use internal UI wrappers (`Button`, `Tooltip`, `Dialog`) and tokenized classes.
- The toolbar overflow menu owns the `Auxiliary Sidebar` submenu with `Details`, `Preview`, and `Off` radio choices. The value is persisted through `sftpAuxiliarySidebarMode`, so changing it from the toolbar and changing it from Settings are the same action.
- When a Monaco text/code preview is active, the toolbar inserts editor controls for undo, redo, and save next to the task menu. Save is enabled only while the preview content differs from the last saved remote snapshot.
- SFTP tabs use a folder icon and inherit the server color background when the shared SSH/SFTP server-visual tab setting is enabled.
- Keep the toolbar compact and ordered as path controls, remote path address bar, file-operation buttons, and current-directory filter.
- The address bar defaults to a Windows-style breadcrumb control. Segment labels navigate to that path, segment arrows open that level's available child directories from the renderer directory cache or lazy-load them from the active session, and the blank area temporarily switches back to the editable text input. The address-bar context menu keeps `Copy Address` and `Edit Address`, plus a `Show Address as Text` action that persists `sftpShowAddressAsText`. When that setting is enabled, the address bar always renders as the plain input, including when it is not actively focused; the input context menu exposes the reverse display action so users can return to the breadcrumb control without leaving the field first.
- The back and forward toolbar controls use plain directional arrow icons. Left-click jumps one step; right-click opens a context menu only when reachable history targets exist, listing them in nearest-first order to match desktop file-manager navigation.
- Use `MenubarSeparator` for toolbar separators so divider metrics and colors stay aligned with shared menu tokens.
- Show the SFTP task trigger only while the tab has active or recently completed tasks. The trigger belongs between the address control and file-operation buttons, uses `ListTodo`/spinner iconography, and opens a right-aligned dense task menu with per-task status text and compact progress bars.
- Reconnect progress must use that task trigger instead of adding a separate banner, toast-only state, floating overlay, or persistent warning region.
- Expose file actions in the center list context menu and toolbar; unavailable actions must be disabled.
- Row and toolbar overflow menu `Properties` items open the standalone Properties window for the selected entry or selection.
- Expose tree-node actions through the left directory tree context menu. These actions are scoped to the clicked directory and must not inherit center-list multi-selection state.
- Directory-list row selection matches desktop file-manager conventions: plain click replaces the selection, `Ctrl`/`Cmd` toggles one row, `Ctrl`/`Cmd+A` selects every visible entry, `Shift` selects the visible range from the current anchor, `Space` selects the focused row, and primary-clicking blank space in the center list clears the current selection. Row context menus preserve an existing multi-selection when the clicked row is already selected.
- The left directory tree and center file list use roving focus: `Tab` enters each list once, then `ArrowUp`/`ArrowDown` move between rows. In the file list, unmodified arrow navigation selects the focused file row, `Ctrl`/`Cmd` plus arrow navigation moves focus without changing selection, and `Shift` plus arrow/Home/End expands the selected range while the optional `..` parent row remains activation-only.
- Avoid duplicated menu entries across the toolbar overflow menu and the context-menu surface. Row context menus focus on the selected entry, blank-area context menus focus on paste/create actions, tree context menus focus on the clicked directory, and the toolbar overflow menu contains actions that do not already have dedicated toolbar buttons.
- The Properties surface is a separate Electron/browser window. Its first version reuses existing SFTP card, text, and button styles, keeps field labels and values selectable, and reserves permissions editing through a standard edit button at the end of the permissions section.
- The Properties window receives the session id that was current when it opened. If that session expires, the window shows the existing properties-load failure state and does not start an independent reconnect flow.
- Inline rename and create inputs stay inside the row grid without changing icon or text baseline position.
- Inline rename and create actions launched from context or overflow menus must defer the edit-state transition until menu close handling begins, suppress menu close autofocus while the input is being mounted, and then focus/select the row input. This prevents the first menu-triggered edit from being blurred and committed or cancelled before the user can type.
- Platform shortcut labels follow desktop convention: `Cmd` on macOS and `Ctrl`/`Delete` on Windows/Linux. Context menus and toolbar overflow menus must show the same shortcut labels for actions that have keyboard handlers.
- `Open in New Tab` is only rendered for directory targets, and `Open With...` is placed directly after it in the open-action group. `Open With...` must not include a leading icon. Windows shows it as a single item that opens the system picker. macOS shows it as a submenu with application names and icons returned from main; Linux omits the action.
- Delete confirmation uses the shared `Dialog` wrapper and must preserve the pending operation until the user confirms or cancels. Keyboard-triggered delete passes an explicit shortcut source so the confirmation setting can distinguish shortcut-only safety prompts from toolbar and context-menu deletes.
- Opened-file upload prompts use the shared `Dialog` wrapper. The first dialog appears only after a debounced local temp-file change and offers `Ignore` and `Upload`. A second dialog appears only after the backend reports `SFTP_UPLOAD_CONFLICT`, offering `Cancel` and `Overwrite`; overwrite is never implicit.
- The optional `..` parent-directory row belongs to the center file list only. It must render before real entries, stay out of selection and detail state, use double-click/Enter activation like regular file rows, and show a disabled state at the remote root when no parent path exists.
- Show the current directory and all parent directories in the tree; expanding a tree row loads its child directory list and shows an inline spinner while loading.
- After opening a directory from any SFTP navigation surface, leave the matching left-tree row in place only when its mounted parent/current/expanded-child context fits inside the visible tree viewport; otherwise, scroll the current row into the upper third of the tree viewport once it is mounted.
- Match file-manager behavior: expanding or collapsing a tree row does not navigate the center directory list. Opening a directory from the center list or path toolbar changes the current directory.
- Preserve stable list columns and truncate long names/paths instead of allowing layout shift. Directory-list headers are draggable only horizontally, and right-clicking the header must expose the same column/sort view controls as the toolbar overflow menu. The address bar must collapse older path levels behind an ellipsis menu when the path is too deep so the current directory remains visible within narrow toolbars.

## 8. Future Scope

Future SFTP work should be planned separately. Likely next phases:

1. Streamed download/upload with progress and cancellation.
2. chmod and richer permissions editing.
3. Transfer queue and conflict handling for long-running copies/uploads/downloads.
4. Richer editor workflows such as find/replace, encoding choices, and explicit reload/compare actions.
5. Optional terminal-path handoff once the SSH terminal and SFTP session model can share state safely.
