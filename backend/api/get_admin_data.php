<?php
// Админка: сотрудники отеля, последние 500 заявок и справочник чек-листа номеров
require_once __DIR__ . '/../core/api.php';
$me = app_require(null, true);
$hid = $me['hotel_id'];
$lang = api_lang($me);

$workers = [];
foreach (db_all("SELECT u.id, u.display_name, m.role, m.is_admin FROM hotel_members m JOIN users u ON u.id = m.user_id
                 WHERE m.hotel_id = ? ORDER BY u.display_name ASC", [$hid]) as $w) {
    $workers[] = ['id' => (int)$w['id'], 'name' => $w['display_name'], 'role' => $w['role'], 'sysadmin' => (int)$w['is_admin']];
}

// Список длинный: описание без перевода на лету — на языке интерфейса, если перевод уже есть, иначе оригинал
$tasks = [];
foreach (db_all("SELECT id, task_type, description, status, created_at FROM maintenance_tasks
                 WHERE hotel_id = ? ORDER BY created_at DESC LIMIT 500", [$hid]) as $t) {
    $tasks[] = ['id' => (int)$t['id'], 'task_type' => $t['task_type'], 'description' => i18n_pick($t['description'], $lang),
                'status' => $t['status'], 'created_at' => $t['created_at']];
}

$dictionary = [];
foreach (db_all("SELECT id, names FROM room_checklist_dict WHERE hotel_id = ? ORDER BY sort_order ASC, id ASC", [$hid]) as $d) {
    $dictionary[] = ['id' => (int)$d['id'], 'name' => i18n_pick($d['names'], $lang)];
}

api_ok(['workers' => $workers, 'tasks' => $tasks, 'dictionary' => $dictionary]);
