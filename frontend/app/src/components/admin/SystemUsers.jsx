import { useState, useEffect, useCallback } from 'react';
import { tr, trNs, api, errText, S, Message, Ic } from './adminUi';

// Общая админка → Пользователи системы: владелец системы и поддержка.
// Они над отелями: в списках сотрудников отелей их нет, заводятся только здесь.

const API = '/backend/api/admin_system_users.php';
const blank = { id: 0, login: '', name: '', role: 'support', password: '', active: true };

export default function SystemUsers({ lang }) {
    const t = { ...tr(lang), ...trNs('sysusers', lang) };
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const d = await api(`${API}?action=list`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const d = await api(`${API}?action=save`, form);
        setBusy(false);
        if (!d.success) { setMsg({ ok: false, text: errText(t, d) }); return; }
        setMsg({ ok: true, text: t.saved });
        setForm(null);
        load();
    };

    if (!data) return <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div>;
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <div className="ad-hint">{t.intro}</div>
            <div><button type="button" className="ad-btn blue" onClick={() => { setForm({ ...blank }); setMsg(null); }}>{t.add}</button></div>
            <Message msg={msg} />

            {form && (
                <form onSubmit={save} className="ad-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                        <label className="ad-lab">{t.login}
                            <input className="ad-fld" required dir="ltr" autoComplete="off" value={form.login} onChange={e => set('login', e.target.value)} />
                        </label>
                        <label className="ad-lab">{t.name}
                            <input className="ad-fld" value={form.name} onChange={e => set('name', e.target.value)} />
                        </label>
                        <label className="ad-lab">{form.id ? t.password_keep : t.password}
                            <input className="ad-fld" type="text" autoComplete="new-password" required={!form.id} value={form.password} onChange={e => set('password', e.target.value)} />
                        </label>
                        <label className="ad-lab">{t.role}
                            <select className="ad-fld" value={form.role} disabled={form.me} onChange={e => set('role', e.target.value)}>
                                {data.roles.map(r => <option key={r} value={r}>{t['role_' + r]}</option>)}
                            </select>
                        </label>
                    </div>
                    <div className="ad-hint">{t['role_' + form.role + '_hint']}</div>
                    {!form.me && (
                        <label style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', fontWeight: 600 }}>
                            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} style={{ width: '20px', height: '20px' }} />
                            {t.active}
                        </label>
                    )}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button type="submit" className="ad-btn blue" disabled={busy}>{t.save}</button>
                        <button type="button" className="ad-btn" onClick={() => setForm(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.items.map(u => (
                    <div key={u.id} className="ad-card" style={{ flexDirection: 'row', background: '#fff', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', opacity: u.active ? 1 : 0.55 }}>
                        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                            <b style={{ fontSize: '17px', color: '#2b2320' }}>{u.name}</b>
                            {u.me && <span className="ad-hint" style={{ marginInlineStart: '6px' }}>({t.you})</span>}
                            <div className="ad-hint"><bdi dir="ltr">{u.login}</bdi> · {t['role_' + u.role]}{!u.active && ` · ${t.inactive}`}</div>
                        </div>
                        <button type="button" className="ad-btn" onClick={() => { setForm({ ...u, password: '' }); setMsg(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Ic n="edit" /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}
