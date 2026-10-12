<?php
// Данные для экрана «Создать плановые задачи» (WorkerDashboard → openPlannedCreate):
// список исполнителей и номерной фонд «здание → этаж → номера».
// Ответ: { success, workers: [{id, name}], buildings: [{name, floors: [{name, rooms: [{id, name}]}]}] }
// (Раньше здесь лежала копия get_planned_report.php, и форма открывалась пустой.)
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head']);
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

// ---- Исполнители отеля (только роль worker, заблокированных не показываем) ----
$workers = [];
foreach (db_all("SELECT u.id, u.display_name FROM hotel_members m JOIN users u ON u.id = m.user_id AND u.active = 1
                 WHERE m.hotel_id = ? AND m.role = 'worker' AND m.active = 1 ORDER BY u.display_name ASC", [$hid]) as $w) {
    $workers[] = ['id' => (int)$w['id'], 'name' => $w['display_name']];
}

// ---- Номера: только объекты с числовым ключом (комнаты), сгруппированные по зданию и этажу ----
$tree = [];
$res = $db->query("SELECT id, building, floor, asset_key
                    FROM hotel_assets
                    WHERE hotel_id = $hid AND asset_key REGEXP '^[0-9]+$'
                    ORDER BY building ASC, CAST(floor AS SIGNED) DESC, CAST(asset_key AS SIGNED) ASC");
if ($res) {
    while ($r = $res->fetch_assoc()) {
        $b = (string)($r['building'] ?? '');
        $f = (string)($r['floor'] ?? '');
        $tree[$b][$f][] = ['id' => (int)$r['id'], 'name' => $r['asset_key']];
    }
}

$buildings = [];
foreach ($tree as $bName => $floors) {
    $floorList = [];
    foreach ($floors as $fName => $rooms) {
        $floorList[] = ['name' => (string)$fName, 'rooms' => $rooms];
    }
    $buildings[] = ['name' => (string)$bName, 'floors' => $floorList];
}

echo json_encode(['success' => true, 'workers' => $workers, 'buildings' => $buildings]);
exit;
