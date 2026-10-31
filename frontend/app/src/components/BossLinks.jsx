import { useState, useEffect } from 'react';
import { Ic } from './admin/adminUi';
import { meterText } from './admin/meterText';

// Ссылки для начальника: по ссылке сразу открывается отчёт по счётчикам на основном языке отеля, без входа.
// Ссылка даёт доступ только к этому отчёту и Excel. Отключённая ссылка перестаёт работать сразу.

const fmtDT = (s) => s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) + ' ' + s.slice(11, 16);

export default function BossLinks({ lang = 'en' }) {
    const m = meterText(lang);
    const [links, setLinks] = useState(null);
    const [label, setLabel] = useState(m.bl_default);
    const [copied, setCopied] = useState(null);
    const [error, setError] = useState('');

    const call = async (body) => {
        setError('');
        try {
            const res = await fetch('/backend/api/meter_link.php', body
                ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
                : undefined);
            const data = await res.json();
            if (data.success) setLinks(data.links); else setError(m.bl_fail(data.message || m.err));
        } catch {
            setError(m.no_net);
        }
    };
    useEffect(() => { call(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const copy = async (l) => {
        try { await navigator.clipboard.writeText(l.url); }
        catch { window.prompt(m.bl_copy_prompt, l.url); }
        setCopied(l.id);
        setTimeout(() => setCopied(c => (c === l.id ? null : c)), 2000);
    };
    const revoke = (l) => {
        if (window.confirm(m.bl_off_q(l.label || m.bl_noname))) call({ action: 'revoke', id: l.id });
    };

    return (
        <div className="ad-card">
            <h3><Ic n="link" />{m.bl_title}</h3>
            <div className="ad-hint">{m.bl_text}</div>
            <form className="ad-btnrow" onSubmit={e => { e.preventDefault(); call({ action: 'create', label }); }}>
                <input className="ad-fld" style={{ flex: '1 1 200px', width: 'auto' }} value={label} onChange={e => setLabel(e.target.value)} placeholder={m.bl_for} aria-label={m.bl_for} />
                <button type="submit" className="ad-btn blue"><Ic n="plus" />{m.bl_create}</button>
            </form>
            {error && <div className="ad-msg err"><Ic n="warn" /><span>{error}</span></div>}
            {links && links.length === 0 && <div className="ad-hint">{m.bl_none}</div>}
            {links && links.map(l => (
                <div key={l.id} className="ad-link">
                    <div className="ad-link-top">
                        <b>{l.label || m.bl_noname}</b>
                        <span className="ad-hint">{m.bl_last} <bdi>{l.last_used_at ? fmtDT(l.last_used_at) : m.bl_never}</bdi></span>
                    </div>
                    <input className="ad-url" readOnly value={l.url} onFocus={e => e.target.select()} dir="ltr" aria-label={l.label || m.bl_noname} />
                    <div className="ad-btnrow">
                        <button type="button" className="ad-btn green" onClick={() => copy(l)}>
                            <Ic n={copied === l.id ? 'check' : 'copy'} />{copied === l.id ? m.bl_copied : m.bl_copy}
                        </button>
                        <a href={l.url} target="_blank" rel="noreferrer" className="ad-btn"><Ic n="ext" />{m.bl_open}</a>
                        <button type="button" className="ad-btn danger" onClick={() => revoke(l)}>{m.bl_off}</button>
                    </div>
                </div>
            ))}
        </div>
    );
}
