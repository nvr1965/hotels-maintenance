<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

$lang = isset($_GET['lang']) ? $_GET['lang'] : 'ru';
if (!in_array($lang, ['ru', 'en', 'he', 'ar'])) {
    $lang = 'ru';
}
$langEsc = $db->real_escape_string($lang);

$user_id = $me['id'];

$sql = "SELECT t.id, t.task_type, t.status, t.created_at, t.media, 
               COALESCE(t.description_$langEsc, t.description_ru, 'Без описания') as description,
               COALESCE(d.term_$langEsc, d.term_ru, a.asset_key, 'Объект') as location
        FROM maintenance_tasks t
        LEFT JOIN hotel_assets a ON t.asset_id = a.id
        LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND a.asset_key = d.term_en
        WHERE t.hotel_id = $hid AND t.user_id = $user_id
        ORDER BY t.created_at DESC";

$res = $db->query($sql);
$tasks = [];

if ($res) {
    while ($row = $res->fetch_assoc()) {
        $rawMedia = $row['media'];
        $decodedMedia = [];
        if (!empty($rawMedia)) {
            $decodedMedia = json_decode($rawMedia, true);
            if (!is_array($decodedMedia)) {
                $decodedMedia = [];
            }
        }

        $tasks[] = [
            'id' => $row['id'],
            'task_type' => $row['task_type'] ?? 'current',
            'status' => $row['status'] ?? 'pending',
            'created_at' => $row['created_at'],
            'updated_at' => $row['created_at'],
            'description' => $row['description'],
            'location' => $row['location'],
            'media' => $decodedMedia
        ];
    }
} else {
    error_log("SQL Error in get_manager_tasks.php: " . $db->error);
}

echo json_encode(['success' => true, 'tasks' => $tasks]);
exit;
?>