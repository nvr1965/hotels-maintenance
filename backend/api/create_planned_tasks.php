<?php
// Плановые обходы: по заявке на каждый выбранный номер, с исполнителями и пунктами чек-листа отеля
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head']);
$hid = $me['hotel_id'];
$lang = api_lang($me);
$input = api_input();

$workerIds = array_values(array_unique(array_filter(array_map('intval', $input['worker_ids'] ?? []))));
$roomIds   = array_values(array_unique(array_filter(array_map('intval', $input['room_ids'] ?? []))));
$desc      = trim((string)($input['description'] ?? ''));
if ($desc === '') $desc = ui_t('planned_default_desc', $lang);

// Только люди и номера текущего отеля
if ($workerIds) {
    $workerIds = array_map('intval', array_column(db_all("SELECT user_id FROM hotel_members WHERE hotel_id = ? AND active
                                                           AND user_id IN (" . sql_int_list($workerIds) . ")", [$hid]), 'user_id'));
}
if ($roomIds) {
    $roomIds = array_map('intval', array_column(db_all("SELECT id FROM hotel_assets WHERE hotel_id = ?
                                                         AND id IN (" . sql_int_list($roomIds) . ")", [$hid]), 'id'));
}
if (!$workerIds || !$roomIds) api_fail('workers_and_rooms_required');

$created = 0;
$skipped = 0;
db_tx(function () use ($roomIds, $workerIds, $hid, $me, $desc, $lang, &$created, &$skipped) {
    foreach ($roomIds as $assetId) {
        // Номер с уже активной (не завершённой) плановой задачей пропускаем
        if (db_value("SELECT id FROM maintenance_tasks WHERE hotel_id = ? AND task_type = 'planned' AND asset_id = ? AND status <> 'done' LIMIT 1",
            [$hid, $assetId])) {
            $skipped++;
            continue;
        }
        $taskId = (int)db_value("INSERT INTO maintenance_tasks (hotel_id, task_type, asset_id, creator_id, description, description_lang, status)
                                 VALUES (?, 'planned', ?, ?, ?, ?, 'in_progress') RETURNING id",
            [$hid, $assetId, $me['id'], [$lang => $desc], $lang]);
        foreach ($workerIds as $wid) db_exec("INSERT INTO task_workers (task_id, worker_id) VALUES (?, ?)", [$taskId, $wid]);
        db_exec("INSERT INTO task_room_checks (task_id, check_id, status)
                 SELECT ?, id, 'pending' FROM room_checklist_dict WHERE hotel_id = ? ORDER BY sort_order, id", [$taskId, $hid]);
        $created++;
    }
});
api_ok(['created' => $created, 'skipped' => $skipped]);
