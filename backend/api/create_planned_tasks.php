<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head']);
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];

$workerIds = array_values(array_unique(array_filter(array_map('intval', $input['worker_ids'] ?? []))));
$roomIds   = array_values(array_unique(array_filter(array_map('intval', $input['room_ids'] ?? []))));
$creatorId = $me['id'];
$desc      = trim($input['description'] ?? '');
if ($desc === '') $desc = 'Массовая плановая проверка';

// Только люди и номера текущего отеля
if ($workerIds) {
    $workerIds = array_map('intval', array_column(db_all("SELECT user_id FROM hotel_members WHERE hotel_id = ? AND active = 1
                                                           AND user_id IN (" . implode(',', $workerIds) . ")", [$hid]), 'user_id'));
}
if ($roomIds) {
    $roomIds = array_map('intval', array_column(db_all("SELECT id FROM hotel_assets WHERE hotel_id = ?
                                                         AND id IN (" . implode(',', $roomIds) . ")", [$hid]), 'id'));
}

if (empty($workerIds) || empty($roomIds)) {
    echo json_encode(['success' => false, 'message' => 'worker_ids и room_ids обязательны']);
    exit;
}

$descEsc = $db->real_escape_string($desc);
$created = 0;
$skipped = 0;

foreach ($roomIds as $assetId) {
    // Как в старой batch_planned.php: номер с уже активной (не завершённой) плановой задачей пропускаем
    $check = $db->query("SELECT id FROM maintenance_tasks
                          WHERE hotel_id = $hid AND task_type = 'planned' AND asset_id = $assetId AND status != 'done'");
    if ($check && $check->num_rows > 0) {
        $skipped++;
        continue;
    }

    $creatorSql = $creatorId !== null ? $creatorId : 'NULL';
    $db->query("INSERT INTO maintenance_tasks (hotel_id, task_type, asset_id, creator_id, description_ru, status)
                VALUES ($hid, 'planned', $assetId, $creatorSql, '$descEsc', 'in_progress')");
    $newTaskId = $db->insert_id;
    if (!$newTaskId) { $skipped++; continue; }

    $stmt = $db->prepare("INSERT INTO task_workers (task_id, worker_id) VALUES (?, ?)");
    if ($stmt) {
        foreach ($workerIds as $wid) {
            $stmt->bind_param('ii', $newTaskId, $wid);
            $stmt->execute();
        }
        $stmt->close();
    }

    $db->query("INSERT INTO task_room_checks (task_id, check_id, status)
                SELECT $newTaskId, id, 'pending' FROM room_checklist_dict WHERE hotel_id = $hid ORDER BY sort_order, id");

    $created++;
}

echo json_encode(['success' => true, 'created' => $created, 'skipped' => $skipped]);
exit;