import { useEffect, useState } from 'react';
import { fmtYmd } from './ReportDateFilter';
import { uiText, localeOf } from '../i18n';
import { Icon, Thumbs } from './head/HeadKit';
import { PhotoViewer } from './work/WorkTiles';

// Отчёт руководителя по регламентным работам за день или диапазон дат (get_routine_log_report.php):
// по каждому дню — что выполнено, кем, во сколько, примечания, фото, показания счётчиков.


const weekday = (ymd, lang) => new Date(ymd + 'T12:00:00Z').toLocaleDateString(localeOf(lang), { weekday: 'short', timeZone: 'UTC' });

export default function RoutineDayReport({ lang = 'en', value }) {
    const t = uiText('routine_report', lang);
    const wt = uiText('work', lang);
    const [state, setState] = useState({ loading: true, data: null, error: null });
    const [openDays, setOpenDays] = useState(() => new Set());
    const [onlyMissed, setOnlyMissed] = useState(false);
    const [viewer, setViewer] = useState(null);

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

    if (state.loading && !state.data) return <div className="hd hd-empty">{t.loading}</div>;
    if (state.error) return <div className="hd hd-empty err">{t.error}</div>;
    const days = state.data?.days || [];
    if (days.length === 0 || days[0].total === 0) return <div className="hd hd-empty">{t.no_data}</div>;

    const multi = days.length > 1;
    const toggleDay = (d) => setOpenDays(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });
    const tot = state.data.totals;
    const onlyBtn = (
        <button type="button" className="hd-tgl" aria-pressed={onlyMissed} onClick={() => setOnlyMissed(v => !v)}>{t.only_missed}</button>
    );

    return (
        <div className={'hd' + (state.loading ? ' hd-loading' : '')}>
            {multi && (
                <div className="hd-pad hd-total">
                    <span className={'hd-st ' + (tot.done === tot.total ? 'done' : 'defect')}>{t.total}: <bdi>{tot.done} / {tot.total}</bdi></span>
                    {onlyBtn}
                </div>
            )}
            <div className="hd-list">
                {days.map(day => {
                    const open = !multi || openDays.has(day.date);
                    const allDone = day.done === day.total;
                    const items = onlyMissed ? day.items.filter(i => !i.done) : day.items;
                    const Hdr = multi ? 'button' : 'div';
                    return (
                        <div key={day.date} className="hd-card hd-day">
                            <Hdr {...(multi ? { type: 'button', onClick: () => toggleDay(day.date), 'aria-expanded': open } : {})}
                                className={'hd-dayhdr' + (open ? ' open' : '')}>
                                <b>{multi && <Icon n="chev" />}<bdi>{fmtYmd(day.date, lang)}</bdi><span>{weekday(day.date, lang)}</span></b>
                                <span className={'hd-st ' + (allDone ? 'done' : 'defect')}>{t.done}: <bdi>{day.done}</bdi> {t.of} <bdi>{day.total}</bdi></span>
                            </Hdr>
                            {open && !multi && <div className="hd-dayopt">{onlyBtn}</div>}
                            {open && items.map(it => (
                                <div key={it.task_id} className="hd-rr">
                                    <span className={'hd-dot' + (it.done ? '' : ' no')}>{it.done && <Icon n="check" />}</span>
                                    <div className="hd-rr-body">
                                        <div className="hd-rr-top">
                                            <span className="nm">{it.requires_ocr && <Icon n="gauge" />}{it.name}</span>
                                            {!it.done && <span className="hd-st pending">{t.not_done}</span>}
                                        </div>
                                        {it.done && it.value && !it.runs.some(r => r.value) && (
                                            <div className="hd-info"><span className="val"><Icon n="gauge" /><bdi>{it.value} {it.unit || ''}</bdi></span></div>
                                        )}
                                        {it.runs.map((r, i) => (
                                            <div key={i}>
                                                <div className="hd-info">
                                                    {r.time && <span><Icon n="clock" /><bdi>{r.time}</bdi></span>}
                                                    {r.worker && <span><Icon n="user" />{r.worker}</span>}
                                                    {r.repeat && <span className="rep"><Icon n="refresh" />{t.repeat}</span>}
                                                    {it.requires_ocr && r.value && <span className="val"><Icon n="gauge" /><bdi>{r.value} {r.unit || ''}</bdi></span>}
                                                    {r.pending && <span className="wait"><Icon n="clock" />{t.pending}</span>}
                                                </div>
                                                {r.notes && <div className="hd-info note"><span><Icon n="note" />{r.notes}</span></div>}
                                                <Thumbs items={r.media} small
                                                    onOpen={(list, idx) => setViewer({ items: list, index: idx, caption: `${it.name} · ${fmtYmd(day.date, lang)}${r.time ? ' ' + r.time : ''}` })} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>

            {viewer && <PhotoViewer items={viewer.items} index={viewer.index} caption={viewer.caption} t={wt} onClose={() => setViewer(null)} />}
        </div>
    );
}
