import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, Message, Pills, Ic, Search } from './adminUi';

// Админка → База данных: любая таблица — просмотр, поиск, правка, добавление, удаление строк.
// Плюс копия базы одним .sql и журнал всех правок из админки.

const API = '/backend/api/admin_db.php';
const PER = 50;
const short = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
};
const isLong = (c) => /text|blob|json/i.test(c.type);
const isNum = (c) => /int|decimal|float|double/i.test(c.type);
const inputType = (c) => /^date$/i.test(c.type) ? 'date' : /^datetime|^timestamp/i.test(c.type) ? 'datetime-local' : 'text';
// Значение из базы → значение поля ввода и обратно
const toInput = (c, v) => (v === null || v === undefined) ? '' : inputType(c) === 'datetime-local' ? String(v).replace(' ', 'T').slice(0, 19) : String(v);
const fromInput = (c, v) => inputType(c) === 'datetime-local' && v ? v.replace('T', ' ') + (v.length === 16 ? ':00' : '') : v;

export default function AdminDb({ lang }) {
    const t = tr(lang);
    const [view, setView] = useState('tables');
    const [tables, setTables] = useState(null);
    const [table, setTable] = useState('');
    const [page, setPage] = useState(1);
    const [q, setQ] = useState('');
    const [qApplied, setQApplied] = useState('');
    const [sort, setSort] = useState({ col: '', dir: 'desc' });
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);     // { key|null, values, nulls }
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [audit, setAudit] = useState(null);

    const loadTables = useCallback(async () => {
        const d = await api(`${API}?action=tables`);
        if (d.success) setTables(d.tables); else setMsg({ ok: false, text: errText(t, d) });
    }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { loadTables(); }, [loadTables]);

    const loadRows = useCallback(async () => {
        if (!table) return;
        const p = new URLSearchParams({ action: 'rows', table, page, per: PER, q: qApplied, sort: sort.col, dir: sort.dir });
        const d = await api(`${API}?${p}`);
        if (d.success) setData(d); else setMsg({ ok: false, text: errText(t, d) });
    }, [table, page, qApplied, sort]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { loadRows(); }, [loadRows]);

    useEffect(() => {
        if (view !== 'audit') return;
        api(`${API}?action=audit&limit=300`).then(d => d.success ? setAudit(d.rows) : setMsg({ ok: false, text: errText(t, d) }));
    }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

    const openTable = (name) => {
        setTable(name); setPage(1); setQ(''); setQApplied(''); setSort({ col: '', dir: 'desc' });
        setData(null); setForm(null); setMsg(null);
    };

    const keyOf = (row) => Object.fromEntries((data?.key || []).map(c => [c, row[c]]));

    const openRow = (row) => {
        if (!data.editable) return;
        const values = {}, nulls = {};
        data.columns.forEach(c => {
            values[c.name] = c.secret ? '' : toInput(c, row[c.name]);
            nulls[c.name] = !c.secret && row[c.name] === null;
        });
        setForm({ key: keyOf(row), values, nulls });
        setMsg(null);
    };
    const openNew = () => {
        const values = {}, nulls = {};
        data.columns.forEach(c => {
            values[c.name] = '';
            nulls[c.name] = c.nullable && !c.auto && c.default === null;
        });
        setForm({ key: null, values, nulls });
        setMsg(null);
    };

    const save = async (e) => {
        e.preventDefault();
        const values = {};
        data.columns.forEach(c => {
            if (c.secret && !form.values[c.name]) return;
            if (form.key === null && c.auto && form.values[c.name] === '') return;
            values[c.name] = form.nulls[c.name] ? null : fromInput(c, form.values[c.name]);
        });
        setBusy(true);
        const d = await api(`${API}?action=save`, { table, key: form.key, values });
        setBusy(false);
        if (d.success) { setMsg({ ok: true, text: t.saved }); setForm(null); loadRows(); loadTables(); }
        else setMsg({ ok: false, text: errText(t, d) });
    };

    const remove = async () => {
        if (!window.confirm(`${table} ${JSON.stringify(form.key)}: ${t.confirm_delete}`)) return;
        setBusy(true);
        const d = await api(`${API}?action=delete`, { table, key: form.key });
        setBusy(false);
        if (d.success) { setMsg({ ok: true, text: t.deleted }); setForm(null); loadRows(); loadTables(); }
        else setMsg({ ok: false, text: errText(t, d) });
    };

    const sortBy = (col) => { setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' })); setPage(1); };
    const pages = data ? Math.max(1, Math.ceil(data.total / data.per)) : 1;
    const actName = (a) => t['act_' + a] || a;

    const field = (c) => {
        const set = (v) => setForm(f => ({ ...f, values: { ...f.values, [c.name]: v } }));
        return isLong(c) ? (
            <textarea className="ad-fld ad-mono" style={{ fontSize: '14px' }} disabled={form.nulls[c.name]} value={form.values[c.name]} onChange={e => set(e.target.value)} />
        ) : (
            <input className="ad-fld" disabled={form.nulls[c.name]}
                type={inputType(c)} step={inputType(c) === 'datetime-local' ? 1 : undefined} inputMode={isNum(c) ? 'decimal' : undefined}
                placeholder={c.secret ? t.db_secret_hint : (form.key === null && c.auto ? t.db_auto : (form.nulls[c.name] ? 'NULL' : ''))}
                value={form.values[c.name]} onChange={e => set(e.target.value)} />
        );
    };

    return (
        <>
            <div className="ad-pad"><Pills value={view} onChange={setView} items={[['tables', t.db_tables], ['audit', t.db_audit]]} /></div>

            {view === 'audit' ? (
                <div className="ad-list">
                    <div className="ad-hint">{t.db_audit_d}</div>
                    <Message msg={msg} />
                    {!audit ? <div className="ad-empty">{t.loading}</div> : audit.length === 0 ? <div className="ad-empty">{t.empty}</div> : (
                        <div className="ad-grid wide">
                            {audit.map(a => (
                                <div key={a.id} className="ad-audit">
                                    <div className="ad-audit-top">
                                        <bdi>{a.at}</bdi>
                                        <b>{a.worker_name}</b>
                                        <span className="ad-st blue">{actName(a.action)}</span>
                                        <span className="ad-mono">{a.tbl}{a.row_key ? ` · ${a.row_key}` : ''}</span>
                                    </div>
                                    <div className="ad-diff ad-mono"><AuditDiff before={a.before_json} after={a.after_json} /></div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="ad-list">
                    <div className="ad-warnbox"><Ic n="warn" /><span>{t.db_warn}</span></div>
                    <div className="ad-card">
                        <div className="ad-btnrow">
                            <a href={`${API}?action=backup`} className="ad-btn green"><Ic n="download" />{t.db_backup}</a>
                        </div>
                        <div className="ad-hint">{t.db_backup_d}</div>
                    </div>

                    <Message msg={msg} />

                    {!table ? (
                        <>
                            <div className="ad-sec">{t.db_tables}{tables ? ` · ${tables.length}` : ''}</div>
                            {!tables ? <div className="ad-empty">{t.loading}</div> : (
                                <div className="ad-grid">
                                    {tables.map(tb => (
                                        <div key={tb.name} className="wk-tile" role="button" tabIndex={0} onClick={() => openTable(tb.name)}
                                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTable(tb.name); } }}>
                                            <div className="wk-row" style={{ alignItems: 'center' }}>
                                                <div className="txt">
                                                    <div className="wk-place ad-mono" style={{ fontSize: '17px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}><Ic n="db" /><span style={{ minWidth: 0 }}>{tb.name}</span></div>
                                                    <div className="wk-sub"><b>{tb.rows}</b> {t.db_rows}</div>
                                                </div>
                                                {!tb.editable && <span className="ad-st grey"><Ic n="lock" />{t.db_readonly}</span>}
                                                <Ic n="chev" className="ad-chev" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="ad-btnrow">
                                <button type="button" className="ad-btn" onClick={() => { setTable(''); setData(null); setForm(null); }}><Ic n="back" flip />{t.db_tables}</button>
                                <div className="ad-chips sx" style={{ flex: '1 1 200px' }}>
                                    {(tables || []).map(tb => (
                                        <button key={tb.name} type="button" className={'ad-chp sm ad-mono' + (table === tb.name ? ' on' : '')} onClick={() => openTable(tb.name)}>
                                            {tb.name}{!tb.editable && <Ic n="lock" />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {!data ? <div className="ad-empty">{t.loading}</div> : (
                                <>
                                    <div className="ad-card">
                                        <h3><Ic n="db" /><span className="ad-mono" style={{ fontSize: '17px' }}>{table}</span>
                                            {!data.editable && <span className="ad-st grey"><Ic n="lock" />{t.db_readonly}</span>}</h3>
                                        <div className="ad-hint">{t.total}: <b>{data.total}</b></div>
                                        <form className="ad-btnrow" onSubmit={e => { e.preventDefault(); setPage(1); setQApplied(q.trim()); }}>
                                            <Search value={q} onChange={setQ} placeholder={t.search} />
                                            <button type="submit" className="ad-btn"><Ic n="search" />{t.search.replace('…', '')}</button>
                                            {data.editable && <button type="button" className="ad-btn blue" onClick={openNew}><Ic n="plus" />{t.db_new_row}</button>}
                                        </form>
                                    </div>

                                    {form && (
                                        <form onSubmit={save} className="ad-card form">
                                            <h3>{form.key ? <><Ic n="edit" /><span className="ad-mono">{JSON.stringify(form.key)}</span></> : <><Ic n="plus" />{t.db_new_row}</>}</h3>
                                            <div className="ad-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
                                                {data.columns.map(c => (
                                                    <label key={c.name} className={'ad-lab' + (isLong(c) ? ' ad-span' : '')}>
                                                        <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <span className="ad-mono" style={{ color: 'var(--ink)' }}>{c.name}</span>
                                                            <span style={{ fontWeight: 'normal', fontSize: '12px', color: '#9a8f87' }} className="ad-mono">{c.type}</span>
                                                            {data.key.includes(c.name) && <Ic n="key" />}
                                                            {c.nullable && !c.secret && (
                                                                <button type="button" className="ad-tgl ad-push" style={{ fontSize: '12px', minHeight: 0, padding: 0 }} aria-pressed={!!form.nulls[c.name]}
                                                                    onClick={e => { e.preventDefault(); setForm(f => ({ ...f, nulls: { ...f.nulls, [c.name]: !f.nulls[c.name] } })); }}>{t.db_null}</button>
                                                            )}
                                                        </span>
                                                        {field(c)}
                                                    </label>
                                                ))}
                                            </div>
                                            <button type="submit" className="wk-done lg" disabled={busy}><Ic n="save" />{t.save}</button>
                                            <div className="ad-btnrow" style={{ justifyContent: 'center' }}>
                                                <button type="button" className="ad-btn" onClick={() => setForm(null)}>{t.cancel}</button>
                                                {form.key && <button type="button" className="ad-btn danger" disabled={busy} onClick={remove}><Ic n="trash" />{t.delete}</button>}
                                            </div>
                                        </form>
                                    )}

                                    <div className="ad-tbl">
                                        <table>
                                            <thead><tr>
                                                {data.columns.map(c => (
                                                    <th key={c.name} className="sort" onClick={() => sortBy(c.name)} aria-sort={data.sort === c.name ? (data.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                                                        <span className="ad-mono">{c.name}</span>{data.sort === c.name && <Ic n="chev" className={data.dir === 'asc' ? 'up' : 'down'} />}
                                                    </th>
                                                ))}
                                            </tr></thead>
                                            <tbody>
                                                {data.rows.map((r, i) => (
                                                    <tr key={i} className={data.editable ? 'click' : ''} onClick={() => openRow(r)}>
                                                        {data.columns.map(c => {
                                                            const v = short(r[c.name]);
                                                            return <td key={c.name} className={v === null ? 'null' : ''} style={{ maxWidth: '260px', overflowWrap: 'anywhere' }}><bdi>{v === null ? 'NULL' : v}</bdi></td>;
                                                        })}
                                                    </tr>
                                                ))}
                                                {data.rows.length === 0 && <tr><td colSpan={data.columns.length} style={{ textAlign: 'center', color: '#7d726a' }}>{t.empty}</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>

                                    {pages > 1 && (
                                        <div className="ad-pager">
                                            <button type="button" className="ad-btn" aria-label={t.back} disabled={page <= 1} onClick={() => setPage(p => p - 1)}><Ic n="chevL" flip /></button>
                                            <span>{t.page} {page} {t.of} {pages}</span>
                                            <button type="button" className="ad-btn" aria-label="next" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><Ic n="chev" flip /></button>
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </>
    );
}

/** Что изменилось: для правки — только изменённые поля «было → стало». */
function AuditDiff({ before, after }) {
    let b = null, a = null;
    try { b = before ? JSON.parse(before) : null; } catch { /* как есть */ }
    try { a = after ? JSON.parse(after) : null; } catch { /* как есть */ }
    if (b && a) {
        const keys = Object.keys(a).filter(k => String(a[k]) !== String(b[k]));
        if (!keys.length) return <span>—</span>;
        return <>{keys.map(k => <div key={k}><b>{k}</b>: {short(b[k]) ?? 'NULL'} → {short(a[k]) ?? 'NULL'}</div>)}</>;
    }
    const one = a || b;
    if (!one || typeof one !== 'object') return <span>{short(after || before) || '—'}</span>;
    return <>{Object.entries(one).slice(0, 8).map(([k, v]) => <div key={k}><b>{k}</b>: {short(Array.isArray(v) ? v.join(', ') : v) ?? 'NULL'}</div>)}</>;
}
