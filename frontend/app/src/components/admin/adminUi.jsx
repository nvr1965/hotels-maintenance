// Общее для разделов админки: тексты на языке интерфейса, запросы к API, стили.
import { uiText, isRtl, langName, languageList } from '../../i18n';

export { isRtl, langName, languageList };


// Значки в новом виде одноцветные (рисуются <Ic>), поэтому эмодзи из подписей убираем
const EMOJI = /\s*(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FF}\u{231A}\u{231B}\u{21BB}\u{27F3}\uFF0B\u25B6\u25C0\u25B2\u25BC][\uFE0F\u200D]*)+\s*/gu;
export const noEmoji = (s) => String(s).replace(EMOJI, ' ').replace(/\s{2,}/g, ' ').trim();
const CACHE = {};
// Тексты раздела admin (lang/en.json) без эмодзи; пересобираются, когда придут свежие переводы
export function tr(lang) {
    const src = uiText('admin', lang);
    if (CACHE[lang]?.src === src) return CACHE[lang].out;
    const out = {};
    for (const [k, v] of Object.entries(src)) {
        out[k] = typeof v === 'string' ? noEmoji(v) : typeof v === 'function' ? (...a) => noEmoji(v(...a)) : v;
    }
    CACHE[lang] = { src, out };
    return out;
}

/** Любой раздел текстов без эмодзи (для новых вкладок: deps, tpl, network…). */
export function trNs(ns, lang) {
    const src = uiText(ns, lang);
    const key = ns + ':' + lang;
    if (CACHE[key]?.src === src) return CACHE[key].out;
    const out = {};
    for (const [k, v] of Object.entries(src)) {
        out[k] = typeof v === 'string' ? noEmoji(v) : typeof v === 'function' ? (...a) => noEmoji(v(...a)) : v;
    }
    CACHE[key] = { src, out };
    return out;
}

/** Текст ошибки сервера на языке интерфейса. */
export function errText(t, data) {
    const code = data?.message;
    const msg = (code && t['err_' + code]) || code || t.err_unknown;
    return data?.error ? `${msg}: ${data.error}` : msg;
}

/** Запрос к API админки. Возвращает JSON-ответ; при обрыве — { success:false, message:'network' }. */
export async function api(url, body) {
    try {
        const res = await fetch(url, body === undefined ? { cache: 'no-store' } : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 401) return { success: false, message: 'auth_required' };
        if (res.status === 403) return { success: false, message: 'forbidden' };
        return await res.json();
    } catch {
        return { success: false, message: 'network' };
    }
}

// Стили в тон приложению (для старых мест, где нужен объект стиля; акцент синий)
export const S = {
    field: { padding: '9px 11px', border: '1px solid #cfc4ba', borderRadius: '10px', fontSize: '16px', background: '#fff', minWidth: 0, width: '100%', boxSizing: 'border-box', color: '#2f2624' },
    label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: '#7d726a', fontWeight: 700, minWidth: 0 },
    btn: { minHeight: '40px', padding: '7px 14px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: '1px solid #d6cbc1', background: '#fff', color: '#2f2624' },
    primary: { minHeight: '40px', padding: '7px 16px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: 'none', background: '#2a5f96', color: '#fff' },
    danger: { minHeight: '40px', padding: '7px 14px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: '1px solid #e7b9b9', background: '#fff', color: '#a3301c' },
    card: { background: '#fff', borderRadius: '16px', padding: '14px' },
    th: { padding: '10px', fontSize: '14px', color: '#7d726a', borderBottom: '2px solid #ebe3dc', whiteSpace: 'nowrap' },
    td: { padding: '9px 10px', borderBottom: '1px solid #f3ebe2', verticalAlign: 'top' },
    hint: { fontSize: '14px', color: '#7d726a' },
    badge: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '13px', fontWeight: 'bold', background: bg, color: fg, textAlign: 'center' }),
};

// ---------- одноцветные значки (цвет берётся из текста) ----------
const ICONS = {
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    chevL: '<path d="M15 6l-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><path d="M3 21h18"/>',
    ai: '<path d="M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    rotate: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    log: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h4"/>',
    note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    building: '<path d="M5 21V4h10v17M15 9h4v12M3 21h18"/><path d="M8 8h1M11 8h1M8 12h1M11 12h1M8 16h1M11 16h1"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
    hash: '<path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
};
/** Значок одного цвета. flip — зеркалить в иврите/арабском (стрелки). */
export function Ic({ n, flip, className = '' }) {
    return (
        <svg className={`ad-ic${flip ? ' flip' : ''}${className ? ' ' + className : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: ICONS[n] || '' }} />
    );
}

export function Message({ msg }) {
    if (!msg) return null;
    return (
        <div role="status" className={'ad-msg ' + (msg.ok ? 'ok' : 'err')}>
            <Ic n={msg.ok ? 'check' : 'warn'} /><span>{msg.text}</span>
        </div>
    );
}

/** Переключатель-«пилюли» для подразделов (второй ряд вкладок, тише первого). */
export function Pills({ items, value, onChange }) {
    return (
        <div className="ad-sub" role="tablist">
            {items.map(([key, label, count]) => (
                <button key={key} type="button" role="tab" aria-selected={value === key} className={value === key ? 'on' : ''} onClick={() => onChange(key)}>
                    {label}{count !== undefined && <i>{count}</i>}
                </button>
            ))}
        </div>
    );
}

/** Переключатель вместо галочки. */
export function Toggle({ on, onChange, children, disabled }) {
    return <button type="button" className="ad-tgl" aria-pressed={!!on} disabled={disabled} onClick={() => onChange(!on)}>{children}</button>;
}

/** Поле поиска со значком лупы. */
export function Search({ value, onChange, placeholder }) {
    return (
        <label className="ad-search">
            <Ic n="search" />
            <input className="ad-fld" type="search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} />
        </label>
    );
}

/** Кнопка «+ …» (как у исполнителя): открывает форму на месте. */
export function PlusBtn({ on, onClick, children, disabled }) {
    return (
        <button type="button" className={'wk-plus' + (on ? ' on' : '')} aria-expanded={!!on} disabled={disabled} onClick={onClick}>
            <b aria-hidden="true" />{children}
        </button>
    );
}

/** Ширина экрана «компьютер» (как в CSS: от 860px). */
export const isWide = () => { try { return window.matchMedia('(min-width: 860px)').matches; } catch { return false; } };

/** Белая карточка на всю ширину — для больших разделов (службы, сеть, шаблоны, языки). */
export const Pane = ({ children }) => <div className="ad-list"><div className="ad-card">{children}</div></div>;
