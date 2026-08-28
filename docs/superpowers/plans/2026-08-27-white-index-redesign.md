# TidyMark White Index Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TidyMark's generic soft-card side-panel UI with the approved compact “white index book” system across every mode, while preserving all existing workflows and the new dashboard detail expansions.

**Architecture:** Add a small presentation-only component layer (`IndexNavigation`, `PageHeader`, `IndexSection`, `IndexRow`, `StepIndex`, controls, statuses, and action bar), then migrate feature screens one bounded area at a time. Existing Zustand state, background messages, browser permissions, bookmark/history data types, and business logic remain authoritative; feature components only adapt their current data into the new primitives.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 3, Zustand, Vitest, Testing Library, Vite, Chrome Extension APIs.

**Spec:** `docs/superpowers/specs/2026-08-27-white-index-redesign-design.md`

## Global Constraints

- Preserve the current working-tree dashboard work in `src/core/domains.ts`, `src/sidepanel/lib/visits.ts`, `src/sidepanel/steps/DashboardStep.tsx`, their locale strings, and their tests. Those changes implement the approved folder/bookmark and visit-page disclosure behavior and must be incorporated, not reset or overwritten.
- Do not change store semantics, browser permission timing, background message contracts, bookmark mutation semantics, import/export formats, undo behavior, retry behavior, or cleanup confirmation rules.
- Keep one document-level `h1`, visible focus states, `aria-current`, `aria-expanded`, `role="alert"`, and existing accessible names unless the plan explicitly changes them.
- Use no remote fonts, new UI framework, gradients, glass effects, decorative illustrations, or default container shadows.
- Target the narrow Chrome side panel first. The four primary modes must remain on one row without horizontal scrolling; full labels may visually shorten while accessible names remain complete.
- Default data-row minimum height is 42px. Important paths and URLs wrap; incidental labels may truncate only when the complete value remains available through detail content or a `title` attribute.
- Run the focused test named in every red/green cycle before proceeding. Commit only the files named by that task and never sweep unrelated dirty files into a commit.

---

## Task 1: Establish semantic tokens and common controls

**Files:**

- Modify: `src/sidepanel/index.css`
- Modify: `tailwind.config.js`
- Modify: `src/sidepanel/components/buttonStyles.ts`
- Create: `src/sidepanel/components/IndexControls.tsx`
- Create: `tests/sidepanel/IndexControls.test.tsx`
- Modify: `tests/sidepanel/typographyTokens.test.ts`

**Interfaces:**

- `buttonStyles.ts` continues exporting `primaryButton`, `secondaryButton`, `filePickerButton`, `segmentTrack`, `segmentButton`, `segmentActive`, `choiceRow`, and `choiceList` so existing imports compile during migration.
- It additionally exports `dangerButton`, `fieldClass`, `fieldLabelClass`, `focusRing`, and `stickyActionBar` as complete Tailwind class strings.
- `IndexControls.tsx` exports:

```tsx
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

export function PrimaryButton(props: ButtonProps): React.JSX.Element
export function SecondaryButton(props: ButtonProps): React.JSX.Element
export function DangerButton(props: ButtonProps): React.JSX.Element

export function SegmentedChoice<T extends string>(props: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  disabled?: boolean
  onChange: (value: T) => void
}): React.JSX.Element

export function StickyActionBar(props: {
  children: React.ReactNode
}): React.JSX.Element
```

- `SegmentedChoice` owns `role="group"`, pressed state, and disabled behavior; it is for local binary/small choices only, never primary navigation.

- [ ] **Step 1: Add failing tests for semantic tokens and control behavior**

```tsx
it('exposes white-index color and geometry tokens', () => {
  expect(css).toContain('--index-line:')
  expect(css).toContain('--index-blue:')
  expect(css).toContain('--index-radius:')
  expect(css).toContain('--index-row-min-height: 42px')
})

it('reports the selected segmented choice accessibly', async () => {
  const onChange = vi.fn()
  render(<SegmentedChoice label="数据类型" value="bookmarks" options={options} onChange={onChange} />)
  expect(screen.getByRole('button', { name: '书签' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: '访问' }))
  expect(onChange).toHaveBeenCalledWith('visits')
})
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- tests/sidepanel/IndexControls.test.tsx tests/sidepanel/typographyTokens.test.ts`

Expected: FAIL because the new component and CSS variables do not exist.

- [ ] **Step 3: Add the white-index tokens and shared controls**

Add semantic variables without removing the existing font variables:

```css
:root {
  --index-canvas: #ffffff;
  --index-ink: #18181b;
  --index-muted: #71717a;
  --index-faint: #a1a1aa;
  --index-line: #e4e4e7;
  --index-line-strong: #d4d4d8;
  --index-blue: #2563eb;
  --index-blue-soft: #eff6ff;
  --index-radius: 9px;
  --index-row-min-height: 42px;
}
```

Implement controls as thin semantic wrappers. Preserve `className` extension and native button props:

```tsx
export function PrimaryButton({ className = '', ...props }: ButtonProps) {
  return <button className={`${primaryButton} ${className}`} {...props} />
}

export function SegmentedChoice<T extends string>({ label, value, options, disabled, onChange }: SegmentedChoiceProps<T>) {
  return (
    <div role="group" aria-label={label} className={segmentTrack}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          className={`${segmentButton} ${value === option.value ? segmentActive : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
```

Style primary actions dark, secondary actions white with hairline borders, danger actions as red text/border, and all focus treatments with a visible blue ring. Remove shadows and excessive pills from shared classes.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/sidepanel/IndexControls.test.tsx tests/sidepanel/typographyTokens.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the design foundation**

```bash
git add src/sidepanel/index.css tailwind.config.js src/sidepanel/components/buttonStyles.ts src/sidepanel/components/IndexControls.tsx tests/sidepanel/IndexControls.test.tsx tests/sidepanel/typographyTokens.test.ts
git commit -m "feat: add white index design foundation"
```

---

## Task 2: Build the indexed layout primitives

**Files:**

- Create: `src/sidepanel/components/PageHeader.tsx`
- Create: `src/sidepanel/components/IndexSection.tsx`
- Create: `src/sidepanel/components/IndexRow.tsx`
- Create: `src/sidepanel/components/InlineStatus.tsx`
- Create: `tests/sidepanel/IndexPrimitives.test.tsx`

**Interfaces:**

```tsx
export function PageHeader(props: {
  title: string
  description?: string
  meta?: React.ReactNode
}): React.JSX.Element

export function IndexSection(props: {
  index: string
  title: string
  count?: React.ReactNode
  expanded?: boolean
  onToggle?: () => void
  children?: React.ReactNode
}): React.JSX.Element

export function IndexRow(props: {
  index: string
  leading?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  measure?: React.ReactNode
  value?: React.ReactNode
  expanded?: boolean
  disclosureLabel?: string
  onToggle?: () => void
  children?: React.ReactNode
}): React.JSX.Element

export function InlineStatus(props: {
  tone: 'neutral' | 'progress' | 'success' | 'warning' | 'error'
  title?: string
  children: React.ReactNode
  action?: React.ReactNode
  live?: 'polite' | 'assertive'
}): React.JSX.Element
```

`IndexSection` and `IndexRow` render a native button only when `onToggle` exists. Their button carries `aria-expanded`; their body is rendered directly beneath with indentation and a left rule, not in a nested card. `IndexRow` has `min-height: var(--index-row-min-height)` and does not clip descriptions.

- [ ] **Step 1: Write failing primitive tests**

```tsx
it('renders an expandable index row with a direct detail region', async () => {
  const onToggle = vi.fn()
  render(
    <IndexRow index="01" title="github.com" expanded disclosureLabel="展开 github.com" onToggle={onToggle}>
      <a href="https://github.com/openai">OpenAI repository</a>
    </IndexRow>,
  )
  expect(screen.getByRole('button', { name: '展开 github.com' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('link', { name: 'OpenAI repository' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '展开 github.com' }))
  expect(onToggle).toHaveBeenCalledOnce()
})

it('announces assertive error status', () => {
  render(<InlineStatus tone="error" live="assertive">请求失败</InlineStatus>)
  expect(screen.getByText('请求失败')).toHaveAttribute('aria-live', 'assertive')
})
```

- [ ] **Step 2: Confirm the new tests fail**

Run: `npm test -- tests/sidepanel/IndexPrimitives.test.tsx`

Expected: FAIL with missing component modules.

- [ ] **Step 3: Implement the primitives**

Use grid columns that reserve index, leading visual, measure/value, and disclosure space while leaving the title column as `minmax(0, 1fr)`. Generate a stable detail id with `useId()` and connect the disclosure button with `aria-controls`.

```tsx
const detailId = useId()
const content = (
  <>
    <span className="font-mono text-xs text-neutral-400">{index}</span>
    {leading && <span className="shrink-0">{leading}</span>}
    <span className="min-w-0">{title}{description && <span className="mt-0.5 block break-words">{description}</span>}</span>
    {measure}
    {value}
  </>
)
```

Keep the heading hierarchy feature-owned: `PageHeader` renders `h2`, `IndexSection` renders `h3`, and rows do not invent headings.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/sidepanel/IndexPrimitives.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the primitives**

```bash
git add src/sidepanel/components/PageHeader.tsx src/sidepanel/components/IndexSection.tsx src/sidepanel/components/IndexRow.tsx src/sidepanel/components/InlineStatus.tsx tests/sidepanel/IndexPrimitives.test.tsx
git commit -m "feat: add indexed layout primitives"
```

---

## Task 3: Replace the shell with numbered primary navigation and a vertical step index

**Files:**

- Create: `src/sidepanel/components/IndexNavigation.tsx`
- Create: `src/sidepanel/components/StepIndex.tsx`
- Modify: `src/sidepanel/components/Shell.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`
- Create: `tests/sidepanel/StepIndex.test.tsx`
- Modify: `tests/sidepanel/Shell.test.tsx`

**Interfaces:**

```tsx
export type IndexNavigationItem<K extends string> = {
  key: K
  index: string
  label: string
  shortLabel: string
}

export function IndexNavigation<K extends string>(props: {
  items: readonly IndexNavigationItem<K>[]
  activeKey: K
  disabled?: boolean
  settingsLabel: string
  onSelect: (key: K) => void
  onOpenSettings: () => void
}): React.JSX.Element

export type StepIndexItem<K extends string> = {
  key: K
  index: string
  label: string
  summary?: React.ReactNode
}

export function StepIndex<K extends string>(props: {
  items: readonly StepIndexItem<K>[]
  currentKey: K
  children: React.ReactNode
}): React.JSX.Element
```

`StepIndex` places `children` inside the current step body. Completed items show `summary` when provided; future items show only index and title. It is progress, not arbitrary navigation, so its rows are not buttons.

`App` passes the active organize screen through `Shell` into the current vertical step. Add `structure` to the five-item step definition; add `shellStepStructure` translations.

- [ ] **Step 1: Rewrite shell expectations and add failing step-index tests**

```tsx
expect(screen.getByRole('tab', { name: '01 AI 整理' })).toHaveAttribute('aria-selected', 'true')
expect(screen.getByRole('tab', { name: '02 本地清理' })).toBeEnabled()
expect(screen.getByRole('tab', { name: '03 浏览书签' })).toBeEnabled()
expect(screen.getByRole('tab', { name: '04 看板' })).toBeEnabled()

render(<StepIndex items={items} currentKey="structure"><div>结构编辑器</div></StepIndex>)
expect(screen.getByText('结构编辑器')).toBeVisible()
expect(screen.getByText('03 确认结构')).toHaveAttribute('aria-current', 'step')
expect(screen.getByText('01 选择范围')).toBeVisible()
```

Also assert settings replaces navigation with a line-based back header, and busy state disables all four primary tabs.

- [ ] **Step 2: Confirm tests fail against the segmented shell**

Run: `npm test -- tests/sidepanel/Shell.test.tsx tests/sidepanel/StepIndex.test.tsx`

Expected: FAIL because numbered labels, the structure step, and vertical current-step body do not exist.

- [ ] **Step 3: Implement navigation and flow composition**

Use `role="tablist"`/`role="tab"` for the four modes, but render a white single-line bar with active blue text and bottom rule. Provide full text through `aria-label`; render long/short spans controlled by narrow-width CSS so the row never scrolls.

Move organize rendering into the step index without changing the store:

```tsx
const organizeContent =
  step === 'scope' ? <ScopeStep /> :
  step === 'preferences' ? <PreferencesStep /> :
  step === 'structure' ? <StructureStep /> :
  step === 'review' ? <ReviewStep /> :
  <ResultStep />

return (
  <Shell key={locale} organizeContent={organizeContent}>
    {mode === 'cleanup' ? <CleanupStep /> : mode === 'transfer' ? <TransferStep /> : <DashboardStep />}
  </Shell>
)
```

If a smaller API avoids duplicating existing progress placement, use `Shell({ children })` and wrap only the organize branch in `App`; the externally observable requirement is that `StepIndex` owns the vertical step layout and the active screen appears inside it.

- [ ] **Step 4: Run shell and app-adjacent tests**

Run: `npm test -- tests/sidepanel/Shell.test.tsx tests/sidepanel/StepIndex.test.tsx tests/sidepanel/App.test.tsx`

Expected: PASS. If `App.test.tsx` does not exist, omit it rather than creating an empty test file.

- [ ] **Step 5: Commit the new application frame**

```bash
git add src/sidepanel/components/IndexNavigation.tsx src/sidepanel/components/StepIndex.tsx src/sidepanel/components/Shell.tsx src/sidepanel/App.tsx public/_locales/en/messages.json public/_locales/zh_CN/messages.json tests/sidepanel/StepIndex.test.tsx tests/sidepanel/Shell.test.tsx
git commit -m "feat: replace shell with indexed navigation"
```

---

## Task 4: Migrate the complete AI organize flow

**Files:**

- Modify: `src/sidepanel/steps/ScopeStep.tsx`
- Modify: `src/sidepanel/steps/PreferencesStep.tsx`
- Modify: `src/sidepanel/steps/StructureStep.tsx`
- Modify: `src/sidepanel/steps/ReviewStep.tsx`
- Modify: `src/sidepanel/steps/ResultStep.tsx`
- Modify: `src/sidepanel/components/Detail.tsx`
- Modify: `src/sidepanel/components/ResultTree.tsx`
- Modify: `tests/sidepanel/ScopeStep.test.tsx`
- Modify: `tests/sidepanel/PreferencesStep.test.tsx`
- Modify: `tests/sidepanel/StructureStep.test.tsx`
- Modify: `tests/sidepanel/ReviewStep.test.tsx`
- Modify: `tests/sidepanel/ResultStep.test.tsx`
- Create: `tests/sidepanel/Detail.test.tsx`
- Create: `tests/sidepanel/ResultTree.test.tsx`

**Interfaces:**

- No state/store or background-message interface changes.
- Each step keeps its existing exported component name and props.
- Each screen composes `PageHeader`, numbered `IndexSection`s, shared controls, and `StickyActionBar`.
- `Detail` becomes a line-based key/value disclosure presentation and `ResultTree` becomes an indexed, indented tree; their public props remain unchanged.

- [ ] **Step 1: Add presentation assertions to each existing behavior suite**

Add only resilient semantic assertions, for example:

```tsx
expect(screen.getByRole('heading', { name: '选择整理范围' })).toBeVisible()
expect(screen.getByTestId('scope-section')).toHaveAttribute('data-index', '01')
expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled()
```

For preferences, structure, review, and result, assert the expected numbered section, existing primary action, and existing back/reset/undo action. Keep every current validation, preview, mutation, cancellation, and undo assertion intact.

- [ ] **Step 2: Run organize-flow tests and confirm the new presentation assertions fail**

Run: `npm test -- tests/sidepanel/ScopeStep.test.tsx tests/sidepanel/PreferencesStep.test.tsx tests/sidepanel/StructureStep.test.tsx tests/sidepanel/ReviewStep.test.tsx tests/sidepanel/ResultStep.test.tsx tests/sidepanel/Detail.test.tsx tests/sidepanel/ResultTree.test.tsx`

Expected: FAIL only on the new indexed-layout assertions and missing new component test contracts.

- [ ] **Step 3: Migrate scope and preferences**

Replace outer soft cards with `PageHeader` and sibling `IndexSection`s. Use line-separated `choiceRow` inputs and shared fields. Keep permission explanations immediately before their request actions and preserve all controlled values.

- [ ] **Step 4: Migrate structure and review**

Render proposed folders and bookmark moves as compact indexed rows. Preserve reorder/edit/approval behavior. Let long bookmark titles and destinations wrap instead of applying blanket `truncate`.

- [ ] **Step 5: Migrate result, details, and result tree**

Use semantic success/warning/error `InlineStatus` blocks, hairline tree guides, and indexed rows. Preserve undo availability and result counts.

- [ ] **Step 6: Run the full organize-flow test group**

Run the command from Step 2 plus `npm test -- tests/sidepanel/Shell.test.tsx`.

Expected: PASS with unchanged behavioral assertions.

- [ ] **Step 7: Commit the organize-flow migration**

```bash
git add src/sidepanel/steps/ScopeStep.tsx src/sidepanel/steps/PreferencesStep.tsx src/sidepanel/steps/StructureStep.tsx src/sidepanel/steps/ReviewStep.tsx src/sidepanel/steps/ResultStep.tsx src/sidepanel/components/Detail.tsx src/sidepanel/components/ResultTree.tsx tests/sidepanel/ScopeStep.test.tsx tests/sidepanel/PreferencesStep.test.tsx tests/sidepanel/StructureStep.test.tsx tests/sidepanel/ReviewStep.test.tsx tests/sidepanel/ResultStep.test.tsx tests/sidepanel/Detail.test.tsx tests/sidepanel/ResultTree.test.tsx
git commit -m "feat: migrate organize flow to white index layout"
```

Before committing, inspect `git diff --cached --name-only`; unstage any unrelated dashboard tests or previously dirty files not changed in this task.

---

## Task 5: Migrate local cleanup without changing destructive behavior

**Files:**

- Modify: `src/sidepanel/steps/CleanupStep.tsx`
- Modify: `src/sidepanel/components/StaleCleanupSection.tsx`
- Modify: `src/sidepanel/components/ProgressPanel.tsx`
- Modify: `tests/sidepanel/CleanupStep.test.tsx`
- Create: `tests/sidepanel/StaleCleanupSection.test.tsx`
- Modify: `tests/sidepanel/ProgressPanel.test.tsx`

**Interfaces:**

- Keep all existing component props and store actions.
- Represent duplicate bookmarks, dead links, empty folders, and stale bookmarks as sibling `IndexSection`s with stable indices `01`–`04`.
- Each section owns its loading, empty, error, count, and expanded content state. Existing per-section results remain mounted when another section expands.
- Destructive selection and confirmation controls keep their current names and invocation order.

- [ ] **Step 1: Extend cleanup tests with indexed-section and retained-state assertions**

```tsx
expect(screen.getByRole('heading', { name: /重复书签/ })).toBeVisible()
expect(screen.getByRole('heading', { name: /失效链接/ })).toBeVisible()
expect(screen.getByRole('heading', { name: /空文件夹/ })).toBeVisible()
expect(screen.getByRole('heading', { name: /长期未访问/ })).toBeVisible()
```

Drive two scans through existing mocks, expand another section, and assert the first section's count/result remains available. Preserve assertions that deletion requires explicit selection/confirmation.

- [ ] **Step 2: Run focused cleanup tests and confirm failure**

Run: `npm test -- tests/sidepanel/CleanupStep.test.tsx tests/sidepanel/StaleCleanupSection.test.tsx tests/sidepanel/ProgressPanel.test.tsx`

Expected: FAIL on indexed section structure/state retention, while existing behavior tests still describe the required contract.

- [ ] **Step 3: Compose the four cleanup sections and local statuses**

Remove nested neutral card backgrounds. Put progress next to the section that initiated it and use `InlineStatus`; retain Shell-level progress only for work that has no owning result section. Use `DangerButton` for confirmed deletion actions and `SecondaryButton` for scan/cancel actions.

- [ ] **Step 4: Run cleanup tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit cleanup migration**

```bash
git add src/sidepanel/steps/CleanupStep.tsx src/sidepanel/components/StaleCleanupSection.tsx src/sidepanel/components/ProgressPanel.tsx tests/sidepanel/CleanupStep.test.tsx tests/sidepanel/StaleCleanupSection.test.tsx tests/sidepanel/ProgressPanel.test.tsx
git commit -m "feat: migrate cleanup to indexed sections"
```

---

## Task 6: Migrate bookmark browsing, import, and export

**Files:**

- Modify: `src/sidepanel/steps/TransferStep.tsx`
- Modify: `src/sidepanel/components/BookmarkTree.tsx`
- Modify: `src/sidepanel/components/ImportPanel.tsx`
- Modify: `src/sidepanel/components/ExportPanel.tsx`
- Modify: `tests/sidepanel/TransferStep.test.tsx`
- Modify: `tests/sidepanel/BookmarkTree.test.tsx`
- Modify: `tests/sidepanel/ImportPanel.test.tsx`
- Modify: `tests/sidepanel/ExportPanel.test.tsx`

**Interfaces:**

- Keep existing component props, file inputs, parsing, selection, preview, import, and export callbacks.
- Present `01 搜索`, `02 书签目录`, `03 导入`, and `04 导出` as distinct indexed sections.
- Folder depth is represented by indentation and a fine left guide. Search results and tree nodes use compact rows; URLs important to identification use `break-all`/`overflow-wrap:anywhere` rather than irreversible clipping.

- [ ] **Step 1: Add failing semantic layout tests while retaining all workflow tests**

```tsx
expect(screen.getByRole('heading', { name: '搜索' })).toBeVisible()
expect(screen.getByRole('heading', { name: '书签目录' })).toBeVisible()
expect(screen.getByRole('heading', { name: '导入' })).toBeVisible()
expect(screen.getByRole('heading', { name: '导出' })).toBeVisible()
```

In the tree test, assert nested folders expose depth through `data-depth` and disclosure buttons expose `aria-expanded`. In import/export tests, retain exact file and action assertions.

- [ ] **Step 2: Confirm focused tests fail**

Run: `npm test -- tests/sidepanel/TransferStep.test.tsx tests/sidepanel/BookmarkTree.test.tsx tests/sidepanel/ImportPanel.test.tsx tests/sidepanel/ExportPanel.test.tsx`

Expected: FAIL on the new index structure; existing behavior remains the specification.

- [ ] **Step 3: Migrate transfer composition and tree**

Remove the sticky soft segmented card. Import and export are explicit sections, with local `SegmentedChoice` only if a binary sub-choice still exists inside one section. Use `IndexRow` or equivalent tree-row markup without flattening tree semantics.

- [ ] **Step 4: Migrate import/export option groups and action bars**

Use line-separated choices, shared form fields, and `StickyActionBar`. Add bottom padding equal to the action bar height so the last row is never obscured.

- [ ] **Step 5: Run transfer tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit the transfer migration**

```bash
git add src/sidepanel/steps/TransferStep.tsx src/sidepanel/components/BookmarkTree.tsx src/sidepanel/components/ImportPanel.tsx src/sidepanel/components/ExportPanel.tsx tests/sidepanel/TransferStep.test.tsx tests/sidepanel/BookmarkTree.test.tsx tests/sidepanel/ImportPanel.test.tsx tests/sidepanel/ExportPanel.test.tsx
git commit -m "feat: migrate bookmark browser to indexed layout"
```

---

## Task 7: Restyle the dashboard while preserving folder and page disclosures

**Files:**

- Modify: `src/sidepanel/steps/DashboardStep.tsx`
- Modify: `tests/sidepanel/DashboardStep.test.tsx`
- Preserve and include current working-tree changes in:
  - `src/core/domains.ts`
  - `src/sidepanel/lib/visits.ts`
  - `tests/core/domains.test.ts`
  - `public/_locales/en/messages.json`
  - `public/_locales/zh_CN/messages.json`

**Interfaces:**

- Bookmark domain data continues using the current expanded `FolderShare` representation containing folder path/count and bookmark details.
- Visit data continues using the current expanded `WeightedUrl` representation containing `url`, `title`, and count/weight.
- Dashboard mode stays `'bookmarks' | 'visits'` and uses `SegmentedChoice`.
- Domain rows use `IndexRow` with index, favicon, domain, compact measure, total, and disclosure.
- Only one domain is expanded at a time; clicking the open row closes it.
- Bookmark details render full folder path, bookmark count, bookmark title, and normalized URL. Visit details render title, normalized URL, and visit count sorted descending. Links retain their original target behavior.

- [ ] **Step 1: Update current disclosure tests to assert the indexed presentation**

Extend—do not replace—the existing current-working-tree tests:

```tsx
expect(screen.getByRole('button', { name: /展开 github\.com/ })).toHaveAttribute('aria-expanded', 'false')
await userEvent.click(screen.getByRole('button', { name: /展开 github\.com/ }))
expect(screen.getByText('Bookmarks Bar / NiceG / AI')).toBeVisible()
expect(screen.getByRole('link', { name: /OpenAI Agents SDK/ })).toHaveAttribute('href', expect.stringContaining('github.com'))
```

Add a two-domain test proving opening the second closes the first, and a visit-mode test proving page title, URL, and visit count appear in descending order.

- [ ] **Step 2: Run dashboard/domain tests and capture the intended failure**

Run: `npm test -- tests/sidepanel/DashboardStep.test.tsx tests/core/domains.test.ts`

Expected: Existing data/detail behavior passes; new indexed-row/accordion presentation assertions fail.

- [ ] **Step 3: Replace domain cards/rows with the shared primitives**

Use `PageHeader`, a single numbered `IndexSection`, `SegmentedChoice`, and `IndexRow`. Keep the existing expansion state/data computations. Put detail markup directly beneath the row:

```tsx
<IndexRow
  index={String(position + 1).padStart(2, '0')}
  leading={<Favicon domain={entry.domain} />}
  title={entry.domain}
  measure={<DomainMeasure value={entry.count} max={maxCount} />}
  value={<span className="font-mono tabular-nums">{entry.count}</span>}
  expanded={expandedDomain === entry.domain}
  disclosureLabel={t('dashboardToggleDomain', [entry.domain])}
  onToggle={() => setExpandedDomain((current) => current === entry.domain ? null : entry.domain)}
>
  {mode === 'bookmarks' ? <BookmarkDomainDetails entry={entry} /> : <VisitDomainDetails entry={entry} />}
</IndexRow>
```

If localization interpolation uses a different existing `t` signature, follow the repository's current helper rather than changing i18n architecture.

- [ ] **Step 4: Run dashboard and domain tests**

Run the command from Step 2.

Expected: PASS, including current folder/bookmark/page expansion tests.

- [ ] **Step 5: Commit dashboard behavior and visual integration together**

Because the protected disclosure implementation is currently uncommitted, include its exact files in this commit after reviewing the diff:

```bash
git add src/core/domains.ts src/sidepanel/lib/visits.ts src/sidepanel/steps/DashboardStep.tsx tests/core/domains.test.ts tests/sidepanel/DashboardStep.test.tsx public/_locales/en/messages.json public/_locales/zh_CN/messages.json
git diff --cached --check
git commit -m "feat: show indexed dashboard source details"
```

---

## Task 8: Migrate settings and endpoint configuration

**Files:**

- Modify: `src/sidepanel/components/SettingsPanel.tsx`
- Modify: `src/sidepanel/components/EndpointCard.tsx`
- Modify: `tests/sidepanel/SettingsPanel.test.tsx`
- Modify: `tests/sidepanel/EndpointCard.test.tsx`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`

**Interfaces:**

- Keep existing `SettingsPanel` and `EndpointCard` exports and all existing endpoint/store callbacks.
- Settings sections are numbered and cover model connections, language, privacy, and the remaining options present in the current implementation.
- Endpoint cards remain independent editable objects but adopt white background, hairline border, 9px radius, line-separated fields, and shared button hierarchy.
- Secret masking, model test status, endpoint add/remove, language remount, and persistence behavior remain unchanged.

- [ ] **Step 1: Add indexed settings assertions to current behavior tests**

```tsx
expect(screen.getByRole('heading', { name: /模型连接/ })).toBeVisible()
expect(screen.getByRole('heading', { name: /语言/ })).toBeVisible()
expect(screen.getByRole('heading', { name: /隐私/ })).toBeVisible()
```

Also assert each endpoint has a visible label/legend and its test/remove controls remain keyboard reachable. Retain secret-value and persistence tests.

- [ ] **Step 2: Run settings tests and confirm failure**

Run: `npm test -- tests/sidepanel/SettingsPanel.test.tsx tests/sidepanel/EndpointCard.test.tsx`

Expected: FAIL on the new section semantics only.

- [ ] **Step 3: Migrate settings and endpoint cards**

Compose `IndexSection`s in `SettingsPanel`. Reuse `fieldClass`, `fieldLabelClass`, shared controls, and `InlineStatus` in `EndpointCard`. Keep endpoint objects as the one justified bordered-card exception; do not wrap each field in another card.

- [ ] **Step 4: Run settings tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit settings migration**

```bash
git add src/sidepanel/components/SettingsPanel.tsx src/sidepanel/components/EndpointCard.tsx tests/sidepanel/SettingsPanel.test.tsx tests/sidepanel/EndpointCard.test.tsx public/_locales/en/messages.json public/_locales/zh_CN/messages.json
git commit -m "feat: migrate settings to indexed sections"
```

Stage locale files only when this task actually changed them.

---

## Task 9: Unify shell-level error and busy states, then audit obsolete styling

**Files:**

- Modify: `src/sidepanel/components/Shell.tsx`
- Modify: `tests/sidepanel/Shell.test.tsx`

**Interfaces:**

- Global errors remain `role="alert"`, hide while settings is open, and retain retry behavior.
- Busy state continues blocking invalid mode switches and duplicate destructive actions.
- Loading, empty, success, warning, and error states use `InlineStatus` within their owning section whenever possible.
- No externally consumed component/store signature changes.

- [ ] **Step 1: Add/retain global state tests**

In `Shell.test.tsx`, assert error content has `role="alert"`, retry remains callable, settings hides the unrelated alert, and returning restores it. Add a focus assertion for the retry button and verify disabled primary navigation while busy.

- [ ] **Step 2: Audit remaining generic visual patterns**

Run:

```bash
rg -n "shadow-(sm|md|lg)|rounded-(xl|2xl|3xl)|bg-neutral-50|bg-neutral-100" src/sidepanel
rg -n "truncate|overflow-hidden|whitespace-nowrap" src/sidepanel
```

Expected: The first command identifies only the intentionally retained segmented-choice track and endpoint boundaries; the second identifies only navigation labels whose full accessible name is present. Each intentional exception already has a short code comment beside the class.

- [ ] **Step 3: Migrate the shell alert and busy presentation**

Replace the filled red banner with a line-based `InlineStatus`-style alert that preserves `role="alert"`, message, and retry action. Keep settings suppression and busy navigation disabling unchanged. If the audit in Step 2 reports an unexpected pattern in a feature file, return to that feature's owning task instead of widening this task's file scope.

- [ ] **Step 4: Run all side-panel tests**

Run: `npm test -- tests/sidepanel`

Expected: PASS.

- [ ] **Step 5: Commit the edge-state pass**

```bash
git add src/sidepanel/components/Shell.tsx tests/sidepanel/Shell.test.tsx
git diff --cached --check
git commit -m "refactor: unify white index interface states"
```

Inspect the staged file list and remove unrelated files before committing.

---

## Task 10: Verify narrow layouts, accessibility, and production integrity

**Files:**

- Create: `tests/sidepanel/whiteIndexLayout.test.tsx`
- Modify: `src/sidepanel/index.css`
- Modify: `src/sidepanel/components/IndexNavigation.tsx`
- Modify: `src/sidepanel/components/IndexRow.tsx`
- Modify: `src/sidepanel/steps/DashboardStep.tsx`

**Interfaces:**

- Primary navigation exposes full accessible labels at all widths and has a CSS short-label path below the chosen narrow breakpoint.
- Indexed rows use the 42px minimum-height token.
- Important path/URL containers expose a wrapping class or semantic data hook verified by the layout test.
- Reduced-motion media query disables nonessential transitions.

- [ ] **Step 1: Add a focused structural regression test**

Because jsdom does not calculate actual responsive layout, test the owned contract rather than pixel geometry:

```tsx
it('keeps full accessible mode names while providing narrow labels', () => {
  render(<IndexNavigation {...props} />)
  const dashboard = screen.getByRole('tab', { name: '04 看板' })
  expect(dashboard).toHaveAttribute('aria-label', '04 看板')
  expect(dashboard.querySelector('[data-short-label]')).toHaveTextContent('04 看板')
})

it('marks important details as wrapping content', async () => {
  render(<DashboardStep />)
  await userEvent.click(screen.getByRole('button', { name: /展开 github\.com/ }))
  expect(screen.getByText(/Bookmarks Bar/).closest('[data-wrap="important"]')).not.toBeNull()
})
```

- [ ] **Step 2: Run the regression test and fix only demonstrated gaps**

Run: `npm test -- tests/sidepanel/whiteIndexLayout.test.tsx`

Expected: PASS after adding any missing semantic hooks/responsive rules.

- [ ] **Step 3: Run the complete automated suite**

Run: `npm test`

Expected: all test files and all tests pass; baseline before this redesign is 80 files / 1611 tests, and the final counts should be at least that high.

- [ ] **Step 4: Run type/build verification**

Run: `npm run build`

Expected: TypeScript and Vite production build exit successfully with no errors.

- [ ] **Step 5: Run diff hygiene checks**

```bash
git diff --check
git status --short
rg -n "TO[D]O|TB[D]|similar to ta[s]k" docs/superpowers/plans/2026-08-27-white-index-redesign.md src/sidepanel tests/sidepanel
```

Expected: no whitespace errors; status contains only intended changes; the unfinished-marker scan finds no plan omissions or newly introduced unfinished product code.

- [ ] **Step 6: Perform manual Chrome side-panel QA**

Load the production build as an unpacked extension and inspect at a narrow width and a comfortable width:

1. All four numbered primary modes, active underline, keyboard focus, busy disabling.
2. All five AI organize steps: completed summary, active expanded body, future collapsed title.
3. Cleanup loading, empty, populated, selected, confirmation, error, and retained multi-section results.
4. Bookmark search, deep folder indentation, long title/URL, import preview, export choice, sticky actions.
5. Dashboard bookmark folder/title/URL disclosure and visit title/URL/count disclosure; opening one domain closes the previous domain.
6. Settings endpoint edit/test/add/remove, secret masking, language change, privacy copy, back navigation.
7. Global retry alert, cancellation, result success, undo, and reduced-motion preference.

Confirm that no sticky action bar hides the final row and that no important path or URL is unrecoverably truncated.

- [ ] **Step 7: Commit final verification adjustments**

```bash
git add tests/sidepanel/whiteIndexLayout.test.tsx src/sidepanel/index.css src/sidepanel/components/IndexNavigation.tsx src/sidepanel/components/IndexRow.tsx src/sidepanel/steps/DashboardStep.tsx
git diff --cached --check
git commit -m "test: verify white index redesign"
```

If verification required no product adjustment, stage only the new regression test. If the test was added in an earlier commit, skip creating an empty commit.

---

## Completion Checklist

- [ ] Every acceptance criterion in the design spec maps to at least one task and verification step above.
- [ ] All four modes share numbered top navigation and the organize flow uses a vertical five-step index.
- [ ] Common controls and state treatments come from shared primitives rather than repeated feature-local class strings.
- [ ] The protected dashboard folder/bookmark and visit-page expansions are present and tested.
- [ ] Permissions, confirmation, import/export, retry, cancel, undo, and destructive-action safeguards behave exactly as before.
- [ ] Narrow-width labels, important-content wrapping, focus visibility, semantic states, and reduced motion have automated or manual coverage.
- [ ] `npm test` and `npm run build` pass.
- [ ] `git diff --check` is clean and unrelated working-tree changes were never included in a task commit.
