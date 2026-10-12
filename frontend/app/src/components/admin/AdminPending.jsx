import { useState, useEffect, useRef } from 'react';
import { tr, api, errText, S, Message, Pills } from './adminUi';

// Админка → «🔎 Нераспознанные»: фото счётчиков, снятые исполнителями без распознавания.
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

    if (rows === null) return <div style={{ textAlign: 'center', padding: '40px', color: '#6e635b' }}>{t.loading}</div>;

    const meters = [...new Map(rows.map(r => [r.task_id, r.meter])).entries()];
    const visible = filter === 'all' ? rows : rows.filter(r => String(r.task_id) === filter);
    const filled = visible.filter(r => toNum(st[r.id]?.value) !== null).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <div style={S.hint}>{t.pend_hint}</div>
            <Message msg={msg} />

            {rows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#1f6b3d', fontSize: '18px', fontWeight: 'bold' }}>{t.pend_empty}</div>
            ) : (
                <>
                    {meters.length > 1 && (
                        <Pills value={filter} onChange={setFilter}
                            items={[['all', `${t.pend_all_meters} (${rows.length})`], ...meters.map(([id, name]) => [String(id), `${name} (${rows.filter(r => r.task_id === id).length})`])]} />
                    )}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {running
                            ? <button type="button" style={S.btn} onClick={stopAll}>{t.pend_stop}</button>
                            : <button type="button" style={S.primary} onClick={recognizeAll}>{t.pend_ocr_all}</button>}
                        <button type="button" style={{ ...S.primary, background: '#26875a', opacity: filled ? 1 : 0.5 }} disabled={!filled} onClick={saveAll}>{t.pend_save_all(filled)}</button>
                        <button type="button" style={S.btn} onClick={() => { setMsg(null); load(); }}>⟳ {t.refresh}</button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '12px' }}>
                        {visible.map(row => {
                            const s = st[row.id] || {};
                            const photo = s.photo || row.photos[row.photos.length - 1];
                            const num = toNum(s.value);
                            const less = row.kind === 'counter' && num !== null && row.prev && num < row.prev.value;
                            const busy = ['queued', 'ocr', 'wait'].includes(s.status);
                            return (
                                <div key={row.id} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, textAlign: 'start' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                        <b style={{ fontSize: '17px', color: '#2b2320' }}>📟 {row.meter}</b>
                                        <span style={{ color: '#5a4f48', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{fmtDate(row.date)} {row.time}</span>
                                    </div>
                                    {photo ? (
                                        <div style={{ position: 'relative', background: '#2b2320', borderRadius: '10px', overflow: 'hidden', height: '230px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <a href={photo} target="_blank" rel="noreferrer" style={{ display: 'contents' }}>
                                                <img src={photo} alt="" style={{ maxWidth: s.rot % 180 ? '230px' : '100%', maxHeight: s.rot % 180 ? '100%' : '230px', objectFit: 'contain', transform: `rotate(${s.rot || 0}deg)`, transition: 'transform .2s' }} />
                                            </a>
                                            <button type="button" onClick={() => patch(row.id, { rot: ((s.rot || 0) + 90) % 360 })}
                                                style={{ position: 'absolute', insetInlineEnd: '8px', bottom: '8px', ...S.btn, minHeight: '34px', padding: '4px 10px', fontSize: '14px', opacity: 0.92 }}>{t.pend_rotate}</button>
                                        </div>
                                    ) : <div style={{ ...S.hint, padding: '20px', textAlign: 'center' }}>{t.pend_no_photo}</div>}
                                    {row.photos.length > 1 && (
                                        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
                                            {row.photos.map(p => (
                                                <img key={p} src={p} alt="" onClick={() => patch(row.id, { photo: p })}
                                                    style={{ width: '54px', height: '54px', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer', flexShrink: 0, border: p === photo ? '3px solid var(--brand-button, #844128)' : '1px solid #ebe3dc' }} />
                                            ))}
                                        </div>
                                    )}
                                    <div style={{ fontSize: '14px', color: '#5a4f48', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        {row.worker && <span>{t.pend_worker}: <b>{row.worker}</b></span>}
                                        <span>{t.pend_prev}: {row.prev ? <b>{row.prev.value} {row.unit}</b> : t.pend_no_prev}{row.prev && <span style={{ color: '#7d726a' }}> ({fmtDate(row.prev.date)} {row.prev.time})</span>}</span>
                                        {row.notes && <span style={{ color: '#7d726a', overflowWrap: 'anywhere' }}>💬 {row.notes}</span>}
                                    </div>

                                    {s.status === 'queued' && <div style={{ color: '#7a5a30', fontWeight: 'bold' }}>{t.pend_queued}</div>}
                                    {s.status === 'ocr' && <div style={{ color: '#7a5a30', fontWeight: 'bold' }}>{t.pend_running}</div>}
                                    {s.status === 'wait' && <div style={{ color: '#b45309', fontWeight: 'bold' }}>{t.pend_wait(s.waitLeft)}</div>}
                                    {s.ai && <div style={{ color: '#1f6b3d' }}>🤖 {t.pend_ai}: <b>{s.ai}</b></div>}
                                    {s.aiFail && !busy && <div style={{ color: '#a3301c', fontSize: '14px', overflowWrap: 'anywhere' }}>⚠️ {t.pend_ai_fail}: {s.aiFail}</div>}

                                    <label style={S.label}>{t.pend_value}{row.unit ? `, ${row.unit}` : ''}
                                        <input type="text" inputMode="decimal" value={s.value || ''} onChange={e => patch(row.id, { value: e.target.value })}
                                            onKeyDown={e => { if (e.key === 'Enter') save(row); }}
                                            style={{ ...S.field, fontSize: '20px', fontWeight: 'bold', borderColor: less ? '#e0a23a' : '#d9cec5' }} />
                                    </label>
                                    {less && <div style={{ color: '#b45309', fontSize: '14px', fontWeight: 'bold' }}>{t.pend_less}</div>}

                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        <button type="button" style={{ ...S.btn, flex: '1 1 auto' }} disabled={busy || !photo} onClick={() => { stopRef.current = false; recognize(row); }}>
                                            {s.ai || s.aiFail ? t.pend_ocr_again : t.pend_ocr}
                                        </button>
                                        <button type="button" style={{ ...S.primary, background: '#26875a', flex: '1 1 auto', opacity: num === null || s.saving ? 0.5 : 1 }} disabled={num === null || s.saving} onClick={() => save(row)}>
                                            {t.pend_save}
                                        </button>
                                        <button type="button" style={{ ...S.danger, flex: '0 1 auto' }} onClick={() => skip(row)}>{t.pend_skip}</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
