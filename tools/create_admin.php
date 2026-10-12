<?php
/* Первый вход на чистой установке: владелец системы и первый отель.
 *   php tools/create_admin.php --login=owner [--pass=...] [--name="Имя"] [--hotel="Hotel name"] [--lang=en] [--timezone=Asia/Jerusalem]
 * Без --pass пароль придумывается и печатается один раз.
 * Если сеть и отель уже есть, новый отель не заводится: владелец просто получает доступ к первому отелю.
 * Повторный запуск с тем же логином меняет пароль и снова делает его владельцем системы.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/../backend/core/db.php';

$opt = getopt('', ['login:', 'pass::', 'name::', 'hotel::', 'lang::', 'timezone::']);
$login = trim((string)($opt['login'] ?? ''));
if ($login === '') {
    fwrite(STDERR, "Нужно: php tools/create_admin.php --login=<логин> [--pass=<пароль>] [--hotel=\"Название\"]\n");
    exit(1);
}
$pass = (string)($opt['pass'] ?? '');
$printPass = $pass === '';
if ($printPass) $pass = substr(strtr(base64_encode(random_bytes(12)), '+/', 'xy'), 0, 14);
$lang = (string)($opt['lang'] ?? 'en');
if (!db_value("SELECT 1 FROM languages WHERE code = ?", [$lang])) $lang = 'en';
$tz = (string)($opt['timezone'] ?? 'UTC');
if (!in_array($tz, timezone_identifiers_list(), true)) $tz = 'UTC';

function slugify(string $s, string $fallback): string
{
    $s = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $s), '-'));
    return strlen($s) >= 2 ? substr($s, 0, 60) : $fallback;
}

[$uid, $hid, $newHotel] = db_tx(function () use ($login, $pass, $opt, $lang, $tz) {
    $hid = (int)db_value("SELECT id FROM hotels ORDER BY id LIMIT 1");
    $newHotel = false;
    if (!$hid) {
        $name = trim((string)($opt['hotel'] ?? '')) ?: 'Hotel';
        $orgId = (int)db_value("SELECT id FROM organizations ORDER BY id LIMIT 1")
            ?: (int)db_value("INSERT INTO organizations (name, slug) VALUES (?, ?) RETURNING id", [$name, slugify($name, 'main')]);
        $langs = array_values(array_unique(['en', $lang]));
        $hid = (int)db_value("INSERT INTO hotels (org_id, name, slug, timezone, default_lang, languages, brand_title) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            [$orgId, $name, slugify($name, 'hotel'), $tz, $lang, '{' . implode(',', $langs) . '}', json_encode([$lang => $name], JSON_UNESCAPED_UNICODE)]);
        $newHotel = true;
    }
    $hash = password_hash($pass, PASSWORD_DEFAULT);
    $uid = (int)db_value("SELECT id FROM users WHERE lower(login) = lower(?)", [$login]);
    if ($uid) {
        db_exec("UPDATE users SET password_hash = ?, is_superadmin = true, active = true WHERE id = ?", [$hash, $uid]);
    } else {
        $uid = (int)db_value("INSERT INTO users (login, display_name, password_hash, lang, is_superadmin, last_hotel_id) VALUES (?, ?, ?, ?, true, ?) RETURNING id",
            [$login, trim((string)($opt['name'] ?? '')) ?: $login, $hash, $lang, $hid]);
    }
    db_exec("INSERT INTO hotel_members (hotel_id, user_id, role, is_admin, active) VALUES (?, ?, 'head', true, true)
             ON CONFLICT (hotel_id, user_id) DO UPDATE SET is_admin = true, active = true", [$hid, $uid]);
    return [$uid, $hid, $newHotel];
});

echo ($newHotel ? "Заведён отель №$hid.\n" : "Отель №$hid уже был, владелец получил к нему доступ.\n");
echo "Владелец системы: $login (№$uid)" . ($printPass ? ", пароль: $pass" : '') . "\n";
