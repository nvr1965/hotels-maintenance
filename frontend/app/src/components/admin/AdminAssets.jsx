import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, S, Message } from './adminUi';

// Админка → Объекты (hotel_assets): по корпусам и этажам. Номер — ключ из цифр,
// другой объект — ключ из справочника «Названия объектов». Номера можно добавить диапазоном.

const API = '/backend/api/admin_assets.php';
const isDigits = (s) => /^[0-9]+$/.test(String(s || ''));

export default function AdminAssets({ lang }) {
    const t = tr(lang);
    const [data, setData] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState(null);      // { id, building, floor, kind, asset_key }
    const [gen, setGen] = useState(null);        // { building, floor, from, to }
    const [bFilter, setBFilter] = useState('');
    const [q, setQ] = useState('');

    const load = useCallback(async () => {
        const d = await api(`${API}?action=list&lang=${lang}`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const items = data?.items || [];
    const terms = data?.terms || [];
    const buildings = [...new Set(items.map(i => i.building))];

    const call = async (action, body, okText) => {
        setBusy(true);
        setMsg(null);
        let d = await api(`${API}?action=${action}`, body);
        if (!d.success && d.message === 'in_use' && window.confirm(t.in_use(d.usage))) {
            d = await api(`${API}?action=${action}`, { ...body, force: 1 });
        }
        setBusy(false);
        if (d.success) {
            setMsg({ ok: true, text: typeof okText === 'function' ? okText(d) : okText });
            await load();
            return true;
        }
        if (d.message !== 'in_use') setMsg({ ok: false, text: errText(t, d) });
        return false;
    };

    const openForm = (it) => {
        setGen(null);
        setMsg(null);
        setForm(it
            ? { id: it.id, building: it.building, floor: it.floor, kind: it.is_room ? 'room' : 'object', asset_key: it.asset_key }
            : { id: 0, building: bFilter || buildings[0] || '', floor: '', kind: 'object', asset_key: '' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const save = async (e) => {
        e.preventDefault();
        if (await call('save', form, t.saved)) setForm(null);
    };
    const generate = async (e) => {
        e.preventDefault();
        if (await call('generate', gen, (d) => t.gen_done(d.added, d.skipped))) setGen(null);
    };
    const remove = (it) => {
        if (window.confirm(`${it.name} (${t.building} ${it.building}, ${t.floor} ${it.floor}): ${t.confirm_delete}`)) {
            call('delete', { id: it.id }, t.deleted).then(ok => ok && setForm(null));
        }
    };

    // Группировка: корпус → этаж → объекты
    const ql = q.trim().toLowerCase();
    const shown = items.filter(i => (bFilter === '' || i.building === bFilter)
        && (!ql || i.name.toLowerCase().includes(ql) || i.asset_key.toLowerCase().includes(ql)));
    const tree = [];
    for (const it of shown) {
        let b = tree.find(x => x.name === it.building);
        if (!b) tree.push(b = { name: it.building, floors: [] });
        let f = b.floors.find(x => x.name === it.floor);
        if (!f) b.floors.push(f = { name: it.floor, items: [] });
        f.items.push(it);
    }

    const keyInvalid = form && (form.kind === 'room' ? !isDigits(form.asset_key) : !form.asset_key);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" style={S.primary} onClick={() => openForm(null)} disabled={!data}>{t.new_asset}</button>
                <button type="button" style={S.btn} disabled={!data} onClick={() => { setForm(null); setMsg(null); setGen({ building: bFilter || buildings[0] || '', floor: '', from: '', to: '' }); }}>{t.gen_rooms}</button>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <select style={{ ...S.field, width: 'auto' }} value={bFilter} onChange={e => setBFilter(e.target.value)}>
                    <option value="">{t.building}: {t.all}</option>
                    {buildings.map(b => <option key={b} value={b}>{t.building} {b || t.no_building}</option>)}
                </select>
                <input style={{ ...S.field, flex: '1 1 200px', width: 'auto' }} placeholder={t.search} value={q} onChange={e => setQ(e.target.value)} />
            </div>

            <Message msg={msg} />

            <datalist id="admin-buildings">{buildings.filter(Boolean).map(b => <option key={b} value={b} />)}</datalist>

            {form && (
                <form onSubmit={save} style={{ ...S.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', alignItems: 'end' }}>
                    <label style={S.label}>{t.building}
                        <input style={S.field} list="admin-buildings" value={form.building} onChange={e => setForm({ ...form, building: e.target.value })} />
                    </label>
                    <label style={S.label}>{t.floor}
                        <input style={S.field} value={form.floor} onChange={e => setForm({ ...form, floor: e.target.value })} />
                    </label>
                    <label style={S.label}>{t.asset_kind}
                        <select style={S.field} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value, asset_key: '' })}>
                            <option value="object">{t.kind_object}</option>
                            <option value="room">{t.kind_room}</option>
                        </select>
                    </label>
                    {form.kind === 'room' ? (
                        <label style={S.label}>{t.room_number}
                            <input style={S.field} inputMode="numeric" value={form.asset_key} onChange={e => setForm({ ...form, asset_key: e.target.value.replace(/\D/g, '') })} />
                        </label>
                    ) : (
                        <label style={S.label}>{t.object_name}
                            <select style={S.field} value={form.asset_key} onChange={e => setForm({ ...form, asset_key: e.target.value })}>
                                <option value="">…</option>
                                {terms.map(x => <option key={x.key} value={x.key}>{x.name}</option>)}
                                {form.asset_key && !terms.some(x => x.key === form.asset_key) && <option value={form.asset_key}>{form.asset_key}</option>}
                            </select>
                        </label>
                    )}
                    {form.kind === 'object' && <div style={{ ...S.hint, gridColumn: '1 / -1' }}>{t.need_term}</div>}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
                        <button type="submit" style={S.primary} disabled={busy || keyInvalid}>{t.save}</button>
                        <button type="button" style={S.btn} onClick={() => setForm(null)}>{t.cancel}</button>
                        {form.id > 0 && <button type="button" style={{ ...S.danger, marginInlineStart: 'auto' }} disabled={busy}
                            onClick={() => remove(items.find(i => i.id === form.id))}>🗑 {t.delete}</button>}
                    </div>
                </form>
            )}

            {gen && (
                <form onSubmit={generate} style={{ ...S.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', alignItems: 'end' }}>
                    <label style={S.label}>{t.building}
                        <input style={S.field} list="admin-buildings" value={gen.building} onChange={e => setGen({ ...gen, building: e.target.value })} />
                    </label>
                    <label style={S.label}>{t.floor}
                        <input style={S.field} value={gen.floor} onChange={e => setGen({ ...gen, floor: e.target.value })} />
                    </label>
                    <label style={S.label}>{t.from}
                        <input style={S.field} inputMode="numeric" required value={gen.from} onChange={e => setGen({ ...gen, from: e.target.value.replace(/\D/g, '') })} />
                    </label>
                    <label style={S.label}>{t.to}
                        <input style={S.field} inputMode="numeric" required value={gen.to} onChange={e => setGen({ ...gen, to: e.target.value.replace(/\D/g, '') })} />
                    </label>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
                        <button type="submit" style={S.primary} disabled={busy}>{t.generate}</button>
                        <button type="button" style={S.btn} onClick={() => setGen(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}

            {!data ? <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div> : tree.map(b => (
                <div key={b.name} style={{ border: '1px solid #ebe3dc', borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ background: 'var(--brand-primary, #371f20)', color: 'var(--brand-text, #f9edd3)', padding: '10px 14px', fontWeight: 'bold', fontSize: '17px' }}>
                        🏢 {t.building} <bdi>{b.name || t.no_building}</bdi>
                        <span style={{ fontWeight: 'normal', fontSize: '14px', color: '#e3d5bd', marginInlineStart: '10px' }}>
                            ({b.floors.reduce((n, f) => n + f.items.length, 0)})
                        </span>
                    </div>
                    {b.floors.map(f => (
                        <div key={f.name} style={{ padding: '10px 14px', borderTop: '1px solid #f3ebe2', display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: '90px', fontWeight: 'bold', color: '#5a4f48' }}>{t.floor} <bdi>{f.name || t.no_floor}</bdi></div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
                                {f.items.map(it => (
                                    <button key={it.id} type="button" onClick={() => openForm(it)} title={`#${it.id} · ${it.asset_key}${it.usage ? ` · ${it.usage} ${t.tasks_count}` : ''}`}
                                        style={{ padding: '5px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '15px', fontWeight: 600,
                                            border: `1px solid ${it.is_room ? '#d9cec5' : 'var(--brand-accent, #cdaa7c)'}`, background: form?.id === it.id ? 'var(--brand-button, #844128)' : (it.is_room ? '#fff' : 'var(--brand-text, #f9edd3)'),
                                            color: form?.id === it.id ? '#fff' : '#3f3530' }}>
                                        {it.is_room ? it.asset_key : it.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
