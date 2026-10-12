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
$from = $db->real_escape_string($from);
$to   = $db->real_escape_string($to);

// ---- Список плановых задач за период ----
$sql = "SELECT mt.id, mt.status, mt.created_at, mt.updated_at, mt.notes, mt.media,
               COALESCE(NULLIF(mt.$descCol, ''), mt.description_ru) AS description,
               ha.id AS asset_id, ha.building, ha.floor, ha.asset_key,
               creator.display_name AS creator_name
        FROM maintenance_tasks mt
        LEFT JOIN hotel_assets ha ON ha.id = mt.asset_id
        LEFT JOIN users creator ON creator.id = COALESCE(mt.creator_id, mt.user_id)
        WHERE mt.hotel_id = $hid AND mt.task_type = 'planned'
          AND (DATE(mt.created_at) BETWEEN '$from' AND '$to'
               OR (mt.status = 'done' AND DATE(mt.updated_at) BETWEEN '$from' AND '$to'))
        ORDER BY ha.building ASC, CAST(ha.asset_key AS SIGNED) ASC, ha.asset_key ASC
        LIMIT 1000";

$rows = [];
$taskIds = [];
$res = $db->query($sql);
if ($res) {
    while ($r = $res->fetch_assoc()) {
        $rows[] = $r;
        $taskIds[] = (int)$r['id'];
    }
}

// Исполнители (task_workers)
$assignedByTask = [];
if (!empty($taskIds)) {
    $idsList = implode(',', $taskIds);
    $resTw = $db->query("SELECT tw.task_id, w.display_name AS name FROM task_workers tw
                          JOIN users w ON w.id = tw.worker_id WHERE tw.task_id IN ($idsList)");
    if ($resTw) {
        while ($tw = $resTw->fetch_assoc()) {
            $tid = (int)$tw['task_id'];
            if (!isset($assignedByTask[$tid])) $assignedByTask[$tid] = [];
            $assignedByTask[$tid][] = $tw['name'];
        }
    }
}

// Прогресс чек-листа номера (сколько пунктов уже не «pending»)
$checklistByTask = [];
if (!empty($taskIds)) {
    $idsList = implode(',', $taskIds);
    $resChk = $db->query("SELECT task_id,
                                  COUNT(*) AS total,
                                  SUM(status != 'pending') AS checked,
                                  SUM(status = 'defect') AS defects
                           FROM task_room_checks WHERE task_id IN ($idsList) GROUP BY task_id");
    if ($resChk) {
        while ($c = $resChk->fetch_assoc()) {
            $checklistByTask[(int)$c['task_id']] = [
                'total' => (int)$c['total'], 'checked' => (int)$c['checked'], 'defects' => (int)$c['defects']
            ];
        }
    }
}

// Детально по каждому пункту чек-листа (что именно сделано, с комментарием) — для просмотра «что было сделано»
$nameCol = 'name_' . $lang;
$commentCol = 'comment_' . $lang;
$checklistItemsByTask = [];
if (!empty($taskIds)) {
    $idsList = implode(',', $taskIds);
    $resItems = $db->query("SELECT trc.task_id, trc.status,
                                    COALESCE(NULLIF(trc.$commentCol, ''), trc.comment_ru) AS comment,
                                    COALESCE(NULLIF(d.$nameCol, ''), d.name_ru) AS item_name
                             FROM task_room_checks trc
                             JOIN room_checklist_dict d ON d.id = trc.check_id
                             WHERE trc.task_id IN ($idsList)
                             ORDER BY d.sort_order ASC, d.id ASC");
    if ($resItems) {
        while ($it = $resItems->fetch_assoc()) {
            $tid = (int)$it['task_id'];
            if (!isset($checklistItemsByTask[$tid])) $checklistItemsByTask[$tid] = [];
            $checklistItemsByTask[$tid][] = [
                'name' => $it['item_name'], 'status' => $it['status'], 'comment' => $it['comment'] ?: null
            ];
        }
    }
}

$tasks = [];
foreach ($rows as $r) {
    $tid = (int)$r['id'];
    $mediaArr = json_decode($r['media'] ?? '[]', true);
    if (!is_array($mediaArr)) $mediaArr = [];
    $tasks[] = [
        'id' => $tid,
        'status' => $r['status'],
        'description' => $r['description'],
        'room' => $r['building'] ? ($r['building'] . '-' . $r['floor'] . ' / ' . $r['asset_key']) : $r['asset_key'],
        'building' => $r['building'],
        'creator_name' => $r['creator_name'],
        'assigned_workers' => $assignedByTask[$tid] ?? [],
        'created_at' => $r['created_at'],
        'completed_at' => $r['status'] === 'done' ? $r['updated_at'] : null,
        'notes' => $r['notes'] ?: null,
        'media' => $mediaArr,
        'checklist' => $checklistByTask[$tid] ?? ['total' => 0, 'checked' => 0, 'defects' => 0],
        'checklist_items' => $checklistItemsByTask[$tid] ?? [],
    ];
}

// ---- Покрытие по номерам за период: сколько уникальных номеров получили плановую проверку ----
$totalRooms = 0;
$resTotal = $db->query("SELECT COUNT(*) AS c FROM hotel_assets WHERE hotel_id = $hid AND asset_key REGEXP '^[0-9]+$'");
if ($resTotal && ($row = $resTotal->fetch_assoc())) $totalRooms = (int)$row['c'];

$checkedRooms = 0;
$resChecked = $db->query("SELECT COUNT(DISTINCT mt.asset_id) AS c
                           FROM maintenance_tasks mt
                           WHERE mt.hotel_id = $hid AND mt.task_type = 'planned' AND mt.status = 'done'
                             AND (DATE(mt.created_at) BETWEEN '$from' AND '$to' OR DATE(mt.updated_at) BETWEEN '$from' AND '$to')");
if ($resChecked && ($row = $resChecked->fetch_assoc())) $checkedRooms = (int)$row['c'];

// Разбивка по зданиям
$byBuilding = [];
$resBB = $db->query("SELECT ha.building,
                             COUNT(DISTINCT ha.id) AS total_rooms,
                             COUNT(DISTINCT CASE WHEN mt.status = 'done' AND (DATE(mt.created_at) BETWEEN '$from' AND '$to' OR DATE(mt.updated_at) BETWEEN '$from' AND '$to') THEN mt.asset_id END) AS checked_rooms
                      FROM hotel_assets ha
                      LEFT JOIN maintenance_tasks mt ON mt.asset_id = ha.id AND mt.task_type = 'planned'
                      WHERE ha.hotel_id = $hid AND ha.asset_key REGEXP '^[0-9]+$'
                      GROUP BY ha.building");
if ($resBB) {
    while ($b = $resBB->fetch_assoc()) {
        $byBuilding[] = [
            'building' => $b['building'],
            'total_rooms' => (int)$b['total_rooms'],
            'checked_rooms' => (int)$b['checked_rooms'],
        ];
    }
}

echo json_encode([
    'success' => true, 'from' => $from, 'to' => $to, 'tasks' => $tasks,
    'coverage' => ['total_rooms' => $totalRooms, 'checked_rooms' => $checkedRooms, 'by_building' => $byBuilding],
]);
exit;