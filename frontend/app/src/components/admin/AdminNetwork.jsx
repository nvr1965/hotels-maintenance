import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, S, Message, langName, languageList } from './adminUi';
import { setBrand, getBrand } from '../../brand';
import { uiText } from '../../i18n';

// Админка → Сеть (для администраторов сети и владельца системы): отели сети с настройками и брендингом,
// новый отель с копией справочников, люди в отелях сети, администраторы и наблюдатели сети.
// Сотрудники текущего отеля по-прежнему во вкладке «Сотрудники»; здесь — то, что шире одного отеля.

const API = '/backend/api/net_admin.php';
const ROLES = ['worker', 'manager', 'head'];
const ORG_ROLES = ['org_admin', 'org_viewer'];


const TIMEZONES = (() => {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Jerusalem', 'Europe/Moscow']; }
})();

const blankHotel = (orgId) => ({
    id: 0, org_id: orgId, name: '', slug: '', address: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    languages: ['en'], default_lang: 'en', brand_title: {},
    brand_subtitle: '', logo_url: '', color_primary: '#1f3a5f', color_accent: '#c9a96e', color_text: '#ffffff', color_button: '#1f3a5f',
    active: 1, settings: { push_roles: ['worker', 'head'] }, copy_from_hotel_id: 0, template_id: 0,
});

// Строка из списка отелей (net_admin hotels) → форма
const toForm = (h) => ({
    id: h.id, org_id: h.org_id, name: h.name, slug: h.slug, address: h.address || '', timezone: h.timezone,
    languages: h.languages, default_lang: h.default_lang,
    brand_title: { ...(h.brand_title || {}) },   // пустые языки сервер заполнит автопереводом
    brand_subtitle: h.brand.subtitle || '', logo_url: h.brand.logo_url || '',
    color_primary: h.brand.color_primary, color_accent: h.brand.color_accent, color_text: h.brand.color_text, color_button: h.brand.color_button,
    active: h.active, settings: Array.isArray(h.settings) ? {} : { ...h.settings },
});

// Все включённые языки системы (страница «Языки»), по порядку
const ALL_LANGS = () => languageList().map(l => l.code);

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export default function AdminNetwork({ lang, onOpenHotel }) {
    const base = tr(lang);
    const t = { ...base, ...uiText('network', lang) };
    const fail = (d) => ({ ok: false, text: errText(t, d) });

    const [orgs, setOrgs] = useState(null);
    const [canCreateOrg, setCanCreateOrg] = useState(false);
    const [orgId, setOrgId] = useState(0);
    const [hotels, setHotels] = useState(null);
    const [orgPeople, setOrgPeople] = useState([]);
    const [form, setForm] = useState(null);         // отель в правке (id 0 — новый)
    const [orgForm, setOrgForm] = useState(null);   // сеть в правке
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);

    const loadOrgs = useCallback(async () => {
        const d = await api(`${API}?action=orgs`);
        if (!d.success) { setOrgs([]); setMsg(fail(d)); return; }
        const admin = d.orgs.filter(o => o.role === 'org_admin');
        setOrgs(admin);
        setCanCreateOrg(d.can_create);
        setOrgId(cur => (admin.some(o => o.id === cur) ? cur : (admin.find(o => o.id === getBrand().hotel?.org_id)?.id || admin[0]?.id || 0)));
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadOrg = useCallback(async () => {
        if (!orgId) return;
        const [h, p] = await Promise.all([api(`${API}?action=hotels&org_id=${orgId}`), api(`${API}?action=org_members&org_id=${orgId}`)]);
        if (h.success) setHotels(h.hotels); else setMsg(fail(h));
        if (p.success) setOrgPeople(p.members);
    }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { loadOrgs(); }, [loadOrgs]);
    useEffect(() => { setHotels(null); loadOrg(); }, [loadOrg]);

    const post = async (action, body) => {
        setBusy(true);
        setMsg(null);
        const d = await api(`${API}?action=${action}`, body);
        setBusy(false);
        if (!d.success) setMsg(fail(d));
        return d;
    };

    const saveHotel = async (e) => {
        e.preventDefault();
        const d = await post('hotel_save', form);
        if (!d.success) return;
        setMsg({ ok: true, text: form.id ? t.saved : [d.copied ? t.created_copied(d.copied.asset_dictionary, d.copied.room_checklist_dict, d.copied.routine_tasks) : t.created,
            d.built ? t.created_built(d.built.rooms, d.built.common) : ''].filter(Boolean).join('. ') });
        setForm(null);
        await loadOrg();
        // Правили текущий отель — сразу применить новое оформление
        const cur = getBrand();
        if (form.id && form.id === cur.hotel?.id) {
            const me = await api('/backend/api/me.php');
            if (me.success) setBrand(me);
        }
    };

    const saveOrg = async (e) => {
        e.preventDefault();
        const d = await post('org_save', orgForm);
        if (!d.success) return;
        setMsg({ ok: true, text: t.saved });
        setOrgForm(null);
        await loadOrgs();
        setOrgId(d.id);
    };

    if (orgs === null) return <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div>;
    if (orgs.length === 0 && !canCreateOrg) return <div style={{ padding: '20px' }}><Message msg={msg || { ok: false, text: t.no_access }} /></div>;

    const currentHotelId = getBrand().hotel?.id;
    const org = orgs.find(o => o.id === orgId);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'start' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {orgs.length > 0 && (
                    <label style={{ ...S.label, flex: '1 1 220px' }}>{t.org}
                        <select style={S.field} value={orgId} onChange={e => { setOrgId(Number(e.target.value)); setForm(null); }}>
                            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                    </label>
                )}
                {org && <button type="button" style={S.btn} onClick={() => setOrgForm({ id: org.id, name: org.name, slug: org.slug })}>{t.edit}</button>}
                {canCreateOrg && <button type="button" style={S.btn} onClick={() => setOrgForm({ id: 0, name: '', slug: '' })}>{t.new_org}</button>}
            </div>

            <Message msg={msg} />

            {orgForm && (
                <form onSubmit={saveOrg} style={{ ...S.card, display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <label style={S.label}>{t.org_name}
                        <input style={S.field} required value={orgForm.name}
                            onChange={e => setOrgForm(f => ({ ...f, name: e.target.value, slug: f.id ? f.slug : slugify(e.target.value) }))} />
                    </label>
                    <label style={S.label}>{t.slug}
                        <input style={S.field} required value={orgForm.slug} onChange={e => setOrgForm(f => ({ ...f, slug: e.target.value }))} dir="ltr" />
                    </label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                        <button type="submit" style={S.primary} disabled={busy}>{t.save}</button>
                        <button type="button" style={S.btn} onClick={() => setOrgForm(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}

            {org && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0 }}>{t.hotels}</h3>
                        <button type="button" style={S.primary} onClick={() => { setMsg(null); setForm(blankHotel(orgId)); }}>{t.new_hotel}</button>
                    </div>

                    {form && form.id === 0 && <HotelForm t={t} form={form} setForm={setForm} hotels={hotels || []} busy={busy} onSubmit={saveHotel} onCancel={() => setForm(null)} />}

                    {hotels === null ? <div style={S.hint}>{t.loading}</div> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {hotels.map(h => (
                                <div key={h.id} style={S.card}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                        <span style={{ width: '38px', height: '38px', borderRadius: '50%', flex: 'none', background: h.brand.color_primary, color: h.brand.color_accent,
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', overflow: 'hidden' }}>
                                            {h.brand.logo_url ? <img src={h.brand.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : h.name.slice(0, 1).toUpperCase()}
                                        </span>
                                        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '17px' }}>
                                                {h.name}
                                                {h.id === currentHotelId && <span style={{ marginInlineStart: '8px', ...S.badge('#e7f6ec', '#1f6b3d') }}>{t.current}</span>}
                                                {!h.active && <span style={{ marginInlineStart: '8px', ...S.badge('#fdecea', '#a3301c') }}>{t.off}</span>}
                                            </div>
                                            <div style={S.hint}>{h.slug} · {h.timezone} · {t.members_n(h.members)} · {t.assets_n(h.assets)}</div>
                                        </div>
                                        {onOpenHotel && h.active && <button type="button" style={S.primary} onClick={() => onOpenHotel(h.id)}>{t.open_hotel}</button>}
                                        <button type="button" style={S.btn} onClick={() => { setMsg(null); setForm(form?.id === h.id ? null : toForm(h)); }}>{form?.id === h.id ? t.close : t.edit}</button>
                                    </div>
                                    {form && form.id === h.id && (
                                        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                            <HotelForm t={t} form={form} setForm={setForm} hotels={hotels} busy={busy} onSubmit={saveHotel} onCancel={() => setForm(null)} />
                                            <HotelPeople t={t} hotelId={h.id} hotels={hotels} setMsg={setMsg} fail={fail} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <OrgPeople t={t} orgId={orgId} hotels={hotels || []} people={orgPeople} reload={loadOrg} post={post} setMsg={setMsg} busy={busy} />
                </>
            )}
        </div>
    );
}

function HotelForm({ t, form, setForm, hotels, busy, onSubmit, onCancel }) {
    // Шаблоны структуры (корпуса, этажи, номера) — только у владельца системы; у остальных список пуст
    const [templates, setTemplates] = useState([]);
    useEffect(() => {
        if (form.id !== 0) return;
        api('/backend/api/admin_templates.php?action=list').then(d => { if (d.success) setTemplates(d.items); });
    }, [form.id]);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const toggleLang = (l) => setForm(f => {
        const langs = f.languages.includes(l) ? f.languages.filter(x => x !== l) : ALL_LANGS().filter(x => x === l || f.languages.includes(x));
        return { ...f, languages: langs, default_lang: langs.includes(f.default_lang) ? f.default_lang : (langs[0] || f.default_lang) };
    });
    const pushRoles = form.settings?.push_roles || ['worker', 'head'];
    const togglePush = (r) => setForm(f => {
        const cur = f.settings?.push_roles || ['worker', 'head'];
        return { ...f, settings: { ...f.settings, push_roles: cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r] } };
    });
    const grid = { display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' };
    const title = form.brand_title?.[form.default_lang] || form.name || '…';

    return (
        <form onSubmit={onSubmit} style={{ ...S.card, background: '#fff', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <b>{t.h_main}</b>
            <div style={grid}>
                <label style={S.label}>{t.name}
                    <input style={S.field} required value={form.name}
                        onChange={e => { const v = e.target.value; setForm(f => ({ ...f, name: v, slug: f.id ? f.slug : slugify(v) })); }} />
                </label>
                <label style={S.label}>{t.slug}
                    <input style={S.field} required dir="ltr" value={form.slug} onChange={e => set('slug', e.target.value)} />
                </label>
                <label style={S.label}>{t.address}
                    <input style={S.field} value={form.address} onChange={e => set('address', e.target.value)} />
                </label>
                <label style={S.label}>{t.timezone}
                    <select style={S.field} value={form.timezone} onChange={e => set('timezone', e.target.value)}>
                        {(TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES]).map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                </label>
            </div>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={S.label}>{t.languages}</span>
                {ALL_LANGS().map(l => (
                    <label key={l} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        <input type="checkbox" checked={form.languages.includes(l)} onChange={() => toggleLang(l)} /> {langName(l)}
                    </label>
                ))}
                <label style={{ ...S.label, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>{t.default_lang}
                    <select style={{ ...S.field, width: 'auto' }} value={form.default_lang} onChange={e => set('default_lang', e.target.value)}>
                        {form.languages.map(l => <option key={l} value={l}>{langName(l)}</option>)}
                    </select>
                </label>
            </div>
            {form.id === 0 && templates.length > 0 && (
                <label style={S.label}>{t.template}
                    <select style={S.field} value={form.template_id || 0} onChange={e => set('template_id', Number(e.target.value))}>
                        <option value={0}>{t.template_none}</option>
                        {templates.map(x => <option key={x.id} value={x.id}>{x.name} — {t.template_sum(x.summary.buildings, x.summary.rooms)}</option>)}
                    </select>
                </label>
            )}
            {form.id === 0 && (
                <label style={S.label}>{t.copy_from}
                    <select style={S.field} value={form.copy_from_hotel_id} onChange={e => set('copy_from_hotel_id', Number(e.target.value))}>
                        <option value={0}>{t.copy_none}</option>
                        {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                </label>
            )}
            <label style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked ? 1 : 0)} /> {t.active}
            </label>

            <b>{t.h_brand}</b>
            <div style={S.hint}>{t.title_hint}</div>
            <div style={grid}>
                {form.languages.map(l => (
                    <label key={l} style={S.label}>{t.title_in(langName(l))}
                        <input style={S.field} dir="auto" value={form.brand_title?.[l] || ''} placeholder={form.name}
                            onChange={e => { const v = e.target.value; setForm(f => ({ ...f, brand_title: { ...f.brand_title, [l]: v } })); }} />
                    </label>
                ))}
                <label style={S.label}>{t.subtitle}
                    <input style={S.field} dir="auto" value={form.brand_subtitle} onChange={e => set('brand_subtitle', e.target.value)} />
                </label>
                <label style={S.label}>{t.logo}
                    <input style={S.field} dir="ltr" value={form.logo_url} onChange={e => set('logo_url', e.target.value)} />
                </label>
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {['color_primary', 'color_accent', 'color_text', 'color_button'].map(c => (
                    <label key={c} style={{ ...S.label, alignItems: 'flex-start' }}>{t['c_' + c.slice(6)]}
                        <input type="color" value={form[c]} onChange={e => set(c, e.target.value)} style={{ width: '64px', height: '40px', border: '1px solid #d9cec5', borderRadius: '8px', padding: '2px', background: '#fff' }} />
                    </label>
                ))}
            </div>
            <div>
                <div style={S.hint}>{t.preview}</div>
                <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '12px', background: form.color_primary, color: form.color_text, flexWrap: 'wrap' }}>
                    <span style={{ width: '40px', height: '40px', borderRadius: '50%', background: form.color_accent, color: form.color_primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', overflow: 'hidden', flex: 'none' }}>
                        {form.logo_url ? <img src={form.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : (form.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '18px' }} dir="auto">{title}</div>
                        {form.brand_subtitle && <div style={{ fontSize: '13px', color: form.color_accent }} dir="auto">{form.brand_subtitle}</div>}
                    </div>
                    <span style={{ marginInlineStart: 'auto', padding: '8px 14px', borderRadius: '10px', background: form.color_button, color: '#fff', fontWeight: 'bold' }}>{t.save}</span>
                </div>
            </div>

            <b>{t.h_push}</b>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={S.hint}>{t.push_hint}:</span>
                {ROLES.map(r => (
                    <label key={r} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        <input type="checkbox" checked={pushRoles.includes(r)} onChange={() => togglePush(r)} /> {t['role_' + r]}
                    </label>
                ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={S.primary} disabled={busy}>{t.save}</button>
                <button type="button" style={S.btn} onClick={onCancel}>{t.cancel}</button>
            </div>
        </form>
    );
}

// Люди выбранного отеля: роль, администратор, убрать; добавить человека из других отелей сети или нового
function HotelPeople({ t, hotelId, hotels, setMsg, fail }) {
    const [people, setPeople] = useState(null);
    const [others, setOthers] = useState([]);
    const [add, setAdd] = useState(null);

    const load = useCallback(async () => {
        const d = await api(`${API}?action=members&hotel_id=${hotelId}`);
        if (d.success) setPeople(d.members); else setMsg(fail(d));
    }, [hotelId]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    // Кандидаты: люди других отелей этой сети
    useEffect(() => {
        let gone = false;
        Promise.all(hotels.filter(h => h.id !== hotelId).map(h => api(`${API}?action=members&hotel_id=${h.id}`))).then(rs => {
            const map = new Map();
            rs.forEach(r => (r.members || []).forEach(m => map.set(m.id, m)));
            if (!gone) setOthers([...map.values()].sort((a, b) => a.display_name.localeCompare(b.display_name)));
        });
        return () => { gone = true; };
    }, [hotelId, hotels]);

    const save = async (body) => {
        setMsg(null);
        const d = await api(`${API}?action=member_save`, { hotel_id: hotelId, ...body });
        if (!d.success) { setMsg(fail(d)); return false; }
        setMsg({ ok: true, text: t.saved });
        await load();
        return true;
    };
    const remove = async (m) => {
        if (!window.confirm(`${m.display_name}: ${t.remove}?`)) return;
        const d = await api(`${API}?action=member_remove`, { hotel_id: hotelId, user_id: m.id });
        if (!d.success) setMsg(fail(d)); else { setMsg({ ok: true, text: t.deleted }); load(); }
    };

    if (people === null) return <div style={S.hint}>{t.loading}</div>;
    const inHotel = new Set(people.map(p => p.id));
    const candidates = others.filter(o => !inHotel.has(o.id));

    return (
        <div style={{ ...S.card, background: '#fff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <b>{t.h_people}</b>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        {people.map(m => (
                            <tr key={m.id} style={{ opacity: m.active && m.user_active ? 1 : 0.5 }}>
                                <td style={S.td}><b dir="auto">{m.display_name}</b><div style={S.hint} dir="ltr">{m.login}</div></td>
                                <td style={S.td}>
                                    <select style={{ ...S.field, width: 'auto' }} value={m.role} onChange={e => save({ user_id: m.id, role: e.target.value, is_admin: m.is_admin, active: m.active })}>
                                        {ROLES.map(r => <option key={r} value={r}>{t['role_' + r]}</option>)}
                                    </select>
                                </td>
                                <td style={S.td}>
                                    <label style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                                        <input type="checkbox" checked={!!m.is_admin} onChange={e => save({ user_id: m.id, role: m.role, is_admin: e.target.checked ? 1 : 0, active: m.active })} /> {t.is_admin}
                                    </label>
                                </td>
                                <td style={{ ...S.td, textAlign: 'end' }}><button type="button" style={S.danger} onClick={() => remove(m)}>{t.remove}</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {!add ? (
                <div><button type="button" style={S.btn} onClick={() => setAdd({ mode: candidates.length ? 'network' : 'new', user_id: 0, login: '', display_name: '', password: '', role: 'worker', is_admin: 0 })}>{t.add_person}</button></div>
            ) : (
                <form onSubmit={async e => {
                    e.preventDefault();
                    const body = add.mode === 'network'
                        ? { user_id: add.user_id, role: add.role, is_admin: add.is_admin }
                        : { login: add.login, display_name: add.display_name || add.login, password: add.password, role: add.role, is_admin: add.is_admin };
                    if (await save(body)) setAdd(null);
                }} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                        {candidates.length > 0 && <label><input type="radio" checked={add.mode === 'network'} onChange={() => setAdd(a => ({ ...a, mode: 'network' }))} /> {t.from_network}</label>}
                        <label><input type="radio" checked={add.mode === 'new'} onChange={() => setAdd(a => ({ ...a, mode: 'new' }))} /> {t.new_person}</label>
                    </div>
                    <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                        {add.mode === 'network' ? (
                            <label style={S.label}>{t.display_name}
                                <select style={S.field} required value={add.user_id || ''} onChange={e => setAdd(a => ({ ...a, user_id: Number(e.target.value) }))}>
                                    <option value="">{t.pick}</option>
                                    {candidates.map(c => <option key={c.id} value={c.id}>{c.display_name} ({c.login})</option>)}
                                </select>
                            </label>
                        ) : (
                            <>
                                <label style={S.label}>{t.login}<input style={S.field} required value={add.login} onChange={e => setAdd(a => ({ ...a, login: e.target.value }))} /></label>
                                <label style={S.label}>{t.display_name}<input style={S.field} value={add.display_name} placeholder={add.login} onChange={e => setAdd(a => ({ ...a, display_name: e.target.value }))} /></label>
                                <label style={S.label}>{t.password}<input style={S.field} required minLength={6} type="password" autoComplete="new-password" value={add.password} onChange={e => setAdd(a => ({ ...a, password: e.target.value }))} /></label>
                            </>
                        )}
                        <label style={S.label}>{t.role_label}
                            <select style={S.field} value={add.role} onChange={e => setAdd(a => ({ ...a, role: e.target.value }))}>
                                {ROLES.map(r => <option key={r} value={r}>{t['role_' + r]}</option>)}
                            </select>
                        </label>
                    </div>
                    <label style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        <input type="checkbox" checked={!!add.is_admin} onChange={e => setAdd(a => ({ ...a, is_admin: e.target.checked ? 1 : 0 }))} /> {t.is_admin}
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="submit" style={S.primary}>{t.add}</button>
                        <button type="button" style={S.btn} onClick={() => setAdd(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}
        </div>
    );
}

// Администраторы и наблюдатели сети
function OrgPeople({ t, orgId, hotels, people, reload, post, setMsg, busy }) {
    const [add, setAdd] = useState(null);
    const [staff, setStaff] = useState([]);
    useEffect(() => {
        if (!add) return;
        let gone = false;
        Promise.all(hotels.map(h => api(`${API}?action=members&hotel_id=${h.id}`))).then(rs => {
            const map = new Map();
            rs.forEach(r => (r.members || []).forEach(m => map.set(m.id, m)));
            if (!gone) setStaff([...map.values()].sort((a, b) => a.display_name.localeCompare(b.display_name)));
        });
        return () => { gone = true; };
    }, [!!add, hotels]); // eslint-disable-line react-hooks/exhaustive-deps
    const inOrg = new Set(people.map(p => p.id));
    const candidates = staff.filter(s => !inOrg.has(s.id));
    const change = async (body) => {
        const d = await post('org_member_save', { org_id: orgId, ...body });
        if (d.success) { setMsg({ ok: true, text: t.saved }); await reload(); }
        return d.success;
    };
    const remove = async (p) => {
        if (!window.confirm(`${p.display_name}: ${t.remove_org}?`)) return;
        const d = await post('org_member_remove', { org_id: orgId, user_id: p.id });
        if (d.success) { setMsg({ ok: true, text: t.deleted }); reload(); }
    };

    return (
        <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ margin: 0 }}>{t.org_people}</h3>
            <div style={S.hint}>{t.org_admin}: {t.org_admin_d} {t.org_viewer}: {t.org_viewer_d}</div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        {people.map(p => (
                            <tr key={p.id}>
                                <td style={S.td}><b dir="auto">{p.display_name}</b><div style={S.hint} dir="ltr">{p.login}</div></td>
                                <td style={S.td}>
                                    <select style={{ ...S.field, width: 'auto' }} value={p.role} onChange={e => change({ user_id: p.id, role: e.target.value })}>
                                        {ORG_ROLES.map(r => <option key={r} value={r}>{t[r]}</option>)}
                                    </select>
                                </td>
                                <td style={{ ...S.td, textAlign: 'end' }}><button type="button" style={S.danger} onClick={() => remove(p)}>{t.remove_org}</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!add ? (
                <div><button type="button" style={S.btn} onClick={() => setAdd({ mode: 'network', user_id: 0, login: '', display_name: '', password: '', role: 'org_viewer' })}>{t.add_person}</button></div>
            ) : (
                <form onSubmit={async e => {
                    e.preventDefault();
                    const body = add.mode === 'network' ? { user_id: add.user_id, role: add.role }
                        : { login: add.login, display_name: add.display_name || add.login, password: add.password, role: add.role };
                    if (await change(body)) setAdd(null);
                }} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                        <label><input type="radio" checked={add.mode === 'network'} onChange={() => setAdd(a => ({ ...a, mode: 'network' }))} /> {t.from_network}</label>
                        <label><input type="radio" checked={add.mode === 'new'} onChange={() => setAdd(a => ({ ...a, mode: 'new' }))} /> {t.new_person}</label>
                    </div>
                    <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', alignItems: 'end' }}>
                        {add.mode === 'network' ? (
                            <label style={S.label}>{t.display_name}
                                <select style={S.field} required value={add.user_id || ''} onChange={e => setAdd(a => ({ ...a, user_id: Number(e.target.value) }))}>
                                    <option value="">{t.pick}</option>
                                    {candidates.map(c => <option key={c.id} value={c.id}>{c.display_name} ({c.login})</option>)}
                                </select>
                            </label>
                        ) : (
                            <>
                                <label style={S.label}>{t.login}<input style={S.field} required value={add.login} onChange={e => setAdd(a => ({ ...a, login: e.target.value }))} /></label>
                                <label style={S.label}>{t.display_name}<input style={S.field} value={add.display_name} placeholder={add.login} onChange={e => setAdd(a => ({ ...a, display_name: e.target.value }))} /></label>
                                <label style={S.label}>{t.password}<input style={S.field} required minLength={6} type="password" autoComplete="new-password" value={add.password} onChange={e => setAdd(a => ({ ...a, password: e.target.value }))} /></label>
                            </>
                        )}
                        <label style={S.label}>{t.role_org}
                            <select style={S.field} value={add.role} onChange={e => setAdd(a => ({ ...a, role: e.target.value }))}>
                                {ORG_ROLES.map(r => <option key={r} value={r}>{t[r]}</option>)}
                            </select>
                        </label>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="submit" style={S.primary} disabled={busy}>{t.add}</button>
                        <button type="button" style={S.btn} onClick={() => setAdd(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}
        </div>
    );
}
