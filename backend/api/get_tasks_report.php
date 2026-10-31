<?php
// Отчёт по заявкам за даты: созданные или выполненные в периоде
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head', 'viewer']);
$hid = $me['hotel_id'];
$lang = api_lang($me);

$from = app_valid_date($_GET['from'] ?? null) ?? date('Y-m-d');
$to   = app_valid_date($_GET['to'] ?? null) ?? $from;
if ($from > $to) [$from, $to] = [$to, $from];
$typeFilter = $_GET['type'] ?? 'all'; // all | current | planned

$rows = db_all("SELECT mt.id, mt.task_type, mt.status, mt.created_at, mt.updated_at, mt.description, mt.description_lang,
                       ha.building, ha.floor, ha.asset_key,
                       creator.display_name AS creator_name, doer.display_name AS worker_name
                FROM maintenance_tasks mt
                LEFT JOIN hotel_assets ha ON ha.id = mt.asset_id
                LEFT JOIN users creator ON creator.id = COALESCE(mt.creator_id, mt.user_id)
                LEFT JOIN users doer ON doer.id = mt.worker_id
                WHERE mt.hotel_id = ? AND (mt.created_at::date BETWEEN ? AND ?
                       OR (mt.status = 'done' AND mt.updated_at::date BETWEEN ? AND ?))
                  AND (? = 'all' OR mt.task_type = ?)
                ORDER BY mt.created_at DESC
                LIMIT 1000", [$hid, $from, $to, $from, $to, in_array($typeFilter, ['current', 'planned'], true) ? $typeFilter : 'all', $typeFilter]);
$rows = i18n_rows_on_the_fly('maintenance_tasks', $rows, 'description', $lang);

// Для плановых задач исполнителей может быть несколько (task_workers)
$assigned = [];
if ($rows) {
    foreach (db_all("SELECT tw.task_id, w.display_name AS name FROM task_workers tw JOIN users w ON w.id = tw.worker_id
                     WHERE tw.task_id IN (" . sql_int_list(array_column($rows, 'id')) . ")") as $tw) {
        $assigned[(int)$tw['task_id']][] = $tw['name'];
    }
}
foreach ($rows as &$r) {
    $r['id'] = (int)$r['id'];
    $r['room'] = $r['building'] ? ($r['building'] . '-' . $r['floor'] . ' / ' . $r['asset_key']) : ($r['asset_key'] ?? null);
    $r['assigned_workers'] = $assigned[$r['id']] ?? [];
    $r['completed_at'] = $r['status'] === 'done' ? $r['updated_at'] : null;
    unset($r['building'], $r['floor'], $r['asset_key'], $r['updated_at'], $r['description_lang']);
}
unset($r);
api_ok(['from' => $from, 'to' => $to, 'tasks' => $rows]);
