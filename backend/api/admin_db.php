<?php
/* Админка → База данных: просмотр и правка любой таблицы, копия базы, журнал изменений.
 *
 * Только владелец системы: здесь видны данные всех сетей и отелей сразу.
 *
 * GET  ?action=tables
 * GET  ?action=rows&table=..&page=1&per=50&q=..&sort=col&dir=asc|desc
 * POST ?action=save    {table, key: {col: val}|null, values: {col: val|null}}   key = null — новая строка
 * POST ?action=delete  {table, key: {col: val}}
 * GET  ?action=audit&table=..&limit=200
 * GET  ?action=backup  — скачать всю базу одним .sql (восстанавливается через phpMyAdmin → Импорт)
 */
require_once __DIR__ . '/../core/admin.php';
$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
if ($me['is_superadmin'] !== 1) app_json_fail(403, 'forbidden');

$action = $_GET['action'] ?? 'tables';

// Только просмотр: журнал правок нельзя подчистить из админки
const READONLY_TABLES = ['admin_audit'];
// Секретные колонки: значение не показывается; новое значение (пароль) сохраняется хэшем
const SECRET_COLUMNS = ['users.password_hash', 'auth_tokens.validator_hash', 'push_subscriptions.auth', 'meter_report_links.link_key'];
const HASHED_COLUMNS = ['users.password_hash'];
// В копию базы — только структура (данные входа на устройства не нужны и опасны)
const BACKUP_STRUCTURE_ONLY = ['auth_tokens'];

function db_table_param(string $t): string
{
    if (!admin_table_exists($t)) admin_fail('no_table');
    return $t;
}

function db_is_secret(string $table, string $col): bool
{
    return in_array("$table.$col", SECRET_COLUMNS, true);
}

function db_mask_row(string $table, array $row): array
{
    foreach ($row as $c => $v) {
        if (db_is_secret($table, $c)) $row[$c] = ($v === null || $v === '') ? $v : '••••••';
    }
    return $row;
}

function db_key_of(array $keyCols, array $row): array
{
    $k = [];
    foreach ($keyCols as $c) $k[$c] = $row[$c] ?? null;
    return $k;
}

if ($action === 'tables') {
    $out = [];
    foreach (admin_tables() as $t) {
        $key = admin_row_key($t);
        $out[] = [
            'name' => $t,
            'rows' => admin_count("SELECT COUNT(*) FROM " . admin_q($t)),
            'key' => $key,
            'editable' => $key && !in_array($t, READONLY_TABLES, true),
        ];
    }
    admin_ok(['tables' => $out]);
}

if ($action === 'rows') {
    $table = db_table_param((string)($_GET['table'] ?? ''));
    $cols = admin_columns($table);
    $keyCols = admin_row_key($table);
    $per = max(10, min(200, (int)($_GET['per'] ?? 50)));
    $page = max(1, (int)($_GET['page'] ?? 1));
    $q = trim((string)($_GET['q'] ?? ''));

    $where = '';
    $params = [];
    if ($q !== '') {
        $likes = [];
        foreach (array_keys($cols) as $c) {
            if (db_is_secret($table, $c)) continue;
            $likes[] = "CAST(" . admin_q($c) . " AS CHAR) LIKE ?";
            $params[] = '%' . $q . '%';
        }
        $where = 'WHERE ' . implode(' OR ', $likes);
    }

    $sort = (string)($_GET['sort'] ?? '');
    $dir = strtolower((string)($_GET['dir'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';
    if (!isset($cols[$sort])) $sort = $keyCols[0] ?? array_key_first($cols);

    $total = admin_count("SELECT COUNT(*) FROM " . admin_q($table) . " $where", $params);
    $offset = ($page - 1) * $per;
    $rows = admin_fetch_all("SELECT * FROM " . admin_q($table) . " $where ORDER BY " . admin_q($sort) . " $dir LIMIT $per OFFSET $offset", $params);

    $columns = [];
    foreach ($cols as $c) {
        $columns[] = [
            'name' => $c['Field'],
            'type' => $c['Type'],
            'nullable' => $c['Null'] === 'YES',
            'default' => $c['Default'],
            'auto' => stripos((string)$c['Extra'], 'auto_increment') !== false,
            'secret' => db_is_secret($table, $c['Field']),
        ];
    }
    admin_ok([
        'table' => $table,
        'columns' => $columns,
        'key' => $keyCols,
        'editable' => $keyCols && !in_array($table, READONLY_TABLES, true),
        'rows' => array_map(fn($r) => db_mask_row($table, $r), $rows),
        'total' => $total,
        'page' => $page,
        'per' => $per,
        'sort' => $sort,
        'dir' => strtolower($dir),
    ]);
}

if ($action === 'audit') {
    $limit = max(10, min(1000, (int)($_GET['limit'] ?? 200)));
    $t = trim((string)($_GET['table'] ?? ''));
    $rows = $t !== ''
        ? admin_fetch_all("SELECT * FROM admin_audit WHERE tbl = ? ORDER BY id DESC LIMIT $limit", [$t])
        : admin_fetch_all("SELECT * FROM admin_audit ORDER BY id DESC LIMIT $limit");
    admin_ok(['rows' => $rows]);
}

if ($action === 'backup') {
    global $db;
    set_time_limit(300);
    $name = 'hotelapp-' . date('Y-m-d_H-i') . '.sql';
    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Cache-Control: no-store');

    echo "-- hotelapp: копия базы " . date('Y-m-d H:i:s') . " (сделал " . $me['name'] . ")\n";
    echo "-- Восстановление: phpMyAdmin → база hotelapp → Импорт этого файла\n\n";
    echo "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n";
    foreach (admin_tables() as $t) {
        $create = $db->query("SHOW CREATE TABLE " . admin_q($t))->fetch_row();
        if (stripos($create[1] ?? '', 'CREATE TABLE') !== 0) continue; // представления пропускаем
        echo "DROP TABLE IF EXISTS " . admin_q($t) . ";\n" . $create[1] . ";\n\n";
        if (in_array($t, BACKUP_STRUCTURE_ONLY, true)) continue;

        $res = $db->query("SELECT * FROM " . admin_q($t), MYSQLI_USE_RESULT);
        $batch = [];
        $colList = null;
        while ($r = $res->fetch_assoc()) {
            if ($colList === null) $colList = implode(', ', array_map('admin_q', array_keys($r)));
            $vals = array_map(fn($v) => $v === null ? 'NULL' : "'" . $db->real_escape_string($v) . "'", array_values($r));
            $batch[] = '(' . implode(', ', $vals) . ')';
            if (count($batch) >= 200) {
                echo "INSERT INTO " . admin_q($t) . " ($colList) VALUES\n" . implode(",\n", $batch) . ";\n";
                $batch = [];
            }
        }
        if ($batch) echo "INSERT INTO " . admin_q($t) . " ($colList) VALUES\n" . implode(",\n", $batch) . ";\n";
        $res->free();
        echo "\n";
    }
    echo "SET FOREIGN_KEY_CHECKS = 1;\n";
    admin_audit($me, 'backup', '*', null, null, null);
    exit;
}

$in = admin_input();
$table = db_table_param((string)($in['table'] ?? ''));
$keyCols = admin_row_key($table);
if (!$keyCols || in_array($table, READONLY_TABLES, true)) admin_fail('readonly');
$cols = admin_columns($table);

function db_load(string $table, array $keyCols, array $key): ?array
{
    [$w, $p] = admin_where($keyCols, $key);
    return admin_fetch_one("SELECT * FROM " . admin_q($table) . " WHERE $w LIMIT 1", $p);
}

/** Себя не удалить и не лишить прав владельца системы через общую таблицу. */
function db_guard_self(string $table, array $me, ?array $before, ?array $values, bool $deleting): void
{
    if ($table !== 'users' || !$before || (int)$before['id'] !== $me['id']) return;
    if ($deleting) admin_fail('self_lockout');
    if (array_key_exists('is_superadmin', $values) && (string)$values['is_superadmin'] !== '1') admin_fail('self_lockout');
    if (array_key_exists('active', $values) && (string)$values['active'] !== '1') admin_fail('self_lockout');
    if (array_key_exists('id', $values) && (string)$values['id'] !== (string)$me['id']) admin_fail('self_lockout');
}

if ($action === 'save') {
    $values = is_array($in['values'] ?? null) ? $in['values'] : [];
    $key = is_array($in['key'] ?? null) ? $in['key'] : null;

    $data = [];
    foreach ($values as $c => $v) {
        if (!isset($cols[$c])) continue;
        if (is_bool($v)) $v = $v ? '1' : '0';
        if ($v !== null && !is_scalar($v)) continue;
        if (db_is_secret($table, $c)) {
            // Пустое или маска — не менять; новый пароль сохраняем хэшем
            if ($v === null || $v === '' || $v === '••••••') continue;
            if (in_array("$table.$c", HASHED_COLUMNS, true)) $v = password_hash((string)$v, PASSWORD_DEFAULT);
        }
        // Пустое в автонумерации новой строки — пусть база сама выдаст номер
        if ($key === null && ($v === null || $v === '') && stripos((string)$cols[$c]['Extra'], 'auto_increment') !== false) continue;
        $data[$c] = $v === null ? null : (string)$v;
    }
    if (!$data) admin_fail('nothing_to_save');

    if ($key === null) {
        $names = array_keys($data);
        admin_exec("INSERT INTO " . admin_q($table) . " (" . implode(', ', array_map('admin_q', $names)) . ")
                    VALUES (" . implode(', ', array_fill(0, count($names), '?')) . ")", array_values($data));
        global $db;
        // Ключ новой строки: автонумерация или то, что ввели
        $newKey = [];
        foreach ($keyCols as $c) {
            $newKey[$c] = (stripos((string)$cols[$c]['Extra'], 'auto_increment') !== false && !isset($data[$c]))
                ? (string)$db->insert_id : ($data[$c] ?? null);
        }
        $after = db_load($table, $keyCols, $newKey);
        admin_audit($me, 'insert', $table, $newKey, null, $after);
        admin_ok(['key' => $newKey]);
    }

    $before = db_load($table, $keyCols, $key);
    if (!$before) admin_fail('not_found');
    db_guard_self($table, $me, $before, $data, false);

    $sets = [];
    $params = [];
    foreach ($data as $c => $v) {
        $sets[] = admin_q($c) . ' = ?';
        $params[] = $v;
    }
    [$w, $wp] = admin_where($keyCols, $key);
    admin_exec("UPDATE " . admin_q($table) . " SET " . implode(', ', $sets) . " WHERE $w LIMIT 1", array_merge($params, $wp));

    if ($table === 'users' && (isset($data['password_hash']) || (isset($data['active']) && $data['active'] === '0'))) {
        app_forget_user_tokens((int)$before['id']);
    }
    $newKey = $key;
    foreach ($keyCols as $c) if (array_key_exists($c, $data)) $newKey[$c] = $data[$c];
    admin_audit($me, 'update', $table, $key, $before, db_load($table, $keyCols, $newKey));
    admin_ok(['key' => $newKey]);
}

if ($action === 'delete') {
    $key = is_array($in['key'] ?? null) ? $in['key'] : [];
    $before = db_load($table, $keyCols, $key);
    if (!$before) admin_fail('not_found');
    db_guard_self($table, $me, $before, null, true);
    [$w, $wp] = admin_where($keyCols, $key);
    admin_exec("DELETE FROM " . admin_q($table) . " WHERE $w LIMIT 1", $wp);
    admin_audit($me, 'delete', $table, $key, $before, null);
    admin_ok();
}

admin_fail('bad_action');
