import { useState, useEffect, useRef } from 'react';
import { tr, api, errText, Message, Pills, Ic, isWide } from './adminUi';
import { PhotoViewer } from '../work/WorkTiles';

// Админка → «Нераспознанные»: фото счётчиков, снятые исполнителями без распознавания.
// Распознавание — по одному фото за раз (общая очередь), лимит Gemini в минуту пережидаем сами.
const API = '/backend/api/meter_pending.php';

const fmtDate = (d) => d ? d.split('-').reverse().join('.') : '';
const toNum = (v) => {
    const s = String(v ?? '').replace(/[\s ]/g, '').replace(',', '.');
    return s !== '' && !isNaN(Number(s)) ? Number(s) : null;
};

export default function AdminPending({ lang, onCount }) {
    const t = tr(lang);
    const [rows, setRows] = useState(null);
    const [msg, setMsg] = useState(null);
    const [filter, setFilter] = useState('all');
    // по id записи: { value, status: idle|queued|ocr|wait|done, ai, aiFail, waitLeft, photo, rot, saving }
    const [st, setSt] = useState({});
    const [running, setRunning] = useState(false);
    const queue = useRef(Promise.resolve());
    const stopRef = useRef(false);
    const timers = useRef({});
    const [open, setOpen] = useState(() => new Set());   // раскрытые плитки (на компьютере раскрыты все, на телефоне первая)
    const [viewer, setViewer] = useState(null);
    const wide = isWide();

    const patch = (id, upd) => setSt(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...upd } }));

    const load = async () => {
        const d = await api(`${API}?action=list`);
        if (!d.success) { setRows([]); setMsg({ ok: false, text: errText(t, d) }); return; }
        setRows(d.rows);
        onCount?.(d.rows.length);
    };
    useEffect(() => { load(); return () => Object.values(timers.current).forEach(clearInterval); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const enqueue = (fn) => { const p = queue.current.then(fn, fn); queue.current = p.catch(() => {}); return p; };

    // Одно фото → Gemini. Лимит в минуту: ждём, сколько сказал Google, и пробуем снова (до 3 раз).
    const recognize = (row, attempt = 0) => {
        clearInterval(timers.current[row.id]);
        const url = st[row.id]?.photo || row.photos[row.photos.length - 1];
        patch(row.id, { status: 'queued', waitLeft: null, aiFail: null });
        return enqueue(async () => {
            if (stopRef.current) { patch(row.id, { status: 'idle' }); return; }
            patch(row.id, { status: 'ocr' });
            const d = await api(`${API}?action=ocr`, { id: row.id, url });
            if (!d.success) { patch(row.id, { status: 'idle', aiFail: errText(t, d) }); return; }
            if (d.value !== null && d.value !== undefined && d.value !== '') {
                setSt(prev => {
                    const cur = prev[row.id] || {};
                    // своё уже вписанное значение не затираем
                    return { ...prev, [row.id]: { ...cur, status: 'idle', ai: String(d.value), aiFail: null, value: cur.value ? cur.value : String(d.value) } };
                });
                return;
            }
            if (d.limit === 'day') {
                stopRef.current = true;
                setMsg({ ok: false, text: t.pend_day_limit });
                patch(row.id, { status: 'idle', aiFail: t.pend_day_limit });
                return;
            }
            if (d.limit === 'minute' && attempt < 3) {
                let left = d.retry_after || 60;
                patch(row.id, { status: 'wait', waitLeft: left });
                await new Promise(resolve => {
                    timers.current[row.id] = setInterval(() => {
                        left -= 1;
                        if (left > 0 && !stopRef.current) { patch(row.id, { waitLeft: left }); return; }
                        clearInterval(timers.current[row.id]);
                        resolve();
                    }, 1000);
                });
                if (stopRef.current) { patch(row.id, { status: 'idle', waitLeft: null }); return; }
                // повтор ставим в начало: очередь сейчас занята этим же фото
                patch(row.id, { status: 'ocr', waitLeft: null });
                const again = await api(`${API}?action=ocr`, { id: row.id, url });
                if (again.success && again.value !== null && again.value !== undefined && again.value !== '') {
                    setSt(prev => ({ ...prev, [row.id]: { ...(prev[row.id] || {}), status: 'idle', ai: String(again.value), aiFail: null, value: prev[row.id]?.value || String(again.value) } }));
                } else {
                    patch(row.id, { status: 'idle', aiFail: again.success ? (again.limit === 'day' ? t.pend_day_limit : (again.error || t.pend_ai_fail)) : errText(t, again) });
                    if (again.limit === 'day') { stopRef.current = true; setMsg({ ok: false, text: t.pend_day_limit }); }
                }
                return;
            }
            patch(row.id, { status: 'idle', aiFail: d.error || t.pend_ai_fail });
        });
    };

    const recognizeAll = async () => {
        stopRef.current = false;
        setMsg(null);
        setRunning(true);
        const todo = visible.filter(r => r.photos.length && !(st[r.id]?.value) && !['queued', 'ocr', 'wait'].includes(st[r.id]?.status));
        await Promise.all(todo.map(r => recognize(r)));
        setRunning(false);
    };
    const stopAll = () => {
        stopRef.current = true;
        setRunning(false);
    };

    const save = async (row) => {
        const value = st[row.id]?.value;
        if (toNum(value) === null) { setMsg({ ok: false, text: t.err_not_number }); return false; }
        patch(row.id, { saving: true });
        const d = await api(`${API}?action=save`, { id: row.id, value, gemini: st[row.id]?.ai ?? null });
        patch(row.id, { saving: false });
        if (!d.success) { setMsg({ ok: false, text: `${row.meter}: ${errText(t, d)}` }); if (d.message === 'already_done') drop(row.id); return false; }
        drop(row.id);
        return true;
    };
    const drop = (id) => setRows(prev => {
        const next = (prev || []).filter(r => r.id !== id);
        onCount?.(next.length);
        return next;
    });

    const saveAll = async () => {
        let n = 0;
        // по порядку времени: так показания дня ложатся в регламент правильно
        for (const r of visible.filter(r => toNum(st[r.id]?.value) !== null)) {
            if (await save(r)) n++;
        }
        if (n) setMsg({ ok: true, text: t.pend_saved_n(n) });
    };

    const skip = async (row) => {
        if (!window.confirm(t.pend_skip_confirm)) return;
        const d = await api(`${API}?action=skip`, { id: row.id });
        if (!d.success && d.message !== 'already_done') { setMsg({ ok: false, text: errText(t, d) }); return; }
        drop(row.id);
    };

    if (rows === null) return <div className="ad-empty">{t.loading}</div>;

    const meters = [...new Map(rows.map(r => [r.task_id, r.meter])).entries()];
    const visible = filter === 'all' ? rows : rows.filter(r => String(r.task_id) === filter);
    const filled = visible.filter(r => toNum(st[r.id]?.value) !== null).length;
    const flip = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

    return (
        <>
            <div className="ad-pad ad-hint">{t.pend_hint}</div>
            <div className="ad-list">
                <Message msg={msg} />

                {rows.length === 0 ? (
                    <div className="ad-empty ok"><Ic n="check" />{t.pend_empty}</div>
                ) : (
                    <>
                        {meters.length > 1 && (
                            <Pills value={filter} onChange={setFilter}
                                items={[['all', t.pend_all_meters, rows.length], ...meters.map(([id, name]) => [String(id), name, rows.filter(r => r.task_id === id).length])]} />
                        )}
                        <div className="ad-btnrow">
                            {running
                                ? <button type="button" className="ad-btn danger" onClick={stopAll}><Ic n="stop" />{t.pend_stop}</button>
                                : <button type="button" className="ad-btn blue" onClick={recognizeAll}><Ic n="ai" />{t.pend_ocr_all}</button>}
                            <button type="button" className="ad-btn green" disabled={!filled} onClick={saveAll}><Ic n="save" />{t.pend_save_all(filled)}</button>
                            <button type="button" className="ad-btn" onClick={() => { setMsg(null); load(); }}><Ic n="refresh" />{t.refresh}</button>
                        </div>

                        <div className="ad-grid wide">
                            {visible.map((row, idx) => {
                                const s = st[row.id] || {};
                                const photo = s.photo || row.photos[row.photos.length - 1];
                                const num = toNum(s.value);
                                const less = row.kind === 'counter' && num !== null && row.prev && num < row.prev.value;
                                const busy = ['queued', 'ocr', 'wait'].includes(s.status);
                                const isOpen = (wide || idx === 0) !== open.has(row.id);
                                const caption = `${row.meter} · ${fmtDate(row.date)} ${row.time}${row.worker ? ' · ' + row.worker : ''}`;
                                return (
                                    <div key={row.id} className={'wk-tile ad-gold' + (isOpen ? ' open' : '')}>
                                        <div className="wk-row" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => flip(row.id)}
                                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(row.id); } }}>
                                            <div className="txt">
                                                <div className="wk-place md"><Ic n="gauge" />{row.meter}</div>
                                                <div className="wk-sub">{row.worker && <>{t.pend_worker}: <b>{row.worker}</b> · </>}<bdi>{fmtDate(row.date)} {row.time}</bdi></div>
                                            </div>
                                            <span className={'ad-num' + (num === null ? ' empty' : '')}><bdi>{num === null ? '…' : s.value}</bdi></span>
                                        </div>
                                        {isOpen && (
                                            <div className="wk-more">
                                                {photo ? (
                                                    <div className="ad-big">
                                                        <button type="button" className="img" aria-label={t.photo} onClick={() => setViewer({ items: row.photos, index: Math.max(0, row.photos.indexOf(photo)), caption })}>
                                                            <img src={photo} alt="" className={s.rot % 180 ? 'r90' : ''} style={{ transform: `rotate(${s.rot || 0}deg)` }} />
                                                        </button>
                                                        <button type="button" className="ad-btn" onClick={() => patch(row.id, { rot: ((s.rot || 0) + 90) % 360 })}><Ic n="rotate" />{t.pend_rotate}</button>
                                                    </div>
                                                ) : <div className="ad-empty" style={{ padding: '16px' }}><Ic n="image" />{t.pend_no_photo}</div>}
                                                {row.photos.length > 1 && (
                                                    <div className="ad-thumbs">
                                                        {row.photos.map(p => (
                                                            <button key={p} type="button" className={'ad-ph sm' + (p === photo ? ' on' : '')} aria-label={t.photo} onClick={() => patch(row.id, { photo: p })}>
                                                                <img src={p} alt="" />
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="ad-kv">
                                                    {t.pend_prev}: {row.prev ? <b><bdi>{row.prev.value} {row.unit}</bdi></b> : t.pend_no_prev}
                                                    {row.prev && <> (<bdi>{fmtDate(row.prev.date)} {row.prev.time}</bdi>)</>}
                                                </div>
                                                {row.notes && <div className="ad-kv" style={{ display: 'flex', gap: '6px' }}><Ic n="note" /><span>{row.notes}</span></div>}

                                                {s.status === 'queued' && <div className="ad-ai wait"><Ic n="clock" />{t.pend_queued}</div>}
                                                {s.status === 'ocr' && <div className="ad-ai"><Ic n="ai" />{t.pend_running}</div>}
                                                {s.status === 'wait' && <div className="ad-ai wait"><Ic n="clock" />{t.pend_wait(s.waitLeft)}</div>}
                                                {s.ai && <div className="ad-ai ok"><Ic n="ai" />{t.pend_ai}: <b><bdi>{s.ai}</bdi></b></div>}
                                                {s.aiFail && !busy && <div className="ad-ai fail"><Ic n="warn" /><span>{t.pend_ai_fail}: {s.aiFail}</span></div>}

                                                <label className="ad-lab">{t.pend_value}{row.unit ? `, ${row.unit}` : ''}
                                                    <input type="text" inputMode="decimal" className={'ad-fld big' + (less ? ' warn' : '')} value={s.value || ''}
                                                        placeholder={row.prev ? String(row.prev.value) : ''} dir="ltr"
                                                        onChange={e => patch(row.id, { value: e.target.value })}
                                                        onKeyDown={e => { if (e.key === 'Enter') save(row); }} />
                                                </label>
                                                {less && <div className="ad-less"><Ic n="warn" />{t.pend_less}</div>}

                                                <div className="ad-btnrow">
                                                    <button type="button" className="ad-btn" disabled={busy || !photo} onClick={() => { stopRef.current = false; recognize(row); }}>
                                                        <Ic n="ai" />{s.ai || s.aiFail ? t.pend_ocr_again : t.pend_ocr}
                                                    </button>
                                                    <button type="button" className="ad-btn danger" onClick={() => skip(row)}>{t.pend_skip}</button>
                                                </div>
                                                <button type="button" className="wk-done lg" disabled={num === null || s.saving} onClick={() => save(row)}>
                                                    <Ic n="save" />{t.pend_save}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
            {viewer && <PhotoViewer items={viewer.items} index={viewer.index} caption={viewer.caption} t={{ close: t.close }} onClose={() => setViewer(null)} />}
        </>
    );
}
