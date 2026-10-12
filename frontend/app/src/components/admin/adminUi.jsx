// Общее для разделов админки: тексты на языке интерфейса, запросы к API, стили.
import { uiText, isRtl, langName, languageList } from '../../i18n';

export { isRtl, langName, languageList };


export function tr(lang) {
    return uiText('admin', lang);
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

// Стили в тон приложению
export const S = {
    field: { padding: '9px 11px', border: '1px solid #d9cec5', borderRadius: '10px', fontSize: '16px', background: '#fff', minWidth: 0, width: '100%', boxSizing: 'border-box', color: '#2b2320' },
    label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '15px', color: '#5a4f48', fontWeight: 600, minWidth: 0 },
    btn: { minHeight: '40px', padding: '7px 14px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: '1px solid #d9cec5', background: '#fff', color: '#3f3530' },
    primary: { minHeight: '40px', padding: '7px 16px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: 'none', background: 'var(--brand-button, #844128)', color: '#fff' },
    danger: { minHeight: '40px', padding: '7px 14px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: '1px solid #e9b8ae', background: '#fff5f3', color: '#a3301c' },
    card: { background: '#fcf9f6', border: '1px solid #ebe3dc', borderRadius: '12px', padding: '14px' },
    th: { padding: '10px', fontSize: '14px', color: '#5a4f48', borderBottom: '2px solid #ebe3dc', whiteSpace: 'nowrap' },
    td: { padding: '9px 10px', borderBottom: '1px solid #f3ebe2', verticalAlign: 'top' },
    hint: { fontSize: '14px', color: '#7d726a' },
    badge: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '13px', fontWeight: 'bold', background: bg, color: fg }),
};

export function Message({ msg }) {
    if (!msg) return null;
    return (
        <div role="status" style={{ padding: '10px 14px', borderRadius: '10px', fontWeight: 600,
            background: msg.ok ? '#e7f6ec' : '#fdecea', color: msg.ok ? '#1f6b3d' : '#a3301c', border: `1px solid ${msg.ok ? '#b9e2c6' : '#f2c3bb'}` }}>
            {msg.text}
        </div>
    );
}

/** Переключатель-«пилюли» для подразделов. */
export function Pills({ items, value, onChange }) {
    return (
        <div style={{ display: 'flex', gap: '4px', padding: '4px', background: '#f1e3d2', borderRadius: '12px', flexWrap: 'wrap' }}>
            {items.map(([key, label]) => (
                <button key={key} type="button" onClick={() => onChange(key)}
                    style={{ flex: '1 1 auto', minWidth: 0, minHeight: '42px', padding: '8px 10px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px',
                        background: value === key ? '#fff' : 'transparent', color: value === key ? 'var(--brand-button, #844128)' : '#5a4f48', boxShadow: value === key ? '0 1px 3px rgba(55,31,32,0.15)' : 'none' }}>
                    {label}
                </button>
            ))}
        </div>
    );
}
