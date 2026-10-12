<?php
/* Вход. POST {username, password, lang, remember} → то же, что me.php. */
require_once __DIR__ . '/../core/api.php';
api_require_post();

$in = api_input();
$login    = trim((string)($in['username'] ?? ''));
$password = (string)($in['password'] ?? '');
$lang     = app_normalize_lang($in['lang'] ?? 'ru');
$remember = !empty($in['remember']);

if ($login === '' || $password === '') api_fail('empty_credentials');

// Перебор паролей: небольшая пауза на каждую неудачу
$user = app_check_password($login, $password);
if (!$user) {
    usleep(400000);
    api_fail('invalid_login');
}

// Отель — последний, где работал (app_current сам проверит, что доступ ещё есть)
app_login((int)$user['id'], $lang, $remember, $user['last_hotel_id'] !== null ? (int)$user['last_hotel_id'] : null);
$me = app_current();
if (!$me) api_fail('invalid_login');
echo json_encode(app_me_payload($me), JSON_UNESCAPED_UNICODE);
