<?php
/* Общее для всех файлов backend/api: ответы JSON, разбор запроса, журнал правок.
 * Ошибки PHP не выводятся в ответ (иначе ломается JSON), а возвращаются кодом db_error / server_error.
 */
ini_set('display_errors', '0');
require_once __DIR__ . '/tenancy.php';
require_once __DIR__ . '/translate.php';
require_once __DIR__ . '/ui_text.php';
require_once __DIR__ . '/departments.php';
require_once __DIR__ . '/templates.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

set_exception_handler(function (Throwable $e) {
    error_log('hotels: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    $code = $e instanceof PDOException ? 'db_error' : 'server_error';
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

/** Ответить успехом сразу, а долгую работу ($after: автоперевод, рассылка) доделать уже после ответа. */
function api_ok_then(array $data, callable $after): void
{
    $json = json_encode(['success' => true] + $data, JSON_UNESCAPED_UNICODE);
    ignore_user_abort(true);
    if (function_exists('fastcgi_finish_request')) {
        echo $json;
        fastcgi_finish_request();
    } else {
        while (ob_get_level() > 0) ob_end_clean();
        header('Connection: close');
        header('Content-Length: ' . strlen($json));
        echo $json;
        flush();
    }
    try {
        $after();
    } catch (Throwable $e) {
        error_log('hotels: after response: ' . $e->getMessage());
    }
    exit;
}

/** Ошибка с кодом (фронтенд переводит код в текст на языке интерфейса). */
/**
 * Действие из очереди телефона (client_op_id): уже выполненное не повторяем, а отвечаем тем же успехом.
 * Возвращает id действия (или null), его потом передают в api_client_op_done().
 */
function api_client_op(array $me, $opId): ?string
{
    $opId = is_string($opId) ? trim($opId) : '';
    if ($opId === '' || strlen($opId) > 80) return null;
    $prev = db_value("SELECT response FROM client_ops WHERE op_id = ? AND user_id = ?", [$opId, $me['id']]);
    if ($prev !== null) api_ok((json_decode((string)$prev, true) ?: []) + ['duplicate' => true]);
    return $opId;
}

function api_client_op_done(?string $opId, array $me, array $response = []): void
{
    if ($opId === null) return;
    db_exec("INSERT INTO client_ops (op_id, user_id, response) VALUES (?, ?, ?) ON CONFLICT (op_id) DO NOTHING",
            [$opId, $me['id'], json_encode($response, JSON_UNESCAPED_UNICODE)]);
}

/** Когда действие сделано на телефоне (done_at, мс): не раньше трёх суток назад и не в будущем. */
function api_done_time($doneAtMs): int
{
    $now = time();
    if (!is_numeric($doneAtMs)) return $now;
    $t = (int)floor(((float)$doneAtMs) / 1000);
    return ($t > $now || $t < $now - 3 * 86400) ? $now : $t;
}

function api_fail(string $code, array $extra = [], int $http = 200): void
{
    if ($http !== 200) http_response_code($http);
    echo json_encode(['success' => false, 'message' => $code] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Язык ответа: ?lang= из запроса (если такой язык есть), иначе язык пользователя. */
function api_lang(?array $me = null): string
{
    $l = $_GET['lang'] ?? $_POST['lang'] ?? null;
    return app_normalize_lang(is_string($l) && $l !== '' ? $l : ($me['lang'] ?? null));
}

/** «12, 15, 20» для IN (…): только целые числа. */
function sql_int_list(array $ids): string
{
    $ids = array_values(array_unique(array_map('intval', $ids)));
    return $ids ? implode(',', $ids) : 'NULL';
}

/** Дата ГГГГ-ММ-ДД или null. */
function app_valid_date(?string $d): ?string
{
    if (!$d || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) return null;
    [$y, $m, $day] = array_map('intval', explode('-', $d));
    return checkdate($m, $day, $y) ? $d : null;
}

function api_require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') api_fail('post_required', [], 405);
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
