import { useState, useEffect } from 'react';
import WorkerDashboard from './pages/WorkerDashboard';
import ManagerDashboard from './pages/ManagerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import SystemAdmin from './pages/SystemAdmin';
import { BrandLogo, BrandEmblem } from './components/BrandLogo';
import LangPicker from './components/LangPicker';
import { disablePush } from './notify/push';
import { readCachedUser, cacheUser, clearCachedUser, fetchMe, login, logout, saveLang, installUnauthorizedHook, dropLangParam } from './auth';
import { setBrand, getBrand, useBrand, loadPublicBrand, switchHotel } from './brand';
import { uiText, dirOf, languageList, loadUi, useUi } from './i18n';


// Телефон/планшет или приложение, установленное на экран (PWA)
function isPhoneOrInstalledApp() {
    try {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true
            || window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
}

// Куда попадает вошедший: владелец системы и поддержка — в общую админку, администратор отеля — в админку отеля,
// остальные — в рабочую панель. Выбранный экран помнится до закрытия вкладки.
const VIEW_KEY = 'hotelapp_view';
const homeView = (u) => (Number(u?.is_superadmin) === 1 || u?.system_role ? 'system' : Number(u?.is_admin) === 1 ? 'admin' : 'main');
const storedView = () => { try { return sessionStorage.getItem(VIEW_KEY); } catch { return null; } };
const storeView = (v) => { try { if (v) sessionStorage.setItem(VIEW_KEY, v); else sessionStorage.removeItem(VIEW_KEY); } catch { /* не страшно */ } };

// Языки экрана входа: языки отеля (вход по ссылке отеля), иначе все языки системы
const hotelLangs = (hotel) => (hotel?.languages?.length ? hotel.languages : languageList().map((l) => l.code));

// Язык браузера, если он есть среди доступных (точно, потом без региона), иначе язык отеля, иначе английский
function browserLang(available, fallback) {
    const has = (c) => available.find((a) => a.toLowerCase() === String(c).toLowerCase());
    for (const l of navigator.languages?.length ? navigator.languages : [navigator.language || '']) {
        const hit = has(l) || has(String(l).split('-')[0]);
        if (hit) return hit;
    }
    return has(fallback || '') || has('en') || available[0] || 'en';
}

export default function App() {
    const brand = useBrand();
    useUi(); // перерисовать, когда придут тексты интерфейса на выбранном языке
    const [user, setUser] = useState(null);
    const [view, setViewState] = useState(() => storedView() || 'main'); // 'system' | 'admin' | 'main' | 'urgent' | 'main-work'
    const setView = (v) => { storeView(v); setViewState(v); };
    // Что показывать без пользователя: 'checking' (спрашиваем сервер) | 'login'
    const [screen, setScreen] = useState('checking');
    
    const [loginLang, setLoginLang] = useState(() => browserLang(hotelLangs(getBrand().hotel), getBrand().hotel?.default_lang));
    // Язык выбран вручную (или пришёл в ?lang=) — больше не подстраиваемся под браузер
    const [langPicked, setLangPicked] = useState(false);
    // На телефоне и в установленном приложении вход запоминается всегда (галочки нет),
    // на компьютере галочка есть и отмечена по умолчанию
    const [rememberMe, setRememberMe] = useState(true);
    const isPersonalDevice = isPhoneOrInstalledApp();
    
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    const showWelcome = () => {
        clearCachedUser();
        setUser(null);
        setUsername('');
        setPassword('');
        setView(null);
        setViewState('main');
        setLangPicked(false);
        setScreen('login');
        loadPublicBrand();
    };

    useEffect(() => {
        const urlLang = new URLSearchParams(window.location.search).get('lang');
        const pickedLang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(urlLang || '') ? urlLang : null;
        let cancelled = false;

        (async () => {
            const me = await fetchMe();
            if (cancelled) return;

            if (me.user) {
                setBrand(me.data);
                // Открыли из уведомления другого отеля (?hotel=<id>) — переключаемся в него
                const wantHotel = Number(new URLSearchParams(window.location.search).get('hotel'));
                if (wantHotel && me.data.hotel && wantHotel !== me.data.hotel.id
                    && (me.data.hotels || []).some((h) => h.id === wantHotel)) {
                    await switchHotel(wantHotel);
                    return;
                }
                // Вошёл (сессия или «Запомнить меня») — сразу в свой интерфейс на своём языке
                let u = me.user;
                if (pickedLang && pickedLang !== u.lang) {
                    u = { ...u, lang: pickedLang };
                    saveLang(pickedLang);
                }
                cacheUser(u);
                setLoginLang(u.lang || 'en');
                if (!storedView()) setView(homeView(u));
                setUser(u);
                dropLangParam();
                return;
            }

            if (me.offline) {
                // Нет связи с сервером: показываем последнего запомненного, данные подтянутся с сетью
                const cached = readCachedUser();
                if (cached) {
                    setLoginLang(cached.lang || 'en');
                    setUser(cached);
                    return;
                }
            } else {
                clearCachedUser();
            }

            // Никто не вошёл: название и цвета отеля для экрана входа
            await loadPublicBrand();
            if (cancelled) return;

            if (pickedLang) {
                setLoginLang(pickedLang);
                setLangPicked(true);
            }
            setScreen('login');
        })();

        return () => { cancelled = true; };
    }, []);

    // Тексты интерфейса на языке вошедшего (или выбранном на экране входа): сохранённые показываются сразу,
    // свежие приходят с сервера (новый язык сервер переводит сам)
    const uiLang = user?.lang || loginLang;

    // Пока язык не выбран вручную — язык браузера среди языков отеля (список языков приходит с сервера чуть позже)
    const langCount = languageList().length;
    useEffect(() => {
        if (user || langPicked) return;
        setLoginLang(browserLang(hotelLangs(brand.hotel), brand.hotel?.default_lang));
    }, [user, langPicked, brand.hotel, langCount]);
    useEffect(() => { loadUi(uiLang); }, [uiLang]);

    // Сервер перестал узнавать пользователя (истекла сессия, вход отозван) — обратно к окну отеля
    useEffect(() => installUnauthorizedHook(() => showWelcome()), []);

    const handleLogout = async () => {
        await disablePush();
        await logout();
        dropLangParam();
        showWelcome();
    };

    const handleChangeLang = (newLang, targetUser = user) => {
        setLoginLang(newLang);
        if (targetUser) {
            const updatedUser = { ...targetUser, lang: newLang };
            setUser(updatedUser);
            cacheUser(updatedUser);
            saveLang(newLang);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError('');

        try {
            const remember = isPersonalDevice || rememberMe;
            const data = await login(username, password, loginLang, remember);

            if (data.success) {
                setBrand(data);
                const loggedInUser = { ...data.user, lang: loginLang };
                cacheUser(loggedInUser, remember);
                setPassword('');
                setUser(loggedInUser);
                setView(homeView(loggedInUser));
                dropLangParam();
            } else {
                setLoginError(uiText('login', loginLang).error);
            }
        } catch (error) {
            console.error('Login error:', error);
            setLoginError('Server connection error');
        }
    };

    if (!user && screen === 'checking') {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--brand-primary, #371f20)' }}>
                <BrandEmblem size={72} />
            </div>
        );
    }

    // ФОРМА ВХОДА
    if (!user) {
        const text = uiText('login', loginLang);
        const loginLangs = hotelLangs(brand.hotel);
        const dir = dirOf(loginLang);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f7f1eb', direction: dir }}>
                
                {loginLangs.length > 1 && (
                    <div style={{ marginBottom: '20px' }}>
                        <LangPicker value={loginLang} langs={loginLangs} onPick={(l) => { setLoginLang(l); setLangPicked(true); setLoginError(''); }} />
                    </div>
                )}

                <form onSubmit={handleLogin} style={{ background: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', width: '320px', textAlign: 'center' }}>
                    
                    <BrandLogo size={52} color="var(--brand-primary, #371f20)" style={{ marginBottom: '14px' }} />
                    <p style={{ color: '#6e635b', marginBottom: '20px', fontSize: '16px' }}>{text.title}</p>
                    
                    {loginError && <div style={{ color: '#c43d3d', marginBottom: '15px', fontSize: '15px', fontWeight: 'bold' }}>{loginError}</div>}
                    
                    <input 
                        type="text" 
                        placeholder={text.login} 
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required 
                        style={{ width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '6px', border: '1px solid #cfc4ba', boxSizing: 'border-box', fontSize: '17px' }} 
                    />
                    
                    <input 
                        type="password" 
                        placeholder={text.pass} 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required 
                        style={{ width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '6px', border: '1px solid #cfc4ba', boxSizing: 'border-box', fontSize: '17px' }} 
                    />
                    
                    {isPersonalDevice ? <div style={{ marginBottom: '10px' }} /> : (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '25px', cursor: 'pointer', fontSize: '16px', color: '#5a4f48', userSelect: 'none' }}>
                        <input 
                            type="checkbox" 
                            checked={rememberMe} 
                            onChange={(e) => setRememberMe(e.target.checked)} 
                            style={{ width: '18px', height: '18px', accentColor: 'var(--brand-button, #844128)', cursor: 'pointer', margin: 0 }}
                        />
                        {text.remember}
                    </label>
                    )}
                    
                    <button type="submit" style={{ width: '100%', padding: '12px', background: 'var(--brand-button, #844128)', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '18px', cursor: 'pointer' }}>
                        {text.btn}
                    </button>
                </form>
            </div>
        );
    }

    // Безопасное определение роли и прав сисадмина
    const role = user.role ? String(user.role).trim().toLowerCase() : '';
    const isSuper = Number(user.is_superadmin) === 1 || !!user.system_role; // системный пользователь
    const isSysAdmin = isSuper || Number(user.sysadmin) === 1;

    // Владелец системы: общая админка — отели, шаблоны, языки
    if (view === 'system' && isSuper) {
        return (
            <SystemAdmin
                user={user}
                onChangeLang={handleChangeLang}
                onLogout={handleLogout}
                onOpenHotel={async (id) => { storeView('admin'); if (!(await switchHotel(id))) storeView('system'); }}
            />
        );
    }

    // Админка отеля: администратор отеля попадает сюда сразу, владелец системы — из общей админки
    if (view === 'admin' && isSysAdmin) {
        return (
            <AdminDashboard
                user={user}
                onBack={() => setView(isSuper ? 'system' : 'main')}
                backLabel={isSuper ? uiText('admin_dash', user.lang).back_system : undefined}
                onChangeLang={handleChangeLang}
                onLogout={handleLogout}
            />
        );
    }

    // 1. Менеджер -> строго ManagerDashboard
    if (role === 'manager') {
        return (
            <ManagerDashboard 
                user={user} 
                onLogout={handleLogout} 
                onChangeLang={handleChangeLang}
                onOpenAdmin={isSysAdmin ? () => setView('admin') : undefined}
            />
        );
    }

    // Руководитель (и сисадмин) создаёт срочную заявку на экране менеджера
    if (view === 'urgent' && (role === 'head' || isSysAdmin)) {
        return (
            <ManagerDashboard
                user={user}
                onLogout={handleLogout}
                onChangeLang={handleChangeLang}
                onBack={() => setView('main-work')}
            />
        );
    }

    // 2. Начальник (head) -> WorkerDashboard с правами или своя панель
    if (role === 'head') {
        return (
            <WorkerDashboard 
                user={user} 
                onLogout={handleLogout} 
                onChangeLang={handleChangeLang}
                onOpenAdmin={isSysAdmin ? () => setView('admin') : undefined}
                onCreateUrgent={() => setView('urgent')}
                startInWork={view === 'main-work'}
            />
        );
    }

    // 3. Обычный исполнитель -> WorkerDashboard
    return (
        <WorkerDashboard 
            user={user} 
            onLogout={handleLogout} 
            onChangeLang={handleChangeLang}
            onOpenAdmin={isSysAdmin ? () => setView('admin') : undefined}
            onCreateUrgent={isSysAdmin ? () => setView('urgent') : undefined}
            startInWork={view === 'main-work'}
        />
    );
}