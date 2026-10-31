import { useState, useEffect } from 'react';
import { flagUrl } from '../flags';
import { langName, dirOf } from '../i18n';

// Выбор языка: кнопка «флаг + название ▾», по нажатию — плитка всех языков по алфавиту с флагами.

export function LangFlag({ code, size = 22 }) {
    const url = flagUrl(code);
    const h = Math.round(size * 0.75);
    if (!url) {
        return <span aria-hidden="true" style={{ width: size, height: h, flex: 'none', borderRadius: 3, background: '#d9dee6', color: '#3f4752', fontSize: Math.round(h * 0.6), fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{String(code).slice(0, 2).toUpperCase()}</span>;
    }
    return <img src={url} alt="" width={size} height={h} style={{ flex: 'none', borderRadius: 3, objectFit: 'cover', boxShadow: '0 0 0 1px rgba(0,0,0,0.12)' }} />;
}

/** langs — коды языков; value — текущий; onPick(code). */
export default function LangPicker({ value, langs, onPick, style }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const sorted = [...langs].sort((a, b) => langName(a).localeCompare(langName(b), 'en'));
    const shown = q.trim() ? sorted.filter(c => `${langName(c)} ${c}`.toLowerCase().includes(q.trim().toLowerCase())) : sorted;
    const pick = (c) => { setOpen(false); setQ(''); onPick(c); };

    return (
        <>
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '9px 14px', borderRadius: '10px', border: '1px solid #cfc4ba', background: '#fff', color: '#3f3530', fontSize: '17px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', ...style }}>
                <LangFlag code={value} />
                <span dir={dirOf(value)}>{langName(value)}</span>
                <span aria-hidden="true" style={{ fontSize: '12px', opacity: 0.6 }}>▼</span>
            </button>
            {open && (
                <div role="dialog" aria-modal="true" onClick={() => setOpen(false)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(20, 24, 32, 0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                    <div onClick={e => e.stopPropagation()}
                        style={{ background: '#fff', borderRadius: '14px', padding: '18px', width: '100%', maxWidth: '640px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            {sorted.length > 9 && (
                                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍"
                                    style={{ flex: 1, padding: '10px 12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cfc4ba', minWidth: 0 }} />
                            )}
                            <button type="button" onClick={() => setOpen(false)} aria-label="×"
                                style={{ marginInlineStart: 'auto', width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: '#f1ece7', fontSize: '20px', cursor: 'pointer' }}>×</button>
                        </div>
                        <div style={{ overflowY: 'auto', display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                            {shown.map(c => (
                                <button key={c} type="button" onClick={() => pick(c)} aria-pressed={c === value}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '10px', cursor: 'pointer', fontSize: '16px', fontFamily: 'inherit', textAlign: 'start',
                                        border: c === value ? '2px solid var(--brand-button, #1f3a5f)' : '1px solid #e2ddd8', background: c === value ? '#eef2f7' : '#fff', color: '#2b2320' }}>
                                    <LangFlag code={c} size={28} />
                                    <span dir={dirOf(c)} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{langName(c)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
