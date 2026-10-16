import { useState, useEffect, useRef } from 'react';
// ИСПРАВЛЕННЫЙ ИМПОРТ: Путь к CameraBlock как в ManagerDashboard
import CameraBlock from '../components/CameraBlock';
import AppMenu from '../components/AppMenu';
import NotifyButton from '../notify/NotifyButton';
import { PUSH_ROLES, syncPush, syncUrgentBadge } from '../notify/push';
import { errText } from '../components/errorText';
import MeterReport from '../components/MeterReport';
import ReportDateFilter, { hotelToday, fmtYmd } from '../components/ReportDateFilter';
import RoutineDayReport from '../components/RoutineDayReport';
import { getBrand, switchHotel } from '../brand';
import { uiText, dirOf, localeOf } from '../i18n';
import OfflineBanner, { useOutbox } from '../offline/OfflineBanner';
import { saveFile, deleteFile, uploadNow, makeOp, submitOrQueue, pendingOps, ServerError } from '../offline/outbox';
import AppHeader from '../components/work/AppHeader';
import { UrgentList, RoutineList, PlannedList, PhotoViewer } from '../components/work/WorkTiles';
import { Icon, StatusBadge, CheckBadge, Thumbs, useToast, fmtStamp } from '../components/head/HeadKit';


// Адрес для показа фото/видео: сохранённое в телефоне (blob:) показываем как есть
const mediaSrc = (url) => (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('http')) ? url : `/${url}`;

// Последний список задач — чтобы без сети приложение открывалось не пустым
const tasksCacheKey = (uid, lang) => `hotelapp_tasks_${uid}_${lang}`;

export default function WorkerDashboard({ user, onLogout, onChangeLang, onOpenAdmin, onCreateUrgent, startInWork }) {
    const lang = user.lang || 'en';
    const text = uiText('worker', lang);
    const dir = dirOf(lang);

    const isAdmin = Number(user.sysadmin) === 1;
    // Отчёты видят руководитель и администратор, но панели у них разные:
    // руководитель — «Панель руководителя», сначала «Отчёты»;
    // администратор — «Панель исполнителя (администратор)», сначала «Текущая работа»
    // Наблюдатель сети (роль viewer) видит только отчёты, без текущей работы
    const isViewer = String(user.role).trim().toLowerCase() === 'viewer' && !isAdmin;
    const isHead = String(user.role).trim().toLowerCase() === 'head' || isAdmin || isViewer;
    const isHeadPanel = isHead && !isAdmin;
    const [headMode, setHeadMode] = useState(isViewer || (isHeadPanel && !startInWork) ? 'reports' : 'work');
    const showReports = isHead && (headMode === 'reports' || isViewer);

    const [activeTab, setActiveTab] = useState('urgent');
    const [tasks, setTasks] = useState({ urgent: [], planned: [], routine: [] });
    // Уведомления о срочных заявках получают исполнители и начальник
    const userRole = String(user.role).trim().toLowerCase();
    // Кому слать уведомления — настройка отеля (по умолчанию исполнитель и руководитель)
    const pushEligible = (getBrand().hotel?.settings?.push_roles || PUSH_ROLES).includes(userRole);
    const [isLoading, setIsLoading] = useState(true);

    const [selectedRoomTask, setSelectedRoomTask] = useState(null);
    const [taskState, setTaskState] = useState({});
    
    // Хранит ID задачи, для которой сейчас открыта камера (если null - камера закрыта)
    const [isCameraOpenFor, setIsCameraOpenFor] = useState(null);

    // Окно проверки/правки результата ИИ-распознавания (счётчики)
    // { taskId, taskType, value, unit, error }
    const [ocrModalTask, setOcrModalTask] = useState(null);

    // Открытая регламентная задача: { task, repeat }. null — показываем список
    const [routineView, setRoutineView] = useState(null);
    // Дата (по часам отеля), за которую загружен список; по её смене список обновляется сам
    const [todayStr, setTodayStr] = useState('');
    const loadedDateRef = useRef('');

    // Экран «Создать плановые задачи» (доступен роли head — как batch_planned.php в PHP-версии)
    const [plannedCreateView, setPlannedCreateView] = useState(false);
    const [plannedFormData, setPlannedFormData] = useState(null); // { workers, buildings }
    const [plannedFormLoading, setPlannedFormLoading] = useState(false);
    const [selectedWorkerIds, setSelectedWorkerIds] = useState([]);
    const [selectedRoomIds, setSelectedRoomIds] = useState([]);
    const [plannedSubmitting, setPlannedSubmitting] = useState(false);
    const [expandedBuildings, setExpandedBuildings] = useState(() => new Set());
    const [expandedFloors, setExpandedFloors] = useState(() => new Set());

    // ---------- ОТЧЁТЫ (доступно роли head / sysadmin) ----------
    const [reportView, setReportView] = useState('tasks'); // 'tasks' | 'routine' | 'planned'

    const [tasksReport, setTasksReport] = useState({ loading: false, data: null, error: null });
    const [tasksReportFilter, setTasksReportFilter] = useState(() => ({ from: hotelToday(), to: hotelToday(), type: 'current' }));

    const [routineReport, setRoutineReport] = useState({ loading: false, data: null, error: null });
    // Регламент: 'days' — что сделано за день/диапазон (по умолчанию сегодня); 'matrix' — «За периоды» (таблица задача × дата)
    const [routineMode, setRoutineMode] = useState('days');
    const [routineDayFilter, setRoutineDayFilter] = useState(() => ({ from: hotelToday(), to: hotelToday() }));
    // Таблица: последние N дней (7/14/31) или свои даты from/to
    const [routineMatrixFilter, setRoutineMatrixFilter] = useState(() => ({ days: 14, from: '', to: '' }));
    const [routineCustomDraft, setRoutineCustomDraft] = useState(() => ({ from: '', to: '' }));
    const [routineCustomOpen, setRoutineCustomOpen] = useState(false);
    const [routineHistory, setRoutineHistory] = useState({ open: false, loading: false, task: null, history: [] });

    const [plannedReport, setPlannedReport] = useState({ loading: false, data: null, error: null });
    const [plannedReportFilter, setPlannedReportFilter] = useState(() => ({ from: hotelToday(), to: hotelToday() }));
    // Раскрытые плитки отчётов (заявки «rt…», плановые «pl…»): плановая раскрывается на месте и показывает «что было сделано»
    const [openRep, setOpenRep] = useState(() => new Set());
    const ht = uiText('head', lang);
    const [showToast, toastNode] = useToast();

    // Какие пункты чек-листа номера сейчас развёрнуты (показывают кнопки статуса).
    // id пунктов общие для всех номеров (единый справочник room_checklist_dict),
    // поэтому сбрасываем при переходе к другому номеру.
    const [expandedChecklistItems, setExpandedChecklistItems] = useState(() => new Set());
    useEffect(() => {
        setExpandedChecklistItems(new Set());
    }, [selectedRoomTask?.id]);
    const toggleChecklistItemExpanded = (itemId) => {
        setExpandedChecklistItems(prev => {
            const next = new Set(prev);
            next.has(itemId) ? next.delete(itemId) : next.add(itemId);
            return next;
        });
    };
    const jerusalemToday = () => hotelToday(); // дата по часам отеля

    // Закрытия, которые ещё ждут отправки: 'routine:5' и т.п. Такие задачи показываем уже закрытыми.
    const queuedRef = useRef(new Set());
    const syncQueued = async () => {
        const ops = await pendingOps(user.id);
        queuedRef.current = new Set(ops.filter(o => o.kind === 'close' && o.payload.is_done).map(o => `${o.payload.task_type}:${o.payload.task_id}`));
    };
    const overlayQueued = (list) => {
        const q = queuedRef.current;
        if (!q.size) return list;
        const out = { ...list };
        ['urgent', 'planned'].forEach(type => { out[type] = (out[type] || []).filter(t => !q.has(`${type}:${t.id}`)); });
        out.routine = (out.routine || []).map(t => q.has(`routine:${t.id}`) ? { ...t, status: 'done', _queued: true } : t);
        return out;
    };

    const applyTasksData = (data) => {
        setTasks(overlayQueued(data.tasks));
        const initialStates = {};
        ['urgent', 'planned', 'routine'].forEach(type => {
            (data.tasks[type] || []).forEach(t => {
                // У регламентов id пересекаются с id заявок — ключ с префиксом «r»
                const key = type === 'routine' ? 'r' + t.id : t.id;
                initialStates[key] = {
                    isDone: t.status === 'done',
                    notes: t.notes || '',
                    checklist: t.checklist || [],
                    media: t.media || [],
                    // { value, unit, error } — сохранённое показание или результат после close
                    ocr: (type === 'routine' && t.ocr_value) ? { value: t.ocr_value, unit: t.ocr_unit || '' } : null,
                    isRepeat: false
                };
            });
        });
        // Фото, снятые без сети и ещё не отправленные, не теряем при обновлении списка
        setTaskState(prev => {
            Object.keys(prev).forEach(k => {
                const local = (prev[k]?.media || []).filter(m => m && m.localId);
                const q = queuedRef.current;
                const closed = String(k).startsWith('r') ? q.has(`routine:${String(k).slice(1)}`) : (q.has(`urgent:${k}`) || q.has(`planned:${k}`));
                if (local.length && initialStates[k] && !closed) {
                    initialStates[k] = { ...prev[k] };
                }
            });
            return initialStates;
        });
        const loadedDate = data.today || jerusalemToday();
        loadedDateRef.current = loadedDate;
        setTodayStr(loadedDate);
    };

    const loadWorkerTasks = async (silent = false) => {
        if (!silent) setIsLoading(true);
        const workerId = user.id || 1;
        await syncQueued().catch(() => {});
        try {
            const res = await fetch(`/backend/api/get_worker_tasks.php?lang=${lang}&worker_id=${workerId}`);
            if (!res.ok) throw new Error('http_' + res.status);
            const data = await res.json();
            if (data.success) {
                applyTasksData(data);
                try { localStorage.setItem(tasksCacheKey(workerId, lang), JSON.stringify(data)); } catch { /* нет места */ }
            }
        } catch (e) {
            // Нет связи — показываем последний сохранённый список
            console.error("Ошибка загрузки задач:", e);
            try {
                const cached = JSON.parse(localStorage.getItem(tasksCacheKey(workerId, lang)) || 'null');
                if (cached?.success && !silent) applyTasksData(cached);
                else if (cached?.success) setTasks(prev => overlayQueued(prev));
            } catch { /* ignore */ }
        } finally {
            setIsLoading(false);
        }
    };

    // Очередь отправки: когда что-то дошло до сервера — обновляем список
    const outbox = useOutbox(user.id, () => { loadWorkerTasks(true); });

    useEffect(() => {
        loadWorkerTasks();
    }, [lang]);

    // Срочные заявки: обновляем только этот список (не трогая то, что исполнитель вводит в других),
    // когда пришло уведомление, когда вернулись в приложение и раз в минуту
    const refreshUrgent = async () => {
        try {
            const res = await fetch(`/backend/api/get_worker_tasks.php?lang=${lang}&worker_id=${user.id || 1}`);
            const data = res.ok ? await res.json() : null;
            if (!data?.success) return;
            const urgent = overlayQueued({ urgent: data.tasks.urgent || [] }).urgent;
            setTasks(prev => ({ ...prev, urgent }));
            setTaskState(prev => {
                const next = { ...prev };
                urgent.forEach(t => {
                    if (!next[t.id]) next[t.id] = { isDone: t.status === 'done', notes: t.notes || '', checklist: [], media: t.media || [], ocr: null, isRepeat: false };
                });
                return next;
            });
        } catch { /* нет сети — обновимся позже */ }
    };

    const openUrgentTab = () => {
        setHeadMode('work');
        setActiveTab('urgent');
        setSelectedRoomTask(null);
    };

    useEffect(() => {
        if (!pushEligible) return;
        syncPush(userRole);
        // Открыли из уведомления: ?tab=urgent
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') === 'urgent') {
            openUrgentTab();
            params.delete('tab');
            const q = params.toString();
            window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
        }
        const onSwMessage = (e) => {
            if (e.data?.type === 'urgent-refresh') refreshUrgent();
            if (e.data?.type === 'urgent-open') {
                // Заявка другого отеля — переключиться в него и открыть срочные там
                const hid = Number(e.data.hotel_id);
                if (hid && hid !== getBrand().hotel?.id) {
                    window.history.replaceState(null, '', window.location.pathname + '?tab=urgent');
                    switchHotel(hid);
                    return;
                }
                openUrgentTab(); refreshUrgent();
            }
        };
        const onVisible = () => { if (document.visibilityState === 'visible') refreshUrgent(); };
        navigator.serviceWorker?.addEventListener('message', onSwMessage);
        document.addEventListener('visibilitychange', onVisible);
        const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshUrgent(); }, 60000);
        return () => {
            navigator.serviceWorker?.removeEventListener('message', onSwMessage);
            document.removeEventListener('visibilitychange', onVisible);
            clearInterval(timer);
        };
    }, [lang]);

    // Цифра на иконке приложения = сколько срочных заявок ещё не выполнено
    useEffect(() => {
        if (!pushEligible || isLoading) return;
        syncUrgentBadge((tasks.urgent || []).filter(t => t.status !== 'done').map(t => ({
            id: t.id,
            text: [t.location || t.asset_key, (t.description || '').replace(/\s+/g, ' ').slice(0, 120)].filter(Boolean).join(' · ')
        })), lang);
    }, [tasks.urgent, isLoading]);

    // Каждые сутки регламенты обновляются: как только наступила новая дата — перезагружаем список
    useEffect(() => {
        const check = () => {
            if (loadedDateRef.current && loadedDateRef.current !== jerusalemToday()) {
                setRoutineView(null);
                loadWorkerTasks(true);
            }
        };
        const timer = setInterval(check, 60000);
        const onVisible = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [lang]);

    const openPlannedCreate = async () => {
        setPlannedCreateView(true);
        setSelectedWorkerIds([]);
        setSelectedRoomIds([]);
        setExpandedBuildings(new Set());
        setExpandedFloors(new Set());
        if (plannedFormData) return; // уже загружено в этой сессии
        setPlannedFormLoading(true);
        try {
            const res = await fetch(`/backend/api/get_planned_form_data.php?lang=${user.lang || 'en'}`);
            const data = await res.json();
            if (data.success) setPlannedFormData({ workers: data.workers || [], buildings: data.buildings || [] });
        } catch (e) {
            alert(errText(lang, 'network'));
        } finally {
            setPlannedFormLoading(false);
        }
    };

    const toggleWorker = (id) => {
        setSelectedWorkerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };
    const toggleRoom = (id) => {
        setSelectedRoomIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };
    const allRoomIds = () => (plannedFormData?.buildings || []).flatMap(b => b.floors.flatMap(f => f.rooms.map(r => r.id)));
    const buildingRoomIds = (bName) => (plannedFormData?.buildings || []).find(b => b.name === bName)?.floors.flatMap(f => f.rooms.map(r => r.id)) || [];
    const floorRoomIds = (bName, fName) => (plannedFormData?.buildings || []).find(b => b.name === bName)?.floors.find(f => f.name === fName)?.rooms.map(r => r.id) || [];

    const toggleBuildingExpanded = (bName) => {
        setExpandedBuildings(prev => {
            const next = new Set(prev);
            next.has(bName) ? next.delete(bName) : next.add(bName);
            return next;
        });
    };
    const toggleFloorExpanded = (key) => {
        setExpandedFloors(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    };
    const countSelected = (ids) => ids.filter(id => selectedRoomIds.includes(id)).length;

    const toggleAllRooms = (select) => setSelectedRoomIds(select ? allRoomIds() : []);
    const toggleGroupRooms = (ids) => {
        const allSelected = ids.every(id => selectedRoomIds.includes(id));
        setSelectedRoomIds(prev => allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
    };

    const submitPlannedCreate = async () => {
        if (selectedWorkerIds.length === 0) { showToast(text.err_select_worker); return; }
        if (selectedRoomIds.length === 0) { showToast(text.err_select_room); return; }
        setPlannedSubmitting(true);
        try {
            const res = await fetch('/backend/api/create_planned_tasks.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ worker_ids: selectedWorkerIds, room_ids: selectedRoomIds, creator_id: user.id })
            });
            const data = await res.json();
            if (data.success) {
                setPlannedCreateView(false);
                loadWorkerTasks(true);
                const made = Number(data.created) || 0, skip = Number(data.skipped) || 0;
                showToast(`${ht.created}: ${made}` + (skip ? ` · ${ht.skipped}: ${skip}` : ''));
            } else {
                alert(errText(lang, 'create_failed', data.message));
            }
        } catch (e) {
            alert(errText(lang, 'network'));
        } finally {
            setPlannedSubmitting(false);
        }
    };

    // ---------- ОТЧЁТЫ: загрузчики ----------
    const loadTasksReport = async (filter = tasksReportFilter) => {
        setTasksReport(prev => ({ ...prev, loading: true, error: null }));
        try {
            const params = new URLSearchParams({ from: filter.from, to: filter.to, type: filter.type, lang: user.lang || 'en' });
            const res = await fetch(`/backend/api/get_tasks_report.php?${params}`);
            const data = await res.json();
            if (data.success) setTasksReport({ loading: false, data, error: null });
            else setTasksReport({ loading: false, data: null, error: 'error' });
        } catch (e) {
            setTasksReport({ loading: false, data: null, error: 'network' });
        }
    };

    const routineMatrixQuery = (f = routineMatrixFilter) => {
        const q = f.from && f.to ? { from: f.from, to: f.to } : { days: f.days };
        return new URLSearchParams({ ...q, lang: user.lang || 'en' });
    };

    const loadRoutineReport = async (filter = routineMatrixFilter) => {
        setRoutineReport(prev => ({ ...prev, loading: true, error: null }));
        try {
            const params = routineMatrixQuery(filter);
            const res = await fetch(`/backend/api/get_routine_matrix.php?${params}`);
            const data = await res.json();
            if (data.success) setRoutineReport({ loading: false, data, error: null });
            else setRoutineReport({ loading: false, data: null, error: 'error' });
        } catch (e) {
            setRoutineReport({ loading: false, data: null, error: 'network' });
        }
    };

    const openRoutineHistory = async (task) => {
        setRoutineHistory({ open: true, loading: true, task, history: [] });
        try {
            const params = new URLSearchParams({ history_task_id: task.id, days: 90, lang: user.lang || 'en' });
            const res = await fetch(`/backend/api/get_routine_matrix.php?${params}`);
            const data = await res.json();
            setRoutineHistory({ open: true, loading: false, task, history: data.success ? (data.history || []) : [] });
        } catch (e) {
            setRoutineHistory({ open: true, loading: false, task, history: [] });
        }
    };

    const loadPlannedReport = async (filter = plannedReportFilter) => {
        setPlannedReport(prev => ({ ...prev, loading: true, error: null }));
        try {
            const params = new URLSearchParams({ from: filter.from, to: filter.to, lang: user.lang || 'en' });
            const res = await fetch(`/backend/api/get_planned_report.php?${params}`);
            const data = await res.json();
            if (data.success) setPlannedReport({ loading: false, data, error: null });
            else setPlannedReport({ loading: false, data: null, error: 'error' });
        } catch (e) {
            setPlannedReport({ loading: false, data: null, error: 'network' });
        }
    };

    // Первая загрузка отчёта при заходе на вкладку/под-вкладку
    useEffect(() => {
        if (!showReports) return;
        if (reportView === 'tasks' && !tasksReport.data && !tasksReport.loading) loadTasksReport();
        if (reportView === 'routine' && routineMode === 'matrix' && !routineReport.data && !routineReport.loading) loadRoutineReport();
        if (reportView === 'planned' && !plannedReport.data && !plannedReport.loading) loadPlannedReport();
    }, [showReports, reportView, routineMode]);

    // Смена языка в меню: отчёты уже загружены на старом языке (названия задач приходят с сервера).
    // Открытый отчёт загружаем заново, остальные — при следующем заходе.
    const reportsLang = useRef(lang);
    useEffect(() => {
        if (reportsLang.current === lang) return;
        reportsLang.current = lang;
        const empty = { loading: false, data: null, error: null };
        setTasksReport(empty); setRoutineReport(empty); setPlannedReport(empty);
        if (!showReports) return;
        if (reportView === 'tasks') loadTasksReport();
        if (reportView === 'routine' && routineMode === 'matrix') loadRoutineReport();
        if (reportView === 'planned') loadPlannedReport();
    }, [lang]);

    const openRoutine = (task, repeat = false) => {
        if (repeat) {
            // Повтор: чистая форма (без старых фото и примечаний)
            setTaskState(prev => ({
                ...prev,
                ['r' + task.id]: { isDone: true, notes: '', checklist: [], media: [], ocr: null, isRepeat: true }
            }));
        }
        setRoutineView({ task, repeat });
    };

    const handleCheckboxChange = (taskId) => {
        setTaskState(prev => ({
            ...prev,
            [taskId]: { ...prev[taskId], isDone: !prev[taskId]?.isDone }
        }));
    };

    // Статус пункта чек-листа номера: 'pending' (не проверено) | 'ok' (проверено) | 'fixed' (заменено)
    // ('defect' в БД тоже поддерживается и показывается в отчёте, но из этого экрана пока не ставится)
    const handleChecklistItemStatus = (taskId, itemId, status) => {
        setTaskState(prev => {
            const currentTaskState = prev[taskId] || { checklist: [] };
            const updatedChecklist = currentTaskState.checklist.map(item =>
                item.id === itemId ? { ...item, status } : item
            );
            return {
                ...prev,
                [taskId]: { ...currentTaskState, checklist: updatedChecklist }
            };
        });
    };

    const handleNotesChange = (taskId, textVal) => {
        setTaskState(prev => ({
            ...prev,
            [taskId]: { ...prev[taskId], notes: textVal }
        }));
    };

    // Сохранение медиа.
    // Фото сразу появляется в задаче и сохраняется в памяти телефона, затем отправляется на сервер.
    // Нет связи — фото остаётся в телефоне и уйдёт вместе с закрытием задачи, когда появится интернет.
    const setMediaItem = (taskId, localId, patch) => {
        setTaskState(prev => {
            const media = prev[taskId]?.media;
            if (!media) return prev;
            return { ...prev, [taskId]: { ...prev[taskId], media: media.map(m => (m && m.localId === localId) ? patch(m) : m) } };
        });
    };

    const handleAddMedia = async (taskId, type, dataUrlOrFile) => {
        setIsCameraOpenFor(null);

        let blob;
        try {
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
        try {
            localId = await saveFile(user.id, blob, type);
        } catch (e) {
            // Память телефона недоступна (приватный режим) — работаем как раньше, только через сеть
            console.error('Local save error:', e);
        }

        if (!localId) {
            try {
                const url = await uploadNow(blob, type);
                setTaskState(prev => ({ ...prev, [taskId]: { ...prev[taskId], media: [...(prev[taskId]?.media || []), { type, url }] } }));
            } catch (e) {
                alert(errText(lang, e instanceof ServerError ? 'upload_save' : 'upload_fail'));
            }
            return;
        }

        const previewUrl = URL.createObjectURL(blob);
        setTaskState(prev => ({
            ...prev,
            [taskId]: { ...prev[taskId], media: [...(prev[taskId]?.media || []), { type, url: previewUrl, localId }] }
        }));

        try {
            const url = await uploadNow(blob, type);
            // Дошло — дальше задача ссылается на файл на сервере, копию в телефоне можно убрать
            setMediaItem(taskId, localId, () => ({ type, url }));
            deleteFile(localId);
        } catch (e) {
            if (e instanceof ServerError) {
                setTaskState(prev => ({ ...prev, [taskId]: { ...prev[taskId], media: (prev[taskId]?.media || []).filter(m => !(m && m.localId === localId)) } }));
                deleteFile(localId);
                alert(errText(lang, 'upload_save', e.message));
            }
            // Нет связи — фото остаётся в телефоне (значок ⏳), отправится позже
        }
    };

    const handleDeleteMedia = (taskId, index) => {
        setTaskState(prev => {
            const currentMedia = prev[taskId]?.media || [];
            const removed = currentMedia[index];
            if (removed && removed.localId) deleteFile(removed.localId);
            return {
                ...prev,
                [taskId]: {
                    ...prev[taskId],
                    media: currentMedia.filter((_, i) => i !== index)
                }
            };
        });
    };

    const handleUploadFromDisk = (taskId) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = async (e) => {
            const files = Array.from(e.target.files);
            for (const file of files) {
                await handleAddMedia(taskId, 'photo', file);
            }
        };
        input.click();
    };

    // Общая отправка закрытия задачи на сервер.
    // overrideOcrManualValue === undefined  -> обычное закрытие (для счётчика запускается автораспознавание ИИ)
    // overrideOcrManualValue !== undefined  -> финальное подтверждение значения из окна проверки ИИ
    const closingRef = useRef(false);
    const [closing, setClosing] = useState(false);
    const submitClose = async (taskId, taskType, overrideOcrManualValue = undefined) => {
        const stateKey = taskType === 'routine' ? 'r' + taskId : taskId;
        const state = taskState[stateKey] || { isDone: true, notes: '', checklist: [], media: [] };
        const isConfirmStep = overrideOcrManualValue !== undefined;
        const ocrManualValue = isConfirmStep ? overrideOcrManualValue : null;

        // Счётчик: без фото закрывать нельзя (распознаёт потом администратор по фото)
        const routineTask = taskType === 'routine' ? (tasks.routine || []).find(t => t.id === taskId) : null;
        const hasPhoto = (state.media || []).some(m => {
            const url = typeof m === 'string' ? m : (m.url || '');
            return !(typeof m === 'object' && m.type === 'video') && !/\.(mp4|mov|avi|webm)$/i.test(url);
        });
        if (routineTask?.requires_ocr && !isConfirmStep && !hasPhoto) {
            alert(text.meter_need_photo);
            return;
        }

        const payload = {
            task_id: taskId,
            task_type: taskType,
            worker_id: user.id,
            lang: user.lang || 'en',
            // У регламентов и у экрана номера (плановые) нет отдельного чекбокса «Выполнено» —
            // сама кнопка «Закрыть заявку» на этих экранах и означает «выполнено».
            // У срочных заявок чекбокс есть и его значение уважаем.
            // Галочки «Выполнено» больше нет: закрытие всегда означает «выполнено»
            is_done: true,
            notes: state.notes,
            checklist: state.checklist,
            media: state.media,
            ocr_manual_value: ocrManualValue,
            is_repeat: !!state.isRepeat
        };

        if (closingRef.current) return; // повторное нажатие, пока идёт отправка
        closingRef.current = true;
        setClosing(true);
        let result;
        try {
            // Сразу на сервер; нет связи — в очередь на телефоне, уйдёт само
            result = await submitOrQueue(makeOp(user.id, 'close', payload));
        } catch (e) {
            if (e instanceof ServerError) alert(errText(lang, 'close_failed', e.message));
            else alert(errText(lang, 'network'));
            return;
        } finally {
            closingRef.current = false;
            setClosing(false);
        }

        if (taskType === 'routine') dropRepeat(taskId);

        if (result.queued) {
            // Показываем задачу закрытой, как будто сервер уже ответил
            if (payload.is_done) {
                queuedRef.current.add(`${taskType}:${taskId}`);
                setTasks(prev => overlayQueued(prev));
            }
            setSelectedRoomTask(null);
            setRoutineView(null);
            return;
        }

        const data = result.data;
        if (data.ocr && !isConfirmStep) {
            // ИИ только что распознал показание счётчика — просим работника проверить/подкорректировать
            setTaskState(prev => ({
                ...prev,
                [stateKey]: { ...prev[stateKey], ocr: data.ocr }
            }));
            setOcrModalTask({
                taskId,
                taskType,
                value: data.ocr.value || '',
                unit: data.ocr.unit || '',
                error: data.ocr.error || null,
                engine: data.ocr.engine || null
            });
        } else {
            // Обычная задача, фото счётчика (показание впишет администратор)
            // либо подтверждённое значение из старого окна проверки ИИ.
            // Без окна «Заявка закрыта» — задача просто исчезает из списка.
            setSelectedRoomTask(null);
            setRoutineView(null);
            loadWorkerTasks(true);
        }
    };

    const handleCloseTask = (taskId, taskType) => submitClose(taskId, taskType);

    // ---------- НОВЫЙ ЭКРАН ИСПОЛНИТЕЛЯ: плитки ----------
    const wt = uiText('work', lang);
    // Регламенты, которые выполняются повторно (плитка снова активна)
    const [repeatIds, setRepeatIds] = useState(() => new Set());
    const [viewer, setViewer] = useState(null);
    function dropRepeat(taskId) {
        setRepeatIds(prev => { if (!prev.has(taskId)) return prev; const n = new Set(prev); n.delete(taskId); return n; });
    }
    const workCtx = {
        t: wt, taskState, closing, repeatIds,
        onClose: handleCloseTask,
        onNotes: handleNotesChange,
        onChecklist: handleChecklistItemStatus,
        onAllOk: (taskId) => setTaskState(prev => ({
            ...prev,
            [taskId]: { ...prev[taskId], checklist: (prev[taskId]?.checklist || []).map(i => (i.status || (i.done ? 'ok' : 'pending')) === 'pending' ? { ...i, status: 'ok' } : i) }
        })),
        onCamera: (key) => setIsCameraOpenFor(key),
        onDisk: handleUploadFromDisk,
        onDeleteMedia: handleDeleteMedia,
        // Переснять счётчик: убираем снятые фото и снова открываем камеру
        onRetake: (key) => {
            (taskState[key]?.media || []).forEach(m => { if (m && m.localId) deleteFile(m.localId); });
            setTaskState(prev => ({ ...prev, [key]: { ...prev[key], media: [] } }));
            setIsCameraOpenFor(key);
        },
        // Повтор регламента: чистая форма, прежний результат остаётся в истории
        onRepeat: (task) => {
            setTaskState(prev => ({ ...prev, ['r' + task.id]: { isDone: true, notes: '', checklist: [], media: [], ocr: null, isRepeat: true } }));
            setRepeatIds(prev => new Set(prev).add(task.id));
        },
        onCancelRepeat: (task) => {
            dropRepeat(task.id);
            setTaskState(prev => ({ ...prev, ['r' + task.id]: { isDone: true, notes: task.notes || '', checklist: [], media: task.media || [], ocr: null, isRepeat: false } }));
        },
        openViewer: (items, index, caption) => setViewer({ items, index, caption })
    };

    // Подтверждение (или правка) значения ИИ в модальном окне
    const confirmOcrValue = (taskId, taskType, value) => {
        setOcrModalTask(null);
        submitClose(taskId, taskType, value);
    };

    const currentTasksList = tasks[activeTab] || [];

    // ---------- ОТЧЁТЫ: мини-график (без зависимостей, чистый SVG) ----------
    // На иврите/арабском зеркальный: время справа налево, шкала значений справа
    const MiniLineChart = ({ points, unit }) => {
        const w = 360, h = 200, pad = 22, padS = 56; // padS — сторона со шкалой значений
        const rtl = dir === 'rtl';
        const valid = points.filter(p => p.value !== null && p.value !== undefined);
        if (valid.length === 0) {
            return <div className="hd-empty">{text.rep_no_history}</div>;
        }
        const values = valid.map(p => p.value);
        let minV = Math.min(...values), maxV = Math.max(...values);
        if (minV === maxV) { minV -= 1; maxV += 1; }
        const x0 = rtl ? pad : padS, x1 = rtl ? w - padS : w - pad;
        const xStep = valid.length > 1 ? (x1 - x0) / (valid.length - 1) : 0;
        const xOf = i => rtl ? x1 - i * xStep : x0 + i * xStep;
        const yOf = v => h - 30 - ((v - minV) / (maxV - minV)) * (h - 30 - pad);
        const path = valid.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(' ');
        const step = Math.max(1, Math.ceil(valid.length / 5));
        const axisX = rtl ? x1 : x0, lblX = rtl ? x1 + 5 : x0 - 5, anchor = rtl ? 'start' : 'end';
        const num = v => Number(v).toLocaleString(localeOf(lang), { maximumFractionDigits: 1 });
        return (
            <div>
                <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block', direction: 'ltr' }} role="img" aria-label={unit}>
                    <line x1={x0} y1={h - 30} x2={x1} y2={h - 30} stroke="#ebe3dc" strokeWidth="1" />
                    <line x1={axisX} y1={pad} x2={axisX} y2={h - 30} stroke="#ebe3dc" strokeWidth="1" />
                    <text x={lblX} y={pad + 4} fontSize="11" fill="#7d726a" textAnchor={anchor}>{num(maxV)}</text>
                    <text x={lblX} y={h - 30 + 4} fontSize="11" fill="#7d726a" textAnchor={anchor}>{num(minV)}</text>
                    <path d={path} fill="none" stroke="#2a5f96" strokeWidth="2.2" strokeLinejoin="round" />
                    {valid.map((p, i) => (
                        <circle key={i} cx={xOf(i)} cy={yOf(p.value)} r={valid.length > 40 ? 2.2 : 3.4} fill="#2a5f96" />
                    ))}
                    {valid.map((p, i) => (
                        (i % step === 0 && valid.length - 1 - i >= step / 2) || i === valid.length - 1 ? (
                            <text key={'lbl' + i} x={xOf(i)} y={h - 12} fontSize="10" fill="#7d726a" textAnchor="middle">
                                {p.date.slice(8, 10)}.{p.date.slice(5, 7)}
                            </text>
                        ) : null
                    ))}
                </svg>
                {unit && <div className="hd-hint" style={{ textAlign: 'center' }}>{unit}</div>}
            </div>
        );
    };

    const repLabels = { pending: text.rep_status_pending, in_progress: text.rep_status_in_progress, done: text.rep_status_done };
    const chkLabels = { pending: text.chk_pending, ok: text.chk_ok, defect: text.chk_defect, fixed: text.chk_fixed };
    const fmtDateOnly = (ymd) => ymd ? fmtYmd(ymd, lang) : '';
    const toggleRep = (k) => setOpenRep(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
    // Плитка раскрывается нажатием (и клавишей Enter/пробел); клики внутри подробностей её не закрывают
    const tileProps = (k) => ({
        role: 'button', tabIndex: 0, 'aria-expanded': openRep.has(k),
        onClick: (e) => { if (e.target.closest('.hd-more, a, button, video')) return; toggleRep(k); },
        onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggleRep(k); } }
    });
    const openPhotos = (caption) => (items, index) => setViewer({ items, index, caption });
    const loadingBox = <div className="hd-empty">{text.rep_loading}</div>;
    const noData = <div className="hd-empty">{text.rep_no_data}</div>;

    // ---------- ОТЧЁТЫ: заявки (невыполненные, затем выполненные) ----------
    const renderTaskReport = () => {
        const rows = tasksReport.data?.tasks || [];
        const open = rows.filter(t => t.status !== 'done');
        const done = rows.filter(t => t.status === 'done');
        const tile = (t) => {
            const k = 'rt' + t.task_type + t.id;
            const isOpen = openRep.has(k);
            const worker = t.worker_name || (t.assigned_workers || []).join(', ') || text.rep_not_assigned;
            return (
                <div key={k} className={'hd-tile' + (t.task_type === 'current' ? ' u' : '') + (isOpen ? ' open' : '')} {...tileProps(k)}>
                    {isOpen && (
                        <div className="hd-meta">
                            <span>{text.rep_col_created}: <bdi>{fmtStamp(t.created_at)}</bdi></span>
                            <span>{text.rep_col_completed}: <bdi>{t.completed_at ? fmtStamp(t.completed_at) : '—'}</bdi></span>
                        </div>
                    )}
                    <div className="hd-row">
                        <div className="txt">
                            <div className="hd-place">{t.room || '—'}</div>
                            {t.description && <div className="hd-task">{t.description}</div>}
                        </div>
                        <StatusBadge status={t.status} labels={repLabels} />
                    </div>
                    {isOpen && (
                        <div className="hd-more">
                            <div className="hd-kvs">
                                <div className="hd-kv"><Icon n="user" />{text.rep_col_creator}: <b>{t.creator_name || '—'}</b></div>
                                <div className="hd-kv"><Icon n="tool" />{text.rep_col_worker}: <b>{worker}</b></div>
                            </div>
                        </div>
                    )}
                </div>
            );
        };
        return (
            <>
                <div className="hd-pad">
                    <ReportDateFilter lang={lang} value={tasksReportFilter}
                        onChange={v => { const f = { ...tasksReportFilter, ...v }; setTasksReportFilter(f); loadTasksReport(f); }} />
                </div>
                {tasksReport.loading ? loadingBox : rows.length === 0 ? noData : (
                    <>
                        {open.length > 0 && (<>
                            <div className="hd-sec2">{ht.s_open}<i>{open.length}</i></div>
                            <div className="hd-list tight grid">{open.map(tile)}</div>
                        </>)}
                        {done.length > 0 && (<>
                            <div className="hd-sec2">{ht.s_done}<i>{done.length}</i></div>
                            <div className="hd-list grid">{done.map(tile)}</div>
                        </>)}
                    </>
                )}
            </>
        );
    };

    // ---------- ОТЧЁТЫ: регламент (по дням) и таблица «регламент × день» ----------
    const renderRoutineReport = () => {
        // По умолчанию — что сделано за день/диапазон; кнопка «Таблица» открывает таблицу задача × дата
        if (routineMode === 'days') {
            return (
                <>
                    <div className="hd-pad">
                        <ReportDateFilter lang={lang} value={routineDayFilter} onChange={setRoutineDayFilter}>
                            <button type="button" className="hd-chp" onClick={() => setRoutineMode('matrix')}>
                                <Icon n="table" />{ht.table}
                            </button>
                        </ReportDateFilter>
                    </div>
                    <RoutineDayReport lang={lang} value={routineDayFilter} />
                </>
            );
        }

        const data = routineReport.data;
        const f = routineMatrixFilter;
        const custom = !!(f.from && f.to);
        const draftOk = routineCustomDraft.from && routineCustomDraft.to && routineCustomDraft.from <= routineCustomDraft.to;
        const applyMatrix = (nf) => { setRoutineMatrixFilter(nf); loadRoutineReport(nf); };
        const presetBtn = (active, label, onClick) => (
            <button key={label} type="button" className={'hd-chp' + (active ? ' on' : '')} aria-pressed={active} onClick={onClick}>{label}</button>
        );
        const today = hotelToday();
        const cell = (c) => {
            if (c.status === 'done') {
                return <span className="hd-cell-ok" title={c.ocr_value ? `${c.ocr_value} ${c.ocr_unit || ''}` : text.rep_status_done}>{c.ocr_value ? c.ocr_value : '✓'}</span>;
            }
            if (c.status === 'pending') {
                // Прошедший день — не выполнено (плашка как «Ожидает»), сегодня — ещё в работе
                return c.date < today
                    ? <span className="hd-cell-no" title={ht.not_done} aria-label={ht.not_done}>—</span>
                    : <span className="hd-cell-pend" title={text.rep_status_pending} />;
            }
            return <span className="hd-cell-none">·</span>;
        };
        return (
            <>
                <div className="hd-pad">
                    <button type="button" className="hd-btn" onClick={() => setRoutineMode('days')}><Icon n="back" />{ht.by_days}</button>
                </div>
                <div className="hd-pad">
                    <div className="hd-chips">
                        <span className="hd-lbl">{text.rep_days}:</span>
                        {[7, 14, 31].map(d => presetBtn(!custom && !routineCustomOpen && f.days === d, String(d), () => { setRoutineCustomOpen(false); applyMatrix({ days: d, from: '', to: '' }); }))}
                        {presetBtn(custom || routineCustomOpen, text.rep_custom, () => {
                            setRoutineCustomDraft(custom ? { from: f.from, to: f.to } : { from: data?.from || '', to: data?.to || hotelToday() });
                            setRoutineCustomOpen(true);
                        })}
                    </div>
                </div>
                {(custom || routineCustomOpen) && (
                    <div className="hd-pad hd-filter">
                        <div className="hd-row2">
                            <label>{text.rep_from}
                                <input type="date" className="hd-fld" value={routineCustomDraft.from} max={hotelToday()} onChange={e => setRoutineCustomDraft(d => ({ ...d, from: e.target.value }))} />
                            </label>
                            <label>{text.rep_to}
                                <input type="date" className="hd-fld" value={routineCustomDraft.to} max={hotelToday()} onChange={e => setRoutineCustomDraft(d => ({ ...d, to: e.target.value }))} />
                            </label>
                        </div>
                        <div>
                            <button type="button" className="hd-btn blue" disabled={!draftOk} onClick={() => applyMatrix({ days: f.days, from: routineCustomDraft.from, to: routineCustomDraft.to })}>
                                {text.rep_apply}
                            </button>
                        </div>
                    </div>
                )}
                <div className="hd-pad">
                    <a className="hd-btn green" href={`/backend/api/export_routine_excel.php?${routineMatrixQuery()}`}>
                        <Icon n="download" />{ht.excel}
                    </a>
                </div>
                {data && <div className="hd-pad hd-hint"><b><bdi>{fmtDateOnly(data.from)} — {fmtDateOnly(data.to)}</bdi></b> · {text.rep_matrix_hint}</div>}

                {routineReport.loading ? loadingBox : !data || (data.tasks || []).length === 0 ? noData : (
                    <div className="hd-mtx">
                        <table>
                            <thead>
                                <tr>
                                    <th className="nmc">{text.rep_routine}</th>
                                    {data.dates.map(d => <th key={d}>{d.slice(8, 10)}.{d.slice(5, 7)}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {data.tasks.map(t => (
                                    <tr key={t.id}>
                                        {t.requires_ocr ? (
                                            <td className="nmc mt" role="button" tabIndex={0} onClick={() => openRoutineHistory(t)}
                                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRoutineHistory(t); } }}>
                                                <Icon n="gauge" />{t.name}
                                            </td>
                                        ) : (
                                            <td className="nmc">{t.name}</td>
                                        )}
                                        {t.cells.map(c => <td key={c.date}>{cell(c)}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </>
        );
    };

    // «А-3 / 312» -> { name: '312', building: 'А', floor: '3' }
    const splitRoom = (t) => {
        const room = t.room || '';
        if (t.building && room.startsWith(t.building + '-')) {
            const rest = room.slice(t.building.length + 1);
            const i = rest.indexOf(' / ');
            if (i >= 0) return { name: rest.slice(i + 3), building: t.building, floor: rest.slice(0, i) };
        }
        return { name: room || '—', building: null, floor: null };
    };

    // ---------- ОТЧЁТЫ: плановые задачи + покрытие ----------
    const renderPlannedReportView = () => {
        const data = plannedReport.data;
        const cov = data?.coverage;
        return (
            <>
                <div className="hd-pad">
                    <ReportDateFilter lang={lang} value={plannedReportFilter}
                        onChange={v => { setPlannedReportFilter(v); loadPlannedReport(v); }} />
                </div>

                {plannedReport.loading ? loadingBox : !data ? noData : (
                    <>
                        {cov && (
                            <div className="hd-prog">
                                <div className="hd-prog-top">
                                    <span>{text.rep_coverage}</span>
                                    <span><b><bdi>{cov.checked_rooms}</bdi></b> {text.rep_of} <bdi>{cov.total_rooms}</bdi></span>
                                </div>
                                <div className="hd-bar"><span style={{ width: `${cov.total_rooms ? Math.min(100, cov.checked_rooms / cov.total_rooms * 100) : 0}%` }} /></div>
                                {(cov.by_building || []).length > 0 && (
                                    <div className="hd-kv">
                                        {cov.by_building.map((b, i) => (
                                            <span key={b.building}>{i > 0 ? ' · ' : ''}{ht.bld} {b.building}: <b><bdi>{b.checked_rooms}/{b.total_rooms}</bdi></b></span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {(data.tasks || []).length === 0 ? noData : (
                            <div className="hd-list grid">
                                {data.tasks.map(t => {
                                    const k = 'pl' + t.id;
                                    const isOpen = openRep.has(k);
                                    const ch = t.checklist || { total: 0, checked: 0, defects: 0 };
                                    const pct = ch.total ? Math.round(ch.checked / ch.total * 100) : 0;
                                    const r = splitRoom(t);
                                    const place = r.building ? `${ht.room} ${r.name}` : r.name;
                                    return (
                                        <div key={t.id} className={'hd-tile' + (ch.defects > 0 ? ' s-amber' : t.status === 'done' ? ' s-green' : '') + (isOpen ? ' open' : '')} {...tileProps(k)}>
                                            {isOpen && (
                                                <div className="hd-meta">
                                                    <span>{text.rep_col_created}: <bdi>{fmtStamp(t.created_at)}</bdi></span>
                                                    <span>{text.rep_col_completed}: <bdi>{t.completed_at ? fmtStamp(t.completed_at) : '—'}</bdi></span>
                                                </div>
                                            )}
                                            <div className="hd-row">
                                                <div className="txt">
                                                    <div className="hd-place">{place}</div>
                                                    {r.building && <div className="hd-sub2">{ht.bld} {r.building} · {ht.fl} <bdi>{r.floor}</bdi></div>}
                                                    <div className="hd-sub2">{text.rep_assigned}: <b>{(t.assigned_workers || []).join(', ') || text.rep_not_assigned}</b></div>
                                                </div>
                                                <StatusBadge status={t.status} labels={repLabels} />
                                            </div>
                                            <div className="hd-barrow">
                                                <div className="hd-bar thin"><span className={ch.defects > 0 ? 'amber' : ''} style={{ width: `${pct}%` }} /></div>
                                                <span className="hd-kv"><bdi>{ch.checked}/{ch.total}</bdi> {text.rep_checklist_progress}</span>
                                            </div>
                                            {ch.defects > 0 && <div className="hd-warn"><Icon n="warn" /><bdi>{ch.defects}</bdi> {text.rep_defects}</div>}
                                            {isOpen && (
                                                <div className="hd-more">
                                                    <div className="hd-h">{text.rep_detail_title}</div>
                                                    <div className="hd-kv">{text.rep_col_creator}: <b>{t.creator_name || '—'}</b></div>
                                                    <div>
                                                        <div className="hd-lbl">{text.rep_detail_notes}</div>
                                                        {t.notes ? <div className="hd-note">{t.notes}</div> : <div className="hd-note none">{text.rep_detail_no_notes}</div>}
                                                    </div>
                                                    <div>
                                                        <div className="hd-lbl">{text.rep_detail_media}</div>
                                                        {(t.media || []).length > 0
                                                            ? <Thumbs items={t.media} onOpen={openPhotos(place)} />
                                                            : <div className="hd-note none">{text.rep_detail_no_media}</div>}
                                                    </div>
                                                    <div className="hd-lbl">{text.rep_detail_checklist}</div>
                                                    {(t.checklist_items || []).length > 0 ? (
                                                        <div className="hd-chk">
                                                            {t.checklist_items.map((it, i) => (
                                                                <div key={i} className="hd-li">
                                                                    <span>{it.name}{it.comment && <small>{it.comment}</small>}</span>
                                                                    <CheckBadge status={it.status} labels={chkLabels} />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : <div className="hd-note none">{text.rep_no_data}</div>}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </>
        );
    };

    // ---------- ОТЧЁТЫ: контейнер с под-вкладками ----------
    const renderReports = () => (
        <>
            <div className="hd hd-sub" role="tablist">
                {[
                    { key: 'tasks', label: text.rep_tasks },
                    { key: 'routine', label: text.rep_routine },
                    { key: 'planned', label: text.rep_planned },
                    { key: 'meters', label: text.rep_meters },
                ].map(sv => (
                    <button key={sv.key} type="button" role="tab" aria-selected={reportView === sv.key} className={reportView === sv.key ? 'on' : ''}
                        onClick={() => setReportView(sv.key)}>
                        {sv.label}
                    </button>
                ))}
            </div>
            <div style={{ padding: '0 12px' }}><OfflineBanner userId={user.id} lang={lang} status={outbox} /></div>

            <div className="hd">
                {reportView === 'tasks' && renderTaskReport()}
                {reportView === 'routine' && renderRoutineReport()}
                {reportView === 'planned' && renderPlannedReportView()}
                {reportView === 'meters' && <MeterReport lang={lang} />}
            </div>
        </>
    );

    // ---------- ПЛАНОВЫЕ: экран создания (выбор исполнителей и номеров) ----------
    const renderPlannedCreate = () => {
        const buildings = plannedFormData?.buildings || [];
        const workers = plannedFormData?.workers || [];
        return (
            <div className="hd">
                <div className="hd-pad">
                    <button type="button" className="hd-btn" onClick={() => setPlannedCreateView(false)}><Icon n="back" />{ht.back_planned}</button>
                </div>

                {plannedFormLoading ? loadingBox : (
                    <div className="hd-list">
                        <div className="hd-card">
                            <div className="hd-lbl">{text.select_workers}</div>
                            <div className="hd-chips">
                                {workers.map(w => {
                                    const on = selectedWorkerIds.includes(w.id);
                                    return (
                                        <button key={w.id} type="button" className={'hd-chp sel' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggleWorker(w.id)}>
                                            {on && <Icon n="check" />}{w.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="hd-card">
                            <div className="hd-lbl">{text.select_rooms} (<bdi>{selectedRoomIds.length}</bdi>)</div>
                            <div className="hd-btnrow">
                                <button type="button" className="hd-btn sm" onClick={() => toggleAllRooms(true)}>{ht.sel_all}</button>
                                <button type="button" className="hd-btn sm" onClick={() => toggleAllRooms(false)}>{ht.sel_none}</button>
                            </div>
                            {buildings.map(b => {
                                const bOpen = expandedBuildings.has(b.name);
                                const bIds = buildingRoomIds(b.name);
                                const bSelCount = countSelected(bIds);
                                return (
                                    <div key={b.name} className="hd-grp">
                                        <div className={'hd-grp-h' + (bOpen ? ' open' : '')} role="button" tabIndex={0} aria-expanded={bOpen}
                                            onClick={() => toggleBuildingExpanded(b.name)}
                                            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggleBuildingExpanded(b.name); } }}>
                                            <Icon n="chev" />
                                            <b>{text.building_word} {b.name}</b>
                                            {bSelCount > 0 && <i className="hd-cnt">{bSelCount}</i>}
                                            <span className="sp" />
                                            <button type="button" className="hd-btn sm" onClick={(e) => { e.stopPropagation(); toggleGroupRooms(bIds); }}>{text.select_all_building}</button>
                                        </div>
                                        {bOpen && (
                                            <div className="hd-grp-b">
                                                {b.floors.map(f => {
                                                    const fKey = b.name + '|' + f.name;
                                                    const fOpen = expandedFloors.has(fKey);
                                                    const fIds = floorRoomIds(b.name, f.name);
                                                    const fSelCount = countSelected(fIds);
                                                    return (
                                                        <div key={f.name} className="hd-fl">
                                                            <div className={'hd-grp-h' + (fOpen ? ' open' : '')} role="button" tabIndex={0} aria-expanded={fOpen}
                                                                onClick={() => toggleFloorExpanded(fKey)}
                                                                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggleFloorExpanded(fKey); } }}>
                                                                <Icon n="chev" />
                                                                <b>{text.floor_word} {f.name}</b>
                                                                {fSelCount > 0 && <i className="hd-cnt">{fSelCount}</i>}
                                                                <span className="sp" />
                                                                <button type="button" className="hd-btn sm" onClick={(e) => { e.stopPropagation(); toggleGroupRooms(fIds); }}>{text.select_all_floor}</button>
                                                            </div>
                                                            {fOpen && (
                                                                <div className="hd-chips">
                                                                    {f.rooms.map(r => {
                                                                        const on = selectedRoomIds.includes(r.id);
                                                                        return (
                                                                            <button key={r.id} type="button" className={'hd-chp sel' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggleRoom(r.id)}>
                                                                                {on && <Icon n="check" />}{r.name}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <button type="button" className="hd-big" onClick={submitPlannedCreate} disabled={plannedSubmitting}>
                            {text.create_planned_submit}
                        </button>
                    </div>
                )}
            </div>
        );
    };

    // ---------- РЕГЛАМЕНТЫ: список ----------
    const renderRoutineList = () => {
        // Счётчики — наверху списка, чтобы их не искать (сервер сортирует так же)
        const list = [...(tasks.routine || [])].sort((a, b) => (b.requires_ocr ? 1 : 0) - (a.requires_ocr ? 1 : 0));
        if (list.length === 0) {
            return <div style={{ color: '#6e635b', fontStyle: 'italic', textAlign: 'center', padding: '30px' }}>{text.no_tasks}</div>;
        }
        const doneCount = list.filter(t => t.status === 'done').length;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '16px', color: '#6e635b', marginBottom: '4px' }}>
                    <span>📅 {text.routine_today}: {todayStr}</span>
                    <b style={{ color: doneCount === list.length ? '#1f7a4f' : '#3f3530' }}>{text.routine_progress}: {doneCount} / {list.length}</b>
                </div>
                {list.map(task => {
                    const done = task.status === 'done';
                    return (
                        <div
                            key={task.id}
                            onClick={() => openRoutine(task)}
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', minHeight: '64px', borderRadius: '12px', cursor: 'pointer', border: done ? '1px solid #b8ecc8' : '1px solid #ece4dd', background: done ? '#f3fbf6' : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', WebkitTapHighlightColor: 'transparent', boxSizing: 'border-box' }}
                        >
                            <span style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 'bold', background: done ? '#26875a' : '#fff', color: '#fff', border: done ? 'none' : '2px solid #d9cec5' }}>
                                {done ? '✓' : ''}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '17px', color: '#2b2320' }}>{task.description || text.routine_title}</div>
                                {task._queued && (
                                    <div style={{ fontSize: '14px', color: '#8a5a12', marginTop: '2px' }}>{text.queued_badge}</div>
                                )}
                                {task.requires_ocr && !task._queued && (
                                    <div style={{ fontSize: '14px', color: '#7a5a30', marginTop: '2px' }}>
                                        {task.ocr_pending > 0 ? text.meter_pending
                                            : done && task.ocr_value ? `📟 ${task.ocr_value} ${task.ocr_unit || ''}` : text.ocr_badge}
                                    </div>
                                )}
                            </div>
                            {done ? (
                                <button
                                    onClick={(e) => { e.stopPropagation(); openRoutine(task, true); }}
                                    style={{ minHeight: '38px', padding: '8px 12px', background: '#fff', color: 'var(--brand-button, #844128)', border: '1px solid #e6d0b2', borderRadius: '9px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', whiteSpace: 'nowrap' }}
                                >
                                    {text.repeat_btn}
                                </button>
                            ) : (
                                <span style={{ color: '#7d726a', fontSize: '24px' }}>{dir === 'rtl' ? '‹' : '›'}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    // ---------- РЕГЛАМЕНТЫ: экран задачи (как заявка) ----------
    const renderRoutineDetail = () => {
        const { task, repeat } = routineView;
        const key = 'r' + task.id;
        const st = taskState[key] || { notes: '', media: [], ocr: null };
        const readOnly = task.status === 'done' && !repeat;
        const mediaList = st.media || [];

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <button
                    onClick={() => setRoutineView(null)}
                    style={{ alignSelf: 'flex-start', padding: '6px 12px', background: '#f3ebe2', border: '1px solid #d9cec5', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#3f3530' }}
                >
                    {text.back_routine}
                </button>

                <div style={{ padding: '16px', borderRadius: '14px', border: '1px solid #ece4dd', background: '#fcf9f6', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '19px', color: '#2b2320' }}>📅 {task.description || text.routine_title}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {task.requires_ocr && (
                                <span style={{ fontSize: '14px', background: '#ecdfc9', color: '#7a5a30', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>{text.ocr_badge}</span>
                            )}
                            {readOnly && (
                                <span style={{ fontSize: '14px', background: task._queued ? '#fdf1dc' : '#dcfce7', color: task._queued ? '#8a5a12' : '#1f7a4f', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>{task._queued ? text.queued_badge : text.routine_done_badge}</span>
                            )}
                            <span style={{ fontSize: '14px', color: '#7d726a' }}>🕒 {todayStr}</span>
                        </div>
                    </div>

                    {repeat && (
                        <div style={{ fontSize: '15px', color: '#6a3320', background: '#f8efe6', padding: '8px 10px', borderRadius: '6px' }}>🔁 {text.repeat_note}</div>
                    )}

                    {/* Фото / видео */}
                    {mediaList.length > 0 ? (
                        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '5px', marginTop: '5px' }}>
                            {mediaList.map((item, i) => {
                                const url = typeof item === 'string' ? item : (item.url || '');
                                const isVideo = (typeof item === 'object' && item.type === 'video') || /\.(mp4|mov|avi)$/i.test(url);
                                const cleanUrl = mediaSrc(url);
                                return (
                                    <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                                        {isVideo ? (
                                            <video src={cleanUrl} controls style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc' }} />
                                        ) : (
                                            <a href={cleanUrl} target="_blank" rel="noreferrer">
                                                <img src={cleanUrl} alt="media" style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc' }} />
                                            </a>
                                        )}
                                        {typeof item === 'object' && item.localId && (
                                            <span title={text.queued_badge} style={{ position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(253,241,220,.95)', borderRadius: '8px', padding: '1px 5px', fontSize: '14px', lineHeight: 1.3 }}>⏳</span>
                                        )}
                                        {!readOnly && (
                                            <button
                                                onClick={() => handleDeleteMedia(key, i)}
                                                title={text.delete_photo}
                                                style={{ position: 'absolute', top: '-8px', right: '-8px', width: '26px', height: '26px', background: '#d63c3c', color: '#fff', border: '2px solid #fff', borderRadius: '50%', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0, boxShadow: '0 1px 4px rgba(0,0,0,.25)' }}
                                            >×</button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : readOnly ? (
                        <div style={{ fontSize: '15px', color: '#7d726a' }}>{text.no_media}</div>
                    ) : null}

                    {/* Камера (+ загрузка с диска только для счётчиков) */}
                    {!readOnly && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={() => setIsCameraOpenFor(key)}
                                    style={{ flex: 1, minHeight: '52px', padding: '12px', background: '#f3ebe2', color: '#3f3530', border: '2px dashed #d6cbc1', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '17px', WebkitTapHighlightColor: 'transparent' }}
                                >
                                    {text.add_photo}
                                </button>
                                {task.requires_ocr && (
                                    <button
                                        onClick={() => handleUploadFromDisk(key)}
                                        style={{ flex: 1, minHeight: '52px', padding: '12px', background: '#f8efe6', color: '#6a3320', border: '2px dashed var(--brand-accent, #cdaa7c)', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '17px', WebkitTapHighlightColor: 'transparent' }}
                                    >
                                        {text.upload_photo}
                                    </button>
                                )}
                            </div>
                            {task.requires_ocr && (
                                <div style={{ fontSize: '15px', color: '#7a5a30', background: '#f6efe3', padding: '8px 10px', borderRadius: '6px' }}>{text.ocr_hint}</div>
                            )}
                        </div>
                    )}

                    {/* Фото счётчика ждёт администратора */}
                    {task.requires_ocr && readOnly && task.ocr_pending > 0 && (
                        <div style={{ fontSize: '16px', color: '#7a5a30', background: '#f6efe3', padding: '8px 10px', borderRadius: '6px' }}>{text.meter_pending}</div>
                    )}

                    {/* Показание счётчика */}
                    {task.requires_ocr && st.ocr && st.ocr.value && (
                        <div style={{ fontSize: '16px', color: '#1f7a4f', background: '#f0fdf4', padding: '8px 10px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '18px' }}>📟</span>
                            {text.ocr_reading}: <b>{st.ocr.value} {st.ocr.unit}</b>
                        </div>
                    )}

                    {/* Примечания */}
                    {readOnly ? (
                        st.notes ? <div style={{ fontSize: '16px', color: '#564b44', background: '#fff', border: '1px solid #ebe3dc', borderRadius: '6px', padding: '10px', whiteSpace: 'pre-wrap' }}>{st.notes}</div> : null
                    ) : (
                        <textarea
                            value={st.notes || ''}
                            onChange={(e) => handleNotesChange(key, e.target.value)}
                            placeholder={text.lbl_notes}
                            style={{ width: '100%', boxSizing: 'border-box', minHeight: '70px', padding: '10px', borderRadius: '6px', border: '1px solid #d9cec5', fontFamily: 'inherit', fontSize: '16px' }}
                        />
                    )}

                    {/* Действие */}
                    {readOnly ? (
                        <button
                            onClick={() => openRoutine(task, true)}
                            style={{ minHeight: '52px', padding: '12px', background: '#fff', color: 'var(--brand-button, #844128)', border: '2px solid #e6d0b2', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '18px', WebkitTapHighlightColor: 'transparent' }}
                        >
                            {text.repeat_btn}
                        </button>
                    ) : (
                        <button
                            disabled={closing}
                            onClick={() => handleCloseTask(task.id, 'routine')}
                            style={{ minHeight: '52px', padding: '12px', background: 'var(--brand-button, #844128)', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '18px', boxShadow: '0 2px 6px rgba(132,65,40,0.3)', WebkitTapHighlightColor: 'transparent' }}
                        >
                            ✓ {text.btn_close}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const cameraModal = (<>
            {/* ВЫЗОВ КАМЕРЫ (КАК В МЕНЕДЖЕРЕ) */}
            {isCameraOpenFor !== null && (
                <CameraBlock 
                    onCapturePhoto={(p) => handleAddMedia(isCameraOpenFor, 'photo', p)} 
                    onCaptureVideo={(v) => handleAddMedia(isCameraOpenFor, 'video', v)} 
                    onClose={() => setIsCameraOpenFor(null)} 
                />
            )}
    </>);
    const ocrModal = (<>
            {/* ОКНО ПРОВЕРКИ / ПРАВКИ РЕЗУЛЬТАТА ИИ-РАСПОЗНАВАНИЯ (СЧЁТЧИКИ) */}
            {ocrModalTask && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px' }}>
                    <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', maxWidth: '360px', width: '100%', display: 'flex', flexDirection: 'column', gap: '14px', direction: dir, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: ocrModalTask.value ? '#2b2320' : '#b45309' }}>
                            {ocrModalTask.value ? ('🤖 ' + text.ocr_modal_text) : ('⚠️ ' + text.ocr_fail + '. ' + text.ocr_manual)}
                        </div>

                        {!ocrModalTask.value && ocrModalTask.error && (
                            <div style={{ fontSize: '14px', color: '#6e635b', wordBreak: 'break-word' }}>{ocrModalTask.error}</div>
                        )}
                        {ocrModalTask.engine && (
                            <div style={{ fontSize: '14px', color: '#cbbfb5' }}>🔧 {ocrModalTask.engine}</div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '22px' }}>📟</span>
                            <input
                                type="number"
                                autoFocus
                                value={ocrModalTask.value}
                                onChange={e => setOcrModalTask(prev => ({ ...prev, value: e.target.value }))}
                                style={{
                                    flex: 1, minWidth: 0, padding: '12px 14px',
                                    fontSize: '24px', fontWeight: 'bold',
                                    border: '2px solid #7a5a30', borderRadius: '8px',
                                    color: '#7a5a30', background: '#f6efe3',
                                    outline: 'none'
                                }}
                            />
                            {ocrModalTask.unit && <span style={{ fontSize: '16px', color: '#6e635b' }}>{ocrModalTask.unit}</span>}
                        </div>

                        <button
                            onClick={() => confirmOcrValue(ocrModalTask.taskId, ocrModalTask.taskType, ocrModalTask.value)}
                            style={{ minHeight: '52px', padding: '13px', background: '#7a5a30', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '18px', boxShadow: '0 2px 6px rgba(122,90,48,0.3)', WebkitTapHighlightColor: 'transparent' }}
                        >
                            {text.ocr_ok}
                        </button>
                    </div>
                </div>
            )}
    </>);

    // ---------- Общая оболочка нового вида: шапка, «Отчёты / Работа», вкладки работы ----------
    const routinePending = (tasks.routine || []).filter(t => t.status !== 'done').length;
    const urgentCount = (tasks.urgent || []).length;
    const workTabs = [
        { key: 'urgent', count: urgentCount, cls: 'u' },
        { key: 'routine', count: routinePending, cls: '' },
        { key: 'planned', count: (tasks.planned || []).length, cls: '' },
    ];
    const modes = isHeadPanel ? ['reports', 'work'] : ['work', 'reports'];
    const appHeader = (
        <AppHeader name={user.name} showLabel={wt.showHdr}
            subtitle={isViewer ? text.title_viewer : isHeadPanel ? text.title_head : isAdmin ? `${text.title} ${text.admin_suffix}` : text.title}
            right={<>
                {isAdmin && (
                    <button type="button" className="wk-admin" onClick={onOpenAdmin || (() => alert(errText(lang, 'admin_wip')))}>{text.admin_btn}</button>
                )}
                {pushEligible && <NotifyButton lang={lang} role={userRole} />}
                <AppMenu lang={lang} onChangeLang={onChangeLang} onLogout={onLogout} />
            </>} />
    );
    const modeSwitch = isHead && !isViewer ? (
        <div className="wk-seg wk-mode">
            {modes.map(m => (
                <button key={m} type="button" className={headMode === m ? 'on' : ''} aria-pressed={headMode === m}
                    onClick={() => { setHeadMode(m); setSelectedRoomTask(null); }}>
                    {m === 'reports' ? wt.reports : wt.work}
                    {m === 'work' && urgentCount > 0 && <i className="u">{urgentCount}</i>}
                </button>
            ))}
        </div>
    ) : null;

    // ---------- Текущая работа: новый вид (плитки) ----------
    if (!showReports && !(activeTab === 'planned' && plannedCreateView)) {
        return (
            <div className="wk" dir={dir} lang={lang}>
                {appHeader}

                {modeSwitch}
                <div className="wk-seg" role="tablist">
                    {workTabs.map(tb => (
                        <button key={tb.key} type="button" role="tab" aria-selected={activeTab === tb.key} className={activeTab === tb.key ? 'on' : ''}
                            onClick={() => { setActiveTab(tb.key); setSelectedRoomTask(null); }}>
                            {wt['tab_' + tb.key]}<i className={tb.count > 0 ? tb.cls : ''}>{tb.count}</i>
                        </button>
                    ))}
                </div>

                <div style={{ padding: '0 12px' }}><OfflineBanner userId={user.id} lang={lang} status={outbox} /></div>

                {isLoading ? (
                    <div className="wk-none">{text.load}</div>
                ) : activeTab === 'urgent' ? (
                    <UrgentList ctx={workCtx} list={tasks.urgent || []}
                        top={onCreateUrgent ? <button type="button" className="wk-create u" onClick={onCreateUrgent}>{text.create_urgent_btn}</button> : null} />
                ) : activeTab === 'routine' ? (
                    <RoutineList ctx={workCtx} list={tasks.routine || []} todayStr={todayStr} />
                ) : (
                    <PlannedList ctx={workCtx} list={tasks.planned || []}
                        top={isHead ? <button type="button" className="wk-create" onClick={openPlannedCreate}>{text.create_planned_btn}</button> : null} />
                )}

                {cameraModal}
                {ocrModal}
                {viewer && <PhotoViewer items={viewer.items} index={viewer.index} caption={viewer.caption} t={wt} onClose={() => setViewer(null)} />}
                {toastNode}
            </div>
        );
    }

    // ---------- Отчёты и «Создать плановые задачи»: та же оболочка, что у текущей работы ----------
    const closeHistory = () => setRoutineHistory({ open: false, loading: false, task: null, history: [] });
    return (
        <div className="wk" dir={dir} lang={lang}>
            {appHeader}
            {modeSwitch}

            {showReports ? renderReports() : (
                <>
                    <div className="wk-seg" role="tablist">
                        {workTabs.map(tb => (
                            <button key={tb.key} type="button" role="tab" aria-selected={activeTab === tb.key} className={activeTab === tb.key ? 'on' : ''}
                                onClick={() => { setActiveTab(tb.key); setSelectedRoomTask(null); }}>
                                {wt['tab_' + tb.key]}<i className={tb.count > 0 ? tb.cls : ''}>{tb.count}</i>
                            </button>
                        ))}
                    </div>
                    <div style={{ padding: '0 12px' }}><OfflineBanner userId={user.id} lang={lang} status={outbox} /></div>
                    {renderPlannedCreate()}
                </>
            )}

            {cameraModal}

            {/* ИСТОРИЯ ПОКАЗАНИЙ СЧЁТЧИКА (ТАБЛИЦА РЕГЛАМЕНТА) — лист снизу */}
            {routineHistory.open && (
                <div className="hd hd-ovl" onClick={closeHistory}>
                    <div className="hd-sheet" role="dialog" aria-modal="true" aria-label={text.rep_history_title} onClick={(e) => e.stopPropagation()}>
                        <div className="hd-grab" />
                        <div className="hd-sheet-h">
                            <div style={{ minWidth: 0 }}>
                                <div className="hd-lbl">{text.rep_history_title}</div>
                                <div className="hd-place" style={{ fontSize: '19px' }}><Icon n="gauge" />{routineHistory.task?.name}</div>
                            </div>
                            <button type="button" className="hd-btn" onClick={closeHistory}>{text.rep_close}</button>
                        </div>
                        <div className="hd-chart">
                            {routineHistory.loading ? loadingBox : (
                                <MiniLineChart points={routineHistory.history} unit={routineHistory.history.find(h => h.unit)?.unit || ''} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {ocrModal}
            {viewer && <PhotoViewer items={viewer.items} index={viewer.index} caption={viewer.caption} t={wt} onClose={() => setViewer(null)} />}
            {toastNode}
        </div>
    );
}
