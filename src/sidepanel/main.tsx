import { createRoot } from 'react-dom/client'
import { resolveLocale, setLocale } from '@/i18n'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import App from './App'
import { applyDocumentLang } from './lib/documentLang'
import { send } from './lib/send'
import './index.css'

/**
 * 挂载前先把语言定下来。init() 在首次渲染之后的 useEffect 里才读设置，
 * 那样第一帧会用错语言再闪一下。
 * send 失败（后台没起来）时用 DEFAULT_SETTINGS，即 'auto'，
 * 行为退回改造前的样子，不阻塞渲染。
 */
void (async () => {
  const res = await send({ kind: 'get_settings' })
  const settings = res.ok && res.kind === 'get_settings' ? res.settings : DEFAULT_SETTINGS
  setLocale(resolveLocale(settings.uiLocale))
  applyDocumentLang()
  createRoot(document.getElementById('root')!).render(<App />)
})()
