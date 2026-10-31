<?php
/* Админка отеля → Сотрудники: люди текущего отеля, их роли и доступ.
 * Ответы в том же виде, что в Ramada (name, role, sysadmin = администратор отеля, active).
 *
 * Логин и пароль у человека общие на все отели. Менять их можно, только если администратор
 * управляет всеми отелями этого человека (чужую сеть не задеть); роль в отеле — всегда.
 *
 * GET  ?action=list
 * POST ?action=save       {id?, name, password?, role, sysadmin, active}
 * POST ?action=delete     {id}       — убрать из отеля (записи о работе остаются)
 * POST ?action=logout_all {id}
 */
require_once __DIR__ . '/../core/admin.php';
$me = admin_require();
$hid = $me['hotel_id'];

$action = $_GET['action'] ?? 'list';
if ($action !== 'list') api_require_post();

function users_member(int $hid, int $uid): ?array
{
    return db_one("SELECT u.*, m.role, m.is_admin, m.active AS member_active
                   FROM hotel_members m JOIN users u ON u.id = m.user_id WHERE m.hotel_id = ? AND m.user_id = ?", [$hid, $uid]);
}

/** Может ли этот администратор менять логин и пароль человека: все его отели под управлением $me. */
function users_can_edit_account(array $me, int $uid): bool
{
    if ($me['is_superadmin'] === 1 || $uid === $me['id']) return true;
    foreach (db_all("SELECT hotel_id FROM hotel_members WHERE user_id = ?", [$uid]) as $r) {
        $h = (int)$r['hotel_id'];
        if (!isset($me['hotels'][$h]) || (int)$me['hotels'][$h]['is_admin'] !== 1) return false;
    }
    foreach (db_all("SELECT org_id FROM org_members WHERE user_id = ?", [$uid]) as $r) {
        if (!app_is_org_admin($me, (int)$r['org_id'])) return false;
    }
    return true;
}

/** Останется ли у отеля хоть один администратор (свой или администратор сети). */
function users_admins_left(array $me, int $hid, int $exceptId): int
{
    return (int)db_value("SELECT COUNT(*) FROM hotel_members m JOIN users u ON u.id = m.user_id AND u.active
                          WHERE m.hotel_id = ? AND m.is_admin AND m.active AND m.user_id <> ?", [$hid, $exceptId])
         + (int)db_value("SELECT COUNT(*) FROM org_members WHERE org_id = ? AND role = 'org_admin' AND user_id <> ?",
                          [(int)$me['hotel']['org_id'], $exceptId]);
}

if ($action === 'list') {
    $users = [];
    foreach (db_all("SELECT u.id, u.login, u.display_name, u.password_hash, u.active AS user_active, m.role, m.is_admin, m.active,
                            (SELECT COUNT(*) FROM hotel_members x WHERE x.user_id = u.id) AS hotels_count,
                            (SELECT COUNT(*) FROM auth_tokens t WHERE t.user_id = u.id AND t.expires_at > NOW()) AS devices,
                            (SELECT MAX(COALESCE(t.last_used_at, t.created_at)) FROM auth_tokens t WHERE t.user_id = u.id AND t.expires_at > NOW()) AS last_seen
                     FROM hotel_members m JOIN users u ON u.id = m.user_id
                     WHERE m.hotel_id = ? ORDER BY (m.active AND u.active) DESC, u.display_name ASC", [$hid]) as $w) {
        $users[] = [
            'id'       => (int)$w['id'],
            'name'     => $w['display_name'],
            'login'    => $w['login'],
            'role'     => $w['role'],
            'sysadmin' => (int)$w['is_admin'],
            'active'   => (int)$w['active'] === 1 && (int)$w['user_active'] === 1 ? 1 : 0,
            'has_password' => trim((string)$w['password_hash']) !== '',
            // пароль открытым текстом (перенесён из Ramada, человек ещё не входил) — подсветим, чтобы сменить
            'plain_password' => $w['password_hash'] !== '' && !preg_match('/^\$2[aby]\$|^\$argon2/', (string)$w['password_hash']),
            'other_hotels' => max(0, (int)$w['hotels_count'] - 1),
            'can_edit_account' => users_can_edit_account($me, (int)$w['id']),
            'devices'  => (int)$w['devices'],
            'last_seen' => $w['last_seen'],
        ];
    }
    admin_ok(['users' => $users, 'me' => $me['id']]);
}

$in = admin_input();

if ($action === 'save') {
    $id = (int)($in['id'] ?? 0);
    $name = clean_text($in['name'] ?? '', 100);
    $role = strtolower(trim((string)($in['role'] ?? 'worker')));
    $isAdmin = !empty($in['sysadmin']) ? 1 : 0;
    $active = array_key_exists('active', $in) ? (!empty($in['active']) ? 1 : 0) : 1;
    $password = (string)($in['password'] ?? '');

    if ($name === '') admin_fail('name_required');
    if (!in_array($role, APP_HOTEL_ROLES, true)) admin_fail('bad_role');
    if ($password !== '' && mb_strlen($password) < 4) admin_fail('password_short');

    if ($id === 0) {
        // Логин = имя, как в Ramada; он один на всю систему
        if (db_one("SELECT id FROM users WHERE LOWER(login) = LOWER(?)", [$name])) admin_fail('name_taken');
        if ($password === '') admin_fail('password_required');
        $newId = (int)db_value("INSERT INTO users (login, display_name, password_hash, lang, last_hotel_id) VALUES (?, ?, ?, ?, ?) RETURNING id",
            [$name, $name, password_hash($password, PASSWORD_DEFAULT), $me['hotel']['default_lang'], $hid]);
        db_exec("INSERT INTO hotel_members (hotel_id, user_id, role, is_admin, active) VALUES (?, ?, ?, ?, ?)",
            [$hid, $newId, $role, (bool)$isAdmin, (bool)$active]);
        admin_audit($me, 'insert', 'hotel_members', ['user_id' => $newId], null, users_member($hid, $newId));
        admin_ok(['id' => $newId]);
    }

    $before = users_member($hid, $id);
    if (!$before) admin_fail('not_found');

    // Себя не лишить доступа, и у отеля должен остаться администратор
    if ($id === $me['id'] && (!$isAdmin || !$active) && ($me['hotels'][$hid]['via'] ?? '') === 'member') admin_fail('self_lockout');
    if ((!$isAdmin || !$active) && (int)$before['is_admin'] === 1 && users_admins_left($me, $hid, $id) === 0) admin_fail('last_admin');

    db_exec("UPDATE hotel_members SET role = ?, is_admin = ?, active = ? WHERE hotel_id = ? AND user_id = ?",
        [$role, (bool)$isAdmin, (bool)$active, $hid, $id]);

    // Имя (оно же логин) и пароль — общие на все отели
    $accountChanged = $name !== $before['display_name'] || $password !== '';
    if ($accountChanged) {
        if (!users_can_edit_account($me, $id)) admin_fail('other_hotels');
        if ($name !== $before['display_name']) {
            if (db_one("SELECT id FROM users WHERE LOWER(login) = LOWER(?) AND id <> ?", [$name, $id])) admin_fail('name_taken');
            // Логин меняем вместе с именем, только если он совпадал с именем (как было в Ramada)
            $newLogin = $before['login'] === $before['display_name'] ? $name : $before['login'];
            db_exec("UPDATE users SET display_name = ?, login = ? WHERE id = ?", [$name, $newLogin, $id]);
        }
        if ($password !== '') {
            db_exec("UPDATE users SET password_hash = ? WHERE id = ?", [password_hash($password, PASSWORD_DEFAULT), $id]);
        }
    }

    // Новый пароль — «Запомнить меня» на всех устройствах больше не действует.
    // Блокировка в отеле закрывает доступ только к этому отелю: app_current() его больше не покажет.
    if ($password !== '') app_forget_user_tokens($id);

    admin_audit($me, 'update', 'hotel_members', ['user_id' => $id], $before, users_member($hid, $id));
    admin_ok();
}

if ($action === 'logout_all') {
    $id = (int)($in['id'] ?? 0);
    if (!users_member($hid, $id)) admin_fail('not_found');
    if (!users_can_edit_account($me, $id)) admin_fail('other_hotels');
    app_forget_user_tokens($id);
    admin_audit($me, 'logout_all', 'users', $id, null, null);
    admin_ok();
}

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    $before = users_member($hid, $id);
    if (!$before) admin_fail('not_found');
    if ($id === $me['id']) admin_fail('self_lockout');
    if ((int)$before['is_admin'] === 1 && users_admins_left($me, $hid, $id) === 0) admin_fail('last_admin');

    // Из отеля убираем; учётную запись не удаляем — на неё ссылаются заявки и история.
    // Если других отелей и ролей в сети у человека нет, учётная запись блокируется.
    db_exec("DELETE FROM hotel_members WHERE hotel_id = ? AND user_id = ?", [$hid, $id]);
    $left = (int)db_value("SELECT COUNT(*) FROM hotel_members WHERE user_id = ?", [$id])
          + (int)db_value("SELECT COUNT(*) FROM org_members WHERE user_id = ?", [$id]);
    if ($left === 0 && (int)$before['is_superadmin'] !== 1) {
        db_exec("UPDATE users SET active = false WHERE id = ?", [$id]);
        app_forget_user_tokens($id);
    }
    admin_audit($me, 'delete', 'hotel_members', ['user_id' => $id], $before, null);
    admin_ok();
}

admin_fail('bad_action');
