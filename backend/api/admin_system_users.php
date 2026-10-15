<?php
/* Системные пользователи (только владелец системы): над отелями, в отелях как сотрудники не числятся.
 *   superadmin — владелец системы: всё, включая отели, шаблоны, языки и этот список;
 *   support    — поддержка: входит в любой отель как его администратор, чтобы помочь.
 *
 * GET  ?action=list
 * POST ?action=save {id?, login, name, role, password?, active?, lang?}   — без id новый; пароль обязателен для нового
 */
require_once __DIR__ . '/../core/api.php';

const SYS_ROLES = ['superadmin', 'support'];

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
if ($me['is_superadmin'] !== 1) app_json_fail(403, 'forbidden');
$action = $_GET['action'] ?? 'list';
if ($action !== 'list') api_require_post();
$in = api_input();

function sys_user(int $id): ?array
{
    return db_one("SELECT id, login, display_name, lang, active, system_role, created_at FROM users WHERE id = ? AND system_role IS NOT NULL", [$id]);
}

if ($action === 'list') {
    $items = array_map(fn($u) => [
        'id' => (int)$u['id'], 'login' => $u['login'], 'name' => $u['display_name'], 'lang' => $u['lang'],
        'role' => $u['system_role'], 'active' => in_array($u['active'], [true, 't', 1, '1'], true), 'me' => (int)$u['id'] === $me['id'],
    ], db_all("SELECT id, login, display_name, lang, active, system_role FROM users WHERE system_role IS NOT NULL
               ORDER BY system_role DESC, lower(display_name)"));
    api_ok(['items' => $items, 'roles' => SYS_ROLES]);
}

if ($action === 'save') {
    $id = (int)($in['id'] ?? 0);
    $before = $id ? sys_user($id) : null;
    if ($id && !$before) api_fail('not_found');
    $login = trim((string)($in['login'] ?? $before['login'] ?? ''));
    $name = clean_text((string)($in['name'] ?? ''), 100) ?: $login;
    $role = (string)($in['role'] ?? $before['system_role'] ?? 'support');
    $active = array_key_exists('active', $in) ? !empty($in['active']) : true;
    $password = (string)($in['password'] ?? '');
    $lang = app_normalize_lang((string)($in['lang'] ?? $before['lang'] ?? $me['lang']));

    if ($login === '' || mb_strlen($login) > 60) api_fail('login_required');
    if (!in_array($role, SYS_ROLES, true)) api_fail('bad_role');
    if ($password !== '' && mb_strlen($password) < 4) api_fail('password_short');
    if (!$id && $password === '') api_fail('password_required');
    // Себя не понизить и не выключить — иначе можно остаться без владельца системы
    if ($id === $me['id'] && ($role !== 'superadmin' || !$active)) api_fail('self_lockout');
    $other = db_value("SELECT id FROM users WHERE lower(login) = lower(?) AND id <> ?", [$login, $id]);
    if ($other) api_fail('login_taken');

    $isSuper = $role === 'superadmin';
    $id = db_tx(function () use ($id, $login, $name, $role, $isSuper, $active, $password, $lang) {
        if (!$id) {
            $id = (int)db_value("INSERT INTO users (login, display_name, password_hash, lang, active, system_role, is_superadmin)
                                 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
                [$login, $name, password_hash($password, PASSWORD_DEFAULT), $lang, $active, $role, $isSuper]);
        } else {
            db_exec("UPDATE users SET login = ?, display_name = ?, lang = ?, active = ?, system_role = ?, is_superadmin = ? WHERE id = ?",
                [$login, $name, $lang, $active, $role, $isSuper, $id]);
            if ($password !== '') db_exec("UPDATE users SET password_hash = ? WHERE id = ?", [password_hash($password, PASSWORD_DEFAULT), $id]);
        }
        return $id;
    });
    audit($me, $before ? 'update' : 'insert', 'users', $id, $before, sys_user($id));
    api_ok(['id' => $id]);
}

api_fail('bad_action');
