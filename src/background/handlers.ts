import { currentLocale, resolveLocale, setLocale, t } from '@/i18n'
import { buildCandidatesFromFolders, stripNumberPrefix } from '@/core/map'
import type { Locale } from '@/core/locale'
import { buildPlan, type NewFolderSpec, type RenameFolderSpec } from '@/core/plan'
import { MIN_FOLDER_BOOKMARKS, pruneReason, pruneSmallFolders } from '@/core/prune'
import { findScopeRoots, scanTree } from '@/core/scan'
import { detectMode } from '@/core/mode'
import { planTitleRewrites } from '@/core/titles'
import { buildCategoryTree } from '@/core/tree'
import { deriveShape, depthGuard, MAX_LEAF, SHAPE_MAX_SIBLINGS } from '@/core/shape'
import { matchDomainGroup } from '@/core/domainGroups'
import { clusterHomeless, dropAlreadyGrouped, planNewFolders, MIN_NEW_FOLDER_SIZE } from '@/core/newTopics'
import type { Ports } from '@/core/ports'
import type { Classification, OrganizePlan, TagResult } from '@/core/types'
import { applyPlan } from '@/engine/apply'
import { loadSnapshot } from '@/engine/snapshot'
import { undoLast } from '@/engine/undo'
import { createLlmClient, type LlmClient, type LlmConfig } from '@/llm/client'
import { isModelConfigured } from '@/llm/config'
import { classifyBookmarks } from '@/llm/classify'
import { collectTopics, designTagFolders, nameMergedFolder, nameNewTopics } from '@/llm/folders'
import { extractTags, refineGroupTags } from '@/llm/tags'
import { DEFAULT_SETTINGS, loadCache, loadSettings, saveCache, saveSettings } from '@/storage/settings'
import { findBookmarksBar } from '@/core/import'
import { importTree } from '@/engine/importTree'
import type { EmitProgress, ProgressPhase } from './events'
import type { Request, Response } from './messages'

export interface HandlerDeps {
  createClient?: (config: LlmConfig, locale: Locale) => LlmClient
  now?: () => number
  /** 仅供测试注入，生产环境使用 classifyBookmarks 的默认值。 */
  batchSize?: number
  /** 把进度与日志推回侧栏。 */
  onEvent?: EmitProgress
  /** 用户是否点了取消。分析在批次之间检查它。 */
  isCancelled?: () => boolean
}

export async function handle(
  ports: Ports,
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const createClient = deps.createClient ?? ((config: LlmConfig, locale: Locale) => createLlmClient(config, locale))
  const now = deps.now ?? (() => Date.now())
  const emit = deps.onEvent ?? ((): void => {})
  const log = (phase: ProgressPhase, message: string, level: 'info' | 'warn' | 'error' = 'info'): void =>
    emit({ phase, message, level })
  const progress = (phase: ProgressPhase) => (done: number, total: number): void =>
    emit({ phase, message: '', done, total })
  const isCancelled = deps.isCancelled ?? ((): boolean => false)
  // 每个请求进来先读设置再定语言：t() 是模块级状态，不先设好就会用上一次请求
  // 留下的语言。这一次读到的 settings 下面各分支直接复用，不重复读。
  // 读不到设置只该影响语言，不该把与设置无关的请求（get_tree/undo/import）一起打挂——
  // 那些请求改造前根本不碰存储，抛出去的还是没经过翻译的原文。
  const settings = await loadSettings(ports).catch(() => DEFAULT_SETTINGS)
  setLocale(resolveLocale(settings.uiLocale))
  // 这份 locale 是本次请求的常量，传给 core/llm 后不受后续 setLocale 影响：
  // 用户在分析跑到一半时改语言，产出的目录名、提示词、规则理由仍然同源；
  // 会跟着切的只有 t() 取的日志与错误文案，而且是剩下的整段分析都跟着切，
  // 不是一瞬——analyze 可以跑好几分钟。只影响文案，不产生半中半英的数据。
  const locale = currentLocale()
  const CANCELLED: Response = { ok: false, error: t('errAnalysisCancelled'), cancelled: true }

  try {
    switch (request.kind) {
      case 'get_tree':
        return { ok: true, kind: 'get_tree', tree: await ports.bookmarks.getTree() }

      case 'scan': {
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)
        log('scan', t('logScanDone', String(scan.stats.totalBookmarks), String(scan.stats.totalFolders)))
        return { ok: true, kind: 'scan', scan }
      }

      case 'analyze': {
        // 本机模型服务器不校验 Key，所以这里问的是「模型配好了没有」而不是「有没有 Key」，
        // 与选范围页、偏好页共用同一个谓词——三处各判各的时，本地 Ollama 用户会被卡在
        // 一个界面已经放行、后台仍然拒收的缝里
        if (!isModelConfigured(settings.llm)) {
          return { ok: false, error: t('errNoApiKey') }
        }
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)
        // findScopeRoots 按书签树顺序返回，确定性；
        // 直接取 scopeRootIds[0] 拿到的是用户的点击顺序，先点子目录时甚至不是真正的根
        const roots = findScopeRoots(tree, request.scopeRootIds)

        // 走哪条路由产品自己判，不推给用户拨开关（见 issues/14-mode-detection.md）。
        // 判断只看这次扫描的结果，与设置无关；用户在偏好页推翻时才带 modeOverride 过来。
        const decision = detectMode(scan, locale)
        const rebuild = (request.modeOverride ?? decision.mode) === 'rebuild'
        // 日志跟着实际走的模式说话，不跟着「是否推翻」说话——modeOverride 的类型两个
        // 方向都收得下（后台自身的测试大量靠传 'additive' 把模式钉死），一旦只认
        // 「带了 override 就说重新设计」，传 'additive' 的调用点就会让这行日志说假话。
        // 推翻时把原判断的理由也缀上，方便用户事后翻日志看出自己否掉了什么、凭什么。
        log('scan', request.modeOverride !== undefined
          ? t(rebuild ? 'logModeOverriddenRebuild' : 'logModeOverriddenAdditive', decision.reason)
          : t(decision.mode === 'rebuild' ? 'logModeRebuild' : 'logModeAdditive', decision.reason))

        const client = createClient(settings.llm, locale)
        // 候选目录要排除的是「范围根自己」，不是勾选界面级联勾上的整个 id 集合——
        // 勾书签栏会把它所有子目录的 id 也塞进 scopeRootIds，照单排除就是排除了一切，
        // 非推翻模式的候选表永远是空的（见 issues review C2）。roots 已经用
        // findScopeRoots 去重过父子，这里直接拿它的 id 集合。
        let candidates = buildCandidatesFromFolders(scan.folders, roots.map((r) => r.id))
        // 日志报「实际折叠掉几个」，不借用 scan.stats.duplicateFolderGroups——那是「组数」，
        // 范围根也算在内；候选却排除范围根，两个数字对不上（勾两个同名范围根时
        // stats 说 1 组、这里实际一个都没折叠）。用非根目录数减候选数，才是这次
        // buildCandidatesFromFolders 真的合并掉的数量。
        // 只在归入现有模式下打：推翻模式的候选来自下面的 buildCategoryTree，根本不经过
        // buildCandidatesFromFolders（这里算出的 candidates 会在 rebuild 分支里被整个
        // 覆盖），在那条路上打这句话说的是另一条代码路径发生的事，会误导用户。
        if (!rebuild) {
          const nonRootFolderCount = scan.folders.length - roots.length
          const foldedCount = nonRootFolderCount - candidates.length
          if (foldedCount > 0) {
            log('scan', t('logDuplicateFolders', String(foldedCount)))
          }
        }
        let newFolders: NewFolderSpec[] = []
        let renameFolders: RenameFolderSpec[] = []
        let pinned: Classification[] = []
        let tags: TagResult[] = []
        let planMergeRoot: NonNullable<OrganizePlan['mergeRoot']> | undefined

        if (rebuild) {
          const rootId = roots[0]?.id
          if (rootId === undefined) return { ok: false, error: t('errNoScope') }
          // 勾中「书签栏」这类永久目录表达的是「整理这里面」，不是「把这两个并起来」；
          // 它们也删不掉、父节点是不可见的 '0'，排除后所有边界情况一并消失
          const hasPermanent = roots.some((r) => (r.parentId ?? '0') === '0')
          const merging = roots.length >= 2 && !hasPermanent
          // 这批新目录会落在第几层，按绝对层级算（见 core/level.ts）：勾书签栏是 1、
          // 勾「其他书签」是 2。
          // 合并模式也是 +1 而不是 +2：新容器建在 roots[0] 的父目录下，占的正是
          // roots[0] 原来那一层，主题目录进容器后仍是 rootLevel + 1。
          // rootId 来自 roots[0]，而 scanTree 会把每个 root 自己也放进 folders，必然找得到；
          // 万一没有，?? 0 让它退回改造前的行为，而不是把整次分析弄崩
          const rootLevel = scan.folders.find((f) => f.id === rootId)?.level ?? 0
          const startLevel = rootLevel + 1
          // 规则命中是确定性的，在跑模型之前就数得出来——不花任何调用（票 10 补账第 3 条）
          const hitsByGroup = new Map<string, number>()
          if (settings.domainGroups.length > 0) {
            for (const bookmark of scan.bookmarks) {
              const group = matchDomainGroup(bookmark, settings.domainGroups)
              if (group === null) continue
              hitsByGroup.set(group.key, (hitsByGroup.get(group.key) ?? 0) + 1)
            }
          }
          // 一级位子现在是稀缺资源，装 1 条的「GitHub」不配占（第 4 条）。
          // 不够的组不建，那几条书签退回主题那一轮当普通书签处理。
          // 门槛与目录下限是同一个数：一个装不满的聚合组和一个装不满的主题目录，
          // 浏览成本上没有区别，没有理由给它们两套阈值
          const survivingGroups = settings.domainGroups.filter(
            (key) => (hitsByGroup.get(key) ?? 0) >= MIN_FOLDER_BOOKMARKS,
          )
          const droppedGroups = settings.domainGroups.length - survivingGroups.length
          if (droppedGroups > 0) {
            log('tree', t('logGroupsDropped', String(droppedGroups), String(MIN_FOLDER_BOOKMARKS)))
          }
          // 命中数 ≤ MAX_LEAF 的组，core/tree.ts 建树时会整组平铺、子目录一个都不建
          // （`bucket.length <= MAX_LEAF ? [] : …`）：跑 refineGroupTags 抽的细分标签
          // 派不上用场，全被丢弃。命中数在跑模型之前已经算好，跳过零成本
          // （见 final-review.md I2；llm/folders.ts 的组内目录设计同一个门槛，自行按
          // entries.length 判断，不需要这里再传一次）
          const groupsNeedingDesign = survivingGroups.filter(
            (key) => (hitsByGroup.get(key) ?? 0) > MAX_LEAF,
          )
          // N_主题 = N − Σ 存活组的命中数（第 5 条）
          const inGroups = survivingGroups.reduce((sum, key) => sum + (hitsByGroup.get(key) ?? 0), 0)
          const topicN = scan.bookmarks.length - inGroups
          // 目录的数量与层数由这次要整理的书签总数推导，不再由用户拨旋钮
          // （见 issues/10-shape-from-count.md「决定：方案 D」）。
          // 主题预算：挤到不能再挤，但绝不因为聚合组而让主题多分一层（第 6 条）
          const shape = deriveShape(topicN, depthGuard(survivingGroups.length, topicN))
          // 上限只管「要不要再往下分」，不阻止在勾中处建第一层：用户勾了这里就是要在这里
          // 整理，返回「一个目录都不建」看起来像坏了。层数看的是推导出的 shape.depth
          // 是否到了两层。曾经管这件事的 settings.maxFolderDepth 已随清单第 12 项删掉，
          // 存量存储里遗留的那个键也读都不读（见 storage/settings.ts 的旧旋钮名单）
          const allowChildren = shape.depth >= 2
          // shape.top 在三层（N > 1200）时是 0——票 10 有意把三层的分配留空，先兜底
          // 退回 SHAPE_MAX_SIBLINGS，不让「其他」以外的目录数塌成 0
          const topWithFallback = shape.top === 0 ? SHAPE_MAX_SIBLINGS : shape.top
          // 推导值是「要几个主题目录」，即 topWithFallback 个。「其他」是兜底桶，
          // 不是模型被要求去填的主题——传「推导值本身」让它从里面扣，真正承载书签的
          // 主题目录就只剩 topWithFallback − 1 个，占用变成 N/(topWithFallback − 1)，
          // 会把判准 A1（叶子 ≤ 20）顶破（复核实测：N ∈ [21,24]∪[181,200]∪[241,288]∪
          // [401,420] 时最坏一叶 24 条，见 final-review.md I1）。
          // 改成「其他」加在推导值之上：传 topWithFallback + 1。tree.ts／folders.ts
          // 已有的 `max − 1` 留位逻辑不变，+1 之后再 −1 正好还原出 topWithFallback 个
          // 主题目录，「其他」是白加的第 topWithFallback + 1 格，账不再从推导值里扣。
          // 代价：同层总数（主题 + 其他）因此最多到 topWithFallback + 1 = 11，破判准
          // A3（同层 ≤ 10）一个位子——这是有意的取舍，依据是 depthGuard 那节裁过的
          // 同一类判准优先级：同层多两个是线性代价（多扫两行），多一层是指数代价，
          // A3 是更软的那条；A1 被顶破意味着一个目录能摸到 24 条，逐层浏览时摸不动，
          // 是根尺子的直接失败。
          // 下限 2（原来的 Math.max(topWithFallback, 2)）在 +1 之后已经天然满足：
          // topWithFallback 最小是 1（N ≤ 12），+1 = 2，与原下限拍出的值相同，
          // 可以去掉这道 max。
          const maxTopFolders = topWithFallback + 1
          // 两层时二级目录（某个主题下的子目录）不该复用一级预算：一级预算回答的是
          // 「有几个主题」，二级要的是「每个主题下摊几个」——按方案 D 应为
          // ceil(shape.leaves / topWithFallback)（票 10 补账第 8 条）。三层
          // （N > 1200）时 topWithFallback 同样是那条路径唯一在用的「实际分支数」，
          // 用它当分母与一级预算的兜底口径一致。一层时这个值不会被用到
          // （allowChildren 为 false，tree.ts 不会往 children 里塞东西、
          // folders.ts 的提示词也要求只输出一层），算出来也无害。
          const maxChildFolders = Math.ceil(shape.leaves / topWithFallback)
          const containerTitle = merging ? undefined : roots.find((r) => r.id === rootId)?.title
          log('tags', t('logTagsStart', String(scan.bookmarks.length)))
          tags = await extractTags(scan.bookmarks, client, locale, {
            onProgress: progress('tags'),
            onLog: (message, level) => log('tags', message, level),
            isCancelled,
          })
          if (isCancelled()) return CANCELLED
          // 组内的共同点已经写在目录名上，通用标签在这里没有区分度，换一套细的重抽——
          // 只抽命中数过了 MAX_LEAF 门槛、真的会分子目录的那几个组
          if (groupsNeedingDesign.length > 0) {
            tags = await refineGroupTags(tags, scan.bookmarks, groupsNeedingDesign, client, locale, {
              onLog: (message, level) => log('tags', message, level),
              isCancelled,
            })
            if (isCancelled()) return CANCELLED
          }
          // 分批抽标签的模型看不到全局，同义碎片只能在这里归并
          log('tree', t('logTreeStart', String(scan.bookmarks.length)))
          tags = await designTagFolders(tags, scan.bookmarks, survivingGroups, client, locale, {
            onLog: (message, level) => log('tree', message, level),
            isCancelled,
            maxTopFolders,
            maxChildFolders,
            allowChildren,
            startLevel,
            ...(containerTitle === undefined ? {} : { containerTitle }),
            minFolderSize: MIN_FOLDER_BOOKMARKS,
          })
          if (isCancelled()) return CANCELLED
          let mergeRoot: { parentId: string; title: string } | undefined
          if (merging) {
            const sourceTitles = roots.map((r) => r.title)
            // 跨父目录（一个在书签栏、一个在其他书签）时落在树序第一个根的父目录下；
            // 同父时它就是那个共同父目录，两种情况写法相同
            const parentId = roots[0]!.parentId!
            const named = await nameMergedFolder(
              collectTopics(tags), sourceTitles, client, locale,
              { onLog: (message, level) => log('tree', message, level) },
            )
            if (isCancelled()) return CANCELLED
            // 兜底名字要去掉源目录名上的编号：模型那条路径 nameMergedFolder 已经剥过，
            // 这条不剥的话，对上一轮整理出的「01 前端」再整理会建出「NiceG + 01 前端」
            const title = named ?? sourceTitles.map(stripNumberPrefix).join(' + ')
            if (named === null) log('tree', t('logMergeNameFailed', title), 'warn')
            else log('tree', t('logMergeNamed', title))
            mergeRoot = { parentId, title }
          }
          const tree_ = buildCategoryTree({
            tags, rootId, existingFolders: scan.folders,
            bookmarks: scan.bookmarks, domainGroups: survivingGroups, locale,
            mergeRoot,
            maxTopFolders,
            maxChildFolders,
            allowChildren,
            minFolderSize: MIN_FOLDER_BOOKMARKS,
          })
          if (mergeRoot !== undefined && tree_.mergeRootTemporaryId !== null) {
            planMergeRoot = {
              temporaryId: tree_.mergeRootTemporaryId,
              title: mergeRoot.title,
              sourceRootIds: roots.map((r) => r.id),
              sourceTitles: roots.map((r) => r.title),
            }
          }
          candidates = tree_.candidates
          newFolders = tree_.newFolders
          renameFolders = tree_.renameFolders
          pinned = tree_.pinned
          log(
            'tree',
            t(
              'logTreeDone',
              String(tree_.newFolders.length),
              String(tree_.candidates.length - tree_.newFolders.length),
            ),
          )
          // 形状推导只给目标、不强制：分不开的主题模型自然给不出更细的子目录，
          // 确定性规则不该硬拆（见 issues/10-shape-from-count.md「其余几问」）。
          // 所以这里不做任何纠正，只把预算与实际并排记下来——将来拿真实库校准
          // 这组数字（甜点 12、上限 20、同层 10），唯一的依据就是这条日志。
          //
          // 报的是「真正传下去、真正生效」的那组数，不是 deriveShape 的原始返回
          // （shape.top / shape.depth）。原始值会在两端系统性说谎：N ≤ 12 时
          // shape.top = 1，实际预算是 topWithFallback + 1 = 2，那个 +1 是我们自己的
          // 下限造的、不是模型多给的，报原始值会被读成模型超产；N > 1200 时
          // shape.top 是占位符 0、shape.depth 是 3，而实际预算是
          // topWithFallback + 1 = 11、实际只会建 2 层（allowChildren 只开一层
          // children，不会真的递归出第三层），报原始值等于每次都打印一条两个数字
          // 都错的日志（见 final-review.md I2）。所以这里报 maxTopFolders
          // （真正传给 designTagFolders/buildCategoryTree 的预算）与
          // allowChildren 对应的实际层数。
          //
          // 一级目录 = 挂在范围根下的那些。两种模式挂法不同：合并模式挂在刚建的容器上
          // （parentTemporaryId 是容器的临时 id），非合并模式挂在范围根上
          // （parentTemporaryId 为 null、parentId 是 rootId）。
          //
          // 已知偏差（两条，都不影响「校准趋势」这个用途，够用）：
          // 1. 数的是新建的一级目录。复用已有目录时它不进 newFolders（走的是 candidates
          //    与 renameFolders），所以在「已有目录被复用」的库上这个数会偏小。
          // 2. 数的是挂在范围根/容器下的全部新目录，聚合组目录（domainSections）也在
          //    其中，而 maxTopFolders 只是主题那一侧的预算——勾了聚合组时这个数会偏大。
          const containerId = tree_.mergeRootTemporaryId
          const actualTop = tree_.newFolders.filter((f) =>
            containerId === null
              ? f.parentTemporaryId === null && f.parentId === rootId
              : f.parentTemporaryId === containerId,
          ).length
          const effectiveDepth = allowChildren ? 2 : 1
          log('tree', t('logShapeCompared', String(maxTopFolders), String(actualTop), String(effectiveDepth)))
          if (pinned.length > 0) {
            log('tree', t('logPinnedSkip', String(pinned.length)))
          }
        }

        // 「归入现有」却一个候选目录都没有。自动判断下够不着：detectMode 在没有任何
        // 非根目录时判 rebuild，而候选恰恰就是那批非根目录（buildCandidatesFromFolders
        // 排除的同样是范围根）。今天只有显式传 modeOverride: 'additive' 才走得到这里，
        // 留着当兜底。
        // 文案原先写着「请开启「重建结构」」——那个开关已随模式自动判断一起删掉，不能再往回指。
        if (candidates.length === 0) {
          return { ok: false, error: t('errNoTargetFolders') }
        }
        const cache = await loadCache(ports)
        // 已按域名确定归属的书签不必再花一次分类调用
        const pinnedIds = new Set(pinned.map((p) => p.bookmarkId))
        const toClassify = scan.bookmarks.filter((b) => !pinnedIds.has(b.id))
        log('classify', t('logClassifyStart', String(toClassify.length), String(candidates.length)))
        // 聚合组的目录（组根与组内子目录，都带 domainGroup 标记）不进候选：
        // 命中规则的书签已经由 pinned 定好去处，而没命中的书签不该有机会进去
        // ——组的子目录在候选里，模型就会往「01 GitHub」里塞腾讯云文档（票 10「为什么关组」）。
        // 只影响分类这一步：候选表本身照旧带着组目录，结果页与 prune 都还要用它。
        // 非推翻模式的候选来自 buildCandidatesFromFolders，从不打这个标记，这里过滤
        // 对它是空操作，不改变非推翻模式的行为。
        const classifyCandidates = candidates.filter((c) => c.domainGroup === undefined)
        // 推翻模式的候选是刚设计出来的，模型永远找得到归属，用不上「无合适目录时
        // 带回 topic」这条规则；让它的分类提示词继续保持这个工作流存在之前的样子，
        // 一个字节都不因为新增的非推翻建目录能力而改变（见 issues review M9）。
        const llmResults = await classifyBookmarks({
          items: toClassify,
          candidates: classifyCandidates,
          client,
          cache,
          batchSize: deps.batchSize,
          onProgress: progress('classify'),
          onLog: (message, level) => log('classify', message, level),
          isCancelled,
          locale,
          model: settings.llm.model,
          includeTopicRule: !rebuild,
        })
        let classifications = [...pinned, ...llmResults]
        // 已经跑完的批次仍然写进缓存，重来时不必再花一次钱
        await saveCache(ports, cache)
        if (isCancelled()) return CANCELLED

        // source === 'none' 只在请求失败或模型漏返回时出现——模型判定"无合适目录"
        // 走的是 source === 'llm' + targetCategoryId === null 这条路。这道全军覆没的
        // 判断要放在新建目录那一步之前：不然「N 本书签放不进已有目录」的日志会抢在
        // 真正的失败原因前面出现，看着像是新建目录那步自己出的错。
        const failed = llmResults.filter((c) => c.source === 'none')
        if (toClassify.length > 0 && failed.length === toClassify.length) {
          return {
            ok: false,
            error: t('errClassifyAllFailed', failed[0]!.reason),
          }
        }

        // 非推翻模式补上「新主题无处可去」这一块：规则定量、模型只负责起名。
        // 推翻模式不走这里——那条路的候选本来就是刚设计出来的，不存在放不进去。
        if (!rebuild) {
          const rootIds = new Set(roots.map((r) => r.id))
          const allClusters = clusterHomeless(classifications)
          // 「已聚齐」这道幂等性闸赶在起名之前生效：命名要花一次模型请求，不该为
          // 注定被丢弃的簇破费（见 core/newTopics.ts 的 dropAlreadyGrouped）
          const clusters = dropAlreadyGrouped(allClusters, scan.bookmarks, scan.folders, rootIds)
          const droppedByGuard = allClusters.length - clusters.length
          if (droppedByGuard > 0) {
            log('tree', t('logNewFoldersGrouped', String(droppedByGuard)))
          }
          // 只数模型真正判过的「无合适目录」，请求失败落下的 source: 'none' 不算——
          // 那批已经在上面的全军覆没判断里处理过了，这里再数进去只会让日志说谎
          const homelessCount = classifications.filter(
            (c) => c.targetCategoryId === null && c.source !== 'none',
          ).length
          if (clusters.length > 0) {
            log('tree', t('logNewFoldersStart', String(homelessCount)))
            const rootId = roots[0]?.id
            if (rootId === undefined) return { ok: false, error: t('errNoScope') }
            // 勾了多个范围根时新目录固定挂第一个——这是刻意的简化（见 issues review I2），
            // 但不能悄悄发生，用户该知道自己另一个范围根下的书签会被搬过来这一侧
            if (roots.length > 1) {
              log('tree', t('logNewFoldersMultiRoot', roots[0]!.title))
            }
            const names = await nameNewTopics(
              clusters,
              // 给全部范围根的直接子目录，不能只看新目录要挂的那一个根：漏了另一个根
              // 下的已有目录名，起名这步就可能撞出一个别处已经在用的名字
              scan.folders.filter((f) => f.parentId !== null && rootIds.has(f.parentId)).map((f) => f.title),
              client, locale,
              { onLog: (message, level) => log('tree', message, level) },
            )
            if (isCancelled()) return CANCELLED
            // 撞名被 nameNewTopics 整簇跳过的，不能悄悄消失——不然「N 本书签无处可去」
            // 的日志后面跟着「新建 0 个目录」，用户看不出原因
            const nameSkipped = clusters.filter((c) => !names.has(c.key)).length
            if (nameSkipped > 0) {
              log('tree', t('logNewFoldersNameCollision', String(nameSkipped)))
            }
            const added = planNewFolders({
              clusters, names, rootId, folders: scan.folders, classifications, locale,
            })
            newFolders = [...newFolders, ...added.newFolders]
            candidates = [...candidates, ...added.candidates]
            classifications = added.classifications
            log('tree', t('logNewFoldersDone', String(added.newFolders.length), String(added.placedCount)))
            if (added.truncatedCount > 0) {
              log('tree', t('logNewFoldersCapped', String(added.truncatedCount)))
            }
          } else if (homelessCount > 0 && droppedByGuard === 0) {
            // droppedByGuard > 0 时上面已经说明过原因（已聚齐），这里不再重复一句
            // 「没有任何主题攒够」——那会跟已聚齐的真实原因矛盾
            log('tree', t('logNewFoldersNone', String(homelessCount), String(MIN_NEW_FOLDER_SIZE)))
          }
        }

        const warnings =
          failed.length > 0
            ? [
                t(
                  'logClassifyFailed',
                  String(failed.length),
                  // detail 是 reason 剥掉「分类失败，保持原位：」这类双语前缀后的纯错误信息；
                  // logClassifyFailed 自己的文案已经说过"分类失败"，不能再把整句 reason 塞进去重复一遍。
                  failed[0]!.detail ?? failed[0]!.reason,
                ),
              ]
            : []
        // 目录下限的最后一道：前两道只能按标签数预估，书签最终落在哪个目录是刚才那步定的。
        // 只在推翻重建模式下做——非推翻模式的候选目录全是用户自己的，一个都不该撤。
        if (rebuild) {
          const pruned = pruneSmallFolders({
            candidates, newFolders, classifications, locale,
            minFolderSize: MIN_FOLDER_BOOKMARKS,
            mergeRootTemporaryId: planMergeRoot?.temporaryId ?? null,
          })
          candidates = pruned.candidates
          newFolders = pruned.newFolders
          classifications = pruned.classifications
          if (pruned.prunedTitles.length > 0) {
            log('classify', t('logPrunedSmall', String(pruned.prunedTitles.length), String(MIN_FOLDER_BOOKMARKS)))
          }
          // 「其他」退成真正的最后一档：掉进去的书签先问一次模型，存活目录里有没有更合适的。
          // 复用 classifyBookmarks 而不是另写一个模块——分批、并发、缓存、429 重试、
          // 「没有合适的就返回 null」这些语义它全都有，而这一步要的正是这些。
          const pendingById = new Map(pruned.pending.map((p) => [p.bookmarkId, p]))
          // 候选里剔掉「其他」自己：这一步的全部意义就是别让它当默认答案。
          // 聚合组的目录同样要剔掉——这一步跟上面首次分类一样是在给书签找去处，
          // 漏了这条，模型照样能把改判的书签塞进「01 GitHub」。
          const rehomeCandidates = candidates
            .filter((c) => c.id !== pruned.fallbackId)
            .filter((c) => c.domainGroup === undefined)
          const rehomeItems = scan.bookmarks.filter((b) => pendingById.has(b.id))
          if (rehomeItems.length > 0 && rehomeCandidates.length > 0) {
            // 这一步要发起新的付费请求，取消必须挡在它前面检查——与全文件另外
            // 8 处「先查取消再往下走」保持一致，不能让用户点了取消还多花一次钱
            if (isCancelled()) return CANCELLED
            log('classify', t('logRehomeStart', String(rehomeItems.length)))
            // 不传 onProgress：这一步是分类阶段的补充，再报一次进度会让进度条往回跳
            const placed = await classifyBookmarks({
              items: rehomeItems,
              candidates: rehomeCandidates,
              client, cache,
              batchSize: deps.batchSize,
              onLog: (message, level) => log('classify', message, level),
              isCancelled,
              locale,
              model: settings.llm.model,
              includeTopicRule: false,
            })
            await saveCache(ports, cache)
            if (isCancelled()) return CANCELLED
            const placedById = new Map(
              placed.filter((p) => p.targetCategoryId !== null && p.source !== 'none')
                .map((p) => [p.bookmarkId, p]),
            )
            const titleById = new Map(
              rehomeCandidates.map((c) => [c.id, stripNumberPrefix(c.path.at(-1) ?? '')]),
            )
            let rehomed = 0
            classifications = classifications.map((c) => {
              const hit = placedById.get(c.bookmarkId)
              const info = pendingById.get(c.bookmarkId)
              if (hit === undefined || info === undefined) return c
              // titleById 由同一份 rehomeCandidates 建、hit.targetCategoryId 来自
              // 对这份候选表的分类结果，正常必然查得到。真查不到时宁可放弃这次
              // 改判（保留 prune 定好的去处），也不该拼出「不再建这个目录」——
              // 那句话只在「模型说没有合适的」时才成立，这里明明选中了一个目录
              const targetTitle = titleById.get(hit.targetCategoryId!)
              if (targetTitle === undefined) return c
              rehomed += 1
              // 理由仍旧由 pruneReason 拼：用户要知道的是「原来那个目录太小」，
              // 而不是模型这一次的措辞
              return {
                ...c,
                targetCategoryId: hit.targetCategoryId,
                // 用这一次改判的把握度，不沿用首次分类对着一个已经不存在的目录
                // 打出的分数——复核页默认勾选、显示的百分比都靠它
                confidence: hit.confidence,
                reason: pruneReason(locale, info.fromTitle, info.count, MIN_FOLDER_BOOKMARKS, targetTitle),
              }
            })
            log('classify', t('logRehomeDone', String(rehomed)))
          }

          // 二次判定只会让「其他」变小：它只把书签从「其他」搬进存活目录，不会
          // 反过来把别的目录清空，所以不必重新跑一遍撤销判断——除了「其他」自己。
          // 「其他」抽走几条之后完全可能跌破下限，而上面那一轮
          // pruneSmallFolders 已经跑完，没有人会再数一遍。这里再调用一次纯函数
          // pruneSmallFolders（幂等、不花钱）就够了：数到「其他」还是不够，
          // 就把它也撤掉，让里面剩下的书签退回原位——这批书签不再问第三次模型
          // （票 05「决定 4」说的就是这个收场），日志与第一轮撤销复用同一条。
          const rePruned = pruneSmallFolders({
            candidates, newFolders, classifications, locale,
            minFolderSize: MIN_FOLDER_BOOKMARKS,
            mergeRootTemporaryId: planMergeRoot?.temporaryId ?? null,
          })
          candidates = rePruned.candidates
          newFolders = rePruned.newFolders
          classifications = rePruned.classifications
          if (rePruned.prunedTitles.length > 0) {
            log('classify', t('logPrunedSmall', String(rePruned.prunedTitles.length), String(MIN_FOLDER_BOOKMARKS)))
          }
        }

        // 标题统一与目录整理相互独立：它由自己的开关决定，不受移动建议的勾选影响
        const titleRewrites = settings.rewriteGithubTitles
          ? planTitleRewrites(scan.bookmarks)
          : []
        if (titleRewrites.length > 0) {
          log('classify', t('logTitleRewrites', String(titleRewrites.length)))
        }
        const plan = buildPlan({
          id: `plan-${now()}`,
          createdAt: now(),
          scopeRootIds: request.scopeRootIds,
          rebuildStructure: rebuild,
          items: scan.bookmarks,
          candidates,
          classifications,
          newFolders,
          renameFolders,
          warnings,
          tags,
          titleRewrites,
          mergeRoot: planMergeRoot,
        })
        for (const warning of warnings) log('classify', warning, 'warn')
        log('classify', t('logAnalyzeDone', String(plan.rows.length)))
        return { ok: true, kind: 'analyze', plan }
      }

      case 'apply': {
        const result = await applyPlan(ports, request.plan, new Set(request.accepted), locale, {
          removeEmptyFolders: settings.removeEmptyFolders,
          onProgress: progress('apply'),
        })
        log(
          'apply',
          t(
            result.status === 'completed' ? 'logApplyDone' : 'logApplyInterrupted',
            String(result.executed),
            String(result.removedFolders.length),
            String(result.sortedFolders),
          ),
          result.status === 'completed' ? 'info' : 'error',
        )
        return { ok: true, kind: 'apply', result }
      }

      case 'undo': {
        const result = await undoLast(ports, locale, progress('undo'))
        log('undo', t('logUndoDone', String(result.restored), String(result.removedFolders)))
        return { ok: true, kind: 'undo', result }
      }

      case 'get_settings':
        return { ok: true, kind: 'get_settings', settings }

      case 'save_settings':
        await saveSettings(ports, request.settings)
        // 立刻生效：cancel 端口的日志不走请求路径，等下一个请求就晚了
        setLocale(resolveLocale(request.settings.uiLocale))
        return { ok: true, kind: 'save_settings' }

      case 'import': {
        // 用自己新读的树查书签栏，不接受侧栏传来的 id——那份树可能已经过期
        const tree = await ports.bookmarks.getTree()
        const bar = findBookmarksBar(tree)
        if (bar === null) return { ok: false, error: t('errNoBookmarksBar') }

        const result = await importTree(ports, request.nodes, request.targetName, bar.id)
        log('import', t('logImportDone', String(result.bookmarks), String(result.folders)))
        return { ok: true, kind: 'import', result }
      }

      // 取消标记由 service worker 持有，这里只是让消息类型闭合
      case 'cancel':
        return { ok: true, kind: 'cancel' }

      case 'get_undo_state': {
        const snapshot = await loadSnapshot(ports)
        return {
          ok: true,
          kind: 'get_undo_state',
          available: snapshot !== null,
          createdAt: snapshot?.createdAt ?? null,
        }
      }
    }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
