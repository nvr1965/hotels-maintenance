import { useState, useEffect, useCallback } from 'react';
import MeterChart, { fmtNum } from './MeterChart';
import { uiText } from '../i18n';

// Отчёт начальника по счётчикам (регламентные задачи с распознаванием):
// графики показаний и расхода за любой период, итоги, выгрузка в Excel (только на компьютере).


const COLORS = ['#844128', '#7a5a30', '#26875a', '#371f20'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const fmtDate = (s) => s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—';

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

const chip = { display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 12px', background: '#f8efe6', borderRadius: '10px', minWidth: '120px', flex: '1 1 120px' };
const chipLbl = { fontSize: '14px', color: '#6e635b' };
const chipVal = { fontSize: '19px', fontWeight: 'bold', color: '#2b2320' };

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

    const inputStyle = { padding: '9px 10px', borderRadius: '10px', border: '1px solid #d9cec5', fontSize: '17px', background: '#fff', minWidth: 0 };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Период */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {['p7', 'p30', 'pMonth', 'pPrev', 'p90', 'pYear'].map(k => (
                    <button key={k} type="button" onClick={() => pick(k)}
                        style={{ minHeight: '40px', padding: '8px 12px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px',
                            border: preset === k ? '2px solid var(--brand-button, #844128)' : '1px solid #d9cec5', background: preset === k ? '#f8efe6' : '#fff', color: preset === k ? 'var(--brand-button, #844128)' : '#3f3530' }}>
                        {t[k]}
                    </button>
                ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '15px', color: '#6e635b', flex: '1 1 140px' }}>
                    {t.from}
                    <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '15px', color: '#6e635b', flex: '1 1 140px' }}>
                    {t.to}
                    <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={inputStyle} />
                </label>
                {isDesktop && (
                    <a href={`/backend/api/export_meter_excel.php?from=${from}&to=${to}&lang=${lang}${keyQs}`}
                        style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', padding: '10px 16px', background: '#26875a', color: '#fff', borderRadius: '10px', fontWeight: 'bold', textDecoration: 'none', fontSize: '16px' }}>
                        {t.excel}
                    </a>
                )}
            </div>

            {state.loading && !state.data ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#6e635b' }}>{t.loading}</div>
            ) : state.error ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#c43d3d' }}>{state.error === 'disabled' ? t.disabled : t.error}</div>
            ) : !state.data?.meters?.length ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#6e635b' }}>{t.none}</div>
            ) : (
                <>
                    <div style={{ fontSize: '14px', color: '#7d726a', textAlign: 'center' }}>{t.hint}</div>
                    <div className="rm-card-grid">
                        {state.data.meters.map((m, i) => {
                            const st = m.stats;
                            const isCounter = m.kind === 'counter';
                            const isPercent = m.unit === '%';
                            return (
                                <div key={m.id} style={{ border: '1px solid #ebe3dc', borderRadius: '14px', padding: '14px', background: '#fff', opacity: state.loading ? 0.6 : 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                                        <h3 style={{ margin: 0, fontSize: '19px', color: 'var(--brand-primary, #371f20)' }}>{m.name}</h3>
                                        <span style={{ fontSize: '15px', color: '#6e635b' }}>{t.readings}: {st.count}</span>
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                                        <div style={chip}>
                                            <span style={chipLbl}>{t.last} · {fmtDate(st.last_date)}{st.last_time ? ` ${st.last_time}` : ''}</span>
                                            <span style={chipVal}>{fmtNum(st.last, 3)} {m.unit}</span>
                                        </div>
                                        <div style={chip}>
                                            <span style={chipLbl}>{isCounter ? t.cons : t.used}</span>
                                            <span style={chipVal}>{fmtNum(st.consumption)} {m.unit}</span>
                                        </div>
                                        <div style={chip}>
                                            <span style={chipLbl}>{t.avg}</span>
                                            <span style={chipVal}>{fmtNum(st.avg_per_day)} {m.unit}</span>
                                        </div>
                                        {!isCounter && st.refills > 0 && (
                                            <div style={chip}><span style={chipLbl}>{t.refills}</span><span style={chipVal}>{st.refills}</span></div>
                                        )}
                                        {st.anomalies > 0 && (
                                            <div style={{ ...chip, background: '#fee2e2' }}><span style={chipLbl}>{t.anomalies}</span><span style={{ ...chipVal, color: '#c43d3d' }}>{st.anomalies}</span></div>
                                        )}
                                    </div>

                                    {m.points.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '24px', color: '#7d726a' }}>{t.empty}</div>
                                    ) : (
                                        <MeterChart points={m.points} from={from} to={to} unit={m.unit} color={COLORS[i % COLORS.length]}
                                            yFixed={isPercent ? [0, 100] : null}
                                            bars={isCounter ? dailyBars(m.daily, from, to) : null}
                                            labels={{ bars: `${t.perDay}, ${m.unit}`, perDay: t.perDay, photo: t.photo, anomaly: t.anomaly }} />
                                    )}

                                    {m.points.length > 0 && (
                                        <details style={{ marginTop: '10px' }}>
                                            <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: 'var(--brand-button, #844128)', fontSize: '16px', padding: '6px 0' }}>{t.table}</summary>
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '16px' }}>
                                                    <thead>
                                                        <tr style={{ color: '#6e635b', borderBottom: '2px solid #ebe3dc' }}>
                                                            <th style={{ padding: '6px', textAlign: 'start' }}>{t.date}</th>
                                                            <th style={{ padding: '6px', textAlign: 'end' }}>{t.value}</th>
                                                            <th style={{ padding: '6px', textAlign: 'end' }}>{t.delta}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {[...m.points].reverse().map(p => (
                                                            <tr key={p.id || p.date} style={{ borderBottom: '1px solid #f3ebe2', color: p.anomaly ? '#c43d3d' : '#2b2320' }}>
                                                                <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{fmtDate(p.date)}{p.time ? <span style={{ color: '#7d726a' }}> {p.time}</span> : null}</td>
                                                                <td style={{ padding: '6px', textAlign: 'end', fontWeight: 'bold' }}>
                                                                    {p.photo ? <a href={p.photo} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{fmtNum(p.value, 3)}</a> : fmtNum(p.value, 3)}
                                                                </td>
                                                                <td style={{ padding: '6px', textAlign: 'end' }}>
                                                                    {p.anomaly ? '⚠' : (p.delta === null ? '—' : (p.delta > 0 ? '+' : '') + fmtNum(p.delta))}
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
