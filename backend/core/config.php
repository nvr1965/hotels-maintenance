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
    if (getenv('HOTELAPP_DB')) $local['db']['name'] = getenv('HOTELAPP_DB');
    $cfg = array_replace_recursive($base, is_array($local) ? $local : []);
    return $cfg;
}
