import { useState, useEffect, useRef } from 'react';
// ИСПРАВЛЕННЫЙ ИМПОРТ: Путь к CameraBlock как в ManagerDashboard
import CameraBlock from '../components/CameraBlock';
import { BrandEmblem } from '../components/BrandLogo';
import AppMenu from '../components/AppMenu';
import NotifyButton from '../notify/NotifyButton';
import { PUSH_ROLES, syncPush, syncUrgentBadge } from '../notify/push';
import { errText } from '../components/errorText';
import MeterReport from '../components/MeterReport';
import ReportDateFilter, { hotelToday, fmtYmd } from '../components/ReportDateFilter';
import RoutineDayReport from '../components/RoutineDayReport';
import { getBrand, switchHotel } from '../brand';
import { uiText, dirOf, localeOf } from '../i18n';


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
    const [plannedTaskDetail, setPlannedTaskDetail] = useState(null); // выбранная задача для просмотра «что было сделано»

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

    const loadWorkerTasks = async (silent = false) => {
        if (!silent) setIsLoading(true);
        const workerId = user.id || 1;
        try {
            const res = await fetch(`/backend/api/get_worker_tasks.php?lang=${lang}&worker_id=${workerId}`);
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setTasks(data.tasks);
                    
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
                    setTaskState(initialStates);
                    const loadedDate = data.today || jerusalemToday();
                    loadedDateRef.current = loadedDate;
                    setTodayStr(loadedDate);
                }
            }
        } catch (e) {
            console.error("Ошибка загрузки задач:", e);
        } finally {
            setIsLoading(false);
        }
    };

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
            const urgent = data.tasks.urgent || [];
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
        if (selectedWorkerIds.length === 0) { alert(text.err_select_worker); return; }
        if (selectedRoomIds.length === 0) { alert(text.err_select_room); return; }
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

    // Сохранение медиа
    const handleAddMedia = async (taskId, type, dataUrlOrFile) => {
        setIsCameraOpenFor(null);
        
        try {
            let blob;
            if (typeof dataUrlOrFile === 'string') {
                const res = await fetch(dataUrlOrFile);
                blob = await res.blob();
            } else if (dataUrlOrFile instanceof Blob || dataUrlOrFile instanceof File) {
                blob = dataUrlOrFile;
            } else {
                return;
            }

            const formData = new FormData();
            formData.append('file', blob, type === 'video' ? 'video.mp4' : 'photo.jpg');

            const uploadRes = await fetch('/backend/api/upload_media.php', {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();

            if (uploadData.success && uploadData.url) {
                setTaskState(prev => {
                    const currentMedia = prev[taskId]?.media || [];
                    return {
                        ...prev,
                        [taskId]: {
                            ...prev[taskId],
                            media: [...currentMedia, { type, url: uploadData.url }]
                        }
                    };
                });
            } else {
                alert(errText(lang, 'upload_save'));
            }
        } catch (e) {
            console.error('Media upload error:', e);
            alert(errText(lang, 'upload_fail'));
        }
    };

    const handleDeleteMedia = (taskId, index) => {
        setTaskState(prev => {
            const currentMedia = prev[taskId]?.media || [];
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

        try {
            const res = await fetch('/backend/api/close_task.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: taskId,
                    task_type: taskType,
                    worker_id: user.id,
                    lang: user.lang || 'en',
                    // У регламентов и у экрана номера (плановые) нет отдельного чекбокса «Выполнено» —
                    // сама кнопка «Закрыть заявку» на этих экранах и означает «выполнено».
                    // У срочных заявок чекбокс есть и его значение уважаем.
                    is_done: (taskType === 'routine' || taskType === 'planned') ? true : state.isDone,
                    notes: state.notes,
                    checklist: state.checklist,
                    media: state.media,
                    ocr_manual_value: ocrManualValue,
                    is_repeat: !!state.isRepeat
                })
            });
            const data = await res.json();
            if (!data.success) {
                alert(errText(lang, 'close_failed', data.message));
                return;
            }

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
        } catch (e) {
            alert(errText(lang, 'network'));
        }
    };

    const handleCloseTask = (taskId, taskType) => submitClose(taskId, taskType);

    // Подтверждение (или правка) значения ИИ в модальном окне
    const confirmOcrValue = (taskId, taskType, value) => {
        setOcrModalTask(null);
        submitClose(taskId, taskType, value);
    };

    const currentTasksList = tasks[activeTab] || [];

    // ---------- ОТЧЁТЫ: мини-график (без зависимостей, чистый SVG) ----------
    const MiniLineChart = ({ points, unit }) => {
        const w = 640, h = 220, pad = 34;
        const valid = points.filter(p => p.value !== null && p.value !== undefined);
        if (valid.length === 0) {
            return <div style={{ textAlign: 'center', color: '#7d726a', padding: '30px', fontSize: '16px' }}>{text.rep_no_history}</div>;
        }
        const values = valid.map(p => p.value);
        let minV = Math.min(...values), maxV = Math.max(...values);
        if (minV === maxV) { minV -= 1; maxV += 1; }
        const xStep = valid.length > 1 ? (w - pad * 2) / (valid.length - 1) : 0;
        const xOf = i => pad + i * xStep;
        const yOf = v => h - pad - ((v - minV) / (maxV - minV)) * (h - pad * 2);
        const path = valid.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`).join(' ');
        const step = Math.max(1, Math.ceil(valid.length / 6));
        return (
            <div style={{ overflowX: 'auto' }}>
                <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', minWidth: '480px', height: 'auto' }}>
                    <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#ebe3dc" strokeWidth="1" />
                    <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#ebe3dc" strokeWidth="1" />
                    <text x={pad - 6} y={pad + 4} fontSize="11" fill="#7d726a" textAnchor="end">{maxV.toFixed(1)}</text>
                    <text x={pad - 6} y={h - pad + 4} fontSize="11" fill="#7d726a" textAnchor="end">{minV.toFixed(1)}</text>
                    <path d={path} fill="none" stroke="#7a5a30" strokeWidth="2.5" />
                    {valid.map((p, i) => (
                        <circle key={i} cx={xOf(i)} cy={yOf(p.value)} r="3.5" fill="#7a5a30" />
                    ))}
                    {valid.map((p, i) => (
                        i % step === 0 ? (
                            <text key={'lbl' + i} x={xOf(i)} y={h - pad + 18} fontSize="10" fill="#7d726a" textAnchor="middle">
                                {p.date.slice(5)}
                            </text>
                        ) : null
                    ))}
                </svg>
                <div style={{ textAlign: 'center', fontSize: '14px', color: '#7d726a', marginTop: '4px' }}>{unit}</div>
            </div>
        );
    };

    const StatusBadge = ({ status }) => {
        const map = {
            pending: { bg: '#f3ebe2', color: '#6e635b', label: text.rep_status_pending },
            in_progress: { bg: '#fef3c7', color: '#b45309', label: text.rep_status_in_progress },
            done: { bg: '#dcfce7', color: '#1f7a4f', label: text.rep_status_done },
        };
        const m = map[status] || map.pending;
        return <span style={{ fontSize: '14px', fontWeight: 'bold', padding: '3px 9px', borderRadius: '20px', background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>;
    };

    const fmtDateOnly = (ymd) => ymd ? fmtYmd(ymd, lang) : '';

    const fmtDateTime = (s) => {
        if (!s) return '—';
        const d = new Date(s.replace(' ', 'T'));
        if (isNaN(d.getTime())) return s;
        return d.toLocaleDateString(localeOf(lang)) + ' ' + d.toTimeString().slice(0, 5);
    };

    // ---------- ОТЧЁТЫ: заявки (срочные + плановые) ----------
    const renderTaskReport = () => {
        const rows = tasksReport.data?.tasks || [];
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <ReportDateFilter lang={lang} value={tasksReportFilter}
                    onChange={v => { const f = { ...tasksReportFilter, ...v }; setTasksReportFilter(f); loadTasksReport(f); }} />

                {tasksReport.loading ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a' }}>{text.rep_loading}</div>
                ) : rows.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a', fontStyle: 'italic' }}>{text.rep_no_data}</div>
                ) : (
                    <div className="rm-card-grid">
                        {rows.map(t => (
                            <div key={t.id + '_' + t.task_type} style={{ padding: '14px', borderRadius: '12px', border: '1px solid #ece4dd', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                                    <b style={{ fontSize: '16px', color: '#2b2320' }}>{t.task_type === 'current' ? '🚨' : '🚪'} {t.room || '—'}</b>
                                    <StatusBadge status={t.status} />
                                </div>
                                <div style={{ fontSize: '15px', color: '#564b44', marginTop: '4px' }}>{t.description}</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '8px', fontSize: '14px', color: '#6e635b' }}>
                                    <span>👤 {text.rep_col_creator}: <b>{t.creator_name || '—'}</b></span>
                                    <span>🛠️ {text.rep_col_worker}: <b>{t.worker_name || (t.assigned_workers || []).join(', ') || text.rep_not_assigned}</b></span>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px', fontSize: '14px', color: '#7d726a' }}>
                                    <span>🕒 {text.rep_col_created}: {fmtDateTime(t.created_at)}</span>
                                    <span>✅ {text.rep_col_completed}: {fmtDateTime(t.completed_at)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // ---------- ОТЧЁТЫ: матрица регламентов + ретроспектива ----------
    const renderRoutineReport = () => {
        // По умолчанию — что сделано за день/диапазон; кнопка «За периоды» открывает таблицу задача × дата
        if (routineMode === 'days') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <ReportDateFilter lang={lang} value={routineDayFilter} onChange={setRoutineDayFilter}>
                        <button type="button" onClick={() => setRoutineMode('matrix')}
                            style={{ minHeight: '38px', padding: '7px 13px', borderRadius: '9px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', border: '1px solid #5d3a2e', background: '#5d3a2e', color: 'var(--brand-text, #f9edd3)', WebkitTapHighlightColor: 'transparent', marginInlineStart: 'auto' }}>
                            {text.rep_by_periods}
                        </button>
                    </ReportDateFilter>
                    <RoutineDayReport lang={lang} value={routineDayFilter} />
                </div>
            );
        }

        const data = routineReport.data;
        const f = routineMatrixFilter;
        const custom = !!(f.from && f.to);
        const draftOk = routineCustomDraft.from && routineCustomDraft.to && routineCustomDraft.from <= routineCustomDraft.to;
        const applyMatrix = (nf) => { setRoutineMatrixFilter(nf); loadRoutineReport(nf); };
        const presetBtn = (active, label, onClick) => (
            <button key={label} type="button" onClick={onClick}
                style={{ minHeight: '38px', padding: '7px 13px', borderRadius: '9px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px', border: active ? '2px solid var(--brand-button, #844128)' : '1px solid #e2d8cf', background: active ? 'var(--brand-button, #844128)' : '#fff', color: active ? '#fff' : '#3f3530', WebkitTapHighlightColor: 'transparent' }}>
                {label}
            </button>
        );
        const dateInput = { display: 'block', padding: '8px', borderRadius: '8px', border: '1px solid #d9cec5', fontSize: '15px' };
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button type="button" onClick={() => setRoutineMode('days')}
                    style={{ alignSelf: 'flex-start', padding: '6px 12px', background: '#f3ebe2', border: '1px solid #d9cec5', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#3f3530' }}>
                    {text.rep_by_days}
                </button>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '15px', color: '#6e635b' }}>{text.rep_days}:</span>
                    {[7, 14, 31].map(d => presetBtn(!custom && !routineCustomOpen && f.days === d, String(d), () => { setRoutineCustomOpen(false); applyMatrix({ days: d, from: '', to: '' }); }))}
                    {presetBtn(custom || routineCustomOpen, text.rep_custom, () => {
                        setRoutineCustomDraft(custom ? { from: f.from, to: f.to } : { from: data?.from || '', to: data?.to || hotelToday() });
                        setRoutineCustomOpen(true);
                    })}
                    <a
                        href={`/backend/api/export_routine_excel.php?${routineMatrixQuery()}`}
                        style={{ minHeight: '38px', padding: '7px 14px', fontSize: '15px', fontWeight: 'bold', background: '#1f7a4f', color: '#fff', borderRadius: '8px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', boxSizing: 'border-box', WebkitTapHighlightColor: 'transparent' }}
                    >
                        {text.rep_export_excel}
                    </a>
                </div>
                {(custom || routineCustomOpen) && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '14px', color: '#6e635b' }}>{text.rep_from}
                            <input type="date" value={routineCustomDraft.from} max={hotelToday()} onChange={e => setRoutineCustomDraft(d => ({ ...d, from: e.target.value }))} style={dateInput} />
                        </label>
                        <label style={{ fontSize: '14px', color: '#6e635b' }}>{text.rep_to}
                            <input type="date" value={routineCustomDraft.to} max={hotelToday()} onChange={e => setRoutineCustomDraft(d => ({ ...d, to: e.target.value }))} style={dateInput} />
                        </label>
                        <button type="button" disabled={!draftOk} onClick={() => applyMatrix({ days: f.days, from: routineCustomDraft.from, to: routineCustomDraft.to })}
                            style={{ minHeight: '38px', padding: '8px 16px', background: draftOk ? 'var(--brand-button, #844128)' : '#cbbfb5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: draftOk ? 'pointer' : 'default', fontSize: '15px' }}>
                            {text.rep_apply}
                        </button>
                    </div>
                )}
                {data && <div style={{ fontSize: '15px', color: '#6e635b' }}>📅 {fmtDateOnly(data.from)} — {fmtDateOnly(data.to)} · <span style={{ fontSize: '14px', color: '#7d726a' }}>{text.rep_matrix_hint}</span></div>}

                {routineReport.loading ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a' }}>{text.rep_loading}</div>
                ) : !data || (data.tasks || []).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a', fontStyle: 'italic' }}>{text.rep_no_data}</div>
                ) : (
                    <div style={{ overflowX: 'auto', borderRadius: '14px', border: '1px solid #ece4dd', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                        <table style={{ borderCollapse: 'collapse', fontSize: '14px', minWidth: '100%', background: '#fff' }}>
                            <thead>
                                <tr>
                                    <th style={{ position: 'sticky', left: 0, background: '#fff', textAlign: 'start', padding: '6px 10px', borderBottom: '2px solid #ebe3dc', whiteSpace: 'nowrap' }}>{text.tab3}</th>
                                    {data.dates.map(d => (
                                        <th key={d} style={{ padding: '6px 6px', borderBottom: '2px solid #ebe3dc', color: '#7d726a', fontWeight: 'normal', whiteSpace: 'nowrap' }}>{d.slice(5)}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.tasks.map(t => (
                                    <tr key={t.id}>
                                        <td
                                            onClick={() => t.requires_ocr && openRoutineHistory(t)}
                                            style={{ position: 'sticky', left: 0, background: '#fff', padding: '6px 10px', borderBottom: '1px solid #f3ebe2', whiteSpace: 'nowrap', fontWeight: 'bold', color: t.requires_ocr ? '#7a5a30' : '#3f3530', cursor: t.requires_ocr ? 'pointer' : 'default' }}
                                        >
                                            {t.requires_ocr ? '📟 ' : ''}{t.name}
                                        </td>
                                        {t.cells.map(c => (
                                            <td key={c.date} style={{ padding: '4px', borderBottom: '1px solid #f3ebe2', textAlign: 'center' }}>
                                                {c.status === 'done' ? (
                                                    <span title={c.ocr_value ? `${c.ocr_value} ${c.ocr_unit || ''}` : ''} style={{ display: 'inline-block', minWidth: '30px', padding: '3px 5px', borderRadius: '6px', background: '#dcfce7', color: '#1f7a4f', fontWeight: 'bold', fontSize: '14px' }}>
                                                        {c.ocr_value ? c.ocr_value : '✓'}
                                                    </span>
                                                ) : c.status === 'pending' ? (
                                                    <span style={{ display: 'inline-block', width: '18px', height: '18px', borderRadius: '50%', background: '#f3ebe2', border: '1px solid #ebe3dc' }} />
                                                ) : (
                                                    <span style={{ color: '#ebe3dc' }}>·</span>
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    // ---------- ОТЧЁТЫ: плановые задачи + покрытие ----------
    const renderPlannedReportView = () => {
        const data = plannedReport.data;
        const cov = data?.coverage;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <ReportDateFilter lang={lang} value={plannedReportFilter} accent="#26875a"
                    onChange={v => { setPlannedReportFilter(v); loadPlannedReport(v); }} />

                {plannedReport.loading ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a' }}>{text.rep_loading}</div>
                ) : !data ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a', fontStyle: 'italic' }}>{text.rep_no_data}</div>
                ) : (
                    <>
                        {cov && (
                            <div style={{ padding: '14px', borderRadius: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                                <div style={{ fontWeight: 'bold', color: '#1f7a4f', fontSize: '17px' }}>
                                    {text.rep_coverage}: {cov.checked_rooms} {text.rep_of} {cov.total_rooms}
                                </div>
                                <div style={{ height: '8px', borderRadius: '4px', background: '#dcfce7', marginTop: '8px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${cov.total_rooms ? Math.min(100, cov.checked_rooms / cov.total_rooms * 100) : 0}%`, background: '#26875a' }} />
                                </div>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '10px' }}>
                                    {(cov.by_building || []).map(b => (
                                        <div key={b.building} style={{ fontSize: '14px', color: '#3f3530' }}>
                                            <b>{b.building}</b>: {b.checked_rooms}/{b.total_rooms}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(data.tasks || []).length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '20px', color: '#7d726a', fontStyle: 'italic' }}>{text.rep_no_data}</div>
                        ) : (
                            <div className="rm-card-grid">
                                {data.tasks.map(t => {
                                    const pct = t.checklist.total ? Math.round(t.checklist.checked / t.checklist.total * 100) : 0;
                                    return (
                                        <div
                                            key={t.id}
                                            onClick={() => setPlannedTaskDetail(t)}
                                            style={{ padding: '14px', borderRadius: '12px', border: '1px solid #ece4dd', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                                                <b style={{ fontSize: '16px', color: '#2b2320' }}>🚪 {t.room}</b>
                                                <StatusBadge status={t.status} />
                                            </div>
                                            <div style={{ fontSize: '14px', color: '#6e635b', marginTop: '6px' }}>
                                                {text.rep_assigned}: <b>{(t.assigned_workers || []).join(', ') || text.rep_not_assigned}</b> · {text.rep_col_creator}: <b>{t.creator_name || '—'}</b>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                                                <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: '#f3ebe2', overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${pct}%`, background: t.checklist.defects > 0 ? '#f59e0b' : '#26875a' }} />
                                                </div>
                                                <span style={{ fontSize: '14px', color: '#7d726a', whiteSpace: 'nowrap' }}>{t.checklist.checked}/{t.checklist.total} {text.rep_checklist_progress}</span>
                                                {t.checklist.defects > 0 && <span style={{ fontSize: '14px', color: '#b45309', whiteSpace: 'nowrap' }}>⚠️ {t.checklist.defects} {text.rep_defects}</span>}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px', fontSize: '14px', color: '#7d726a' }}>
                                                <span>🕒 {fmtDateTime(t.created_at)}</span>
                                                {t.completed_at && <span>✅ {fmtDateTime(t.completed_at)}</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

    // ---------- ОТЧЁТЫ: контейнер с под-вкладками ----------
    const renderReports = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '4px', background: '#f3ebe2', borderRadius: '10px', padding: '4px' }}>
                {[
                    { key: 'tasks', label: text.rep_tasks },
                    { key: 'routine', label: text.rep_routine },
                    { key: 'planned', label: text.rep_planned },
                    { key: 'meters', label: text.rep_meters },
                ].map(sv => (
                    <button key={sv.key} onClick={() => setReportView(sv.key)}
                        style={{ flex: '1 1 0', minWidth: 0, minHeight: '40px', padding: '8px 1px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: 'clamp(12px, 3.3vw, 15px)', background: reportView === sv.key ? '#fff' : 'transparent', color: reportView === sv.key ? '#2b2320' : '#6e635b', boxShadow: reportView === sv.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                        {sv.label}
                    </button>
                ))}
            </div>

            {reportView === 'tasks' && renderTaskReport()}
            {reportView === 'routine' && renderRoutineReport()}
            {reportView === 'planned' && renderPlannedReportView()}
            {reportView === 'meters' && <MeterReport lang={lang} />}
        </div>
    );

    // ---------- ПЛАНОВЫЕ: экран создания (выбор исполнителей и номеров) ----------
    const renderPlannedCreate = () => {
        const buildings = plannedFormData?.buildings || [];
        const workers = plannedFormData?.workers || [];
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <button
                    onClick={() => setPlannedCreateView(false)}
                    style={{ alignSelf: 'flex-start', padding: '6px 12px', background: '#f3ebe2', border: '1px solid #d9cec5', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#3f3530' }}
                >
                    {text.back_planned}
                </button>

                {plannedFormLoading ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#6e635b' }}>{text.loading}</div>
                ) : (
                    <>
                        <div>
                            <div style={{ fontWeight: 'bold', marginBottom: '10px', color: '#3f3530', fontSize: '17px' }}>{text.select_workers}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {workers.map(w => (
                                    <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '7px', minHeight: '42px', padding: '8px 14px', borderRadius: '10px', border: selectedWorkerIds.includes(w.id) ? '2px solid #26875a' : '1px solid #e6ddd5', background: selectedWorkerIds.includes(w.id) ? '#f0fdf4' : '#fff', cursor: 'pointer', fontSize: '16px', WebkitTapHighlightColor: 'transparent' }}>
                                        <input type="checkbox" checked={selectedWorkerIds.includes(w.id)} onChange={() => toggleWorker(w.id)} style={{ width: '18px', height: '18px', accentColor: '#26875a' }} />
                                        <span>{w.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                                <span style={{ fontWeight: 'bold', color: '#3f3530', fontSize: '17px' }}>{text.select_rooms} ({selectedRoomIds.length})</span>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button type="button" onClick={() => toggleAllRooms(true)} style={{ minHeight: '34px', padding: '6px 12px', fontSize: '14px', background: '#efe7e0', color: '#3f3530', border: 'none', borderRadius: '8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{text.select_all_global}</button>
                                    <button type="button" onClick={() => toggleAllRooms(false)} style={{ minHeight: '34px', padding: '6px 12px', fontSize: '14px', background: '#efe7e0', color: '#3f3530', border: 'none', borderRadius: '8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{text.deselect_all_global}</button>
                                </div>
                            </div>

                            <div className="rm-card-grid">
                            {buildings.map(b => {
                                const bOpen = expandedBuildings.has(b.name);
                                const bIds = buildingRoomIds(b.name);
                                const bSelCount = countSelected(bIds);
                                return (
                                <div key={b.name} style={{ marginBottom: '0', background: '#fcf9f6', borderRadius: '12px', border: '1px solid #ece4dd', overflow: 'hidden' }}>
                                    <div
                                        onClick={() => toggleBuildingExpanded(b.name)}
                                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', padding: '14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: bOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: '#7d726a', fontSize: '14px' }}>{dir === 'rtl' ? '◂' : '▸'}</span>
                                            <b style={{ color: '#26875a' }}>{text.building_word} {b.name}</b>
                                            {bSelCount > 0 && (
                                                <span style={{ fontSize: '14px', fontWeight: 'bold', minWidth: '18px', textAlign: 'center', padding: '2px 6px', borderRadius: '9px', background: '#26875a', color: '#fff' }}>{bSelCount}</span>
                                            )}
                                        </span>
                                        <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroupRooms(bIds); }} style={{ minHeight: '34px', padding: '6px 12px', fontSize: '14px', background: '#efe7e0', color: '#3f3530', border: 'none', borderRadius: '8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{text.select_all_building}</button>
                                    </div>
                                    {bOpen && (
                                        <div style={{ padding: '0 14px 14px' }}>
                                            {b.floors.map(f => {
                                                const fKey = b.name + '|' + f.name;
                                                const fOpen = expandedFloors.has(fKey);
                                                const fIds = floorRoomIds(b.name, f.name);
                                                const fSelCount = countSelected(fIds);
                                                return (
                                                <div key={f.name} style={{ marginTop: '8px', background: '#fff', borderRadius: '10px', border: '1px solid #ece4dd', overflow: 'hidden' }}>
                                                    <div
                                                        onClick={() => toggleFloorExpanded(fKey)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px', color: '#6e635b', padding: '10px 12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                                                    >
                                                        <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: fOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: '#cbbfb5', fontSize: '14px' }}>{dir === 'rtl' ? '◂' : '▸'}</span>
                                                        <b>{text.floor_word} {f.name}</b>
                                                        {fSelCount > 0 && (
                                                            <span style={{ fontSize: '13px', fontWeight: 'bold', minWidth: '16px', textAlign: 'center', padding: '1px 5px', borderRadius: '8px', background: '#26875a', color: '#fff' }}>{fSelCount}</span>
                                                        )}
                                                        <span style={{ flex: 1 }} />
                                                        <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroupRooms(fIds); }} style={{ minHeight: '30px', padding: '5px 10px', fontSize: '14px', background: '#efe7e0', color: '#3f3530', border: 'none', borderRadius: '7px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>{text.select_all_floor}</button>
                                                    </div>
                                                    {fOpen && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', padding: '0 12px 12px' }}>
                                                            {f.rooms.map(r => (
                                                                <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: '36px', background: selectedRoomIds.includes(r.id) ? '#f0fdf4' : '#fff', padding: '7px 11px', borderRadius: '8px', border: selectedRoomIds.includes(r.id) ? '2px solid #26875a' : '1px solid #e6ddd5', fontSize: '15px', cursor: 'pointer', boxSizing: 'border-box', WebkitTapHighlightColor: 'transparent' }}>
                                                                    <input type="checkbox" checked={selectedRoomIds.includes(r.id)} onChange={() => toggleRoom(r.id)} style={{ width: '15px', height: '15px', accentColor: '#26875a' }} />
                                                                    <span>{r.name}</span>
                                                                </label>
                                                            ))}
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
                        </div>

                        <button
                            onClick={submitPlannedCreate}
                            disabled={plannedSubmitting}
                            style={{ minHeight: '52px', padding: '14px', background: plannedSubmitting ? '#7d726a' : '#26875a', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: plannedSubmitting ? 'default' : 'pointer', fontSize: '18px', boxShadow: plannedSubmitting ? 'none' : '0 2px 6px rgba(38,135,90,0.3)', WebkitTapHighlightColor: 'transparent' }}
                        >
                            {text.create_planned_submit}
                        </button>
                    </>
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
                                {task.requires_ocr && (
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
                                <span style={{ fontSize: '14px', background: '#dcfce7', color: '#1f7a4f', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>{text.routine_done_badge}</span>
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
                                const cleanUrl = url.startsWith('/') ? url : `/${url}`;
                                return (
                                    <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                                        {isVideo ? (
                                            <video src={cleanUrl} controls style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc' }} />
                                        ) : (
                                            <a href={cleanUrl} target="_blank" rel="noreferrer">
                                                <img src={cleanUrl} alt="media" style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc' }} />
                                            </a>
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

    return (
        <div className="rm-page" style={{
            padding: '14px', direction: dir, width: '100%', maxWidth: '900px', margin: '0 auto',
            paddingTop: 'max(14px, env(safe-area-inset-top))',
            paddingBottom: 'max(14px, env(safe-area-inset-bottom))',
            boxSizing: 'border-box', minHeight: '100vh', background: '#f3ebe2'
        }}>
            {/* Скруглённые рамки везде + широкая раскладка для компьютера (моб. версия — по умолчанию) */}
            <style>{`
                /* --- Все рамки (поля ввода, выпадающие списки, таблицы) — единое скругление --- */
                .rm-page input, .rm-page select, .rm-page textarea {
                    border-radius: 10px !important;
                }
                .rm-page table { border-radius: 0; }

                /* --- Списки карточек: на мобильном — в столбик (как было) --- */
                .rm-card-grid { display: flex; flex-direction: column; gap: 12px; }

                /* --- Версия для компьютера: шире контейнер, карточки в несколько колонок --- */
                @media (min-width: 860px) {
                    .rm-page { max-width: 1200px !important; padding-left: 24px !important; padding-right: 24px !important; }
                    .rm-card-grid {
                        display: grid !important;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 14px;
                        align-items: start;
                    }
                }
                @media (min-width: 1280px) {
                    .rm-page { max-width: 1440px !important; }
                    .rm-card-grid.rm-grid-3 { grid-template-columns: repeat(3, 1fr); }
                }
            `}</style>
            {/* ШАПКА КАК У МЕНЕДЖЕРА */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--brand-primary, #371f20)', padding: '14px 16px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(55,31,32,0.25)', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <BrandEmblem size={44} />
                    <div style={{ minWidth: 0 }}>
                    <h2 style={{ margin: 0, color: 'var(--brand-text, #f9edd3)', fontSize: 'clamp(19px, 5vw, 22px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</h2>
                    <span style={{ fontSize: '15px', color: 'var(--brand-accent, #cdaa7c)' }}>{isViewer ? text.title_viewer : isHeadPanel ? text.title_head : isAdmin ? `${text.title} ${text.admin_suffix}` : text.title}</span>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap', minWidth: 0, maxWidth: '100%' }}>
                    {isAdmin && (
                        <button 
                            onClick={onOpenAdmin || (() => alert(errText(lang, 'admin_wip')))}
                            style={{ minWidth: 0, flex: '0 1 auto', minHeight: '38px', padding: '8px 14px', background: 'var(--brand-accent, #cdaa7c)', color: 'var(--brand-primary, #371f20)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
                        >
                            {text.admin_btn}
                        </button>
                    )}

                    {pushEligible && <NotifyButton lang={lang} role={userRole} />}
                    <AppMenu lang={lang} onChangeLang={onChangeLang} onLogout={onLogout} />
                </div>
            </div>

            {/* ВКЛАДКИ: липкие сверху, крупные зоны нажатия, счётчик — бейджем (не переносится на 2 строки) */}
            <div style={{ position: 'sticky', top: 'max(0px, env(safe-area-inset-top))', zIndex: 20, marginTop: '14px', borderRadius: '14px 14px 0 0', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            {/* Две закладки: у руководителя «Отчёты» | «Текущая работа», у администратора наоборот */}
            {isHead && !isViewer && (
                <div style={{ display: 'flex', gap: '4px', background: '#5d3a2e', padding: '5px' }}>
                    {(isHeadPanel
                        ? [{ key: 'reports', label: text.mode_reports }, { key: 'work', label: text.mode_work }]
                        : [{ key: 'work', label: text.mode_work }, { key: 'reports', label: text.mode_reports }]
                    ).map(m => {
                        const active = headMode === m.key;
                        return (
                            <button key={m.key} type="button" onClick={() => { setHeadMode(m.key); setSelectedRoomTask(null); }}
                                style={{ flex: 1, minWidth: 0, minHeight: '50px', padding: '8px 6px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: 'clamp(15px, 4.2vw, 18px)', background: active ? 'var(--brand-text, #f9edd3)' : 'transparent', color: active ? 'var(--brand-primary, #371f20)' : '#e3d5bd', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.2)' : 'none', WebkitTapHighlightColor: 'transparent' }}>
                                {m.label}
                            </button>
                        );
                    })}
                </div>
            )}
            {!showReports && (
            <div style={{ display: 'flex', background: '#efe7e0' }}>
                {[
                    { key: 'urgent',  label: text.tab1, count: (tasks.urgent  || []).length, color: '#d63c3c' },
                    { key: 'planned', label: text.tab2, count: (tasks.planned || []).length, color: '#26875a' },
                    { key: 'routine', label: text.tab3, count: (tasks.routine || []).length, color: 'var(--brand-button, #844128)' },
                ].map(t => {
                    const active = activeTab === t.key;
                    return (
                        <button
                            key={t.key}
                            onClick={() => { setActiveTab(t.key); setSelectedRoomTask(null); }}
                            style={{
                                flex: 1, minWidth: 0, minHeight: '58px', padding: '8px 4px', background: active ? '#fff' : 'transparent',
                                border: 'none', borderBottom: active ? `3px solid ${t.color}` : '3px solid transparent',
                                fontWeight: 'bold', color: active ? t.color : '#6e635b', cursor: 'pointer', overflow: 'hidden',
                                fontSize: 'clamp(13px, 3.8vw, 16px)', display: 'flex', flexDirection: 'column', alignItems: 'center',
                                justifyContent: 'center', gap: '2px', transition: 'background 0.15s ease', WebkitTapHighlightColor: 'transparent'
                            }}
                        >
                            <span style={{ display: 'block', maxWidth: '100%', lineHeight: 1.15, overflowWrap: 'anywhere', hyphens: 'auto', WebkitHyphens: 'auto', textAlign: 'center' }} lang={lang}>{t.label}</span>
                            {t.count !== null && (
                                <span style={{
                                    fontSize: '14px', minWidth: '18px', padding: '0 5px', borderRadius: '9px', lineHeight: '17px',
                                    background: active ? t.color : '#e2d8cf', color: active ? '#fff' : '#6e635b', fontWeight: 'bold'
                                }}>{t.count}</span>
                            )}
                        </button>
                    );
                })}
            </div>
            )}
            </div>

            {/* ОСНОВНОЙ БЛОК */}
            <div style={{ background: '#fff', padding: '16px', borderRadius: '0 0 14px 14px', border: '1px solid #ece4dd', borderTop: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
                
                {showReports ? (
                    renderReports()
                ) :

                isLoading ? (
                    <div style={{ color: '#7d726a', textAlign: 'center', padding: '30px' }}>{text.load}</div>
                ) :

                activeTab === 'planned' && plannedCreateView ? (
                    renderPlannedCreate()
                ) :

                selectedRoomTask ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <button 
                            onClick={() => setSelectedRoomTask(null)}
                            style={{ alignSelf: 'flex-start', padding: '6px 12px', background: '#f3ebe2', border: '1px solid #d9cec5', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#3f3530' }}
                        >
                            {text.back}
                        </button>
                        
                        <h3 style={{ margin: 0, color: '#26875a' }}>🚪 {text.room_lbl} {selectedRoomTask.room_name}</h3>
                        <div style={{ fontSize: '16px', color: '#6e635b' }}>{text.building_lbl}: {selectedRoomTask.building}, {text.floor_lbl}: {selectedRoomTask.floor}</div>

                        <div style={{ background: '#fcf9f6', padding: '16px', borderRadius: '14px', border: '1px solid #ece4dd', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '12px', color: '#3f3530', fontSize: '18px' }}>{text.room_works}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {(taskState[selectedRoomTask.id]?.checklist || []).map(item => {
                                    const st = item.status || (item.done ? 'ok' : 'pending'); // на случай старых данных с done вместо status
                                    const options = [
                                        { key: 'pending', label: text.chk_pending, color: '#6e635b', bg: '#f3ebe2' },
                                        { key: 'ok',      label: text.chk_ok,      color: '#1f7a4f', bg: '#dcfce7' },
                                        { key: 'defect',  label: text.chk_defect,  color: '#b45309', bg: '#fef3c7' },
                                        { key: 'fixed',   label: text.chk_fixed,   color: '#6a3320', bg: '#f1e3d2' },
                                    ];
                                    const current = options.find(o => o.key === st) || options[0];
                                    const isOpen = expandedChecklistItems.has(item.id);
                                    return (
                                        <div key={item.id} style={{ background: '#fff', borderRadius: '10px', border: '1px solid #ece4dd', overflow: 'hidden' }}>
                                            <div
                                                onClick={() => toggleChecklistItemExpanded(item.id)}
                                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px 12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                                            >
                                                <span style={{ fontSize: '17px', color: '#2b2320' }}>{item.text}</span>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                    <span style={{ fontSize: '14px', fontWeight: 'bold', padding: '3px 9px', borderRadius: '20px', background: current.bg, color: current.color, whiteSpace: 'nowrap' }}>{current.label}</span>
                                                    <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: '#cbbfb5', fontSize: '14px' }}>{dir === 'rtl' ? '◂' : '▸'}</span>
                                                </span>
                                            </div>
                                            {isOpen && (
                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '0 12px 12px' }}>
                                                    {options.map(opt => (
                                                        <button
                                                            key={opt.key}
                                                            type="button"
                                                            onClick={() => {
                                                                handleChecklistItemStatus(selectedRoomTask.id, item.id, opt.key);
                                                                toggleChecklistItemExpanded(item.id);
                                                            }}
                                                            style={{
                                                                flex: '1 1 40%', minWidth: '90px', minHeight: '38px', padding: '7px 10px',
                                                                fontSize: '15px', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer',
                                                                border: st === opt.key ? `2px solid ${opt.color}` : '1px solid #e6ddd5',
                                                                background: st === opt.key ? opt.bg : '#fff',
                                                                color: st === opt.key ? opt.color : '#7d726a',
                                                                WebkitTapHighlightColor: 'transparent'
                                                            }}
                                                        >
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <textarea 
                            value={taskState[selectedRoomTask.id]?.notes || ''}
                            onChange={(e) => handleNotesChange(selectedRoomTask.id, e.target.value)}
                            placeholder={text.lbl_notes}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '10px', border: '1px solid #d9cec5', minHeight: '80px', fontSize: '17px', fontFamily: 'inherit', background: '#fff' }}
                        />

                        <button 
                            onClick={() => handleCloseTask(selectedRoomTask.id, 'planned')}
                            style={{ minHeight: '52px', padding: '14px', background: '#26875a', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '18px', boxShadow: '0 2px 6px rgba(38,135,90,0.3)', WebkitTapHighlightColor: 'transparent' }}
                        >
                            ✓ {text.btn_close}
                        </button>
                    </div>
                ) : 
                
                activeTab === 'routine' ? (
                    routineView ? renderRoutineDetail() : renderRoutineList()
                ) : 

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {activeTab === 'urgent' && onCreateUrgent && (
                        <button
                            onClick={onCreateUrgent}
                            style={{ minHeight: '52px', padding: '13px', background: '#fff', color: '#c43d3d', border: '2px dashed #f2a5a5', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '17px', WebkitTapHighlightColor: 'transparent' }}
                        >
                            {text.create_urgent_btn}
                        </button>
                    )}
                    {activeTab === 'planned' && (String(user.role).trim().toLowerCase() === 'head' || isAdmin) && (
                        <button
                            onClick={openPlannedCreate}
                            style={{ minHeight: '52px', padding: '13px', background: '#fff', color: '#26875a', border: '2px dashed #86efac', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '17px', WebkitTapHighlightColor: 'transparent' }}
                        >
                            {text.create_planned_btn}
                        </button>
                    )}

                    {currentTasksList.length === 0 ? (
                        <div style={{ color: '#6e635b', fontStyle: 'italic', textAlign: 'center', padding: '30px' }}>{text.no_tasks}</div>
                    ) : (
                    <div className="rm-card-grid">
                    {currentTasksList.map(task => {
                            const st = taskState[task.id] || { isDone: false, notes: '', checklist: [], media: [] };
                            const taskMediaList = st.media || [];
                            
                            return (
                                <div key={task.id} style={{ padding: '16px', borderRadius: '14px', border: '1px solid #ece4dd', background: '#fff', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', boxSizing: 'border-box' }}>
                                    
                                    {/* ШАПКА ЗАЯВКИ */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                        <span style={{ fontWeight: 'bold', fontSize: '18px', color: '#2b2320' }}>
                                            {activeTab === 'planned' ? `🚪 ${text.room_lbl} ${task.room_name || 'Номер'}` : 
                                             activeTab === 'routine' ? `📅 ${task.description || text.routine_title}` : 
                                             `📍 (${text.building_lbl} ${task.building || '-'}, ${text.floor_lbl} ${task.floor || '-'}) ${task.location || task.asset_key || 'Объект'}`}
                                        </span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                            {activeTab === 'urgent' && (
                                                <span style={{ fontSize: '14px', background: '#ebe3dc', padding: '4px 8px', borderRadius: '4px', color: '#3f3530', fontWeight: 'bold' }}>
                                                    👤 {task.author_name || 'Менеджер'}
                                                </span>
                                            )}
                                            <span style={{ fontSize: '14px', color: '#7d726a' }}>🕒 {task.created_at}</span>
                                        </div>
                                    </div>

                                    {activeTab !== 'routine' && (
                                        <p style={{ margin: 0, color: '#564b44', fontSize: '17px', lineHeight: '1.4' }}>
                                            {activeTab === 'planned' ? text.planned_default_desc : task.description}
                                        </p>
                                    )}

                                    {/* ОТОБРАЖЕНИЕ ПРИКРЕПЛЕННЫХ МЕДИА */}
                                    {(activeTab === 'urgent' || taskMediaList.length > 0) && (
                                        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '5px', marginTop: '5px' }}>
                                            {(activeTab === 'urgent' ? (task.media || []) : taskMediaList).map((item, i) => {
                                                const url = typeof item === 'string' ? item : (item.url || '');
                                                const isVideo = (typeof item === 'object' && item.type === 'video') || /\.(mp4|mov|avi)$/i.test(url);
                                                const cleanUrl = url.startsWith('/') ? url : `/${url}`;

                                                const canDelete = activeTab === 'routine';
                                                return (
                                                    <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                                                        {isVideo ? (
                                                            <video 
                                                                src={cleanUrl} 
                                                                controls 
                                                                style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc' }} 
                                                            />
                                                        ) : (
                                                            <a href={cleanUrl} target="_blank" rel="noreferrer">
                                                                <img 
                                                                    src={cleanUrl} 
                                                                    alt="media" 
                                                                    style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc' }} 
                                                                />
                                                            </a>
                                                        )}
                                                        {canDelete && (
                                                            <button
                                                                onClick={() => handleDeleteMedia(task.id, i)}
                                                                title={text.delete_photo}
                                                                style={{
                                                                    position: 'absolute', top: '-8px', right: '-8px',
                                                                    width: '26px', height: '26px',
                                                                    background: '#d63c3c', color: '#fff',
                                                                    border: '2px solid #fff', borderRadius: '50%',
                                                                    cursor: 'pointer', fontSize: '16px',
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    lineHeight: 1, padding: 0, boxShadow: '0 1px 4px rgba(0,0,0,.25)'
                                                                }}
                                                            >×</button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {activeTab === 'planned' ? (
                                        <button 
                                            onClick={() => setSelectedRoomTask(task)}
                                            style={{ minHeight: '52px', padding: '12px', background: '#26875a', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '17px', textAlign: 'center', boxShadow: '0 2px 6px rgba(38,135,90,0.3)', WebkitTapHighlightColor: 'transparent' }}
                                        >
                                            🛠️ {text.btn_room_works} ({st.checklist.filter(i => (i.status || (i.done ? 'ok' : 'pending')) !== 'pending').length}/{st.checklist.length}) →
                                        </button>
                                    ) : (
                                        <>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 'bold', color: st.isDone ? '#26875a' : '#3f3530', userSelect: 'none', marginTop: '5px', minHeight: '32px' }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={st.isDone} 
                                                    onChange={() => handleCheckboxChange(task.id)}
                                                    style={{ width: '22px', height: '22px', flexShrink: 0, accentColor: '#26875a', cursor: 'pointer' }}
                                                />
                                                {text.lbl_done}
                                            </label>

                                            <textarea 
                                                value={st.notes}
                                                onChange={(e) => handleNotesChange(task.id, e.target.value)}
                                                placeholder={text.lbl_notes}
                                                style={{ width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '10px', border: '1px solid #d9cec5', minHeight: '60px', fontSize: '17px', fontFamily: 'inherit', background: '#fff' }}
                                            />

                                            <button 
                                                onClick={() => handleCloseTask(task.id, activeTab)}
                                                style={{ minHeight: '52px', padding: '12px', background: activeTab === 'routine' ? 'var(--brand-button, #844128)' : '#26875a', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '17px', boxShadow: activeTab === 'routine' ? '0 2px 6px rgba(132,65,40,0.3)' : '0 2px 6px rgba(38,135,90,0.3)', WebkitTapHighlightColor: 'transparent' }}
                                            >
                                                ✓ {text.btn_close}
                                            </button>
                                        </>
                                    )}

                                </div>
                            );
                        })}
                    </div>
                    )}
                    </div>
                }
            </div>

            {/* ВЫЗОВ КАМЕРЫ (КАК В МЕНЕДЖЕРЕ) */}
            {isCameraOpenFor !== null && (
                <CameraBlock 
                    onCapturePhoto={(p) => handleAddMedia(isCameraOpenFor, 'photo', p)} 
                    onCaptureVideo={(v) => handleAddMedia(isCameraOpenFor, 'video', v)} 
                    onClose={() => setIsCameraOpenFor(null)} 
                />
            )}

            {/* ОКНО «ЧТО БЫЛО СДЕЛАНО» ПО ПЛАНОВОЙ ЗАЯВКЕ (ОТЧЁТ ПО ПЛАНОВЫМ) */}
            {plannedTaskDetail && (
                <div
                    onClick={() => setPlannedTaskDetail(null)}
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '16px' }}
                >
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '14px', padding: '20px', maxWidth: '520px', width: '100%', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', direction: dir, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                            <div>
                                <div style={{ fontSize: '14px', color: '#7d726a', textTransform: 'uppercase', letterSpacing: '0.02em' }}>{text.rep_detail_title}</div>
                                <b style={{ fontSize: '18px', color: '#2b2320' }}>🚪 {plannedTaskDetail.room}</b>
                            </div>
                            <button
                                onClick={() => setPlannedTaskDetail(null)}
                                style={{ minHeight: '34px', padding: '6px 12px', background: '#f3ebe2', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', color: '#3f3530', fontSize: '15px' }}
                            >
                                {text.rep_close}
                            </button>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <StatusBadge status={plannedTaskDetail.status} />
                            <span style={{ fontSize: '14px', color: '#6e635b' }}>{text.rep_assigned}: <b>{(plannedTaskDetail.assigned_workers || []).join(', ') || text.rep_not_assigned}</b></span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '14px', color: '#7d726a' }}>
                            <span>🕒 {text.rep_col_created}: {fmtDateTime(plannedTaskDetail.created_at)}</span>
                            <span>✅ {text.rep_col_completed}: {fmtDateTime(plannedTaskDetail.completed_at)}</span>
                        </div>

                        <div>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3f3530', marginBottom: '6px' }}>{text.rep_detail_notes}</div>
                            {plannedTaskDetail.notes ? (
                                <div style={{ fontSize: '16px', color: '#564b44', background: '#fcf9f6', border: '1px solid #ece4dd', borderRadius: '8px', padding: '10px', whiteSpace: 'pre-wrap' }}>{plannedTaskDetail.notes}</div>
                            ) : (
                                <div style={{ fontSize: '15px', color: '#7d726a', fontStyle: 'italic' }}>{text.rep_detail_no_notes}</div>
                            )}
                        </div>

                        <div>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3f3530', marginBottom: '6px' }}>{text.rep_detail_media}</div>
                            {(plannedTaskDetail.media || []).length > 0 ? (
                                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                                    {plannedTaskDetail.media.map((item, i) => {
                                        const url = typeof item === 'string' ? item : (item.url || '');
                                        const isVideo = (typeof item === 'object' && item.type === 'video') || /\.(mp4|mov|avi)$/i.test(url);
                                        const cleanUrl = url.startsWith('/') ? url : `/${url}`;
                                        return isVideo ? (
                                            <video key={i} src={cleanUrl} controls style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc', flexShrink: 0 }} />
                                        ) : (
                                            <a key={i} href={cleanUrl} target="_blank" rel="noreferrer">
                                                <img src={cleanUrl} alt="media" style={{ width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #ebe3dc', flexShrink: 0 }} />
                                            </a>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div style={{ fontSize: '15px', color: '#7d726a', fontStyle: 'italic' }}>{text.rep_detail_no_media}</div>
                            )}
                        </div>

                        <div>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#3f3530', marginBottom: '6px' }}>{text.rep_detail_checklist}</div>
                            {(plannedTaskDetail.checklist_items || []).length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {plannedTaskDetail.checklist_items.map((it, i) => {
                                        const map = {
                                            pending: { bg: '#f3ebe2', color: '#6e635b', label: text.chk_pending },
                                            ok:      { bg: '#dcfce7', color: '#1f7a4f', label: text.chk_ok },
                                            defect:  { bg: '#fee2e2', color: '#a83232', label: text.chk_defect },
                                            fixed:   { bg: '#f1e3d2', color: '#6a3320', label: text.chk_fixed },
                                        };
                                        const m = map[it.status] || map.pending;
                                        return (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', background: '#fcf9f6', border: '1px solid #ece4dd' }}>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontSize: '15px', color: '#2b2320' }}>{it.name}</div>
                                                    {it.comment && <div style={{ fontSize: '14px', color: '#7d726a', marginTop: '2px' }}>{it.comment}</div>}
                                                </div>
                                                <span style={{ fontSize: '14px', fontWeight: 'bold', padding: '3px 9px', borderRadius: '20px', background: m.bg, color: m.color, whiteSpace: 'nowrap', flexShrink: 0 }}>{m.label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div style={{ fontSize: '15px', color: '#7d726a', fontStyle: 'italic' }}>{text.rep_no_data}</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ОКНО ИСТОРИИ ПОКАЗАНИЙ СЧЁТЧИКА (ОТЧЁТ ПО РЕГЛАМЕНТУ) */}
            {routineHistory.open && (
                <div
                    onClick={() => setRoutineHistory({ open: false, loading: false, task: null, history: [] })}
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '16px' }}
                >
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '14px', padding: '20px', maxWidth: '640px', width: '100%', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', direction: dir, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                            <b style={{ fontSize: '18px', color: '#2b2320' }}>📟 {text.rep_history_title}: {routineHistory.task?.name}</b>
                            <button
                                onClick={() => setRoutineHistory({ open: false, loading: false, task: null, history: [] })}
                                style={{ minHeight: '34px', padding: '6px 12px', background: '#f3ebe2', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', color: '#3f3530', fontSize: '15px' }}
                            >
                                {text.rep_close}
                            </button>
                        </div>
                        {routineHistory.loading ? (
                            <div style={{ textAlign: 'center', padding: '30px', color: '#7d726a' }}>{text.rep_loading}</div>
                        ) : (
                            <MiniLineChart points={routineHistory.history} unit={routineHistory.history.find(h => h.unit)?.unit || ''} />
                        )}
                    </div>
                </div>
            )}

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
        </div>
    );
}