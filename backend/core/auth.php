<?php
/* Вход на сервере: сессия PHP + «Запомнить меня». Перенесено из Ramada без изменений по сути.
 *
 * Сессия хранит id пользователя, язык и выбранный отель. Роли при каждом запросе
 * читаются из базы (tenancy.php), поэтому изменения в админке действуют сразу.
 *
 * «Запомнить меня»: cookie hotelapp_remember = «selector:validator», в auth_tokens
 * лежит только sha256 от validator. Cookie живёт APP_REMEMBER_DAYS дней и продлевается.
 *
 * В API обычно нужен не этот файл, а tenancy.php:  $me = app_require(['head']);
 */
require_once __DIR__ . '/db.php';

const APP_LANGS = ['ru', 'en', 'he', 'ar'];
const APP_REMEMBER_COOKIE = 'hotelapp_remember';
const APP_SESSION_NAME = 'HOTELAPPSESS';
const APP_REMEMBER_DAYS = 180;
// Без «Запомнить меня»: сколько держать сессию без действий (сек)
const APP_SESSION_IDLE = 12 * 3600;

function app_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    // Cloudflare Tunnel приходит в Apache по http, но сообщает исходный протокол
    if (strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
    return strpos($_SERVER['HTTP_CF_VISITOR'] ?? '', '"https"') !== false;
}

function app_cookie_options(int $expires): array
{
    return [
        'expires'  => $expires,
        'path'     => '/',
        'secure'   => app_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ];
}

function app_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;

    // Свои файлы сессий: общий C:\xampp\tmp чистят другие сайты XAMPP со своим сроком
    $dir = __DIR__ . '/../sessions';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    if (is_dir($dir) && is_writable($dir)) session_save_path($dir);

    ini_set('session.gc_maxlifetime', (string)APP_SESSION_IDLE);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name(APP_SESSION_NAME);
    $opts = app_cookie_options(0);
    unset($opts['expires']);
    $opts['lifetime'] = 0; // до закрытия браузера; «Запомнить меня» живёт в отдельной cookie
    session_set_cookie_params($opts);
    session_start();
}

function app_normalize_lang($lang): string
{
    return in_array($lang, APP_LANGS, true) ? $lang : 'ru';
}

function app_password_ok(string $password, string $stored): bool
{
    if ($stored === '') return false;
    if (preg_match('/^\$2[aby]\$|^\$argon2/', $stored)) return password_verify($password, $stored);
    // Старые записи Ramada с паролем открытым текстом: пускаем и сразу хэшируем (app_login_with_password)
    return hash_equals($stored, $password);
}

/** Пользователь по id, только действующий. */
function app_load_user(int $id): ?array
{
    global $db;
    $stmt = $db->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row || (int)$row['active'] !== 1) return null;
    return $row;
}

/** Разбирает cookie «Запомнить меня»: [selector, validator] или null. */
function app_read_remember_cookie(): ?array
{
    $raw = $_COOKIE[APP_REMEMBER_COOKIE] ?? '';
    if (!preg_match('/^([a-f0-9]{24}):([a-f0-9]{64})$/', $raw, $m)) return null;
    return [$m[1], $m[2]];
}

function app_clear_remember_cookie(): void
{
    if (isset($_COOKIE[APP_REMEMBER_COOKIE])) {
        setcookie(APP_REMEMBER_COOKIE, '', app_cookie_options(time() - 3600));
        unset($_COOKIE[APP_REMEMBER_COOKIE]);
    }
}

/** Вход по cookie «Запомнить меня». Возвращает [user_id, lang, hotel_id] или null. */
function app_restore_from_cookie(): ?array
{
    global $db;
    $parts = app_read_remember_cookie();
    if (!$parts) {
        app_clear_remember_cookie();
        return null;
    }
    [$selector, $validator] = $parts;

    $stmt = $db->prepare("SELECT id, validator_hash, user_id, lang, hotel_id FROM auth_tokens
                          WHERE selector = ? AND expires_at > NOW()");
    $stmt->bind_param('s', $selector);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row || !hash_equals($row['validator_hash'], hash('sha256', $validator))) {
        app_clear_remember_cookie();
        return null;
    }

    // Скользящий срок: пока человек пользуется приложением, вход не истекает
    $days = APP_REMEMBER_DAYS;
    $stmt = $db->prepare("UPDATE auth_tokens SET last_used_at = NOW(),
                          expires_at = DATE_ADD(NOW(), INTERVAL $days DAY) WHERE id = ?");
    $stmt->bind_param('i', $row['id']);
    $stmt->execute();
    $stmt->close();
    setcookie(APP_REMEMBER_COOKIE, $selector . ':' . $validator, app_cookie_options(time() + $days * 86400));

    return [(int)$row['user_id'], app_normalize_lang($row['lang']), $row['hotel_id'] !== null ? (int)$row['hotel_id'] : null];
}

/**
 * Вошедший пользователь (строка users + lang и hotel_id из сессии) или null.
 * Сессию после чтения закрываем (кроме $keepOpen): PHP блокирует файл сессии,
 * и долгий запрос (распознавание счётчика) иначе задерживал бы все остальные.
 */
function app_session_user(bool $keepOpen = false): ?array
{
    app_session_start();

    $uid     = (int)($_SESSION['uid'] ?? 0);
    $lang    = $_SESSION['lang'] ?? 'ru';
    $hotelId = isset($_SESSION['hotel_id']) ? (int)$_SESSION['hotel_id'] : null;

    if ($uid === 0 && isset($_COOKIE[APP_REMEMBER_COOKIE])) {
        $restored = app_restore_from_cookie();
        if ($restored) {
            [$uid, $lang, $hotelId] = $restored;
            session_regenerate_id(true);
            $_SESSION['uid'] = $uid;
            $_SESSION['lang'] = $lang;
            $_SESSION['hotel_id'] = $hotelId;
        }
    }

    $user = $uid ? app_load_user($uid) : null;
    if ($uid && !$user) {
        // Пользователя удалили или заблокировали — выходим везде
        app_logout();
        return null;
    }
    if (!$keepOpen) session_write_close();
    if (!$user) return null;

    $user['session_lang'] = app_normalize_lang($lang);
    $user['session_hotel_id'] = $hotelId;
    return $user;
}

function app_json_fail(int $code, string $message, array $extra = []): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'message' => $message] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Проверка логина и пароля. Пароль открытым текстом (из Ramada) при удачном входе заменяется хэшем. */
function app_check_password(string $login, string $password): ?array
{
    global $db;
    $stmt = $db->prepare("SELECT * FROM users WHERE login = ?");
    $stmt->bind_param('s', $login);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$user || (int)$user['active'] !== 1) return null;
    if (!app_password_ok($password, (string)$user['password_hash'])) return null;

    if (!preg_match('/^\$2[aby]\$|^\$argon2/', (string)$user['password_hash'])) {
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $stmt->bind_param('si', $hash, $user['id']);
        $stmt->execute();
        $stmt->close();
    }
    return $user;
}

function app_login(int $userId, string $lang, bool $remember, ?int $hotelId): void
{
    global $db;
    $lang = app_normalize_lang($lang);

    app_session_start();
    session_regenerate_id(true);
    $_SESSION['uid'] = $userId;
    $_SESSION['lang'] = $lang;
    $_SESSION['hotel_id'] = $hotelId;

    // Старый токен этого устройства (если был) больше не нужен
    app_forget_device_token();

    if ($remember) {
        $selector  = bin2hex(random_bytes(12));
        $validator = bin2hex(random_bytes(32));
        $hash      = hash('sha256', $validator);
        $ua        = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);
        $days      = APP_REMEMBER_DAYS;
        $stmt = $db->prepare("INSERT INTO auth_tokens (selector, validator_hash, user_id, lang, hotel_id, user_agent, expires_at)
                              VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL $days DAY))");
        $stmt->bind_param('ssisis', $selector, $hash, $userId, $lang, $hotelId, $ua);
        $stmt->execute();
        $stmt->close();
        setcookie(APP_REMEMBER_COOKIE, $selector . ':' . $validator, app_cookie_options(time() + $days * 86400));
        // Заодно чистим просроченные токены
        $db->query("DELETE FROM auth_tokens WHERE expires_at < NOW()");
    }
    session_write_close();
}

/** Удаляет токен «Запомнить меня» этого устройства (из базы и cookie). */
function app_forget_device_token(): void
{
    global $db;
    $parts = app_read_remember_cookie();
    if ($parts) {
        $stmt = $db->prepare("DELETE FROM auth_tokens WHERE selector = ?");
        $stmt->bind_param('s', $parts[0]);
        $stmt->execute();
        $stmt->close();
    }
    app_clear_remember_cookie();
}

/** Выйти на всех устройствах: после смены пароля или блокировки. */
function app_forget_user_tokens(int $userId): void
{
    global $db;
    $stmt = $db->prepare("DELETE FROM auth_tokens WHERE user_id = ?");
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $stmt->close();
}

function app_logout(): void
{
    app_session_start();
    app_forget_device_token();
    $_SESSION = [];
    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires'  => time() - 3600,
        'path'     => $params['path'],
        'secure'   => $params['secure'],
        'httponly' => $params['httponly'],
        'samesite' => $params['samesite'] ?: 'Lax',
    ]);
    session_destroy();
}

/** Запоминает в сессии и в токене этого устройства язык и/или отель. */
function app_session_set(?string $lang = null, ?int $hotelId = null): void
{
    global $db;
    app_session_start();
    if ($lang !== null) $_SESSION['lang'] = app_normalize_lang($lang);
    if ($hotelId !== null) $_SESSION['hotel_id'] = $hotelId;
    session_write_close();

    $parts = app_read_remember_cookie();
    if (!$parts) return;
    if ($lang !== null) {
        $l = app_normalize_lang($lang);
        $stmt = $db->prepare("UPDATE auth_tokens SET lang = ? WHERE selector = ?");
        $stmt->bind_param('ss', $l, $parts[0]);
        $stmt->execute();
        $stmt->close();
    }
    if ($hotelId !== null) {
        $stmt = $db->prepare("UPDATE auth_tokens SET hotel_id = ? WHERE selector = ?");
        $stmt->bind_param('is', $hotelId, $parts[0]);
        $stmt->execute();
        $stmt->close();
    }
}
