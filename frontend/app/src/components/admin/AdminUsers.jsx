import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, S, Message } from './adminUi';

// Админка → Сотрудники: создать, изменить имя-логин / пароль / роль / права администратора,
// заблокировать, выйти на всех устройствах, удалить.

const API = '/backend/api/admin_users.php';
const ROLES = ['worker', 'manager', 'head'];
const ROLE_COLORS = { worker: ['#eef3ff', '#2f4c8a'], manager: ['#fff4e0', '#8a5a12'], head: ['#f3e6ff', '#5b2d86'] };
const blank = { id: 0, name: '', password: '', role: 'worker', sysadmin: 0, active: 1 };

export default function AdminUsers({ lang }) {
    const t = tr(lang);
    const [users, setUsers] = useState(null);
    const [meId, setMeId] = useState(0);
    const [form, setForm] = useState(null);      // редактируемый сотрудник (id 0 — новый)
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [filter, setFilter] = useState('');

    const load = useCallback(async () => {
        const d = await api(`${API}?action=list`);
        if (d.success) { setUsers(d.users); setMeId(d.me); } else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const post = async (action, body, okText) => {
        setBusy(true);
        setMsg(null);
        let d = await api(`${API}?action=${action}`, body);
        if (!d.success && d.message === 'has_links' && window.confirm(t.user_links(d.links))) {
            d = await api(`${API}?action=${action}`, { ...body, force: 1 });
        }
        setBusy(false);
        if (d.success) {
            setMsg({ ok: true, text: okText });
            await load();
            return true;
        }
        if (d.message !== 'has_links') setMsg({ ok: false, text: errText(t, d) });
        return false;
    };

    const save = async (e) => {
        e.preventDefault();
        if (await post('save', form, t.saved)) setForm(null);
    };
    const toggleActive = (u) => post('save', { ...u, active: u.active ? 0 : 1 }, t.saved);
    const remove = (u) => { if (window.confirm(`${u.name}: ${t.confirm_delete}`)) post('delete', { id: u.id }, t.deleted).then(ok => ok && setForm(null)); };

    const roleName = (r) => t['role_' + r] || r;
    const shown = (users || []).filter(u => !filter || u.name.toLowerCase().includes(filter.toLowerCase()));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" style={S.primary} onClick={() => { setForm({ ...blank }); setMsg(null); }}>{t.new_user}</button>
                <input style={{ ...S.field, flex: '1 1 200px', width: 'auto' }} placeholder={t.search} value={filter} onChange={e => setFilter(e.target.value)} />
            </div>

            <Message msg={msg} />

            {form && (
                <form onSubmit={save} style={{ ...S.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'end' }}>
                    <label style={S.label}>{t.name_login}
                        <input style={S.field} value={form.name} required autoFocus onChange={e => setForm({ ...form, name: e.target.value })} />
                    </label>
                    <label style={S.label}>{form.id ? t.password_keep : t.password}
                        <input style={S.field} type="text" autoComplete="new-password" value={form.password || ''} required={!form.id}
                            onChange={e => setForm({ ...form, password: e.target.value })} />
                    </label>
                    <label style={S.label}>{t.role}
                        <select style={S.field} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                            {ROLES.map(r => <option key={r} value={r}>{roleName(r)}</option>)}
                        </select>
                    </label>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', paddingBottom: '8px' }}>
                        <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600, cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!form.sysadmin} onChange={e => setForm({ ...form, sysadmin: e.target.checked ? 1 : 0 })}
                                style={{ width: '20px', height: '20px', accentColor: 'var(--brand-button, #844128)' }} />
                            {t.sysadmin}
                        </label>
                        <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600, cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!form.active} onChange={e => setForm({ ...form, active: e.target.checked ? 1 : 0 })}
                                style={{ width: '20px', height: '20px', accentColor: 'var(--brand-button, #844128)' }} />
                            {t.active}
                        </label>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
                        <button type="submit" style={S.primary} disabled={busy}>{t.save}</button>
                        <button type="button" style={S.btn} onClick={() => setForm(null)}>{t.cancel}</button>
                        {form.id > 0 && form.id !== meId && (
                            <button type="button" style={{ ...S.danger, marginInlineStart: 'auto' }} disabled={busy} onClick={() => remove(form)}>🗑 {t.delete}</button>
                        )}
                    </div>
                </form>
            )}

            {!users ? <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '10px' }}>
                    {shown.map(u => {
                        const [bg, fg] = ROLE_COLORS[u.role] || ROLE_COLORS.worker;
                        return (
                            <div key={u.id} style={{ ...S.card, background: u.active ? '#fff' : '#f4efea', opacity: u.active ? 1 : 0.8, display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'start' }}>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <b style={{ fontSize: '18px', color: '#2b2320', overflowWrap: 'anywhere' }}>{u.name}</b>
                                    {u.id === meId && <span style={S.hint}>({t.you})</span>}
                                    <span style={{ ...S.hint, marginInlineStart: 'auto' }}>#{u.id}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    <span style={S.badge(bg, fg)}>{roleName(u.role)}</span>
                                    {u.sysadmin === 1 && <span style={S.badge('var(--brand-primary, #371f20)', 'var(--brand-text, #f9edd3)')}>🔑 {t.sysadmin}</span>}
                                    {!u.active && <span style={S.badge('#fdecea', '#a3301c')}>🚫 {t.blocked}</span>}
                                </div>
                                {u.plain_password && <div style={{ fontSize: '14px', color: '#a3301c' }}>⚠️ {t.plain_pw}</div>}
                                {u.devices > 0 && <div style={S.hint}>{t.devices}: {u.devices}{u.last_seen ? ` · ${t.last_seen}: ${u.last_seen.slice(0, 16)}` : ''}</div>}
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: 'auto' }}>
                                    <button type="button" style={S.btn} onClick={() => { setForm({ ...u, password: '' }); setMsg(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>✏️ {t.edit}</button>
                                    {u.id !== meId && (
                                        <button type="button" style={u.active ? S.danger : S.btn} disabled={busy} onClick={() => toggleActive(u)}>{u.active ? t.block : t.unblock}</button>
                                    )}
                                    {u.devices > 0 && (
                                        <button type="button" style={S.btn} disabled={busy} onClick={() => post('logout_all', { id: u.id }, t.logout_done)}>{t.logout_all}</button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ ...S.card, textAlign: 'start' }}>
                <b>{t.rights_title}</b>
                <ul style={{ margin: '8px 0 0', paddingInlineStart: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {ROLES.map(r => <li key={r}><b>{roleName(r)}</b>: {t['role_' + r + '_d']}</li>)}
                    <li><b>🔑 {t.sysadmin}</b>: {t.sysadmin_d}</li>
                </ul>
            </div>
        </div>
    );
}
