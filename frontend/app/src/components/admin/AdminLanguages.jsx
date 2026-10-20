import { useState, useEffect, useCallback } from 'react';
import { tr, trNs, api, errText, S, Message, Ic } from './adminUi';
import { loadUi } from '../../i18n';

// Админка → Языки (только владелец системы): языки системы и тексты интерфейса на них.
// Новый язык добавляется строкой: тексты интерфейса сервер переводит сам, сразу после сохранения.
// Любой перевод можно поправить; поправленное автоперевод больше не трогает.

const API = '/backend/api/admin_languages.php';
const blank = { code: '', name: '', native_name: '', rtl: false, active: true, sort_order: 100, isNew: true };

// Готовые языки для добавления одним нажатием (как пресеты общего блока); любой другой — вручную
const PRESETS = [
    ['de', 'German', 'Deutsch'], ['fr', 'French', 'Français'], ['es', 'Spanish', 'Español'], ['it', 'Italian', 'Italiano'],
    ['pt', 'Portuguese', 'Português'], ['uk', 'Ukrainian', 'Українська'], ['pl', 'Polish', 'Polski'], ['tr', 'Turkish', 'Türkçe'],
    ['ro', 'Romanian', 'Română'], ['am', 'Amharic', 'አማርኛ'], ['uz', 'Uzbek', 'Oʻzbekcha'], ['kk', 'Kazakh', 'Қазақша'],
    ['ky', 'Kyrgyz', 'Кыргызча'], ['tg', 'Tajik', 'Тоҷикӣ'], ['az', 'Azerbaijani', 'Azərbaycanca'], ['ka', 'Georgian', 'ქართული'],
    ['hy', 'Armenian', 'Հայերեն'], ['fa', 'Persian', 'فارسی', true], ['hi', 'Hindi', 'हिन्दी'], ['th', 'Thai', 'ไทย'],
    ['vi', 'Vietnamese', 'Tiếng Việt'], ['tl', 'Filipino', 'Filipino'], ['zh', 'Chinese', '中文'], ['ja', 'Japanese', '日本語'],
];

export default function AdminLanguages({ lang }) {
    const t = { ...tr(lang), ...trNs('langs', lang) };
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [edit, setEdit] = useState(null);       // код языка, тексты которого правим
    const [kick, setKick] = useState(0);          // когда запустили перевод: перевод начинается чуть позже ответа

    const load = useCallback(async () => {
        const d = await api(`${API}?action=list`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    // Пока идёт автоперевод, обновляем счётчики
    const filling = !!data?.languages.some(l => l.filling);
    useEffect(() => {
        if (!filling && !kick) return;
        const id = setInterval(() => {
            load();
            if (Date.now() - kick > 10000) setKick(0);
        }, 3000);
        return () => clearInterval(id);
    }, [filling, kick, load]);

    const post = async (action, body, okText) => {
        setBusy(true);
        setMsg(null);
        const d = await api(`${API}?action=${action}`, body);
        setBusy(false);
        if (!d.success) { setMsg({ ok: false, text: errText(t, d) }); return false; }
        setMsg({ ok: true, text: okText });
        if (d.filling) setKick(Date.now());
        await load();
        loadUi(lang); // список языков в меню и на экране входа
        return true;
    };

    const save = async (e) => {
        e.preventDefault();
        if (await post('save', form, form.isNew ? t.added_off : t.saved)) setForm(null);
    };

    if (!data) return <div style={{ padding: '30px', textAlign: 'center', color: '#6e635b' }}>{t.loading}</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <div className="ad-hint">{t.about}</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="ad-btn blue" onClick={() => { setForm({ ...blank }); setMsg(null); }}>{t.add}</button>
            </div>
            {!data.can_translate && <div className="ad-msg err"><Ic n="warn" /><span>{t.no_translator_hint}</span></div>}
            <Message msg={msg} />

            {form?.isNew && (
                <div className="ad-chips" style={{ flexWrap: 'wrap' }}>
                    <span className="ad-hint" style={{ width: '100%' }}>{t.presets}</span>
                    {PRESETS.filter(([c]) => !data.languages.some(l => l.code === c)).map(([code, name, native_name, rtl]) => (
                        <button key={code} type="button" className={'ad-chp sm' + (form.code === code ? ' on' : '')}
                            onClick={() => setForm(f => ({ ...f, code, name, native_name, rtl: !!rtl }))}>{native_name}</button>
                    ))}
                </div>
            )}
            {form && (
                <form onSubmit={save} className="ad-card" style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    <label className="ad-lab">{t.code}
                        <input className="ad-fld" dir="ltr" required disabled={!form.isNew} value={form.code} placeholder="fr, de, uk, zh-CN"
                            onChange={e => setForm(f => ({ ...f, code: e.target.value.trim() }))} />
                    </label>
                    <label className="ad-lab">{t.name_en}
                        <input className="ad-fld" dir="ltr" required value={form.name} placeholder="French" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                    </label>
                    <label className="ad-lab">{t.native}
                        <input className="ad-fld" dir="auto" value={form.native_name || ''} placeholder="Français" onChange={e => setForm(f => ({ ...f, native_name: e.target.value }))} />
                    </label>
                    <label className="ad-lab">{t.order}
                        <input className="ad-fld" type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: Number(e.target.value) }))} />
                    </label>
                    <label style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                        <input type="checkbox" checked={!!form.rtl} onChange={e => setForm(f => ({ ...f, rtl: e.target.checked }))} /> {t.rtl}
                    </label>
                    <label style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                        <input type="checkbox" checked={!!form.active} disabled={form.code === 'en'} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} /> {t.active}
                    </label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                        <button type="submit" className="ad-btn blue" disabled={busy}>{t.save}</button>
                        <button type="button" className="ad-btn" onClick={() => setForm(null)}>{t.cancel}</button>
                    </div>
                </form>
            )}

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'start' }}>
                    <thead>
                        <tr>
                            {[t.language, t.progress, t.hotels, t.actions].map(h => <th key={h} style={{ ...S.th, textAlign: 'start' }}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {data.languages.map(l => {
                            const done = l.translated >= data.total;
                            return (
                                <tr key={l.code} style={{ opacity: l.active ? 1 : 0.55 }}>
                                    <td style={S.td}>
                                        <b dir="auto">{l.native_name || l.name}</b> <span className="ad-hint">{l.name} · <code>{l.code}</code>{l.rtl ? ' · RTL' : ''}</span>
                                        {!l.active && <div className="ad-hint">{t.inactive}</div>}
                                    </td>
                                    <td style={S.td}>
                                        {l.code === 'en' ? <span className="ad-hint">{t.base}</span> : (
                                            <>
                                                <span style={S.badge(done ? '#e7f6ec' : '#fff4e0', done ? '#1f6b3d' : '#8a5a12')}>{l.translated} / {data.total}</span>
                                                {l.filling && <span className="ad-hint" style={{ marginInlineStart: '8px' }}>{t.translating}</span>}
                                                {l.auto > 0 && <div className="ad-hint">{t.auto_n(l.auto)}</div>}
                                            </>
                                        )}
                                    </td>
                                    <td style={{ ...S.td, color: '#7d726a' }}>{l.hotels || '—'}</td>
                                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                            <button type="button" className="ad-btn" onClick={() => { setForm({ ...l, isNew: false }); setMsg(null); }}><Ic n="edit" /></button>
                                            {l.code !== 'en' && <button type="button" className="ad-btn" onClick={() => setEdit(edit === l.code ? null : l.code)}>{t.texts}</button>}
                                            {l.code !== 'en' && !done && <button type="button" className="ad-btn" disabled={busy} onClick={() => post('fill', { code: l.code }, t.fill_started)}>{t.fill}</button>}
                                            {l.code !== 'en' && l.auto > 0 && (
                                                <button type="button" className="ad-btn" disabled={busy}
                                                    onClick={() => window.confirm(t.redo_confirm) && post('fill', { code: l.code, redo: 1 }, t.fill_started)}>{t.redo}</button>
                                            )}
                                            {!l.built_in && (
                                                <button type="button" className="ad-btn danger" disabled={busy} aria-label={t.delete}
                                                    onClick={() => window.confirm(t.delete_confirm(l.native_name || l.name)) && post('delete', { code: l.code }, t.deleted)}><Ic n="trash" /></button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {edit && <LanguageTexts key={edit} t={t} code={edit} name={data.languages.find(l => l.code === edit)?.name}
                rtl={!!data.languages.find(l => l.code === edit)?.rtl} onChanged={load} />}
        </div>
    );
}

// Тексты интерфейса одного языка: английский рядом, поправить перевод, вернуть автоперевод
function LanguageTexts({ t, code, name, rtl, onChanged }) {
    const [rows, setRows] = useState(null);
    const [q, setQ] = useState('');
    const [show, setShow] = useState('all'); // all | auto | manual | missing
    const [drafts, setDrafts] = useState({});
    const [msg, setMsg] = useState(null);

    const load = useCallback(async () => {
        const d = await api(`${API}?action=texts&code=${encodeURIComponent(code)}`);
        if (d.success) setRows(d.rows); else setMsg({ ok: false, text: errText(t, d) });
    }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, [load]);

    const saveText = async (key, text) => {
        const d = await api(`${API}?action=text`, { code, key, text });
        if (!d.success) {
            setMsg({ ok: false, text: d.message === 'placeholders' ? t.placeholders((d.need || []).join(' ')) : errText(t, d) });
            return;
        }
        setMsg({ ok: true, text: t.saved });
        setDrafts(dr => { const n = { ...dr }; delete n[key]; return n; });
        await load();
        onChanged();
    };

    if (!rows) return <div style={{ padding: '20px', color: '#6e635b' }}>{t.loading}</div>;
    const ql = q.trim().toLowerCase();
    const source = (r) => r.auto === null ? 'missing' : r.auto ? 'auto' : 'manual';
    const shown = rows.filter(r => (show === 'all' || source(r) === show)
        && (!ql || `${r.key} ${r.en} ${r.text || ''}`.toLowerCase().includes(ql))).slice(0, 300);

    return (
        <div className="ad-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <b>{t.texts_of(name)}</b>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="ad-fld" style={{ flex: '1 1 220px', width: 'auto' }} placeholder={t.search} value={q} onChange={e => setQ(e.target.value)} />
                <select className="ad-fld" style={{ width: 'auto' }} value={show} onChange={e => setShow(e.target.value)} aria-label={t.filter}>
                    <option value="all">{t.f_all} ({rows.length})</option>
                    {['auto', 'manual', 'missing'].map(k => <option key={k} value={k}>{t['f_' + k]} ({rows.filter(r => source(r) === k).length})</option>)}
                </select>
            </div>
            <div className="ad-hint">{t.texts_hint}</div>
            <Message msg={msg} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {shown.map(r => {
                    const draft = drafts[r.key];
                    const value = draft ?? r.text ?? '';
                    return (
                        <div key={r.key} style={{ display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', padding: '8px', background: '#fff', borderRadius: '10px', border: '1px solid #ebe3dc' }}>
                            <div style={{ minWidth: 0 }}>
                                <div className="ad-hint" style={{ fontSize: '12px' }}><code>{r.key}</code></div>
                                <div dir="ltr" style={{ overflowWrap: 'anywhere' }}>{r.en}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', minWidth: 0 }}>
                                <textarea className="ad-fld" style={{ minHeight: '42px', resize: 'vertical', fontFamily: 'inherit' }} dir={rtl ? 'rtl' : 'ltr'} lang={code}
                                    value={value} placeholder={r.en} onChange={e => setDrafts(d => ({ ...d, [r.key]: e.target.value }))} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {draft !== undefined && draft !== (r.text ?? '') && <button type="button" className="ad-btn blue" onClick={() => saveText(r.key, draft)}><Ic n="save" /></button>}
                                    {r.auto === false && <button type="button" className="ad-btn" title={t.reset} onClick={() => saveText(r.key, '')}>↺</button>}
                                </div>
                            </div>
                            <div className="ad-hint" style={{ fontSize: '12px' }}>{r.auto === null ? t.st_missing : r.auto ? t.st_auto : t.st_manual}</div>
                        </div>
                    );
                })}
                {shown.length === 0 && <div className="ad-hint">{t.empty}</div>}
            </div>
        </div>
    );
}
