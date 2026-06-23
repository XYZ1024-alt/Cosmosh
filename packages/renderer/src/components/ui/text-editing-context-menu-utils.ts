const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Platform-specific shortcut labels shared by text editing context menus.
 */
export const textEditingShortcut = {
  undo: isMac ? '⌘Z' : 'Ctrl+Z',
  redo: isMac ? '⇧⌘Z' : 'Ctrl+Y',
  cut: isMac ? '⌘X' : 'Ctrl+X',
  copy: isMac ? '⌘C' : 'Ctrl+C',
  paste: isMac ? '⌘V' : 'Ctrl+V',
  selectAll: isMac ? '⌘A' : 'Ctrl+A',
};

/**
 * Copies text with Clipboard API first and a hidden textarea fallback second.
 *
 * @param text Text to copy.
 * @returns Whether the text was copied by any available clipboard path.
 */
export const writeTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';

    document.body.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }
};

/**
 * Reads text from the async Clipboard API when the current runtime allows it.
 *
 * @returns Clipboard text, or null when browser permissions/runtime deny access.
 */
export const readTextFromClipboard = async (): Promise<string | null> => {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
};
