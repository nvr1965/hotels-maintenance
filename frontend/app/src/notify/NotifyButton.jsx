// Кнопка уведомлений в шапке исполнителя и начальника.
// Не включены — заметная кнопка «🔔 Включить уведомления» (разрешение можно спросить только по нажатию).
// Включены — у начальника круглая кнопка звука 🔔/🔕, у исполнителя ничего (звук у него всегда).
import { useEffect, useState } from 'react';
import { pushState, enablePush, readSilent, setPushSilent } from './push';
import { getBrand } from '../brand';
import { uiText, dirOf } from '../i18n';


const round = {
    width: '34px', height: '34px', flex: 'none', padding: 0, borderRadius: '50%', border: '1px solid rgba(249,237,211,0.25)',
    background: 'transparent', color: '#e3d5bd', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '17px', lineHeight: 1
};

const Bell = ({ off }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        {off && <path d="M3 3l18 18" />}
    </svg>
);

export default function NotifyButton({ lang = 'en', role }) {
    // В подсказках — название приложения на телефоне (имя отеля)
    const appName = getBrand().hotel?.name || 'Hotel';
    const base = uiText('notify', lang);
    const text = { ...base, denied: base.denied.replaceAll('{app}', appName), install: base.install.replaceAll('{app}', appName) };
    const dir = dirOf(lang);
    const [state, setState] = useState(null);
    const [silent, setSilent] = useState(() => readSilent(role));
    const [busy, setBusy] = useState(false);
    const [hint, setHint] = useState(null);

    useEffect(() => {
        let alive = true;
        pushState().then((s) => { if (alive) setState(s); });
        return () => { alive = false; };
    }, []);

    if (!state || state === 'unsupported') return null;

    const turnOn = async () => {
        setBusy(true);
        try {
            const s = await enablePush(role);
            setState(s);
            if (s === 'denied') setHint(text.denied);
        } catch (e) {
            console.warn(e);
            setHint(text.failed);
        } finally {
            setBusy(false);
        }
    };

    const toggleSound = async () => {
        const next = !silent;
        setSilent(next);
        await setPushSilent(role, next);
    };

    let button = null;
    if (state === 'off') {
        button = (
            <button type="button" onClick={turnOn} disabled={busy}
                style={{ minHeight: '34px', padding: '6px 12px', borderRadius: '17px', border: 'none', background: '#d63c3c', color: '#fff', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {text.enable}
            </button>
        );
    } else if (state === 'need_install' || state === 'denied') {
        button = (
            <button type="button" onClick={() => setHint(state === 'denied' ? text.denied : text.install)}
                title={state === 'denied' ? text.denied : text.install} style={{ ...round, opacity: 0.8 }}>
                <Bell off />
            </button>
        );
    } else if (state === 'on' && role === 'head') {
        button = (
            <button type="button" onClick={toggleSound} title={silent ? text.sound_off : text.sound_on}
                aria-label={silent ? text.sound_off : text.sound_on} style={round}>
                <Bell off={silent} />
            </button>
        );
    }

    return (
        <>
            {button}
            {hint && (
                <div onClick={() => setHint(null)}
                    style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(30,18,18,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                    <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
                        style={{ direction: dir, background: '#fff', borderRadius: '14px', padding: '22px 20px 18px', width: '100%', maxWidth: '360px', boxShadow: '0 10px 30px rgba(0,0,0,0.25)', textAlign: 'center' }}>
                        <div style={{ fontSize: '16px', color: '#3f3530', lineHeight: 1.5, marginBottom: '18px' }}>{hint}</div>
                        <button type="button" autoFocus onClick={() => setHint(null)}
                            style={{ width: '100%', minHeight: '44px', borderRadius: '10px', border: 'none', background: 'var(--brand-primary, #371f20)', color: 'var(--brand-text, #f9edd3)', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' }}>
                            {text.ok}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
