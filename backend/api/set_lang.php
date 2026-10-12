<?php
/* Запоминает язык: в сессии, в токене устройства и у пользователя. POST {lang}. */
require_once __DIR__ . '/../core/api.php';
api_require_post();

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
$lang = app_normalize_lang(api_input()['lang'] ?? 'ru');
app_session_set($lang, null);
db_exec("UPDATE users SET lang = ? WHERE id = ?", [$lang, $me['id']]);
api_ok(['lang' => $lang]);
