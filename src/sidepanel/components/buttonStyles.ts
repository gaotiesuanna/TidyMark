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

/** 导出/导入切换槽：一段灰底，选中那格抬成白片。 */
export const segmentTrack = 'flex rounded-index border border-index-line bg-index-canvas p-0.5'

export const segmentButton = [
  'inline-flex min-h-index-row flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-index px-3',
  'text-sm leading-caption font-medium text-index-muted',
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
