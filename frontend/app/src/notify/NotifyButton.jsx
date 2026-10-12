// Кнопка уведомлений в шапке исполнителя и начальника.
// Не включены — заметная кнопка «🔔 Включить уведомления» (разрешение можно спросить только по нажатию).
// Включены — у начальника круглая кнопка звука 🔔/🔕, у исполнителя ничего (звук у него всегда).
import { useEffect, useState } from 'react';
import { pushState, enablePush, readSilent, setPushSilent } from './push';
import { getBrand } from '../brand';

const ui = {
    ru: {
        enable: '🔔 Включить уведомления',
        sound_on: 'Звук уведомлений включён. Нажмите, чтобы выключить',
        sound_off: 'Уведомления приходят без звука. Нажмите, чтобы включить звук',
        denied: 'Уведомления запрещены для этого приложения. Разрешите их в настройках телефона: Настройки → Уведомления → {app} (или Chrome → Настройки сайта → Уведомления).',
        install: 'На iPhone уведомления работают только в приложении с экрана «Домой»: в Safari или Chrome нажмите «Поделиться» (квадрат со стрелкой) → «На экран „Домой“» и откройте {app} оттуда.',
        failed: 'Не удалось включить уведомления. Проверьте связь и попробуйте ещё раз.',
        ok: 'Готово'
    },
    en: {
        enable: '🔔 Turn on notifications',
        sound_on: 'Notification sound is on. Tap to mute',
        sound_off: 'Notifications are silent. Tap to turn sound on',
        denied: 'Notifications are blocked for this app. Allow them in the phone settings: Settings → Notifications → {app} (or Chrome → Site settings → Notifications).',
        install: 'On iPhone notifications only work in the app added to the Home Screen: in Safari or Chrome tap Share → Add to Home Screen and open {app} from there.',
        failed: 'Could not turn on notifications. Check the connection and try again.',
        ok: 'OK'
    },
    he: {
        enable: '🔔 הפעל התראות',
        sound_on: 'צליל ההתראות פועל. הקש כדי להשתיק',
        sound_off: 'ההתראות מגיעות ללא צליל. הקש כדי להפעיל צליל',
        denied: 'ההתראות חסומות עבור האפליקציה. אפשר אותן בהגדרות הטלפון: הגדרות → התראות → {app} (או Chrome → הגדרות אתר → התראות).',
        install: 'באייפון התראות עובדות רק באפליקציה שנוספה למסך הבית: ב-Safari או ב-Chrome הקש שיתוף → הוסף למסך הבית ופתח את {app} משם.',
        failed: 'לא ניתן להפעיל התראות. בדוק את החיבור ונסה שוב.',
        ok: 'אישור'
    },
    ar: {
        enable: '🔔 تفعيل الإشعارات',
        sound_on: 'صوت الإشعارات مفعّل. اضغط لكتمه',
        sound_off: 'الإشعارات تصل بدون صوت. اضغط لتفعيل الصوت',
        denied: 'الإشعارات محظورة لهذا التطبيق. اسمح بها في إعدادات الهاتف: الإعدادات ← الإشعارات ← {app} (أو Chrome ← إعدادات الموقع ← الإشعارات).',
        install: 'على iPhone تعمل الإشعارات فقط في التطبيق المضاف إلى الشاشة الرئيسية: في Safari أو Chrome اضغط مشاركة ← إضافة إلى الشاشة الرئيسية وافتح {app} من هناك.',
        failed: 'تعذّر تفعيل الإشعارات. تحقق من الاتصال وحاول مرة أخرى.',
        ok: 'حسناً'
    }
};

const round = {
    width: '34px', height: '34px', flex: 'none', padding: 0, borderRadius: '50%', border: '1px solid rgba(249,237,211,0.25)',
    background: 'transparent', color: '#e3d5bd', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '17px', lineHeight: 1
};

export default function NotifyButton({ lang = 'ru', role }) {
    // В подсказках — название приложения на телефоне (имя отеля)
    const appName = getBrand().hotel?.name || 'Hotel';
    const base = ui[lang] || ui.ru;
    const text = { ...base, denied: base.denied.replaceAll('{app}', appName), install: base.install.replaceAll('{app}', appName) };
    const dir = lang === 'he' || lang === 'ar' ? 'rtl' : 'ltr';
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
                🔕
            </button>
        );
    } else if (state === 'on' && role === 'head') {
        button = (
            <button type="button" onClick={toggleSound} title={silent ? text.sound_off : text.sound_on}
                aria-label={silent ? text.sound_off : text.sound_on} style={round}>
                {silent ? '🔕' : '🔔'}
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
