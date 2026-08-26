# Semantic Organization Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skill repositories a standalone semantic category, keep Claude classification content-driven, and prevent fallback structures from crossing semantic or selected-root boundaries.

**Architecture:** Add a small deterministic semantic signal layer shared by tag extraction and classification. Run hard signals before cache reuse, then normalize only the explicit `技能`/`Skills` topic in the generated folder design. Rework `其他` promotion to use real folder identity per selected root, while preserving existing structural move/apply/undo contracts.

**Tech Stack:** TypeScript 5.9, Vitest, React/Vite extension pipeline, existing `core`/`llm` pure functions and `engine` bookmark ports.

## Global Constraints

- Exclude `examples/` from all architectural analysis and implementation decisions.
- Skill repositories are detected only on GitHub/GitLab using `skill` or `skills` title/path tokens.
- Claude alone is not evidence that a bookmark is a skill.
- Hard semantic rules must run before cache lookup; a hard signal with no unique target bypasses stale cache and falls through to model classification.
- `技能`/`Skills` must be a top-level folder; unrelated generated hierarchy remains unchanged.
- `其他`/`Other` direct children are promoted per actual selected root and never across roots.
- Ambiguous same-named leaf folders must not be resolved by first-in-list order.
- Do not modify natural numeric folder handling or broad taxonomy regrouping in this plan.
- Every production change follows red-green-refactor with a focused failing test first.

---

### Task 1: Add deterministic skill semantics and cache precedence

**Files:**
- Modify: `src/core/rules.ts` — add the shared skill signal and hard classification result.
- Modify: `src/core/map.ts` — require unique deterministic leaf matches.
- Modify: `src/llm/tags.ts` — force extracted skill repositories to the canonical topic.
- Modify: `src/llm/classify.ts` — evaluate hard rules before cache and version semantic cache keys.
- Test: `tests/core/rules.test.ts`
- Test: `tests/core/map.test.ts`
- Test: `tests/llm/tags.test.ts`
- Test: `tests/llm/classify.test.ts`

**Interfaces:**
- Produces `SKILL_TOPIC: Record<Locale, string>` with `{ zh_CN: '技能', en: 'Skills' }`.
- Produces `isSkillBookmark(item: BookmarkItem): boolean`.
- `classifyByRules()` returns a hard `RuleResult` for skill repositories with the locale-specific skill tag.
- `cacheKey()` includes a semantic rule version constant.

- [ ] **Step 1: Write the failing rule and extraction tests**

Add tests covering the observable contract:

```ts
it('skill 仓库识别为独立技能类型', () => {
  const result = classifyByRules(
    item('https://github.com/op7418/Claude-to-IM-skill', 'Claude-to-IM-skill'),
    'zh_CN',
  )!
  expect(result.tags).toEqual(['技能'])
  expect(result.resourceType).toBe('tool')
})

it('模型把 skill 仓库写成 Claude 时仍输出技能', async () => {
  const result = await extractTags(
    [item('https://github.com/op7418/Claude-to-IM-skill')],
    clientReturning({ results: [{ bookmark_id: '1', primary_topic: 'Claude' }] }),
  )
  expect(result[0]!.primaryTopic).toBe('技能')
})
```

Add a cache regression where a cached `Claude` target exists while a `技能` candidate is available. The expected result must use the hard rule target and must not call the model.

- [ ] **Step 2: Run focused tests and verify they fail for the intended reason**

Run:

```bash
npx vitest run tests/core/rules.test.ts tests/llm/tags.test.ts tests/llm/classify.test.ts -t 'skill|技能|缓存'
```

Expected: the new skill tests fail because no shared skill signal exists and cached results are currently checked first. Existing unrelated tests must not be changed to make this failure pass.

- [ ] **Step 3: Implement the shared skill signal**

In `src/core/rules.ts`:

```ts
export const SKILL_TOPIC: Record<Locale, string> = { zh_CN: '技能', en: 'Skills' }

export function isSkillBookmark(item: BookmarkItem): boolean {
  const url = sanitizeUrl(item.url)
  if (url === null || (url.domain !== 'github.com' && url.domain !== 'gitlab.com')) return false
  return /(?:^|[-_\s/.])skills?(?:$|[-_\s/.])/i.test(`${item.title} ${url.path}`)
}
```

Run this check before the generic GitHub rule in `classifyByRules()` and return the canonical skill tag. Keep ordinary `claude.ai`, Claude API, and non-repository skill titles on the normal path.

- [ ] **Step 4: Normalize tag extraction and cache precedence**

In `src/llm/tags.ts`, after `runExtraction()` returns, map matching items to `{ primaryTopic: SKILL_TOPIC[locale], secondaryTopic: null }` without changing other tags.

In `src/llm/classify.ts`:

1. Define `const SEMANTIC_RULE_VERSION = 2`.
2. Include it in `cacheKey()` input.
3. In the item loop, run `classifyByRules()` first.
4. Resolve a hard rule only when its candidate match is unique.
5. If the item has a hard semantic signal but no unique candidate, skip cache lookup and send it through normal model classification.
6. For items without a hard signal, retain the current cache → model flow.

In `src/core/map.ts`, collect all leaf candidates matching each rule tag and return a deterministic classification only for exactly one match. Multiple matches return `null` so the classifier reaches the model path.

- [ ] **Step 5: Run focused tests and refactor only after green**

Run:

```bash
npx vitest run tests/core/rules.test.ts tests/llm/tags.test.ts tests/llm/classify.test.ts
```

Expected: all focused tests pass, including the stale-cache regression. Keep the rule logic in `core/rules.ts`; do not duplicate skill detection in `llm/tags.ts` or `llm/classify.ts`.

- [ ] **Step 6: Commit the task**

```bash
git add src/core/rules.ts src/core/map.ts src/llm/tags.ts src/llm/classify.ts \
  tests/core/rules.test.ts tests/core/map.test.ts tests/llm/tags.test.ts tests/llm/classify.test.ts
git commit -m "fix: prioritize skill semantics over model labels"
```

---

### Task 2: Enforce top-level Skills in folder design

**Files:**
- Modify: `src/llm/folders.ts` — normalize the final `FolderDesign` mapping and folder list.
- Modify: `src/llm/prompts.ts` — reinforce the semantic boundary in Chinese and English design prompts.
- Test: `tests/llm/folders.test.ts`

**Interfaces:**
- Add pure helper `normalizeSkillDesign(design: FolderDesign, locale: Locale): FolderDesign`.
- The helper receives a complete `FolderDesign` and returns a new design; it must not mutate the input.
- `mapping.get(normalizeName(SKILL_TOPIC[locale]))` must be either `[技能]` or `[Skills]`, never a two-segment path.

- [ ] **Step 1: Write the failing folder-design tests**

Add a test with a model design that maps `技能` under `神经网络模型`:

```ts
it('技能被模型放到神经网络模型下时提升为一级', () => {
  const design = {
    folders: [{ title: '神经网络模型', children: ['技能'] }],
    mapping: new Map([['技能', ['神经网络模型', '技能']]]),
  }
  const normalized = normalizeSkillDesign(design, 'zh_CN')
  expect(normalized.mapping.get('技能')).toEqual(['技能'])
  expect(normalized.folders.some((folder) => folder.title === '技能')).toBe(true)
})
```

Also assert that a normal `Claude Code` mapping and unrelated child folders remain unchanged.

- [ ] **Step 2: Run the folder-design tests and verify the new test fails**

Run:

```bash
npx vitest run tests/llm/folders.test.ts -t '技能|Claude Code'
```

Expected: the new test fails because final folder design currently accepts the model’s two-level mapping unchanged.

- [ ] **Step 3: Implement pure design normalization**

After `requestDesign()` produces a valid design and before `logAdopted()`/`applyDesign()` consumes it:

1. Find the canonical skill mapping key with `normalizeName(SKILL_TOPIC[locale])`.
2. If it is already one level, return an equivalent design.
3. If it is nested, replace its mapping with `[SKILL_TOPIC[locale]]`.
4. Remove only the skill child entry from its old parent’s `children` list.
5. Add a top-level `技能`/`Skills` folder entry if one does not already exist.
6. Do not move or rename unrelated topics.
7. Return fresh arrays/maps; do not mutate the model result.

Update `foldersPrompt()` in both locales to state that reusable skill repositories form a standalone top-level category and must not be nested under Claude or neural-model folders. Keep this as reinforcement, not enforcement.

- [ ] **Step 4: Run focused tests and verify non-skill behavior**

Run:

```bash
npx vitest run tests/llm/folders.test.ts tests/llm/tags.test.ts
```

Expected: the nested skill mapping is flattened, normal Claude Code topics remain content-driven, and existing folder-design validation tests stay green.

- [ ] **Step 5: Commit the task**

```bash
git add src/llm/folders.ts src/llm/prompts.ts tests/llm/folders.test.ts
git commit -m "fix: keep skills at the top level"
```

---

### Task 3: Make Other promotion root-safe and promote all non-empty children

**Files:**
- Modify: `src/core/audit.ts` — use actual folder identity and selected-root grouping for fallback promotion.
- Modify: `src/background/handlers.ts` — pass real root/folder identity and preserve promotion results.
- Modify: `src/core/plan.ts` — carry structural folder moves into plans without tying them to bookmark acceptance.
- Modify: `src/engine/apply.ts` — execute structural moves with folder-specific failure reporting.
- Test: `tests/core/promote.test.ts`
- Test: `tests/background/promote-wiring.test.ts`
- Test: `tests/engine/apply.test.ts`

**Interfaces:**
- `PromoteInput` consumes `rootIds`, `existingFolders` containing `{ id, parentId, index }`, and `bookmarkCountByFolder: ReadonlyMap<string, number>` for existing folder ids.
- `PromoteResult` produces `folderMoves: FolderMoveSpec[]` and `warnings: string[]` in addition to candidates, newFolders, classifications, and promoted details.
- `BookmarkOperation` supports `move_folder` with `{ folderId, fromParentId, originalIndex, toParentId }`.
- `buildPlan()` accepts optional `folderMoves` and emits them before bookmark moves.

- [ ] **Step 1: Write failing multi-root and small-child tests**

Add a core test with two roots, each containing an `Other/Topic` path and at least one classified bookmark. Assert each move targets its own root parent.

Add a test proving a non-empty child with fewer than `MIN_FOLDER_BOOKMARKS` is still promoted, while an empty child is not.

Add an engine test that applies a generated `move_folder` operation and verifies the actual tree parent changes.

- [ ] **Step 2: Run focused tests and verify the regressions fail**

Run:

```bash
npx vitest run tests/core/promote.test.ts tests/background/promote-wiring.test.ts tests/engine/apply.test.ts -t '多范围|跨根|小于|结构移动'
```

Expected: the two-root test either promotes both roots through one fallback or generates the wrong parent; the non-empty small-child test fails to promote; the empty-child test remains unchanged; the operation test fails because the new operation path is not fully wired.

- [ ] **Step 3: Implement root-identity-aware promotion**

1. Index existing folder placements by id.
2. Identify each direct `Other` candidate by its actual parent id in `rootIds`, not only by path length.
3. For each fallback independently, select only candidates whose real parent/path position is that fallback.
4. Promote every direct child with actual bookmark count greater than zero. For existing folders, read the count from the supplied bookmark-count map; for temporary folders, count classifications targeting that folder. Keep empty directories for existing cleanup.
5. Lift descendants by removing the fallback segment from their path while preserving any root prefix.
6. For new child folders, update `parentId`/`parentTemporaryId` as before.
7. For existing child folders, emit one `FolderMoveSpec` to that fallback’s actual parent.
8. If identity or destination is unknown, add a bilingual warning and emit no move for that child; never use another root as fallback.

- [ ] **Step 4: Wire and execute structural folder moves**
In `handlers.ts`, always pass `roots.map(r => r.id)`, the scanned folder placements, and `bookmarkCountByFolder` built from `scan.bookmarks` to promotion, including additive mode. Log every returned warning and pass `folderMoves` into `buildPlan()`.


In `plan.ts`, preserve structural moves in `filterAccepted()` and `renumberPlan()` independently from bookmark acceptance. Do not turn them into bookmark rows.

In `engine/apply.ts`, execute `move_folder` via `ports.bookmarks.move(folderId, { parentId: toParentId })` and wrap failure with a bilingual folder-move error. Keep create-folder operations before structural moves and bookmark moves after them.

- [ ] **Step 5: Run focused tests and verify all promotion paths**

Run:

```bash
npx vitest run tests/core/promote.test.ts tests/background/promote-wiring.test.ts tests/engine/apply.test.ts
```

Expected: both roots retain their own children, all non-empty Other children are siblings of Other, actual apply changes folder parents, and existing rebuild promotion tests remain green.

- [ ] **Step 6: Commit the task**

```bash
git add src/core/audit.ts src/background/handlers.ts src/core/plan.ts src/engine/apply.ts \
  tests/core/promote.test.ts tests/background/promote-wiring.test.ts tests/engine/apply.test.ts
git commit -m "fix: make Other promotion root-safe"
```

---

### Task 4: Run final semantic regression and build verification

**Files:**
- Test only: existing focused and full test suites.
- Verify: `docs/superpowers/specs/2026-08-25-semantic-organization-boundaries-design.md`

- [ ] **Step 1: Run the complete test suite**

```bash
npm test
```

Expected: all test files and tests pass with no new warnings.

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: TypeScript emits no errors and Vite completes successfully.

- [ ] **Step 3: Verify the acceptance scenarios**

Confirm the test output covers:

- skill repositories overriding stale Claude cache;
- non-skill Claude content remaining content-driven;
- nested Skills normalized to top level;
- Other children promoted per root without cross-root moves;
- ambiguous same-name leaves falling through to the model;
- candidate paths, plan operations, apply behavior, and undo remaining consistent.

- [ ] **Step 4: Check scope and working tree**

Confirm no task modified natural numeric folder handling, broad taxonomy regrouping, or `examples/`. Confirm unrelated pre-existing worktree changes remain unstaged.
