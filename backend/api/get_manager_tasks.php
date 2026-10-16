<?php
// Заявки, созданные этим менеджером: описание и место — на языке интерфейса (перевод на лету)
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];
$lang = api_lang($me);

$rows = db_all("SELECT t.id, t.task_type, t.status, t.created_at, t.media, t.description, t.description_lang,
                       d.names AS loc_names, a.asset_key
                FROM maintenance_tasks t
                LEFT JOIN hotel_assets a ON t.asset_id = a.id
                LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND a.asset_key = d.term_key
                WHERE t.hotel_id = ? AND t.user_id = ?
                ORDER BY t.created_at DESC", [$hid, $me['id']]);
$rows = i18n_rows_on_the_fly('maintenance_tasks', $rows, 'description', $lang);

$tasks = [];
foreach ($rows as $row) {
    $media = json_decode((string)$row['media'], true);
    $tasks[] = [
        'id' => (int)$row['id'],
        'task_type' => $row['task_type'] ?? 'current',
        'status' => $row['status'] ?? 'pending',
        'created_at' => $row['created_at'],
        'updated_at' => $row['created_at'],
        'description' => $row['description'] !== '' ? $row['description'] : ui_t('no_description', $lang),
        'description_orig' => $row['description_orig'],
        'location' => ($row['loc_names'] !== null ? i18n_pick($row['loc_names'], $lang) : '') ?: ($row['asset_key'] ?? ui_t('object', $lang)),
        'media' => is_array($media) ? $media : [],
    ];
}
api_ok(['tasks' => $tasks]);
