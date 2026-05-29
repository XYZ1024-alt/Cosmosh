/** Tailwind indentation classes allowed for the fixed SFTP tree depth ladder. */
export const TREE_INDENT_CLASS_NAMES = ['pl-2', 'pl-5', 'pl-8', 'pl-11', 'pl-14', 'pl-16'] as const;

/** Shared SFTP panel surface class. */
export const SFTP_CARD_CLASS_NAME = 'bg-ssh-card-bg-terminal h-full min-h-0 overflow-hidden rounded-[18px] p-1';

/** Minimum width used by the dense directory table. */
export const DIRECTORY_LIST_MIN_WIDTH_CLASS_NAME = 'min-w-[600px]';

/** Grid columns shared by directory header and rows. */
export const DIRECTORY_ROW_GRID_CLASS_NAME = 'grid-cols-[minmax(0,1fr)_92px_148px_96px_28px]';

/** Transparent fallback for native applications that do not expose an icon. */
export const SFTP_OPEN_WITH_APPLICATION_ICON_FALLBACK =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

/** Default draft name for inline new file creation. */
export const NEW_FILE_NAME = 'untitled.txt';

/** Default draft name for inline new directory creation. */
export const NEW_DIRECTORY_NAME = 'Untitled Folder';

/** Synthetic key used by the optional parent-directory row. */
export const PARENT_DIRECTORY_ROW_KEY = '__sftp_parent_directory__';

/** Delay that lets nested Radix menus release focus before inline edit starts. */
export const INLINE_EDIT_MENU_HANDOFF_RELEASE_DELAY_MS = 220;

/** Maximum breadcrumb count before old ancestors collapse behind an ellipsis menu. */
export const ADDRESS_BREADCRUMB_VISIBLE_LIMIT = 5;

/** Number of trailing breadcrumbs kept visible when the middle is collapsed. */
export const ADDRESS_BREADCRUMB_TRAILING_COUNT = 3;
