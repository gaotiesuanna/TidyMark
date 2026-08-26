# Import/Export Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time folder/bookmark-title/URL search to the import/export tree while preserving hierarchy, folder selection, and user expansion state.

**Architecture:** Keep one tree renderer. Add a pure recursive filter helper beside `BookmarkTree`, then let `TransferStep` own the query and the temporary search expansion state. Search results include matching nodes plus ancestors; folder rows retain current selection behavior, while bookmark rows are read-only result rows.

**Tech Stack:** React 19, TypeScript, Zustand store callbacks, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Search matches folder title, bookmark title, or URL with trimmed, case-insensitive substring matching.
- Search results preserve ancestor folders and original tree order.
- Search automatically expands folders containing matching descendants.
- Clearing search restores the expansion set from before search began.
- Search never changes `checkedIds` or the existing folder cascade behavior.
- Empty search keeps the current folder-only tree; non-empty search may render bookmark rows.
- Add matching English and Simplified Chinese localization keys to both locale JSON files.
- Do not change import/export transfer state or global busy state.
- Exclude `examples/` from all architectural analysis and pattern decisions.

---

### Task 1: Add recursive search filtering to BookmarkTree

**Files:**
- Modify: `src/sidepanel/components/BookmarkTree.tsx`
- Modify: `tests/sidepanel/BookmarkTree.test.tsx`

**Interfaces:**
- Produces `filterBookmarkTree(nodes: BookmarkNode[], query: string): BookmarkTreeFilter` for `TransferStep`.
- `BookmarkTreeFilter` contains `nodes: BookmarkNode[]`, `expandedIds: Set<string>`, and `hasMatches: boolean`.
- Add an optional `showBookmarks?: boolean` prop to `BookmarkTree`; omitted/false preserves current folder-only behavior.

- [ ] **Step 1: Write failing pure-filter and rendering tests**

Extend `tests/sidepanel/BookmarkTree.test.tsx` with these cases:

```tsx
import { BookmarkTree, filterBookmarkTree } from '@/sidepanel/components/BookmarkTree'

it('按文件夹名、书签标题或 URL 保留匹配节点和祖先', () => {
  const result = filterBookmarkTree(nodes, 'a.dev')
  expect(result.hasMatches).toBe(true)
  expect(result.nodes[0]?.title).toBe('书签栏')
  expect(result.nodes[0]?.children?.map((node) => node.title)).toEqual(['react'])
  expect(result.nodes[0]?.children?.[0]?.children?.map((node) => node.title)).toEqual(['A'])
  expect(result.expandedIds).toEqual(new Set(['1', '10']))
})

it('文件夹名称命中时只保留命中的文件夹，不展开无关后代', () => {
  const result = filterBookmarkTree(nodes, '工作常用')
  expect(result.nodes[0]?.children?.map((node) => node.title)).toEqual(['工作常用'])
  expect(result.nodes[0]?.children?.[0]?.children).toEqual([])
  expect(result.expandedIds).toEqual(new Set(['1']))
})

it('搜索渲染书签结果，但默认树仍只渲染文件夹', () => {
  const view = renderTree({ nodes, showBookmarks: true, expandedIds: new Set(['1', '10']) })
  expect(screen.getByText('A')).toBeDefined()
  expect(screen.getByText('https://a.dev')).toBeDefined()
  view.unmount()

  renderTree({ nodes, showBookmarks: false, expandedIds: new Set(['1', '10']) })
  expect(screen.queryByText('A')).toBeNull()
})

it('空查询返回原节点且不进入搜索结果模式', () => {
  const result = filterBookmarkTree(nodes, '  ')
  expect(result.nodes).toBe(nodes)
  expect(result.hasMatches).toBe(false)
  expect(result.expandedIds).toEqual(new Set())
})
```

Update the fixture so `react` contains bookmark `{ id: '100', title: 'A', url: 'https://a.dev' }` and keep a nested folder fixture for existing expansion assertions. The test must initially fail because the helper, bookmark rendering prop, and URL row do not exist.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm test -- tests/sidepanel/BookmarkTree.test.tsx
```

Expected: FAIL in the new filter/rendering cases with missing export/prop behavior; existing folder-only tests remain the baseline to preserve.

- [ ] **Step 3: Implement the pure filter and dual-mode row renderer**

In `src/sidepanel/components/BookmarkTree.tsx`, add the exported result type and helper before `Row`:

```tsx
export interface BookmarkTreeFilter {
  nodes: BookmarkNode[]
  expandedIds: Set<string>
  hasMatches: boolean
}

export function filterBookmarkTree(nodes: BookmarkNode[], query: string): BookmarkTreeFilter {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return { nodes, expandedIds: new Set(), hasMatches: false }

  const expandedIds = new Set<string>()

  function visit(node: BookmarkNode): BookmarkNode | null {
    const selfMatches = node.url !== undefined
      ? node.title.toLocaleLowerCase().includes(normalized)
        || node.url.toLocaleLowerCase().includes(normalized)
      : node.title.toLocaleLowerCase().includes(normalized)
    const children = (node.children ?? []).map(visit).filter((child): child is BookmarkNode => child !== null)
    if (!selfMatches && children.length === 0) return null
    if (node.url === undefined && children.length > 0) expandedIds.add(node.id)
    return node.url === undefined ? { ...node, children } : node
  }

  const filtered = nodes.map(visit).filter((node): node is BookmarkNode => node !== null)
  return { nodes: filtered, expandedIds, hasMatches: filtered.length > 0 }
}
```

Then update `Props` with `showBookmarks?: boolean`, pass it into `Row`, and render bookmark nodes only when true. For a bookmark row, use a non-interactive `div` with the existing `LinkIcon`, title, and URL. For folder rows, use `children = (node.children ?? []).filter(...)` where the filter keeps folders in folder-only mode and all children in search mode; keep existing checkbox and `onToggle` calls unchanged. A folder's expand button must be present whenever its visible children include either a folder or a bookmark.

- [ ] **Step 4: Run the focused test and verify the contract**

Run:

```bash
npm test -- tests/sidepanel/BookmarkTree.test.tsx
```

Expected: PASS, including the original folder-only, count, selection, and expansion tests plus the new filter cases.

- [ ] **Step 5: Commit the tree search unit**

```bash
git add src/sidepanel/components/BookmarkTree.tsx tests/sidepanel/BookmarkTree.test.tsx
git commit -m "feat: add hierarchical bookmark tree search"
```

---

### Task 2: Wire the search input and expansion state into TransferStep

**Files:**
- Modify: `src/sidepanel/steps/TransferStep.tsx`
- Modify: `tests/sidepanel/TransferStep.test.tsx`
- Modify: `public/_locales/zh_CN/messages.json`
- Modify: `public/_locales/en/messages.json`

**Interfaces:**
- Consumes `filterBookmarkTree` and `BookmarkTreeFilter` from `BookmarkTree.tsx`.
- Keeps `expanded`, `expandedIds`, `toggleExpand`, and store selection callbacks local to `TransferStep`.
- Adds `searchQuery`, `expandedBeforeSearch`, and `searchExpandedIds` as local UI state only.

- [ ] **Step 1: Add failing TransferStep interaction tests**

Add these cases to `tests/sidepanel/TransferStep.test.tsx`:

```tsx
it('搜索书签标题、URL并保留祖先层级', async () => {
  render(<TransferStep />)
  const input = screen.getByRole('searchbox', { name: '搜索书签' })

  await userEvent.type(input, 'a.dev')
  expect(screen.getByText('书签栏')).toBeDefined()
  expect(screen.getByText('react')).toBeDefined()
  expect(screen.getByText('A')).toBeDefined()
  expect(screen.getByText('https://a.dev')).toBeDefined()
})

it('搜索时自动展开命中路径，清空后恢复搜索前的展开状态', async () => {
  render(<TransferStep />)
  const react = screen.getByText('react')
  expect(screen.queryByText('A')).toBeNull()

  const input = screen.getByRole('searchbox', { name: '搜索书签' })
  await userEvent.type(input, 'a.dev')
  expect(screen.getByText('A')).toBeDefined()

  await userEvent.clear(input)
  expect(screen.queryByText('A')).toBeNull()
  expect(react).toBeDefined()
})

it('无匹配时显示提示，匹配结果不清理现有勾选', async () => {
  useStore.setState({ checkedIds: new Set(['10']) })
  render(<TransferStep />)
  const input = screen.getByRole('searchbox', { name: '搜索书签' })

  await userEvent.type(input, 'a.dev')
  expect(screen.getByText('A')).toBeDefined()
  expect((screen.getByRole('checkbox', { name: 'react' }) as HTMLInputElement).checked).toBe(true)

  await userEvent.clear(input)
  await userEvent.type(input, 'does-not-exist')
  expect(screen.getByText('没有找到相关书签')).toBeDefined()
})
```

Extend the test fixture with a URL bookmark under `react`, and make the default expansion assertion meaningful by keeping `react` collapsed before search. These tests must fail before wiring the input and search state.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm test -- tests/sidepanel/TransferStep.test.tsx
```

Expected: FAIL because no searchbox, filtered bookmark rows, or no-match message exists; all pre-existing transfer tests must remain passing.

- [ ] **Step 3: Add localization keys**

Insert matching keys in both locale files near the existing tree messages:

```json
"treeSearchLabel": { "message": "搜索书签" },
"treeSearchPlaceholder": { "message": "搜索文件夹、书签或 URL" },
"treeSearchEmpty": { "message": "没有找到相关书签" }
```

Use these English values in `public/_locales/en/messages.json`:

```json
"treeSearchLabel": { "message": "Search bookmarks" },
"treeSearchPlaceholder": { "message": "Search folders, bookmarks, or URLs" },
"treeSearchEmpty": { "message": "No matching bookmarks found" }
```

Keep key order aligned between both JSON files so locale parity tests continue to pass.

- [ ] **Step 4: Implement query, filtered nodes, and expansion restoration**

In `TransferStep.tsx`, import `filterBookmarkTree` and add:

```tsx
const [searchQuery, setSearchQuery] = useState('')
const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Set<string> | null>(null)
const [searchExpandedIds, setSearchExpandedIds] = useState<Set<string> | null>(null)
const searchActive = searchQuery.trim().length > 0
const searchResult = useMemo(
  () => filterBookmarkTree(tree, searchQuery),
  [tree, searchQuery],
)
function changeSearchQuery(value: string): void {
  const wasActive = searchQuery.trim().length > 0
  const willBeActive = value.trim().length > 0
  if (!wasActive && willBeActive) setExpandedBeforeSearch(new Set(expandedIds))
  if (wasActive && !willBeActive) {
    setExpanded(expandedBeforeSearch ?? expandedIds)
    setExpandedBeforeSearch(null)
  }
  setSearchExpandedIds(null)
  setSearchQuery(value)
}
```

Use a single `toggleExpand` that reads `visibleExpandedIds`, then writes to `setSearchExpandedIds` when `searchActive` and to the existing `setExpanded` state otherwise. Render the search input in the existing controls row after the collapse button:

```tsx
<label className="min-w-0 flex-1">
  <span className="sr-only">{t('treeSearchLabel')}</span>
  <input
    type="search"
    aria-label={t('treeSearchLabel')}
    value={searchQuery}
    onChange={(event) => changeSearchQuery(event.target.value)}
    placeholder={t('treeSearchPlaceholder')}
    className="w-full min-w-0 rounded border px-2 py-1 outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-300"
  />
</label>
```

Pass `visibleNodes`, `showBookmarks={searchActive}`, and `visibleExpandedIds` to `BookmarkTree`. Keep the existing expand-all/collapse-all actions operating on folder IDs; when search is active they may set `searchExpandedIds` to the full folder set or empty set for the visible search tree. Below the tree, render `t('treeSearchEmpty')` when `searchActive && !searchResult.hasMatches`.

Avoid retaining a stale search expansion set when the query changes. When clearing, restore the pre-search set before nulling it. Keep checked IDs and all store callbacks untouched.

- [ ] **Step 5: Run focused tests and localization tests**

Run:

```bash
npm test -- tests/sidepanel/TransferStep.test.tsx tests/sidepanel/BookmarkTree.test.tsx tests/i18n/locales.test.ts tests/i18n/messages.test.ts
```

Expected: PASS for the search interactions, existing transfer behavior, tree behavior, and locale key parity.

- [ ] **Step 6: Commit the UI integration**

```bash
git add src/sidepanel/steps/TransferStep.tsx tests/sidepanel/TransferStep.test.tsx public/_locales/zh_CN/messages.json public/_locales/en/messages.json
git commit -m "feat: add import export bookmark search"
```

---

### Task 3: Verify the finished behavior

**Files:**
- No source changes expected.
- Review: `docs/superpowers/specs/2026-08-26-search-import-export-design.md`

**Interfaces:**
- Verifies the `TransferStep` searchbox and `BookmarkTree` filtering behavior from Tasks 1–2.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
npm run build
```

Expected: all Vitest tests pass, TypeScript emits no errors, and Vite produces a successful extension build.

- [ ] **Step 2: Launch the actual UI and exercise the changed path**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Open the dev page/extension side panel in a browser and verify:

1. The search field sits beside “全部展开 / 全部收起” and remains usable at the narrow side-panel width.
2. A folder-name query shows the folder and its original ancestors without unrelated descendants.
3. A bookmark-title or URL query shows the bookmark row, URL, and ancestor folders with indentation.
4. Matching paths are expanded automatically; clearing the field restores the prior expansion state.
5. Existing folder checkboxes, import/export toggle, and export format buttons still work.
6. An unmatched query shows the localized empty result message.

Stop the dev process after the smoke test.

- [ ] **Step 3: Commit only if verification required a source correction**

If verification exposes a source defect, fix it with a focused test first, rerun the relevant command, then commit the correction:

```bash
git add src/sidepanel/components/BookmarkTree.tsx src/sidepanel/steps/TransferStep.tsx tests/sidepanel/BookmarkTree.test.tsx tests/sidepanel/TransferStep.test.tsx public/_locales/zh_CN/messages.json public/_locales/en/messages.json
git commit -m "fix: correct import export search behavior"
```

If no correction is needed, leave the two feature commits unchanged.
