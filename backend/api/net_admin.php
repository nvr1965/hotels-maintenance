<?php
/* Управление сетью: сети, отели (настройки и брендинг), люди и их роли.
 *
 * Кто что может:
 *   владелец системы      — всё, в том числе создавать сети;
 *   администратор сети    — отели своей сети и роли в них, администраторы и наблюдатели сети;
 *   администратор отеля   — роли людей в своём отеле.
 *
 * GET  ?action=orgs
 * POST ?action=org_save          {id?, name, slug}
 * GET  ?action=hotels&org_id=
 * POST ?action=hotel_save        {id?, org_id, name, slug, timezone, default_lang, languages[], brand_title_*, brand_subtitle,
 *                                 color_primary, color_accent, color_text, color_button, logo_url, address, active, settings{}, copy_from_hotel_id?}
 * GET  ?action=members&hotel_id=
 * POST ?action=member_save       {hotel_id, user_id? | login+display_name+password, role, is_admin, active}
 * POST ?action=member_remove     {hotel_id, user_id}
 * GET  ?action=org_members&org_id=
 * POST ?action=org_member_save   {org_id, user_id? | login+display_name+password, role}
 * POST ?action=org_member_remove {org_id, user_id}
 * POST ?action=user_save         {id, login, display_name, password?, active}
 */
require_once __DIR__ . '/../core/api.php';

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
$action = $_GET['action'] ?? '';
if ($action !== '' && !in_array($action, ['orgs', 'hotels', 'members', 'org_members'], true)) api_require_post();
$in = api_input();

const NET_ORG_ROLES = ['org_admin', 'org_viewer'];

function net_valid_slug(string $s): bool
{
    return (bool)preg_match('/^[a-z0-9][a-z0-9-]{1,59}$/', $s);
}

function net_valid_color(?string $c): bool
{
    return $c !== null && (bool)preg_match('/^#[0-9a-fA-F]{6}$/', $c);
}

function net_hotel(int $id): ?array
{
    return db_one("SELECT * FROM hotels WHERE id = ?", [$id]);
}

/** Администратор отеля (в том числе через сеть или как владелец системы). */
function net_can_manage_hotel(array $me, int $hotelId): bool
{
    return isset($me['hotels'][$hotelId]) && (int)$me['hotels'][$hotelId]['is_admin'] === 1;
}

/** Найти пользователя по user_id или создать нового из login + display_name + password. */
function net_user_from_input(array $me, array $in): array
{
    $uid = (int)($in['user_id'] ?? 0);
    if ($uid) {
        $u = db_one("SELECT * FROM users WHERE id = ?", [$uid]);
        if (!$u) api_fail('user_not_found');
        return $u;
    }
    $login = clean_text($in['login'] ?? '', 100);
    $name = clean_text($in['display_name'] ?? $login, 100);
    $password = (string)($in['password'] ?? '');
    if ($login === '') api_fail('login_required');
    // Логин занят: это может быть тот же человек из другого отеля — тогда передавайте user_id
    if (db_one("SELECT id FROM users WHERE LOWER(login) = LOWER(?)", [$login])) api_fail('login_taken');
    if (mb_strlen($password) < 6) api_fail('password_short');
    db_exec("INSERT INTO users (login, display_name, password_hash, lang) VALUES (?, ?, ?, ?)",
        [$login, $name !== '' ? $name : $login, password_hash($password, PASSWORD_DEFAULT), $me['lang']]);
    $u = db_one("SELECT * FROM users WHERE id = ?", [db_insert_id()]);
    audit($me, 'insert', 'users', $u['id'], null, $u);
    return $u;
}

/** Справочники нового отеля копируются из образца (обычно — из другого отеля сети). */
function net_copy_dictionaries(int $fromHotel, int $toHotel): array
{
    $n = [];
    db_exec("INSERT INTO asset_dictionary (hotel_id, term_en, term_ru, term_he, term_ar)
             SELECT ?, term_en, term_ru, term_he, term_ar FROM asset_dictionary WHERE hotel_id = ?", [$toHotel, $fromHotel]);
    $n['asset_dictionary'] = (int)db_value("SELECT COUNT(*) FROM asset_dictionary WHERE hotel_id = ?", [$toHotel]);
    db_exec("INSERT INTO room_checklist_dict (hotel_id, name_ru, name_en, name_he, name_ar, sort_order)
             SELECT ?, name_ru, name_en, name_he, name_ar, sort_order FROM room_checklist_dict WHERE hotel_id = ? ORDER BY sort_order, id",
        [$toHotel, $fromHotel]);
    $n['room_checklist_dict'] = (int)db_value("SELECT COUNT(*) FROM room_checklist_dict WHERE hotel_id = ?", [$toHotel]);
    db_exec("INSERT INTO routine_tasks (hotel_id, name_ru, name_en, name_he, name_ar, requires_ocr, ocr_type, sort_order)
             SELECT ?, name_ru, name_en, name_he, name_ar, requires_ocr, ocr_type, sort_order FROM routine_tasks WHERE hotel_id = ? ORDER BY sort_order, id",
        [$toHotel, $fromHotel]);
    $n['routine_tasks'] = (int)db_value("SELECT COUNT(*) FROM routine_tasks WHERE hotel_id = ?", [$toHotel]);
    return $n;
}

// ---------------------------------------------------------------- сети

if ($action === 'orgs') {
    $orgs = [];
    foreach (app_user_orgs(app_load_user($me['id'])) as $o) {
        $o['id'] = (int)$o['id'];
        $o['hotels'] = (int)db_value("SELECT COUNT(*) FROM hotels WHERE org_id = ?", [$o['id']]);
        $orgs[] = $o;
    }
    api_ok(['orgs' => $orgs, 'can_create' => $me['is_superadmin'] === 1]);
}

if ($action === 'org_save') {
    $id = (int)($in['id'] ?? 0);
    $name = clean_text($in['name'] ?? '', 150);
    $slug = strtolower(clean_text($in['slug'] ?? '', 60));
    if ($name === '') api_fail('name_required');
    if (!net_valid_slug($slug)) api_fail('bad_slug');
    if (db_one("SELECT id FROM organizations WHERE slug = ? AND id <> ?", [$slug, $id])) api_fail('slug_taken');

    if ($id === 0) {
        if ($me['is_superadmin'] !== 1) api_fail('forbidden', [], 403);
        db_exec("INSERT INTO organizations (name, slug) VALUES (?, ?)", [$name, $slug]);
        $id = db_insert_id();
        audit($me, 'insert', 'organizations', $id, null, db_one("SELECT * FROM organizations WHERE id = ?", [$id]), null, $id);
        api_ok(['id' => $id]);
    }
    if (!app_is_org_admin($me, $id)) api_fail('forbidden', [], 403);
    $before = db_one("SELECT * FROM organizations WHERE id = ?", [$id]);
    if (!$before) api_fail('not_found');
    db_exec("UPDATE organizations SET name = ?, slug = ? WHERE id = ?", [$name, $slug, $id]);
    audit($me, 'update', 'organizations', $id, $before, db_one("SELECT * FROM organizations WHERE id = ?", [$id]), null, $id);
    api_ok(['id' => $id]);
}

// ---------------------------------------------------------------- отели

if ($action === 'hotels') {
    $orgId = (int)($_GET['org_id'] ?? 0);
    if (!app_is_org_admin($me, $orgId)) api_fail('forbidden', [], 403);
    $hotels = [];
    foreach (db_all("SELECT h.*, o.name AS org_name,
                            (SELECT COUNT(*) FROM hotel_members m WHERE m.hotel_id = h.id AND m.active = 1) AS members,
                            (SELECT COUNT(*) FROM hotel_assets a WHERE a.hotel_id = h.id) AS assets
                     FROM hotels h JOIN organizations o ON o.id = h.org_id WHERE h.org_id = ? ORDER BY h.name", [$orgId]) as $h) {
        $hotels[] = app_hotel_public($h) + [
            'active' => (int)$h['active'], 'address' => $h['address'],
            'members' => (int)$h['members'], 'assets' => (int)$h['assets'],
            'raw' => array_intersect_key($h, array_flip(['brand_title_ru', 'brand_title_en', 'brand_title_he', 'brand_title_ar'])),
        ];
    }
    api_ok(['hotels' => $hotels]);
}

if ($action === 'hotel_save') {
    $id = (int)($in['id'] ?? 0);
    $before = $id ? net_hotel($id) : null;
    if ($id && !$before) api_fail('not_found');
    $orgId = $before ? (int)$before['org_id'] : (int)($in['org_id'] ?? 0);
    if (!app_is_org_admin($me, $orgId)) api_fail('forbidden', [], 403);

    $name = clean_text($in['name'] ?? '', 150);
    $slug = strtolower(clean_text($in['slug'] ?? '', 60));
    if ($name === '') api_fail('name_required');
    if (!net_valid_slug($slug)) api_fail('bad_slug');
    if (db_one("SELECT id FROM hotels WHERE slug = ? AND id <> ?", [$slug, $id])) api_fail('slug_taken');

    $tz = (string)($in['timezone'] ?? ($before['timezone'] ?? 'UTC'));
    if (!in_array($tz, DateTimeZone::listIdentifiers(), true)) api_fail('bad_timezone');

    $langs = $in['languages'] ?? explode(',', (string)($before['languages'] ?? 'ru,en,he,ar'));
    $langs = array_values(array_unique(array_filter((array)$langs, fn($l) => in_array($l, APP_LANGS, true))));
    if (!$langs) api_fail('languages_required');
    $defLang = (string)($in['default_lang'] ?? ($before['default_lang'] ?? $langs[0]));
    if (!in_array($defLang, $langs, true)) $defLang = $langs[0];

    $data = [
        'org_id' => $orgId, 'name' => $name, 'slug' => $slug, 'timezone' => $tz,
        'default_lang' => $defLang, 'languages' => implode(',', $langs),
        'brand_subtitle' => clean_text($in['brand_subtitle'] ?? ($before['brand_subtitle'] ?? ''), 200) ?: null,
        'logo_url' => clean_text($in['logo_url'] ?? ($before['logo_url'] ?? ''), 255) ?: null,
        'address' => clean_text($in['address'] ?? ($before['address'] ?? ''), 255) ?: null,
        'active' => array_key_exists('active', $in) ? (!empty($in['active']) ? 1 : 0) : (int)($before['active'] ?? 1),
    ];
    foreach (APP_LANGS as $l) {
        $data["brand_title_$l"] = clean_text($in["brand_title_$l"] ?? ($before["brand_title_$l"] ?? ''), 200) ?: null;
    }
    foreach (['color_primary' => '#1f3a5f', 'color_accent' => '#c9a96e', 'color_text' => '#ffffff', 'color_button' => '#1f3a5f'] as $c => $def) {
        $v = $in[$c] ?? ($before[$c] ?? $def);
        if (!net_valid_color($v)) api_fail('bad_color', ['field' => $c]);
        $data[$c] = strtolower($v);
    }
    if (array_key_exists('settings', $in)) {
        if (!is_array($in['settings'])) api_fail('bad_settings');
        $data['settings_json'] = json_encode($in['settings'], JSON_UNESCAPED_UNICODE);
    }
    if ($data['logo_url'] !== null && !preg_match('#^(/|https://)#', $data['logo_url'])) api_fail('bad_logo_url');

    $cols = array_keys($data);
    if (!$before) {
        db_exec("INSERT INTO hotels (" . implode(', ', $cols) . ") VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ")",
            array_values($data));
        $id = db_insert_id();
        $copied = null;
        $from = (int)($in['copy_from_hotel_id'] ?? 0);
        if ($from) {
            // Копировать можно только из отеля, к которому есть доступ администратора
            if (!net_can_manage_hotel($me, $from) && !app_is_org_admin($me, (int)(net_hotel($from)['org_id'] ?? 0))) api_fail('forbidden', [], 403);
            $copied = net_copy_dictionaries($from, $id);
        }
        audit($me, 'insert', 'hotels', $id, null, net_hotel($id), $id, $orgId);
        api_ok(['id' => $id, 'copied' => $copied]);
    }
    db_exec("UPDATE hotels SET " . implode(', ', array_map(fn($c) => "$c = ?", $cols)) . " WHERE id = ?",
        array_merge(array_values($data), [$id]));
    audit($me, 'update', 'hotels', $id, $before, net_hotel($id), $id, $orgId);
    api_ok(['id' => $id]);
}

// ---------------------------------------------------------------- люди в отеле

if ($action === 'members') {
    $hid = (int)($_GET['hotel_id'] ?? 0);
    if (!net_can_manage_hotel($me, $hid)) api_fail('forbidden', [], 403);
    $rows = db_all("SELECT u.id, u.login, u.display_name, u.active AS user_active, u.lang,
                           m.role, m.is_admin, m.active,
                           (SELECT COUNT(*) FROM hotel_members x WHERE x.user_id = u.id) AS hotels_count,
                           (SELECT COUNT(*) FROM auth_tokens t WHERE t.user_id = u.id AND t.expires_at > NOW()) AS devices
                    FROM hotel_members m JOIN users u ON u.id = m.user_id
                    WHERE m.hotel_id = ? ORDER BY m.active DESC, u.display_name", [$hid]);
    foreach ($rows as &$r) {
        foreach (['id', 'user_active', 'is_admin', 'active', 'hotels_count', 'devices'] as $k) $r[$k] = (int)$r[$k];
    }
    unset($r);
    api_ok(['members' => $rows]);
}

if ($action === 'member_save') {
    $hid = (int)($in['hotel_id'] ?? 0);
    if (!net_can_manage_hotel($me, $hid)) api_fail('forbidden', [], 403);
    $role = (string)($in['role'] ?? 'worker');
    if (!in_array($role, APP_HOTEL_ROLES, true)) api_fail('bad_role');
    $isAdmin = !empty($in['is_admin']) ? 1 : 0;
    $active = array_key_exists('active', $in) ? (!empty($in['active']) ? 1 : 0) : 1;

    $user = net_user_from_input($me, $in);
    $uid = (int)$user['id'];
    // Себя не лишить доступа к отелю (администратор сети и так остаётся администратором)
    if ($uid === $me['id'] && (!$isAdmin || !$active) && ($me['hotels'][$hid]['via'] ?? '') === 'member') api_fail('self_lockout');

    $before = db_one("SELECT * FROM hotel_members WHERE hotel_id = ? AND user_id = ?", [$hid, $uid]);
    db_exec("INSERT INTO hotel_members (hotel_id, user_id, role, is_admin, active) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE role = VALUES(role), is_admin = VALUES(is_admin), active = VALUES(active)",
        [$hid, $uid, $role, $isAdmin, $active]);
    $after = db_one("SELECT * FROM hotel_members WHERE hotel_id = ? AND user_id = ?", [$hid, $uid]);
    audit($me, $before ? 'update' : 'insert', 'hotel_members', ['hotel_id' => $hid, 'user_id' => $uid], $before, $after, $hid);
    api_ok(['user_id' => $uid]);
}

if ($action === 'member_remove') {
    $hid = (int)($in['hotel_id'] ?? 0);
    $uid = (int)($in['user_id'] ?? 0);
    if (!net_can_manage_hotel($me, $hid)) api_fail('forbidden', [], 403);
    if ($uid === $me['id'] && ($me['hotels'][$hid]['via'] ?? '') === 'member') api_fail('self_lockout');
    $before = db_one("SELECT * FROM hotel_members WHERE hotel_id = ? AND user_id = ?", [$hid, $uid]);
    if (!$before) api_fail('not_found');
    // Записи о работе остаются (кто закрыл, кто создал), убирается только доступ к отелю
    db_exec("DELETE FROM hotel_members WHERE hotel_id = ? AND user_id = ?", [$hid, $uid]);
    audit($me, 'delete', 'hotel_members', ['hotel_id' => $hid, 'user_id' => $uid], $before, null, $hid);
    api_ok();
}

// ---------------------------------------------------------------- администраторы и наблюдатели сети

if ($action === 'org_members') {
    $orgId = (int)($_GET['org_id'] ?? 0);
    if (!app_is_org_admin($me, $orgId)) api_fail('forbidden', [], 403);
    $rows = db_all("SELECT u.id, u.login, u.display_name, u.active AS user_active, om.role
                    FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = ? ORDER BY u.display_name", [$orgId]);
    api_ok(['members' => $rows]);
}

if ($action === 'org_member_save') {
    $orgId = (int)($in['org_id'] ?? 0);
    if (!app_is_org_admin($me, $orgId)) api_fail('forbidden', [], 403);
    $role = (string)($in['role'] ?? 'org_viewer');
    if (!in_array($role, NET_ORG_ROLES, true)) api_fail('bad_role');
    $user = net_user_from_input($me, $in);
    $uid = (int)$user['id'];
    if ($uid === $me['id'] && $role !== 'org_admin' && $me['is_superadmin'] !== 1) api_fail('self_lockout');
    $before = db_one("SELECT * FROM org_members WHERE org_id = ? AND user_id = ?", [$orgId, $uid]);
    db_exec("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)",
        [$orgId, $uid, $role]);
    audit($me, $before ? 'update' : 'insert', 'org_members', ['org_id' => $orgId, 'user_id' => $uid], $before,
        db_one("SELECT * FROM org_members WHERE org_id = ? AND user_id = ?", [$orgId, $uid]), null, $orgId);
    api_ok(['user_id' => $uid]);
}

if ($action === 'org_member_remove') {
    $orgId = (int)($in['org_id'] ?? 0);
    $uid = (int)($in['user_id'] ?? 0);
    if (!app_is_org_admin($me, $orgId)) api_fail('forbidden', [], 403);
    if ($uid === $me['id'] && $me['is_superadmin'] !== 1) api_fail('self_lockout');
    $before = db_one("SELECT * FROM org_members WHERE org_id = ? AND user_id = ?", [$orgId, $uid]);
    if (!$before) api_fail('not_found');
    db_exec("DELETE FROM org_members WHERE org_id = ? AND user_id = ?", [$orgId, $uid]);
    audit($me, 'delete', 'org_members', ['org_id' => $orgId, 'user_id' => $uid], $before, null, null, $orgId);
    api_ok();
}

// ---------------------------------------------------------------- учётная запись

if ($action === 'user_save') {
    $uid = (int)($in['id'] ?? 0);
    $before = db_one("SELECT * FROM users WHERE id = ?", [$uid]);
    if (!$before) api_fail('not_found');

    // Менять учётную запись может тот, кто администрирует ВСЕ её отели и сети (чужую сеть не задеть)
    if ($me['is_superadmin'] !== 1 && $uid !== $me['id']) {
        $hotelIds = array_map('intval', array_column(db_all("SELECT hotel_id FROM hotel_members WHERE user_id = ?", [$uid]), 'hotel_id'));
        $orgIds = array_map('intval', array_column(db_all("SELECT org_id FROM org_members WHERE user_id = ?", [$uid]), 'org_id'));
        if (!$hotelIds && !$orgIds) api_fail('forbidden', [], 403);
        foreach ($hotelIds as $h) if (!net_can_manage_hotel($me, $h)) api_fail('forbidden', [], 403);
        foreach ($orgIds as $o) if (!app_is_org_admin($me, $o)) api_fail('forbidden', [], 403);
    }
    if ((int)$before['is_superadmin'] === 1 && $me['is_superadmin'] !== 1) api_fail('forbidden', [], 403);

    $login = clean_text($in['login'] ?? $before['login'], 100);
    $name = clean_text($in['display_name'] ?? $before['display_name'], 100);
    $active = array_key_exists('active', $in) ? (!empty($in['active']) ? 1 : 0) : (int)$before['active'];
    $password = (string)($in['password'] ?? '');
    if ($login === '' || $name === '') api_fail('name_required');
    if (db_one("SELECT id FROM users WHERE LOWER(login) = LOWER(?) AND id <> ?", [$login, $uid])) api_fail('login_taken');
    if ($password !== '' && mb_strlen($password) < 6) api_fail('password_short');
    if ($uid === $me['id'] && !$active) api_fail('self_lockout');

    $sets = ['login = ?', 'display_name = ?', 'active = ?'];
    $params = [$login, $name, $active];
    if ($password !== '') {
        $sets[] = 'password_hash = ?';
        $params[] = password_hash($password, PASSWORD_DEFAULT);
    }
    $params[] = $uid;
    db_exec("UPDATE users SET " . implode(', ', $sets) . " WHERE id = ?", $params);
    // Новый пароль или блокировка — «Запомнить меня» на всех устройствах больше не действует
    if ($password !== '' || !$active) app_forget_user_tokens($uid);
    audit($me, 'update', 'users', $uid, $before, db_one("SELECT * FROM users WHERE id = ?", [$uid]));
    api_ok();
}

api_fail('bad_action');
