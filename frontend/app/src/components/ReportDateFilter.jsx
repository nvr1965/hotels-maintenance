import { useState } from 'react';

// Выбор даты для отчётов руководителя: «Сегодня» | «Вчера» | «Дата» (один день) | «Период» (с … по …).
// value = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }; onChange вызывается с новым value, когда даты выбраны полностью.

const T = {
    ru: { today: 'Сегодня', yesterday: 'Вчера', day: 'Дата', range: 'Период', from: 'С', to: 'По', show: 'Показать', for_: 'За' },
    en: { today: 'Today', yesterday: 'Yesterday', day: 'Date', range: 'Period', from: 'From', to: 'To', show: 'Show', for_: 'For' },
    he: { today: 'היום', yesterday: 'אתמול', day: 'תאריך', range: 'תקופה', from: 'מ-', to: 'עד', show: 'הצג', for_: 'עבור' },
    ar: { today: 'اليوم', yesterday: 'أمس', day: 'تاريخ', range: 'فترة', from: 'من', to: 'إلى', show: 'عرض', for_: 'عن' },
};

// «Сегодня» — по времени отеля
export const hotelToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
export const shiftDate = (ymd, days) => {
    const d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
export const fmtYmd = (ymd, lang) => {
    if (!ymd) return '';
    const d = new Date(ymd + 'T12:00:00Z');
    return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
};

const modeOf = (v) => {
    const today = hotelToday();
    if (v.from === v.to) {
        if (v.from === today) return 'today';
        if (v.from === shiftDate(today, -1)) return 'yesterday';
        return 'day';
    }
    return 'range';
};

const inputStyle = { display: 'block', padding: '8px', borderRadius: '8px', border: '1px solid #d9cec5', fontSize: '15px', background: '#fff', color: '#2b2320' };

export default function ReportDateFilter({ lang = 'ru', value, onChange, accent = '#844128', children }) {
    const t = T[lang] || T.ru;
    const [mode, setMode] = useState(() => modeOf(value));
    const [draft, setDraft] = useState(value); // черновик периода, пока не нажали «Показать»
    const today = hotelToday();

    const pick = (m) => {
        setMode(m);
        if (m === 'today') onChange({ from: today, to: today });
        else if (m === 'yesterday') { const y = shiftDate(today, -1); onChange({ from: y, to: y }); }
        else if (m === 'day') { /* ждём выбора даты; по умолчанию — текущий день отчёта */ }
        else if (m === 'range') setDraft(value.from === value.to ? { from: shiftDate(value.to, -6), to: value.to } : value);
    };

    const chip = (m, label) => (
        <button key={m} type="button" onClick={() => pick(m)}
            style={{
                minHeight: '38px', padding: '7px 13px', borderRadius: '9px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px',
                border: mode === m ? `2px solid ${accent}` : '1px solid #e2d8cf', background: mode === m ? accent : '#fff',
                color: mode === m ? '#fff' : '#3f3530', WebkitTapHighlightColor: 'transparent'
            }}>
            {label}
        </button>
    );

    const rangeOk = draft.from && draft.to && draft.from <= draft.to;
    const caption = value.from === value.to ? fmtYmd(value.from, lang) : `${fmtYmd(value.from, lang)} — ${fmtYmd(value.to, lang)}`;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'start' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                {chip('today', t.today)}
                {chip('yesterday', t.yesterday)}
                {chip('day', t.day)}
                {chip('range', t.range)}
                {children}
            </div>

            {mode === 'day' && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <input type="date" value={value.from} max={today}
                        onChange={e => e.target.value && onChange({ from: e.target.value, to: e.target.value })}
                        style={inputStyle} />
                </div>
            )}

            {mode === 'range' && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '14px', color: '#6e635b' }}>{t.from}
                        <input type="date" value={draft.from} max={today} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} style={inputStyle} />
                    </label>
                    <label style={{ fontSize: '14px', color: '#6e635b' }}>{t.to}
                        <input type="date" value={draft.to} max={today} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} style={inputStyle} />
                    </label>
                    <button type="button" disabled={!rangeOk} onClick={() => onChange({ ...draft })}
                        style={{ minHeight: '38px', padding: '8px 16px', background: rangeOk ? accent : '#cbbfb5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: rangeOk ? 'pointer' : 'default', fontSize: '15px' }}>
                        {t.show}
                    </button>
                </div>
            )}

            <div style={{ fontSize: '15px', color: '#6e635b' }}>📅 {t.for_}: <b style={{ color: '#2b2320' }}>{caption}</b></div>
        </div>
    );
}
