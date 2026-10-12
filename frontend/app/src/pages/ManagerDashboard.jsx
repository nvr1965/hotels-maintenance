import { useState, useEffect } from 'react';
import CameraBlock from '../components/CameraBlock';
import AssetPicker from '../components/AssetPicker';
import { BrandEmblem } from '../components/BrandLogo';
import AppMenu from '../components/AppMenu';
import { errText } from '../components/errorText';
import { uiText, dirOf, localeOf } from '../i18n';


export default function ManagerDashboard({ user, onLogout, onChangeLang, onOpenAdmin, onBack }) {
    // Локальный стейт языка для мгновенного переключения интерфейса
    const [lang, setLang] = useState(user.lang || 'en');
    const text = uiText('manager', lang);
    const dir = dirOf(lang);

    const [locations, setLocations] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [assetId, setAssetId] = useState(''); 
    const [description, setDescription] = useState('');
    const [mediaList, setMediaList] = useState([]); 
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [currentDateTime, setCurrentDateTime] = useState('');
    
    const [taskTab, setTaskTab] = useState('active');
    // Список заявок свёрнут по умолчанию; открытое состояние запоминается на этом устройстве
    const [listOpen, setListOpen] = useState(() => {
        try { return localStorage.getItem('hotelapp_mgr_list_open') === '1'; } catch { return false; }
    });
    const toggleList = () => setListOpen(prev => {
        try { localStorage.setItem('hotelapp_mgr_list_open', prev ? '0' : '1'); } catch { /* ignore */ }
        return !prev;
    });

    const handleSwitchLang = (newLang) => {
        setLang(newLang);
        if (onChangeLang) onChangeLang(newLang);
    };

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            setCurrentDateTime(now.toLocaleString(localeOf(lang), {
                dateStyle: 'medium', timeStyle: 'medium'
            }));
        };
        updateTime();
        const timer = setInterval(updateTime, 1000);
        return () => clearInterval(timer);
    }, [lang]);

    const loadData = async () => {
        setIsLoading(true);
        const userId = user.id || 1;
        
        try {
            // Передаем текущий язык в запрос объектов, чтобы выпадающий список переводился
            const resAssets = await fetch(`/backend/api/get_assets.php?lang=${lang}`);
            if (resAssets.ok) {
                const dataAssets = await resAssets.json();
                if (dataAssets.success) setLocations(dataAssets.locations);
            }
        } catch (err) {
            console.error("Ошибка загрузки объектов:", err);
        }

        try {
            const resTasks = await fetch(`/backend/api/get_manager_tasks.php?lang=${lang}&user_id=${userId}`);
            if (resTasks.ok) {
                const dataTasks = await resTasks.json();
                if (dataTasks.success) setTasks(dataTasks.tasks);
            }
        } catch (err) {
            console.error("Ошибка загрузки заявок:", err);
        }
        
        setIsLoading(false);
    };

    useEffect(() => {
        loadData();
    }, [lang]);

   const handleAddMedia = async (type, dataUrlOrFile) => {
        setIsCameraOpen(false);
        
        try {
            let blob;
            // Если камера вернула Base64 (data:image/...) или blob-ссылку
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

            // Сразу отправляем файл на сервер для сохранения в папку uploads/
            const uploadRes = await fetch('/backend/api/upload_media.php', {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();

            if (uploadData.success && uploadData.url) {
                // Добавляем в стейт реальный путь, полученный от сервера
                setMediaList(prev => [...prev, { type, url: uploadData.url }]);
            } else {
                alert(errText(lang, 'upload_save', uploadData.message));
            }
        } catch (e) {
            console.error('Media upload error:', e);
            alert(errText(lang, 'upload_fail'));
        }
    };

    const handleRemoveMedia = (indexToRemove) => {
        setMediaList(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const submitTask = async () => {
        try {
            const userId = user.id || 1;
            
            const formData = new FormData();
            formData.append('asset_id', assetId);
            formData.append('description', description);
            formData.append('lang', lang);
            formData.append('user_id', userId);
            
            if (mediaList.length > 0) {
                formData.append('mediaList', JSON.stringify(mediaList));
            }

            const res = await fetch('/backend/api/save_task.php', {
                method: 'POST',
                body: formData
            });
            
            const data = await res.json();
            if (data.success) {
                // Без окна «Заявка создана» — форма очищается, заявка появляется в списке
                setAssetId('');
                setDescription('');
                setMediaList([]);
                loadData();
            } else {
                alert(errText(lang, 'server', data.message));
            }
        } catch (e) {
            console.error(e);
            alert(errText(lang, 'network'));
        }
    };

    const getStatusBadge = (status) => {
        switch(status) {
            case 'pending': return <span style={{ background: '#fef3c7', color: '#d97706', padding: '4px 8px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}>{text.st_pending}</span>;
            case 'in_progress': return <span style={{ background: '#f8efe6', color: 'var(--brand-button, #844128)', padding: '4px 8px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}>{text.st_progress}</span>;
            case 'done': return <span style={{ background: '#ecfdf5', color: '#26875a', padding: '4px 8px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}>{text.st_done}</span>;
            default: return <span style={{ background: '#f3ebe2', color: '#3f3530', padding: '4px 8px', borderRadius: '4px', fontSize: '14px' }}>{status}</span>;
        }
    };

    const formatDateTime = (mysqlStr) => {
        if (!mysqlStr) return '';
        const d = new Date(mysqlStr.replace(' ', 'T'));
        return d.toLocaleString(localeOf(lang), {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const activeTasks = tasks.filter(t => t.status !== 'done');
    const completedTasks = tasks.filter(t => t.status === 'done');
    const displayedTasks = taskTab === 'active' ? activeTasks : completedTasks;

    return (
        <div style={{ padding: '14px', direction: dir, maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--brand-primary, #371f20)', color: 'var(--brand-text, #f9edd3)', padding: '14px 16px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(55,31,32,0.25)', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <BrandEmblem size={44} />
                    <div style={{ minWidth: 0 }}>
                        <h2 style={{ margin: 0, color: 'var(--brand-text, #f9edd3)' }}>{user.name}</h2>
                        <span style={{ fontSize: '16px', color: 'var(--brand-accent, #cdaa7c)' }}>{onBack ? text.report : text.title}</span>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>

                    {/* Руководитель открывает этот экран из своей панели, чтобы создать срочную заявку */}
                    {onBack && (
                        <button onClick={onBack} style={{ padding: '8px 15px', background: 'var(--brand-accent, #cdaa7c)', color: 'var(--brand-primary, #371f20)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                            {text.back}
                        </button>
                    )}
                    {!onBack && onOpenAdmin && (
                        <button onClick={onOpenAdmin} style={{ padding: '8px 15px', background: 'var(--brand-accent, #cdaa7c)', color: 'var(--brand-primary, #371f20)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                            {text.admin_btn}
                        </button>
                    )}

                    <AppMenu lang={lang} onChangeLang={handleSwitchLang} onLogout={onLogout} />
                </div>
            </div>

            <div style={{ marginTop: '25px', background: '#fff', padding: '20px', borderRadius: '12px', borderTop: '5px solid #d63c3c', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, color: '#d63c3c' }}>🚨 {text.report}</h3>
                    <div style={{ fontSize: '16px', color: '#6e635b', background: '#f3ebe2', padding: '6px 12px', borderRadius: '6px', fontWeight: '500' }}>
                        📅 {text.datetime} <b>{currentDateTime}</b>
                    </div>
                </div>
                
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold', color: '#5a4f48' }}>{text.sel_zone}</label>
                    <AssetPicker locations={locations} value={assetId} onChange={setAssetId} lang={lang} />
                </div>

                <textarea 
                    value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder={text.descr} 
                    style={{ width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid #cfc4ba', minHeight: '80px', marginBottom: '15px', fontSize: '18px', boxSizing: 'border-box' }} 
                />
                
                {mediaList.length > 0 && (
                    <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '10px' }}>
                        {mediaList.map((media, index) => (
                            <div key={index} style={{ position: 'relative', flexShrink: 0, width: '100px', height: '100px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #ddd3ca', background: '#000' }}>
                                {media.type === 'photo' ? (
                                    <img src={media.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <video src={media.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }}></video>
                                )}
                                <button 
                                    onClick={() => handleRemoveMedia(index)}
                                    style={{ position: 'absolute', top: '2px', right: '2px', background: 'red', color: '#fff', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', fontWeight: 'bold' }}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <button onClick={() => setIsCameraOpen(true)} style={{ width: '100%', padding: '12px', background: '#f3ebe2', color: '#3f3530', border: '2px dashed #d6cbc1', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '20px', fontSize: '18px' }}>
                    {text.attach} {mediaList.length > 0 && `(${mediaList.length})`}
                </button>

                <button 
                    onClick={submitTask} 
                    disabled={!assetId || (!description && mediaList.length === 0)} 
                    style={{ width: '100%', padding: '16px', background: '#d63c3c', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px', cursor: 'pointer', opacity: (!assetId || (!description && mediaList.length === 0)) ? 0.5 : 1 }}
                >
                    {text.send}
                </button>
            </div>

            <div style={{ marginTop: '30px' }}>
                <button
                    type="button"
                    onClick={toggleList}
                    aria-expanded={listOpen}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '14px 16px', background: '#fff', border: '1px solid #ddd3ca', borderRadius: listOpen ? '12px 12px 0 0' : '12px', borderBottom: listOpen ? 'none' : '1px solid #ddd3ca', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', cursor: 'pointer', color: '#3f3530', fontSize: '19px', fontWeight: 'bold', textAlign: 'start' }}
                >
                    <span>{text.my_tasks}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '16px' }}>
                        {!isLoading && <span style={{ background: activeTasks.length ? '#fdecec' : '#f3ebe2', color: activeTasks.length ? '#d63c3c' : '#6e635b', padding: '4px 10px', borderRadius: '999px' }}>⏳ {activeTasks.length}</span>}
                        <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: listOpen ? 'rotate(180deg)' : 'none', color: 'var(--brand-button, #844128)' }}>▼</span>
                    </span>
                </button>

                {listOpen && (<>
                <div style={{ display: 'flex', background: '#f3ece6', borderRadius: '12px 12px 0 0', overflow: 'hidden' }}>
                    <button 
                        onClick={() => setTaskTab('active')} 
                        style={{ flex: 1, padding: '14px', background: taskTab === 'active' ? '#fff' : 'transparent', border: 'none', fontWeight: 'bold', color: taskTab === 'active' ? '#d63c3c' : '#5a4f48', cursor: 'pointer', fontSize: '17px' }}
                    >
                        {text.tab_active} ({activeTasks.length})
                    </button>
                    <button 
                        onClick={() => setTaskTab('completed')} 
                        style={{ flex: 1, padding: '14px', background: taskTab === 'completed' ? '#fff' : 'transparent', border: 'none', fontWeight: 'bold', color: taskTab === 'completed' ? '#26875a' : '#5a4f48', cursor: 'pointer', fontSize: '17px' }}
                    >
                        {text.tab_completed} ({completedTasks.length})
                    </button>
                </div>

                <div style={{ background: '#fff', padding: '20px', borderRadius: '0 0 12px 12px', border: '1px solid #ddd3ca', borderTop: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                    {isLoading ? (
                        <div style={{ color: '#7d726a', textAlign: 'center', padding: '20px' }}>{text.load}</div>
                    ) : displayedTasks.length === 0 ? (
                        <div style={{ color: '#6e635b', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>{text.no_tasks}</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {displayedTasks.map(task => (
                                <div key={task.id} style={{ padding: '15px', borderRadius: '8px', border: '1px solid #ebe3dc', background: '#fcf9f6', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '5px' }}>
                                        <span style={{ fontWeight: 'bold', color: '#2b2320' }}>📍 {task.location}</span>
                                        {getStatusBadge(task.status)}
                                    </div>
                                    
                                    <p style={{ margin: 0, color: '#564b44', fontSize: '17px' }}>{task.description}</p>
                                    
                                    <div style={{ background: '#fff', border: '1px solid #eee7e1', padding: '8px 12px', borderRadius: '6px', fontSize: '15px', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '5px' }}>
                                        <div style={{ color: '#6e635b' }}>
                                            <span style={{ fontWeight: 'bold' }}>{text.lbl_created}</span> {formatDateTime(task.created_at)}
                                        </div>
                                        {task.status === 'done' && (
                                            <div style={{ color: '#26875a' }}>
                                                <span style={{ fontWeight: 'bold' }}>{text.lbl_done}</span> {formatDateTime(task.updated_at)}
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* ИСПРАВЛЕННЫЙ БЛОК ОТОБРАЖЕНИЯ АТАЧМЕНТОВ */}
                                    {task.media && task.media.length > 0 && (
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                            {task.media.map((item, i) => {
                                                const url = typeof item === 'string' ? item : (item.url || '');
                                                const isVideo = (typeof item === 'object' && item.type === 'video') || /\.(mp4|mov|avi)$/i.test(url);
                                                const cleanUrl = url.startsWith('/') ? url : `/${url}`;

                                                return (
                                                    <div key={i} style={{ position: 'relative' }}>
                                                        {isVideo ? (
                                                            <video 
                                                                src={cleanUrl} 
                                                                controls 
                                                                style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cfc4ba' }} 
                                                            />
                                                        ) : (
                                                            <a href={cleanUrl} target="_blank" rel="noreferrer">
                                                                <img 
                                                                    src={cleanUrl} 
                                                                    alt="attachment" 
                                                                    style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cfc4ba' }} 
                                                                />
                                                            </a>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                </>)}
            </div>

            {isCameraOpen && (
                <CameraBlock 
                    onCapturePhoto={(p) => handleAddMedia('photo', p)} 
                    onCaptureVideo={(v) => handleAddMedia('video', v)} 
                    onClose={() => setIsCameraOpen(false)} 
                />
            )}
        </div>
    );
}