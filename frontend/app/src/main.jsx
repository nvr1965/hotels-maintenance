import './pwa.js'
import './noZoom.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import MeterBossPage from './pages/MeterBossPage.jsx'

// Ссылка для начальника (?meters=КЛЮЧ) — сразу отчёт по счётчикам, без входа и без остального приложения
const params = new URLSearchParams(window.location.search)
const bossKey = params.get('meters')
// Язык — из ссылки (его задаёт сисадмин при создании), иначе английский
const bossLang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(params.get('lang') || '') ? params.get('lang') : 'en'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {bossKey ? <MeterBossPage accessKey={bossKey} lang={bossLang} /> : <App />}
  </StrictMode>,
)
