# Semantic Organization Boundaries Design

## Problem

The organization pipeline can classify content by an attached brand or model name instead of by what the bookmark contains. Skill repositories such as `Claude-to-IM-skill` can therefore enter a Claude or neural-model folder. Existing fallback promotion also relies on relative paths, which is unsafe when multiple selected roots contain identically named `Other` folders.

The design separates content semantics from brand names and adds narrow structural guards. It does not redesign the entire taxonomy or change numbering behavior.

## Goals

- Classify reusable skill repositories as a standalone `技能` / `Skills` type.
- Keep Claude-related content content-driven: skill repositories become `技能`; Claude product, model, API, documentation, and tool content remains eligible for their actual semantic categories.
- Prevent `技能` / `Skills` from being nested under `Claude`, `神经网络模型`, or `LLM` folders.
- Treat `其他` / `Other` as a final fallback, not as a parent for structured topics.
- Promote non-empty direct children of `其他` to that folder's sibling level, independently for each selected root.
- Make deterministic semantic rules take precedence over stale classification cache entries.
- Avoid auto-selecting among same-named leaf folders under different parents.

## Non-goals

- Repairing natural numeric folder names or redesigning numbering safeguards.
- Renaming or globally regrouping ordinary categories such as GitHub, Redis, or FastAPI.
- Solving subjective fine-grained knowledge taxonomy decisions that require model judgment.
- Adding a general-purpose taxonomy ontology.

## Semantic Signals

Add a deterministic skill signal for GitHub and GitLab bookmarks:

- Inspect sanitized repository path and bookmark title.
- Match `skill` or `skills` as a path/title token, including hyphen, underscore, whitespace, slash, or dot boundaries.
- Do not match arbitrary non-repository URLs solely because their title contains `skill`.
- Return the locale-specific topic `技能` / `Skills`.
- Use a tool/repository-like resource classification and a clear deterministic reason.

The skill signal is deliberately narrower than a Claude rule. `Claude` alone is not evidence that a bookmark is a skill.

## Classification and Cache Precedence

The classification pipeline becomes:

```text
hard semantic rule
  -> unique candidate resolution
  -> cache lookup only for items without a hard rule
  -> model classification
```

A hard rule must run before reading a cached classification. If it resolves to a unique candidate, that target is used. If it has no unique candidate, the item bypasses cache and continues to model classification; a stale cached Claude target must never override the skill signal. The cache version must also include a semantic-rule version so future rule changes cannot reuse incompatible model results.

If a hard semantic signal has no unique matching candidate, it must not invent a target. The extracted topic remains available for rebuild-time folder design, while classification falls through to the model without consulting the stale cache.

For deterministic candidate resolution:

- A single leaf match is eligible for direct routing.
- Multiple matching leaves under different parents are ambiguous and must not be resolved by first-in-list order.
- Ambiguous items continue to model classification.

## Topic Extraction and Folder Design

The tag extraction output is normalized after model extraction:

- Skill-marked repositories always receive `primaryTopic = 技能 / Skills` and no secondary topic.
- The model may still classify non-skill Claude content by its actual subject.
- The tag prompt explicitly describes this boundary as a reinforcement, not as the sole enforcement mechanism.

After folder design, a narrow normalization pass enforces structural invariants:

1. Locate mappings for `技能` / `Skills`.
2. If the model placed the topic under a child path, promote it to a top-level folder.
3. Update the folder list, topic mapping, candidate paths, and classifications together.
4. Leave unrelated model-created hierarchy unchanged.

This pass must preserve the existing folder count and minimum-size checks; it only changes the parent boundary of the explicit skill type.

## Other Promotion

`Other` promotion must use folder identity, not only relative candidate paths.

For each actual selected root independently:

1. Find that root's direct `Other` candidate by folder id and parent id.
2. Find only direct child candidates whose real parent is that `Other` folder.
3. Promote each non-empty direct child to the selected root's level.
4. Move descendants with their promoted parent.
5. Rewrite candidate paths and classification reasons consistently.
6. Never move a child from root B to root A merely because both relative paths are `Other/Topic`.

Promotion failures are non-fatal. If parent identity or destination identity cannot be proven, leave the structure unchanged and emit a warning. No cross-root move is allowed as a fallback.

The existing minimum-folder-size policy is not used for this semantic boundary: a non-empty explicit child of `Other` is a structured topic and is promoted. Empty directories remain untouched by this pass and are handled by existing empty-folder cleanup.

## Error Handling

- Stale cache entries cannot override hard semantic rules.
- Missing `技能` candidates do not produce fabricated ids.
- Ambiguous same-name candidates do not trigger blind movement.
- Missing folder identity in multi-root promotion causes a no-op plus a warning.
- A failed structural move reports the folder-specific failure but does not silently move the folder to another root.
- Existing snapshot/undo behavior must continue to restore any successful structural moves.

## Testing

### Semantic rules

- `Claude-to-IM-skill` and `logo-generator-skill` classify as `技能`.
- A normal `claude.ai` bookmark is not forced into `技能`.
- A Claude API or documentation URL remains eligible for its normal semantic category.
- Non-GitHub/GitLab titles containing `skill` do not trigger the repository rule.

### Cache

- A cached Claude target is overridden when the current item matches the skill rule.
- A changed semantic-rule version invalidates the old cache key.
- A skill item without a unique Skills candidate continues to model classification without an invalid target.

### Structure

- A model mapping `技能` below `神经网络模型` is normalized to a top-level candidate.
- `Other/Skills` is promoted to the same root level.
- Two selected roots with `Other/Topic` each promote only within their own root.
- Same-named leaf folders under different parents do not receive automatic rule routing.
- Candidate paths, folder operations, plan rows, apply behavior, and undo remain consistent after promotion.

## Acceptance Criteria

The design is complete when:

1. Skill repositories cannot remain under Claude or neural-model folders because of stale cache or model output.
2. Claude non-skill content is not blanket-classified as Skills.
3. `Other` direct children are never moved across selected roots.
4. Ambiguous same-named rule targets are not silently routed to the first candidate.
5. All new behavior has focused regression tests and the existing suite/build remain green.
