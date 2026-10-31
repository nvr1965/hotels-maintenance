import { useState, useEffect } from 'react';
import AppMenu from '../components/AppMenu';
import AppHeader from '../components/work/AppHeader';
import MetersAdmin from '../components/MetersAdmin';
import AdminUsers from '../components/admin/AdminUsers';
import AdminDicts from '../components/admin/AdminDicts';
import AdminAssets from '../components/admin/AdminAssets';
import AdminDb from '../components/admin/AdminDb';
import AdminPending from '../components/admin/AdminPending';
import AdminTasks from '../components/admin/AdminTasks';
import AdminNetwork from '../components/admin/AdminNetwork';
import AdminLanguages from '../components/admin/AdminLanguages';
import AdminDepartments from '../components/admin/AdminDepartments';
import AdminTemplates from '../components/admin/AdminTemplates';
import { isOrgAdmin } from '../brand';
import { tr, api, Pane } from '../components/admin/adminUi';
import { uiText, dirOf } from '../i18n';
import '../components/admin/admin.css';

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
        window.scrollTo({ top: 0 });
    };

    // Сколько фото счётчиков ждёт распознавания — красное число на вкладке «Нераспознанные»
    const [pendingCount, setPendingCount] = useState(0);
    useEffect(() => {
        api('/backend/api/meter_pending.php?action=count').then(d => { if (d.success) setPendingCount(d.count); });
    }, []);

    return (
        <div className="wk ad" dir={dir} lang={lang}>
            <AppHeader name={user.name} subtitle={text.title} onBack={onBack} backLabel={backLabel || text.back} showLabel={t.show_hdr}
                right={<AppMenu lang={lang} onChangeLang={onChangeLang} onLogout={onLogout} />} />

            <div className="wk-seg ad-seg" role="tablist">
                {TABS.map(key => (
                    <button key={key} type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'on' : ''} onClick={() => openTab(key)}>
                        {t['tab_' + key]}
                        {key === 'pending' && pendingCount > 0 && <i className="u">{pendingCount}</i>}
                    </button>
                ))}
            </div>

            {activeTab === 'users' && <AdminUsers lang={lang} />}
            {activeTab === 'departments' && <Pane><AdminDepartments lang={lang} /></Pane>}
            {activeTab === 'dicts' && <AdminDicts lang={lang} />}
            {activeTab === 'assets' && <AdminAssets lang={lang} />}
            {activeTab === 'tasks' && <AdminTasks lang={lang} />}
            {activeTab === 'meters' && <MetersAdmin lang={lang} />}
            {activeTab === 'pending' && <AdminPending lang={lang} onCount={setPendingCount} />}
            {activeTab === 'network' && <Pane><AdminNetwork lang={lang} /></Pane>}
            {activeTab === 'languages' && <Pane><AdminLanguages lang={lang} /></Pane>}
            {activeTab === 'templates' && <Pane><AdminTemplates lang={lang} /></Pane>}
            {activeTab === 'db' && <AdminDb lang={lang} />}
        </div>
    );
}
