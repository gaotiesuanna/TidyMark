import { createRoot } from 'react-dom/client'
import App from './App'
import { applyDocumentLang } from './lib/documentLang'
import './index.css'

applyDocumentLang()

createRoot(document.getElementById('root')!).render(<App />)
