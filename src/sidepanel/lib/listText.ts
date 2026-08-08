import type { Locale } from '@/core/locale'

/**
 * 把若干文件夹名连成一句话里的名单。
 *
 * 中文句子里用全角顿号，英文保留半角逗号——照抄句子里已有的标点习惯，不新造规则。
 *
 * 结构确认页与结果页报的是同一批源目录，分隔符只能有一处定义：
 * 各自内联的话，迟早会一边改成顿号、另一边还留着逗号，
 * 而两处说的偏偏是同一件事——用户会以为自己看错了。
 */
export function joinTitles(titles: string[], locale: Locale): string {
  return titles.join(locale === 'zh_CN' ? '、' : ', ')
}
