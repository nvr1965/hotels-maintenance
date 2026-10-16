<?php
/* Подключение к PostgreSQL ($db, PDO). Время в базе — timestamptz; пояс сессии — пояс текущего отеля
 * (app_apply_timezone), поэтому NOW()::date и вывод дат совпадают с местным временем отеля.
 */
require_once __DIR__ . '/config.php';

try {
    $c = app_config()['db'];
    $db = new PDO(sprintf('pgsql:host=%s;port=%d;dbname=%s', $c['host'], (int)$c['port'], $c['name']), $c['user'], $c['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (PDOException $e) {
    error_log('hotels: db connect: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'message' => 'db_unavailable']);
    exit;
}

/** Значение для запроса: логическое — 't'/'f' (PDO иначе отдаст '' вместо false), массив — jsonb. */
function db_param($v)
{
    if (is_bool($v)) return $v ? 't' : 'f';
    if (is_array($v) || $v instanceof stdClass) return json_encode($v, JSON_UNESCAPED_UNICODE);
    return $v;
}

/** Запрос с параметрами ?. */
function db_exec(string $sql, array $params = []): PDOStatement
{
    global $db;
    $stmt = $db->prepare($sql);
    $stmt->execute(array_map('db_param', array_values($params)));
    return $stmt;
}

/**
 * Время из базы приходит как «2026-10-01 10:00:00.123+03» в поясе отеля (app_apply_timezone).
 * Интерфейс ждёт местное «2026-10-01 10:00:00», как было в MySQL: отрезаем доли секунды и пояс.
 */
function db_row_local(array $row): array
{
    foreach ($row as $k => $v) {
        if (is_string($v) && strlen($v) >= 22 && preg_match('/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(\.\d+)?[+-]\d{2}(:\d{2})?$/', $v, $m)) {
            $row[$k] = $m[1];
        }
    }
    return $row;
}

function db_one(string $sql, array $params = []): ?array
{
    $row = db_exec($sql, $params)->fetch();
    return $row ? db_row_local($row) : null;
}

function db_all(string $sql, array $params = []): array
{
    return array_map('db_row_local', db_exec($sql, $params)->fetchAll());
}

function db_value(string $sql, array $params = [])
{
    $v = db_exec($sql, $params)->fetchColumn();
    if ($v === false) return null;
    return is_string($v) ? (db_row_local([$v])[0]) : $v;
}

/** id последней вставки (для identity-колонок). Надёжнее — INSERT … RETURNING id. */
function db_insert_id(): int
{
    global $db;
    return (int)$db->lastInsertId();
}

/** Сделать всё внутри одной транзакции; при исключении — откат. */
function db_tx(callable $fn)
{
    global $db;
    $db->beginTransaction();
    try {
        $r = $fn();
        $db->commit();
        return $r;
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

/** jsonb из базы → массив. */
function db_json($v): array
{
    if (is_array($v)) return $v;
    $d = json_decode((string)$v, true);
    return is_array($d) ? $d : [];
}
