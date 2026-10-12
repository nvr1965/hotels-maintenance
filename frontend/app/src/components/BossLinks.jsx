import { useState, useEffect } from 'react';

// Ссылки для начальника: по ссылке сразу открывается отчёт по счётчикам на иврите, без входа.
// Ссылка даёт доступ только к этому отчёту и Excel. Отключённая ссылка перестаёт работать сразу.

const fmtDT = (s) => s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) + ' ' + s.slice(11, 16) : 'ещё не открывали';

export default function BossLinks() {
    const [links, setLinks] = useState(null);
    const [label, setLabel] = useState('Начальник');
    const [copied, setCopied] = useState(null);
    const [error, setError] = useState('');

    const call = async (body) => {
        setError('');
        try {
            const res = await fetch('/backend/api/meter_link.php', body
                ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
                : undefined);
            const data = await res.json();
            if (data.success) setLinks(data.links); else setError('Не получилось: ' + (data.message || 'ошибка'));
        } catch {
            setError('Нет связи с сервером');
        }
    };
    useEffect(() => { call(); }, []);

    const copy = async (l) => {
        try { await navigator.clipboard.writeText(l.url); }
        catch { window.prompt('Скопируйте ссылку:', l.url); }
        setCopied(l.id);
        setTimeout(() => setCopied(c => (c === l.id ? null : c)), 2000);
    };
    const revoke = (l) => {
        if (window.confirm(`Отключить ссылку «${l.label || 'без названия'}»? По ней больше ничего не откроется.`)) call({ action: 'revoke', id: l.id });
    };

    const btn = { minHeight: '40px', padding: '8px 14px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' };

    return (
        <div style={{ border: '1px solid #ebe3dc', borderRadius: '14px', padding: '14px 16px', background: '#fffdfa' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '18px', color: 'var(--brand-primary, #371f20)' }}>🔗 Ссылка для начальника</h3>
            <div style={{ fontSize: '15px', color: '#6e635b', marginBottom: '12px' }}>
                По ссылке сразу открывается отчёт по счётчикам на иврите, без пароля и без меню. Больше ничего по ней не видно.
                Если ссылка ушла не туда, отключите её и сделайте новую.
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Для кого (например, Начальник)"
                    style={{ flex: '1 1 220px', padding: '9px 10px', border: '1px solid #d9cec5', fontSize: '16px', minWidth: 0 }} />
                <button type="button" onClick={() => call({ action: 'create', label })}
                    style={{ ...btn, background: 'var(--brand-button, #844128)', color: '#fff', border: 'none' }}>Создать ссылку</button>
            </div>
            {error && <div style={{ color: '#c43d3d', marginBottom: '8px' }}>{error}</div>}
            {links && links.length === 0 && <div style={{ color: '#7d726a' }}>Ссылок пока нет.</div>}
            {links && links.map(l => (
                <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 0', borderTop: '1px solid #f3ebe2' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <b>{l.label || 'Без названия'}</b>
                        <span style={{ fontSize: '14px', color: '#7d726a' }}>Последний раз открывали: {fmtDT(l.last_used_at)}</span>
                    </div>
                    <input readOnly value={l.url} onFocus={e => e.target.select()} dir="ltr"
                        style={{ padding: '8px 10px', border: '1px solid #d9cec5', fontSize: '14px', background: '#f8efe6', color: '#3f3530', minWidth: 0 }} />
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => copy(l)} style={{ ...btn, background: '#26875a', color: '#fff', border: 'none' }}>
                            {copied === l.id ? '✓ Скопировано' : 'Скопировать'}
                        </button>
                        <a href={l.url} target="_blank" rel="noreferrer" style={{ ...btn, display: 'inline-flex', alignItems: 'center', border: '1px solid #d9cec5', color: '#3f3530', textDecoration: 'none', background: '#fff' }}>Открыть</a>
                        <button type="button" onClick={() => revoke(l)} style={{ ...btn, background: '#fff', color: '#c43d3d', border: '1px solid #e7b9b9' }}>Отключить</button>
                    </div>
                </div>
            ))}
        </div>
    );
}
