// Кнопка ☰ в шапке: за ней спрятаны выбор языка и выход, чтобы их не нажимали случайно.
// Выход по-прежнему спрашивает «Вы действительно хотите покинуть приложение?».
// Если у человека несколько отелей, здесь же переключение между ними.
import { useEffect, useState } from 'react';
import { LogoutConfirm, logoutText } from './LogoutButton';
import { useBrand, switchHotel } from '../brand';
import { uiText, dirOf, languageList, langName } from '../i18n';
import { LangFlag } from './LangPicker';



const itemStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minHeight: '44px', padding: '8px 14px',
    border: 'none', borderRadius: '8px', background: active ? '#f3ebe2' : 'transparent', color: '#3f3530',
    fontSize: '16px', fontWeight: active ? 'bold' : 'normal', cursor: 'pointer', textAlign: 'start'
});

export default function AppMenu({ lang = 'en', onChangeLang, onLogout }) {
    const text = uiText('menu', lang);
    const dir = dirOf(lang);
    const [open, setOpen] = useState(false);
    const [asking, setAsking] = useState(false);
    const brand = useBrand();
    const hotels = brand.hotels || [];
    const currentId = brand.hotel?.id;
    // Языки отеля (с названиями на самих языках); текущий язык показываем, даже если его нет в отеле
    const info = brand.hotel?.language_info?.length ? brand.hotel.language_info : languageList();
    const langs = info.map(l => ({ code: l.code, name: l.name })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    if (!langs.some(l => l.code === lang)) langs.push({ code: lang, name: langName(lang) });

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const pickLang = (code) => {
        setOpen(false);
        if (code !== lang && onChangeLang) onChangeLang(code);
    };

    return (
        <div style={{ position: 'relative', flex: 'none' }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                title={text.menu}
                aria-label={text.menu}
                aria-expanded={open}
                style={{ width: '38px', height: '38px', padding: 0, borderRadius: '50%', border: '1px solid rgba(249,237,211,0.25)', background: open ? 'rgba(249,237,211,0.15)' : 'transparent', color: '#e3d5bd', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
                </svg>
            </button>

            {open && (
                <>
                    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                    <div
                        role="menu"
                        style={{ direction: dir, position: 'absolute', top: '46px', insetInlineEnd: 0, zIndex: 1000, width: '240px', maxHeight: '75vh', overflowY: 'auto', background: '#fff', borderRadius: '12px', padding: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}
                    >
                        {hotels.length > 1 && (
                            <>
                                <div style={{ padding: '4px 14px 6px', fontSize: '13px', color: '#8a7a6e', fontWeight: 'bold' }}>{text.hotel}</div>
                                {hotels.map(h => (
                                    <button key={h.id} type="button" role="menuitemradio" aria-checked={h.id === currentId}
                                        onClick={() => { setOpen(false); if (h.id !== currentId) switchHotel(h.id); }} style={itemStyle(h.id === currentId)}>
                                        <span style={{ width: '18px', color: 'var(--brand-button, #844128)' }}>{h.id === currentId ? '✓' : ''}</span>
                                        <span dir="auto">{h.name}</span>
                                    </button>
                                ))}
                                <div style={{ height: '1px', background: '#eee3d8', margin: '6px 4px' }} />
                            </>
                        )}
                        <div style={{ padding: '4px 14px 6px', fontSize: '13px', color: '#8a7a6e', fontWeight: 'bold' }}>{text.lang}</div>
                        {langs.map(l => (
                            <button key={l.code} type="button" role="menuitemradio" aria-checked={l.code === lang} onClick={() => pickLang(l.code)} style={itemStyle(l.code === lang)}>
                                <span style={{ width: '18px', color: 'var(--brand-button, #844128)' }}>{l.code === lang ? '✓' : ''}</span>
                                <LangFlag code={l.code} size={20} />
                                <span dir="auto">{l.name}</span>
                            </button>
                        ))}
                        {onLogout && (
                            <>
                                <div style={{ height: '1px', background: '#eee3d8', margin: '6px 4px' }} />
                                <button type="button" role="menuitem" onClick={() => { setOpen(false); setAsking(true); }} style={{ ...itemStyle(false), color: '#a3301c', fontWeight: 'bold' }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                                        <path d="M12 3v8" /><path d="M6.3 7.3a8 8 0 1 0 11.4 0" />
                                    </svg>
                                    {logoutText(lang).title}
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            {asking && <LogoutConfirm lang={lang} onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); onLogout(); }} />}
        </div>
    );
}
