# ADR-0003: Shadcn-Native Web UI

Status: Proposed
Date: 2026-06-19

## Context

Metapi's web UI has grown through several generations of local CSS and custom
React controls:

- global classes such as `btn`, `card`, `badge`, `alert`, `modal-*`,
  `filter-*`, `mobile-*`, `route-*`, and `data-table`;
- custom reusable controls such as `ModernSelect`, `CenteredModal`,
  `MobileDrawer`, `MobileFilterSheet`, `MobileCard`, and search/notification
  overlays;
- page-local inline style objects for colors, borders, backgrounds, shadows,
  spacing, and form skins;
- new shadcn/Radix primitives under `src/web/components/ui/**`.

The route graph editor and upstream compatibility policy work made the problem
visible. Radix portal-based controls such as `Select`, `Popover`, and
`ContextMenu` must work inside dialogs, graph inspectors, drawers, and command
surfaces. A mixed UI stack makes this unreliable because each custom shell owns
its own layering, focus, keyboard behavior, spacing, and theme tokens.

The long-term UI direction should be explicit: shadcn/Radix provides the
interaction primitives and theme vocabulary, while Metapi owns only domain
composition.

## Decision

Metapi will migrate the web UI to a **shadcn-native component architecture**.

The target architecture is:

```text
src/web/components/ui/**
  -> shadcn/Radix primitives and small primitive variants

src/web/components/**
src/web/pages/**/{domain folders}
  -> domain components composed from shadcn primitives

src/web/pages/*.tsx
  -> page orchestration, data loading, and domain component assembly
```

The following are the only acceptable UI ownership layers:

1. **Primitive layer**

   `src/web/components/ui/**` wraps Radix/shadcn primitives and owns:

   - accessible base controls;
   - primitive variants;
   - portal layering;
   - focus rings and keyboard behavior;
   - theme-token-based styling.

2. **Domain component layer**

   Domain components own product semantics, not primitive behavior.

   Examples:

   - `TokenStatusBadge`;
   - `RouteGraphInspector`;
   - `RouteEndpointPolicyEditor`;
   - `SiteCompatibilityDefaultsCard`;
   - `DownstreamKeyEditorDialog`.

   These components may compose shadcn primitives but must not recreate
   buttons, dialogs, selects, drawers, badges, cards, tabs, tables, or command
   menus from raw HTML plus custom CSS.

3. **Page layer**

   Pages coordinate fetching, mutation, routing, and layout. A page may use
   shadcn primitives directly for simple one-off layout, but when a form,
   modal, drawer, panel, or table becomes a reusable workflow it must move to a
   domain component.

## Non-Goals

This ADR does not require a single massive rewrite. It defines the destination
and the migration rules.

This ADR does not remove custom visual code needed for:

- XYFlow node, edge, handle, minimap, and canvas-specific styling;
- chart library rendering surfaces;
- brand icons and image assets;
- animation utilities that are not available as shadcn primitives;
- application shell layout where no shadcn primitive exists.

Those exceptions must stay narrow and domain-specific.

## Component Policy

### Required Shadcn Primitives

The primitive layer must include, at minimum:

- `Button`;
- `ButtonGroup`;
- `Input`;
- `Textarea`;
- `Label`;
- `Checkbox`;
- `Switch`;
- `RadioGroup`;
- `Select`;
- `Popover`;
- `DropdownMenu`;
- `ContextMenu`;
- `Command`;
- `Dialog`;
- `AlertDialog`;
- `Sheet`;
- `Tabs`;
- `Card`;
- `Badge`;
- `Alert`;
- `Table`;
- `Skeleton`;
- `Separator`;
- `ScrollArea`;
- `Resizable`;
- `Tooltip`.

Missing primitives should be added before migrating a page that needs them.
Pages must not invent one-off replacements because a primitive is temporarily
missing.

### Forbidden Legacy Patterns

The following patterns are deprecated and must not be added to new code:

- `className="btn ..."` and all `btn-*` variants;
- `className="card"` and card variants outside temporary migration areas;
- `className="badge ..."` and all `badge-*` variants;
- `className="alert ..."` and all `alert-*` variants;
- `modal-backdrop`, `modal-content`, `modal-header`, `modal-body`,
  `modal-footer`;
- `ModernSelect`;
- `CenteredModal`;
- `MobileDrawer`;
- `MobileFilterSheet`;
- page-local visual inline styles such as `color`, `background`,
  `border`, `boxShadow`, and `borderRadius`.

Allowed inline styles are limited to measured or dynamic layout values that
cannot be represented cleanly by static classes, for example graph inspector
coordinates, XYFlow dimensions, chart dimensions, and CSS variables computed
from data.

### Native Replacement Policy

When a workflow is migrated, it must be migrated to shadcn-native primitives,
not to new hand-rolled controls and not to local CSS that imitates shadcn.

Replacement means:

```text
layout card / panel      -> Card, CardHeader, CardContent, CardFooter
title / description      -> CardTitle, CardDescription or DialogTitle/Description
primary command          -> Button
adjacent command set     -> ButtonGroup
status label             -> Badge or domain component composed from Badge
inline notice            -> Alert
confirmation             -> AlertDialog
modal form               -> Dialog
mobile drawer            -> Sheet
search palette           -> Command inside Dialog
plain select             -> Select
searchable select        -> Command + Popover combobox pattern
boolean setting          -> Switch or Checkbox with Label
text field               -> Input
multi-line text field    -> Textarea
table                    -> Table primitives
loading placeholder      -> Skeleton
scroll container         -> ScrollArea
split pane               -> Resizable
right-click menu         -> ContextMenu
button menu              -> DropdownMenu
hover help               -> Tooltip
```

The replacement must use primitive props and Tailwind/shadcn utility classes.
Business CSS may provide layout only: display, grid/flex tracks, gap, min/max
size, overflow, and canvas coordinates. Business CSS must not restate shadcn
visual tokens such as background, color, border, radius, shadow, ring, or
z-index for ordinary controls.

If a shadcn primitive lacks a needed variant, add the variant to the primitive
layer once and use it everywhere. Do not patch the page or domain component
with visual CSS.

### Wrapper Policy

Do not create compatibility wrappers that preserve legacy names indefinitely.

Allowed:

```text
TokenStatusBadge -> Badge
RouteGraphInspector -> Dialog/Popover/Tabs/Button
SearchCommandDialog -> Command/Dialog
```

Not allowed:

```text
LegacyButton -> Button
AppButton with btn-primary semantics
CardCompat -> Card
ModernSelect backed by Select
```

Domain names are acceptable. Legacy UI vocabulary is not.

## Layering And Portal Policy

Metapi should avoid expanding its custom CSS variable vocabulary. This applies
to z-index just as much as color, border, radius, and shadow tokens.

Portal-based shadcn/Radix primitives should keep the shadcn/Tailwind default
layering model unless there is a documented upstream reason not to:

```text
Dialog overlay/content: z-50
Select content:         z-50
Dropdown content:       z-50
Context menu content:   z-50
Popover content:        z-50
Tooltip content:        z-50
```

Legacy custom overlays must not sit above shadcn portal content. During
migration, any legacy overlay that must temporarily coexist with shadcn
portals should be lower than `z-50`. This is a transition rule, not a new
design abstraction.

Forbidden:

- adding new `--z-*` variables for standard component layering;
- using page-local `z-index` hacks to make a single dropdown visible;
- raising shadcn portal primitives above `z-50` to compensate for legacy
  overlays;
- introducing per-page stacking contexts that trap Radix portals.

Allowed exceptions:

- XYFlow internals and graph canvas overlays when the graph library requires
  local stacking;
- application shell constants that already exist and cannot be removed in the
  current slice;
- short-lived migration changes that lower legacy overlays until the overlay
  shell is replaced by shadcn `Dialog` or `Sheet`.

The final state is that dialogs, sheets, popovers, selects, context menus, and
tooltips all use shadcn primitives and no custom z-index variable is needed for
their relative ordering.

## Route Graph UI Policy

The route graph editor is a special domain surface because XYFlow nodes and
ports are canvas primitives, not normal HTML controls.

Route graph may keep domain-specific CSS for:

- node cards;
- port handles;
- port collection glyphs;
- edge rendering;
- minimap and controls dark-mode adaptation;
- canvas layout constraints.

Route graph must use shadcn primitives for:

- sidebars and resizable panels;
- toolbar buttons and grouped buttons;
- context menus;
- command palette;
- popovers;
- inspector shell;
- inspector tabs;
- inspector forms;
- badges and status chips;
- cards outside graph-node rendering;
- JSON editor framing.

This keeps the graph interaction model custom while still using one UI system
for standard controls.

## Migration Plan

### Phase 0: Inventory And Guardrails

Create an executable inventory of legacy UI usage:

- raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>`;
- legacy classes `btn`, `card`, `badge`, `alert`, `modal`, `filter`,
  `mobile`, and route UI classes;
- local visual inline styles;
- imports of custom generic controls.

Add architecture tests with an allowlist. The allowlist starts with the current
legacy files. Every migration removes files from the allowlist.

Done means:

- the inventory command is documented;
- architecture tests fail when new legacy usage is introduced outside the
  allowlist;
- `repo:drift-check` still reports zero violations unrelated to existing
  tracked debt.

### Phase 1: Complete The Primitive Layer

Add missing shadcn primitives and normalize existing ones.

Required work:

- add `Label`;
- add `Alert`;
- add `AlertDialog`;
- add `Sheet`;
- add `Table`;
- add `Skeleton`;
- add `RadioGroup`;
- add a documented `Command + Popover` combobox pattern for searchable
  selectors;
- ensure `Select`, `DropdownMenu`, `ContextMenu`, `Popover`, and `Tooltip`
  keep the shadcn default `z-50` layer;
- ensure any temporary legacy modal overlay is below `z-50` until it is
  replaced by shadcn `Dialog`.

Done means:

- primitive tests verify portal layering;
- typecheck passes;
- primitives have consistent imports from `src/web/components/ui/**`.
- primitive APIs cover every replacement listed in the Native Replacement
  Policy, or the slice explicitly adds the missing primitive before using it.

### Phase 2: Overlay Shell Migration

Migrate custom overlay shells first because they are the highest-risk source of
focus, keyboard, and portal bugs.

Migration targets:

- `CenteredModal` -> `Dialog`;
- `DeleteConfirmModal` -> `AlertDialog`;
- `ChangeKeyModal` -> `Dialog`;
- `MobileDrawer` -> `Sheet`;
- `MobileFilterSheet` -> `Sheet`;
- `SearchModal` -> `CommandDialog` or `Command` inside `Dialog`;
- `NotificationPanel` -> `Popover` or `DropdownMenu`.

Rules:

- preserve existing public workflow behavior;
- use Radix focus management instead of body-scroll and escape-key code in
  custom components;
- remove migrated legacy CSS selectors in the same slice when possible.

Done means:

- select/dropdown/popover components work inside every migrated overlay;
- keyboard close, focus return, and screen-reader labels are covered by tests;
- old overlay shell components are deleted or reduced to thin domain wrappers
  with no custom interaction logic.
- migrated overlays do not use legacy `modal-*` classes or page-local visual
  styles.

### Phase 3: Forms And Inputs

Migrate page forms from raw controls and `ModernSelect`.

Replacement map:

```text
raw button       -> Button / ButtonGroup
raw input        -> Input
raw textarea     -> Textarea
raw checkbox     -> Checkbox
raw select       -> Select
ModernSelect     -> Select or Command+Popover combobox
boolean card     -> Switch or Checkbox with Label
field label div  -> Label
```

Priority order:

1. `Tokens.tsx`;
2. `Sites.tsx`;
3. `DownstreamKeyEditorModal.tsx`;
4. `Settings.tsx`;
5. `Accounts.tsx`;
6. `ModelTester.tsx`;
7. route graph node and inspector forms.

Done means:

- no raw form controls remain in migrated files except unavoidable native
  date/time/file controls;
- no `ModernSelect` import remains in migrated files;
- form tests cover save/cancel, disabled states, validation errors, and
  searchable selectors.
- form field surfaces use shadcn primitive classes such as `bg-background`,
  not business CSS selectors that set background, border, radius, or color.

### Phase 4: Data Display

Migrate static display surfaces.

Replacement map:

```text
.card        -> Card
.badge       -> Badge
.alert       -> Alert
.info-tip    -> Alert
.skeleton    -> Skeleton
.data-table  -> Table
empty-state  -> EmptyState domain component using shadcn primitives
```

Priority order:

1. token and site tables;
2. downstream key tables and drawers;
3. proxy logs and check-in logs;
4. dashboard cards;
5. marketplace/model tables;
6. settings panels.

Done means:

- migrated tables use one table primitive;
- badge semantics are domain components when status-specific;
- legacy CSS families are removed as their last usage disappears.
- card, badge, alert, skeleton, and table visuals come from shadcn primitives,
  not copied legacy CSS.

### Phase 5: Route Graph Editor

Migrate graph editor standard UI while preserving XYFlow-specific styling.

Required work:

- left library uses `Card`, `Button`, `Tabs`, `ScrollArea`, and `Command`;
- top toolbar uses `ButtonGroup`, `DropdownMenu`, and `Badge`;
- right/floating inspector uses shadcn tabs, cards, inputs, selects, switches,
  tooltips, and buttons;
- context menu uses `ContextMenu`;
- command palette uses `Command`;
- diagnostics use `Alert` or a compact domain list composed from shadcn
  primitives;
- graph JSON editors use `Textarea` inside `Card`/`Tabs`.

Done means:

- selecting, multi-selecting, dragging, linking ports, opening context menus,
  opening inspector popovers, and editing JSON are covered by UI tests;
- graph node/edge/port CSS remains only for canvas-specific visuals;
- standard controls inside the graph no longer depend on custom CSS classes.

### Phase 6: Legacy CSS Removal

Remove legacy global selectors in batches:

1. button family;
2. modal family;
3. card family;
4. badge family;
5. alert/info-tip family;
6. skeleton family;
7. filter/mobile helper families after sheet migration;
8. route wizard/editor families after route graph migration.

Done means:

- architecture tests have no allowlist for removed families;
- `rg` finds no usage of removed classes;
- visual regression screenshots cover the affected pages.

## Testing Strategy

Each migration slice must include tests at the correct level.

### Unit Tests

Primitive and helper tests:

- variant class generation;
- portal layering;
- controlled/uncontrolled value behavior;
- accessibility labels where renderable without a browser;
- serialization helpers for form-backed domain components.

### Integration Tests

Page/component integration tests:

- dialogs open and close;
- forms preserve values;
- validation errors render;
- selects and comboboxes update state;
- batch action bars preserve selection;
- migrated table rows still trigger the same actions;
- route graph inspector edits update graph state.

### Browser/E2E Tests

Browser tests are required for portal, focus, drag, resize, and graph
interaction behavior:

- select inside dialog is visible above the dialog;
- dropdown inside route graph inspector is visible above the inspector;
- context menu opens at the pointer location;
- command palette can search and execute actions;
- sheet opens on mobile viewport and returns focus when closed;
- route graph ports can be linked;
- node dragging does not open inspector accidentally;
- resizable panels expand/collapse correctly.

### Visual Checks

For migrated high-density pages:

- desktop screenshot;
- mobile screenshot;
- dark mode screenshot;
- modal/dropdown-open screenshot;
- route graph canvas screenshot when applicable.

## Rollout Rules

Migration should proceed in atomic vertical slices:

```text
one primitive or one workflow
  -> tests
  -> remove local legacy usage
  -> remove or shrink allowlist entry
```

Do not migrate a whole page if the page contains several independent workflow
families. Split it into:

- overlay shell;
- form controls;
- table/list display;
- mobile surface;
- route graph surface if applicable.

Do not keep duplicate controls after a slice. If a workflow has both legacy and
shadcn versions, the slice is not complete.

## Acceptance Criteria

The migration is complete when:

- no top-level page imports `ModernSelect`, `CenteredModal`, `MobileDrawer`,
  `MobileFilterSheet`, or any new custom generic primitive;
- no non-allowlisted page uses legacy UI classes;
- no page-local visual inline styles remain outside documented exceptions;
- all standard controls come from `src/web/components/ui/**`;
- route graph uses shadcn for all standard controls and custom CSS only for
  graph-specific node/edge/port rendering;
- overlay primitives use shadcn/Tailwind default layering without custom
  z-index variables;
- typecheck, unit tests, integration tests, architecture tests, drift check,
  and browser smoke tests pass.

## Consequences

Benefits:

- consistent keyboard and focus behavior;
- fewer portal and z-index bugs;
- less global CSS drift;
- easier dark-mode correctness;
- simpler UI tests because primitives behave consistently;
- clearer separation between UI primitives and domain components.

Costs:

- migration touches many files;
- some tests that snapshot legacy structure must be rewritten around behavior;
- route graph needs careful treatment so graph-specific visuals are not forced
  into generic components;
- old CSS removal must be sequenced to avoid breaking dirty worktree changes.

## Open Questions

- Whether to keep the current toast implementation or migrate to a shadcn-native
  toast/sonner primitive.
- Whether mobile cards should become a domain component built on `Card` or be
  replaced by responsive table/list patterns per page.
- Whether charts should receive a small shadcn-framed chart panel component or
  remain page-local because chart libraries own most of their rendering.
