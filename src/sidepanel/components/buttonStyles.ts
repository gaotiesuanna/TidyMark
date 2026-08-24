/**
 * 导出/导入区共用的按钮类串。集中放一处，避免两个面板各写一套 className 后慢慢漂移。
 * 高度不写进 base：Tailwind 的优先级由生成顺序决定，写在 base 里会被同族工具类覆盖得莫名其妙。
 */
const base = [
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3',
  'text-xs font-medium',
  'transition-colors duration-150 motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
  'focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-50',
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')

/** 白底描边按钮：坐在浅灰分组底色上，靠底色差把可点区域衬出来。 */
export const secondaryButton = [
  base,
  'h-8 border border-neutral-200 bg-white text-neutral-700',
  'hover:enabled:border-neutral-300 hover:enabled:bg-neutral-50 hover:enabled:text-neutral-900',
  'active:enabled:bg-neutral-100',
].join(' ')

/** 深色实心按钮，一个分组里只留一个，用来标出该组的主操作。 */
export const primaryButton = [
  base,
  'h-8 bg-neutral-800 text-white',
  'hover:enabled:bg-neutral-900 active:enabled:bg-black',
].join(' ')

/** 虚线边框，暗示「这里要放一个文件」，同时和上方导出组的实线按钮拉开区别。 */
export const filePickerButton = [
  base,
  'h-9 w-full border border-dashed border-neutral-300 bg-white text-neutral-600',
  'hover:enabled:border-neutral-400 hover:enabled:bg-neutral-50 hover:enabled:text-neutral-900',
].join(' ')

/** 导出/导入切换槽：一段灰底，选中那格抬成白片。 */
export const segmentTrack = 'flex rounded-lg bg-neutral-200/80 p-0.5'

export const segmentButton = [
  'inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3',
  'text-xs font-medium text-neutral-500',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:text-neutral-800',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-200',
].join(' ')

export const segmentActive = 'bg-white text-neutral-900 shadow-sm hover:text-neutral-900'

/** 导出格式一行一项，左对齐图标+文字，叠成一组。不复用 base：justify-center 会和这里抢。 */
export const choiceRow = [
  'inline-flex h-9 w-full cursor-pointer items-center justify-start gap-2 px-3',
  'text-xs font-medium text-neutral-700',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:enabled:bg-neutral-50 hover:enabled:text-neutral-900',
  'active:enabled:bg-neutral-100',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400',
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')

export const choiceList = 'overflow-hidden rounded-lg border border-neutral-200 divide-y divide-neutral-100'

