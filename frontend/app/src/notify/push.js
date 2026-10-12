// Уведомления о срочных заявках: подписка телефона на Web Push и цифра на иконке приложения.
// Сервер: backend/api/push_subscribe.php, рассылка — backend/core/push.php, показ — public/sw.js.

const API = '/backend/api/push_subscribe.php';
const SILENT_KEY = 'hotelapp_push_silent';

export const PUSH_ROLES = ['worker', 'head'];

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
}

// По умолчанию: исполнитель — со звуком, начальник — тихо (переключается кнопкой 🔔/🔕)
export function readSilent(role) {
    try {
        const v = localStorage.getItem(SILENT_KEY);
        if (v !== null) return v === '1';
    } catch { /* ignore */ }
    return role === 'head';
}

function storeSilent(silent) {
    try { localStorage.setItem(SILENT_KEY, silent ? '1' : '0'); } catch { /* ignore */ }
}

function b64uToBytes(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
    // pwa.js регистрирует sw.js при загрузке; ждём его, но не вечно
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('sw_timeout')), 10000))
    ]);
}

async function sendToServer(sub, silent) {
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON(), silent })
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) throw new Error(data.message || 'subscribe_failed');
}

// 'unsupported' | 'need_install' (iPhone не с экрана «Домой») | 'denied' | 'off' | 'on'
export async function pushState() {
    if (!pushSupported()) return isIos() && !isStandalone() ? 'need_install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') return 'off';
    try {
        const reg = await registration();
        return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
    } catch {
        return 'off';
    }
}

// Только по нажатию кнопки: иначе браузер (особенно iPhone) не покажет запрос разрешения
export async function enablePush(role) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
    const info = await fetch(API, { cache: 'no-store' }).then((r) => r.json());
    if (!info.eligible || !info.publicKey) return 'unsupported';
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(info.publicKey) });
    }
    await sendToServer(sub, readSilent(role));
    return 'on';
}

// При каждом открытии: подписка могла смениться (браузер обновил её) или смениться язык —
// сервер должен знать актуальную. Разрешение уже есть, поэтому ничего не спрашиваем.
export async function syncPush(role) {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    try {
        const reg = await registration();
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            const info = await fetch(API, { cache: 'no-store' }).then((r) => r.json());
            if (!info.eligible || !info.publicKey) return;
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(info.publicKey) });
        }
        await sendToServer(sub, readSilent(role));
    } catch (e) {
        console.warn('push sync failed:', e);
    }
}

export async function setPushSilent(role, silent) {
    storeSilent(silent);
    await syncPush(role);
}

// Выход из приложения: следующий человек на этом телефоне не должен получать чужие уведомления
export async function disablePush() {
    setBadge(0);
    if (!pushSupported()) return;
    try {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unsubscribe', endpoint: sub.endpoint })
        }).catch(() => {});
        await sub.unsubscribe();
        (await reg.getNotifications()).forEach((n) => n.close());
    } catch { /* ignore */ }
}

const URGENT_TITLE = { ru: '🚨 Срочная заявка', en: '🚨 Urgent request', he: '🚨 קריאה דחופה', ar: '🚨 طلب عاجل' };

// Цифра на иконке = число открытых срочных заявок, уведомления висят, пока заявка не выполнена.
// openTasks: [{id, text}] — открытые срочные заявки.
// iPhone: цифру ставит setAppBadge. Android: цифра или точка на иконке = число висящих
// уведомлений, поэтому недостающие (смахнули, пришли до подписки) показываем заново, без звука.
export async function syncUrgentBadge(openTasks, lang = 'ru') {
    setBadge(openTasks.length);
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg?.getNotifications) return;
        const open = new Map(openTasks.map((t) => [String(t.id), t]));
        const shown = new Set();
        (await reg.getNotifications()).forEach((n) => {
            const m = /^urgent-(\d+)$/.exec(n.tag || '');
            if (!m) return;
            if (open.has(m[1])) shown.add(m[1]); else n.close();
        });
        if (isIos() || Notification.permission !== 'granted' || !(await reg.pushManager?.getSubscription())) return;
        const rtl = lang === 'he' || lang === 'ar';
        for (const [id, t] of open) {
            if (shown.has(id)) continue;
            await reg.showNotification(URGENT_TITLE[lang] || URGENT_TITLE.ru, {
                body: t.text || '', tag: `urgent-${id}`, silent: true, renotify: false,
                icon: new URL('icons/icon-192.png', reg.scope).href,
                dir: rtl ? 'rtl' : 'ltr', lang, data: { id: Number(id) }
            });
        }
    } catch { /* ignore */ }
}

export function setBadge(n) {
    try {
        if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
        else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    } catch { /* ignore */ }
}
