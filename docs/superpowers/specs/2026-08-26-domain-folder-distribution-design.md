# 看板域名行：文件夹分布

日期：2026-08-26
状态：设计已确认，待实现计划

## 背景

看板「来源域名 Top N」按站点计数。`github.com 260` 说明数量，看不出这 260 条落在哪些书签文件夹。域名行目前是静态 `<li>`，不能点。

## 已确认需求

- 点「书签」栏的域名行，行内展开该域名在各文件夹的分布。
- 文件夹用完整路径（`书签栏 / 开发 / GitHub`），按文件夹 id 聚合，同名不同处分开。
- 同时只开一行（手风琴）。再点同一行收起。
- 「访问」栏没有文件夹，行保持静态。
- 不跳到「浏览书签」，不在展开区列出单条书签。

## 非目标

- 跨模式跳转、定位到具体文件夹。
- 展开态持久化。
- 给「访问」排行编造路径。
- 改 `rankDomains` 的计数口径。

## 数据

`src/core/domains.ts` 新增纯函数，零浏览器依赖。看板只消费结果。

```ts
export interface FolderShare {
  folderId: string
  path: string[]  // ['书签栏', '开发', 'GitHub']
  count: number
}

export function folderDistribution(
  tree: BookmarkNode[],
  domain: string,
): FolderShare[]
```

走树带着路径栈。节点有 url 且 `sanitizeUrl(url)?.domain === domain` 时，计入**当前父文件夹**（路径不含书签标题）。无法解析或非 http(s) 的 url 跳过，与 `rankDomains` 同一套 `sanitizeUrl`（小写、剥 `www.`）。

路径规则：

- 跳过标题为空的节点。Chrome 根节点 `id: '0'` 标题为空，不进路径。
- 根文件夹下的书签路径就是该根名（`['书签栏']`）。
- 按 `folderId` 聚合。排序：`count` 降序，同数按 `path.join('\0')` 升序。

对同一棵树，「书签」栏里某域名的 `FolderShare.count` 之和等于该域名的 `DomainRank.count`。

## UI

只改 `DashboardStep`。「书签」那栏把 `tree` 传进 `DomainList`；「访问」那栏不传。

- `DomainList` 记 `openDomain: string | null`。点另一行时关上当前行。
- 可展开的行是 `<button>`，`aria-expanded`，文案走 i18n（展开 / 收起该域名的文件夹分布）。
- 展开区：`folderDistribution(tree, domain)`，路径 ` / ` 拼接，过长 truncate，`title` 给完整路径；右侧条数；细 bar 相对**该域名内**最大 `FolderShare.count`。
- 不可展开的行（访问栏）保持现在的 `<li>`，无按钮、无 `aria-expanded`。
- 切到「访问」或改 Top N 时清掉 `openDomain`。

不进 zustand。

## 测试

`tests/core/domains.test.ts`：

1. 同一域名、两个路径 → 两行，路径完整。
2. `www.github.com` 与 `github.com` 计入同一 `domain`。
3. 根下书签路径 = 根文件夹名；空标题根不进路径。
4. 按条数降序；同数按路径稳定。
5. 无关域名、非 http(s) 不进结果。
6. 各行 `count` 之和等于该域名在树上的书签数。

`tests/sidepanel/DashboardStep.test.tsx`：

1. 点书签栏某域名 → 看到对应路径和条数。
2. 再点同一行 → 分布消失。
3. 点另一域名 → 前一行收起。
4. 「访问」栏的行点了不展开。

## 文件

| 文件 | 改动 |
|---|---|
| `src/core/domains.ts` | `FolderShare` + `folderDistribution` |
| `src/sidepanel/steps/DashboardStep.tsx` | 书签行可展开 |
| `public/_locales/{zh_CN,en}/messages.json` | 展开/收起 aria |
| `tests/core/domains.test.ts` | 纯函数 |
| `tests/sidepanel/DashboardStep.test.tsx` | 展开交互 |