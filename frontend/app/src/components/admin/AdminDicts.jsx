import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, S, Message, Pills, LANG_LIST, LANG_NAMES, isRtl } from './adminUi';

// Админка → Справочники: регламентные работы, чек-лист номера, названия объектов.
// Каждая запись на 4 языках; «Перевести» заполняет остальные языки по одному.

const API = '/backend/api/admin_dicts.php';
const OCR_TYPES = ['water_m3', 'water_arad', 'gas_percent'];

// Колонка названия на языке: name_ru… или term_ru… (английское название объекта = его ключ term_en)
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

    const load = useCallback(async () => {
        setData(null);
        const d = await api(`${API}?action=list&dict=${dict}`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [dict]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); setForm(null); setFilter(''); }, [load]);

    const fields = data?.fields || [];
    const has = (f) => fields.includes(f);
    const nameOf = (item) => item[col(dict, lang)] || item[col(dict, 'ru')] || item[col(dict, 'en')] || item.key;

    const openNew = () => {
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
        const src = v[col(dict, lang)]?.trim() ? lang : LANG_LIST.find(l => v[col(dict, l)]?.trim());
        if (!src) return;
        setTranslating(true);
        const d = await api(`${API}?action=translate`, { text: v[col(dict, src)] });
        setTranslating(false);
        if (!d.success) { setMsg({ ok: false, text: errText(t, d) }); return; }
        setForm(fm => {
            const values = { ...fm.values };
            LANG_LIST.forEach(l => { if (l !== src && d.translations[l]) values[col(dict, l)] = d.translations[l]; });
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

    const items = (data?.items || []).filter(i => !filter || LANG_LIST.some(l => String(i[col(dict, l)] || '').toLowerCase().includes(filter.toLowerCase())));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <Pills value={dict} onChange={setDict} items={[['routine', t.dict_routine], ['checklist', t.dict_checklist], ['assets', t.dict_assets]]} />
            <div style={S.hint}>{t['dict_' + dict + '_d']}</div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" style={S.primary} onClick={openNew} disabled={!data}>{t.new_item}</button>
                <input style={{ ...S.field, flex: '1 1 200px', width: 'auto' }} placeholder={t.search} value={filter} onChange={e => setFilter(e.target.value)} />
            </div>

            <Message msg={msg} />

            {form && (
                <form onSubmit={save} style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={S.hint}>{t.translate_hint}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                        {LANG_LIST.map(l => {
                            const f = col(dict, l);
                            if (!has(f)) return null;
                            const label = dict === 'assets' && l === 'en' ? `${LANG_NAMES.en} — ${t.term_en}` : LANG_NAMES[l];
                            return (
                                <label key={l} style={S.label}>{label}
                                    <input style={S.field} dir={isRtl(l) ? 'rtl' : 'ltr'} lang={l} value={form.values[f] ?? ''} onChange={e => setVal(f, e.target.value)} />
                                </label>
                            );
                        })}
                    </div>
                    {has('requires_ocr') && (
                        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600, cursor: 'pointer' }}>
                                <input type="checkbox" checked={!!Number(form.values.requires_ocr)} onChange={e => setVal('requires_ocr', e.target.checked ? 1 : 0)}
                                    style={{ width: '20px', height: '20px', accentColor: 'var(--brand-button, #844128)' }} />
                                📷 {t.requires_ocr}
                            </label>
                            {has('ocr_type') && !!Number(form.values.requires_ocr) && (
                                <select style={{ ...S.field, width: 'auto' }} value={form.values.ocr_type || ''} onChange={e => setVal('ocr_type', e.target.value)}>
                                    <option value="">{t.ocr_type}…</option>
                                    {OCR_TYPES.map(o => <option key={o} value={o}>{t['ocr_' + o]}</option>)}
                                    {form.values.ocr_type && !OCR_TYPES.includes(form.values.ocr_type) && <option value={form.values.ocr_type}>{form.values.ocr_type}</option>}
                                </select>
                            )}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button type="submit" style={S.primary} disabled={busy}>{t.save}</button>
                        <button type="button" style={S.btn} onClick={translate} disabled={translating}>{translating ? t.translating : t.translate}</button>
                        <button type="button" style={S.btn} onClick={() => setForm(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}

            {!data ? <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div> : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'start' }}>
                        <thead>
                            <tr>
                                <th style={{ ...S.th, textAlign: 'start' }}>{dict === 'assets' ? t.term_en : '#'}</th>
                                <th style={{ ...S.th, textAlign: 'start' }}>{t.object_name}</th>
                                <th style={{ ...S.th, textAlign: 'start' }}>{t.usage}</th>
                                <th style={{ ...S.th, textAlign: 'start' }}>{t.actions}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(i => (
                                <tr key={i.key}>
                                    <td style={{ ...S.td, color: '#7d726a', whiteSpace: 'nowrap' }}>{dict === 'assets' ? <code>{i.key}</code> : i.key}</td>
                                    <td style={S.td}>
                                        <b style={{ color: '#2b2320' }}>{nameOf(i)}</b>
                                        {!!Number(i.requires_ocr) && <span style={{ ...S.badge('#e8f1ff', '#2f4c8a'), marginInlineStart: '8px' }}>📷 {t['ocr_' + i.ocr_type] || i.ocr_type || ''}</span>}
                                        <div style={{ ...S.hint, display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                                            {LANG_LIST.filter(l => l !== lang && i[col(dict, l)]).map(l => (
                                                <span key={l}>{l.toUpperCase()}: <bdi dir={isRtl(l) ? 'rtl' : 'ltr'}>{i[col(dict, l)]}</bdi></span>
                                            ))}
                                        </div>
                                    </td>
                                    <td style={{ ...S.td, color: '#7d726a' }}>{i.usage || '—'}</td>
                                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                            <button type="button" style={S.btn} onClick={() => openEdit(i)}>✏️</button>
                                            <button type="button" style={S.danger} disabled={busy} onClick={() => remove(i)}>🗑</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {items.length === 0 && <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: '#7d726a' }}>{t.empty}</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
