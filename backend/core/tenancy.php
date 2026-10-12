<?php
/* Кто в каком отеле и с какой ролью.
 *
 * Права складываются так (сильнейшее побеждает):
 *   users.is_superadmin           — владелец системы: все отели всех сетей, как администратор отеля;
 *   org_members.role = org_admin   — администратор сети: все отели своей сети, как администратор отеля;
 *   org_members.role = org_viewer  — наблюдатель сети: все отели сети, только отчёты (роль viewer);
 *   hotel_members                  — роль в конкретном отеле: worker / manager / head + флаг is_admin.
 *
 * В API:
 *   $me = app_require();                    // любой вошедший с доступом к текущему отелю
 *   $me = app_require(['head']);            // руководитель (администратор отеля проходит всегда)
 *   $me = app_require(null, true);          // только администратор отеля
 *   $hid = $me['hotel_id'];                 // все запросы к данным — с WHERE hotel_id = $hid
 *
 * app_require() заодно ставит часовой пояс отеля для PHP и для PostgreSQL (NOW(), CURRENT_DATE).
 */
require_once __DIR__ . '/auth.php';

const APP_HOTEL_ROLES = ['worker', 'manager', 'head'];

/** Отели, доступные пользователю: [hotel_id => ['hotel' => строка hotels, 'role', 'is_admin', 'via']]. */
function app_user_hotels(array $user): array
{
    $uid = (int)$user['id'];
    $out = [];

    $add = function (array $h, string $role, int $isAdmin, string $via) use (&$out) {
        $id = (int)$h['id'];
        $cur = $out[$id] ?? null;
        $rank = fn($r) => $r === null ? -1 : ($r['is_admin'] * 10 + array_search($r['role'], ['viewer', 'worker', 'manager', 'head'], true));
        $new = ['hotel' => $h, 'role' => $role, 'is_admin' => $isAdmin, 'via' => $via];
        if ($cur === null || $rank($new) > $rank($cur)) $out[$id] = $new;
    };

    $hotelCols = "h.*, o.name AS org_name";

    if ((int)$user['is_superadmin'] === 1) {
        foreach (db_all("SELECT $hotelCols FROM hotels h JOIN organizations o ON o.id = h.org_id
                         WHERE h.active ORDER BY o.name, h.name") as $h) $add($h, 'head', 1, 'super');
    }

    foreach (db_all("SELECT $hotelCols, om.role AS org_role FROM org_members om
                     JOIN organizations o ON o.id = om.org_id AND o.active
                     JOIN hotels h ON h.org_id = om.org_id AND h.active
                     WHERE om.user_id = ? ORDER BY o.name, h.name", [$uid]) as $h) {
        if ($h['org_role'] === 'org_admin') $add($h, 'head', 1, 'org_admin');
        else $add($h, 'viewer', 0, 'org_viewer');
    }

    foreach (db_all("SELECT $hotelCols, hm.role AS member_role, hm.is_admin AS member_admin FROM hotel_members hm
                     JOIN hotels h ON h.id = hm.hotel_id AND h.active
                     JOIN organizations o ON o.id = h.org_id AND o.active
                     WHERE hm.user_id = ? AND hm.active ORDER BY o.name, h.name", [$uid]) as $h) {
        $add($h, $h['member_role'], (int)$h['member_admin'], 'member');
    }

    // Администратор сети, у которого есть и своя роль в отеле, видит свою роль (исполнитель с правами админа)
    foreach ($out as $id => &$r) {
        if ($r['via'] === 'member' || $r['role'] !== 'head' || !$r['is_admin']) continue;
        $own = db_value("SELECT role FROM hotel_members WHERE hotel_id = ? AND user_id = ? AND active", [$id, $uid]);
        if ($own) $r['role'] = $own;
    }
    unset($r);
    return $out;
}

/** Сети, где пользователь администратор или наблюдатель (владелец системы — во всех). */
function app_user_orgs(array $user): array
{
    if ((int)$user['is_superadmin'] === 1) {
        return db_all("SELECT id, name, slug, 'org_admin' AS role FROM organizations ORDER BY name");
    }
    return db_all("SELECT o.id, o.name, o.slug, om.role FROM org_members om
                   JOIN organizations o ON o.id = om.org_id WHERE om.user_id = ? ORDER BY o.name", [$user['id']]);
}

/** Языки отеля (строка hotels) — только включённые в системе, по порядку; хотя бы один. */
function app_hotel_langs(array $h): array
{
    $active = app_languages();
    $langs = array_values(array_filter(pg_array($h['languages']), fn($l) => isset($active[$l])));
    return $langs ?: [app_normalize_lang('en')];
}

/** Отель для показа во фронтенде: настройки и брендинг, без служебного. */
function app_hotel_public(array $h): array
{
    $active = app_languages();
    $langs = app_hotel_langs($h);
    $settings = db_json($h['settings'] ?? null);
    $titles = db_json($h['brand_title'] ?? null);
    $title = [];
    foreach ($langs as $l) $title[$l] = $titles[$l] ?? $h['name'];
    return [
        'id'           => (int)$h['id'],
        'org_id'       => (int)$h['org_id'],
        'org_name'     => $h['org_name'] ?? null,
        'name'         => $h['name'],
        'slug'         => $h['slug'],
        'timezone'     => $h['timezone'],
        'default_lang' => $h['default_lang'],
        'languages'    => $langs,
        // Как писать каждый язык отеля (подписи и направление текста)
        'language_info' => array_map(fn($l) => ['code' => $l, 'name' => $active[$l]['native_name'] ?: $active[$l]['name'],
                                               'rtl' => (bool)$active[$l]['is_rtl']], $langs),
        'brand' => [
            'title' => (object)$title,
            'subtitle'      => $h['brand_subtitle'],
            'color_primary' => $h['color_primary'],
            'color_accent'  => $h['color_accent'],
            'color_text'    => $h['color_text'],
            'color_button'  => $h['color_button'] ?? $h['color_primary'],
            'logo_url'      => $h['logo_url'],
        ],
        'settings' => $settings ?: new stdClass(),
    ];
}

/** Массив PostgreSQL ({ru,en}) → массив PHP. Только простые значения без кавычек и запятых (коды языков). */
function pg_array($v): array
{
    if (is_array($v)) return $v;
    $v = trim((string)$v, '{}');
    return $v === '' ? [] : array_map(fn($x) => trim($x, '"'), explode(',', $v));
}

/** Массив PHP → литерал массива PostgreSQL для параметра (только коды и простые слова). */
function pg_array_literal(array $a): string
{
    return '{' . implode(',', array_map(fn($x) => preg_replace('/[^A-Za-z0-9_-]/', '', (string)$x), $a)) . '}';
}

/** Часовой пояс отеля для PHP (date()) и для этой связи с PostgreSQL (NOW(), CURRENT_DATE, вывод timestamptz). */
function app_apply_timezone(string $tz): void
{
    try {
        $zone = new DateTimeZone($tz);
    } catch (Exception $e) {
        $zone = new DateTimeZone('UTC');
    }
    date_default_timezone_set($zone->getName());
    db_exec("SELECT set_config('TimeZone', ?, false)", [$zone->getName()]);
}

/**
 * Текущий пользователь с контекстом отеля или null (не вошёл).
 * Отель: выбранный в сессии, иначе последний, иначе первый доступный.
 * hotel_id = null — у пользователя нет ни одного отеля (например, новая сеть без отелей).
 */
function app_current(bool $keepOpen = false): ?array
{
    $user = app_session_user($keepOpen);
    if (!$user) return null;

    $hotels = app_user_hotels($user);
    $want = $user['session_hotel_id'] ?? null;
    if (!$want || !isset($hotels[$want])) $want = $user['last_hotel_id'] !== null ? (int)$user['last_hotel_id'] : null;
    if (!$want || !isset($hotels[$want])) $want = $hotels ? array_key_first($hotels) : null;

    $cur = $want ? $hotels[$want] : null;
    return [
        'id'            => (int)$user['id'],
        'login'         => $user['login'],
        'name'          => $user['display_name'],
        'lang'          => $user['session_lang'],
        'is_superadmin' => (int)$user['is_superadmin'],
        'hotel_id'      => $cur ? (int)$want : null,
        'hotel'         => $cur ? $cur['hotel'] : null,
        'role'          => $cur ? $cur['role'] : null,
        'is_admin'      => $cur ? (int)$cur['is_admin'] : 0,
        'hotels'        => $hotels,
    ];
}

/**
 * Пускает только вошедших с доступом к текущему отелю.
 * $roles — допустимые роли в отеле (администратор отеля проходит всегда), null — любая, кроме наблюдателя.
 * $adminOnly — только администратор отеля. 'viewer' в $roles пускает наблюдателя сети (отчёты).
 */
function app_require(?array $roles = null, bool $adminOnly = false): array
{
    $me = app_current();
    if (!$me) app_json_fail(401, 'auth_required');
    if (!$me['hotel_id']) app_json_fail(403, 'no_hotel');
    $isAdmin = $me['is_admin'] === 1;
    if ($adminOnly && !$isAdmin) app_json_fail(403, 'forbidden');
    if (!$isAdmin) {
        $allowed = $roles ?? APP_HOTEL_ROLES;
        if (!in_array($me['role'], $allowed, true)) app_json_fail(403, 'forbidden');
    }
    app_apply_timezone($me['hotel']['timezone']);
    return $me;
}

/** Пускает администратора сети $orgId (или владельца системы). */
function app_require_org_admin(int $orgId): array
{
    $me = app_current();
    if (!$me) app_json_fail(401, 'auth_required');
    if (!app_is_org_admin($me, $orgId)) app_json_fail(403, 'forbidden');
    return $me;
}

function app_is_org_admin(array $me, int $orgId): bool
{
    if ($me['is_superadmin'] === 1) return true;
    return (bool)db_value("SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ? AND role = 'org_admin'", [$orgId, $me['id']]);
}

/** Переключить текущий отель. false — нет доступа. */
function app_select_hotel(array $me, int $hotelId): bool
{
    if (!isset($me['hotels'][$hotelId])) return false;
    app_session_set(null, $hotelId);
    db_exec("UPDATE users SET last_hotel_id = ? WHERE id = ?", [$hotelId, $me['id']]);
    return true;
}

/** Ответ для фронтенда: кто вошёл, в каком отеле, куда ещё можно переключиться. */
function app_me_payload(array $me): array
{
    $hotels = [];
    foreach ($me['hotels'] as $id => $h) {
        $hotels[] = [
            'id' => $id, 'name' => $h['hotel']['name'], 'org_id' => (int)$h['hotel']['org_id'],
            'org_name' => $h['hotel']['org_name'] ?? null, 'role' => $h['role'], 'is_admin' => (int)$h['is_admin'],
        ];
    }
    $user = ['id' => $me['id'], 'login' => $me['login'], 'name' => $me['name'], 'lang' => $me['lang'],
             'role' => $me['role'], 'is_admin' => $me['is_admin'], 'is_superadmin' => $me['is_superadmin'],
             // как в Ramada, чтобы старый интерфейс работал без переделки
             'sysadmin' => $me['is_admin']];
    return [
        'success' => true,
        'user'    => $user,
        'hotel'   => $me['hotel'] ? app_hotel_public($me['hotel']) : null,
        'hotels'  => $hotels,
        'orgs'    => app_user_orgs(app_load_user($me['id']) ?? ['id' => $me['id'], 'is_superadmin' => 0]),
    ];
}
