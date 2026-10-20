import { useState, useEffect, useRef } from 'react';
import CameraBlock from '../components/CameraBlock';
import AssetPicker from '../components/AssetPicker';
import AppMenu from '../components/AppMenu';
import AppHeader from '../components/work/AppHeader';
import { PhotoViewer } from '../components/work/WorkTiles';
import Icon from '../components/mgr/Icon';
import NotifyButton from '../notify/NotifyButton';
import { PUSH_ROLES } from '../notify/push';
import { errText } from '../components/errorText';
import { uiText, dirOf } from '../i18n';
import OfflineBanner, { useOutbox } from '../offline/OfflineBanner';
import { saveFile, deleteFile, uploadNow, makeOp, submitOrQueue, pendingOps, ServerError } from '../offline/outbox';
import '../components/work/work.css';
import '../components/mgr/mgr.css';


// Последние объекты и заявки — чтобы без сети экран открывался не пустым
const cacheGet = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const cachePut = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* нет места */ } };

const pad2 = (n) => String(n).padStart(2, '0');
// «2026-10-16 13:05:00» -> Date (время сервера, как и раньше, читаем как местное)
const parseStamp = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    const d = new Date(s);
    return isNaN(d) ? null : d;
};
// Числа одинаково на всех языках (ar-SA показывал бы другой календарь)
const fmtDate = (d) => d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
const DAY_MS = 24 * 60 * 60 * 1000;
// Когда заявка выполнена: сервер может прислать completed_at; updated_at, равный created_at, — не время выполнения
const doneStamp = (t) => t.completed_at || (t.updated_at && t.updated_at !== t.created_at ? t.updated_at : null);
const doneTime = (t) => parseStamp(doneStamp(t) || t.updated_at || t.created_at);

const isVideoItem = (item) => {
    const url = typeof item === 'string' ? item : (item?.url || '');
    return (typeof item === 'object' && item?.type === 'video') || /\.(mp4|mov|avi|webm)$/i.test(url);
};
const srcOf = (item) => {
    const url = typeof item === 'string' ? item : (item?.url || '');
    return (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('http')) ? url : `/${url}`;
};

function Thumb({ item, label, onOpen, children }) {
    const video = isVideoItem(item);
    return (
        <div className="wk-ph" role="button" tabIndex={0} aria-label={label}
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
            {video
                ? <><video src={srcOf(item)} muted playsInline preload="metadata" /><span className="play"><Icon name="play" /></span></>
                : <img src={srcOf(item)} alt="" loading="lazy" />}
            {children}
        </div>
    );
}

export default function ManagerDashboard({ user, onLogout, onChangeLang, onOpenAdmin, onBack }) {
    // Локальный стейт языка для мгновенного переключения интерфейса
    const [lang, setLang] = useState(user.lang || 'en');
    const text = uiText('manager', lang);
    const dir = dirOf(lang);
    const role = user.role ? String(user.role).trim().toLowerCase() : '';

    const [locations, setLocations] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const [assetId, setAssetId] = useState('');
    const [description, setDescription] = useState('');
    const [mediaList, setMediaList] = useState([]);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [now, setNow] = useState(() => new Date());

    const [taskTab, setTaskTab] = useState('new');
    const [openId, setOpenId] = useState(null);
    const [flashId, setFlashId] = useState(null);
    const [viewer, setViewer] = useState(null);

    // Общая полоска «Нет связи» (pwa.js) висит поверх экрана — сдвигаем шапку и вкладки под неё
    const [offBar, setOffBar] = useState(0);
    useEffect(() => {
        let raf = 0;
        const measure = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => setOffBar(document.getElementById('app-offline-bar')?.offsetHeight || 0));
        };
        measure();
        window.addEventListener('online', measure);
        window.addEventListener('offline', measure);
        window.addEventListener('resize', measure);
        window.addEventListener('load', measure);
        return () => {
            window.removeEventListener('load', measure);
            cancelAnimationFrame(raf);
            window.removeEventListener('online', measure);
            window.removeEventListener('offline', measure);
            window.removeEventListener('resize', measure);
        };
    }, [lang]);

    const handleSwitchLang = (newLang) => {
        setLang(newLang);
        if (onChangeLang) onChangeLang(newLang);
    };

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 15000);
        return () => clearInterval(timer);
    }, []);

    // Заявки, созданные без сети и ещё не отправленные
    const [queuedTasks, setQueuedTasks] = useState([]);
    const loadQueued = async () => {
        const ops = await pendingOps(user.id);
        setQueuedTasks(ops.filter(o => o.kind === 'create_urgent').sort((a, b) => b.createdAt - a.createdAt).map(o => {
            const d = new Date(o.createdAt);
            return {
                id: 'q-' + o.id, location: o.label, description: o.payload.description,
                status: 'queued', created_at: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
                media: []
            };
        }));
    };

    const loadData = async () => {
        setIsLoading(true);
        const userId = user.id || 1;
        loadQueued().catch(() => {});
        const assetsKey = `hotelapp_assets_${lang}`;
        const tasksKey = `hotelapp_mtasks_${userId}_${lang}`;

        try {
            // Передаем текущий язык в запрос объектов, чтобы названия переводились
            const resAssets = await fetch(`/backend/api/get_assets.php?lang=${lang}`);
            if (!resAssets.ok) throw new Error('http_' + resAssets.status);
            const dataAssets = await resAssets.json();
            if (dataAssets.success) { setLocations(dataAssets.locations); cachePut(assetsKey, dataAssets.locations); }
        } catch (err) {
            console.error("Ошибка загрузки объектов:", err);
            const cached = cacheGet(assetsKey);
            if (cached) setLocations(prev => prev.length ? prev : cached);
        }

        try {
            const resTasks = await fetch(`/backend/api/get_manager_tasks.php?lang=${lang}&user_id=${userId}`);
            if (!resTasks.ok) throw new Error('http_' + resTasks.status);
            const dataTasks = await resTasks.json();
            if (dataTasks.success) { setTasks(dataTasks.tasks); cachePut(tasksKey, dataTasks.tasks); }
        } catch (err) {
            console.error("Ошибка загрузки заявок:", err);
            const cached = cacheGet(tasksKey);
            if (cached) setTasks(prev => prev.length ? prev : cached);
        }

        setIsLoading(false);
    };

    // Очередь отправки: заявка дошла до сервера — обновляем список
    const outbox = useOutbox(user.id, () => { loadData(); });

    useEffect(() => {
        loadData();
    }, [lang]);

    // Фото сразу показываем и сохраняем в телефоне, потом отправляем на сервер.
    // Без связи фото ждёт в телефоне и уйдёт вместе с заявкой.
    const handleAddMedia = async (type, dataUrlOrFile) => {
        setIsCameraOpen(false);

        let blob;
        try {
            // Если камера вернула Base64 (data:image/...) или blob-ссылку
            if (typeof dataUrlOrFile === 'string') {
                const res = await fetch(dataUrlOrFile);
                blob = await res.blob();
            } else if (dataUrlOrFile instanceof Blob || dataUrlOrFile instanceof File) {
                blob = dataUrlOrFile;
            } else {
                return;
            }
        } catch (e) {
            console.error('Media read error:', e);
            alert(errText(lang, 'upload_fail'));
            return;
        }

        let localId;
        try { localId = await saveFile(user.id, blob, type); } catch (e) { console.error('Local save error:', e); }

        if (!localId) {
            try {
                const url = await uploadNow(blob, type);
                setMediaList(prev => [...prev, { type, url }]);
            } catch (e) {
                alert(errText(lang, e instanceof ServerError ? 'upload_save' : 'upload_fail', e instanceof ServerError ? e.message : undefined));
            }
            return;
        }

        setMediaList(prev => [...prev, { type, url: URL.createObjectURL(blob), localId }]);
        try {
            const url = await uploadNow(blob, type);
            setMediaList(prev => prev.map(m => m.localId === localId ? { type, url } : m));
            deleteFile(localId);
        } catch (e) {
            if (e instanceof ServerError) {
                setMediaList(prev => prev.filter(m => m.localId !== localId));
                deleteFile(localId);
                alert(errText(lang, 'upload_save', e.message));
            }
            // Нет связи — фото ждёт в телефоне
        }
    };

    const handleRemoveMedia = (indexToRemove) => {
        setMediaList(prev => {
            const removed = prev[indexToRemove];
            if (removed && removed.localId) deleteFile(removed.localId);
            return prev.filter((_, index) => index !== indexToRemove);
        });
    };

    const sendingRef = useRef(false);
    const [sending, setSending] = useState(false);
    const formOk = !!assetId && (description.trim() !== '' || mediaList.length > 0);

    const submitTask = async () => {
        if (sendingRef.current || !formOk) return;
        const userId = user.id || 1;
        const loc = locations.find(l => String(l.id) === String(assetId));
        const payload = {
            asset_id: String(assetId),
            description,
            lang,
            user_id: String(userId),
            mediaList
        };
        sendingRef.current = true;
        setSending(true);
        try {
            const label = loc ? (loc.short || loc.name || '') : '';
            const op = makeOp(user.id, 'create_urgent', payload, label);
            const result = await submitOrQueue(op);
            // Без окна «Заявка создана» — форма очищается, заявка появляется в списке
            setAssetId('');
            setDescription('');
            setMediaList([]);
            if (result.queued) loadQueued();
            else loadData();
            if (onBack) { onBack(); return; }
            const id = 'q-' + op.id;
            setTaskTab('active');
            setOpenId(null);
            setFlashId(id);
            setTimeout(() => setFlashId(f => (f === id ? null : f)), 1500);
            window.scrollTo({ top: 0 });
        } catch (e) {
            console.error(e);
            alert(e instanceof ServerError ? errText(lang, 'server', e.message) : errText(lang, 'network'));
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    const statusText = (status) => ({
        queued: outbox.offline ? text.st_queued : text.st_sending,
        pending: text.st_pending, in_progress: text.st_progress, done: text.st_done
    }[status] || status);

    const nowMs = now.getTime();
    const activeTasks = [...queuedTasks, ...tasks.filter(t => t.status !== 'done')];
    const completedTasks = tasks.filter(t => {
        if (t.status !== 'done') return false;
        const d = doneTime(t);
        return d && nowMs - d.getTime() <= DAY_MS;
    });
    const displayedTasks = taskTab === 'active' ? activeTasks : completedTasks;

    const pickTab = (key) => { setTaskTab(key); setOpenId(null); };

    const tabsDef = [
        { key: 'new' },
        { key: 'active', count: activeTasks.length, cls: activeTasks.length > 0 ? 'u' : '' },
        { key: 'done', count: completedTasks.length, cls: '' },
    ];

    const form = (
        <div className="mgr-form">
            <div className="mgr-card">
                <h3>{onBack ? text.report_urgent : text.report}</h3>
                <div className="mgr-time"><Icon name="clock" />{text.datetime} <b><bdi>{fmtDate(now)}</bdi></b></div>

                <div className="mgr-lbl">{text.sel_zone}</div>
                <AssetPicker locations={locations} value={assetId} onChange={setAssetId} lang={lang} />

                <textarea className="mgr-desc" value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder={text.descr} aria-label={text.descr} />

                {mediaList.length > 0 && (
                    <div className="mgr-thumbs">
                        {mediaList.map((media, index) => (
                            <div key={index} className="mgr-thumb">
                                <Thumb item={media} label={`${text.photo} ${index + 1}`}
                                    onOpen={() => setViewer({ items: mediaList, index, caption: '' })}>
                                    {media.localId && <span className="mgr-q" title={text.st_queued}><Icon name="clock" /></span>}
                                </Thumb>
                                <button type="button" className="mgr-x" aria-label={text.rmph} onClick={() => handleRemoveMedia(index)}>×</button>
                            </div>
                        ))}
                    </div>
                )}

                <button type="button" className="wk-plus" onClick={() => setIsCameraOpen(true)}>
                    <b aria-hidden="true" />{text.attach}{mediaList.length > 0 && <small>{mediaList.length}</small>}
                </button>

                <button type="button" className="wk-done lg" onClick={submitTask} disabled={sending || !formOk}>{text.send}</button>
                {!formOk && <div className="mgr-need">{text.need}</div>}
            </div>
        </div>
    );

    const tile = (task) => {
        const open = openId === task.id;
        const media = task.media || [];
        const place = task.location || '—';
        const created = fmtDate(parseStamp(task.created_at));
        const doneAt = task.status === 'done' && doneStamp(task) ? fmtDate(parseStamp(doneStamp(task))) : '';
        return (
            <div key={task.id} className={`wk-tile mgr-tile s-${task.status}${open ? ' open' : ''}${flashId === task.id ? ' mgr-flash' : ''}`}
                role="button" tabIndex={0} aria-expanded={open}
                onClick={() => setOpenId(open ? null : task.id)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpenId(open ? null : task.id); } }}>
                <div className="mgr-top">
                    <div className="wk-place">{place}</div>
                    <span className={'mgr-st ' + task.status}>{statusText(task.status)}</span>
                </div>
                {task.description && <div className="wk-task">{task.description}</div>}
                {!open && media.length > 0 && <div className="mgr-cnt"><Icon name="cam" />{media.length}</div>}
                {open && (
                    <div className="mgr-more" onClick={(e) => e.stopPropagation()}>
                        <div className="mgr-times">
                            <span>{text.lbl_created} <b><bdi>{created}</bdi></b></span>
                            {doneAt && <span className="ok">{text.lbl_done} <b><bdi>{doneAt}</bdi></b></span>}
                        </div>
                        {media.length > 0 && (
                            <div className="wk-photos">
                                {media.map((item, i) => (
                                    <Thumb key={i} item={item} label={`${text.photo} ${i + 1}`}
                                        onOpen={() => setViewer({ items: media, index: i, caption: `${place} · \u2066${created}\u2069` })} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="wk mgr" dir={dir} lang={lang} style={offBar ? { '--mgr-off': offBar + 'px', paddingTop: offBar } : undefined}>
            <AppHeader name={user.name} showLabel={text.showHdr} backLabel={text.back}
                subtitle={onBack ? text.report_urgent : text.title}
                onBack={onBack}
                right={<>
                    {!onBack && onOpenAdmin && (
                        <button type="button" className="wk-admin" onClick={onOpenAdmin}>{text.admin_btn}</button>
                    )}
                    {PUSH_ROLES.includes(role) && <NotifyButton lang={lang} role={role} />}
                    <AppMenu lang={lang} onChangeLang={handleSwitchLang} onLogout={onLogout} />
                </>} />

            {onBack ? (
                // Руководитель открывает этот экран из своей панели, чтобы создать срочную заявку
                <div className="mgr-backbar">
                    <button type="button" className="mgr-secbtn" onClick={onBack}><Icon name="back" />{text.back}</button>
                </div>
            ) : (
                <div className="wk-seg" role="tablist">
                    {tabsDef.map(tb => (
                        <button key={tb.key} type="button" role="tab" aria-selected={taskTab === tb.key}
                            className={taskTab === tb.key ? 'on' : ''} onClick={() => pickTab(tb.key)}>
                            {text['seg_' + tb.key]}
                            {tb.count !== undefined && !(isLoading && !tasks.length && !queuedTasks.length) && <i className={tb.cls}>{tb.count}</i>}
                        </button>
                    ))}
                </div>
            )}

            <div className="mgr-ob"><OfflineBanner userId={user.id} lang={lang} status={outbox} /></div>

            {onBack || taskTab === 'new' ? form : (
                <>
                    {taskTab === 'done' && <div className="mgr-note"><Icon name="clock" />{text.last24}</div>}
                    {isLoading && displayedTasks.length === 0 ? (
                        <div className="wk-none">{text.load}</div>
                    ) : displayedTasks.length === 0 ? (
                        <div className="wk-none">{text.no_tasks}</div>
                    ) : (
                        <div className="wk-list grid">{displayedTasks.map(tile)}</div>
                    )}
                </>
            )}

            {isCameraOpen && (
                <CameraBlock
                    onCapturePhoto={(p) => handleAddMedia('photo', p)}
                    onCaptureVideo={(v) => handleAddMedia('video', v)}
                    onClose={() => setIsCameraOpen(false)}
                />
            )}
            {viewer && <PhotoViewer items={viewer.items} index={viewer.index} caption={viewer.caption} t={text} onClose={() => setViewer(null)} />}
        </div>
    );
}
