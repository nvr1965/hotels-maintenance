<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require(null, true);
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

$lang = $_GET['lang'] ?? 'ru';
if (!in_array($lang, ['ru', 'en', 'he', 'ar'])) $lang = 'ru';
$descCol = 'description_' . $lang;
$nameCol = 'name_' . $lang;

// ---- Сотрудники ----
$workers = [];
foreach (db_all("SELECT u.id, u.display_name, m.role, m.is_admin FROM hotel_members m JOIN users u ON u.id = m.user_id
                 WHERE m.hotel_id = ? ORDER BY u.display_name ASC", [$hid]) as $w) {
    $workers[] = [
        'id' => (int)$w['id'],
        'name' => $w['display_name'],
        'role' => $w['role'],
        'sysadmin' => (int)$w['is_admin'],
    ];
}

// ---- Все заявки (срочные + плановые, любой статус) — последние 500 ----
$tasks = [];
$res = $db->query("SELECT id, task_type,
                           COALESCE(NULLIF($descCol, ''), description_ru) AS description,
                           status, created_at
                    FROM maintenance_tasks
                    WHERE hotel_id = $hid
                    ORDER BY created_at DESC
                    LIMIT 500");
if ($res) {
    while ($t = $res->fetch_assoc()) {
        $tasks[] = [
            'id' => (int)$t['id'],
            'task_type' => $t['task_type'],
            'description' => $t['description'],
            'status' => $t['status'],
            'created_at' => $t['created_at'],
        ];
    }
}

// ---- Справочник чек-листа номеров ----
$dictionary = [];
$res = $db->query("SELECT id, COALESCE(NULLIF($nameCol, ''), name_ru) AS name
                    FROM room_checklist_dict WHERE hotel_id = $hid ORDER BY sort_order ASC, id ASC");
if ($res) {
    while ($d = $res->fetch_assoc()) {
        $dictionary[] = ['id' => (int)$d['id'], 'name' => $d['name']];
    }
}

echo json_encode(['success' => true, 'workers' => $workers, 'tasks' => $tasks, 'dictionary' => $dictionary]);
exit;