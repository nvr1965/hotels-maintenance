import { useState, useRef, useEffect } from 'react';
import './head.css';

// Общие кусочки экранов руководителя (отчёты, создание плановых): значки, плашки статусов, тексты.

// Одноцветные значки (цвет берётся из текста)
const PATHS = {
    back: <path d="M19 12H5M11 6l-6 6 6 6" />,
    chev: <path d="M9 6l6 6-6 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
    tool: <path d="M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 1-2-2 1-3z" />,
    download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
    gauge: <><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5" /><path d="M3 21h18" /></>,
    check: <path d="M5 12l5 5 9-10" />,
    warn: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
    note: <><path d="M5 4h14v12l-4 4H5z" /><path d="M15 20v-4h4" /></>,
    table: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M9 10v9M15 10v9" /></>,
    cam: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
    cal: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
    play: <path d="M8 5l11 7-11 7z" />,
};
export function Icon({ n, className = '' }) {
    return (
        <svg className={`hd-ic i-${n} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{PATHS[n]}</svg>
    );
}

// Тексты, которых нет в словаре WorkerDashboard (без эмодзи)

// Плашка статуса заявки: «Ожидает» жёлтая, «В работе» синяя, «Выполнено» зелёная
export function StatusBadge({ status, labels }) {
    const cls = { pending: 'pending', in_progress: 'prog', done: 'done' }[status] || 'pending';
    const label = { pending: labels.pending, in_progress: labels.in_progress, done: labels.done }[status] || labels.pending;
    return <span className={'hd-st ' + cls}>{label}</span>;
}

// Плашка пункта чек-листа: «Заменено» синяя
export function CheckBadge({ status, labels }) {
    const cls = { pending: 'grey', ok: 'done', defect: 'defect', fixed: 'fixed' }[status] || 'grey';
    return <span className={'hd-st ' + cls}>{labels[status] || labels.pending}</span>;
}

// Миниатюры фото/видео; нажатие открывает просмотр
const mediaSrc = (url) => (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('http')) ? url : `/${url}`;
export const normMedia = (item) => {
    const url = typeof item === 'string' ? item : (item?.url || '');
    const isVideo = (typeof item === 'object' && item?.type === 'video') || /\.(mp4|mov|avi|webm)$/i.test(url);
    return { url: mediaSrc(url), isVideo };
};
export function Thumbs({ items, onOpen, small }) {
    if (!items || !items.length) return null;
    return (
        <div className={'hd-thumbs' + (small ? ' sm' : '')} onClick={e => e.stopPropagation()}>
            {items.map((it, i) => {
                const m = normMedia(it);
                return (
                    <button key={i} type="button" className="hd-th" onClick={() => onOpen(items, i)} aria-label={String(i + 1)}>
                        {m.isVideo
                            ? <><video src={m.url} muted playsInline preload="metadata" /><span className="play"><Icon n="play" /></span></>
                            : <img src={m.url} alt="" loading="lazy" />}
                    </button>
                );
            })}
        </div>
    );
}

// Короткое сообщение внизу экрана
export function useToast() {
    const [msg, setMsg] = useState(null);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const show = (m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 3200); };
    const node = <div className={'hd-toast' + (msg ? ' on' : '')} role="status" aria-live="polite">{msg}</div>;
    return [show, node];
}

// «2026-10-16 13:05:00» -> «16.10.2026 13:05»
export const fmtStamp = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s || '');
    if (!m) return s || '—';
    return `${m[3]}.${m[2]}.${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}` : '');
};
