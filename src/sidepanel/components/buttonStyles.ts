/**
 * 导出/导入区共用的按钮类串。集中放一处，避免两个面板各写一套 className 后慢慢漂移。
 * 高度不写进 base：Tailwind 的优先级由生成顺序决定，写在 base 里会被同族工具类覆盖得莫名其妙。
 */
export const focusRing = [
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-index-blue',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-index-canvas',
].join(' ')

const base = [
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-index',
  'font-medium transition-colors duration-150 motion-reduce:transition-none',
  focusRing,
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')

/**
 * 尺寸和外观分开：Tailwind 优先级看生成顺序，md 和 sm 的 px 同时出现时小的压不过大的，
 * 所以包装组件只能二选一拼上，不能靠调用点加 utility 去盖。
 */
export const buttonSizeMd = 'min-h-index-row px-3 text-sm leading-caption'
export const buttonSizeSm = 'min-h-0 px-2 py-1 text-xs leading-none'

/** 白底描边按钮：坐在浅灰分组底色上，靠底色差把可点区域衬出来。 */
export const secondaryButton = [
  base,
  'border border-index-line bg-index-canvas text-index-ink',
  'hover:enabled:border-index-line-strong hover:enabled:bg-index-blue-soft',
  'active:enabled:bg-index-blue-soft',
].join(' ')

/**
 * 安静按钮：无边框无底色，只在悬停时浮出来。
 *
 * 给那种「跟旁边几个按钮不是一回事、但也没地方可去」的出口用——描边按钮摆在一起
 * 就是在说「这几个是同一类」，而它不是。
 */
export const ghostButton = [
  base,
  'text-index-muted',
  'hover:enabled:bg-index-blue-soft hover:enabled:text-index-ink',
  'active:enabled:bg-index-blue-soft',
].join(' ')

/**
 * 视图筛选槽：装那种只改「这一页看到多少」、不碰任何数据的开关。
 *
 * 长得跟按钮不一样是刻意的——筛选和「全部接受」并排成一样的描边按钮时，
 * 用户读到的是五个平级的动作，而它们根本不是一个维度的东西。
 * 与 segmentTrack 同源（同样 32px、同样坐在一条槽里），区别是这里的开关各开各的、
 * 可以同时按下，所以不用 SegmentedChoice 那套单选语义。
 */
export const filterTrack = 'inline-flex items-center gap-0.5 rounded-index border border-index-line bg-index-canvas p-0.5'

/**
 * 按下态用 aria-pressed 变体，不在调用点拼 `text-index-canvas`：平级工具类的胜负由
 * 生成顺序决定，而 index 调色板里 canvas 排在 muted/ink 前面，拼上去会被压掉，
 * 按下的开关变成黑底黑字、字直接看不见。属性选择器多一层特指度，不用靠顺序赌。
 *
 * 按下用实心黑而不是 segmentActive 的浅蓝：筛选会把行藏起来，
 * 「你现在没在看全部」这件事得说得足够响。
 */
export const filterToggle = [
  'inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-index px-2.5',
  'text-xs leading-none font-medium text-index-muted',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:enabled:text-index-ink',
  'aria-pressed:bg-index-ink aria-pressed:text-index-canvas aria-pressed:hover:bg-zinc-800',
  focusRing,
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')

/** 深色实心按钮，一个分组里只留一个，用来标出该组的主操作。 */
export const primaryButton = [
  base,
  'bg-index-ink text-index-canvas',
  'hover:enabled:bg-zinc-800 active:enabled:bg-zinc-900',
].join(' ')

export const dangerButton = [
  base,
  'border border-red-300 bg-index-canvas text-red-700',
  'hover:enabled:border-red-400 hover:enabled:bg-red-50 hover:enabled:text-red-800',
  'active:enabled:bg-red-100',
].join(' ')

export const fieldClass = [
  'block min-h-index-row w-full rounded-index border border-index-line bg-index-canvas px-3 py-2',
  'text-sm leading-body text-index-ink placeholder:text-index-faint',
  'disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-index-muted',
  focusRing,
].join(' ')

export const fieldLabelClass = 'mb-1 block text-sm leading-caption font-medium text-index-ink'

export const stickyActionBar = 'sticky -bottom-4 -mx-4 -mb-4 mt-3 border-t border-index-line bg-index-canvas px-4 pb-4 pt-3'

/** 虚线边框，暗示「这里要放一个文件」，同时和上方导出组的实线按钮拉开区别。 */
export const filePickerButton = [
  base,
  buttonSizeMd,
  'w-full border border-dashed border-index-line-strong bg-index-canvas text-index-muted',
  'hover:enabled:border-index-ink hover:enabled:bg-index-blue-soft hover:enabled:text-index-ink',
].join(' ')

/**
 * 局部切换槽，不是索引行也不是主操作。42px 会跟下面那些真按钮抢视线，
 * 也比顶部的模式标签还高；32px 够点，看起来才是在换一组下面的选项。
 */
export const segmentTrack = 'flex rounded-index border border-index-line bg-index-canvas p-0.5'

export const segmentButton = [
  'inline-flex min-h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-index px-2',
  'text-xs leading-none font-medium text-index-muted',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:text-index-ink',
  focusRing,
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')

export const segmentActive = 'bg-index-blue-soft text-index-ink hover:text-index-ink'

/** 导出格式一行一项，左对齐图标+文字，叠成一组。不复用 base：justify-center 会和这里抢。 */
export const choiceRow = [
  'inline-flex min-h-index-row w-full cursor-pointer items-center justify-start gap-2 px-3',
  'text-sm leading-caption font-medium text-index-ink',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:enabled:bg-index-blue-soft',
  'active:enabled:bg-index-blue-soft',
  focusRing,
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')

export const choiceList = 'divide-y divide-index-line overflow-hidden rounded-index border border-index-line'
