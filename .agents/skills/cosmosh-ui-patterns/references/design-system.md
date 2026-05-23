# Cosmosh Design System

## Load Order

```text
packages/renderer/theme/tokens.cjs
  -> packages/renderer/src/index.css CSS variables
  -> packages/renderer/tailwind.config.cjs mappings
  -> packages/renderer/src/components/ui/* wrappers
  -> feature pages and page-level components
```

Keep this pipeline intact. New primitives start in tokens, become CSS variables, then Tailwind tokens, then wrapper classes. Feature code consumes the resulting class names.

## Product Shape

Cosmosh is not a marketing site. Treat every screen as a workbench for repeated expert use:

- Prefer dense, scannable layouts over large empty hero surfaces.
- Keep commands near the object they act on.
- Make status, disabled states, and errors explicit.
- Use restrained glass/surface treatment only where it helps depth and focus.
- Preserve terminal readability over visual flourish.

## Tokens And Tailwind

- Source theme values from `packages/renderer/theme/tokens.cjs`.
- Map token values through `tailwind.config.cjs` and `index.css`.
- Use semantic token classes such as `bg-bg`, `text-home-text`, `border-home-divider`, `bg-form-control`, `bg-menu-control`, `text-form-message-error`, and `border-ssh-terminal-split-divider`.
- Add new semantic tokens only when an existing token cannot express the UI state without muddying meaning.
- Do not add per-page hex colors, one-off opacity palettes, arbitrary shadows, or new radius values.

## Radius, Spacing, And Type

- Use existing radius tokens (`rounded-sm`, `rounded-sm-2`, `rounded-lg`, etc.) and established wrapper classes.
- Standard controls are compact: many wrappers use `h-[34px]`, `text-sm`, `gap-2`, and tokenized hover surfaces.
- Reserve larger type for page headers. Inside settings, menus, dialogs, cards, and toolbars, keep type tight and readable.
- Set stable dimensions for tabs, icon buttons, grids, and terminal panes so hover/focus/label changes do not shift layout.

## UI Wrappers

Use internal wrappers from `packages/renderer/src/components/ui/*`:

- Form controls: `Button`, `Input`, `Textarea`, `Switch`, `Checkbox`, `Select`, `Slider`, `Toggle`, `TagInput`.
- Overlays: `Dialog`, `AlertDialog`, `DropdownMenu`, `ContextMenu`, `Menubar`, `Tooltip`, `Toast`.
- Style maps: `form-styles.ts`, `menu-styles.ts`, `dialog-styles.ts`, `toast-styles.ts`.

When a new Radix primitive is needed, wrap it in `components/ui` first and keep state selectors, collision behavior, keyboard semantics, and tokenized classes inside the wrapper.

## Icons And Controls

- Use `lucide-react` icons when an icon exists.
- Prefer icon buttons for compact tool actions and tooltips for unfamiliar icon-only controls.
- Use menus for option sets, toggles/switches/checkboxes for binary settings, segmented/toggle groups for modes, sliders or numeric inputs for ranges, and dialogs for focused creation/edit flows.
- Match disabled state to actual capability. If an action is intentionally unfinished, use a disabled item with a localized hint or a coming-soon toast.

## Layout Patterns

- Use `SplitWorkbenchLayout` and `SplitWorkbenchMainPanel` for two-pane editor/workbench pages.
- Keep sidebars narrow and task-oriented; current defaults are around `w-[250px]`.
- Keep main panels scroll-stable: fixed headers with scrollable bodies for long content, or unified scrolling when the header belongs to the document flow.
- Use tokenized dividers (`bg-home-divider`, `border-home-divider`) and avoid card-in-card nesting.

## Accessibility Baseline

- Keep accessible labels on icon-only controls.
- Preserve keyboard navigation and shortcut behavior.
- Use focus-visible states from wrappers and token classes.
- Do not steal focus from inputs, command palette fields, terminal search, or dialog actions during menu close/open transitions.
