import { useState } from 'react';
import { uiText, localeOf } from '../i18n';
import { getBrand } from '../brand';
import './head/head.css';

// Выбор даты для отчётов руководителя: «Сегодня» | «Вчера» | «Дата» (один день) | «Период» (с … по …).
// value = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }; onChange вызывается с новым value, когда даты выбраны полностью.


// «Сегодня» — по времени отеля
// Сегодня по часам отеля (его часовой пояс из настроек)
export const hotelToday = () => new Date().toLocaleDateString('en-CA', { timeZone: getBrand().hotel?.timezone || 'UTC' });
export const shiftDate = (ymd, days) => {
    const d = new Date(ymd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
export const fmtYmd = (ymd, lang) => {
    if (!ymd) return '';
    const d = new Date(ymd + 'T12:00:00Z');
    return d.toLocaleDateString(localeOf(lang), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
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

// Две строки: «Сегодня» «Вчера» (+ дополнительные кнопки, children) / «Дата» «Период».
// accent оставлен для совместимости, оформление общее (бежевая активная кнопка).
export default function ReportDateFilter({ lang = 'en', value, onChange, accent, children }) { // eslint-disable-line no-unused-vars
    const t = uiText('date_filter', lang);
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
        <button key={m} type="button" className={'hd-chp' + (mode === m ? ' on' : '')} aria-pressed={mode === m} onClick={() => pick(m)}>
            {label}
        </button>
    );

    const rangeOk = draft.from && draft.to && draft.from <= draft.to;
    const caption = value.from === value.to ? fmtYmd(value.from, lang) : `${fmtYmd(value.from, lang)} — ${fmtYmd(value.to, lang)}`;

    return (
        <div className="hd hd-filter">
            <div className="hd-chips one">
                {chip('today', t.today)}
                {chip('yesterday', t.yesterday)}
                {chip('day', t.day)}
                {chip('range', t.range)}
                {children}
            </div>

            {mode === 'day' && (
                <input type="date" className="hd-fld hd-one" value={value.from} max={today}
                    onChange={e => e.target.value && onChange({ from: e.target.value, to: e.target.value })} />
            )}

            {mode === 'range' && (<>
                <div className="hd-row2">
                    <label>{t.from}
                        <input type="date" className="hd-fld" value={draft.from} max={today} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} />
                    </label>
                    <label>{t.to}
                        <input type="date" className="hd-fld" value={draft.to} max={today} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} />
                    </label>
                </div>
                <div><button type="button" className="hd-btn blue" disabled={!rangeOk} onClick={() => onChange({ ...draft })}>{t.show}</button></div>
            </>)}

            <div className="hd-hint">{t.for_}: <b><bdi>{caption}</bdi></b></div>
        </div>
    );
}
