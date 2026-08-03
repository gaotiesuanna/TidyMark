import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { ScopeStep } from './steps/ScopeStep'
import { PreferencesStep } from './steps/PreferencesStep'
import { useStore } from './store'

export default function App() {
  const { step, init } = useStore()
  useEffect(() => { void init() }, [init])

  return (
    <Shell>
      {step === 'scope' && <ScopeStep />}
      {step === 'preferences' && <PreferencesStep />}
    </Shell>
  )
}
