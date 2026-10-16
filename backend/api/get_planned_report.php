<?php
// Отчёт по плановым обходам номеров за даты: задачи, исполнители, чек-лист и покрытие номеров по зданиям
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head', 'viewer']);
$hid = $me['hotel_id'];
$lang = api_lang($me);

$from = app_valid_date($_GET['from'] ?? null) ?? date('Y-m-d');
$to   = app_valid_date($_GET['to'] ?? null) ?? $from;
if ($from > $to) [$from, $to] = [$to, $from];

// Номер — объект с числовым ключом
const ROOM_RX = "'^[0-9]{1,15}$'";

// ---- Плановые задачи за период ----
$rows = db_all("SELECT mt.id, mt.status, mt.created_at, mt.updated_at, mt.notes, mt.notes_lang, mt.media,
                       mt.description, mt.description_lang,
                       ha.id AS asset_id, ha.building, ha.floor, ha.asset_key,
                       creator.display_name AS creator_name
                FROM maintenance_tasks mt
                LEFT JOIN hotel_assets ha ON ha.id = mt.asset_id
                LEFT JOIN users creator ON creator.id = COALESCE(mt.creator_id, mt.user_id)
                WHERE mt.hotel_id = ? AND mt.task_type = 'planned'
                  AND (mt.created_at::date BETWEEN ? AND ?
                       OR (mt.status = 'done' AND mt.updated_at::date BETWEEN ? AND ?))
                ORDER BY ha.building ASC,
                         CASE WHEN ha.asset_key ~ " . ROOM_RX . " THEN ha.asset_key::bigint END ASC NULLS LAST, ha.asset_key ASC
                LIMIT 1000", [$hid, $from, $to, $from, $to]);
$rows = i18n_rows_on_the_fly('maintenance_tasks', $rows, 'description', $lang);
$rows = i18n_free_rows($rows, 'notes', 'notes_lang', $lang);
$ids = sql_int_list(array_column($rows, 'id'));

// Исполнители (task_workers)
$assigned = [];
foreach ($rows ? db_all("SELECT tw.task_id, w.display_name AS name FROM task_workers tw
                         JOIN users w ON w.id = tw.worker_id WHERE tw.task_id IN ($ids)") : [] as $tw) {
    $assigned[(int)$tw['task_id']][] = $tw['name'];
}

// Прогресс чек-листа номера (сколько пунктов уже не «pending»)
$progress = [];
foreach ($rows ? db_all("SELECT task_id, COUNT(*) AS total,
                                COUNT(*) FILTER (WHERE status <> 'pending') AS checked,
                                COUNT(*) FILTER (WHERE status = 'defect') AS defects
                         FROM task_room_checks WHERE task_id IN ($ids) GROUP BY task_id") : [] as $c) {
    $progress[(int)$c['task_id']] = ['total' => (int)$c['total'], 'checked' => (int)$c['checked'], 'defects' => (int)$c['defects']];
}

// Каждый пункт чек-листа с комментарием (комментарий — на языке читающего, перевод на лету)
$items = [];
if ($rows) {
    $checks = db_all("SELECT trc.id, trc.task_id, trc.status, trc.comment, trc.comment_lang, d.names AS item_names
                      FROM task_room_checks trc
                      JOIN room_checklist_dict d ON d.id = trc.check_id
                      WHERE trc.task_id IN ($ids)
                      ORDER BY d.sort_order ASC, d.id ASC");
    foreach (i18n_rows_on_the_fly('task_room_checks', $checks, 'comment', $lang) as $it) {
        $items[(int)$it['task_id']][] = [
            'name' => i18n_pick($it['item_names'], $lang), 'status' => $it['status'],
            'comment' => $it['comment'] !== '' ? $it['comment'] : null, 'comment_orig' => $it['comment_orig'],
        ];
    }
}

$tasks = [];
foreach ($rows as $r) {
    $tid = (int)$r['id'];
    $media = json_decode((string)($r['media'] ?? '[]'), true);
    $tasks[] = [
        'id' => $tid,
        'status' => $r['status'],
        'description' => $r['description'],
        'description_orig' => $r['description_orig'],
        'room' => $r['building'] ? ($r['building'] . '-' . $r['floor'] . ' / ' . $r['asset_key']) : $r['asset_key'],
        'building' => $r['building'],
        'creator_name' => $r['creator_name'],
        'assigned_workers' => $assigned[$tid] ?? [],
        'created_at' => $r['created_at'],
        'completed_at' => $r['status'] === 'done' ? $r['updated_at'] : null,
        'notes' => $r['notes'] ?: null,
        'notes_orig' => $r['notes_orig'] ?? null,
        'media' => is_array($media) ? $media : [],
        'checklist' => $progress[$tid] ?? ['total' => 0, 'checked' => 0, 'defects' => 0],
        'checklist_items' => $items[$tid] ?? [],
    ];
}

// ---- Покрытие: сколько разных номеров получили плановую проверку за период ----
$inPeriod = "(mt.created_at::date BETWEEN ? AND ? OR mt.updated_at::date BETWEEN ? AND ?)";
$totalRooms = (int)db_value("SELECT COUNT(*) FROM hotel_assets WHERE hotel_id = ? AND asset_key ~ " . ROOM_RX, [$hid]);
$checkedRooms = (int)db_value("SELECT COUNT(DISTINCT mt.asset_id) FROM maintenance_tasks mt
                               WHERE mt.hotel_id = ? AND mt.task_type = 'planned' AND mt.status = 'done' AND $inPeriod",
    [$hid, $from, $to, $from, $to]);

$byBuilding = [];
foreach (db_all("SELECT ha.building, COUNT(DISTINCT ha.id) AS total_rooms,
                        COUNT(DISTINCT CASE WHEN mt.status = 'done' AND $inPeriod THEN mt.asset_id END) AS checked_rooms
                 FROM hotel_assets ha
                 LEFT JOIN maintenance_tasks mt ON mt.asset_id = ha.id AND mt.task_type = 'planned'
                 WHERE ha.hotel_id = ? AND ha.asset_key ~ " . ROOM_RX . "
                 GROUP BY ha.building ORDER BY ha.building", [$from, $to, $from, $to, $hid]) as $b) {
    $byBuilding[] = ['building' => $b['building'], 'total_rooms' => (int)$b['total_rooms'], 'checked_rooms' => (int)$b['checked_rooms']];
}

api_ok([
    'from' => $from, 'to' => $to, 'tasks' => $tasks,
    'coverage' => ['total_rooms' => $totalRooms, 'checked_rooms' => $checkedRooms, 'by_building' => $byBuilding],
]);
