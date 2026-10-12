<?php
/* Общее для API администратора отеля (backend/api/admin_*.php, meter_pending.php).
 *
 * Пускает только администратора текущего отеля (в том числе администратора сети и владельца системы).
 * Каждая правка пишется в журнал admin_audit с id отеля, журнал виден во вкладке «База данных».
 * Имена функций — как в Ramada, чтобы файлы админки переносились почти без изменений.
 */
require_once __DIR__ . '/api.php';

const ADMIN_LANGS = APP_LANGS;

function admin_require(): array
{
    return app_require(null, true);
}

function admin_input(): array { return api_input(); }
function admin_ok(array $data = []): void { api_ok($data); }
function admin_fail(string $code, array $extra = []): void { api_fail($code, $extra); }

function admin_audit(array $me, string $action, string $table, $rowKey, ?array $before, ?array $after): void
{
    audit($me, $action, $table, $rowKey, $before, $after, $me['hotel_id'] ?? null, isset($me['hotel']['org_id']) ? (int)$me['hotel']['org_id'] : null);
}

function admin_exec(string $sql, array $params = []): mysqli_stmt { return db_exec($sql, $params); }
function admin_fetch_one(string $sql, array $params = []): ?array { return db_one($sql, $params); }
function admin_fetch_all(string $sql, array $params = []): array { return db_all($sql, $params); }
function admin_count(string $sql, array $params = []): int { return (int)db_value($sql, $params); }

function admin_q(string $ident): string
{
    return '`' . str_replace('`', '``', $ident) . '`';
}

function admin_tables(): array
{
    global $db;
    $out = [];
    $res = $db->query("SHOW TABLES");
    while ($r = $res->fetch_row()) $out[] = $r[0];
    return $out;
}

function admin_table_exists(string $table): bool
{
    return in_array($table, admin_tables(), true);
}

/** Колонки таблицы: [имя => SHOW COLUMNS-строка]. */
function admin_columns(string $table): array
{
    global $db;
    $cols = [];
    $res = $db->query("SHOW COLUMNS FROM " . admin_q($table));
    while ($r = $res->fetch_assoc()) $cols[$r['Field']] = $r;
    return $cols;
}

function admin_has_column(string $table, string $col): bool
{
    return array_key_exists($col, admin_columns($table));
}

function admin_ensure_audit_table(): void
{
    // таблицу создаёт db/schema.sql
}

/** Ключ строки: первичный ключ, иначе первый уникальный. [] — таблица без ключа (только просмотр). */
function admin_row_key(string $table): array
{
    global $db;
    $res = $db->query("SHOW INDEX FROM `" . str_replace('`', '', $table) . "`");
    $idx = [];
    while ($r = $res->fetch_assoc()) {
        if ((int)$r['Non_unique'] !== 0) continue;
        $idx[$r['Key_name']][(int)$r['Seq_in_index']] = $r['Column_name'];
    }
    if (isset($idx['PRIMARY'])) { ksort($idx['PRIMARY']); return array_values($idx['PRIMARY']); }
    foreach ($idx as $cols) { ksort($cols); return array_values($cols); }
    return [];
}


/** WHERE по ключу строки + параметры. $key — [колонка => значение]. */
function admin_where(array $keyCols, array $key): array
{
    $parts = [];
    $params = [];
    foreach ($keyCols as $c) {
        if (!array_key_exists($c, $key)) admin_fail('bad_key');
        if ($key[$c] === null) {
            $parts[] = admin_q($c) . ' IS NULL';
        } else {
            $parts[] = admin_q($c) . ' = ?';
            $params[] = (string)$key[$c];
        }
    }
    return [implode(' AND ', $parts), $params];
}

