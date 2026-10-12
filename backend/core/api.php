<?php
/* Общее для всех файлов backend/api: ответы JSON, разбор запроса, журнал правок.
 * Ошибки PHP не выводятся в ответ (иначе ломается JSON), а возвращаются кодом db_error / server_error.
 */
ini_set('display_errors', '0');
require_once __DIR__ . '/tenancy.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

set_exception_handler(function (Throwable $e) {
    error_log('hotelapp: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    $code = $e instanceof mysqli_sql_exception ? 'db_error' : 'server_error';
    echo json_encode(['success' => false, 'message' => $code], JSON_UNESCAPED_UNICODE);
    exit;
});

function api_input(): array
{
    static $in = null;
    if ($in === null) {
        $in = json_decode(file_get_contents('php://input'), true);
        if (!is_array($in)) $in = [];
    }
    return $in;
}

function api_ok(array $data = []): void
{
    echo json_encode(['success' => true] + $data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Ошибка с кодом (фронтенд переводит код в текст на языке интерфейса). */
function api_fail(string $code, array $extra = [], int $http = 200): void
{
    if ($http !== 200) http_response_code($http);
    echo json_encode(['success' => false, 'message' => $code] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

function api_require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') api_fail('post_required', [], 405);
}

/** Запрос с параметрами (все как строки, MySQL сам приведёт типы). */
function db_exec(string $sql, array $params = []): mysqli_stmt
{
    global $db;
    $stmt = $db->prepare($sql);
    if ($params) {
        $params = array_map(fn($v) => $v === null ? null : (string)$v, $params);
        $stmt->bind_param(str_repeat('s', count($params)), ...$params);
    }
    $stmt->execute();
    return $stmt;
}

function db_one(string $sql, array $params = []): ?array
{
    $stmt = db_exec($sql, $params);
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ?: null;
}

function db_all(string $sql, array $params = []): array
{
    $stmt = db_exec($sql, $params);
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();
    return $rows;
}

function db_value(string $sql, array $params = [])
{
    $stmt = db_exec($sql, $params);
    $row = $stmt->get_result()->fetch_row();
    $stmt->close();
    return $row[0] ?? null;
}

function db_insert_id(): int
{
    global $db;
    return (int)$db->insert_id;
}

/** Пароли в журнал не попадают. */
function audit_clean(?array $row): ?array
{
    if ($row === null) return null;
    foreach (['password_hash', 'password', 'validator_hash'] as $secret) {
        if (array_key_exists($secret, $row)) $row[$secret] = '***';
    }
    return $row;
}

/** Журнал правок: кто, где (сеть / отель), какая таблица, что было и что стало. */
function audit(array $me, string $action, string $table, $rowKey, ?array $before, ?array $after,
               ?int $hotelId = null, ?int $orgId = null): void
{
    $key = is_array($rowKey) ? json_encode($rowKey, JSON_UNESCAPED_UNICODE) : (string)$rowKey;
    $b = $before === null ? null : json_encode(audit_clean($before), JSON_UNESCAPED_UNICODE);
    $a = $after === null ? null : json_encode(audit_clean($after), JSON_UNESCAPED_UNICODE);
    db_exec("INSERT INTO admin_audit (org_id, hotel_id, user_id, user_name, action, tbl, row_key, before_json, after_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [$orgId, $hotelId, $me['id'], $me['name'], $action, $table, $key, $b, $a]);
}

function clean_text($v, int $max = 255): string
{
    return mb_substr(trim(preg_replace('/\s+/u', ' ', (string)$v)), 0, $max);
}
