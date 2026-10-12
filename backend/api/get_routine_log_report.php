<?php
// Отчёт руководителя по регламентным работам за день или диапазон дат:
// по каждому дню — какие регламенты выполнены, кем, когда, с какими примечаниями/фото/показаниями.
// Источник: routine_log (каждое выполнение, в т.ч. повторы); если лога за день нет — routine_schedule.
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head', 'viewer']);
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

$lang = $_GET['lang'] ?? 'ru';
if (!in_array($lang, ['ru', 'en', 'he', 'ar'], true)) $lang = 'ru';
$nameCol = 'name_' . $lang;

$today = date('Y-m-d');
$isDate = fn($s) => is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) && strtotime($s) !== false;
$from = $isDate($_GET['from'] ?? null) ? $_GET['from'] : $today;
$to   = $isDate($_GET['to'] ?? null) ? $_GET['to'] : $from;
if ($from > $to) [$from, $to] = [$to, $from];
if ($to > $today) $to = $today;               // будущих дней в отчёте нет
if ($from > $to) $from = $to;
// не больше 92 дней за раз
if ((strtotime($to) - strtotime($from)) / 86400 > 91) $from = date('Y-m-d', strtotime($to . ' -91 days'));

$mediaList = function ($json) {
    $arr = json_decode($json ?? '[]', true);
    if (!is_array($arr)) return [];
    $out = [];
    foreach ($arr as $m) {
        $url = is_string($m) ? $m : ($m['url'] ?? '');
        if ($url === '') continue;
        $isVideo = (is_array($m) && ($m['type'] ?? '') === 'video') || preg_match('/\.(mp4|mov|avi|webm)$/i', $url);
        $type = $isVideo ? 'video' : 'photo';
        $out[] = ['type' => $type, 'url' => $url];
    }
    return $out;
};

// ---- Справочник регламентов ----
$tasks = [];
$res = $db->query("SELECT id, COALESCE(NULLIF($nameCol, ''), name_ru, 'Регламентная задача') AS name, requires_ocr
                    FROM routine_tasks WHERE hotel_id = $hid ORDER BY requires_ocr DESC, sort_order ASC, id ASC");
while ($res && ($r = $res->fetch_assoc())) {
    $tasks[(int)$r['id']] = ['id' => (int)$r['id'], 'name' => $r['name'], 'requires_ocr' => !empty($r['requires_ocr'])];
}

$workers = [];
$res = $db->query("SELECT id, display_name FROM users");
while ($res && ($r = $res->fetch_assoc())) $workers[(int)$r['id']] = $r['display_name'];

// ---- Итог дня (routine_schedule) ----
$sched = [];
$res = $db->query("SELECT task_id, target_date, status, worker_id, notes, media, ocr_value, ocr_unit
                    FROM routine_schedule WHERE hotel_id = $hid AND target_date BETWEEN '$from' AND '$to'");
while ($res && ($r = $res->fetch_assoc())) $sched[$r['target_date']][(int)$r['task_id']] = $r;

// ---- Все выполнения (routine_log) ----
$runs = [];
{
    $res = $db->query("SELECT id, task_id, worker_id, target_date, status, notes, media, ocr_value, ocr_unit, ocr_raw, is_repeat, closed_at
                        FROM routine_log
                        WHERE hotel_id = $hid AND target_date BETWEEN '$from' AND '$to' AND status = 'done'
                        ORDER BY closed_at ASC, id ASC");
    while ($res && ($r = $res->fetch_assoc())) {
        $runs[$r['target_date']][(int)$r['task_id']][] = [
            'time'    => substr($r['closed_at'], 11, 5),
            'worker'  => $workers[(int)$r['worker_id']] ?? null,
            'notes'   => trim((string)$r['notes']) !== '' ? $r['notes'] : null,
            'media'   => $mediaList($r['media']),
            'value'   => ($r['ocr_value'] !== null && $r['ocr_value'] !== '') ? $r['ocr_value'] : null,
            'unit'    => $r['ocr_unit'] ?: null,
            'pending' => $r['ocr_raw'] === '[pending]',
            'repeat'  => !empty($r['is_repeat']),
        ];
    }
}

// ---- Собираем по дням (новые сверху) ----
$days = [];
$totals = ['done' => 0, 'total' => 0];
for ($d = $to; $d >= $from; $d = date('Y-m-d', strtotime($d . ' -1 day'))) {
    $items = [];
    $done = 0;
    foreach ($tasks as $tid => $t) {
        $s = $sched[$d][$tid] ?? null;
        $taskRuns = $runs[$d][$tid] ?? [];
        // Старые дни без лога: одно выполнение из routine_schedule
        if (!$taskRuns && $s && $s['status'] === 'done') {
            $taskRuns[] = [
                'time' => null, 'worker' => $workers[(int)$s['worker_id']] ?? null,
                'notes' => trim((string)$s['notes']) !== '' ? $s['notes'] : null,
                'media' => $mediaList($s['media']),
                'value' => ($s['ocr_value'] !== null && $s['ocr_value'] !== '') ? $s['ocr_value'] : null,
                'unit' => $s['ocr_unit'] ?: null, 'pending' => false, 'repeat' => false,
            ];
        }
        $isDone = ($s && $s['status'] === 'done') || $taskRuns;
        if ($isDone) $done++;
        $items[] = [
            'task_id' => $tid, 'name' => $t['name'], 'requires_ocr' => $t['requires_ocr'],
            'done' => (bool)$isDone,
            'value' => $s && $s['ocr_value'] !== null && $s['ocr_value'] !== '' ? $s['ocr_value'] : null,
            'unit' => $s['ocr_unit'] ?? null,
            'runs' => $taskRuns,
        ];
    }
    $days[] = ['date' => $d, 'done' => $done, 'total' => count($tasks), 'items' => $items];
    $totals['done'] += $done;
    $totals['total'] += count($tasks);
}

echo json_encode(['success' => true, 'from' => $from, 'to' => $to, 'today' => $today, 'days' => $days, 'totals' => $totals]);
exit;
