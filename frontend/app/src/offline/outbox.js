// Очередь отправки без сети.
// Фото и закрытия заявок сначала ложатся в память телефона (IndexedDB), потом уходят на сервер.
// Если связи нет, они ждут и отправляются сами, когда сеть вернётся
// (событие online, возврат в приложение, проверка раз в 30 секунд).
//
// Хранилища:
//   files: { id, userId, data: ArrayBuffer, mime, kind: 'photo'|'video', createdAt }
//   ops:   { id, userId, kind: 'close'|'create_urgent', payload, fileIds, uploaded: {fileId: url},
//            createdAt, doneAt, label, error }
// В payload медиа с ещё не отправленным файлом выглядит так: { type, url: 'local:<fileId>' }.
// id операции (client_op_id) уходит на сервер: повторная отправка того же действия не задвоит запись.

const DB_NAME = 'hotelapp-offline';
const DB_VERSION = 1;
const UPLOAD_TIMEOUT = 120000;
const SEND_TIMEOUT = 20000;
const ORPHAN_AGE = 3 * 24 * 3600 * 1000; // фото без заявки старше 3 суток — удаляем

export const LOCAL_PREFIX = 'local:';

let dbPromise = null;
function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('ops')) db.createObjectStore('ops', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
}

async function tx(store, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then((r) => { result = r; });
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
}

const reqToPromise = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

const getAll = (store) => tx(store, 'readonly', (s) => reqToPromise(s.getAll()));
const getOne = (store, id) => tx(store, 'readonly', (s) => reqToPromise(s.get(id)));
const putOne = (store, value) => tx(store, 'readwrite', (s) => { s.put(value); });
const delOne = (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); });

export function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

// ---------------------------------------------------------------- подписка на состояние
const listeners = new Set();
let state = { pending: 0, failed: 0, sending: false, offline: typeof navigator !== 'undefined' && navigator.onLine === false, lastError: null };

function setState(patch) {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
}

// Кто-то (страница) хочет знать, что операция дошла до сервера — чтобы обновить список
const sentListeners = new Set();
export function onSent(fn) {
    sentListeners.add(fn);
    return () => sentListeners.delete(fn);
}

export async function refreshCounts(userId) {
    try {
        const ops = (await getAll('ops')).filter((o) => o.userId === userId);
        setState({ pending: ops.filter((o) => !o.error).length, failed: ops.filter((o) => o.error).length });
    } catch { /* IndexedDB недоступна */ }
}

// ---------------------------------------------------------------- файлы
export async function saveFile(userId, blob, kind) {
    const id = newId();
    const data = await blob.arrayBuffer(); // ArrayBuffer надёжнее Blob в IndexedDB старых iPhone
    await putOne('files', { id, userId, data, mime: blob.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'), kind, createdAt: Date.now() });
    return id;
}

export async function deleteFile(id) {
    try { await delOne('files', id); } catch { /* ignore */ }
}

async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Ошибка связи (нет сети, обрыв, долго нет ответа, сервер недоступен через туннель)
class NetError extends Error {}
// Сервер ответил, но отказал (проблема данных, повтор не поможет)
class ServerError extends Error {}
// Сессия кончилась — ждём, пока человек войдёт снова
class AuthError extends Error {}

async function readJson(res) {
    if (res.status === 401) throw new AuthError('auth');
    if (res.status >= 500 || res.status === 0) throw new NetError('http_' + res.status);
    let data;
    try { data = await res.json(); } catch { throw new NetError('bad_json'); } // Cloudflare отдал страницу ошибки
    return data;
}

async function uploadBlob(blob, kind) {
    const fd = new FormData();
    fd.append('file', blob, kind === 'video' ? 'video.mp4' : 'photo.jpg');
    let res;
    try {
        res = await fetchWithTimeout('/backend/api/upload_media.php', { method: 'POST', body: fd }, UPLOAD_TIMEOUT);
    } catch {
        throw new NetError('upload');
    }
    const data = await readJson(res);
    if (data.success && data.url) return data.url;
    throw new ServerError(data.message || 'upload_failed');
}

// Отправить файл сразу (обычный путь при хорошей связи). Возвращает url или бросает ошибку.
export async function uploadNow(blob, kind) {
    return uploadBlob(blob, kind);
}

async function uploadStoredFile(id) {
    const f = await getOne('files', id);
    if (!f) throw new ServerError('file_missing');
    return uploadBlob(new Blob([f.data], { type: f.mime }), f.kind);
}

// Ссылка для показа сохранённого на телефоне фото
export async function fileObjectUrl(id) {
    const f = await getOne('files', id);
    return f ? URL.createObjectURL(new Blob([f.data], { type: f.mime })) : null;
}

// ---------------------------------------------------------------- операции
const ENDPOINTS = {
    close: (payload) => ({ url: '/backend/api/close_task.php', opts: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } }),
    create_urgent: (payload) => {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, typeof v === 'string' ? v : JSON.stringify(v)));
        return { url: '/backend/api/save_task.php', opts: { method: 'POST', body: fd } };
    }
};

const localIdOf = (m) => (m && typeof m === 'object' && typeof m.url === 'string' && m.url.startsWith(LOCAL_PREFIX)) ? m.url.slice(LOCAL_PREFIX.length) : null;

// Медиа для отправки: server url остаются, у локальных — 'local:<id>'
export function mediaForQueue(media) {
    return (media || []).map((m) => (m && typeof m === 'object' && m.localId) ? { type: m.type, url: LOCAL_PREFIX + m.localId } : m);
}

function mediaKey(kind) { return kind === 'create_urgent' ? 'mediaList' : 'media'; }

// Подставить серверные url вместо local:
function resolvePayload(op) {
    const key = mediaKey(op.kind);
    const media = (op.payload[key] || []).map((m) => {
        const id = localIdOf(m);
        return id ? { type: m.type, url: op.uploaded[id] } : m;
    });
    return { ...op.payload, [key]: media, client_op_id: op.id, done_at: op.doneAt };
}

// Одна попытка отправить действие напрямую (без очереди). true — дошло; бросает NetError/ServerError/AuthError.
async function sendOp(op) {
    for (const fid of op.fileIds) {
        if (op.uploaded[fid]) continue;
        op.uploaded[fid] = await uploadStoredFile(fid);
        if (op.stored) await putOne('ops', op); // запоминаем, что файл уже на сервере
    }
    const { url, opts } = ENDPOINTS[op.kind](resolvePayload(op));
    let res;
    try {
        res = await fetchWithTimeout(url, opts, SEND_TIMEOUT);
    } catch {
        throw new NetError('send');
    }
    const data = await readJson(res);
    if (!data.success) throw new ServerError(data.message || 'server');
    return data;
}

// Создать операцию. Медиа с localId должны уже лежать в files.
export function makeOp(userId, kind, payload, label) {
    const key = mediaKey(kind);
    const media = mediaForQueue(payload[key]);
    const fileIds = media.map(localIdOf).filter(Boolean);
    return { id: newId(), userId, kind, payload: { ...payload, [key]: media }, fileIds, uploaded: {}, createdAt: Date.now(), doneAt: Date.now(), label: label || '', error: null };
}

async function finishOp(op) {
    await delOne('ops', op.id);
    for (const fid of op.fileIds) await deleteFile(fid);
}

// Отправить сейчас, а если связи нет — положить в очередь.
// Если в действии есть фото, которое ещё не ушло (значит, связь плохая), человека не держим:
// сразу кладём в очередь и отправляем в фоне.
// Результат: { sent: true, data } | { queued: true } ; ServerError пробрасывается наружу (показать ошибку).
// Заявку менеджера не ждём совсем: сразу в телефон и в очередь, форма свободна, отправка идёт в фоне.
const QUEUE_FIRST = new Set(['create_urgent']);

export async function submitOrQueue(op) {
    const knownOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!knownOffline && op.fileIds.length === 0 && !QUEUE_FIRST.has(op.kind)) {
        try {
            const data = await sendOp(op);
            setState({ offline: false });
            return { sent: true, data };
        } catch (e) {
            if (e instanceof ServerError) throw e;
            if (e instanceof NetError) setState({ offline: true });
            // NetError или AuthError — в очередь
        }
    }
    op.stored = true;
    await putOne('ops', op);
    if (knownOffline) setState({ offline: true });
    await refreshCounts(op.userId);
    if (!knownOffline) flush(op.userId); // в фоне, не ждём
    return { queued: true };
}

export async function pendingOps(userId) {
    try {
        return (await getAll('ops')).filter((o) => o.userId === userId);
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------- отправка очереди
let flushing = false;
let flushAgain = false; // пока шла отправка, добавилось новое действие

async function flushInner(userId) {
    const ops = (await getAll('ops'))
        .filter((o) => o.userId === userId && !o.error)
        .sort((a, b) => a.createdAt - b.createdAt);
    if (ops.length === 0) {
        await cleanupOrphans(userId);
        return;
    }
    setState({ sending: true });
    for (const op of ops) {
        try {
            const data = await sendOp(op);
            await finishOp(op);
            setState({ offline: false, lastError: null });
            sentListeners.forEach((fn) => fn(op, data));
        } catch (e) {
            if (e instanceof ServerError) {
                // Сервер отказал (например, заявку удалили) — не теряем, откладываем с пометкой
                op.error = e.message;
                await putOne('ops', op);
                setState({ lastError: e.message });
                continue;
            }
            setState({ offline: !(e instanceof AuthError) });
            break; // нет связи или нужен вход — остальное подождёт
        } finally {
            await refreshCounts(userId);
        }
    }
    setState({ sending: false });
}

export async function flush(userId) {
    if (!userId) return;
    if (flushing) { flushAgain = true; return; }
    flushing = true;
    flushAgain = false;
    try {
        if (navigator.locks?.request) {
            // Несколько вкладок одного телефона не отправляют одно и то же одновременно
            await navigator.locks.request('hotelapp-outbox', { ifAvailable: true }, async (lock) => {
                if (lock) await flushInner(userId);
            });
        } else {
            await flushInner(userId);
        }
    } catch {
        setState({ sending: false });
    } finally {
        flushing = false;
        await refreshCounts(userId);
    }
    if (flushAgain && !state.offline) flush(userId);
}

// Вернуть отложенные с ошибкой в очередь (кнопка «Повторить»)
export async function retryFailed(userId) {
    const ops = await pendingOps(userId);
    for (const op of ops) {
        if (op.error) { op.error = null; await putOne('ops', op); }
    }
    await refreshCounts(userId);
    return flush(userId);
}

// Фото, снятые без сети, но так и не попавшие в заявку (приложение закрыли, фото удалили)
async function cleanupOrphans(userId) {
    try {
        const ops = await getAll('ops');
        const used = new Set(ops.flatMap((o) => o.fileIds));
        const files = await getAll('files');
        const now = Date.now();
        for (const f of files) {
            if (f.userId === userId && !used.has(f.id) && now - f.createdAt > ORPHAN_AGE) await deleteFile(f.id);
        }
    } catch { /* ignore */ }
}

// Попросить браузер не стирать сохранённое при нехватке места
export function askPersistentStorage() {
    try { navigator.storage?.persist?.(); } catch { /* ignore */ }
}

export { NetError, ServerError, AuthError };
