import { BrandEmblem } from '../components/BrandLogo';
import MeterReport from '../components/MeterReport';
import { useEffect } from 'react';
import { useHotel, setBrand, hotelTitle } from '../brand';

// Отдельная страница для начальника по ссылке /react/?meters=КЛЮЧ&lang=he:
// без входа, без меню — сразу отчёт по счётчикам. Ключ создаёт сисадмин в «📷 Счётчики».

const TITLE = { ru: 'Отчёт по счётчикам', en: 'Meter report', he: 'דוח מונים', ar: 'تقرير العدادات' };

export default function MeterBossPage({ accessKey, lang }) {
    const rtl = lang === 'he' || lang === 'ar';
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    const hotel = useHotel();
    const hotelName = hotelTitle(hotel, lang);
    document.title = TITLE[lang] + (hotelName ? ' · ' + hotelName : '');

    // Оформление и название отеля, которому принадлежит ссылка
    useEffect(() => {
        fetch(`/backend/api/branding.php?meters=${encodeURIComponent(accessKey)}`, { cache: 'no-store' })
            .then(r => r.json()).then(d => { if (d.success) setBrand({ hotel: d.hotel }); }).catch(() => {});
    }, [accessKey]);

    return (
        <div className="rm-page" dir={rtl ? 'rtl' : 'ltr'} style={{
            maxWidth: '640px', margin: '0 auto', boxSizing: 'border-box', minHeight: '100vh', background: '#f3ebe2',
            paddingLeft: 'max(12px, env(safe-area-inset-left))', paddingRight: 'max(12px, env(safe-area-inset-right))',
            paddingTop: 'max(14px, env(safe-area-inset-top))', paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
        }}>
            <style>{`
                .rm-page input { border-radius: 10px !important; }
                .rm-card-grid { display: flex; flex-direction: column; gap: 12px; }
                @media (min-width: 860px) {
                    .rm-page { max-width: 1200px !important; padding-left: 24px !important; padding-right: 24px !important; }
                    .rm-card-grid { display: grid !important; grid-template-columns: repeat(2, 1fr); gap: 14px; align-items: start; }
                }
                @media (min-width: 1280px) { .rm-page { max-width: 1440px !important; } }
            `}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--brand-primary, #371f20)', padding: '14px 16px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(55,31,32,0.25)' }}>
                <BrandEmblem size={44} />
                <div>
                    <h1 style={{ margin: 0, color: 'var(--brand-text, #f9edd3)', fontSize: 'clamp(20px, 5.5vw, 24px)' }}>{TITLE[lang]}</h1>
                    <span style={{ fontSize: '15px', color: 'var(--brand-accent, #cdaa7c)' }}>{hotelName}</span>
                </div>
            </div>
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginTop: '12px', boxShadow: '0 1px 4px rgba(55,31,32,0.08)' }}>
                <MeterReport lang={lang} accessKey={accessKey} />
            </div>
        </div>
    );
}
