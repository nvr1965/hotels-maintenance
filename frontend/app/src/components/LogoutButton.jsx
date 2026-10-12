// Вопрос «Вы действительно хотите покинуть приложение?» для пункта «Выйти» в меню ☰ (AppMenu).
// Выход только после «Выйти» в окне; «Отмена», нажатие на фон или Esc — остаёмся.
import { useEffect } from 'react';
import { BRAND } from './BrandLogo';

const ui = {
    ru: { title: 'Выйти', question: 'Вы действительно хотите покинуть приложение?', yes: 'Выйти', no: 'Отмена' },
    en: { title: 'Log out', question: 'Do you really want to leave the app?', yes: 'Log out', no: 'Cancel' },
    he: { title: 'יציאה', question: 'האם אתה בטוח שברצונך לצאת מהאפליקציה?', yes: 'יציאה', no: 'ביטול' },
    ar: { title: 'خروج', question: 'هل تريد حقاً مغادرة التطبيق؟', yes: 'خروج', no: 'إلغاء' }
};

export const logoutText = (lang) => ui[lang] || ui.ru;

// Окно «Вы действительно хотите покинуть приложение?»
export function LogoutConfirm({ lang = 'ru', onCancel, onConfirm }) {
    const text = logoutText(lang);
    const dir = lang === 'he' || lang === 'ar' ? 'rtl' : 'ltr';

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    return (
        <div
            onClick={onCancel}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(30,18,18,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
        >
            <div
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                style={{ direction: dir, background: '#fff', borderRadius: '14px', padding: '22px 20px 18px', width: '100%', maxWidth: '340px', boxShadow: '0 10px 30px rgba(0,0,0,0.25)', textAlign: 'center' }}
            >
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: BRAND.dark, lineHeight: 1.4, marginBottom: '20px' }}>{text.question}</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        autoFocus
                        onClick={onCancel}
                        style={{ flex: 1, minHeight: '44px', borderRadius: '10px', border: 'none', background: '#f3ebe2', color: '#3f3530', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' }}
                    >
                        {text.no}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        style={{ flex: 1, minHeight: '44px', borderRadius: '10px', border: 'none', background: BRAND.dark, color: BRAND.cream, fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' }}
                    >
                        {text.yes}
                    </button>
                </div>
            </div>
        </div>
    );
}
