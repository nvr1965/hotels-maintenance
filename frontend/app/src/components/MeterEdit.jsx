import { useState, useEffect, useCallback } from 'react';
import { fmtNum } from './MeterChart';
import { Ic, PlusBtn } from './admin/adminUi';
import { meterText } from './admin/meterText';
import { PhotoViewer } from './work/WorkTiles';

// Правка показаний счётчиков задним числом (только для сисадмина):
// исправить цифру или дату, удалить ошибочное показание, добавить пропущенное.
// Каждая правка дописывается в заметку записи («было … стало …»), так что видно, что меняли.

const API = '/backend/api/meter_upload.php';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—';
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };


export default function MeterEdit({ lang = 'en' }) {
    const m_ = meterText(lang);
    const [viewer, setViewer] = useState(null);
    const [adding, setAdding] = useState(false);
    const [from, setFrom] = useState(daysAgo(30));
    const [to, setTo] = useState(iso(new Date()));
    const [meterFilter, setMeterFilter] = useState('all');
    const [data, setData] = useState(null);
    const [message, setMessage] = useState(null);
    const [edit, setEdit] = useState(null);           // { id, value, date, time }
    const [busy, setBusy] = useState(false);
    const [add, setAdd] = useState({ task_id: '', date: iso(new Date()), time: '12:00', value: '' });

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${API}?action=list&from=${from}&to=${to}`);
            const d = await res.json();
            if (d.success) {
                setData(d);
                setAdd(a => a.task_id ? a : { ...a, task_id: String(d.meters[0]?.id ?? '') });
            } else setMessage({ ok: false, text: d.message || m_.no_access });
        } catch {
            setMessage({ ok: false, text: m_.no_net });
        }
    }, [from, to]);
    useEffect(() => { load(); }, [load]);

    const post = async (body, okText) => {
        setBusy(true);
        setMessage(null);
        try {
            const res = await fetch(`${API}?action=${body.action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const d = await res.json();
            if (d.success) {
                setMessage({ ok: true, text: okText });
                setEdit(null);
                await load();
                return true;
            }
            setMessage({ ok: false, text: d.message || (d.errors || []).join('; ') || m_.failed });
        } catch {
            setMessage({ ok: false, text: m_.no_net });
        } finally {
            setBusy(false);
        }
        return false;
    };

    const meters = data?.meters || [];
    const meterById = Object.fromEntries(meters.map(m => [m.id, m]));
    const withValue = (data?.rows || []).filter(r => r.value !== null && r.value !== '');

    // Подсветка подозрительных: накопительный счётчик меньше предыдущего показания
    const suspicious = new Set();
    for (const m of meters) {
        if (m.kind !== 'counter') continue;
        let prev = null;
        for (const r of withValue.filter(x => x.task_id === m.id).sort((a, b) => a.at.localeCompare(b.at))) {
            const v = Number(String(r.value).replace(',', '.'));
            if (prev !== null && v < prev) suspicious.add(r.id); else prev = v;
        }
    }
    const rows = withValue.filter(r => meterFilter === 'all' || String(r.task_id) === meterFilter);

    const saveEdit = (r) => {
        const changes = [];
        if (String(edit.value).trim() !== String(r.value)) changes.push(m_.ch_value(r.value, edit.value));
        if (edit.date !== r.date) changes.push(m_.ch_date(fmtDate(r.date), fmtDate(edit.date)));
        if (edit.time !== r.time) changes.push(m_.ch_time(r.time, edit.time));
        if (!changes.length) { setEdit(null); return; }
        post({ action: 'edit', id: r.id, value: edit.value, date: edit.date, time: edit.time }, m_.fixed(meterById[r.task_id]?.name, changes.join(', ')));
    };
    const remove = (r) => {
        if (!window.confirm(m_.del_q(r.value, meterById[r.task_id]?.name, `${fmtDate(r.date)} ${r.time}`))) return;
        post({ action: 'clear', id: r.id }, m_.deleted(meterById[r.task_id]?.name, fmtDate(r.date)));
    };
    const addReading = async () => {
        const m = meterById[Number(add.task_id)];
        const same = withValue.find(r => r.task_id === Number(add.task_id) && r.date === add.date && r.time === add.time);
        if (same && !window.confirm(m_.same_q(`${fmtDate(add.date)} ${add.time}`, same.value))) return;
        const ok = await post({ action: 'save', rows: [{ task_id: Number(add.task_id), date: add.date, time: add.time, value: add.value, gemini: null }] },
            m_.added(m?.name, `${fmtDate(add.date)} ${add.time}`, add.value));
        if (ok) setAdd(a => ({ ...a, value: '' }));
    };

    const toggle = (r) => setEdit(e => (e?.id === r.id ? null : { id: r.id, value: String(r.value), date: r.date, time: r.time }));

    return (
        <div className="ad-list">
            <div className="ad-info">{m_.ed_intro}</div>

            {/* Добавить пропущенное показание */}
            <div className="ad-top">
                <PlusBtn on={adding} onClick={() => setAdding(a => !a)}>{m_.add_reading}</PlusBtn>
            </div>
            {adding && (
                <form className="ad-card form" onSubmit={e => { e.preventDefault(); if (!busy && add.value.trim() && add.task_id) addReading(); }}>
                    <div className="ad-lab">{m_.meter}
                        <div className="ad-chips">
                            {meters.map(m => (
                                <button key={m.id} type="button" className={'ad-chp sm' + (String(add.task_id) === String(m.id) ? ' on' : '')}
                                    onClick={() => setAdd({ ...add, task_id: String(m.id) })}>{m.name}{m.unit ? `, ${m.unit}` : ''}</button>
                            ))}
                        </div>
                    </div>
                    <div className="ad-row2">
                        <label className="ad-lab">{m_.date}<input className="ad-fld" type="date" value={add.date} max={iso(new Date())} onChange={e => setAdd({ ...add, date: e.target.value })} /></label>
                        <label className="ad-lab">{m_.time}<input className="ad-fld" type="time" value={add.time} onChange={e => setAdd({ ...add, time: e.target.value })} /></label>
                    </div>
                    <label className="ad-lab">{m_.value}
                        <input className="ad-fld big" inputMode="decimal" dir="ltr" value={add.value} onChange={e => setAdd({ ...add, value: e.target.value })} />
                    </label>
                    <button type="submit" className="wk-done lg" disabled={busy || !add.value.trim() || !add.task_id}><Ic n="plus" />{m_.add}</button>
                </form>
            )}

            {/* Фильтр */}
            <div className="ad-card">
                <div className="ad-row2">
                    <label className="ad-lab">{m_.from}<input className="ad-fld" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
                    <label className="ad-lab">{m_.to}<input className="ad-fld" type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
                </div>
                <div className="ad-chips sx" role="group" aria-label={m_.meter}>
                    <button type="button" className={'ad-chp sm' + (meterFilter === 'all' ? ' on' : '')} onClick={() => setMeterFilter('all')}>{m_.all}</button>
                    {meters.map(m => (
                        <button key={m.id} type="button" className={'ad-chp sm' + (meterFilter === String(m.id) ? ' on' : '')} onClick={() => setMeterFilter(String(m.id))}>{m.name}</button>
                    ))}
                </div>
            </div>

            {message && (
                <div role="status" className={'ad-msg ' + (message.ok ? 'ok' : 'err')}><Ic n={message.ok ? 'check' : 'warn'} /><span>{message.text}</span></div>
            )}
            {suspicious.size > 0 && <div className="ad-hint red">{m_.red}</div>}

            {!data ? <div className="ad-empty">{m_.loading}</div> : rows.length === 0 ? (
                <div className="ad-empty">{m_.none_period}</div>
            ) : (
                <div className="ad-grid">
                    {rows.map(r => {
                        const m = meterById[r.task_id];
                        const isEdit = edit?.id === r.id;
                        const bad = suspicious.has(r.id);
                        const shown = fmtNum(Number(String(r.value).replace(',', '.')), 3);
                        return (
                            <div key={r.id} className={'wk-tile' + (bad ? ' u' : '') + (isEdit ? ' open' : '')}>
                                <div className="wk-row" style={{ alignItems: 'center' }} role="button" tabIndex={0} aria-expanded={isEdit}
                                    onClick={e => { if (!e.target.closest('.ad-ph')) toggle(r); }}
                                    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggle(r); } }}>
                                    <div className="txt">
                                        <div className="wk-place" style={{ fontVariantNumeric: 'tabular-nums', color: bad ? '#c43d3d' : undefined }}>
                                            <bdi>{shown}{m?.unit ? ` ${m.unit}` : ''}</bdi>
                                        </div>
                                        <div className="wk-sub">
                                            {m?.name} · <bdi>{fmtDate(r.date)} {r.time}</bdi>
                                            {r.notes && /правка/.test(r.notes) && <span title={r.notes} style={{ color: 'var(--accent)' }}> · <Ic n="edit" /> {m_.edited}</span>}
                                        </div>
                                    </div>
                                    {r.photo
                                        ? <button type="button" className="ad-ph sm" aria-label={m_.photo}
                                            onClick={() => setViewer({ items: [r.photo], caption: `${m?.name || ''} · ${fmtDate(r.date)} ${r.time} · ${shown}` })}><img src={r.photo} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /></button>
                                        : <span className="ad-hint" style={{ fontSize: '12px' }}>{m_.no_photo}</span>}
                                </div>
                                {isEdit && (
                                    <div className="wk-more">
                                        <label className="ad-lab">{m_.value}{m?.unit ? `, ${m.unit}` : ''}
                                            <input className="ad-fld big" inputMode="decimal" dir="ltr" value={edit.value} autoFocus onChange={e => setEdit({ ...edit, value: e.target.value })}
                                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(r); if (e.key === 'Escape') setEdit(null); }} />
                                        </label>
                                        <div className="ad-row2">
                                            <label className="ad-lab">{m_.date}<input className="ad-fld" type="date" value={edit.date} max={iso(new Date())} onChange={e => setEdit({ ...edit, date: e.target.value })} /></label>
                                            <label className="ad-lab">{m_.time}<input className="ad-fld" type="time" value={edit.time} onChange={e => setEdit({ ...edit, time: e.target.value })} /></label>
                                        </div>
                                        <div className="ad-btnrow">
                                            <button type="button" className="ad-btn green" disabled={busy} onClick={() => saveEdit(r)}><Ic n="save" />{m_.save}</button>
                                            <button type="button" className="ad-btn" onClick={() => setEdit(null)}>{m_.cancel}</button>
                                            <button type="button" className="ad-btn danger ad-push" disabled={busy} onClick={() => remove(r)}><Ic n="trash" />{m_.del}</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {viewer && <PhotoViewer items={viewer.items} index={0} caption={viewer.caption} t={{ close: m_.close }} onClose={() => setViewer(null)} />}
        </div>
    );
}
