<?php
// Новая срочная заявка. Описание сохраняется на языке автора; другим оно переводится при показе.
require_once __DIR__ . '/../core/api.php';
$me = app_require(['manager', 'head']);
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/push.php';

api_require_post();
$lang = $me['lang'];
$opId = api_client_op($me, $_POST['client_op_id'] ?? null);
$asset_id = (int)($_POST['asset_id'] ?? 0);
// Объект должен быть из текущего отеля
if ($asset_id !== 0 && !db_one("SELECT id FROM hotel_assets WHERE id = ? AND hotel_id = ?", [$asset_id, $hid])) $asset_id = 0;
if ($asset_id === 0) api_fail('asset_id_required');

$description = trim((string)($_POST['description'] ?? ''));
$mediaList = json_decode((string)($_POST['mediaList'] ?? '[]'), true);
if ($description === '') {
    if (empty($mediaList)) api_fail('description_required');
    $description = ui_t('media_only_task', $lang);
}

// Файлы приходят строками или объектами от CameraBlock
$media = [];
foreach (is_array($mediaList) ? $mediaList : [] as $item) {
    if (is_string($item)) $media[] = ['type' => 'photo', 'url' => $item];
    elseif (is_array($item) && isset($item['url'])) $media[] = ['type' => $item['type'] ?? 'photo', 'url' => (string)$item['url']];
}

$taskId = (int)db_value("INSERT INTO maintenance_tasks (hotel_id, task_type, asset_id, user_id, description, description_lang, status, media)
                         VALUES (?, 'current', ?, ?, ?, ?, 'pending', ?) RETURNING id",
    [$hid, $asset_id, $me['id'], [$lang => $description], $lang, json_encode($media, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);

api_client_op_done($opId, $me, ['id' => $taskId]);

// Сначала ответ менеджеру, потом рассылка на телефоны исполнителей и начальника (там же перевод на их языки)
push_finish_response(json_encode(['success' => true, 'id' => $taskId]));
try {
    push_notify_new_urgent($hid, $taskId, (int)$me['id']);
} catch (Throwable $e) {
    error_log('push: ' . $e->getMessage());
    push_log($hid, 'new', $taskId, 'Ошибка: ' . $e->getMessage());
}
