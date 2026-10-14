import { useState, useEffect, useCallback, useRef } from 'react';
import { tr, api, errText, S, Message } from './adminUi';
import { uiText } from '../../i18n';

// Админка → Шаблоны (только владелец системы): структура отеля — корпуса, этажи, номера, общие объекты.
// При создании отеля («Сеть и отели») выбирается шаблон, и все объекты заводятся сразу;
// дальше отель правится сам по себе. Шаблон можно начать с готового отеля.

const API = '/backend/api/admin_templates.php';
const blankBuilding = (name = '') => ({ name, floor_from: 1, floor_to: 3, room_from: 1, room_to: 3, rooms_per_floor: 10 });
const blank = () => ({ id: 0, name: '', structure: { numbering: 'floor', buildings: [blankBuilding('A')], common: [] } });

export default function AdminTemplates({ lang }) {
    const t = { ...tr(lang), ...uiText('tpl', lang) };
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const d = await api(`${API}?action=list`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const failText = (d) => (d.building !== undefined && t['err_' + d.message] ? `${t['err_' + d.message]}: ${d.building || '—'}` : errText(t, d));

    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const d = await api(`${API}?action=save`, form);
        setBusy(false);
        if (!d.success) { setMsg({ ok: false, text: failText(d) }); return; }
        setMsg({ ok: true, text: t.saved });
        setForm(null);
        load();
    };

    const remove = async (x) => {
        if (!window.confirm(`${x.name}: ${t.confirm_delete}`)) return;
        const d = await api(`${API}?action=delete`, { id: x.id });
        if (d.success) { setMsg({ ok: true, text: t.deleted }); load(); } else setMsg({ ok: false, text: errText(t, d) });
    };

    const fromHotel = async (hotelId) => {
        if (!hotelId) return;
        const d = await api(`${API}?action=from_hotel&hotel_id=${hotelId}`);
        if (!d.success) { setMsg({ ok: false, text: errText(t, d) }); return; }
        setForm({ id: 0, name: d.name, structure: d.structure });
        setMsg(null);
    };

    if (!data) return <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <div style={S.hint}>{t.intro}</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" style={S.primary} onClick={() => { setForm(blank()); setMsg(null); }}>{t.add}</button>
                <select style={{ ...S.field, width: 'auto' }} value="" onChange={e => fromHotel(Number(e.target.value))}>
                    <option value="">{t.from_hotel}</option>
                    {data.hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
            </div>
            <Message msg={msg} />

            {form && <TemplateForm t={t} lang={lang} form={form} setForm={setForm} busy={busy} onSubmit={save} onCancel={() => setForm(null)} />}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.items.map(x => (
                    <div key={x.id} style={{ ...S.card, background: '#fff', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '28px' }}>📐</div>
                        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                            <b style={{ fontSize: '17px', color: '#2b2320' }}>{x.name}</b>
                            <div style={S.hint}>{t.summary(x.summary.buildings, x.summary.rooms, x.summary.common)}</div>
                            <div style={{ ...S.hint, fontSize: '13px' }}>
                                {x.structure.buildings.map(b => `${b.name || '—'}: ${t.floors_short(b.floor_from, b.floor_to)}`).join(' · ')}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button type="button" style={S.btn} onClick={() => { setForm({ id: x.id, name: x.name, structure: x.structure }); setMsg(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>✏️</button>
                            <button type="button" style={S.danger} onClick={() => remove(x)}>🗑</button>
                        </div>
                    </div>
                ))}
                {data.items.length === 0 && <div style={{ ...S.hint, textAlign: 'center', padding: '20px' }}>{t.empty}</div>}
            </div>
        </div>
    );
}

function TemplateForm({ t, lang, form, setForm, busy, onSubmit, onCancel }) {
    const st = form.structure;
    const setSt = (patch) => setForm(f => ({ ...f, structure: { ...f.structure, ...patch } }));
    const setB = (i, k, v) => setSt({ buildings: st.buildings.map((b, n) => (n === i ? { ...b, [k]: v } : b)) });
    const setC = (i, patch) => setSt({ common: st.common.map((c, n) => (n === i ? { ...c, ...patch } : c)) });
    const num = (v) => (v === '' || v === '-' ? v : Number(v));

    // Сводка «что получится» — с сервера, чтобы совпадала с тем, что он заведёт
    const [preview, setPreview] = useState(null);
    const timer = useRef(null);
    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            const d = await api(`${API}?action=preview`, { structure: st });
            setPreview(d);
        }, 400);
        return () => clearTimeout(timer.current);
    }, [st]);

    const cell = { ...S.field, width: '76px', padding: '7px 8px' };
    return (
        <form onSubmit={onSubmit} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <label style={S.label}>{t.name}
                <input style={S.field} required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t.name_ph} />
            </label>

            <div style={S.label}>{t.numbering}
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontWeight: 400 }}>
                    {['floor', 'sequential'].map(v => (
                        <label key={v} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <input type="radio" checked={st.numbering === v} onChange={() => setSt({ numbering: v })} /> {t['num_' + v]}
                        </label>
                    ))}
                </div>
            </div>

            <div style={S.label}>{t.buildings}
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', textAlign: 'start', fontWeight: 400 }}>
                        <thead>
                            <tr>
                                {[t.b_name, t.b_floors, t.b_room_floors, t.b_per_floor, ''].map((h, n) => <th key={n} style={{ ...S.th, textAlign: 'start', whiteSpace: 'normal' }}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {st.buildings.map((b, i) => (
                                <tr key={i}>
                                    <td style={S.td}><input style={{ ...cell, width: '130px' }} value={b.name} placeholder={t.b_name_ph} onChange={e => setB(i, 'name', e.target.value)} /></td>
                                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                                        <input style={cell} type="number" min={-10} max={200} value={b.floor_from} onChange={e => setB(i, 'floor_from', num(e.target.value))} aria-label={t.from} />
                                        {' – '}
                                        <input style={cell} type="number" min={-10} max={200} value={b.floor_to} onChange={e => setB(i, 'floor_to', num(e.target.value))} aria-label={t.to} />
                                    </td>
                                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                                        <input style={cell} type="number" value={b.room_from} onChange={e => setB(i, 'room_from', num(e.target.value))} aria-label={t.from} />
                                        {' – '}
                                        <input style={cell} type="number" value={b.room_to} onChange={e => setB(i, 'room_to', num(e.target.value))} aria-label={t.to} />
                                    </td>
                                    <td style={S.td}><input style={cell} type="number" min={0} max={500} value={b.rooms_per_floor} onChange={e => setB(i, 'rooms_per_floor', num(e.target.value))} /></td>
                                    <td style={S.td}>
                                        {st.buildings.length > 1 && <button type="button" style={S.danger} onClick={() => setSt({ buildings: st.buildings.filter((_, n) => n !== i) })}>🗑</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ fontWeight: 400 }}>
                    <button type="button" style={S.btn} onClick={() => setSt({ buildings: [...st.buildings, blankBuilding(String.fromCharCode(65 + st.buildings.length))] })}>{t.add_building}</button>
                </div>
                <div style={{ ...S.hint, fontWeight: 400 }}>{t.floors_hint}</div>
            </div>

            <div style={S.label}>{t.common}
                <div style={{ ...S.hint, fontWeight: 400 }}>{t.common_hint}</div>
                {st.common.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontWeight: 400 }}>
                        <input style={{ ...S.field, flex: '1 1 200px', width: 'auto' }} value={c.names[lang] ?? c.names.en ?? Object.values(c.names)[0] ?? ''}
                            placeholder={t.common_ph} onChange={e => setC(i, { names: { [lang]: e.target.value } })} />
                        <select style={{ ...S.field, width: 'auto' }} value={c.where} onChange={e => setC(i, { where: e.target.value })}>
                            <option value="all">{t.where_all}</option>
                            <option value="rooms">{t.where_rooms}</option>
                        </select>
                        <button type="button" style={S.danger} onClick={() => setSt({ common: st.common.filter((_, n) => n !== i) })}>🗑</button>
                    </div>
                ))}
                <div style={{ fontWeight: 400 }}>
                    <button type="button" style={S.btn} onClick={() => setSt({ common: [...st.common, { names: {}, where: 'all' }] })}>{t.add_common}</button>
                </div>
            </div>

            {preview && (
                <div role="status" style={{ ...S.card, background: preview.success ? '#eef6f0' : '#fdecea', color: preview.success ? '#1f6b3d' : '#a3301c', fontWeight: 600 }}>
                    {preview.success ? (
                        <>
                            {t.result(preview.summary.rooms, preview.summary.common)}
                            <div style={{ fontWeight: 400, fontSize: '14px', marginTop: '4px' }}>
                                {preview.summary.sample.filter(s => s.first.length).map(s => `${s.building || '—'}: ${s.first.join(', ')} … ${s.last}`).join(' · ')}
                            </div>
                        </>
                    ) : (t['err_' + preview.message] ? `${t['err_' + preview.message]}${preview.building !== undefined ? ': ' + (preview.building || '—') : ''}` : errText(t, preview))}
                </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="submit" style={S.primary} disabled={busy || !preview?.success}>{t.save}</button>
                <button type="button" style={S.btn} onClick={onCancel}>{t.cancel}</button>
            </div>
        </form>
    );
}
