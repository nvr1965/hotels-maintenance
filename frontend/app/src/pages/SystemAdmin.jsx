import { useState } from 'react';
import AppMenu from '../components/AppMenu';
import AdminNetwork from '../components/admin/AdminNetwork';
import AdminTemplates from '../components/admin/AdminTemplates';
import AdminLanguages from '../components/admin/AdminLanguages';
import { tr } from '../components/admin/adminUi';
import { uiText, dirOf } from '../i18n';

// Общая админка владельца системы: отели (создать, назначить мастер-админа, войти в отель),
// шаблоны структуры, языки. Всё, что внутри отеля, — в админке отеля (AdminDashboard).
// Цвета свои, не отеля: это уровень над отелями.

const TABS = ['hotels', 'templates', 'languages'];
const NAVY = '#1f3a5f';

export default function SystemAdmin({ user, onChangeLang, onLogout, onOpenHotel }) {
    const lang = user.lang || 'en';
    const t = { ...tr(lang), ...uiText('sys', lang) };
    const [tab, setTab] = useState(() => {
        try { return TABS.includes(sessionStorage.getItem('hotelapp_sys_tab')) ? sessionStorage.getItem('hotelapp_sys_tab') : 'hotels'; } catch { return 'hotels'; }
    });
    const open = (k) => {
        setTab(k);
        try { sessionStorage.setItem('hotelapp_sys_tab', k); } catch { /* не страшно */ }
    };

    return (
        // Цвета системы, а не текущего отеля
        <div style={{ '--brand-primary': NAVY, '--brand-button': NAVY, '--brand-text': '#ffffff', padding: '14px', direction: dirOf(lang), maxWidth: '1100px', width: '100%', minWidth: 0, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: NAVY, color: '#fff', padding: '14px 16px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', flexWrap: 'wrap', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: '50%', background: '#fff', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 22 }}>H</div>
                    <div style={{ minWidth: 0 }}>
                        <h2 style={{ margin: 0, fontSize: '20px', color: '#fff' }}>{t.title}</h2>
                        <div style={{ fontSize: '14px', opacity: 0.8 }}>Hotels Maintenance · {user.name}</div>
                    </div>
                </div>
                <AppMenu lang={lang} onChangeLang={onChangeLang} onLogout={onLogout} />
            </div>

            <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', background: '#e9eef4', borderRadius: '12px 12px 0 0', overflow: 'hidden' }}>
                {TABS.map(k => (
                    <button key={k} type="button" onClick={() => open(k)}
                        style={{ flex: '1 1 150px', padding: '13px 6px', background: tab === k ? '#fff' : 'transparent', border: 'none', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', color: tab === k ? NAVY : '#4a5563' }}>
                        {t['tab_' + k]}
                    </button>
                ))}
            </div>
            <div style={{ background: '#fff', padding: '18px', borderRadius: '0 0 12px 12px', border: '1px solid #d8dee6', borderTop: 'none', minWidth: 0 }}>
                {tab === 'hotels' && <AdminNetwork lang={lang} onOpenHotel={onOpenHotel} />}
                {tab === 'templates' && <AdminTemplates lang={lang} />}
                {tab === 'languages' && <AdminLanguages lang={lang} />}
            </div>
        </div>
    );
}
