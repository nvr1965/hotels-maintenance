import { useState, useEffect, useCallback } from 'react';
import { tr, trNs, api, errText, Message, Ic, Toggle, langName, languageList } from './adminUi';

// Общая админка → Переводчики (как в общем блоке i18n-block): сервисы перевода по очереди.
// Текст уходит первому настроенному и включённому сервису, который знает язык и не исчерпал дневной лимит;
// упал — пробуется следующий. Порядок — стрелками, лимит 0 — без лимита, «Проверить» — пробная фраза.

const API = '/backend/api/admin_translators.php';
const PRICE_TONE = { free: ['#e7f6ec', '#1f6b3d'], free_tier: ['#e3edf8', '#2a5f96'], paid: ['#fff4e0', '#8a5a12'] };

export default function AdminTranslators({ lang }) {
    const t = { ...tr(lang), ...trNs('translators', lang) };
    const [rows, setRows] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [checkLang, setCheckLang] = useState(lang === 'en' ? 'ru' : lang);
    const [checks, setChecks] = useState({});

    const load = useCallback(async () => {
        const d = await api(`${API}?action=list`);
        if (d.success) { setRows(d.translators); setDirty(false); } else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const change = (i, patch) => { setRows(r => r.map((x, n) => n === i ? { ...x, ...patch } : x)); setDirty(true); setMsg(null); };
    const move = (i, d) => {
        setRows(r => { const n = [...r]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
        setDirty(true);
        setMsg(null);
    };
    const save = async () => {
        setBusy(true);
        const d = await api(`${API}?action=save`, { translators: rows.map(({ id, on, daily_chars }) => ({ id, on, daily_chars })) });
        setBusy(false);
        if (!d.success) { setMsg({ ok: false, text: errText(t, d) }); return; }
        setMsg({ ok: true, text: t.saved });
        load();
    };
    const check = async (id) => {
        setChecks(c => ({ ...c, [id]: { wait: true } }));
        const d = await api(`${API}?action=check`, { id, lang: checkLang });
        const text = !d.success ? errText(t, d) : d.text === 'unsupported' ? t.unsupported : d.text;
        setChecks(c => ({ ...c, [id]: { ok: d.success && d.ok, text } }));
    };

    if (!rows) return <div className="ad-empty">{t.loading}</div>;
    const working = rows.filter(r => r.on && r.ready);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'start' }}>
            <div className="ad-hint">{t.intro}</div>
            {working.length === 0 && <div className="ad-msg err"><Ic n="warn" /><span>{t.none_working}</span></div>}
            <div className="ad-btnrow">
                <label className="ad-lab" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>{t.check_lang}
                    <select className="ad-fld" style={{ width: 'auto' }} value={checkLang} onChange={e => setCheckLang(e.target.value)}>
                        {languageList().filter(l => l.code !== 'en').map(l => <option key={l.code} value={l.code}>{langName(l.code)}</option>)}
                    </select>
                </label>
                <button type="button" className="ad-btn blue" disabled={!dirty || busy} onClick={save} style={{ marginInlineStart: 'auto' }}><Ic n="save" />{t.save}</button>
            </div>
            <Message msg={msg} />

            {rows.map((r, i) => {
                const [bg, fg] = PRICE_TONE[r.price] || PRICE_TONE.free;
                const c = checks[r.id];
                return (
                    <div key={r.id} className="ad-card" style={{ opacity: r.on ? 1 : 0.6, gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <b style={{ fontSize: '13px', color: '#7d726a', minWidth: '18px' }}>{i + 1}</b>
                            <b style={{ fontSize: '17px' }}>{r.label}</b>
                            <span className="ad-st" style={{ background: bg, color: fg }}>{t['price_' + r.price]}</span>
                            {r.ready
                                ? <span className="ad-st green">{t.ready}</span>
                                : <span className="ad-st grey">{t.needs} <bdi dir="ltr">{r.needs.join(', ')}</bdi></span>}
                            <span style={{ marginInlineStart: 'auto', display: 'flex', gap: '4px' }}>
                                <button type="button" className="ad-btn" aria-label={t.up} disabled={i === 0} onClick={() => move(i, -1)}><Ic n="chev" className="up" /></button>
                                <button type="button" className="ad-btn" aria-label={t.down} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><Ic n="chev" className="down" /></button>
                            </span>
                        </div>
                        <div className="ad-hint">{t['note_' + r.id] || r.note}</div>
                        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <Toggle on={r.on} onChange={v => change(i, { on: v })}>{r.on ? t.on : t.off}</Toggle>
                            <label className="ad-lab" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>{t.daily}
                                <input className="ad-fld" type="number" min="0" step="500" style={{ width: '120px' }} value={r.daily_chars}
                                    onChange={e => change(i, { daily_chars: Math.max(0, Number(e.target.value) || 0) })} />
                            </label>
                            <span className="ad-hint">{t.used_today(r.used_today.toLocaleString('en-US'))}{r.daily_chars > 0 ? ` / ${r.daily_chars.toLocaleString('en-US')}` : ''}</span>
                            <button type="button" className="ad-btn" disabled={!r.ready || c?.wait} onClick={() => check(r.id)}><Ic n="globe" />{t.check}</button>
                        </div>
                        {c && !c.wait && (
                            <div className={'ad-msg ' + (c.ok ? 'ok' : 'err')}>
                                <Ic n={c.ok ? 'check' : 'warn'} /><span dir="auto">{c.text}</span>
                            </div>
                        )}
                    </div>
                );
            })}
            <div className="ad-hint">{t.keys_hint}</div>
        </div>
    );
}
