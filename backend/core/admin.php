<?php
/* Общее для API администратора отеля (backend/api/admin_*.php, meter_pending.php).
 *
 * Пускает только администратора текущего отеля (в том числе администратора сети и владельца системы).
 * Каждая правка пишется в журнал admin_audit с id отеля, журнал виден во вкладке «База данных».
 * Имена функций — как в Ramada, чтобы файлы админки переносились почти без изменений.
 */
require_once __DIR__ . '/api.php';


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

function admin_exec(string $sql, array $params = []): PDOStatement { return db_exec($sql, $params); }
function admin_fetch_one(string $sql, array $params = []): ?array { return db_one($sql, $params); }
function admin_fetch_all(string $sql, array $params = []): array { return db_all($sql, $params); }
function admin_count(string $sql, array $params = []): int { return (int)db_value($sql, $params); }

function admin_q(string $ident): string
{
    return '"' . str_replace('"', '""', $ident) . '"';
}

function admin_tables(): array
{
    return db_exec("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")->fetchAll(PDO::FETCH_COLUMN);
}

function admin_table_exists(string $table): bool
{
    return in_array($table, admin_tables(), true);
}

/** Колонки таблицы: [имя => ['Field', 'Type', 'Null', 'Default']] (поля названы как в MySQL SHOW COLUMNS). */
function admin_columns(string $table): array
{
    $cols = [];
    foreach (db_all("SELECT column_name, data_type, is_nullable, column_default, is_identity FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position", [$table]) as $r) {
        $cols[$r['column_name']] = ['Field' => $r['column_name'], 'Type' => $r['data_type'], 'Null' => $r['is_nullable'],
            'Default' => $r['column_default'], 'Extra' => $r['is_identity'] === 'YES' ? 'auto_increment' : ''];
    }
    return $cols;
}

function admin_has_column(string $table, string $col): bool
{
    return array_key_exists($col, admin_columns($table));
}

function admin_ensure_audit_table(): void
{
    // таблицу создаёт db/pg/01_schema.sql
}

/** Ключ строки: первичный ключ, иначе первый уникальный. [] — таблица без ключа (только просмотр). */
function admin_row_key(string $table): array
{
    $rows = db_all("SELECT i.indisprimary AS pk, i.indexrelid, a.attname, array_position(i.indkey::int2[], a.attnum) AS pos
                    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
                    WHERE n.nspname = 'public' AND c.relname = ? AND i.indisunique AND i.indexprs IS NULL
                    ORDER BY i.indisprimary DESC, i.indexrelid, pos", [$table]);
    $idx = [];
    foreach ($rows as $r) $idx[$r['indexrelid']][(int)$r['pos']] = $r['attname'];
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
            $parts[] = admin_q($c) . '::text = ?';
            $params[] = is_bool($key[$c]) ? ($key[$c] ? 'true' : 'false') : (string)$key[$c];
        }
    }
    return [implode(' AND ', $parts), $params];
}
