<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head', 'viewer']);
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

$lang = $_GET['lang'] ?? 'ru';
if (!in_array($lang, ['ru', 'en', 'he', 'ar'])) $lang = 'ru';
$nameCol = 'name_' . $lang;

// ---- Режим 1: ретроспектива показаний одного счётчика (для графика) ----
if (isset($_GET['history_task_id'])) {
    $taskId = (int)$_GET['history_task_id'];
    $days   = isset($_GET['days']) ? max(7, min(365, (int)$_GET['days'])) : 90;
    $from   = date('Y-m-d', strtotime("-$days days"));

    $meta = null;
    $resMeta = $db->query("SELECT id, COALESCE(NULLIF($nameCol, ''), name_ru, 'Регламентная задача') AS name, requires_ocr, ocr_type
                            FROM routine_tasks WHERE id = $taskId AND hotel_id = $hid LIMIT 1");
    if ($resMeta) $meta = $resMeta->fetch_assoc();
    if (!$meta) api_fail('not_found');

    $history = [];
    $res = $db->query("SELECT target_date, ocr_value, ocr_unit, status
                        FROM routine_schedule
                        WHERE task_id = $taskId AND target_date >= '$from'
                        ORDER BY target_date ASC");
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            $history[] = [
                'date'   => $r['target_date'],
                'value'  => $r['ocr_value'] !== null ? (float)$r['ocr_value'] : null,
                'unit'   => $r['ocr_unit'],
                'status' => $r['status'],
            ];
        }
    }

    echo json_encode(['success' => true, 'task' => $meta, 'history' => $history]);
    exit;
}

// ---- Режим 2: матрица «регламентная задача × дата» за период ----
$days = isset($_GET['days']) ? max(3, min(92, (int)$_GET['days'])) : 14;
$isDate = fn($s) => is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) && strtotime($s) !== false;
$to = $isDate($_GET['to'] ?? null) ? $_GET['to'] : date('Y-m-d');
if ($isDate($_GET['from'] ?? null)) {
    // Произвольный период «с … по …» (не больше 92 дней)
    $from = $_GET['from'];
    if ($from > $to) [$from, $to] = [$to, $from];
    if ((strtotime($to) - strtotime($from)) / 86400 > 91) $from = date('Y-m-d', strtotime($to . ' -91 days'));
} else {
    $from = date('Y-m-d', strtotime($to . " -" . ($days - 1) . " days"));
}
$toEsc = $db->real_escape_string($to);
$fromEsc = $db->real_escape_string($from);

$tasksMeta = [];
$res = $db->query("SELECT id, COALESCE(NULLIF($nameCol, ''), name_ru, 'Регламентная задача') AS name, requires_ocr, ocr_type
                    FROM routine_tasks WHERE hotel_id = $hid ORDER BY sort_order ASC, id ASC");
if ($res) {
    while ($r = $res->fetch_assoc()) {
        $tasksMeta[(int)$r['id']] = [
            'id' => (int)$r['id'], 'name' => $r['name'],
            'requires_ocr' => !empty($r['requires_ocr']), 'ocr_type' => $r['ocr_type'],
            'cells' => []
        ];
    }
}

$res = $db->query("SELECT task_id, target_date, status, ocr_value, ocr_unit, worker_id
                    FROM routine_schedule
                    WHERE hotel_id = $hid AND target_date BETWEEN '$fromEsc' AND '$toEsc'");
$byTaskDate = [];
if ($res) {
    while ($r = $res->fetch_assoc()) {
        $byTaskDate[(int)$r['task_id']][$r['target_date']] = [
            'status' => $r['status'],
            'ocr_value' => $r['ocr_value'],
            'ocr_unit' => $r['ocr_unit'],
        ];
    }
}

// Список дат периода (для заголовков столбцов на фронтенде)
$dates = [];
$cursor = strtotime($from);
$end = strtotime($to);
while ($cursor <= $end) {
    $dates[] = date('Y-m-d', $cursor);
    $cursor = strtotime('+1 day', $cursor);
}

foreach ($tasksMeta as $tid => &$t) {
    foreach ($dates as $d) {
        $cell = $byTaskDate[$tid][$d] ?? null;
        $t['cells'][] = $cell ? [
            'date' => $d, 'status' => $cell['status'],
            'ocr_value' => $cell['ocr_value'], 'ocr_unit' => $cell['ocr_unit']
        ] : ['date' => $d, 'status' => null, 'ocr_value' => null, 'ocr_unit' => null];
    }
}
unset($t);

echo json_encode(['success' => true, 'from' => $from, 'to' => $to, 'dates' => $dates, 'tasks' => array_values($tasksMeta)]);
exit;