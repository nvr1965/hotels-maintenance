import { BrandEmblem } from '../components/BrandLogo';
import MeterReport from '../components/MeterReport';
import { useEffect } from 'react';
import { useHotel, setBrand, hotelTitle } from '../brand';
import { isRtl, uiText, loadUi, useUi } from '../i18n';
import '../components/head/head.css';

// Отдельная страница для начальника по ссылке /react/?meters=КЛЮЧ&lang=xx:
// без входа, без меню — сразу отчёт по счётчикам. Ключ создаёт сисадмин в «📷 Счётчики».

export default function MeterBossPage({ accessKey, lang }) {
    useUi();
    useEffect(() => { loadUi(lang); }, [lang]);
    const title = uiText('boss', lang).title;
    const rtl = isRtl(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    const hotel = useHotel();
    const hotelName = hotelTitle(hotel, lang);
    document.title = title + (hotelName ? ' · ' + hotelName : '');

    // Оформление и название отеля, которому принадлежит ссылка
    useEffect(() => {
        fetch(`/backend/api/branding.php?meters=${encodeURIComponent(accessKey)}`, { cache: 'no-store' })
            .then(r => r.json()).then(d => { if (d.success) setBrand({ hotel: d.hotel }); }).catch(() => {});
    }, [accessKey]);

    return (
        <div className="hd hd-page" dir={rtl ? 'rtl' : 'ltr'} lang={lang}>
            <div className="hd-pagehdr">
                <BrandEmblem size={42} />
                <div>
                    <h1>{title}</h1>
                    <span>{hotelName}</span>
                </div>
            </div>
            <MeterReport lang={lang} accessKey={accessKey} />
        </div>
    );
}
