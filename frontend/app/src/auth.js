// Вход через сессию на сервере (backend/core/auth.php).
// В браузере храним только копию данных пользователя (имя, роль, язык) — для pwa.js
// и чтобы без сети показать интерфейс последнего вошедшего. Решает всегда сервер.

const CACHE_KEY = 'hotelapp_user';

export function readCachedUser() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// remember: true — localStorage (переживает закрытие приложения), false — sessionStorage,
// undefined — туда же, где копия уже лежит.
export function cacheUser(user, remember) {
    try {
        if (remember === undefined) remember = localStorage.getItem(CACHE_KEY) !== null;
        const json = JSON.stringify(user);
        if (remember) {
            localStorage.setItem(CACHE_KEY, json);
            sessionStorage.removeItem(CACHE_KEY);
        } else {
            sessionStorage.setItem(CACHE_KEY, json);
            localStorage.removeItem(CACHE_KEY);
        }
    } catch { /* хранилище недоступно — не страшно */ }
}

export function clearCachedUser() {
    try {
        localStorage.removeItem(CACHE_KEY);
        sessionStorage.removeItem(CACHE_KEY);
    } catch { /* ignore */ }
}

// Кто вошёл: { user, data } | { user: null } (сервер ответил «никто») | { offline: true }
// data — весь ответ me.php: текущий отель, список отелей, сети (для brand.js)
export async function fetchMe() {
    try {
        const res = await fetch('/backend/api/me.php', { cache: 'no-store' });
        if (res.status === 401) return { user: null };
        if (!res.ok) return { offline: true };
        const data = await res.json();
        return data.success ? { user: data.user, data } : { user: null };
    } catch {
        return { offline: true };
    }
}

export async function login(username, password, lang, remember) {
    const res = await fetch('/backend/api/login.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, lang, remember })
    });
    return res.json();
}

export async function logout() {
    try {
        await fetch('/backend/api/logout.php', { method: 'POST' });
    } catch { /* без сети: копию всё равно стираем, сессия истечёт сама */ }
    clearCachedUser();
}

export function saveLang(lang) {
    fetch('/backend/api/set_lang.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang })
    }).catch(() => {});
}

// Любой ответ 401 от backend/api (сессия истекла, вход отозван) → onUnauthorized.
// Так все экраны возвращаются к входу без правок в каждом из них.
export function installUnauthorizedHook(onUnauthorized) {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const res = await originalFetch(...args);
        if (res.status === 401) {
            const url = String(args[0] && args[0].url ? args[0].url : args[0]);
            if (url.includes('/backend/api/') && !/\/(me|login|logout)\.php/.test(url)) onUnauthorized();
        }
        return res;
    };
    return () => { window.fetch = originalFetch; };
}

// Убирает ?lang= из адреса, чтобы обновление страницы не меняло язык обратно
export function dropLangParam() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('lang')) return;
    url.searchParams.delete('lang');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
