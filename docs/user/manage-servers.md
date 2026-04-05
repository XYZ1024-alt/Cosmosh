# Manage Servers

## Create a Server Profile

1. On Home, open `Add` and choose `Add Server`.
2. Fill host, port, username.
3. Choose authentication method (password or private key).
4. Save from the server dialog and run a quick connection test.

## Default Note Template

- Settings > Advanced > Default Server Note Template pre-fills the Note field when creating a new server profile.
- This template is applied only for new profiles and does not overwrite existing server notes.

## Server Address Visibility

- Use Settings > General > Show Full Server Address to control how host/IP values are displayed in server lists.
- Enabled (default): the full server address is shown.
- Disabled: addresses are masked with asterisks to reduce shoulder-surfing risk.

## Organize for Daily Use

1. Apply stable naming, for example `env-region-role`.
2. Group by environment such as `prod`, `staging`, `dev`.
3. Keep high-risk and low-risk hosts visually distinct.
4. Move recently changed hosts into a review group for short-term validation.

### Tag Behavior Notes

- When viewing a specific folder on Home, tag chips remain visible and only include tags used by that folder.
- Unused custom SSH tags are removed automatically after server/tag updates.
- The reserved `favorite` tag is never auto-deleted.

## Update or Remove Profiles

1. In Home, open the server context menu and choose `Edit`.
2. Update profile fields immediately after host/user/auth changes.
3. Re-run a quick test connection after edits.
4. Remove stale entries to reduce mistaken connections.
5. Double-check before deleting production entries.

## Screenshot Placeholders

1. Server profile list with environment grouping.
2. Edit server dialog with auth fields.
3. Delete confirmation for a server entry.
