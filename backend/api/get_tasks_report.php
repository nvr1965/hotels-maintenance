<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head', 'viewer']);
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

$lang = $_GET['lang'] ?? 'ru';
if (!in_array($lang, ['ru', 'en', 'he', 'ar'])) $lang = 'ru';
$descCol = 'description_' . $lang;

// Даты только в виде ГГГГ-ММ-ДД; по умолчанию — сегодня
$isDate = fn($v) => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v);
$from = $isDate($_GET['from'] ?? null) ? $_GET['from'] : date('Y-m-d');
$to   = $isDate($_GET['to'] ?? null) ? $_GET['to'] : $from;
if ($from > $to) [$from, $to] = [$to, $from];
$typeFilter = $_GET['type'] ?? 'all'; // all | current | planned

$from = $db->real_escape_string($from);
$to   = $db->real_escape_string($to);

$typeSql = '';
if ($typeFilter === 'current' || $typeFilter === 'planned') {
    $typeSql = "AND mt.task_type = '" . $db->real_escape_string($typeFilter) . "'";
}

$sql = "SELECT mt.id, mt.task_type, mt.status, mt.created_at, mt.updated_at,
               COALESCE(NULLIF(mt.$descCol, ''), mt.description_ru) AS description,
               ha.building, ha.floor, ha.asset_key,
               creator.display_name AS creator_name,
               doer.display_name AS worker_name
        FROM maintenance_tasks mt
        LEFT JOIN hotel_assets ha ON ha.id = mt.asset_id
        LEFT JOIN users creator ON creator.id = COALESCE(mt.creator_id, mt.user_id)
        LEFT JOIN users doer ON doer.id = mt.worker_id
        WHERE mt.hotel_id = $hid AND (DATE(mt.created_at) BETWEEN '$from' AND '$to'
               OR (mt.status = 'done' AND DATE(mt.updated_at) BETWEEN '$from' AND '$to')) $typeSql
        ORDER BY mt.created_at DESC
        LIMIT 1000";

$rows = [];
$res = $db->query($sql);
if ($res) {
    $taskIds = [];
    while ($r = $res->fetch_assoc()) {
        $rows[] = $r;
        $taskIds[] = (int)$r['id'];
    }

    // Для плановых задач список исполнителей может лежать в task_workers (несколько человек)
    $assignedByTask = [];
    if (!empty($taskIds)) {
        $idsList = implode(',', $taskIds);
        $resTw = $db->query("SELECT tw.task_id, w.display_name AS name FROM task_workers tw
                              JOIN users w ON w.id = tw.worker_id
                              WHERE tw.task_id IN ($idsList)");
        if ($resTw) {
            while ($tw = $resTw->fetch_assoc()) {
                $tid = (int)$tw['task_id'];
                if (!isset($assignedByTask[$tid])) $assignedByTask[$tid] = [];
                $assignedByTask[$tid][] = $tw['name'];
            }
        }
    }

    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['room'] = $r['building'] ? ($r['building'] . '-' . $r['floor'] . ' / ' . $r['asset_key']) : ($r['asset_key'] ?? null);
        $r['assigned_workers'] = $assignedByTask[$r['id']] ?? [];
        $r['completed_at'] = ($r['status'] === 'done') ? $r['updated_at'] : null;
        unset($r['building'], $r['floor'], $r['asset_key'], $r['updated_at']);
    }
    unset($r);
}

echo json_encode(['success' => true, 'from' => $from, 'to' => $to, 'tasks' => $rows]);
exit;