import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, Message, Ic, Toggle, Search, PlusBtn, isWide } from './adminUi';

// Админка → Сотрудники: создать, изменить имя-логин / пароль / роль / права администратора,
// заблокировать, выйти на всех устройствах, удалить.

const API = '/backend/api/admin_users.php';
const ROLES = ['worker', 'manager', 'head'];
const blank = { id: 0, name: '', password: '', role: 'worker', sysadmin: 0, active: 1 };

export default function AdminUsers({ lang }) {
    const t = tr(lang);
    const [users, setUsers] = useState(null);
    const [meId, setMeId] = useState(0);
    const [form, setForm] = useState(null);      // редактируемый сотрудник (id 0 — новый)
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [filter, setFilter] = useState('');
    const [open, setOpen] = useState(() => new Set());   // раскрытые плитки (на компьютере раскрыты все)
    const wide = isWide();

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
    const edit = (u) => { setForm({ ...u, password: '' }); setMsg(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const flip = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const roleName = (r) => t['role_' + r] || r;
    const shown = (users || []).filter(u => !filter || u.name.toLowerCase().includes(filter.toLowerCase()));

    return (
        <div className="ad-list">
            <div className="ad-top">
                <PlusBtn on={form && !form.id} onClick={() => { setForm(form && !form.id ? null : { ...blank }); setMsg(null); }}>{t.new_user}</PlusBtn>
                <Search value={filter} onChange={setFilter} placeholder={t.search} />
            </div>

            <Message msg={msg} />

            {form && (
                <form onSubmit={save} className="ad-card form">
                    {form.id > 0 && <h3><Ic n="edit" />{form.name}</h3>}
                    <div className="ad-form-grid">
                        <label className="ad-lab">{t.name_login}
                            <input className="ad-fld" value={form.name} required autoFocus onChange={e => setForm({ ...form, name: e.target.value })} />
                        </label>
                        <label className="ad-lab">{form.id ? t.password_keep : t.password}
                            <input className="ad-fld" type="text" autoComplete="new-password" value={form.password || ''} required={!form.id}
                                onChange={e => setForm({ ...form, password: e.target.value })} />
                        </label>
                    </div>
                    <div className="ad-lab">{t.role}
                        <div className="ad-chips" role="radiogroup" aria-label={t.role}>
                            {ROLES.map(r => (
                                <button key={r} type="button" role="radio" aria-checked={form.role === r} className={'ad-chp' + (form.role === r ? ' on' : '')}
                                    onClick={() => setForm({ ...form, role: r })}>{roleName(r)}</button>
                            ))}
                        </div>
                    </div>
                    <div className="ad-btnrow" style={{ gap: '18px' }}>
                        <Toggle on={!!form.sysadmin} onChange={v => setForm({ ...form, sysadmin: v ? 1 : 0 })}>{t.sysadmin}</Toggle>
                        <Toggle on={!!form.active} onChange={v => setForm({ ...form, active: v ? 1 : 0 })}>{t.active}</Toggle>
                    </div>
                    <button type="submit" className="wk-done lg" disabled={busy}><Ic n="save" />{t.save}</button>
                    <div className="ad-btnrow" style={{ justifyContent: 'center' }}>
                        <button type="button" className="ad-btn" onClick={() => setForm(null)}>{t.cancel}</button>
                        {form.id > 0 && form.id !== meId && (
                            <button type="button" className="ad-btn danger" disabled={busy} onClick={() => remove(form)}><Ic n="trash" />{t.delete}</button>
                        )}
                    </div>
                </form>
            )}

            {!users ? <div className="ad-empty">{t.loading}</div> : (
                <div className="ad-grid">
                    {shown.length === 0 && <div className="ad-empty ad-full">{t.empty}</div>}
                    {shown.map(u => {
                        const isOpen = wide !== open.has(u.id);
                        return (
                            <div key={u.id} className={'wk-tile' + (u.active ? '' : ' ad-off') + (isOpen ? ' open' : '')}>
                                <div className="wk-row" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => flip(u.id)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(u.id); } }}>
                                    <div className="txt">
                                        <div className="wk-place">{u.name}{u.id === meId && <span className="ad-place-sm"> ({t.you})</span>}</div>
                                        <div className="ad-chips">
                                            <span className={'ad-st role-' + (ROLES.includes(u.role) ? u.role : 'worker')}>{roleName(u.role)}</span>
                                            {u.sysadmin === 1 && <span className="ad-st admin"><Ic n="key" />{t.sysadmin}</span>}
                                            {!u.active && <span className="ad-st red"><Ic n="lock" />{t.blocked}</span>}
                                        </div>
                                    </div>
                                    <span className="ad-id"><bdi>#{u.id}</bdi></span>
                                </div>
                                {isOpen && (
                                    <div className="wk-more">
                                        {u.plain_password && <div className="ad-warn-t"><Ic n="warn" />{t.plain_pw}</div>}
                                        {u.devices > 0 && (
                                            <div className="ad-kv">{t.devices}: <b>{u.devices}</b>{u.last_seen ? <> · {t.last_seen}: <b><bdi>{u.last_seen.slice(0, 16)}</bdi></b></> : null}</div>
                                        )}
                                        <div className="ad-btnrow">
                                            <button type="button" className="ad-btn" onClick={() => edit(u)}><Ic n="edit" />{t.edit}</button>
                                            {u.id !== meId && (
                                                <button type="button" className={'ad-btn' + (u.active ? ' danger' : '')} disabled={busy} onClick={() => toggleActive(u)}>
                                                    <Ic n={u.active ? 'lock' : 'unlock'} />{u.active ? t.block : t.unblock}
                                                </button>
                                            )}
                                            {u.devices > 0 && (
                                                <button type="button" className="ad-btn" disabled={busy} onClick={() => post('logout_all', { id: u.id }, t.logout_done)}>
                                                    <Ic n="logout" />{t.logout_all}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="ad-card">
                <h3>{t.rights_title}</h3>
                <ul className="ad-rights">
                    {ROLES.map(r => <li key={r}><b>{roleName(r)}</b>: {t['role_' + r + '_d']}</li>)}
                    <li><b>{t.sysadmin}</b>: {t.sysadmin_d}</li>
                </ul>
            </div>
        </div>
    );
}
