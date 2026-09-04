export const dialogStyles = {
  overlay:
    'fixed inset-0 z-50 bg-dialog-overlay data-[state=open]:animate-overlay-show data-[state=closed]:animate-overlay-hide',
  // Half of the 34px tab-strip height offsets dialogs without making them feel bottom-heavy.
  content:
    'fixed left-1/2 top-[calc(50%+17px)] z-50 grid w-[calc(100%-1.5rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[16px] border border-dialog-border bg-dialog-surface p-4 text-dialog-text shadow-soft outline-none backdrop-blur-[6px] data-[state=open]:animate-content-show data-[state=closed]:animate-content-hide',
  // The height reserve keeps tall dialogs clear of the header and the bottom window edge.
  tallEditorContent: 'max-h-[calc(100vh-100px)] grid-rows-[auto,minmax(0,1fr),auto] overflow-hidden',
  tallEditorScrollableBody: 'min-h-0 overflow-auto',
  closeButton:
    'absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-[10px] text-dialog-text-muted outline-none hover:bg-form-control hover:text-dialog-text',
  header: 'grid gap-1.5 text-left',
  footer: 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
  title: 'text-[15px] font-semibold text-dialog-text',
  description: 'text-[14px] text-dialog-text-muted',
};
