// Логотип текущего отеля (настройки отеля: logo_url, название, подпись, цвета).
// BrandEmblem — только знак (картинка логотипа или круг с первой буквой), BrandLogo — знак + название.
import { useHotel } from '../brand';

// Цвета по умолчанию, пока настройки отеля не пришли; на экранах используются CSS-переменные --brand-*
export const BRAND = {
    dark: 'var(--brand-primary, #1f3a5f)',
    cream: 'var(--brand-text, #ffffff)',
    gold: 'var(--brand-accent, #c9a96e)',
    rust: 'var(--brand-button, #1f3a5f)',
    bg: '#f7f1eb'
};

const SERIF = "'Cinzel', 'Trajan Pro', Georgia, 'Times New Roman', serif";

// light — для светлого фона: тёмный круг со светлой буквой
export function BrandEmblem({ size = 40, light = false, style }) {
    const hotel = useHotel();
    const logo = hotel?.brand?.logo_url;
    if (logo) {
        return <img src={logo} alt="" width={size} height={size} style={{ flex: 'none', display: 'block', objectFit: 'contain', borderRadius: '50%', ...style }} />;
    }
    const letter = (hotel?.name || 'H').trim().charAt(0).toUpperCase();
    return (
        <div aria-hidden="true" style={{
            flex: 'none', width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: light ? BRAND.dark : BRAND.cream, color: light ? BRAND.cream : BRAND.dark,
            fontFamily: SERIF, fontWeight: 'bold', fontSize: Math.round(size * 0.55), lineHeight: 1, ...style
        }}>{letter}</div>
    );
}

// color — цвет надписи: светлый на тёмном фоне, тёмный на светлом
export function BrandLogo({ size = 56, color = BRAND.cream, style }) {
    const hotel = useHotel();
    const name = hotel?.name || '';
    const sub = hotel?.brand?.subtitle;
    // «Ramada Olivié Nazareth» + подпись «OLIVIÉ NAZARETH» → крупно «RAMADA», подпись ниже
    const main = sub && name.toUpperCase().endsWith(sub.toUpperCase()) ? name.slice(0, name.length - sub.length).trim() : name;
    return (
        <div dir="auto" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(size * 0.12), color, ...style }}>
            <BrandEmblem size={size} light={color !== BRAND.cream} />
            {main && <div style={{ fontFamily: SERIF, fontSize: Math.round(size * (main.length > 14 ? 0.4 : 0.55)), letterSpacing: '0.08em', lineHeight: 1.1, textAlign: 'center', textTransform: 'uppercase' }}>{main}</div>}
            {sub && <div style={{ fontFamily: SERIF, fontSize: Math.round(size * 0.26), letterSpacing: '0.18em', lineHeight: 1, textAlign: 'center' }}>{sub}</div>}
        </div>
    );
}
