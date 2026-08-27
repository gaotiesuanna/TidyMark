# Domain Folder Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin click a bookmarked domain on the dashboard to see how those bookmarks split across folders.

**Architecture:** A pure `folderDistribution(tree, domain)` in `src/core/domains.ts` walks the bookmark tree with a path stack and aggregates by folder id. `DashboardStep` accordion-expands one domain row and renders those shares. Visited ranking does not pass the tree, so those rows stay static.

**Tech Stack:** TypeScript, React 19, Zustand (read `tree` only), Vitest, Testing Library, Chrome locale JSON.

## Global Constraints

- Domain matching uses `sanitizeUrl` (lowercase, strip `www.`, http(s) only) — same as `rankDomains`.
- Folder labels are full paths; aggregate by `folderId`; skip empty titles (Chrome root `id: '0'`).
- Accordion: one open domain at a time. Clicking the open row closes it.
- Visited tab rows are not expandable.
- Do not persist expand state, do not navigate to Browse, do not list individual bookmarks.
- Add matching English and Simplified Chinese keys. Locale key sets must stay equal.
- Exclude `examples/` from architectural analysis and pattern decisions.
- `docs/superpowers/` is gitignored; `git add -f` plan/spec files if committing them.

---

### Task 1: `folderDistribution` in core

**Files:**
- Modify: `src/core/domains.ts`
- Test: `tests/core/domains.test.ts`

**Interfaces:**
- Produces:

```ts
export interface FolderShare {
  folderId: string
  path: string[]
  count: number
}

export function folderDistribution(
  tree: BookmarkNode[],
  domain: string,
): FolderShare[]
```

- Consumes `BookmarkNode` from `./ports` and `sanitizeUrl` from `./sanitize`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/domains.test.ts`. Import `folderDistribution`. Add this describe after `bookmarkUrls`:

```ts
describe('folderDistribution', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: 'bar', title: '书签栏', children: [
        { id: 'dev', title: '开发', children: [
          { id: 'gh', title: 'GitHub', children: [
            { id: 'a', title: 'a', url: 'https://github.com/a' },
            { id: 'b', title: 'b', url: 'https://www.github.com/b' },
          ]},
        ]},
        { id: 'tmp', title: '临时', children: [
          { id: 'c', title: 'c', url: 'https://github.com/c' },
        ]},
        { id: 'd', title: 'd', url: 'https://bilibili.com/1' },
        { id: 'e', title: 'e', url: 'javascript:alert(1)' },
      ]},
      { id: 'other', title: '其他书签', children: [
        { id: 'f', title: 'f', url: 'https://github.com/f' },
      ]},
    ]},
  ]

  it('同一域名、两个路径分成两行，路径完整', () => {
    const shares = folderDistribution(tree, 'github.com')
    expect(shares.map((s) => [s.folderId, s.path, s.count])).toEqual([
      ['gh', ['书签栏', '开发', 'GitHub'], 2],
      ['tmp', ['书签栏', '临时'], 1],
      ['other', ['其他书签'], 1],
    ])
  })

  it('www 与裸域计入同一 domain', () => {
    const gh = folderDistribution(tree, 'github.com').find((s) => s.folderId === 'gh')
    expect(gh?.count).toBe(2)
  })

  it('根下书签路径是根文件夹名，空标题根不进路径', () => {
    const bili = folderDistribution(tree, 'bilibili.com')
    expect(bili).toEqual([
      { folderId: 'bar', path: ['书签栏'], count: 1 },
    ])
  })

  it('按条数降序，同数按路径稳定', () => {
    const tied: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'z', title: 'zeta', children: [
          { id: 'z1', title: 'z1', url: 'https://x.com/1' },
        ]},
        { id: 'a', title: 'alpha', children: [
          { id: 'a1', title: 'a1', url: 'https://x.com/2' },
        ]},
      ]},
    ]
    expect(folderDistribution(tied, 'x.com').map((s) => s.path)).toEqual([
      ['alpha'],
      ['zeta'],
    ])
  })

  it('无关域名和非 http(s) 不进结果', () => {
    expect(folderDistribution(tree, 'example.com')).toEqual([])
    expect(folderDistribution(tree, 'javascript:alert(1)')).toEqual([])
  })

  it('各行 count 之和等于该域名在树上的书签数', () => {
    const shares = folderDistribution(tree, 'github.com')
    expect(shares.reduce((n, s) => n + s.count, 0)).toBe(4)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/core/domains.test.ts
```

Expected: FAIL — `folderDistribution` is not exported.

- [ ] **Step 3: Implement `folderDistribution`**

Append to `src/core/domains.ts` after `bookmarkUrls`:

```ts
export interface FolderShare {
  folderId: string
  path: string[]
  count: number
}

/**
 * 某域名的书签按父文件夹聚合。路径是从根到该文件夹的标题，跳过空标题。
 */
export function folderDistribution(
  tree: BookmarkNode[],
  domain: string,
): FolderShare[] {
  const byFolder = new Map<string, FolderShare>()

  const walk = (nodes: BookmarkNode[], path: string[], folderId: string): void => {
    for (const node of nodes) {
      if (node.url !== undefined) {
        const parsed = sanitizeUrl(node.url)
        if (parsed === null || parsed.domain !== domain) continue
        const existing = byFolder.get(folderId)
        if (existing === undefined) {
          byFolder.set(folderId, { folderId, path, count: 1 })
        } else {
          existing.count += 1
        }
        continue
      }
      const nextPath = node.title === '' ? path : [...path, node.title]
      walk(node.children ?? [], nextPath, node.id)
    }
  }

  walk(tree, [], '')
  return [...byFolder.values()].sort(
    (a, b) => b.count - a.count || a.path.join('\0').localeCompare(b.path.join('\0')),
  )
}
```

Do not change `rankDomains` or `bookmarkUrls`.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
npm test -- tests/core/domains.test.ts
```

Expected: PASS, including existing `rankDomains` / `clampTopDomainCount` / `bookmarkUrls` cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/domains.ts tests/core/domains.test.ts
git commit -m "feat: aggregate bookmark domains by folder path"
```

If `src/core/domains.ts` was previously untracked, this commit should include the whole file plus the new function — do not leave `rankDomains` uncommitted if the working tree still has it untracked.

---

### Task 2: Expandable domain rows on the dashboard

**Files:**
- Modify: `src/sidepanel/steps/DashboardStep.tsx`
- Modify: `tests/sidepanel/DashboardStep.test.tsx`
- Modify: `public/_locales/zh_CN/messages.json`
- Modify: `public/_locales/en/messages.json`

**Interfaces:**
- Consumes `folderDistribution` and `FolderShare` from `@/core/domains`.
- `DomainList` gains optional `tree?: BookmarkNode[]`. Present ⇒ rows are buttons; omitted ⇒ static (visited).
- Local state only: `openDomain: string | null`. Remount on `topN` via `key={String(topN)}`.

- [ ] **Step 1: Add locale keys**

Insert after `dashListLabel` in both files. Keep key sets identical.

`public/_locales/zh_CN/messages.json`:

```json
"dashDomainExpand": {
  "message": "查看 $domain$ 在各文件夹的分布",
  "placeholders": { "domain": { "content": "$1" } }
},
"dashDomainCollapse": {
  "message": "收起 $domain$ 的文件夹分布",
  "placeholders": { "domain": { "content": "$1" } }
},
```

`public/_locales/en/messages.json`:

```json
"dashDomainExpand": {
  "message": "Show folder distribution for $domain$",
  "placeholders": { "domain": { "content": "$1" } }
},
"dashDomainCollapse": {
  "message": "Hide folder distribution for $domain$",
  "placeholders": { "domain": { "content": "$1" } }
},
```

- [ ] **Step 2: Write failing dashboard tests**

Keep the existing `tree` fixture (github ×3 and bilibili ×1 under `bar`). Append inside `describe('DashboardStep')`:

```tsx
it('点书签栏域名展开对应路径和条数', async () => {
  const user = userEvent.setup()
  render(<DashboardStep />)
  expect(screen.queryByText('bar')).toBeNull()

  await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))
  expect(screen.getByText('bar')).toBeTruthy()
  expect(screen.getByRole('button', { name: t('dashDomainCollapse', 'github.com') })).toBeTruthy()
})

it('再点同一行收起分布', async () => {
  const user = userEvent.setup()
  render(<DashboardStep />)
  await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))
  expect(screen.getByText('bar')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: t('dashDomainCollapse', 'github.com') }))
  expect(screen.queryByText('bar')).toBeNull()
})

it('点另一域名时前一行收起', async () => {
  const user = userEvent.setup()
  render(<DashboardStep />)
  await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))
  await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'bilibili.com') }))

  expect(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') })).toBeTruthy()
  expect(screen.getByRole('button', { name: t('dashDomainCollapse', 'bilibili.com') })).toBeTruthy()
})

it('访问栏的行点了不展开', async () => {
  const user = userEvent.setup()
  contains.mockResolvedValue(false)
  request.mockResolvedValue(true)
  search.mockResolvedValue([
    { url: 'https://github.com/x', visitCount: 20 },
  ])

  render(<DashboardStep />)
  await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
  await user.click(await screen.findByRole('button', { name: t('dashHistoryAllow') }))
  expect(await screen.findByText('github.com')).toBeTruthy()
  expect(screen.queryByRole('button', { name: t('dashDomainExpand', 'github.com') })).toBeNull()
})
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
npm test -- tests/sidepanel/DashboardStep.test.tsx
```

Expected: FAIL — no expand buttons. Existing ranking / history / top-N tests must still be in the file.

- [ ] **Step 4: Implement accordion rows**

In `DashboardStep.tsx`:

1. Import `folderDistribution` from `@/core/domains`.
2. Bookmarked branch:

```tsx
<DomainList key={String(topN)} rows={bookmarked} tree={tree} />
```

3. `VisitedBody` keeps `<DomainList rows={rankDomains(state.items, topN)} />` — no `tree`.
4. Replace `DomainList` / `DomainRow` with:

```tsx
function DomainList({ rows, tree }: { rows: DomainRank[]; tree?: BookmarkNode[] }) {
  const [openDomain, setOpenDomain] = useState<string | null>(null)
  const max = rows[0]?.count ?? 0
  return (
    <ol className="space-y-3" aria-label={t('dashListLabel')}>
      {rows.map((row) => (
        <DomainRow
          key={row.domain}
          row={row}
          max={max}
          tree={tree}
          open={openDomain === row.domain}
          onToggle={() => setOpenDomain((prev) => prev === row.domain ? null : row.domain)}
        />
      ))}
    </ol>
  )
}

function DomainRow({
  row,
  max,
  tree,
  open,
  onToggle,
}: {
  row: DomainRank
  max: number
  tree?: BookmarkNode[]
  open: boolean
  onToggle: () => void
}) {
  const pct = max === 0 ? 0 : (row.count / max) * 100
  const expandable = tree !== undefined
  const shares = open && tree !== undefined ? folderDistribution(tree, row.domain) : []
  const shareMax = shares[0]?.count ?? 0
  const summary = (
    <>
      <DomainIcon domain={row.domain} pageUrl={row.sampleUrl} />
      <span className="w-[38%] min-w-0 truncate text-[13px] text-neutral-700" title={row.domain}>
        {row.domain}
      </span>
      <div className="h-2 min-w-0 flex-1 rounded-full bg-neutral-100">
        <div
          className="h-2 rounded-full bg-blue-500"
          style={{ width: `${pct}%`, minWidth: row.count > 0 ? 6 : 0 }}
        />
      </div>
      <span className="min-w-8 shrink-0 text-right text-[13px] tabular-nums text-neutral-800">
        {row.count}
      </span>
    </>
  )
  return (
    <li>
      {expandable ? (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          aria-expanded={open}
          aria-label={t(open ? 'dashDomainCollapse' : 'dashDomainExpand', row.domain)}
          onClick={onToggle}
        >
          {summary}
        </button>
      ) : (
        <div className="flex items-center gap-2.5">{summary}</div>
      )}
      {open && (
        <ol className="mt-2 space-y-2 pl-7">
          {shares.map((share) => {
            const sharePct = shareMax === 0 ? 0 : (share.count / shareMax) * 100
            const label = share.path.join(' / ')
            return (
              <li key={share.folderId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500" title={label}>
                  {label}
                </span>
                <div className="h-1.5 w-16 shrink-0 rounded-full bg-neutral-100">
                  <div
                    className="h-1.5 rounded-full bg-blue-400"
                    style={{ width: `${sharePct}%`, minWidth: share.count > 0 ? 4 : 0 }}
                  />
                </div>
                <span className="min-w-6 shrink-0 text-right text-[12px] tabular-nums text-neutral-600">
                  {share.count}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </li>
  )
}
```

Do not put `openDomain` in zustand. Do not wrap visited rows in the expand button.

- [ ] **Step 5: Run dashboard and locale tests**

Run:

```bash
npm test -- tests/sidepanel/DashboardStep.test.tsx tests/i18n/locales.test.ts tests/core/domains.test.ts
```

Expected: PASS. Existing dashboard cases still pass (`getAllByRole('listitem')` counts only un-expanded domain rows). Locale key sets stay equal.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/steps/DashboardStep.tsx tests/sidepanel/DashboardStep.test.tsx public/_locales/zh_CN/messages.json public/_locales/en/messages.json
git commit -m "feat: expand dashboard domains into folder shares"
```

If `DashboardStep.tsx` / its test file / dashboard locale keys are still untracked from the stats-tab work, include those files in this commit so the expand feature is not stranded on an uncommitted page.

---

### Task 3: Verify

**Files:** none new.

- [ ] **Step 1: Run the related tests and typecheck**

```bash
npm test -- tests/core/domains.test.ts tests/sidepanel/DashboardStep.test.tsx tests/i18n/locales.test.ts
npx tsc --noEmit
```

Expected: PASS / no errors.

- [ ] **Step 2: Spec checklist**

- [x] Click bookmarked domain → inline path + counts
- [x] Full path, aggregate by folder id
- [x] Accordion
- [x] Visited rows static
- [x] No Browse navigation, no per-bookmark list, no persist
- [x] `sanitizeUrl` / www merge
- [x] Empty-title root skipped
- [x] Counts sum to that domain's bookmarks
- [x] Top N remount clears open row (`key={String(topN)}`)

If a box would be unchecked, fix in the task that owns it — do not add a fourth task.

- [ ] **Step 3: No extra commit unless Step 1 required a fix**

If tests already pass, leave the two feature commits unchanged.
