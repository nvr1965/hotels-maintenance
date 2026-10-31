import { useState, useEffect, useCallback } from 'react';
import MeterChart, { fmtNum } from './MeterChart';
import { uiText } from '../i18n';
import { Icon } from './head/HeadKit';

// Отчёт начальника по счётчикам (регламентные задачи с распознаванием):
// графики показаний и расхода за любой период, итоги, выгрузка в Excel (только на компьютере).


const COLORS = ['#2a5f96', '#1f7a4f', '#4b7bb0', '#5b6b7a'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const fmtDate = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—';

// Короткие подписи для телефона: все кнопки периода в одну строку

function presetRange(key) {
    const today = iso(new Date());
    const now = new Date();
    switch (key) {
        case 'p7': return [addDays(today, -6), today];
        case 'p30': return [addDays(today, -29), today];
        case 'p90': return [addDays(today, -89), today];
        case 'pYear': return [addDays(today, -364), today];
        case 'pMonth': return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), today];
        case 'pPrev': return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
        default: return [addDays(today, -29), today];
    }
}

// Выгрузка в Excel — только на компьютере (мышь и широкий экран)
function useIsDesktop() {
    const check = () => {
        try { return window.matchMedia('(pointer: fine)').matches && window.innerWidth >= 900; } catch { return false; }
    };
    const [desk, setDesk] = useState(check);
    useEffect(() => {
        const on = () => setDesk(check());
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return desk;
}

// Расход по дням (сервер раскладывает его по времени между показаниями)
const dailyBars = (daily, from, to) => (daily || [])
    .filter(d => d.use !== null && d.date >= from && d.date <= to)
    .map(d => ({ date: d.date, value: Math.max(0, d.use) }));

export default function MeterReport({ lang = 'en', accessKey = '' }) {
    const t = uiText('meter_report', lang);
    const isDesktop = useIsDesktop();
    const [preset, setPreset] = useState('p30');
    const [[from, to], setRange] = useState(() => presetRange('p30'));
    const [state, setState] = useState({ loading: true, data: null, error: null });
    // Ссылка для начальника: ключ из адреса вместо входа в систему
    const keyQs = accessKey ? `&key=${encodeURIComponent(accessKey)}` : '';

    const load = useCallback(async () => {
        setState(s => ({ ...s, loading: true, error: null }));
        try {
            const res = await fetch(`/backend/api/get_meter_report.php?from=${from}&to=${to}&lang=${lang}${keyQs}`);
            const data = await res.json();
            setState({ loading: false, data: data.success ? data : null, error: data.success ? null : (data.message === 'link_disabled' ? 'disabled' : 'error') });
        } catch {
            setState({ loading: false, data: null, error: 'network' });
        }
    }, [from, to, lang, keyQs]);

    useEffect(() => { load(); }, [load]);

    const pick = (key) => { setPreset(key); setRange(presetRange(key)); };
    const setFrom = (v) => { if (v) { setPreset(null); setRange([v, v > to ? v : to]); } };
    const setTo = (v) => { if (v) { setPreset(null); setRange([v < from ? v : from, v]); } };

    return (
        <div className="hd">
            {/* Период */}
            <div className="hd-pad">
                <div className="hd-chips one mt">
                    {['p7', 'p30', 'pMonth', 'pPrev', 'p90', 'pYear'].map(k => (
                        <button key={k} type="button" className={'hd-chp' + (preset === k ? ' on' : '')} aria-pressed={preset === k} onClick={() => pick(k)}>
                            <span className="lg">{t[k]}</span><span className="sm">{uiText('meter_short', lang)[k]}</span>
                        </button>
                    ))}
                    <button type="button" className={'hd-chp' + (!preset ? ' on' : '')} aria-pressed={!preset} onClick={() => setPreset(null)}>
                        {t.custom}
                    </button>
                </div>
            </div>
            {!preset && <div className="hd-pad">
                <div className="hd-row2">
                    <label>{t.from}
                        <input type="date" className="hd-fld" value={from} max={to} onChange={e => setFrom(e.target.value)} />
                    </label>
                    <label>{t.to}
                        <input type="date" className="hd-fld" value={to} min={from} onChange={e => setTo(e.target.value)} />
                    </label>
                </div>
            </div>}
            {isDesktop && (
                <div className="hd-pad">
                    <a className="hd-btn green" href={`/backend/api/export_meter_excel.php?from=${from}&to=${to}&lang=${lang}${keyQs}`}>
                        <Icon n="download" />{t.excel}
                    </a>
                </div>
            )}

            {state.loading && !state.data ? (
                <div className="hd-empty">{t.loading}</div>
            ) : state.error ? (
                <div className="hd-empty err">{state.error === 'disabled' ? t.disabled : t.error}</div>
            ) : !state.data?.meters?.length ? (
                <div className="hd-empty">{t.none}</div>
            ) : (
                <>
                    <div className="hd-pad hd-hint">{t.hint}</div>
                    <div className={'hd-list grid' + (state.loading ? ' hd-loading' : '')}>
                        {state.data.meters.map((m, i) => {
                            const st = m.stats;
                            const isCounter = m.kind === 'counter';
                            const isPercent = m.unit === '%';
                            return (
                                <div key={m.id} className="hd-card">
                                    <div className="hd-mtitle">
                                        <div className="hd-place"><Icon n="gauge" />{m.name}</div>
                                    </div>

                                    <div className="hd-kpis">
                                        <div className="hd-kpi">
                                            <small>{t.last} · <bdi>{fmtDate(st.last_date)}{st.last_time ? ` ${st.last_time}` : ''}</bdi></small>
                                            <b><bdi>{fmtNum(st.last, 3)} {m.unit}</bdi></b>
                                        </div>
                                        <div className="hd-kpi">
                                            <small>{isCounter ? t.cons : t.used}</small>
                                            <b><bdi>{fmtNum(st.consumption)} {m.unit}</bdi></b>
                                        </div>
                                        <div className="hd-kpi">
                                            <small>{t.avg}</small>
                                            <b><bdi>{fmtNum(st.avg_per_day)} {m.unit}</bdi></b>
                                        </div>
                                        <div className="hd-kpi">
                                            <small>{t.readings}</small>
                                            <b><bdi>{st.count}</bdi></b>
                                        </div>
                                        {!isCounter && st.refills > 0 && (
                                            <div className="hd-kpi"><small>{t.refills}</small><b><bdi>{st.refills}</bdi></b></div>
                                        )}
                                        {st.anomalies > 0 && (
                                            <div className="hd-kpi bad"><small>{t.anomalies}</small><b><bdi>{st.anomalies}</bdi></b></div>
                                        )}
                                    </div>

                                    {m.points.length === 0 ? (
                                        <div className="hd-empty">{t.empty}</div>
                                    ) : (
                                        <MeterChart points={m.points} from={from} to={to} unit={m.unit} color={COLORS[i % COLORS.length]}
                                            yFixed={isPercent ? [0, 100] : null}
                                            bars={isCounter ? dailyBars(m.daily, from, to) : null}
                                            labels={{ bars: `${t.perDay}, ${m.unit}`, perDay: t.perDay, photo: t.photo, anomaly: t.anomaly }}
                                            rtl={lang === 'he' || lang === 'ar'} />
                                    )}

                                    {m.points.length > 0 && (
                                        <details className="hd-details">
                                            <summary>{t.table}</summary>
                                            <div style={{ overflowX: 'auto' }}>
                                                <table className="hd-rtab">
                                                    <thead>
                                                        <tr>
                                                            <th style={{ textAlign: 'start' }}>{t.date}</th>
                                                            <th style={{ textAlign: 'end' }}>{t.value}</th>
                                                            <th style={{ textAlign: 'end' }}>{t.delta}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {[...m.points].reverse().map(p => (
                                                            <tr key={p.id || p.date} className={p.anomaly ? 'bad' : ''}>
                                                                <td style={{ whiteSpace: 'nowrap' }}><bdi>{fmtDate(p.date)}</bdi>{p.time ? <span className="hd-hint"> <bdi>{p.time}</bdi></span> : null}</td>
                                                                <td style={{ textAlign: 'end', fontWeight: 700 }}>
                                                                    <bdi>{p.photo ? <a href={p.photo} target="_blank" rel="noreferrer">{fmtNum(p.value, 3)}</a> : fmtNum(p.value, 3)}</bdi>
                                                                </td>
                                                                <td style={{ textAlign: 'end' }}>
                                                                    {p.anomaly ? <Icon n="warn" /> : <bdi>{p.delta === null ? '—' : (p.delta > 0 ? '+' : '') + fmtNum(p.delta)}</bdi>}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </details>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
