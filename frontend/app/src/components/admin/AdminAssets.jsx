import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, Message, Ic, Search, PlusBtn, isWide } from './adminUi';

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
    const [open, setOpen] = useState(() => new Set());
    const wide = isWide();

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
    const openGen = () => {
        setForm(null); setMsg(null);
        setGen(gen ? null : { building: bFilter || buildings[0] || '', floor: '', from: '', to: '' });
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

    // Группировка: корпус + этаж → плитка с объектами
    const ql = q.trim().toLowerCase();
    const shown = items.filter(i => (bFilter === '' || i.building === bFilter)
        && (!ql || i.name.toLowerCase().includes(ql) || i.asset_key.toLowerCase().includes(ql)));
    const groups = [];
    for (const it of shown) {
        let g = groups.find(x => x.b === it.building && x.f === it.floor);
        if (!g) groups.push(g = { b: it.building, f: it.floor, items: [] });
        g.items.push(it);
    }

    const keyInvalid = form && (form.kind === 'room' ? !isDigits(form.asset_key) : !form.asset_key);
    const flip = (k) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const bName = (b) => b || t.no_building;

    // Корпус: плашки известных корпусов + поле для нового
    const buildingPick = (value, onPick) => (
        <div className="ad-lab">{t.building}
            <div className="ad-chips">
                {buildings.map(b => (
                    <button key={b} type="button" className={'ad-chp sm' + (value === b ? ' on' : '')} onClick={() => onPick(b)}>{bName(b)}</button>
                ))}
                <input className="ad-fld" style={{ width: '9em', flex: '0 1 9em' }} list="admin-buildings" placeholder={t.new_building} aria-label={t.building}
                    value={buildings.includes(value) ? '' : value} onChange={e => onPick(e.target.value)} />
            </div>
        </div>
    );

    return (
        <>
            <div className="ad-pad">
                <div className="ad-chips sx" role="group" aria-label={t.building}>
                    <button type="button" className={'ad-chp sm' + (bFilter === '' ? ' on' : '')} onClick={() => setBFilter('')}>{t.all}</button>
                    {buildings.map(b => (
                        <button key={b} type="button" className={'ad-chp sm' + (bFilter === b ? ' on' : '')} onClick={() => setBFilter(b)}>
                            <Ic n="building" />{t.building} {bName(b)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="ad-list">
                <div className="ad-top">
                    <PlusBtn on={form && !form.id} disabled={!data} onClick={() => (form && !form.id ? setForm(null) : openForm(null))}>{t.new_asset}</PlusBtn>
                    <PlusBtn on={!!gen} disabled={!data} onClick={openGen}>{t.gen_rooms}</PlusBtn>
                    <Search value={q} onChange={setQ} placeholder={t.search} />
                </div>

                <Message msg={msg} />

                <datalist id="admin-buildings">{buildings.filter(Boolean).map(b => <option key={b} value={b} />)}</datalist>

                {form && (
                    <form onSubmit={save} className="ad-card form">
                        {form.id > 0 && <h3><Ic n="edit" />{items.find(i => i.id === form.id)?.name || form.asset_key} <span className="ad-id">#{form.id}</span></h3>}
                        {buildingPick(form.building, b => setForm(f => ({ ...f, building: b })))}
                        <div className="ad-form-grid">
                            <label className="ad-lab">{t.floor}
                                <input className="ad-fld" value={form.floor} onChange={e => setForm({ ...form, floor: e.target.value })} />
                            </label>
                            <div className="ad-lab">{t.asset_kind}
                                <div className="ad-chips">
                                    {[['object', t.kind_object], ['room', t.kind_room]].map(([k, l]) => (
                                        <button key={k} type="button" className={'ad-chp sm' + (form.kind === k ? ' on' : '')}
                                            onClick={() => setForm({ ...form, kind: k, asset_key: form.kind === k ? form.asset_key : '' })}>{l}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {form.kind === 'room' ? (
                            <label className="ad-lab">{t.room_number}
                                <input className="ad-fld big" inputMode="numeric" value={form.asset_key} onChange={e => setForm({ ...form, asset_key: e.target.value.replace(/\D/g, '') })} />
                            </label>
                        ) : (
                            <>
                                <div className="ad-lab">{t.object_name}
                                    <div className="ad-chips">
                                        {terms.map(x => (
                                            <button key={x.key} type="button" className={'ad-chp sm' + (form.asset_key === x.key ? ' on' : '')}
                                                onClick={() => setForm({ ...form, asset_key: x.key })}>{x.name}</button>
                                        ))}
                                        {form.asset_key && !terms.some(x => x.key === form.asset_key) && (
                                            <button type="button" className="ad-chp sm on">{form.asset_key}</button>
                                        )}
                                    </div>
                                </div>
                                <div className="ad-hint">{t.need_term}</div>
                            </>
                        )}
                        <button type="submit" className="wk-done lg" disabled={busy || keyInvalid}><Ic n="save" />{t.save}</button>
                        <div className="ad-btnrow" style={{ justifyContent: 'center' }}>
                            <button type="button" className="ad-btn" onClick={() => setForm(null)}>{t.cancel}</button>
                            {form.id > 0 && <button type="button" className="ad-btn danger" disabled={busy}
                                onClick={() => remove(items.find(i => i.id === form.id))}><Ic n="trash" />{t.delete}</button>}
                        </div>
                    </form>
                )}

                {gen && (
                    <form onSubmit={generate} className="ad-card form">
                        <h3><Ic n="hash" />{t.gen_rooms}</h3>
                        {buildingPick(gen.building, b => setGen(g => ({ ...g, building: b })))}
                        <div className="ad-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 110px), 1fr))' }}>
                            <label className="ad-lab">{t.floor}
                                <input className="ad-fld" value={gen.floor} onChange={e => setGen({ ...gen, floor: e.target.value })} />
                            </label>
                            <label className="ad-lab">{t.from}
                                <input className="ad-fld" inputMode="numeric" required value={gen.from} onChange={e => setGen({ ...gen, from: e.target.value.replace(/\D/g, '') })} />
                            </label>
                            <label className="ad-lab">{t.to}
                                <input className="ad-fld" inputMode="numeric" required value={gen.to} onChange={e => setGen({ ...gen, to: e.target.value.replace(/\D/g, '') })} />
                            </label>
                        </div>
                        <button type="submit" className="wk-done lg" disabled={busy}>{t.generate}</button>
                        <button type="button" className="ad-btn" style={{ alignSelf: 'center' }} onClick={() => setGen(null)}>{t.cancel}</button>
                    </form>
                )}

                {!data ? <div className="ad-empty">{t.loading}</div> : (
                    <div className="ad-grid wide">
                        {groups.length === 0 && <div className="ad-empty ad-full">{t.empty}</div>}
                        {groups.map(g => {
                            const k = g.b + '|' + g.f;
                            const isOpen = wide !== open.has(k);
                            const rooms = g.items.filter(i => i.is_room).length;
                            return (
                                <div key={k} className={'wk-tile' + (isOpen ? ' open' : '')}>
                                    <div className="wk-row" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => flip(k)}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(k); } }}>
                                        <div className="txt">
                                            <div className="wk-place md">{t.building} <bdi>{bName(g.b)}</bdi> · {t.floor} <bdi>{g.f || t.no_floor}</bdi></div>
                                            <div className="wk-sub">{t.rooms}: <b>{rooms}</b> · {t.objects}: <b>{g.items.length - rooms}</b></div>
                                        </div>
                                        <Ic n="chev" className="ad-chev" />
                                    </div>
                                    {isOpen && (
                                        <div className="wk-more">
                                            <div className="ad-chips">
                                                {g.items.map(it => (
                                                    <button key={it.id} type="button" className={'ad-chp sm' + (it.is_room ? '' : ' obj') + (form?.id === it.id ? ' sel' : '')}
                                                        onClick={() => openForm(it)} title={`#${it.id} · ${it.asset_key}${it.usage ? ` · ${it.usage} ${t.tasks_count}` : ''}`}>
                                                        {it.is_room ? it.asset_key : it.name}
                                                        {it.usage > 0 && <small>· {it.usage} {t.tasks_count}</small>}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="ad-hint">{t.asset_click}</div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
}
