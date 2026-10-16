// Регистрация service worker + полоска «Нет связи» на языке пользователя.
import { uiText, dirOf } from './i18n';
function currentLang() {
    try {
        const saved = localStorage.getItem('hotelapp_user') || sessionStorage.getItem('hotelapp_user');
        const lang = saved && JSON.parse(saved).lang;
        if (lang) return lang;
    } catch (e) { /* ignore */ }
    return new URLSearchParams(window.location.search).get('lang') || 'en';
}

function updateOfflineBar() {
    let bar = document.getElementById('app-offline-bar');
    if (navigator.onLine) {
        if (bar) bar.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'app-offline-bar';
        bar.setAttribute('role', 'status');
        Object.assign(bar.style, {
            position: 'fixed', left: '0', right: '0', top: '0', zIndex: '99999',
            padding: 'calc(env(safe-area-inset-top) + 8px) 12px 8px',
            background: '#fef9c3', color: '#713f12', fontSize: '14px', fontWeight: 'bold',
            textAlign: 'center', fontFamily: 'inherit'
        });
        document.body.appendChild(bar);
    }
    const lang = currentLang();
    bar.dir = dirOf(lang);
    bar.textContent = uiText('app', lang).offline;
}

window.addEventListener('online', updateOfflineBar);
window.addEventListener('offline', updateOfflineBar);
window.addEventListener('load', updateOfflineBar);

if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
        const base = import.meta.env.BASE_URL;
        navigator.serviceWorker.register(base + 'sw.js', { scope: base })
            .then((reg) => {
                // Проверять новую версию при возврате в приложение (телефон долго держит вкладку).
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') reg.update().catch(() => {});
                });
            })
            .catch((err) => console.warn('SW registration failed:', err));
    });
}

// Метка сборки: новое имя файла сборки, если старое застряло в кеше Cloudflare
window.APP_BUILD = '2026-10-12a';
