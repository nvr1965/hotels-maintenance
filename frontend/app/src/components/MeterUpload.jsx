import { useState, useEffect, useCallback, useRef } from 'react';
import BossLinks from './BossLinks';
import { fmtNum } from './MeterChart';

// Временная страница для сисадмина: фото счётчиков с компьютера → распознавание → проверка → запись в базу.
// По одному фото на каждый счётчик (регламентные задачи с распознаванием).

const API = '/backend/api/meter_upload.php';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtDate = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—';
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };

// Дата съёмки из имени файла: «WhatsApp Image 2026-09-24 at 19.21.54», «IMG_20260924_192154», «2026-09-24_19-21-54»
function dateFromName(name) {
    const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ _T-]*(?:at )?(\d{2})[.:\-_]?(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, h, mi] = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return { date: `${y}-${mo}-${d}`, time: h && +h < 24 && +mi < 60 ? `${h}:${mi}` : null };
}

const emptySlot = { file: null, preview: null, status: 'idle', url: null, gemini: null, value: '', date: '', time: '', error: null, source: '' };

export default function MeterUpload() {
    const [meters, setMeters] = useState([]);
    const [slots, setSlots] = useState({});
    const [existing, setExisting] = useState({});      // { 'YYYY-MM-DD': { taskId: [{ time, value }] } }
    // Фото уходят в Gemini строго по одному (как на тестовой странице): три запроса разом упираются в лимит в минуту
    const queue = useRef(Promise.resolve());
    const enqueue = (fn) => { const p = queue.current.then(fn, fn); queue.current = p.catch(() => {}); return p; };
    const timers = useRef({});
    const [recent, setRecent] = useState(null);        // отчёт за последние 14 дней
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);      // { ok: bool, text }
    const [dragOver, setDragOver] = useState(null);

    const loadRecent = useCallback(async () => {
        const to = iso(new Date());
        try {
            const res = await fetch(`/backend/api/get_meter_report.php?from=${addDays(to, -13)}&to=${to}&lang=ru`);
            const data = await res.json();
            if (data.success) setRecent(data);
        } catch { /* без сети — просто не покажем таблицу */ }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API}?action=init`);
                const data = await res.json();
                if (data.success) {
                    setMeters(data.meters);
                    setSlots(Object.fromEntries(data.meters.map(m => [m.id, { ...emptySlot }])));
                } else setMessage({ ok: false, text: data.message || 'Нет доступа' });
            } catch {
                setMessage({ ok: false, text: 'Нет связи с сервером' });
            }
        })();
        loadRecent();
    }, [loadRecent]);

    const patch = (id, p) => setSlots(s => ({ ...s, [id]: { ...s[id], ...p } }));

    const loadExisting = async (date) => {
        if (!date || existing[date]) return;
        try {
            const res = await fetch(`${API}?action=day&date=${date}`);
            const data = await res.json();
            if (data.success) setExisting(e => ({ ...e, [date]: data.values || {} }));
        } catch { /* не критично */ }
    };

    const pickFile = async (meter, file) => {
        if (!file) return;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
            patch(meter.id, { ...emptySlot, status: 'error', error: 'Нужно фото JPG, PNG или WEBP' });
            return;
        }
        setMessage(null);
        const fromName = dateFromName(file.name);
        const mod = new Date(file.lastModified || Date.now());
        const guess = fromName || { date: iso(mod), time: hhmm(mod) };
        const old = slots[meter.id];
        if (old?.preview) URL.revokeObjectURL(old.preview);
        patch(meter.id, {
            ...emptySlot, file, preview: URL.createObjectURL(file), status: 'ocr',
            date: guess.date, time: guess.time || hhmm(mod), source: fromName ? 'из имени файла' : 'по дате файла',
        });
        loadExisting(guess.date);

        const fd = new FormData();
        fd.append('action', 'ocr');
        fd.append('task_id', meter.id);
        fd.append('file', file);
        patch(meter.id, { status: 'queued' });
        await enqueue(async () => {
            patch(meter.id, { status: 'ocr' });
            try {
                const res = await fetch(`${API}?action=ocr`, { method: 'POST', body: fd });
                const data = await res.json();
                if (!data.success) {
                    patch(meter.id, { status: 'error', error: data.message || 'Ошибка' });
                    return;
                }
                const upd = { url: data.url };
                if (data.taken) {
                    upd.date = data.taken.date;
                    upd.time = data.taken.time;
                    upd.source = 'из данных фото (EXIF)';
                    loadExisting(data.taken.date);
                }
                patch(meter.id, upd);
                applyOcr(meter, data, 0);
            } catch {
                patch(meter.id, { status: 'error', error: 'Нет связи с сервером' });
            }
        });
    };

    // Результат распознавания. Лимит Gemini в минуту — ждём, сколько сказал Google, и пробуем сами (до 3 раз)
    const applyOcr = (meter, data, attempt) => {
        if (data.value !== null && data.value !== undefined) {
            patch(meter.id, { status: 'done', gemini: data.value, value: data.value, error: null, waitLeft: null });
            return;
        }
        if (data.limit === 'minute' && attempt < 3) {
            let left = data.retry_after || 60;
            patch(meter.id, { status: 'wait', waitLeft: left, error: null });
            clearInterval(timers.current[meter.id]);
            timers.current[meter.id] = setInterval(() => {
                left -= 1;
                if (left > 0) { patch(meter.id, { waitLeft: left }); return; }
                clearInterval(timers.current[meter.id]);
                retryOcr(meter, data.url, attempt + 1);
            }, 1000);
            return;
        }
        patch(meter.id, { status: 'done', gemini: null, error: data.error || 'Не распознано', waitLeft: null });
    };

    // Повторное распознавание уже загруженного фото (Google был перегружен или кончился лимит)
    const retryOcr = async (meter, url, attempt = 0) => {
        if (!url) return;
        clearInterval(timers.current[meter.id]);
        patch(meter.id, { status: 'queued', waitLeft: null });
        await enqueue(async () => {
            patch(meter.id, { status: 'ocr' });
            try {
                const res = await fetch(`${API}?action=reocr`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reocr', task_id: meter.id, url }),
                });
                const data = await res.json();
                if (!data.success) { patch(meter.id, { status: 'done', gemini: null, error: data.message || 'Ошибка' }); return; }
                applyOcr(meter, { ...data, url }, attempt);
            } catch {
                patch(meter.id, { status: 'done', gemini: null, error: 'Нет связи с сервером' });
            }
        });
    };
    useEffect(() => () => Object.values(timers.current).forEach(clearInterval), []);

    const clearSlot = (id) => {
        clearInterval(timers.current[id]);
        if (slots[id]?.preview) URL.revokeObjectURL(slots[id].preview);
        patch(id, { ...emptySlot });
    };

    // Последнее показание ДО выбранной даты — для проверки «не меньше ли прошлого»
    const prevReading = (meterId, date, time = '23:59') => {
        const m = recent?.meters?.find(x => x.id === meterId);
        if (!m) return null;
        const at = `${date} ${time || '23:59'}`;
        const before = m.points.filter(p => (p.at || p.date) < at);
        return before.length ? before[before.length - 1] : null;
    };

    const ready = meters.filter(m => {
        const s = slots[m.id];
        return s && s.url && s.date && String(s.value).trim() !== '' && !Number.isNaN(Number(String(s.value).replace(',', '.')));
    });

    const save = async () => {
        if (!ready.length) return;
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save',
                    rows: ready.map(m => {
                        const s = slots[m.id];
                        return { task_id: m.id, date: s.date, time: s.time, value: String(s.value).replace(',', '.'), url: s.url, gemini: s.gemini };
                    }),
                }),
            });
            const data = await res.json();
            if (data.saved > 0) {
                const names = ready.map(m => m.name).join(', ');
                setMessage({ ok: true, text: `Записано в базу: ${data.saved} (${names})` + (data.errors?.length ? `. Не записано: ${data.errors.join('; ')}` : '') });
                ready.forEach(m => clearSlot(m.id));
                setExisting({});
                loadRecent();
            } else {
                setMessage({ ok: false, text: (data.errors || []).join('; ') || data.message || 'Ничего не записано' });
            }
        } catch {
            setMessage({ ok: false, text: 'Нет связи с сервером' });
        } finally {
            setSaving(false);
        }
    };

    const field = { padding: '9px 10px', borderRadius: '10px', border: '1px solid #d9cec5', fontSize: '17px', background: '#fff', width: '100%', boxSizing: 'border-box' };

    // Таблица последних показаний: строки — дни (новые сверху), колонки — счётчики
    const recentDays = recent ? Array.from({ length: 14 }, (_, i) => addDays(recent.to, -i)) : [];
    const recentVal = (m, d) => { const ps = m.points.filter(p => p.date === d); return ps.length ? { ...ps[ps.length - 1], more: ps.length - 1 } : null; };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'start' }}>
            <div style={{ background: '#f8efe6', borderRadius: '12px', padding: '12px 14px', fontSize: '16px', color: '#3f3530', lineHeight: 1.5 }}>
                Выберите или перетащите фото каждого счётчика. Фото распознаются по очереди, по одному. В базу ничего не пишется,
                пока вы не проверите цифры и не нажмёте «Записать в базу». Дата и время берутся из фото, их можно поправить. За день можно записать несколько показаний.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
                {meters.map(m => {
                    const s = slots[m.id] || emptySlot;
                    const inDb = s.date ? existing[s.date]?.[m.id] : undefined;
                    const prev = s.date ? prevReading(m.id, s.date, s.time) : null;
                    const num = Number(String(s.value).replace(',', '.'));
                    const lower = m.kind === 'counter' && prev && String(s.value).trim() !== '' && !Number.isNaN(num) && num < prev.value;
                    return (
                        <div key={m.id}
                            onDragOver={e => { e.preventDefault(); setDragOver(m.id); }}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={e => { e.preventDefault(); setDragOver(null); pickFile(m, e.dataTransfer.files?.[0]); }}
                            style={{ border: dragOver === m.id ? '2px dashed var(--brand-button, #844128)' : '1px solid #ebe3dc', borderRadius: '14px', padding: '14px', background: dragOver === m.id ? '#f8efe6' : '#fff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                                <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--brand-primary, #371f20)' }}>{m.name}</h3>
                                <span style={{ color: '#7d726a', fontSize: '15px' }}>{m.unit}</span>
                            </div>

                            {s.preview ? (
                                <a href={s.preview} target="_blank" rel="noreferrer">
                                    <img src={s.preview} alt="" style={{ width: '100%', height: '180px', objectFit: 'contain', background: '#f6f1ec', borderRadius: '10px' }} />
                                </a>
                            ) : (
                                <label style={{ height: '180px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', border: '2px dashed #d9cec5', borderRadius: '10px', cursor: 'pointer', color: '#6e635b', background: '#fcf9f6', textAlign: 'center', padding: '10px' }}>
                                    <span style={{ fontSize: '34px' }}>📷</span>
                                    <span style={{ fontWeight: 'bold', color: 'var(--brand-button, #844128)' }}>Выбрать фото</span>
                                    <span style={{ fontSize: '14px' }}>или перетащите сюда</span>
                                    <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => { pickFile(m, e.target.files?.[0]); e.target.value = ''; }} />
                                </label>
                            )}

                            {s.status === 'queued' && <div style={{ color: '#7a5a30', fontWeight: 'bold' }}>⏳ В очереди на распознавание…</div>}
                            {s.status === 'ocr' && <div style={{ color: '#7a5a30', fontWeight: 'bold' }}>⏳ Распознаю…</div>}
                            {s.status === 'wait' && <div style={{ color: '#7a5a30', fontWeight: 'bold' }}>⏳ Лимит Gemini в минуту. Повторю сам через {s.waitLeft} с…</div>}
                            {s.status === 'error' && <div style={{ color: '#c43d3d', fontWeight: 'bold' }}>{s.error}</div>}

                            {(s.status === 'done' || (s.status === 'error' && s.url)) && (
                                <>
                                    <div style={{ fontSize: '15px', color: s.gemini !== null ? '#26875a' : '#c43d3d' }}>
                                        {s.gemini !== null ? <>Распознано: <b>{fmtNum(Number(s.gemini), 3)}</b></> : <>Не распознано: {s.error}{/вручную/.test(s.error || '') ? '.' : '. Введите вручную.'}</>}
                                    </div>
                                    {s.gemini === null && s.url && (
                                        <button type="button" onClick={() => retryOcr(m, s.url)}
                                            style={{ alignSelf: 'flex-start', minHeight: '40px', padding: '8px 14px', borderRadius: '10px', border: '1px solid var(--brand-accent, #cdaa7c)', background: '#f8efe6', color: 'var(--brand-button, #844128)', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}>
                                            🔄 Распознать ещё раз
                                        </button>
                                    )}
                                    <label style={{ fontSize: '15px', color: '#6e635b' }}>
                                        Показание, {m.unit}
                                        <input inputMode="decimal" value={s.value} onChange={e => patch(m.id, { value: e.target.value })}
                                            style={{ ...field, fontSize: '22px', fontWeight: 'bold', marginTop: '4px', borderColor: lower ? '#d63c3c' : '#d9cec5' }} />
                                    </label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <label style={{ fontSize: '15px', color: '#6e635b', flex: 2 }}>
                                            Дата
                                            <input type="date" value={s.date} onChange={e => { patch(m.id, { date: e.target.value, source: 'вручную' }); loadExisting(e.target.value); }} style={{ ...field, marginTop: '4px' }} />
                                        </label>
                                        <label style={{ fontSize: '15px', color: '#6e635b', flex: 1 }}>
                                            Время
                                            <input type="time" value={s.time} onChange={e => patch(m.id, { time: e.target.value })} style={{ ...field, marginTop: '4px' }} />
                                        </label>
                                    </div>
                                    <div style={{ fontSize: '14px', color: '#7d726a' }}>Дата {s.source}</div>
                                    {prev && (
                                        <div style={{ fontSize: '15px', color: lower ? '#c43d3d' : '#6e635b', fontWeight: lower ? 'bold' : 'normal' }}>
                                            Прошлое показание: {fmtNum(prev.value, 3)} ({fmtDate(prev.date)}{prev.time ? ` ${prev.time}` : ''}){lower ? ' — новое меньше, проверьте цифры' : ''}
                                        </div>
                                    )}
                                    {inDb?.length > 0 && (
                                        <div style={{ fontSize: '15px', color: '#7a5a30' }}>
                                            В базе на {fmtDate(s.date)} уже есть: {inDb.map(x => `${fmtNum(x.value, 3)} (${x.time})`).join(', ')}.
                                            {inDb.some(x => x.time === s.time) ? <b style={{ color: '#b45309' }}> На {s.time} показание уже есть — оно будет заменено (то же фото).</b> : ' Это будет ещё одно показание за день.'}
                                        </div>
                                    )}
                                    <button type="button" onClick={() => clearSlot(m.id)}
                                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#7d726a', cursor: 'pointer', fontSize: '15px', padding: 0, textDecoration: 'underline' }}>
                                        Убрать фото
                                    </button>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {message && (
                <div style={{ padding: '12px 14px', borderRadius: '10px', fontWeight: 'bold', background: message.ok ? '#e3f3e9' : '#fee2e2', color: message.ok ? '#1f7a4f' : '#a83232' }}>
                    {message.ok ? '✓ ' : ''}{message.text}
                </div>
            )}

            <button type="button" onClick={save} disabled={!ready.length || saving}
                style={{ minHeight: '52px', padding: '12px 20px', background: ready.length ? 'var(--brand-button, #844128)' : '#d9cec5', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold', fontSize: '18px', cursor: ready.length ? 'pointer' : 'default' }}>
                {saving ? 'Записываю…' : `Записать в базу${ready.length ? ` (${ready.length})` : ''}`}
            </button>

            {recent && meters.length > 0 && (
                <div>
                    <h3 style={{ margin: '6px 0 10px', fontSize: '18px', color: 'var(--brand-primary, #371f20)' }}>Показания за последние 14 дней <span style={{ fontWeight: "normal", fontSize: "15px", color: "#7d726a" }}>(последнее за день)</span></h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '16px' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #ebe3dc', color: '#6e635b' }}>
                                    <th style={{ padding: '8px', textAlign: 'start' }}>Дата</th>
                                    {recent.meters.map(m => <th key={m.id} style={{ padding: '8px', textAlign: 'end' }}>{m.name}{m.unit ? `, ${m.unit}` : ''}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {recentDays.map(d => (
                                    <tr key={d} style={{ borderBottom: '1px solid #f3ebe2' }}>
                                        <td style={{ padding: '8px', color: '#6e635b' }}>{fmtDate(d)}</td>
                                        {recent.meters.map(m => {
                                            const p = recentVal(m, d);
                                            return (
                                                <td key={m.id} style={{ padding: '8px', textAlign: 'end', fontWeight: 'bold', color: p?.anomaly ? '#c43d3d' : '#2b2320' }}>
                                                    {p ? (p.photo ? <a href={p.photo} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{fmtNum(p.value, 3)}</a> : fmtNum(p.value, 3)) : <span style={{ color: '#cfc4ba' }}>—</span>}
                                                    {p?.more > 0 && <span title="Ещё показания за этот день — см. «Правка показаний»" style={{ fontSize: '13px', color: '#7d726a', fontWeight: 'normal' }}> +{p.more}</span>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <BossLinks />
        </div>
    );
}
