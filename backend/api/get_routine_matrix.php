<?php
require_once __DIR__ . '/../core/api.php';
require_once __DIR__ . '/../core/meters.php';
$me = app_require(['head', 'viewer']);
$hid = $me['hotel_id'];

$lang = api_lang($me);
$taskName = fn($r) => i18n_pick($r['names'], $lang) ?: ui_t('routine_task', $lang);

// ---- Режим 1: ретроспектива показаний одного счётчика (для графика) ----
if (isset($_GET['history_task_id'])) {
    $taskId = (int)$_GET['history_task_id'];
    $days   = isset($_GET['days']) ? max(7, min(365, (int)$_GET['days'])) : 90;
    $from   = date('Y-m-d', strtotime("-$days days"));

    $meta = db_one("SELECT id, names, requires_ocr, ocr_type FROM routine_tasks WHERE id = ? AND hotel_id = ?", [$taskId, $hid]);
    if (!$meta) api_fail('not_found');
    $meta = ['id' => (int)$meta['id'], 'name' => $taskName($meta), 'requires_ocr' => (int)$meta['requires_ocr'], 'ocr_type' => $meta['ocr_type']];

    $history = [];
    foreach (db_all("SELECT target_date::text AS target_date, ocr_value, ocr_unit, status FROM routine_schedule
                     WHERE task_id = ? AND target_date >= ? ORDER BY target_date ASC", [$taskId, $from]) as $r) {
        $history[] = [
            'date'   => $r['target_date'],
            'value'  => meter_number($r['ocr_value']),
            'unit'   => $r['ocr_unit'],
            'status' => $r['status'],
        ];
    }

    api_ok(['task' => $meta, 'history' => $history]);
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
$tasksMeta = [];
foreach (db_all("SELECT id, names, requires_ocr, ocr_type FROM routine_tasks WHERE hotel_id = ? ORDER BY sort_order ASC, id ASC", [$hid]) as $r) {
    $tasksMeta[(int)$r['id']] = [
        'id' => (int)$r['id'], 'name' => $taskName($r),
        'requires_ocr' => (bool)$r['requires_ocr'], 'ocr_type' => $r['ocr_type'],
        'cells' => []
    ];
}

$byTaskDate = [];
foreach (db_all("SELECT task_id, target_date::text AS target_date, status, ocr_value, ocr_unit FROM routine_schedule
                 WHERE hotel_id = ? AND target_date BETWEEN ? AND ?", [$hid, $from, $to]) as $r) {
    $byTaskDate[(int)$r['task_id']][$r['target_date']] = [
        'status' => $r['status'],
        'ocr_value' => $r['ocr_value'],
        'ocr_unit' => $r['ocr_unit'],
    ];
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

api_ok(['from' => $from, 'to' => $to, 'dates' => $dates, 'tasks' => array_values($tasksMeta)]);