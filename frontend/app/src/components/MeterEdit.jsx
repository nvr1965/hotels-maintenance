import { useState, useEffect, useCallback } from 'react';
import { fmtNum } from './MeterChart';

// Правка показаний счётчиков задним числом (только для сисадмина):
// исправить цифру или дату, удалить ошибочное показание, добавить пропущенное.
// Каждая правка дописывается в заметку записи («было … стало …»), так что видно, что меняли.

const API = '/backend/api/meter_upload.php';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—';
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

const field = { padding: '8px 10px', border: '1px solid #d9cec5', fontSize: '16px', background: '#fff', minWidth: 0, boxSizing: 'border-box' };
const btn = { minHeight: '38px', padding: '6px 12px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' };

export default function MeterEdit() {
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
            } else setMessage({ ok: false, text: d.message || 'Нет доступа' });
        } catch {
            setMessage({ ok: false, text: 'Нет связи с сервером' });
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
            setMessage({ ok: false, text: d.message || (d.errors || []).join('; ') || 'Не получилось' });
        } catch {
            setMessage({ ok: false, text: 'Нет связи с сервером' });
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
        if (String(edit.value).trim() !== String(r.value)) changes.push(`показание ${r.value} → ${edit.value}`);
        if (edit.date !== r.date) changes.push(`дата ${fmtDate(r.date)} → ${fmtDate(edit.date)}`);
        if (edit.time !== r.time) changes.push(`время ${r.time} → ${edit.time}`);
        if (!changes.length) { setEdit(null); return; }
        post({ action: 'edit', id: r.id, value: edit.value, date: edit.date, time: edit.time }, `Исправлено: ${meterById[r.task_id]?.name}, ${changes.join(', ')}`);
    };
    const remove = (r) => {
        if (!window.confirm(`Удалить показание ${r.value} (${meterById[r.task_id]?.name}, ${fmtDate(r.date)} ${r.time})?`)) return;
        post({ action: 'clear', id: r.id }, `Удалено: ${meterById[r.task_id]?.name}, ${fmtDate(r.date)}`);
    };
    const addReading = async () => {
        const m = meterById[Number(add.task_id)];
        const same = withValue.find(r => r.task_id === Number(add.task_id) && r.date === add.date && r.time === add.time);
        if (same && !window.confirm(`На ${fmtDate(add.date)} ${add.time} уже есть ${same.value}. Добавить ещё одно показание на то же время?`)) return;
        const ok = await post({ action: 'save', rows: [{ task_id: Number(add.task_id), date: add.date, time: add.time, value: add.value, gemini: null }] },
            `Добавлено: ${m?.name}, ${fmtDate(add.date)} ${add.time} = ${add.value}`);
        if (ok) setAdd(a => ({ ...a, value: '' }));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <div style={{ background: '#f8efe6', borderRadius: '12px', padding: '12px 14px', fontSize: '16px', color: '#3f3530' }}>
                Здесь можно исправить показание, дату и время, удалить ошибочное и добавить пропущенное. За день может быть несколько показаний. Отчёт и Excel сразу считаются заново.
                Каждая правка записывается в заметку («было … стало …»).
            </div>

            {/* Добавить пропущенное показание */}
            <div style={{ border: '1px solid #ebe3dc', borderRadius: '14px', padding: '12px 14px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '17px', color: 'var(--brand-primary, #371f20)', marginBottom: '8px' }}>＋ Добавить показание</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <select value={add.task_id} onChange={e => setAdd({ ...add, task_id: e.target.value })} style={{ ...field, flex: '2 1 200px' }}>
                        {meters.map(m => <option key={m.id} value={m.id}>{m.name}{m.unit ? `, ${m.unit}` : ''}</option>)}
                    </select>
                    <input type="date" value={add.date} max={iso(new Date())} onChange={e => setAdd({ ...add, date: e.target.value })} style={{ ...field, flex: '1 1 150px' }} />
                    <input type="time" value={add.time} onChange={e => setAdd({ ...add, time: e.target.value })} style={{ ...field, flex: '0 1 140px' }} />
                    <input inputMode="decimal" placeholder="Показание" value={add.value} onChange={e => setAdd({ ...add, value: e.target.value })} style={{ ...field, flex: '1 1 130px', fontWeight: 'bold' }} />
                    <button type="button" disabled={busy || !add.value.trim() || !add.task_id} onClick={addReading}
                        style={{ ...btn, background: add.value.trim() ? 'var(--brand-button, #844128)' : '#d9cec5', color: '#fff', border: 'none' }}>Добавить</button>
                </div>
            </div>

            {/* Фильтр */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '15px', color: '#6e635b', flex: '1 1 150px' }}>
                    С <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} style={field} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '15px', color: '#6e635b', flex: '1 1 150px' }}>
                    По <input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} style={field} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '15px', color: '#6e635b', flex: '2 1 200px' }}>
                    Счётчик
                    <select value={meterFilter} onChange={e => setMeterFilter(e.target.value)} style={field}>
                        <option value="all">Все</option>
                        {meters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                </label>
            </div>

            {message && (
                <div style={{ padding: '10px 14px', borderRadius: '10px', fontWeight: 'bold', background: message.ok ? '#e6f4ec' : '#fbe9e9', color: message.ok ? '#1d6b45' : '#b13434' }}>
                    {message.text}
                </div>
            )}
            {suspicious.size > 0 && (
                <div style={{ color: '#b13434', fontSize: '15px' }}>Красным — показание меньше предыдущего (скорее всего, ошибка распознавания).</div>
            )}

            {!data ? <div style={{ color: '#6e635b' }}>Загрузка…</div> : rows.length === 0 ? (
                <div style={{ color: '#6e635b', padding: '20px', textAlign: 'center' }}>За этот период показаний нет</div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '16px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid #ebe3dc', color: '#6e635b', textAlign: 'start' }}>
                                <th style={{ padding: '8px', textAlign: 'start' }}>Дата</th>
                                <th style={{ padding: '8px', textAlign: 'start' }}>Время</th>
                                <th style={{ padding: '8px', textAlign: 'start' }}>Счётчик</th>
                                <th style={{ padding: '8px', textAlign: 'end' }}>Показание</th>
                                <th style={{ padding: '8px' }}>Фото</th>
                                <th style={{ padding: '8px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => {
                                const m = meterById[r.task_id];
                                const isEdit = edit?.id === r.id;
                                const bad = suspicious.has(r.id);
                                return (
                                    <tr key={r.id} style={{ borderBottom: '1px solid #f3ebe2', background: isEdit ? '#fffaf3' : bad ? '#fdf0f0' : 'transparent', verticalAlign: 'middle' }}>
                                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                                            {isEdit
                                                ? <input type="date" value={edit.date} max={iso(new Date())} onChange={e => setEdit({ ...edit, date: e.target.value })} style={{ ...field, width: '160px' }} />
                                                : fmtDate(r.date)}
                                        </td>
                                        <td style={{ padding: '8px', whiteSpace: 'nowrap', color: '#6e635b' }}>
                                            {isEdit
                                                ? <input type="time" value={edit.time} onChange={e => setEdit({ ...edit, time: e.target.value })} style={{ ...field, width: '120px' }} />
                                                : r.time}
                                        </td>
                                        <td style={{ padding: '8px' }}>
                                            {m?.name}
                                            {r.notes && /правка/.test(r.notes) && <div style={{ fontSize: '13px', color: '#7d726a' }} title={r.notes}>✏️ правили</div>}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'end', whiteSpace: 'nowrap' }}>
                                            {isEdit
                                                ? <input inputMode="decimal" value={edit.value} autoFocus onChange={e => setEdit({ ...edit, value: e.target.value })}
                                                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(r); if (e.key === 'Escape') setEdit(null); }}
                                                    style={{ ...field, width: '130px', fontWeight: 'bold', textAlign: 'end' }} />
                                                : <b style={{ color: bad ? '#c43d3d' : '#2b2320' }}>{fmtNum(Number(String(r.value).replace(',', '.')), 3)}</b>}
                                            {!isEdit && m?.unit && <span style={{ color: '#7d726a' }}> {m.unit}</span>}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'center' }}>
                                            {r.photo ? <a href={r.photo} target="_blank" rel="noreferrer" style={{ color: 'var(--brand-button, #844128)', fontWeight: 'bold' }}>📷</a> : <span style={{ color: '#cfc4ba' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '8px', whiteSpace: 'nowrap', textAlign: 'end' }}>
                                            {isEdit ? (
                                                <span style={{ display: 'inline-flex', gap: '6px' }}>
                                                    <button type="button" disabled={busy} onClick={() => saveEdit(r)} style={{ ...btn, background: '#26875a', color: '#fff', border: 'none' }}>Сохранить</button>
                                                    <button type="button" onClick={() => setEdit(null)} style={{ ...btn, background: '#fff', color: '#3f3530', border: '1px solid #d9cec5' }}>Отмена</button>
                                                </span>
                                            ) : (
                                                <span style={{ display: 'inline-flex', gap: '6px' }}>
                                                    <button type="button" onClick={() => setEdit({ id: r.id, value: String(r.value), date: r.date, time: r.time })} style={{ ...btn, background: '#fff', color: 'var(--brand-button, #844128)', border: '1px solid var(--brand-accent, #cdaa7c)' }}>Изменить</button>
                                                    <button type="button" disabled={busy} onClick={() => remove(r)} style={{ ...btn, background: '#fff', color: '#c43d3d', border: '1px solid #e7b9b9' }}>Удалить</button>
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
