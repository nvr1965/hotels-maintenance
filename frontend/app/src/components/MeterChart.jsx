import { useState, useRef, useEffect } from 'react';
import { Icon } from './head/HeadKit';

// График показаний счётчика: линия с точками по датам (ось X — настоящие даты, пропуски видны),
// под ней по желанию столбики расхода в сутки. Чистый SVG, без библиотек.
// points: [{ id, date: 'YYYY-MM-DD', at?: 'YYYY-MM-DD HH:MM', value: number, photo?: string, anomaly?: bool }]
// bars:   [{ date, value }] — необязательно
// from/to — границы оси X (выбранный период), yFixed — [min, max] для процентов
// rtl — иврит/арабский: график зеркальный (время идёт справа налево, шкала значений справа), числа как обычно

const DAY = 86400000;
const ts = (d) => Date.parse(d + 'T00:00:00Z');
// Момент показания: 'YYYY-MM-DD HH:MM' (несколько в сутки) или только дата
const tsAt = (p) => p.at ? Date.parse(p.at.replace(' ', 'T') + ':00Z') : ts(p.date) + DAY / 2;
const fmtDay = (t) => {
    const d = new Date(t);
    return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0');
};
export const fmtNum = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(v))
    ? '—'
    // \u200E — чтобы на иврите/арабском минус стоял перед числом, а не после
    : (v < 0 ? '\u200E' : '') + Number(v).toLocaleString('ru-RU', { maximumFractionDigits: digits });

// «Красивые» деления оси: 1, 2, 5 × 10^n
function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / count;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map(k => k * pow).find(s => s >= raw) || raw;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
    return { lo, hi, ticks };
}

export default function MeterChart({ points, bars, from, to, unit = '', color = '#2a5f96', barColor = '#b8cde4', yFixed, labels = {}, rtl = false }) {
    const [sel, setSel] = useState(null); // выбранная точка (по клику)
    // Ширина SVG = реальная ширина блока, чтобы подписи были настоящими 13px и на телефоне, и на компьютере
    const box = useRef(null);
    const [W, setW] = useState(360);
    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // padL/padR — отступы со стороны шкалы значений и с противоположной; в RTL шкала справа
    const padS = 58, padE = 12, padT = 26;
    const padL = rtl ? padE : padS, padR = rtl ? padS : padE;
    const yLblX = rtl ? W - padR + 8 : padL - 8;   // подписи шкалы значений
    const yLblAnchor = rtl ? 'start' : 'end';
    const lineH = W < 500 ? 170 : 210;       // высота области линии
    const barH = bars ? 70 : 0;
    const barTop = padT + lineH + 22;        // столбики расхода — под линией, общая ось дат внизу
    const axisY = bars ? barTop + barH : padT + lineH;
    const H = axisY + 26;
    const t0 = ts(from), t1 = ts(to) + DAY;   // ось — от начала первого дня до конца последнего
    const xt = (t) => {
        const k = ((t - t0) / (t1 - t0)) * (W - padL - padR);
        return rtl ? W - padR - k : padL + k;  // RTL: ранние даты справа
    };
    const xp = (p) => xt(tsAt(p));            // точка показания — по дате и времени
    const x = (d) => xt(ts(d) + DAY / 2);     // столбик дня — посередине дня

    // Сомнительные показания (красные точки) не тянут масштаб и не входят в линию
    const good = points.filter(p => !p.anomaly);
    const vals = good.map(p => p.value);
    const { lo, hi, ticks } = yFixed
        ? { lo: yFixed[0], hi: yFixed[1], ticks: [0, 25, 50, 75, 100] }
        : niceTicks(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 1);
    const y = (v) => padT + lineH - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * lineH;

    // Подписи дат: не больше ~7 штук
    const spanDays = Math.round((t1 - t0) / DAY);
    const every = Math.max(1, Math.ceil(spanDays / Math.max(3, Math.floor((W - padL - padR) / 62))));
    const xTicks = [];
    for (let t = t0; t < t1; t += every * DAY) xTicks.push(t);

    const barVals = (bars || []).map(b => b.value);
    const barMax = barVals.length ? Math.max(...barVals, 0) : 0;
    const barW = Math.max(2, Math.min(18, ((W - padL - padR) / spanDays) * 0.7));

    const path = good.map((p, i) => `${i ? 'L' : 'M'}${xp(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const key = (p) => p.id || p.at || p.date;

    return (
        <div ref={box}>
            <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', touchAction: 'manipulation', direction: 'ltr', maxWidth: '100%' }} role="img">
                {/* сетка и подписи оси Y */}
                {ticks.map(v => (
                    <g key={v}>
                        <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#ebe3dc" strokeWidth="1" />
                        <text x={yLblX} y={y(v) + 4} textAnchor={yLblAnchor} fontSize="13" fill="#6e635b">{fmtNum(v, 1)}</text>
                    </g>
                ))}
                {/* подписи дат */}
                {xTicks.map(t => (
                    <text key={t} x={xt(t + DAY / 2)} y={axisY + 19} textAnchor="middle" fontSize="13" fill="#6e635b">{fmtDay(t)}</text>
                ))}
                {unit && <text x={yLblX} y={padT - 6} textAnchor={yLblAnchor} fontSize="12" fill="#7d726a">{unit}</text>}

                {/* линия показаний */}
                {good.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
                {points.map(p => (
                    <circle key={key(p)} cx={xp(p)} cy={y(p.value)} r={sel && key(sel) === key(p) ? 7 : 4.5}
                        fill={p.anomaly ? '#d63c3c' : color} stroke="#fff" strokeWidth="2" />
                ))}

                {/* столбики расхода в сутки */}
                {bars && (
                    <g>
                        <line x1={padL} x2={W - padR} y1={barTop} y2={barTop} stroke="#f3ebe2" />
                        <line x1={padL} x2={W - padR} y1={barTop + barH} y2={barTop + barH} stroke="#d9cec5" />
                        <text x={yLblX} y={barTop + 10} textAnchor={yLblAnchor} fontSize="12" fill="#7d726a">{fmtNum(barMax, 1)}</text>
                        <text x={yLblX} y={barTop + barH} textAnchor={yLblAnchor} fontSize="12" fill="#7d726a">0</text>
                        {bars.map(b => {
                            const h = barMax > 0 ? (b.value / barMax) * barH : 0;
                            return <rect key={b.date} x={x(b.date) - barW / 2} y={barTop + barH - h} width={barW} height={Math.max(0, h)} rx="2" fill={barColor} />;
                        })}
                        {labels.bars && (rtl
                            ? <text x={W - padR - 6} y={barTop - 6} fontSize="12" fill="#6e635b" direction="rtl" textAnchor="start">{labels.bars}</text>
                            : <text x={padL + 6} y={barTop - 6} fontSize="12" fill="#6e635b">{labels.bars}</text>)}
                    </g>
                )}

                {/* невидимые зоны для нажатия пальцем: каждая — до середины между соседними точками */}
                {points.map((p, i) => {
                    const cx = xp(p);
                    // «до» и «после» по времени; в RTL «после» — левее, поэтому берём min/max
                    const prev = i > 0 ? (cx + xp(points[i - 1])) / 2 : cx + (rtl ? 14 : -14);
                    const next = i < points.length - 1 ? (cx + xp(points[i + 1])) / 2 : cx + (rtl ? -14 : 14);
                    const left = Math.min(prev, next), right = Math.max(prev, next);
                    return (
                        <rect key={'hit' + key(p)} x={left} y={padT} width={Math.max(1, right - left)} height={axisY - padT} fill="transparent"
                            style={{ cursor: 'pointer' }} onClick={() => setSel(sel && key(sel) === key(p) ? null : p)} />
                    );
                })}
            </svg>

            {sel && (
                <div className="hd-sel">
                    <b><bdi>{fmtDay(ts(sel.date))}.{sel.date.slice(0, 4)}{sel.time ? ` ${sel.time}` : ''}</bdi></b>
                    <span><bdi>{fmtNum(sel.value, 3)} {unit}</bdi></span>
                    {sel.per_day !== null && sel.per_day !== undefined
                        ? <span className="muted">{labels.perDay}: <bdi>{fmtNum(sel.per_day)} {unit}</bdi></span>
                        : (sel.delta !== null && sel.delta !== undefined && <span className="muted"><bdi>{sel.delta > 0 ? '\u200E+' : ''}{fmtNum(sel.delta)} {unit}</bdi></span>)}
                    {sel.anomaly && <span className="bad">{labels.anomaly}</span>}
                    {sel.photo && <a href={sel.photo} target="_blank" rel="noreferrer"><Icon n="cam" />{labels.photo}</a>}
                </div>
            )}
        </div>
    );
}
