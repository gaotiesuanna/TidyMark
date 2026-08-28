# TidyMark White Index Redesign

Date: 2026-08-27

## Goal

Redesign the complete TidyMark side panel so it has a recognizable visual and structural identity without losing the quiet white interface the user already prefers.

The chosen direction is a **white index book**: white surfaces, cool-gray hairlines, compact indexed rows, restrained corners, and blue used only for active or selected state. The redesign covers AI organization, local cleanup, bookmark browsing, dashboard, settings, progress, results, and error states.

## Success Criteria

- The product no longer reads as a generic soft-card AI interface.
- White backgrounds and fine-line separation remain the dominant visual language.
- All four main modes share one stable navigation and component system.
- Dense bookmark information remains easy to scan in a narrow Chrome side panel.
- Existing safety, permission, preview, confirmation, undo, and retry behaviors remain intact.
- Important paths, titles, and URLs remain readable instead of being hidden by unnecessary truncation.
- The redesign introduces no remote fonts or large UI framework dependency.

## Non-Goals

- Changing bookmark analysis, classification, cleanup, import, export, or history semantics.
- Changing stored data formats or background message contracts unless a view boundary requires a typed presentation adapter.
- Adding dark mode. This design intentionally uses a white theme.
- Adding decorative animation, gradients, glass effects, or illustration assets.
- Rewriting product copy beyond the small labels required by the new navigation and component structure.

## Visual Language

### Color

- Page and component surfaces are white.
- Cool-gray hairlines separate navigation, sections, rows, and form groups.
- Neutral text uses a compact hierarchy of primary, secondary, and metadata tones.
- Blue is reserved for the current mode, current step, selected items, progress, links, and focus.
- Red, amber, and green remain semantic status colors only.

### Shape and Depth

- Standard component radius is 8-10px.
- Pill shapes are limited to controls whose interaction is genuinely binary or segmented.
- Hairline borders and spacing create hierarchy. Shadows are not a default container treatment.
- Nested cards are removed where indentation, a left rule, or a section divider communicates the relationship more clearly.

### Typography

- Use the existing offline system sans-serif stack for Chinese and general interface copy.
- Use the existing system monospace stack for index numbers, counts, paths, and technical metadata.
- Preserve the compact type scale, but make hierarchy consistent across page titles, section titles, row titles, descriptions, and metadata.
- Default indexed row height is 42px. Rows containing required secondary information may grow naturally rather than clipping content.

## Information Architecture

### Primary Navigation

Replace the soft segmented control with one persistent top index bar:

1. `01 AI 整理`
2. `02 本地清理`
3. `03 浏览书签`
4. `04 看板`

The active mode uses blue text, increased weight, and a bottom rule. Inactive modes remain plain text on white. Settings remains at the right edge of the same bar and uses the same focus and hover language.

At widths where full labels cannot fit, labels may shorten while the two-digit indices remain visible. The navigation must remain one row and must not horizontally scroll.

### Page Anatomy

Every mode follows the same structure:

1. Page title and one short functional description.
2. One or more indexed sections separated by hairlines.
3. Contextual loading, empty, error, or success state inside its owning section.
4. A sticky bottom action bar only when the page has primary actions.

## Organize Flow

AI organization remains a safe guided flow, but its secondary navigation changes from a second horizontal strip to a vertical numbered index in the content area.

- Completed steps collapse into a concise summary.
- The active step expands to show its controls and data.
- Future steps show only their number and title.
- Existing step order, validation, preview, confirmation, progress, cancellation, result, and undo behavior remains unchanged.
- Back and reset actions stay available at the same logical decision points even if their visual placement changes.

## Local Cleanup

Duplicate bookmarks, dead links, empty folders, and stale bookmarks become sibling indexed sections instead of nested card surfaces.

- Section headers expose counts and state.
- Expanding one cleanup section does not erase results already scanned in another section.
- Dense result sets use 42px indexed rows where possible.
- Long title, path, URL, and explanation content wraps when it is necessary to understand the item.
- Destructive actions keep explicit selection and confirmation behavior.

## Bookmark Browser

Search remains the primary entry point.

- Search, bookmark tree, import, and export are distinct indexed sections.
- Folder depth is communicated with indentation and fine guide rules.
- Import and export choices use line-separated option groups instead of stacks of soft cards.
- Existing search, selection, file handling, import preview, and export behavior remains unchanged.

## Dashboard

Domain rows become numbered index rows with favicon, domain, compact measure, total, and disclosure control.

- In bookmark mode, expansion shows full folder path, bookmark count, bookmark title, and normalized URL.
- In visit mode, expansion shows page title, normalized URL, and visit count in descending order.
- Expanded content sits directly below the source row and uses indentation plus a left rule.
- Only one domain is expanded at a time within a list.
- Links open the original page in a new tab.

## Settings

Settings uses numbered sections for model connections, language, privacy, and other options.

- Endpoint configuration retains card semantics because each endpoint is an independent editable object.
- Endpoint cards adopt the white index border, radius, typography, and action hierarchy.
- Form labels remain above or immediately associated with their fields.
- Secret values, model tests, add/remove endpoint behavior, and language behavior remain unchanged.

## Component System

Create a small side-panel design layer rather than repeating long utility strings in every feature.

Core primitives:

- `IndexNavigation`: the four-mode top navigation and settings action.
- `PageHeader`: title and concise description.
- `IndexSection`: numbered section header, optional count, disclosure state, and body.
- `IndexRow`: compact row grid with index, leading visual, primary content, metadata, trailing value, and optional disclosure.
- `StepIndex`: vertical organize-flow progress and summaries.
- `SegmentedChoice`: binary or small local state switching without imitating the primary navigation.
- `PrimaryButton`, `SecondaryButton`, and `DangerButton`.
- `Field`, `SelectField`, and grouped form controls.
- `InlineStatus`: loading, empty, success, warning, and error presentation.
- `StickyActionBar`: stable page-level primary actions.

The primitives should accept semantic content and state, not feature-specific data models. Feature components remain responsible for adapting their data into these primitives.

## Interaction Rules

- Expandable rows share one disclosure icon, hover state, pressed state, and focus treatment.
- Same-level accordion lists keep at most one row open unless a workflow explicitly requires multiple open sections.
- Expanded content uses indentation and a left rule instead of an additional enclosing card.
- Primary actions use a dark solid treatment; secondary actions use white with a hairline border.
- Dangerous actions use red text and border and do not become a large filled red area by default.
- Motion is limited to short color and disclosure-icon transitions and respects reduced-motion preferences.

## Responsive and Overflow Behavior

- The design targets the narrow Chrome side-panel width first.
- Top navigation stays on one line and shortens labels before it overflows.
- Indexed row grids reserve stable columns for index, icon, count, and disclosure while allowing the title column to shrink.
- Paths and URLs wrap when the full value is important.
- Incidental domain labels may truncate only when a title attribute or adjacent detail makes the full value recoverable.
- Sticky action bars must not hide the final content row.

## Accessibility

- Preserve a document-level `h1` for screen-reader navigation.
- Use `aria-current` for the active primary mode or active organize step where appropriate.
- Use `aria-expanded` and descriptive labels for disclosure controls.
- Maintain visible keyboard focus on every interactive control.
- Body text and form metadata must meet WCAG AA contrast against white.
- Color is never the only active, selected, warning, or error signal.
- Existing permission explanations remain before any browser permission request.

## Technical Strategy

Use a design-system-first migration:

1. Add semantic visual tokens and shared primitives.
2. Replace the application shell and primary navigation.
3. Migrate common buttons, fields, status messages, and action bars.
4. Migrate AI organization screens.
5. Migrate local cleanup.
6. Migrate bookmark browsing.
7. Migrate the dashboard.
8. Migrate settings, progress, results, and remaining edge states.

Feature behavior should be moved only when the existing component boundary prevents semantic reuse. Avoid broad data-layer refactoring during the visual migration.

## Error and State Handling

- Loading state appears inside the section that initiated work.
- Empty state explains what is absent and, when applicable, the next action.
- Recoverable errors appear inline with a retry action.
- Global background errors remain announced with `role="alert"` but use the new line-based status treatment.
- Busy state continues to prevent invalid mode changes and destructive duplicate actions.
- Permission-denied and permission-not-requested states remain distinct.

## Testing and Verification

- Add interaction tests for the new primary navigation and vertical organize step index.
- Preserve existing behavior tests while updating queries only when accessible labels intentionally change.
- Add shared primitive tests for disclosure, keyboard focus, disabled state, and semantic attributes where the primitive owns behavior.
- Test bookmark and visit dashboard expansion in the redesigned row structure.
- Test narrow-width navigation labels and long path or URL wrapping behavior.
- Run the complete Vitest suite and the production TypeScript/Vite build.
- Manually inspect representative screens for all four modes, settings, loading, empty, error, success, and long-content states.

## Acceptance Criteria

- All four modes use the numbered top index navigation.
- Organize steps no longer appear as a second horizontal navigation strip.
- Primary containers use the white index border and radius system.
- Common interactive elements use shared primitives instead of divergent feature-local style strings.
- The dashboard retains bookmark-folder and visit-page expansion behavior.
- No existing permission, confirmation, undo, retry, import, export, or cleanup behavior regresses.
- The extension remains fully functional without network-loaded visual dependencies.
- Automated tests and the production build pass.
