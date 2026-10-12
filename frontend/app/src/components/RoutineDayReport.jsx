import { useEffect, useState } from 'react';
import { fmtYmd } from './ReportDateFilter';

// Отчёт руководителя по регламентным работам за день или диапазон дат (get_routine_log_report.php):
// по каждому дню — что выполнено, кем, во сколько, примечания, фото, показания счётчиков.

const T = {
    ru: { loading: 'Загрузка...', no_data: 'Нет данных за период', error: 'Не удалось загрузить отчёт', done: 'Выполнено', of: 'из',
          not_done: 'Не выполнено', pending: '⏳ фото ждёт администратора', repeat: 'повтор', total: 'Итого за период',
          only_missed: 'Только невыполненные', close: 'Закрыть' },
    en: { loading: 'Loading...', no_data: 'No data for this period', error: 'Could not load the report', done: 'Done', of: 'of',
          not_done: 'Not done', pending: '⏳ photo waiting for admin', repeat: 'repeat', total: 'Period total',
          only_missed: 'Only not done', close: 'Close' },
    he: { loading: 'טוען...', no_data: 'אין נתונים לתקופה זו', error: 'לא ניתן לטעון את הדוח', done: 'בוצע', of: 'מתוך',
          not_done: 'לא בוצע', pending: '⏳ התמונה ממתינה למנהל', repeat: 'חזרה', total: 'סה״כ לתקופה',
          only_missed: 'רק מה שלא בוצע', close: 'סגור' },
    ar: { loading: 'جارٍ التحميل...', no_data: 'لا توجد بيانات لهذه الفترة', error: 'تعذّر تحميل التقرير', done: 'منجز', of: 'من',
          not_done: 'لم يُنجز', pending: '⏳ الصورة بانتظار المسؤول', repeat: 'تكرار', total: 'إجمالي الفترة',
          only_missed: 'غير المنجز فقط', close: 'إغلاق' },
};

const weekday = (ymd, lang) => new Date(ymd + 'T12:00:00Z').toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang, { weekday: 'short', timeZone: 'UTC' });

export default function RoutineDayReport({ lang = 'ru', value }) {
    const t = T[lang] || T.ru;
    const dir = ['he', 'ar'].includes(lang) ? 'rtl' : 'ltr';
    const [state, setState] = useState({ loading: true, data: null, error: null });
    const [openDays, setOpenDays] = useState(() => new Set());
    const [onlyMissed, setOnlyMissed] = useState(false);
    const [photo, setPhoto] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setState(s => ({ ...s, loading: true, error: null }));
        const params = new URLSearchParams({ from: value.from, to: value.to, lang });
        fetch(`/backend/api/get_routine_log_report.php?${params}`)
            .then(r => r.json())
            .then(data => {
                if (cancelled) return;
                if (data.success) {
                    setState({ loading: false, data, error: null });
                    setOpenDays(new Set(data.days.length ? [data.days[0].date] : [])); // самый свежий день раскрыт
                } else setState({ loading: false, data: null, error: 'error' });
            })
            .catch(() => !cancelled && setState({ loading: false, data: null, error: 'network' }));
        return () => { cancelled = true; };
    }, [value.from, value.to, lang]);

    if (state.loading && !state.data) return <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a' }}>{t.loading}</div>;
    if (state.error) return <div style={{ textAlign: 'center', padding: '30px', color: '#c43d3d' }}>{t.error}</div>;
    const days = state.data?.days || [];
    if (days.length === 0 || days[0].total === 0) return <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a', fontStyle: 'italic' }}>{t.no_data}</div>;

    const multi = days.length > 1;
    const toggleDay = (d) => setOpenDays(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });
    const tot = state.data.totals;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'start', opacity: state.loading ? 0.5 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {multi ? (
                    <b style={{ fontSize: '15px', color: tot.done === tot.total ? '#1f7a4f' : '#3f3530' }}>{t.total}: {tot.done} / {tot.total}</b>
                ) : <span />}
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '15px', color: '#5a4f48', cursor: 'pointer' }}>
                    <input type="checkbox" checked={onlyMissed} onChange={e => setOnlyMissed(e.target.checked)} style={{ width: '17px', height: '17px', accentColor: 'var(--brand-button, #844128)' }} />
                    {t.only_missed}
                </label>
            </div>

            {days.map(day => {
                const open = !multi || openDays.has(day.date);
                const allDone = day.done === day.total;
                const items = onlyMissed ? day.items.filter(i => !i.done) : day.items;
                return (
                    <div key={day.date} style={{ borderRadius: '12px', border: '1px solid #ece4dd', background: '#fff', overflow: 'hidden' }}>
                        <div onClick={() => multi && toggleDay(day.date)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '12px 14px', background: '#fcf9f6', cursor: multi ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '16px', color: '#2b2320' }}>
                                {multi && <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', color: '#7d726a', fontSize: '14px' }}>{dir === 'rtl' ? '◂' : '▸'}</span>}
                                {fmtYmd(day.date, lang)} <span style={{ fontWeight: 'normal', color: '#7d726a' }}>{weekday(day.date, lang)}</span>
                            </span>
                            <span style={{ fontSize: '14px', fontWeight: 'bold', padding: '3px 10px', borderRadius: '20px', background: allDone ? '#dcfce7' : '#fef3c7', color: allDone ? '#1f7a4f' : '#b45309', whiteSpace: 'nowrap' }}>
                                {t.done}: {day.done} {t.of} {day.total}
                            </span>
                        </div>
                        {open && (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {items.map(it => (
                                    <div key={it.task_id} style={{ display: 'flex', gap: '10px', padding: '10px 14px', borderTop: '1px solid #f3ebe2' }}>
                                        <span style={{ width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 'bold', background: it.done ? '#26875a' : '#fff', color: '#fff', border: it.done ? 'none' : '2px solid #e0b4a4', marginTop: '1px' }}>
                                            {it.done ? '✓' : ''}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                                                <b style={{ fontSize: '16px', color: it.done ? '#2b2320' : '#8a5a48' }}>{it.requires_ocr ? '📟 ' : ''}{it.name}</b>
                                                {!it.done && <span style={{ fontSize: '14px', color: '#b4532a', fontWeight: 'bold' }}>{t.not_done}</span>}
                                                {it.done && it.value && !it.runs.some(r => r.value) && <span style={{ fontSize: '15px', color: '#7a5a30', fontWeight: 'bold' }}>{it.value} {it.unit || ''}</span>}
                                            </div>
                                            {it.runs.map((r, i) => (
                                                <div key={i} style={{ marginTop: '5px', fontSize: '14px', color: '#5a4f48' }}>
                                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                        {r.time && <span>🕒 {r.time}</span>}
                                                        {r.worker && <span>👤 {r.worker}</span>}
                                                        {r.repeat && <span style={{ color: 'var(--brand-button, #844128)' }}>🔁 {t.repeat}</span>}
                                                        {it.requires_ocr && r.value && <span style={{ color: '#7a5a30' }}>📟 {r.value} {r.unit || ''}</span>}
                                                        {r.pending && <span style={{ color: '#b45309' }}>{t.pending}</span>}
                                                    </div>
                                                    {r.notes && <div style={{ marginTop: '2px', color: '#3f3530' }}>📝 {r.notes}</div>}
                                                    {r.media.length > 0 && (
                                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '5px' }}>
                                                            {r.media.map((m, j) => m.type === 'video' ? (
                                                                <a key={j} href={m.url} target="_blank" rel="noreferrer" style={{ width: '56px', height: '56px', borderRadius: '8px', background: 'var(--brand-primary, #371f20)', color: 'var(--brand-text, #f9edd3)', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontSize: '20px' }}>▶</a>
                                                            ) : (
                                                                <img key={j} src={m.url} alt="" loading="lazy" onClick={() => setPhoto(m.url)}
                                                                    style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #ece4dd', cursor: 'zoom-in' }} />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {photo && (
                <div onClick={() => setPhoto(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,12,10,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', cursor: 'zoom-out' }}>
                    <img src={photo} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '10px' }} />
                    <button type="button" onClick={() => setPhoto(null)} style={{ position: 'absolute', top: 'max(14px, env(safe-area-inset-top))', insetInlineEnd: '14px', padding: '8px 14px', borderRadius: '8px', border: 'none', background: 'var(--brand-text, #f9edd3)', color: 'var(--brand-primary, #371f20)', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}>{t.close}</button>
                </div>
            )}
        </div>
    );
}
