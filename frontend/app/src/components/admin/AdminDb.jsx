import { useState, useEffect, useCallback } from 'react';
import { tr, api, errText, S, Message, Pills } from './adminUi';

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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'start' }}>
            <Pills value={view} onChange={setView} items={[['tables', `🗄️ ${t.db_tables}`], ['audit', t.db_audit]]} />

            {view === 'audit' ? (
                <>
                    <div style={S.hint}>{t.db_audit_d}</div>
                    {!audit ? <div style={{ padding: '30px', textAlign: 'center' }}>{t.loading}</div> : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
                                <thead><tr>
                                    {[t.audit_at, t.audit_who, t.audit_action, t.audit_table, t.audit_row, t.audit_change].map(h => <th key={h} style={{ ...S.th, textAlign: 'start' }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {audit.map(a => (
                                        <tr key={a.id}>
                                            <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{a.at}</td>
                                            <td style={S.td}>{a.worker_name}</td>
                                            <td style={S.td}>{actName(a.action)}</td>
                                            <td style={S.td}><code>{a.tbl}</code></td>
                                            <td style={S.td}><code>{a.row_key}</code></td>
                                            <td style={{ ...S.td, fontSize: '13px', fontFamily: 'var(--mono)', maxWidth: '420px', overflowWrap: 'anywhere' }}><AuditDiff before={a.before_json} after={a.after_json} /></td>
                                        </tr>
                                    ))}
                                    {audit.length === 0 && <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#7d726a' }}>{t.empty}</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <div style={{ ...S.card, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', background: '#fff8ec', borderColor: '#ecd9b8' }}>
                        <div style={{ flex: '1 1 260px' }}>⚠️ {t.db_warn}<div style={S.hint}>{t.db_backup_d}</div></div>
                        <a href={`${API}?action=backup`} style={{ ...S.primary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{t.db_backup}</a>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {(tables || []).map(tb => (
                            <button key={tb.name} type="button" onClick={() => openTable(tb.name)}
                                style={{ padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600, border: '1px solid #d9cec5',
                                    background: table === tb.name ? 'var(--brand-button, #844128)' : '#fff', color: table === tb.name ? '#fff' : '#3f3530' }}>
                                {tb.name} <span style={{ opacity: 0.7, fontWeight: 'normal' }}>{tb.rows}</span>{!tb.editable && ' 🔒'}
                            </button>
                        ))}
                        {!tables && <span>{t.loading}</span>}
                    </div>

                    <Message msg={msg} />

                    {table && data && (
                        <>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <b style={{ fontSize: '18px' }}>{table}</b>
                                <span style={S.hint}>{t.total}: {data.total}{!data.editable && ` · 🔒 ${t.db_readonly}`}</span>
                                {data.editable && <button type="button" style={S.primary} onClick={openNew}>{t.db_new_row}</button>}
                                <form style={{ display: 'flex', gap: '6px', flex: '1 1 220px' }} onSubmit={e => { e.preventDefault(); setPage(1); setQApplied(q.trim()); }}>
                                    <input style={{ ...S.field, flex: 1 }} placeholder={t.search} value={q} onChange={e => setQ(e.target.value)} />
                                    <button type="submit" style={S.btn}>🔍</button>
                                </form>
                            </div>

                            {form && (
                                <form onSubmit={save} style={{ ...S.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                                    {data.columns.map(c => (
                                        <label key={c.name} style={{ ...S.label, gridColumn: isLong(c) ? '1 / -1' : undefined }}>
                                            <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <code style={{ color: '#2b2320' }}>{c.name}</code>
                                                <span style={{ fontWeight: 'normal', fontSize: '13px', color: '#9a8f87' }}>{c.type}{data.key.includes(c.name) ? ' 🔑' : ''}</span>
                                                {c.nullable && !c.secret && (
                                                    <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', fontWeight: 'normal', fontSize: '13px', marginInlineStart: 'auto', cursor: 'pointer' }}
                                                        onClick={e => { e.preventDefault(); setForm(f => ({ ...f, nulls: { ...f.nulls, [c.name]: !f.nulls[c.name] } })); }}>
                                                        <input type="checkbox" readOnly checked={!!form.nulls[c.name]} /> {t.db_null}
                                                    </span>
                                                )}
                                            </span>
                                            {isLong(c) ? (
                                                <textarea style={{ ...S.field, minHeight: '90px', fontFamily: 'var(--mono)', fontSize: '14px' }} disabled={form.nulls[c.name]}
                                                    value={form.values[c.name]} onChange={e => setForm(f => ({ ...f, values: { ...f.values, [c.name]: e.target.value } }))} />
                                            ) : (
                                                <input style={{ ...S.field, opacity: form.nulls[c.name] ? 0.5 : 1 }} disabled={form.nulls[c.name]}
                                                    type={inputType(c)} step={inputType(c) === 'datetime-local' ? 1 : undefined} inputMode={isNum(c) ? 'decimal' : undefined}
                                                    placeholder={c.secret ? t.db_secret_hint : (form.key === null && c.auto ? t.db_auto : (form.nulls[c.name] ? 'NULL' : ''))}
                                                    value={form.values[c.name]} onChange={e => setForm(f => ({ ...f, values: { ...f.values, [c.name]: e.target.value } }))} />
                                            )}
                                        </label>
                                    ))}
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
                                        <button type="submit" style={S.primary} disabled={busy}>{t.save}</button>
                                        <button type="button" style={S.btn} onClick={() => setForm(null)}>{t.cancel}</button>
                                        {form.key && <button type="button" style={{ ...S.danger, marginInlineStart: 'auto' }} disabled={busy} onClick={remove}>🗑 {t.delete}</button>}
                                    </div>
                                </form>
                            )}

                            <div style={{ overflowX: 'auto', border: '1px solid #ebe3dc', borderRadius: '10px' }}>
                                <table style={{ borderCollapse: 'collapse', fontSize: '14px', minWidth: '100%' }}>
                                    <thead><tr>
                                        {data.columns.map(c => (
                                            <th key={c.name} onClick={() => sortBy(c.name)} style={{ ...S.th, textAlign: 'start', cursor: 'pointer', background: '#fcf9f6', position: 'sticky', top: 0 }}>
                                                {c.name}{data.sort === c.name ? (data.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                                            </th>
                                        ))}
                                    </tr></thead>
                                    <tbody>
                                        {data.rows.map((r, i) => (
                                            <tr key={i} onClick={() => openRow(r)} style={{ cursor: data.editable ? 'pointer' : 'default' }}
                                                onMouseEnter={e => { e.currentTarget.style.background = '#fbf4ec'; }} onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                                                {data.columns.map(c => {
                                                    const v = short(r[c.name]);
                                                    return <td key={c.name} style={{ ...S.td, maxWidth: '260px', overflowWrap: 'anywhere', color: v === null ? '#b3a79e' : '#2b2320' }}>{v === null ? 'NULL' : v}</td>;
                                                })}
                                            </tr>
                                        ))}
                                        {data.rows.length === 0 && <tr><td colSpan={data.columns.length} style={{ ...S.td, textAlign: 'center', color: '#7d726a' }}>{t.empty}</td></tr>}
                                    </tbody>
                                </table>
                            </div>

                            {pages > 1 && (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'center' }}>
                                    <button type="button" style={S.btn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t.prev}</button>
                                    <span>{t.page} {page} {t.of} {pages}</span>
                                    <button type="button" style={S.btn} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>{t.next}</button>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
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
