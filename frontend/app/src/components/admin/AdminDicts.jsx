import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, Message, Pills, langName, isRtl, Ic, Toggle, Search, PlusBtn, isWide } from './adminUi';

// Админка → Справочники: регламентные работы, чек-лист номера, названия объектов.
// Каждая запись на языках отеля; пустые языки сервер заполняет автопереводом при сохранении,
// «Перевести» показывает перевод заранее, чтобы его можно было поправить.

const API = '/backend/api/admin_dicts.php';
const OCR_TYPES = ['water_m3', 'water_arad', 'gas_percent'];

// Колонка названия на языке: name_ru… или term_ru… (у объекта ещё ключ term_key, по нему на него ссылаются)
const col = (dict, l) => (dict === 'assets' ? 'term_' : 'name_') + l;

export default function AdminDicts({ lang }) {
    const t = tr(lang);
    const [dict, setDict] = useState('routine');
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);     // { key|null, values: {...} }
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [filter, setFilter] = useState('');
    const [open, setOpen] = useState(() => new Set());
    const wide = isWide();

    const load = useCallback(async () => {
        setData(null);
        const d = await api(`${API}?action=list&dict=${dict}`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [dict]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); setForm(null); setFilter(''); }, [load]);

    const fields = data?.fields || [];
    const LANGS = data?.langs || [lang];
    const has = (f) => fields.includes(f);
    const nameOf = (item) => item[col(dict, lang)] || LANGS.map(l => item[col(dict, l)]).find(Boolean) || item.key;

    const openNew = () => {
        if (form && form.key === null) { setForm(null); return; }
        const values = {};
        fields.forEach(f => { values[f] = f === 'requires_ocr' ? 0 : ''; });
        setForm({ key: null, values });
        setMsg(null);
    };
    const openEdit = (item) => {
        const values = {};
        fields.forEach(f => { values[f] = item[f] ?? (f === 'requires_ocr' ? 0 : ''); });
        setForm({ key: item.key, values });
        setMsg(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const setVal = (f, v) => setForm(fm => ({ ...fm, values: { ...fm.values, [f]: v } }));

    const translate = async () => {
        const v = form.values;
        const src = v[col(dict, lang)]?.trim() ? lang : LANGS.find(l => v[col(dict, l)]?.trim());
        if (!src) return;
        setTranslating(true);
        const d = await api(`${API}?action=translate`, { text: v[col(dict, src)] });
        setTranslating(false);
        if (!d.success) { setMsg({ ok: false, text: errText(t, d) }); return; }
        setForm(fm => {
            const values = { ...fm.values };
            LANGS.forEach(l => { if (l !== src && d.translations[l]) values[col(dict, l)] = d.translations[l]; });
            return { ...fm, values };
        });
    };

    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const d = await api(`${API}?action=save`, { dict, key: form.key, values: form.values });
        setBusy(false);
        if (d.success) { setMsg({ ok: true, text: t.saved }); setForm(null); load(); }
        else setMsg({ ok: false, text: errText(t, d) });
    };

    const remove = async (item) => {
        if (!window.confirm(`${nameOf(item)}: ${t.confirm_delete}`)) return;
        setBusy(true);
        let d = await api(`${API}?action=delete`, { dict, key: item.key });
        if (!d.success && d.message === 'in_use' && window.confirm(t.in_use(d.usage))) {
            d = await api(`${API}?action=delete`, { dict, key: item.key, force: 1 });
        }
        setBusy(false);
        if (d.success) { setMsg({ ok: true, text: t.deleted }); setForm(null); load(); }
        else if (d.message !== 'in_use') setMsg({ ok: false, text: errText(t, d) });
    };

    const flip = (k) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const items = (data?.items || []).filter(i => !filter || LANGS.some(l => String(i[col(dict, l)] || '').toLowerCase().includes(filter.toLowerCase())));
    const ocrOn = form && !!Number(form.values.requires_ocr);
    const ocrList = form && form.values.ocr_type && !OCR_TYPES.includes(form.values.ocr_type) ? [...OCR_TYPES, form.values.ocr_type] : OCR_TYPES;

    return (
        <>
            <div className="ad-pad"><Pills value={dict} onChange={setDict} items={[['routine', t.dict_routine], ['checklist', t.dict_checklist], ['assets', t.dict_assets]]} /></div>
            <div className="ad-pad ad-hint">{t['dict_' + dict + '_d']}</div>

            <div className="ad-list">
                <div className="ad-top">
                    <PlusBtn on={form && form.key === null} disabled={!data} onClick={openNew}>{t.new_item}</PlusBtn>
                    <Search value={filter} onChange={setFilter} placeholder={t.search} />
                </div>

                <Message msg={msg} />

                {form && (
                    <form onSubmit={save} className="ad-card form">
                        {form.key !== null && <h3><Ic n="edit" />{nameOf(form.values) || form.key}</h3>}
                        <div className="ad-hint">{t.translate_hint}</div>
                        <div className="ad-form-grid">
                            {LANGS.map(l => {
                                const f = col(dict, l);
                                if (!has(f)) return null;
                                const label = langName(l);
                                return (
                                    <label key={l} className="ad-lab">{label}
                                        <input className="ad-fld" dir={isRtl(l) ? 'rtl' : 'ltr'} lang={l} value={form.values[f] ?? ''} onChange={e => setVal(f, e.target.value)} />
                                    </label>
                                );
                            })}
                        </div>
                        <div className="ad-btnrow">
                            <button type="button" className="ad-btn" onClick={translate} disabled={translating}><Ic n="globe" />{translating ? t.translating : t.translate}</button>
                        </div>
                        {has('requires_ocr') && (
                            <>
                                <Toggle on={ocrOn} onChange={v => setVal('requires_ocr', v ? 1 : 0)}>{t.requires_ocr}</Toggle>
                                {has('ocr_type') && ocrOn && (
                                    <div className="ad-lab">{t.ocr_type}
                                        <div className="ad-chips" role="radiogroup" aria-label={t.ocr_type}>
                                            {ocrList.map(o => (
                                                <button key={o} type="button" role="radio" aria-checked={form.values.ocr_type === o}
                                                    className={'ad-chp sm' + (form.values.ocr_type === o ? ' on' : '')} onClick={() => setVal('ocr_type', o)}>{t['ocr_' + o] || o}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                        <button type="submit" className="wk-done lg" disabled={busy}><Ic n="save" />{t.save}</button>
                        <button type="button" className="ad-btn" style={{ alignSelf: 'center' }} onClick={() => setForm(null)}>{t.cancel}</button>
                    </form>
                )}

                {!data ? <div className="ad-empty">{t.loading}</div> : (
                    <div className="ad-grid">
                        {items.length === 0 && <div className="ad-empty ad-full">{t.empty}</div>}
                        {items.map(i => {
                            const k = String(i.key);
                            const isOpen = wide !== open.has(k);
                            const ocr = !!Number(i.requires_ocr);
                            return (
                                <div key={k} className={'wk-tile' + (ocr ? ' ad-gold' : '') + (isOpen ? ' open' : '')}>
                                    <div className="wk-row" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => flip(k)}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(k); } }}>
                                        <div className="txt">
                                            <div className="wk-place md">{ocr && <Ic n="gauge" />}{nameOf(i)}</div>
                                            {ocr ? <div className="wk-sub">{t['ocr_' + i.ocr_type] || i.ocr_type || ''}</div>
                                                : dict === 'assets' ? <div className="wk-sub">{t.term_en}: <span className="ad-mono">{i.key}</span></div> : null}
                                        </div>
                                        <span className={'ad-num' + (i.usage ? '' : ' empty')} title={t.usage}>{i.usage || 0}</span>
                                    </div>
                                    {isOpen && (
                                        <div className="wk-more">
                                            <div className="ad-lng">
                                                {LANGS.filter(l => i[col(dict, l)]).map(l => (
                                                    <FragmentLang key={l} l={l} v={i[col(dict, l)]} />
                                                ))}
                                            </div>
                                            <div className="ad-kv">{t.usage}: <b>{i.usage || 0}</b>{dict !== 'assets' && <> · <bdi>#{i.key}</bdi></>}</div>
                                            <div className="ad-btnrow">
                                                <button type="button" className="ad-btn" onClick={() => openEdit(i)}><Ic n="edit" />{t.edit}</button>
                                                <button type="button" className="ad-btn danger" disabled={busy} onClick={() => remove(i)}><Ic n="trash" />{t.delete}</button>
                                            </div>
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

function FragmentLang({ l, v }) {
    return (
        <>
            <span>{l.toUpperCase()}</span>
            <div dir={isRtl(l) ? 'rtl' : 'ltr'} lang={l} style={{ textAlign: 'start', overflowWrap: 'anywhere' }}>{v}</div>
        </>
    );
}
