# SFTP File System

## 1. Current Status

Cosmosh implements a tab-scoped SFTP file-system workbench.

Implemented in v1:

- Home server context menu and file action can open an SFTP tab.
- Each SFTP tab creates a backend SFTP session and owns that session lifecycle.
- Directory listing supports path navigation, back/forward history, parent navigation, refresh, current-directory filtering, loading, empty, expired-session, and operation-failed states.
- The renderer shows directory entries, metadata details, and bounded UTF-8 file preview.
- The left directory tree shows the current directory ancestry and caches loaded child directories as users browse.
- Context menus and the top action bar expose open, open folder in a new tab, cut, copy, paste, delete, new file, new folder, and inline rename. The directory list supports multi-selection with `Ctrl`/`Cmd` toggle and `Shift` range selection.
- Backend write operations support empty-file creation, directory creation, rename/move, recursive copy, and recursive delete.

Intentionally not included in v1:

- upload, download, chmod, drag/drop, global search, file editing, and transfer queues.
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
- **Main/preload**: `packages/main/src/ipc/register-backend-ipc.ts` proxies SFTP requests to backend routes. `packages/main/src/preload.ts` exposes the minimal renderer bridge.
- **Renderer**: `packages/renderer/src/pages/SFTP.tsx` owns tab-scoped UI state, file actions, inline rename/create state, and preview state.

## 3. API Contract

All callers must use generated exports from `@cosmosh/api-contract`, especially `API_PATHS` and generated request/response payload types.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/sftp/sessions` | Create an SFTP file-system session for one SSH server. |
| `GET` | `/api/v1/sftp/sessions/{sessionId}/entries?path=...` | List one remote directory for an active SFTP session. |
| `GET` | `/api/v1/sftp/sessions/{sessionId}/file?path=...&maxBytes=...` | Read a bounded UTF-8 preview for one remote file. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/files` | Create one empty remote file. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/directories` | Create one remote directory. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/rename` | Rename or move one remote entry. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/copy` | Copy one remote file or directory tree. |
| `POST` | `/api/v1/sftp/sessions/{sessionId}/entries/delete` | Delete one remote file, symlink, or directory tree. |
| `DELETE` | `/api/v1/sftp/sessions/{sessionId}` | Close one SFTP session and release the SSH connection. |

Success codes:

- `SFTP_SESSION_CREATE_OK`
- `SFTP_DIRECTORY_LIST_OK`
- `SFTP_FILE_READ_OK`
- `SFTP_OPERATION_OK`

SFTP-specific error codes:

- `SFTP_SESSION_NOT_FOUND`
- `SFTP_VALIDATION_FAILED`
- `SFTP_OPERATION_FAILED`

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
  UI->>Main: backendSftpRenameEntry / backendSftpCopyEntry / ...
  Main->>API: POST /api/v1/sftp/sessions/{sessionId}/...
  API->>SFTP: Mutating operation on live session
  SFTP-->>UI: operation success + background listing revalidation
  UI->>Main: backendSftpCloseSession(sessionId)
  Main->>API: DELETE /api/v1/sftp/sessions/{sessionId}
```

Lifecycle rules:

- A normal Home context-menu action reuses an existing SFTP tab for the same server when one is already open.
- Explicit new-tab actions create a new SFTP tab and therefore a separate backend SFTP session.
- Hidden SFTP tabs remain mounted and keep their session alive.
- Closing the tab or changing its connection intent closes the previous SFTP session on a best-effort basis.
- Backend shutdown closes all registered SFTP sessions.

## 5. Directory Listing And File Operations

The backend treats SFTP paths as POSIX paths regardless of the host OS running Cosmosh.

Directory listing steps:

1. Normalize the requested path.
2. Resolve it with `realpath`.
3. Run `readdir` for the resolved directory.
4. Map each entry to `{ name, path, type, size, mode, permissions, modifiedAt }`.
5. Sort directories first, then sort by name with numeric-aware locale comparison.

Entry types are reduced to:

- `directory`
- `file`
- `symlink`
- `other`

The renderer currently displays columns for name, size, modified time, and mode. The directory panel supports filtering entries in the current directory only; it is not a remote recursive search. The details panel shows metadata for a single selected entry, shows a selected-count summary for multiple entries, and switches to a bounded preview after opening a regular file.

Directory results are cached in the renderer for the lifetime of the SFTP tab. Revisiting an already loaded path uses that in-memory result immediately. The refresh action bypasses the cache and requests a fresh listing from the active backend session while preserving the visible list until the new result arrives.

Mutation rules:

- All mutating requests target the current live SFTP session and use POSIX-style paths.
- Empty files are created with exclusive write semantics so existing remote files are not overwritten.
- Directory copy is recursive. The backend chooses a `copy`, `copy 2`, ... suffix when the requested destination already exists.
- Copying a directory into itself or one of its descendants is rejected.
- Delete uses `lstat` so symlinks are removed as links instead of following their targets.
- Directory delete is recursive when requested by the renderer.
- Multi-entry cut/copy/delete/paste is orchestrated by the renderer as ordered single-entry API calls against the current SFTP session. Rename, open, open-in-new-tab, and preview remain single-entry actions.
- Successful operations invalidate the current directory cache and revalidate the visible listing in the background, preserving the current list, filter, and selection until the server result arrives.
- File preview reads up to the requested bounded byte limit and reports whether the result was truncated.

## 6. Security And Error Model

SFTP uses the same server, keychain, credential decryption, and host fingerprint trust model as SSH:

- Credentials are resolved from `SshServer` -> `SshKeychain` in the backend process.
- Decrypted secrets never cross into renderer or preload.
- Main injects the internal backend auth token and locale headers.
- Unknown or untrusted host fingerprints are returned through the same confirmation flow used by SSH.

Error mapping:

- Missing or invalid request data -> `SFTP_VALIDATION_FAILED`.
- Missing session id or closed session -> `SFTP_SESSION_NOT_FOUND`.
- Connection failures, permission errors, unreadable paths, copy/delete/rename failures, and remote SFTP errors -> `SFTP_OPERATION_FAILED`.
- Unknown host fingerprint -> `SSH_HOST_UNTRUSTED` with fingerprint confirmation data.

Security constraints:

- Renderer and preload never receive decrypted SSH credentials.
- SFTP paths are passed as structured API payloads, not shell commands.
- Backend rejects empty mutable targets and root/current-directory markers for write operations.
- File preview is bounded to avoid unbounded memory reads.

## 7. Renderer UX Contract

The SFTP page follows Cosmosh workbench layout rules:

- Use three dense rounded workbench cards: left directory tree, center directory list, and right details/preview.
- Keep the tree panel narrow and task-oriented, currently aligned to the 250 px Cosmosh sidebar rhythm.
- Use internal UI wrappers (`Button`, `Tooltip`, `Dialog`) and tokenized classes.
- Keep the toolbar compact and ordered as path controls, remote path input, file-operation buttons, and current-directory filter.
- Use `MenubarSeparator` for toolbar separators so divider metrics and colors stay aligned with shared menu tokens.
- Expose file actions in the center list context menu and toolbar; unavailable actions must be disabled.
- Directory-list row selection matches desktop file-manager conventions: plain click replaces the selection, `Ctrl`/`Cmd` toggles one row, and `Shift` selects the visible range from the current anchor. Row context menus preserve an existing multi-selection when the clicked row is already selected.
- Avoid duplicated menu entries across the toolbar overflow menu and the context-menu surface. Row context menus focus on the selected entry, blank-area context menus focus on paste/create actions, and the toolbar overflow menu contains actions that do not already have dedicated toolbar buttons.
- Inline rename and create inputs stay inside the row grid without changing icon or text baseline position.
- Platform shortcut labels follow desktop convention: `Cmd` on macOS and `Ctrl`/`Delete` on Windows/Linux. Context menus and toolbar overflow menus must show the same shortcut labels for actions that have keyboard handlers.
- Show the current directory and all parent directories in the tree; expanding a tree row loads its child directory list and shows an inline spinner while loading.
- Match file-manager behavior: expanding or collapsing a tree row does not navigate the center directory list. Opening a directory from the center list or path toolbar changes the current directory.
- Preserve stable list columns and truncate long names/paths instead of allowing layout shift.

## 8. Future Scope

Future SFTP work should be planned separately. Likely next phases:

1. Streamed download/upload with progress and cancellation.
2. chmod and richer permissions editing.
3. Transfer queue and conflict handling for long-running copies/uploads/downloads.
4. Full file editor integration with save/write-back semantics.
5. Optional terminal-path handoff once the SSH terminal and SFTP session model can share state safely.
