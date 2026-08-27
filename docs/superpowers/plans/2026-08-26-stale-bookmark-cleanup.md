# 长期未点击收藏清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有清理模式中增加基于 Chrome 浏览历史的长期未点击收藏分区，支持按自然月筛选、逐条删除或移动，并复用现有快照与撤销。

**Architecture:** 保留现有 `cleanup_scan` 的全库重复项扫描语义；新增独立的 `cleanup_stale_scan` 请求，只对当前 `checkedIds` 范围读取书签和历史。浏览器 API 通过 ports 隔离，核心层用纯函数完成 URL 匹配和自然月分组，侧栏负责权限手势、单表筛选和选择，清理 engine 负责按范围根移动并纳入现有快照。

**Tech Stack:** TypeScript 5.9、React 19、Zustand 5、Chrome Manifest V3、Vitest 4、Testing Library。

## Global Constraints

- 历史权限是 optional permission；页面加载和 React effect 不得申请，只能在用户点击解释按钮的调用链中申请。
- 过期分组按自然月计算，不按 90/180/365 固定天数计算。
- 过期分组必须互斥：3–6 个月、6–12 个月、1 年以上；边界归入更老档位。
- 过期名单只使用当前 `checkedIds`；没有当前范围时不得自动扩大到全库。
- 无匹配历史或缺少 `lastVisitTime` 的收藏归入 `unknown`，不得文案化为“从未访问”。
- 所有过期收藏默认不勾选；删除和移动对同一书签互斥。
- 多个范围根各自复用或创建一个直接子目录“待清理”，不得跨根合并。
- 现有 `cleanup_scan` 的全库重复项、失效链接和空目录语义不得改变。
- 不新增依赖，不建立本地长期历史索引，不自动删除或移动。
- 每个实现任务先写能失败的行为测试，再写最小实现；任务内只运行相关测试，最终再运行完整验证。

## File Map

- `src/core/ports.ts`：新增 `HistoryVisit` 与 `HistoryApi`，扩展 `Ports`。
- `src/core/stale.ts`：纯函数 URL 匹配、最新访问归并、自然月分组。
- `src/background/chrome-ports.ts`：映射 `chrome.history.search()`。
- `src/background/messages.ts`：新增 `cleanup_stale_scan` 请求/响应。
- `src/engine/stale.ts`：读取当前范围树与历史，调用核心分类函数。
- `src/engine/cleanup.ts`：扩展清理选择和执行，使历史移动按范围根落入“待清理”。
- `src/sidepanel/store.ts`：历史清理状态、权限/扫描动作、历史删除与移动选择。
- `src/sidepanel/steps/CleanupStep.tsx`：挂载历史清理分区并纳入执行汇总。
- `src/sidepanel/components/StaleCleanupSection.tsx`：单表筛选和历史记录行，避免继续增大 `CleanupStep`。
- `src/i18n/messages.ts`、`public/_locales/zh_CN/messages.json`、`public/_locales/en/messages.json`：状态、操作、筛选和 aria 文案。
- `tests/core/stale.test.ts`：分类规则。
- `tests/fakes/fake-history.ts`：可控历史 port。
- `tests/engine/stale.test.ts`：当前范围历史扫描。
- `tests/engine/cleanup.test.ts`：历史移动、快照和撤销。
- `tests/background/handlers.test.ts`：新消息路由和错误。
- `tests/sidepanel/CleanupStep.test.tsx`：权限、筛选、选择和汇总。

---

### Task 1: Add Pure Stale Bookmark Classifier

**Files:**
- Create: `src/core/stale.ts`
- Modify: `src/core/ports.ts`
- Create: `tests/core/stale.test.ts`

**Interfaces:**
- Produces `HistoryVisit`, `StaleBucket`, `StaleBookmark`, `StaleScanResult`, and `classifyStaleBookmarks` for later tasks.
- Consumes `BookmarkItem` from `src/core/types.ts` and `normalizeUrl` from `src/core/url.ts`.

- [ ] **Step 1: Write failing boundary and matching tests**

Add tests with a fixed local scan date, such as `new Date('2026-08-26T12:00:00')`, and assert the returned `bucket` values. Cover:

```ts
const scanDate = new Date(2026, 7, 26, 12).getTime()
const item = (id: string, url: string): BookmarkItem => ({
  id, url, title: id, parentId: 'root', index: 0, currentPath: ['root'],
})

it('uses mutually exclusive natural-month buckets', () => {
  const result = classifyStaleBookmarks(
    [
      item('three-to-six', 'https://three.test'),
      item('six-to-twelve', 'https://six.test'),
      item('over-year', 'https://year.test'),
    ],
    [
      { url: 'https://three.test', lastVisitTime: new Date(2026, 4, 26, 12).getTime() },
      { url: 'https://six.test', lastVisitTime: new Date(2026, 1, 26, 12).getTime() },
      { url: 'https://year.test', lastVisitTime: new Date(2025, 7, 26, 12).getTime() },
    ],
    scanDate,
    new Map([
      ['three-to-six', 'root'],
      ['six-to-twelve', 'root'],
      ['over-year', 'root'],
    ]),
  )
  expect(result.items.map(({ item: bookmark, bucket }) => [bookmark.id, bucket])).toEqual([
    ['three-to-six', 'threeToSixMonths'],
    ['six-to-twelve', 'sixToTwelveMonths'],
    ['over-year', 'overOneYear'],
  ])
})

it('takes the newest normalized visit and sends missing history to unknown', () => {
  const result = classifyStaleBookmarks(
    [
      item('example', 'https://example.test/page/'),
      item('never', 'https://never.test'),
    ],
    [
      { url: 'https://example.test/page/?utm_source=x', lastVisitTime: new Date(2025, 0, 1).getTime() },
      { url: 'https://example.test/page', lastVisitTime: new Date(2026, 5, 1).getTime() },
    ],
    scanDate,
    new Map([['example', 'root'], ['never', 'root']]),
  )
  expect(result.items.find(({ item: bookmark }) => bookmark.id === 'example')?.lastVisitedAt)
    .toBe(new Date(2026, 5, 1).getTime())
  expect(result.items.find(({ item: bookmark }) => bookmark.id === 'never')?.bucket).toBe('unknown')
})
```


Also test exact 3/6/12-month cutoffs, URLs with meaningful query parameters, input immutability, and a visit newer than three months being absent from `items`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/core/stale.test.ts`

Expected: FAIL because `src/core/stale.ts` and its exported types do not exist.

- [ ] **Step 3: Implement the minimal core contract**

In `src/core/ports.ts`, define the shared history record:

```ts
export interface HistoryVisit {
  url: string
  lastVisitTime?: number
}
```

In `src/core/stale.ts`, import `HistoryVisit` as a type and define these exact exports:
```ts
import type { HistoryVisit } from './ports'
export type StaleBucket =
  | 'threeToSixMonths'
  | 'sixToTwelveMonths'
  | 'overOneYear'
  | 'unknown'

export interface StaleBookmark {
  item: BookmarkItem
  bucket: StaleBucket
  lastVisitedAt?: number
}

export interface StaleScanResult {
  items: StaleBookmark[]
  scannedAt: number
  cutoff3Months: number
  cutoff6Months: number
  cutoff12Months: number
  scopeRootIdByBookmarkId: Record<string, string>
}

export function classifyStaleBookmarks(
  items: BookmarkItem[],
  visits: HistoryVisit[],
  scannedAt: number,
  scopeRootIdByBookmarkId: ReadonlyMap<string, string>,
): StaleScanResult
```

Implement a local-calendar `subtractMonths(timestamp, count)` helper that clamps a month-end date to the last valid day of the target month. Build a `Map<string, number | undefined>` keyed by `normalizeUrl(visit.url)` and retain the greatest defined timestamp. Classify only records at or before the three-month cutoff; compare the oldest cutoff first so exact boundaries enter the older bucket. Copy the supplied `scopeRootIdByBookmarkId` map into the result so later cleanup execution can choose a destination per range root. Emit one result item per input bookmark and preserve all input objects.


- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/core/stale.test.ts`

Expected: PASS with tests covering cutoff boundaries, latest visit selection, normalization, unknown, and immutability.

- [ ] **Step 5: Commit the classifier**

```bash
git add src/core/stale.ts src/core/ports.ts tests/core/stale.test.ts
git commit -m "feat: classify stale bookmarks by history"
```

---

### Task 2: Wire History Ports and Background Stale Scan

**Files:**
- Modify: `src/core/ports.ts`
- Modify: `src/background/chrome-ports.ts`
- Modify: `src/background/messages.ts`
- Modify: `src/background/handlers.ts`
- Create: `src/engine/stale.ts`
- Create: `tests/fakes/fake-history.ts`
- Create: `tests/engine/stale.test.ts`
- Modify: `tests/background/handlers.test.ts`

**Interfaces:**
- Consumes `HistoryVisit` and `classifyStaleBookmarks` from Task 1.
- Produces `scanStaleBookmarks(ports, scopeRootIds, scannedAt?)` returning `Promise<StaleScanResult>`.
- Produces message shapes `{ kind: 'cleanup_stale_scan'; scopeRootIds: string[] }` and `{ ok: true; kind: 'cleanup_stale_scan'; scan: StaleScanResult }`.

- [ ] **Step 1: Add failing engine and handler tests**

Create a fake history API whose `search()` returns a configured array. Assert that the engine calls `scanTree` only over the supplied scope roots and that a handler request routes to the engine. Add a rejection test:

```ts
it('returns the history query error instead of an empty stale result', async () => {
  history.search = vi.fn().mockRejectedValue(new Error('history unavailable'))
  const response = await handle(ports, { kind: 'cleanup_stale_scan', scopeRootIds: ['folder-1'] })
  expect(response.ok).toBe(false)
  expect(response.error).toContain('history unavailable')
})
```

Assert that the existing `{ kind: 'cleanup_scan' }` request remains unchanged and still invokes full-library `scanForCleanup`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/engine/stale.test.ts tests/background/handlers.test.ts`

Expected: FAIL because the history port, engine function, and message variant do not exist.

- [ ] **Step 3: Implement the history port and Chrome adapter**

Add `HistoryApi` to `src/core/ports.ts`:

```ts
export interface HistoryApi {
  search(): Promise<HistoryVisit[]>
}

export interface Ports {
  bookmarks: BookmarksApi
  history?: HistoryApi
  storage: StorageApi
}
```

In `src/background/chrome-ports.ts`, map `chrome.history.search({ text: '', maxResults: 10000, startTime: 0 })` to `{ url, lastVisitTime }`, skip entries without `url`, and return `{ bookmarks, history, storage }`. Existing production ports always include `history`; existing tests that do not exercise history remain valid because `Ports.history` is optional.

- [ ] **Step 4: Implement the scoped engine and handler route**

In `src/engine/stale.ts`, read one tree, normalize `scopeRootIds` with the existing scope-root helper, call `scanTree(tree, roots)`, build a `Map<string, string>` by walking each normalized root and assigning every descendant bookmark to that root, require `ports.history` and throw `new Error('History API unavailable')` if it is absent, call `ports.history.search()`, then call `classifyStaleBookmarks(scan.bookmarks, visits, now(), scopeRootIdByBookmarkId)`. Do not catch history errors in the engine; allow the handler’s existing outer error path to return the translated error.

Add the exact request and response unions in `src/background/messages.ts`. In `src/background/handlers.ts`, add a `cleanup_stale_scan` case that calls `scanStaleBookmarks(ports, request.scopeRootIds)` and returns its result. Do not modify the existing `cleanup_scan` case.

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `npm test -- tests/engine/stale.test.ts tests/background/handlers.test.ts`

Expected: PASS, including scoped IDs, Chrome history mapping, successful routing, and query-error behavior.

- [ ] **Step 6: Commit the background scan**

```bash
git add src/core/ports.ts src/background/chrome-ports.ts src/background/messages.ts src/background/handlers.ts src/engine/stale.ts tests/fakes/fake-history.ts tests/engine/stale.test.ts tests/background/handlers.test.ts tests
git commit -m "feat: scan stale bookmarks from browser history"
```


---

### Task 3: Extend Cleanup Selection and Per-Root Move Execution

**Files:**
- Modify: `src/core/cleanup.ts`
- Modify: `src/engine/cleanup.ts`
- Modify: `src/sidepanel/store.ts`
- Modify: `tests/engine/cleanup.test.ts`

**Interfaces:**
- Extends `CleanupSelection` with `staleMoveBookmarkIds: string[]` and `staleMoveRootByBookmarkId: Record<string, string>`.
- Extends `CleanupInput` with `staleMoveFolderTitle: string`.
- Existing `deleteBookmarkIds` and `moveBookmarkIds` retain their current meanings; stale moves use the new fields and never use the dead-link `barId` destination.

- [ ] **Step 1: Write failing execution tests**

Add tests that select two stale bookmarks under two different root folders and assert:

```ts
expect(bookmarks.structure()).toContain('root-a/待清理/stale-a')
expect(bookmarks.structure()).toContain('root-b/待清理/stale-b')
```

Add tests for reusing an existing direct child named `待清理`, creating it when absent, including stale move IDs in the snapshot, restoring original parent/index on undo, and continuing after one stale move fails.

- [ ] **Step 2: Run the focused engine tests and verify they fail**

Run: `npm test -- tests/engine/cleanup.test.ts`

Expected: FAIL because `CleanupSelection` cannot represent stale moves and `applyCleanup` only knows the single dead-link destination.

- [ ] **Step 3: Extend selection and snapshot accounting**

Add the two stale-move fields to `CleanupSelection`. Include stale move IDs in `buildSnapshot()`’s touched bookmark set and in the progress total. Keep `deletedBookmarkIds` limited to `deleteBookmarkIds`; stale moves must remain reversible moves, not deletes.

In the store selection helpers, maintain a separate `cleanupStaleMove: Set<string>` so a stale row can be moved without being sent to the dead-link folder. Toggling stale delete removes its stale-move selection; toggling stale move removes its delete selection.

- [ ] **Step 4: Implement destination resolution and execution**

Before moving stale bookmarks, group selected stale move IDs by `staleMoveRootByBookmarkId`. For each root, find the first direct child folder with the exact localized `staleMoveFolderTitle`; otherwise create it. Move each stale bookmark to its group’s folder. Keep dead-link creation and movement on its existing `barId` path. Count all successful moves in the existing `moved` result and report missing IDs or move errors through existing `skipped` records.

Pass the localized title and root map through `CleanupInput`. Do not delete or rename any existing dead-link folder logic.

- [ ] **Step 5: Run the focused engine tests and verify they pass**

Run: `npm test -- tests/engine/cleanup.test.ts`

Expected: PASS for per-root reuse/create, snapshot inclusion, undo restoration, and partial failure.

- [ ] **Step 6: Commit cleanup execution support**

```bash
git add src/core/cleanup.ts src/engine/cleanup.ts src/sidepanel/store.ts tests/engine/cleanup.test.ts
git commit -m "feat: move stale bookmarks into scoped cleanup folders"
```

---

### Task 4: Add Store Permission, Scan, and Stale Selection State

**Files:**
- Modify: `src/sidepanel/store.ts`
- Modify: `tests/sidepanel/CleanupStep.test.tsx` for store setup fixtures

**Interfaces:**
- Adds `staleScan: StaleScanResult | null`.
- Adds `staleState: 'idle' | 'loading' | 'ready' | 'empty' | 'denied' | 'error'`.
- Adds `staleError: string | null`, `cleanupStaleMove: Set<string>`.
- Adds `runStaleScan(): Promise<void>`, `toggleStaleDelete(id: string): void`, and `toggleStaleMove(id: string): void`.

- [ ] **Step 1: Write failing store/UI state tests**

Mock `ensureHistoryPermission` and `send`. Assert:

```ts
expect(ensureHistoryPermission).not.toHaveBeenCalled()
await user.click(screen.getByRole('button', { name: t('cleanupStaleAllow') }))
expect(ensureHistoryPermission).toHaveBeenCalledTimes(1)
expect(send).toHaveBeenCalledWith({
  kind: 'cleanup_stale_scan',
  scopeRootIds: ['selected-root'],
})
```

Add denial, empty result, query error, and stale delete/move mutual-exclusion assertions.

- [ ] **Step 2: Run the focused sidepanel tests and verify they fail**

Run: `npm test -- tests/sidepanel/CleanupStep.test.tsx`

Expected: FAIL because the store has no stale state or action and the cleanup page has no stale permission button.

- [ ] **Step 3: Implement store state and permission-gated scan**

Initialize the new fields in `initialState`. Implement `runStaleScan()` as follows:

1. Read `checkedIds`; if empty, set `staleState: 'idle'` with no request.
2. Capture `runSeq` and a sorted scope-key string.
3. Set `staleState: 'loading'`, clear `staleError`, and call `ensureHistoryPermission()` from the click-triggered call chain.
4. On false, set `staleState: 'denied'` and return.
5. Send `cleanup_stale_scan` with the captured scope IDs.
6. Ignore a response if `runSeq` or the sorted current scope-key differs from the captured values.
7. Set `ready` when `scan.items.length > 0`, otherwise `empty`; on request failure set `error` and preserve the error text.

Implement stale delete/move toggles so the same ID cannot exist in both `cleanupChecked` and `cleanupStaleMove`. Preserve existing duplicate/dead-link toggle behavior.

- [ ] **Step 4: Run the focused sidepanel tests and verify they pass**

Run: `npm test -- tests/sidepanel/CleanupStep.test.tsx`
git commit -m "feat: manage stale cleanup scan state"
Expected: PASS for no auto-request, click-only permission, denial/error/empty state, scoped request, stale response invalidation, and mutual exclusion.

- [ ] **Step 5: Commit store behavior**

```bash
git add src/sidepanel/store.ts tests/sidepanel/CleanupStep.test.tsx
git commit -m "feat: manage stale cleanup scan state"
```

---

### Task 5: Build the Single-Table Stale Cleanup UI and Localized Copy

**Files:**
- Create: `src/sidepanel/components/StaleCleanupSection.tsx`
- Modify: `src/sidepanel/steps/CleanupStep.tsx`
- Modify: `src/i18n/messages.ts`
- Modify: `public/_locales/zh_CN/messages.json`
- Modify: `public/_locales/en/messages.json`
- Modify: `tests/sidepanel/CleanupStep.test.tsx`
- Modify: `tests/english-ui.test.tsx` if the new component is included in its direct render list

**Interfaces:**
- `StaleCleanupSection` consumes `StaleScanResult | null`, stale state/error, current `checkedIds`, `cleanupChecked`, `cleanupStaleMove`, and the store callbacks.
- Produces no new global state; the selected filter remains local component state with default `all`.

- [ ] **Step 1: Add failing UI tests for the observable contract**

Add tests that verify the new section:

- Shows explanation and an allow button before permission.
- Renders tabs `全部`, `3–6 个月`, `6–12 个月`, `1 年以上`, `无访问记录` after a ready scan.
- Shows title, full URL, original path, last visit date, bucket, delete checkbox, and move checkbox.
- Shows cutoff dates from `StaleScanResult`.
- Starts with no stale delete or move checkbox selected.
- Keeps unknown in its own filter and lets the user deliberately select it.
- Adds stale selections to the existing bottom execution count.

- [ ] **Step 2: Run the focused UI tests and verify they fail**

Run: `npm test -- tests/sidepanel/CleanupStep.test.tsx`

Expected: FAIL because `StaleCleanupSection` and its localized messages do not exist.

- [ ] **Step 3: Implement the focused table component**

Create `StaleCleanupSection` with a local filter union:

```ts
type StaleFilter = 'all' | StaleBucket
```

Render state-specific content. In `ready`, show the current scope summary, scan date, cutoff dates, filter buttons, and rows. Format dates with `Intl.DateTimeFormat` using the current locale. Keep URLs and paths untruncated in accessible text; visual truncation may use CSS with a `title` containing the complete value.

Use two labeled checkboxes per row. `onChange` calls `toggleStaleDelete(id)` or `toggleStaleMove(id)`. Render unknown rows with a factual “当前历史查询没有可用匹配” explanation.

- [ ] **Step 4: Mount the section and merge it into execution input**

In `CleanupStep.tsx`, render `StaleCleanupSection` as a sibling section without changing existing duplicate, link, or empty-folder sections. Add `cleanupStaleMove.size` to the bottom total. In `runCleanup()` input construction, pass stale move IDs, a root ID for every selected stale move derived from the scan item’s original path/root mapping, and the localized “待清理” title.

Keep history permission requests out of `useEffect`; the existing cleanup scan effect may continue to run because it does not access history.

- [ ] **Step 5: Add exact bilingual messages and accessibility labels**

Add messages for explanation, allow, loading, denied, error, empty, current scope, cutoff dates, all five filters, delete/move actions, unknown-history explanation, and table/list labels in both locale JSON files. Keep all user-visible text behind `t()` and ensure the English UI test finds no Chinese characters.

- [ ] **Step 6: Run focused UI and locale tests and verify they pass**

Run: `npm test -- tests/sidepanel/CleanupStep.test.tsx tests/english-ui.test.tsx`

Expected: PASS for table filtering, selection defaults, permission states, execution count, accessibility labels, and English-only rendering.

- [ ] **Step 7: Commit the UI**

```bash
git add src/sidepanel/components/StaleCleanupSection.tsx src/sidepanel/steps/CleanupStep.tsx src/i18n/messages.ts public/_locales/zh_CN/messages.json public/_locales/en/messages.json tests/sidepanel/CleanupStep.test.tsx tests/english-ui.test.tsx
git commit -m "feat: add stale bookmark cleanup section"
```

---

### Task 6: Verify End-to-End Selection, Apply, and Undo Contracts

**Files:**
- Modify: `tests/engine/stale.test.ts`
- Modify: `tests/engine/cleanup.test.ts`
- Modify: `tests/sidepanel/CleanupStep.test.tsx`
- Modify: `tests/background/handlers.test.ts`
- Modify: `tests/fakes/fake-history.ts` and any shared setup fixtures

**Interfaces:**
- Verifies the complete contracts from Tasks 1–5 without introducing new production APIs.

- [ ] **Step 1: Add cross-layer regression cases**

Add deterministic cases for:
```ts
const scanDate = new Date(2026, 7, 26, 12).getTime()
function bucketAt(lastVisitedAt: Date): StaleBucket | undefined {
  const result = classifyStaleBookmarks(
    [{ id: 'bookmark', title: 'bookmark', url: 'https://example.test', parentId: 'root', index: 0, currentPath: ['root'] }],
    [{ url: 'https://example.test', lastVisitTime: lastVisitedAt.getTime() }],
    scanDate,
    new Map([['bookmark', 'root']]),
  )
  return result.items[0]?.bucket
}

expect(bucketAt(new Date(2026, 4, 26, 12))).toBe('threeToSixMonths')
expect(bucketAt(new Date(2026, 1, 26, 12))).toBe('sixToTwelveMonths')
expect(bucketAt(new Date(2025, 7, 26, 12))).toBe('overOneYear')

// No selection means apply remains disabled.
expect(screen.getByRole('button', { name: /清理|clean/i })).toBeDisabled()
```


Also verify that a stale history scan does not reset duplicate/dead-link selections, that changing `checkedIds` invalidates the old scan, and that existing full-library cleanup tests continue to pass unchanged.

- [ ] **Step 2: Run the affected test groups**

Run: `npm test -- tests/core/stale.test.ts tests/engine/stale.test.ts tests/engine/cleanup.test.ts tests/background/handlers.test.ts tests/sidepanel/CleanupStep.test.tsx`

Expected: PASS with no skipped or focused tests.

- [ ] **Step 3: Fix only contract failures**

If a test fails, change the smallest production boundary that violates the spec: core classification, history message routing, store invalidation, table selection, or cleanup execution. Do not broaden the history query, add automatic selection, alter the existing full-library scan, or introduce a new mode.

- [ ] **Step 4: Commit regression coverage**

```bash
git add tests/core/stale.test.ts tests/engine/stale.test.ts tests/engine/cleanup.test.ts tests/background/handlers.test.ts tests/sidepanel/CleanupStep.test.tsx tests/fakes/fake-history.ts
git commit -m "test: cover stale cleanup end to end"
```

---

### Task 7: Run Final Verification and Build

**Files:**
- No production file changes expected; modify only a failing test or implementation file if a concrete verification failure identifies one.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: PASS for all existing and new tests.

- [ ] **Step 2: Run the production typecheck and extension build**

Run: `npm run build`

Expected: TypeScript emits no errors and Vite produces the Manifest V3 extension bundle.

- [ ] **Step 3: Smoke-test the actual extension path**

Launch the extension with `npm run dev`, open the side panel, select a folder in the organize scope, switch to 清理, and verify this sequence manually:

1. Existing cleanup sections render without a history permission request.
2. The stale section shows its explanation and allow button.
3. Clicking allow triggers Chrome’s optional history permission prompt.
4. After permission, the current-scope table renders with filter tabs and no selected actions.
5. Selecting delete or move updates the shared bottom execution count.
6. Applying a move creates/reuses one “待清理” folder under each selected root.
7. Undo restores moved bookmarks to their original parents and positions.

- [ ] **Step 4: Record final verification evidence**

Capture the exact `npm test` and `npm run build` results, plus the manual smoke path and any browser permission limitations. Do not claim completion without all three checks.

## Plan Self-Review

- **Spec coverage:** scope, optional permission gesture, natural-month buckets, unknown records, B single-table layout, default-unselected rows, delete/move actions, per-root folders, partial failures, snapshots, undo, async invalidation, bilingual copy, and changed-contract tests each have a task.
- **Placeholder scan:** no `TODO`, `TBD`, or deferred implementation steps; each code change names its file, interface, and focused command.
- **Type consistency:** `HistoryVisit` is defined in Task 1; ports and engine consume it in Task 2. `StaleScanResult` flows from Task 1 through Task 2, store Task 4, and UI Task 5. Stale move fields are defined in Task 3 and populated by Task 5 before `applyCleanup()` executes them.
- **Scope check:** one feature with two coupled paths—history discovery and existing cleanup execution—kept in one plan because neither produces a useful user feature without the other.
