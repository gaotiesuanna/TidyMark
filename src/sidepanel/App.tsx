import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { ScopeStep } from './steps/ScopeStep'
import { PreferencesStep } from './steps/PreferencesStep'
import { StructureStep } from './steps/StructureStep'
import { ReviewStep } from './steps/ReviewStep'
import { ResultStep } from './steps/ResultStep'
import { useStore } from './store'

export default function App() {
  const { step, init, locale } = useStore()
  useEffect(() => { void init() }, [init])

  /**
   * key={locale} 强制整棵树重挂载。t() 是读模块级变量的纯函数，组件不会自动响应
   * 它的变化，给 175 个调用点各加一层订阅远比这里重挂载一次复杂且易漏。
   * 代价是组件内部状态会重置（范围页的展开状态等），切语言是低频操作，可以接受。
   * settingsOpen 存在 store 里、不受重挂载影响，切完语言仍停在设置页。
   */
  return (
    <Shell key={locale}>
      {step === 'scope' && <ScopeStep />}
      {step === 'preferences' && <PreferencesStep />}
      {step === 'structure' && <StructureStep />}
      {step === 'review' && <ReviewStep />}
      {step === 'result' && <ResultStep />}
    </Shell>
  )
}
