import { useState, useEffect } from 'react';
import WorkerDashboard from './pages/WorkerDashboard';
import ManagerDashboard from './pages/ManagerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import { BrandLogo, BrandEmblem } from './components/BrandLogo';
import { disablePush } from './notify/push';
import { LANGS, readCachedUser, cacheUser, clearCachedUser, fetchMe, login, logout, saveLang, installUnauthorizedHook, dropLangParam } from './auth';
import { setBrand, useBrand, hotelTitle, loadPublicBrand, switchHotel } from './brand';

const loginUi = {
    ru: { title: 'Вход в систему', login: 'Логин (Имя)', pass: 'Пароль', btn: 'Войти', remember: 'Запомнить меня', error: 'Неверный логин или пароль' },
    en: { title: 'System Login', login: 'Username', pass: 'Password', btn: 'Login', remember: 'Remember me', error: 'Invalid login or password' },
    he: { title: 'התחברות למערכת', login: 'שם משתמש', pass: 'סיסמה', btn: 'כניסה', remember: 'זכור אותי', error: 'שם משתמש או סיסמה שגויים' },
    ar: { title: 'تسجيل الدخول', login: 'اسم المستخدم', pass: 'كلمة المرور', btn: 'دخول', remember: 'تذكرني', error: 'خطأ في اسم المستخدم أو كلمة المرور' }
};

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

// Окно отеля с выбором языка: заголовки на языках отеля из его настроек.
// Показывается, пока никто не вошёл (в том числе после выхода из приложения).
const hotelLangs = (hotel) => (hotel?.languages?.length ? hotel.languages : LANGS).filter((l) => LANGS.includes(l));

function WelcomeScreen({ onPick }) {
    const { hotel } = useBrand();
    const WELCOME = hotelLangs(hotel).map((lang) => ({
        lang, dir: ['he', 'ar'].includes(lang) ? 'rtl' : 'ltr', text: hotelTitle(hotel, lang) || lang.toUpperCase()
    }));
    return (
        <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', boxSizing: 'border-box', background: 'var(--brand-primary, #371f20)', color: 'var(--brand-text, #f9edd3)', fontFamily: '-apple-system, sans-serif' }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: '16px', padding: '36px 24px', maxWidth: '700px', width: '100%', boxSizing: 'border-box', boxShadow: '0 8px 32px 0 rgba(90, 30, 15, 0.25)', border: '1px solid rgba(205, 170, 124, 0.35)', textAlign: 'center' }}>
                <BrandLogo size={64} style={{ marginBottom: '30px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {WELCOME.map(w => (
                        <button key={w.lang} type="button" dir={w.dir} onClick={() => onPick(w.lang)}
                            style={{ background: 'rgba(205, 170, 124, 0.14)', padding: '18px 24px', borderRadius: '10px', border: '1px solid rgba(205, 170, 124, 0.45)', color: 'var(--brand-text, #f9edd3)', cursor: 'pointer', fontSize: '1.5rem', fontWeight: 500, fontFamily: 'inherit' }}>
                            {w.text}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function App() {
    const brand = useBrand();
    const [user, setUser] = useState(null);
    const [view, setView] = useState('main'); // 'main' или 'admin'
    // Что показывать без пользователя: 'checking' (спрашиваем сервер) | 'welcome' | 'login'
    const [screen, setScreen] = useState('checking');
    
    const [loginLang, setLoginLang] = useState('ru'); 
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
        setView('main');
        setScreen('welcome');
    };

    useEffect(() => {
        const urlLang = new URLSearchParams(window.location.search).get('lang');
        const pickedLang = LANGS.includes(urlLang) ? urlLang : null;
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
                setLoginLang(u.lang || 'ru');
                setUser(u);
                dropLangParam();
                return;
            }

            if (me.offline) {
                // Нет связи с сервером: показываем последнего запомненного, данные подтянутся с сетью
                const cached = readCachedUser();
                if (cached) {
                    setLoginLang(cached.lang || 'ru');
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
                // Пришёл из окна выбора языка (index.php) — сразу форма входа
                setLoginLang(pickedLang);
                setScreen('login');
            } else {
                setScreen('welcome');
            }
        })();

        return () => { cancelled = true; };
    }, []);

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
                setView('main');
                dropLangParam();
            } else {
                setLoginError(loginUi[loginLang].error);
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

    if (!user && screen === 'welcome') {
        return <WelcomeScreen onPick={(lang) => { setLoginLang(lang); setLoginError(''); setScreen('login'); }} />;
    }

    // ФОРМА ВХОДА
    if (!user) {
        const text = loginUi[loginLang];
        const loginLangs = hotelLangs(brand.hotel);
        const dir = ['he', 'ar'].includes(loginLang) ? 'rtl' : 'ltr';

        return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f7f1eb', direction: dir }}>
                
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', fontWeight: 'bold' }}>
                    {loginLangs.map((l) => (
                        <span key={l} style={{ cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', background: loginLang === l ? 'var(--brand-button, #844128)' : '#fff', color: loginLang === l ? '#fff' : '#3f3530' }} onClick={() => setLoginLang(l)}>{l.toUpperCase()}</span>
                    ))}
                </div>

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
    const isSysAdmin = Number(user.sysadmin) === 1;

    // Если сисадмин нажал кнопку перехода в глобальную админку
    if (view === 'admin' && isSysAdmin) {
        return (
            <AdminDashboard 
                user={user} 
                onBack={() => setView('main')} 
                onChangeLang={handleChangeLang} 
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