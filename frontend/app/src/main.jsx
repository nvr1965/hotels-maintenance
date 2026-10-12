import './pwa.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import MeterBossPage from './pages/MeterBossPage.jsx'

// Ссылка для начальника (?meters=КЛЮЧ) — сразу отчёт по счётчикам, без входа и без остального приложения
const params = new URLSearchParams(window.location.search)
const bossKey = params.get('meters')
const bossLang = ['ru', 'en', 'he', 'ar'].includes(params.get('lang')) ? params.get('lang') : 'he'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {bossKey ? <MeterBossPage accessKey={bossKey} lang={bossLang} /> : <App />}
  </StrictMode>,
)
