<?php
/* Настройки сервера: config.local.php (свой у каждой установки), иначе config.sample.php.
 * Ключи внешних сервисов лежат отдельно в secrets.php, как в Ramada.
 */
function app_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $base = require __DIR__ . '/config.sample.php';
    $local = is_file(__DIR__ . '/config.local.php') ? require __DIR__ . '/config.local.php' : [];
    // Для проверок из командной строки базу можно подменить переменной окружения
    if (getenv('HOTELS_DB')) $local['db']['name'] = getenv('HOTELS_DB');
    $cfg = array_replace_recursive($base, is_array($local) ? $local : []);
    return $cfg;
}

/** Файл ключей, введённых в админке («Переводчики»): рядом с secrets.php, в git и архивы не входит. */
const APP_KEYS_FILE = __DIR__ . '/translator_keys.php';

/** Все ключи: secrets.php, поверх — введённые в админке. $reset — перечитать после записи. */
function app_secrets(bool $reset = false): array
{
    static $all = null;
    if ($all !== null && !$reset) return $all;
    $read = function (string $f): array {
        $v = is_file($f) ? require $f : [];
        return is_array($v) ? $v : [];
    };
    $all = array_merge($read(__DIR__ . '/secrets.php'), $read(APP_KEYS_FILE));
    return $all;
}

/** Ключ внешнего сервиса (secrets.php или введённый в админке); нет — пустая строка. */
function app_secret(string $name): string
{
    return trim((string)(app_secrets()[$name] ?? ''));
}

/** Откуда ключ: 'admin' — введён в админке, 'file' — из secrets.php, null — не задан. */
function app_secret_source(string $name): ?string
{
    static $admin = null;
    $f = APP_KEYS_FILE;
    if ($admin === null) $admin = is_file($f) ? (require $f) : [];
    if (is_array($admin) && trim((string)($admin[$name] ?? '')) !== '') return 'admin';
    return app_secret($name) !== '' ? 'file' : null;
}

/**
 * Записать ключи, введённые в админке: [имя => значение], пустое значение — убрать (вернётся secrets.php).
 * Файл пишется целиком через временный, права 0640. false — не удалось записать.
 */
function app_secrets_save(array $changes): bool
{
    $f = APP_KEYS_FILE;
    $cur = is_file($f) ? (require $f) : [];
    if (!is_array($cur)) $cur = [];
    foreach ($changes as $k => $v) {
        $v = trim((string)$v);
        if ($v === '') unset($cur[$k]); else $cur[$k] = $v;
    }
    ksort($cur);
    $php = "<?php\n// Ключи сервисов, введённые в админке (Переводчики). Не класть в git и архивы.\nreturn " . var_export($cur, true) . ";\n";
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $php, LOCK_EX) === false) return false;
    @chmod($tmp, 0640);
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    if (function_exists('opcache_invalidate')) @opcache_invalidate($f, true);
    app_secrets(true);
    return true;
}
