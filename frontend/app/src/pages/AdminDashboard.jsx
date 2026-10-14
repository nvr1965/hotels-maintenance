import { useState, useEffect } from 'react';
import { BrandEmblem } from '../components/BrandLogo';
import AppMenu from '../components/AppMenu';
import MetersAdmin from '../components/MetersAdmin';
import AdminUsers from '../components/admin/AdminUsers';
import AdminDicts from '../components/admin/AdminDicts';
import AdminAssets from '../components/admin/AdminAssets';
import AdminDb from '../components/admin/AdminDb';
import AdminPending from '../components/admin/AdminPending';
import AdminNetwork from '../components/admin/AdminNetwork';
import AdminLanguages from '../components/admin/AdminLanguages';
import AdminDepartments from '../components/admin/AdminDepartments';
import AdminTemplates from '../components/admin/AdminTemplates';
import { isOrgAdmin } from '../brand';
import { tr, S, api } from '../components/admin/adminUi';
import { uiText, dirOf } from '../i18n';


const ALL_TABS = ['users', 'departments', 'dicts', 'assets', 'tasks', 'meters', 'pending', 'network', 'templates', 'languages', 'db'];

export default function AdminDashboard({ user, onBack, backLabel, onChangeLang, onLogout }) {
    // Отели, шаблоны и языки у владельца системы — в общей админке (SystemAdmin), здесь только то, что внутри отеля.
    // «Сеть» — администраторам сети, «База данных» — владельцу системы.
    const TABS = ALL_TABS.filter(k => !['templates', 'languages'].includes(k)
        && (k !== 'network' || (!user.is_superadmin && isOrgAdmin()))
        && (k !== 'db' || user.is_superadmin));
    const lang = user.lang || 'en';
    const text = uiText('admin_dash', lang);
    const dir = dirOf(lang);

    const t = tr(lang);
    const [activeTab, setActiveTab] = useState(() => {
        try { return TABS.includes(sessionStorage.getItem('hotelapp_admin_tab')) ? sessionStorage.getItem('hotelapp_admin_tab') : 'users'; } catch { return 'users'; }
    });
    const openTab = (key) => {
        setActiveTab(key);
        try { sessionStorage.setItem('hotelapp_admin_tab', key); } catch { /* не страшно */ }
    };

    // Сколько фото счётчиков ждёт распознавания — число на вкладке «🔎 Нераспознанные»
    const [pendingCount, setPendingCount] = useState(0);
    useEffect(() => {
        api('/backend/api/meter_pending.php?action=count').then(d => { if (d.success) setPendingCount(d.count); });
    }, []);

    // Вкладка «Заявки»: последние 500 заявок (get_admin_data.php)
    const [tasks, setTasks] = useState(null);
    useEffect(() => {
        if (activeTab !== 'tasks') return;
        let cancelled = false;
        fetch(`/backend/api/get_admin_data.php?lang=${lang}`)
            .then(r => r.json())
            .then(d => { if (!cancelled) setTasks(d.success ? d.tasks || [] : []); })
            .catch(() => { if (!cancelled) setTasks([]); });
        return () => { cancelled = true; };
    }, [activeTab, lang]);

    return (
        <div style={{ padding: '14px', direction: dir, maxWidth: '1100px', width: '100%', minWidth: 0, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--brand-primary, #371f20)', color: 'var(--brand-text, #f9edd3)', padding: '14px 16px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(55,31,32,0.25)', flexWrap: 'wrap', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', minWidth: 0 }}>
                    <button 
                        onClick={onBack}
                        style={{ padding: '8px 14px', background: 'var(--brand-accent, #cdaa7c)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', color: 'var(--brand-primary, #371f20)' }}
                    >
                        {backLabel || text.back}
                    </button>
                    <BrandEmblem size={40} />
                    <h2 style={{ margin: 0, color: 'var(--brand-text, #f9edd3)' }}>{text.title}</h2>
                </div>

                <AppMenu lang={lang} onChangeLang={onChangeLang} onLogout={onLogout} />
            </div>

            <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', background: '#f3ece6', borderRadius: '12px 12px 0 0', overflow: 'hidden' }}>
                {TABS.map(key => (
                    <button key={key} type="button" onClick={() => openTab(key)}
                        style={{ flex: '1 1 150px', minWidth: 0, padding: '13px 6px', overflowWrap: 'anywhere', background: activeTab === key ? '#fff' : 'transparent', border: 'none',
                            fontWeight: 'bold', color: activeTab === key ? 'var(--brand-button, #844128)' : '#5a4f48', cursor: 'pointer', fontSize: '16px' }}>
                        {t['tab_' + key]}
                        {key === 'pending' && pendingCount > 0 && (
                            <span style={{ marginInlineStart: '6px', ...S.badge('#a3301c', '#fff') }}>{pendingCount}</span>
                        )}
                    </button>
                ))}
            </div>

            <div style={{ background: '#fff', padding: '18px', borderRadius: '0 0 12px 12px', border: '1px solid #ddd3ca', borderTop: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', minWidth: 0 }}>
                {activeTab === 'users' && <AdminUsers lang={lang} />}
                {activeTab === 'dicts' && <AdminDicts lang={lang} />}
                {activeTab === 'assets' && <AdminAssets lang={lang} />}
                {activeTab === 'meters' && <MetersAdmin />}
                {activeTab === 'pending' && <AdminPending lang={lang} onCount={setPendingCount} />}
                {activeTab === 'network' && <AdminNetwork lang={lang} />}
                {activeTab === 'languages' && <AdminLanguages lang={lang} />}
                {activeTab === 'departments' && <AdminDepartments lang={lang} />}
                {activeTab === 'templates' && <AdminTemplates lang={lang} />}
                {activeTab === 'db' && <AdminDb lang={lang} />}
                {activeTab === 'tasks' && (tasks === null ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#6e635b' }}>{t.loading}</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'start' }}>
                            <thead>
                                <tr>
                                    {['ID', t.type, t.desc, t.status, t.created].map(h => <th key={h} style={{ ...S.th, textAlign: 'start' }}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {tasks.map(tk => (
                                    <tr key={tk.id}>
                                        <td style={S.td}>{tk.id}</td>
                                        <td style={{ ...S.td, fontWeight: 'bold', color: 'var(--brand-button, #844128)' }}>{tk.task_type}</td>
                                        <td style={S.td}>{tk.description}</td>
                                        <td style={S.td}>
                                            <span style={S.badge(tk.status === 'done' ? '#d1fae5' : '#fef3c7', tk.status === 'done' ? '#065f46' : '#92400e')}>{tk.status}</span>
                                        </td>
                                        <td style={{ ...S.td, color: '#7d726a', fontSize: '15px', whiteSpace: 'nowrap' }}>{tk.created_at}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))}
            </div>
        </div>
    );
}
