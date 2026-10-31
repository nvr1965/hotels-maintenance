import { useState, useEffect, useRef } from 'react';
import './work.css';

// Тексты нового экрана исполнителя

const mediaSrc = (url) => (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('http')) ? url : `/${url}`;
const normMedia = (item) => {
    const url = typeof item === 'string' ? item : (item?.url || '');
    const isVideo = (typeof item === 'object' && item?.type === 'video') || /\.(mp4|mov|avi|webm)$/i.test(url);
    return { url: mediaSrc(url), isVideo, queued: typeof item === 'object' && !!item?.localId };
};
const hasPhoto = (media) => (media || []).some(m => !normMedia(m).isVideo);

// «2026-10-16 13:05:00» -> «16.10 · 13:05»
const fmtStamp = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
    return m ? `${m[3]}.${m[2]} · ${m[4]}:${m[5]}` : (s || '');
};
const fmtDay = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); return m ? `${m[3]}.${m[2]}` : (ymd || ''); };
const dayBefore = (ymd) => {
    const d = new Date(ymd + 'T12:00:00Z');
    if (isNaN(d)) return '';
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
};

const stop = (e) => e.stopPropagation();

// ---------- просмотр фото на весь экран ----------
export function PhotoViewer({ items, index, caption, t, onClose }) {
    const [i, setI] = useState(index || 0);
    const x0 = useRef(null);
    const n = items.length;
    const cur = normMedia(items[i] || '');
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') setI(v => (v + 1) % n);
            if (e.key === 'ArrowLeft') setI(v => (v + n - 1) % n);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [n]);
    if (!n) return null;
    const rtl = document.documentElement.dir === 'rtl' || !!document.querySelector('.wk[dir="rtl"]');
    return (
        <div className="wk-viewer" role="dialog" aria-modal="true">
            <div className="wk-v-top">
                <span dir="ltr">{n > 1 ? `${i + 1} / ${n}` : ''}</span>
                <button type="button" aria-label={t.close} onClick={onClose}>×</button>
            </div>
            <div className="wk-v-img"
                onTouchStart={e => { x0.current = e.touches[0].clientX; }}
                onTouchEnd={e => {
                    if (x0.current === null || n < 2) return;
                    let dx = e.changedTouches[0].clientX - x0.current;
                    if (rtl) dx = -dx;
                    if (Math.abs(dx) > 40) setI(v => (v + (dx < 0 ? 1 : n - 1)) % n);
                    x0.current = null;
                }}>
                {cur.isVideo
                    ? <video key={cur.url} src={cur.url} controls autoPlay playsInline />
                    : <img src={cur.url} alt="" />}
                {n > 1 && <>
                    <button type="button" className="wk-v-nav prev" aria-label="‹" onClick={() => setI((i + n - 1) % n)}>‹</button>
                    <button type="button" className="wk-v-nav next" aria-label="›" onClick={() => setI((i + 1) % n)}>›</button>
                </>}
            </div>
            <div className="wk-v-cap">{caption}</div>
        </div>
    );
}

// ---------- миниатюры ----------
function Photos({ items, caption, ctx, canDelete, onDelete, small }) {
    if (!items || items.length === 0) return null;
    return (
        <div className="wk-photos" onClick={stop}>
            {items.map((item, i) => {
                const m = normMedia(item);
                return (
                    <div key={i} className="wk-ph" style={small ? { width: 76, height: 76 } : undefined}
                        role="button" tabIndex={0} onClick={() => ctx.openViewer(items, i, caption)}>
                        {m.isVideo ? <><video src={m.url} muted playsInline preload="metadata" /><span className="play">▶</span></> : <img src={m.url} alt="" loading="lazy" />}
                        {m.queued && <span className="q" title={ctx.t.waiting}>⏳</span>}
                        {canDelete && canDelete(i) && (
                            <button type="button" className="del" aria-label="×" onClick={(e) => { e.stopPropagation(); onDelete(i); }}>×</button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ---------- плюсик «Комментарий / фото» ----------
function Extra({ ctx, stateKey, notes, mediaCount, allowDisk }) {
    const [open, setOpen] = useState(!!notes);
    const t = ctx.t;
    return (
        <div onClick={stop} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" className={'wk-plus' + (open ? ' on' : '')} aria-expanded={open} onClick={() => setOpen(!open)}>
                <b aria-hidden="true" />{t.comment}
                {!open && (notes || mediaCount > 0) ? <small>{[notes ? '✎' : '', mediaCount > 0 ? `${mediaCount}` : ''].filter(Boolean).join(' · ')}</small> : null}
            </button>
            {open && (
                <div className="wk-extra">
                    <textarea value={notes || ''} placeholder={t.ph} onChange={e => ctx.onNotes(stateKey, e.target.value)} />
                    <div className="wk-extra-btns">
                        <button type="button" className="wk-addph" onClick={() => ctx.onCamera(stateKey)}><i className="wk-ico" />{t.addph}</button>
                        {allowDisk && <button type="button" className="wk-addph" style={{ flex: '0 1 auto' }} onClick={() => ctx.onDisk(stateKey)}>{t.disk}</button>}
                    </div>
                </div>
            )}
        </div>
    );
}

function Progress({ left, right, done, total }) {
    return (
        <div className="wk-prog">
            <div className="wk-prog-top"><span>{left}</span><span>{right}</span></div>
            <div className="wk-bar"><span style={{ width: `${total ? Math.round(done / total * 100) : 0}%` }} /></div>
        </div>
    );
}

// ---------- ЗАЯВКИ ----------
export function UrgentList({ ctx, list, top }) {
    const [openId, setOpenId] = useState(null);
    const t = ctx.t;
    return (
        <div className="wk-list grid">
            {top}
            {list.length === 0 && <div className="wk-none">{t.none}</div>}
            {list.map(task => {
                const st = ctx.taskState[task.id] || { notes: '', media: [] };
                const media = st.media || [];
                const own = new Set((task.media || []).map(m => normMedia(m).url));
                const open = openId === task.id;
                const place = task.location || task.asset_key || '—';
                const where = [task.building ? `${t.bld} ${task.building}` : '', task.floor ? `${task.floor} ${t.fl}` : ''].filter(Boolean).join(' · ');
                return (
                    <div key={task.id} className={'wk-tile u' + (open ? ' open' : '')} onClick={() => !open && setOpenId(task.id)}>
                        {open && (
                            <div className="wk-meta" onClick={() => setOpenId(null)} style={{ cursor: 'pointer' }}>
                                <span className="wk-urg">{t.urgent}</span>
                                <span>{fmtStamp(task.created_at)}</span>
                                {task.author_name && <span>{t.author}: {task.author_name}</span>}
                                {where && <span>{where}</span>}
                            </div>
                        )}
                        <div className="wk-row" onClick={() => open && setOpenId(null)} style={open ? { cursor: 'pointer' } : undefined}>
                            <div className="txt">
                                <div className="wk-place">{place}</div>
                                <div className="wk-task">{task.description}</div>
                            </div>
                            {!open && <button type="button" className="wk-done sm" disabled={ctx.closing}
                                onClick={(e) => { e.stopPropagation(); ctx.onClose(task.id, 'urgent'); }}>{t.done}</button>}
                        </div>
                        {open && (
                            <div className="wk-more">
                                <Photos items={media} caption={place} ctx={ctx}
                                    canDelete={(i) => !own.has(normMedia(media[i]).url)}
                                    onDelete={(i) => ctx.onDeleteMedia(task.id, i)} />
                                <Extra ctx={ctx} stateKey={task.id} notes={st.notes} mediaCount={media.length - own.size} />
                                <button type="button" className="wk-done lg" disabled={ctx.closing}
                                    onClick={() => ctx.onClose(task.id, 'urgent')}>{t.doneLg}</button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ---------- РЕГЛАМЕНТ ----------
export function RoutineList({ ctx, list, todayStr }) {
    const [openId, setOpenId] = useState(null);
    const t = ctx.t;
    const isActive = (task) => task.status !== 'done' || ctx.repeatIds.has(task.id);
    const active = list.filter(isActive).sort((a, b) => (b.requires_ocr ? 1 : 0) - (a.requires_ocr ? 1 : 0));
    const done = list.filter(x => !isActive(x));
    const doneCount = list.filter(x => x.status === 'done').length;
    const yesterday = dayBefore(todayStr);

    // Фото счётчика: сразу открываем плитку и камеру
    const shoot = (task) => { setOpenId(task.id); ctx.onCamera('r' + task.id); };

    return (
        <>
            <Progress total={list.length} done={doneCount}
                left={`${t.today}, ${fmtDay(todayStr)}`}
                right={<>{t.made} <b>{doneCount}</b> {t.of} {list.length}</>} />
            <div className="wk-list">
                {list.length === 0 && <div className="wk-none">{t.none}</div>}
                {active.map(task => {
                    const key = 'r' + task.id;
                    const st = ctx.taskState[key] || { notes: '', media: [] };
                    const media = st.media || [];
                    const open = openId === task.id;
                    const meter = !!task.requires_ocr;
                    const shot = meter && hasPhoto(media);
                    const repeat = ctx.repeatIds.has(task.id);
                    const lastLbl = task.last_date === yesterday ? t.yest : (task.last_date ? `${t.lastOn} ${fmtDay(task.last_date)}` : '');
                    return (
                        <div key={task.id} className={'wk-tile' + (meter ? ' meter' : '') + (open ? ' open' : '')} onClick={() => !open && setOpenId(task.id)}>
                            <div className="wk-row" onClick={() => open && setOpenId(null)} style={open ? { cursor: 'pointer' } : undefined}>
                                <div className="txt">
                                    <div className="wk-place">{task.description}</div>
                                    {meter && task.last_value != null && task.last_value !== '' && (
                                        <div className="wk-sub">{lastLbl}: <b><bdi>{task.last_value} {task.last_unit || ''}</bdi></b></div>
                                    )}
                                    {meter && shot && !open && <div className="wk-sub" style={{ color: 'var(--done)', fontWeight: 700 }}>✓ {t.photo}</div>}
                                </div>
                                {!open && (meter
                                    ? (shot
                                        ? <button type="button" className="wk-done sm" disabled={ctx.closing} onClick={(e) => { e.stopPropagation(); ctx.onClose(task.id, 'routine'); }}>{t.done}</button>
                                        : <button type="button" className="wk-done sm" onClick={(e) => { e.stopPropagation(); shoot(task); }}><i className="wk-ico" />{t.photo}</button>)
                                    : <button type="button" className="wk-done sm" disabled={ctx.closing} onClick={(e) => { e.stopPropagation(); ctx.onClose(task.id, 'routine'); }}>{t.done}</button>)}
                            </div>
                            {open && (
                                <div className="wk-more" onClick={stop}>
                                    {repeat && (
                                        <div className="wk-note">🔁 {t.repeatNote}
                                            <button type="button" onClick={() => { ctx.onCancelRepeat(task); setOpenId(null); }}>{t.cancel}</button>
                                        </div>
                                    )}
                                    {meter && !shot && (
                                        <button type="button" className="wk-cam" onClick={() => ctx.onCamera(key)}><i className="wk-ico" />{t.shoot}</button>
                                    )}
                                    {shot ? (
                                        <div className="wk-shot">
                                            <Photos items={media} caption={task.description} ctx={ctx} small
                                                canDelete={() => false} onDelete={(i) => ctx.onDeleteMedia(key, i)} />
                                            <div className="wk-shot-txt">
                                                <span>{t.shotOk}</span>
                                                <button type="button" className="wk-again" onClick={() => ctx.onRetake(key)}>{t.retake}</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <Photos items={media} caption={task.description} ctx={ctx}
                                            canDelete={() => true} onDelete={(i) => ctx.onDeleteMedia(key, i)} />
                                    )}
                                    {(!meter || shot) && (
                                        <button type="button" className="wk-done lg" disabled={ctx.closing}
                                            onClick={() => ctx.onClose(task.id, 'routine')}>{meter ? t.ready : t.doneLg}</button>
                                    )}
                                    <Extra ctx={ctx} stateKey={key} notes={st.notes} mediaCount={media.length} allowDisk={meter} />
                                </div>
                            )}
                        </div>
                    );
                })}
                {done.length > 0 && <div className="wk-sec">{t.doneToday}</div>}
                {done.map(task => {
                    const val = task.ocr_value ? `${task.ocr_value} ${task.ocr_unit || ''}` : (task.requires_ocr ? t.valPhoto : '');
                    return (
                        <div key={task.id} className="wk-d">
                            <span className="nm">{task.description}</span>
                            <span className={'ok' + (task._queued ? ' q' : '')}>
                                {task._queued ? t.waiting : <>✓ {task.done_at || ''}{val ? <> · <bdi>{val}</bdi></> : null}</>}
                            </span>
                            {!task._queued && <button type="button" className="wk-again" onClick={() => { ctx.onRepeat(task); setOpenId(task.id); }}>{t.again}</button>}
                        </div>
                    );
                })}
            </div>
        </>
    );
}

// ---------- ПЛАНОВЫЕ ----------
const chkStatus = (item) => item.status || (item.done ? 'ok' : 'pending');

export function PlannedList({ ctx, list, top }) {
    const [openId, setOpenId] = useState(null);
    const t = ctx.t;
    return (
        <>
            {list.length > 0 && (
                <div className="wk-prog" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 15, color: 'var(--ink-soft)' }}>
                    <span>{t.rooms}</span><span>{t.roomsLeft}: <b style={{ fontSize: 20, color: 'var(--ink)' }}>{list.length}</b></span>
                </div>
            )}
            <div className="wk-list grid">
                {top}
                {list.length === 0 && <div className="wk-none">{t.none}</div>}
                {list.map(task => {
                    const st = ctx.taskState[task.id] || { notes: '', media: [], checklist: [] };
                    const chk = st.checklist || [];
                    const marked = chk.filter(i => chkStatus(i) !== 'pending').length;
                    const def = chk.some(i => chkStatus(i) === 'defect');
                    const left = chk.length - marked;
                    const open = openId === task.id;
                    const sub = [task.building ? `${t.bld} ${task.building}` : '', task.floor ? `${task.floor} ${t.fl}` : ''].filter(Boolean).join(' · ');
                    return (
                        <div key={task.id} className={'wk-tile room' + (def ? ' def' : '') + (open ? ' open' : '')} onClick={() => !open && setOpenId(task.id)}>
                            <div className="wk-row" onClick={() => open && setOpenId(null)} style={{ alignItems: 'flex-start', cursor: open ? 'pointer' : undefined }}>
                                <div className="txt">
                                    <div className="wk-place">{t.room} {task.room_name}</div>
                                    {sub && <div className="wk-sub">{sub}</div>}
                                </div>
                                <span className={'wk-chip' + (chk.length && marked === chk.length ? ' full' : def ? ' def' : '')}><bdi>{marked} / {chk.length}</bdi></span>
                            </div>
                            {open && (
                                <div className="wk-more" onClick={stop}>
                                    {left > 0 && <button type="button" className="wk-allok" onClick={() => ctx.onAllOk(task.id)}>{t.allok}</button>}
                                    <div className="wk-chk">
                                        {chk.map(item => {
                                            const s = chkStatus(item);
                                            return (
                                                <div key={item.id} className={'wk-ci' + (s !== 'pending' ? ' s-' + s : '')}>
                                                    <div className="wk-ci-name">{item.text}</div>
                                                    <div className="wk-ci-btns">
                                                        {['ok', 'defect', 'fixed'].map(k => (
                                                            <button key={k} type="button" className={k + (s === k ? ' on' : '')} aria-pressed={s === k}
                                                                onClick={() => ctx.onChecklist(task.id, item.id, s === k ? 'pending' : k)}>{t['opt_' + k]}</button>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <Photos items={st.media || []} caption={`${t.room} ${task.room_name}`} ctx={ctx}
                                        canDelete={() => true} onDelete={(i) => ctx.onDeleteMedia(task.id, i)} />
                                    <Extra ctx={ctx} stateKey={task.id} notes={st.notes} mediaCount={(st.media || []).length} />
                                    <button type="button" className="wk-done lg" disabled={ctx.closing || left > 0}
                                        onClick={() => ctx.onClose(task.id, 'planned')}>{t.roomDone}</button>
                                    {left > 0 && <div className="wk-left">{t.left}: {left}</div>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );
}
