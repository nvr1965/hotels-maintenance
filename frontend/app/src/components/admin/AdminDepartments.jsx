import { useState, useEffect, useCallback } from 'react';
import { tr, trNs, api, errText, S, Message, Ic, langName, isRtl } from './adminUi';

// Админка → Службы отеля: обслуживание здания, уборка номеров, кухни…
// Название на языках отеля (пустые сервер дописывает автопереводом), значок и цвет.
// Занятую службу удалить нельзя, её можно выключить.

const API = '/backend/api/admin_departments.php';
const ICONS = ['🛠️', '🧹', '🛏️', '🍳', '🥩', '🥛', '🍽️', '🧺', '🌿', '🏊', '🔌', '🚿', '❄️', '🛎️', '🚗', '🧾'];
const COLORS = ['#1f3a5f', '#2f6f4f', '#8a5a12', '#7a2e2e', '#5b3f8c', '#1f6b7a', '#9c3d6b', '#4a4a4a'];

export default function AdminDepartments({ lang }) {
    const t = { ...tr(lang), ...trNs('deps', lang) };
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);     // { id|null, names: {}, icon, color, active }
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [translating, setTranslating] = useState(false);

    const load = useCallback(async () => {
        const d = await api(`${API}?action=list`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const LANGS = data?.langs || [lang];
    const nameOf = (d) => d.names[lang] || LANGS.map(l => d.names[l]).find(Boolean) || Object.values(d.names)[0] || '—';

    const openNew = () => { setForm({ id: null, names: {}, icon: ICONS[0], color: COLORS[0], active: true }); setMsg(null); };
    const openEdit = (d) => {
        setForm({ id: d.id, names: { ...d.names }, icon: d.icon, color: d.color, active: d.active });
        setMsg(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const setName = (l, v) => setForm(f => ({ ...f, names: { ...f.names, [l]: v } }));

    const translate = async () => {
        const src = form.names[lang]?.trim() ? lang : LANGS.find(l => form.names[l]?.trim());
        if (!src) return;
        setTranslating(true);
        const d = await api('/backend/api/admin_dicts.php?action=translate', { text: form.names[src], from: src });
        setTranslating(false);
        if (!d.success) { setMsg({ ok: false, text: errText(t, d) }); return; }
        setForm(f => ({ ...f, names: { ...d.translations, ...Object.fromEntries(Object.entries(f.names).filter(([, v]) => v?.trim())) } }));
    };

    const post = async (action, body, okText) => {
        setBusy(true);
        setMsg(null);
        const d = await api(`${API}?action=${action}`, body);
        setBusy(false);
        if (!d.success) {
            const u = d.usage;
            setMsg({ ok: false, text: d.message === 'dep_in_use' && u ? t.in_use_full(u.staff, u.tasks, u.routine + u.checklist) : errText(t, d) });
            return false;
        }
        if (okText) setMsg({ ok: true, text: okText });
        await load();
        return true;
    };

    const save = async (e) => {
        e.preventDefault();
        if (await post('save', form, t.saved)) setForm(null);
    };

    if (!data) return <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <div className="ad-hint">{t.intro}</div>
            <div>
                <button type="button" className="ad-btn blue" onClick={openNew}>{t.add}</button>
            </div>
            <Message msg={msg} />

            {form && (
                <form onSubmit={save} className="ad-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="ad-hint">{t.translate_hint}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                        {LANGS.map(l => (
                            <label key={l} className="ad-lab">{langName(l)}
                                <input className="ad-fld" dir={isRtl(l) ? 'rtl' : 'ltr'} lang={l} value={form.names[l] ?? ''} onChange={e => setName(l, e.target.value)} />
                            </label>
                        ))}
                    </div>
                    <div className="ad-lab">{t.icon}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {ICONS.map(i => (
                                <button key={i} type="button" onClick={() => setForm(f => ({ ...f, icon: i }))} aria-pressed={form.icon === i}
                                    className="ad-btn" style={{ minWidth: '44px', fontSize: '20px', padding: '4px 8px', borderColor: form.icon === i ? 'var(--brand-button, #844128)' : '#d9cec5', borderWidth: form.icon === i ? '2px' : '1px' }}>{i}</button>
                            ))}
                            <input className="ad-fld" style={{ width: '70px', fontSize: '20px', textAlign: 'center' }} value={form.icon} maxLength={8} aria-label={t.icon}
                                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
                        </div>
                    </div>
                    <div className="ad-lab">{t.color}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {COLORS.map(c => (
                                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} aria-label={c} aria-pressed={form.color === c}
                                    style={{ width: '36px', height: '36px', borderRadius: '50%', background: c, cursor: 'pointer', border: form.color === c ? '3px solid #2b2320' : '2px solid #fff', boxShadow: '0 0 0 1px #d9cec5' }} />
                            ))}
                            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: '44px', height: '36px', border: 'none', background: 'none' }} aria-label={t.color} />
                        </div>
                    </div>
                    <label style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', fontWeight: 600 }}>
                        <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                            style={{ width: '20px', height: '20px', accentColor: 'var(--brand-button, #844128)' }} />
                        {t.active}
                    </label>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button type="submit" className="ad-btn blue" disabled={busy}>{t.save}</button>
                        <button type="button" className="ad-btn" onClick={translate} disabled={translating}>{translating ? t.translating : t.translate}</button>
                        <button type="button" className="ad-btn" onClick={() => setForm(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.items.map((d, n) => (
                    <div key={d.id} className="ad-card" style={{ flexDirection: 'row', background: '#fff', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', opacity: d.active ? 1 : 0.55 }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: d.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', flex: '0 0 auto' }}>{d.icon}</div>
                        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                            <b style={{ color: '#2b2320', fontSize: '17px' }}>{nameOf(d)}</b>
                            {!d.active && <span style={{ ...S.badge('#f1ece7', '#6e635b'), marginInlineStart: '8px' }}>{t.inactive}</span>}
                            <div className="ad-hint" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                                {LANGS.filter(l => l !== lang && d.names[l]).map(l => (
                                    <span key={l}>{l.toUpperCase()}: <bdi dir={isRtl(l) ? 'rtl' : 'ltr'}>{d.names[l]}</bdi></span>
                                ))}
                            </div>
                            <div className="ad-hint" style={{ marginTop: '4px' }}>{t.stats(d.usage.staff, d.usage.open_tasks, d.usage.routine)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button type="button" className="ad-btn" disabled={busy || n === 0} onClick={() => post('move', { id: d.id, dir: -1 })} aria-label={t.up}>↑</button>
                            <button type="button" className="ad-btn" disabled={busy || n === data.items.length - 1} onClick={() => post('move', { id: d.id, dir: 1 })} aria-label={t.down}>↓</button>
                            <button type="button" className="ad-btn" onClick={() => openEdit(d)}><Ic n="edit" /></button>
                            <button type="button" className="ad-btn danger" disabled={busy}
                                onClick={() => window.confirm(`${nameOf(d)}: ${t.confirm_delete}`) && post('delete', { id: d.id }, t.deleted)}><Ic n="trash" /></button>
                        </div>
                    </div>
                ))}
                {data.items.length === 0 && <div className="ad-hint" style={{ textAlign: 'center', padding: '20px' }}>{t.empty}</div>}
            </div>
        </div>
    );
}
