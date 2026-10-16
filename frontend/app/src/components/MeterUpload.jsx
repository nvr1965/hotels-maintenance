import { useState, useEffect, useCallback, useRef } from 'react';
import BossLinks from './BossLinks';
import { fmtNum } from './MeterChart';
import { Ic } from './admin/adminUi';
import { meterText } from './admin/meterText';
import { PhotoViewer } from './work/WorkTiles';

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

export default function MeterUpload({ lang = 'en' }) {
    const m_ = meterText(lang);
    const [viewer, setViewer] = useState(null);
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
                } else setMessage({ ok: false, text: data.message || m_.no_access });
            } catch {
                setMessage({ ok: false, text: m_.no_net });
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
            patch(meter.id, { ...emptySlot, status: 'error', error: m_.bad_type });
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
            date: guess.date, time: guess.time || hhmm(mod), source: fromName ? m_.src_name : m_.src_file,
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
                    patch(meter.id, { status: 'error', error: data.message || m_.err });
                    return;
                }
                const upd = { url: data.url };
                if (data.taken) {
                    upd.date = data.taken.date;
                    upd.time = data.taken.time;
                    upd.source = m_.src_exif;
                    loadExisting(data.taken.date);
                }
                patch(meter.id, upd);
                applyOcr(meter, data, 0);
            } catch {
                patch(meter.id, { status: 'error', error: m_.no_net });
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
        patch(meter.id, { status: 'done', gemini: null, error: data.error || m_.not_recognized, waitLeft: null });
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
                if (!data.success) { patch(meter.id, { status: 'done', gemini: null, error: data.message || m_.err }); return; }
                applyOcr(meter, { ...data, url }, attempt);
            } catch {
                patch(meter.id, { status: 'done', gemini: null, error: m_.no_net });
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
                setMessage({ ok: true, text: m_.saved_n(data.saved, names) + (data.errors?.length ? `. ${m_.not_saved}: ${data.errors.join('; ')}` : '') });
                ready.forEach(m => clearSlot(m.id));
                setExisting({});
                loadRecent();
            } else {
                setMessage({ ok: false, text: (data.errors || []).join('; ') || data.message || m_.nothing_saved });
            }
        } catch {
            setMessage({ ok: false, text: m_.no_net });
        } finally {
            setSaving(false);
        }
    };

    // Таблица последних показаний: строки — дни (новые сверху), колонки — счётчики
    const recentDays = recent ? Array.from({ length: 14 }, (_, i) => addDays(recent.to, -i)) : [];
    const recentVal = (m, d) => { const ps = m.points.filter(p => p.date === d); return ps.length ? { ...ps[ps.length - 1], more: ps.length - 1 } : null; };

    return (
        <div className="ad-list">
            <div className="ad-info">{m_.up_intro}</div>

            <div className="ad-grid">
                {meters.map(m => {
                    const s = slots[m.id] || emptySlot;
                    const inDb = s.date ? existing[s.date]?.[m.id] : undefined;
                    const prev = s.date ? prevReading(m.id, s.date, s.time) : null;
                    const num = Number(String(s.value).replace(',', '.'));
                    const lower = m.kind === 'counter' && prev && String(s.value).trim() !== '' && !Number.isNaN(num) && num < prev.value;
                    return (
                        <div key={m.id} className={'ad-card' + (dragOver === m.id ? ' drag' : '')}
                            onDragOver={e => { e.preventDefault(); setDragOver(m.id); }}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={e => { e.preventDefault(); setDragOver(null); pickFile(m, e.dataTransfer.files?.[0]); }}>
                            <h3><Ic n="gauge" />{m.name} <span className="ad-unit ad-push">{m.unit}</span></h3>

                            {s.preview ? (
                                <div className="ad-big">
                                    <button type="button" className="img" aria-label={m_.photo} onClick={() => setViewer({ items: [s.preview], caption: m.name })}>
                                        <img src={s.preview} alt="" />
                                    </button>
                                </div>
                            ) : (
                                <label className="ad-drop">
                                    <Ic n="image" className="lg" />
                                    <b>{m_.pick}</b>
                                    <span>{m_.drop}</span>
                                    <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => { pickFile(m, e.target.files?.[0]); e.target.value = ''; }} />
                                </label>
                            )}

                            {s.status === 'queued' && <div className="ad-ai wait"><Ic n="clock" />{m_.queued}</div>}
                            {s.status === 'ocr' && <div className="ad-ai"><Ic n="ai" />{m_.ocr}</div>}
                            {s.status === 'wait' && <div className="ad-ai wait"><Ic n="clock" />{m_.wait(s.waitLeft)}</div>}
                            {s.status === 'error' && <div className="ad-ai fail"><Ic n="warn" /><span>{s.error}</span></div>}

                            {(s.status === 'done' || (s.status === 'error' && s.url)) && (
                                <>
                                    {s.gemini !== null
                                        ? <div className="ad-ai ok"><Ic n="ai" />{m_.recognized} <b><bdi>{fmtNum(Number(s.gemini), 3)}</bdi></b></div>
                                        : <div className="ad-ai fail"><Ic n="warn" /><span>{m_.not_rec} {s.error}{/вручную/.test(s.error || '') ? '.' : '. ' + m_.enter_manual}</span></div>}
                                    {s.gemini === null && s.url && (
                                        <button type="button" className="ad-btn" style={{ alignSelf: 'flex-start' }} onClick={() => retryOcr(m, s.url)}><Ic n="refresh" />{m_.again}</button>
                                    )}
                                    <label className="ad-lab">{m_.value}, {m.unit}
                                        <input className={'ad-fld big' + (lower ? ' bad' : '')} inputMode="decimal" dir="ltr" value={s.value} onChange={e => patch(m.id, { value: e.target.value })} />
                                    </label>
                                    <div className="ad-row2">
                                        <label className="ad-lab">{m_.date}
                                            <input className="ad-fld" type="date" value={s.date} onChange={e => { patch(m.id, { date: e.target.value, source: m_.src_manual }); loadExisting(e.target.value); }} />
                                        </label>
                                        <label className="ad-lab">{m_.time}
                                            <input className="ad-fld" type="time" value={s.time} onChange={e => patch(m.id, { time: e.target.value })} />
                                        </label>
                                    </div>
                                    <div className="ad-hint">{m_.date_src(s.source)}</div>
                                    {prev && (
                                        <div className={lower ? 'ad-warn-t' : 'ad-kv'}>
                                            {lower && <Ic n="warn" />}
                                            <span>{m_.prev} <b><bdi>{fmtNum(prev.value, 3)}</bdi></b> (<bdi>{fmtDate(prev.date)}{prev.time ? ` ${prev.time}` : ''}</bdi>){lower ? ` — ${m_.lower}` : ''}</span>
                                        </div>
                                    )}
                                    {inDb?.length > 0 && (
                                        <div className="ad-warnbox"><Ic n="warn" /><span>
                                            {m_.in_db(fmtDate(s.date))} <bdi>{inDb.map(x => `${fmtNum(x.value, 3)} (${x.time})`).join(', ')}</bdi>.{' '}
                                            {inDb.some(x => x.time === s.time) ? <b>{m_.will_replace(s.time)}</b> : m_.one_more}
                                        </span></div>
                                    )}
                                    <button type="button" className="ad-btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => clearSlot(m.id)}><Ic n="x" />{m_.remove_photo}</button>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {message && (
                <div role="status" className={'ad-msg ' + (message.ok ? 'ok' : 'err')}><Ic n={message.ok ? 'check' : 'warn'} /><span>{message.text}</span></div>
            )}

            <button type="button" className="wk-done lg" onClick={save} disabled={!ready.length || saving}>
                <Ic n="save" />{saving ? m_.saving : m_.save_db(ready.length)}
            </button>

            {recent && meters.length > 0 && (
                <>
                    <div className="ad-sec">{m_.last14} <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{m_.last14_d}</span></div>
                    <div className="ad-tbl">
                        <table>
                            <thead>
                                <tr>
                                    <th className="first">{m_.date}</th>
                                    {recent.meters.map(m => <th key={m.id} className="num">{m.name}{m.unit ? `, ${m.unit}` : ''}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {recentDays.map(d => (
                                    <tr key={d}>
                                        <td className="first" style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}><bdi>{fmtDate(d)}</bdi></td>
                                        {recent.meters.map(m => {
                                            const p = recentVal(m, d);
                                            return (
                                                <td key={m.id} className={'num' + (p?.anomaly ? ' bad' : '')} style={{ fontWeight: 700 }}>
                                                    {p ? (p.photo
                                                        ? <button type="button" className="ad-btn ghost" style={{ minHeight: 0, padding: 0, color: 'inherit', fontWeight: 700 }}
                                                            onClick={() => setViewer({ items: [p.photo], caption: `${m.name} · ${fmtDate(d)} · ${fmtNum(p.value, 3)}` })}>{fmtNum(p.value, 3)}</button>
                                                        : fmtNum(p.value, 3)) : <span style={{ color: '#cfc4ba' }}>—</span>}
                                                    {p?.more > 0 && <span title={m_.more_day} style={{ fontSize: '12px', color: 'var(--ink-soft)', fontWeight: 'normal' }}> +{p.more}</span>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            <BossLinks lang={lang} />
            {viewer && <PhotoViewer items={viewer.items} index={0} caption={viewer.caption} t={{ close: m_.close }} onClose={() => setViewer(null)} />}
        </div>
    );
}
