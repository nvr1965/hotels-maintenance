import { useState } from 'react';
import AppMenu from '../components/AppMenu';
import AppHeader from '../components/work/AppHeader';
import AdminNetwork from '../components/admin/AdminNetwork';
import AdminTemplates from '../components/admin/AdminTemplates';
import AdminLanguages from '../components/admin/AdminLanguages';
import SystemUsers from '../components/admin/SystemUsers';
import { useBrand } from '../brand';
import { tr, trNs, Ic, Pane } from '../components/admin/adminUi';
import { dirOf } from '../i18n';
import '../components/admin/admin.css';

// Общая админка: у владельца системы — отели (создать, назначить мастер-админа, войти в отель),
// пользователи системы, шаблоны структуры, языки; у поддержки — только список отелей, чтобы войти в нужный. Всё, что внутри отеля, — в админке отеля (AdminDashboard).
// Цвета свои, не отеля: это уровень над отелями.

const ALL_TABS = ['hotels', 'users', 'templates', 'languages'];
const NAVY = '#1f3a5f';
const SYS_COLORS = { '--brand-primary': NAVY, '--brand-button': NAVY, '--brand-text': '#ffffff', '--brand-accent': '#c9d6e6' };

export default function SystemAdmin({ user, onChangeLang, onLogout, onOpenHotel }) {
    const lang = user.lang || 'en';
    const t = { ...tr(lang), ...trNs('sys', lang), ...trNs('network', lang) };
    const isSuper = Number(user.is_superadmin) === 1;
    const TABS = isSuper ? ALL_TABS : ['hotels'];
    const [tab, setTab] = useState(() => {
        try { return TABS.includes(sessionStorage.getItem('hotelapp_sys_tab')) ? sessionStorage.getItem('hotelapp_sys_tab') : 'hotels'; } catch { return 'hotels'; }
    });
    const open = (k) => {
        setTab(k);
        try { sessionStorage.setItem('hotelapp_sys_tab', k); } catch { /* не страшно */ }
        window.scrollTo({ top: 0 });
    };
    const emblem = <div aria-hidden="true" style={{ width: 40, height: 40, flex: 'none', borderRadius: '50%', background: '#fff', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 21 }}>H</div>;

    return (
        // Цвета системы, а не текущего отеля
        <div className="wk ad" dir={dirOf(lang)} lang={lang} style={SYS_COLORS}>
            <AppHeader name={t.title} subtitle={`Hotels Maintenance · ${user.name}`} emblem={emblem} showLabel={t.show_hdr}
                right={<AppMenu lang={lang} onChangeLang={onChangeLang} onLogout={onLogout} />} />

            <div className="wk-seg ad-seg" role="tablist">
                {TABS.map(k => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => open(k)}>
                        {t['tab_' + k]}
                    </button>
                ))}
            </div>

            {tab === 'hotels' && (isSuper ? <Pane><AdminNetwork lang={lang} onOpenHotel={onOpenHotel} /></Pane> : <HotelList t={t} onOpenHotel={onOpenHotel} />)}
            {tab === 'users' && <Pane><SystemUsers lang={lang} /></Pane>}
            {tab === 'templates' && <Pane><AdminTemplates lang={lang} /></Pane>}
            {tab === 'languages' && <Pane><AdminLanguages lang={lang} /></Pane>}
        </div>
    );
}

// Поддержка: все отели плитками, кнопка «Войти в отель»
function HotelList({ t, onOpenHotel }) {
    const { hotels } = useBrand();
    return (
        <div className="ad-list">
            <div className="ad-grid">
                {(hotels || []).map(h => (
                    <div key={h.id} className="wk-tile ad-static">
                        <div className="wk-row">
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="wk-place">{h.name}</div>
                                {h.org_name && <div className="ad-hint">{h.org_name}</div>}
                            </div>
                        </div>
                        <div className="ad-btnrow" style={{ marginTop: 10 }}>
                            <button type="button" className="ad-btn blue" onClick={() => onOpenHotel(h.id)}><Ic n="building" />{t.open_hotel}</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
