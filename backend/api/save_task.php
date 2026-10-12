<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require(['manager', 'head']);
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/translator.php';
require_once __DIR__ . '/../core/push.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $asset_id = (int)($_POST['asset_id'] ?? 0);
    // Объект должен быть из текущего отеля
    if ($asset_id !== 0 && !db_one("SELECT id FROM hotel_assets WHERE id = ? AND hotel_id = ?", [$asset_id, $hid])) $asset_id = 0;
    $description = trim($_POST['description'] ?? '');
    $user_id = $me['id']; // автор заявки — из сессии
    $mediaListRaw = $_POST['mediaList'] ?? '[]';
    $mediaList = json_decode($mediaListRaw, true);

    if ($asset_id === 0) {
        echo json_encode(['success' => false, 'message' => 'asset_id_required']);
        exit;
    }

    if (empty($description)) {
        if (!empty($mediaList)) {
            $description = "Медиа-заявка без текста";
        } else {
            echo json_encode(['success' => false, 'message' => 'description_required']);
            exit;
        }
    }

    $translator = new Translator();
    $translations = $translator->translateToAll($description);

    $desc_ru = $db->real_escape_string($translations['ru']);
    $desc_en = $db->real_escape_string($translations['en']);
    $desc_he = $db->real_escape_string($translations['he']);
    $desc_ar = $db->real_escape_string($translations['ar']);

    // Универсальная обработка входящих файлов (принимаем и строки, и объекты от CameraBlock)
    $mediaNormalized = [];
    if (is_array($mediaList)) {
        foreach ($mediaList as $item) {
            if (is_string($item)) {
                $mediaNormalized[] = ['type' => 'photo', 'url' => $item];
            } elseif (is_array($item) && isset($item['url'])) {
                $mediaNormalized[] = [
                    'type' => $item['type'] ?? 'photo',
                    'url' => $item['url']
                ];
            }
        }
    }
    
    $mediaJson = $db->real_escape_string(json_encode($mediaNormalized));

    $query = "INSERT INTO maintenance_tasks 
              (hotel_id, task_type, asset_id, user_id, description_ru, description_en, description_he, description_ar, status, media, created_at) 
              VALUES ($hid, 'current', $asset_id, $user_id, '$desc_ru', '$desc_en', '$desc_he', '$desc_ar', 'pending', '$mediaJson', NOW())";

    if ($db->query($query)) {
        // Сначала ответ менеджеру, потом рассылка на телефоны исполнителей и начальника
        $taskId = (int)$db->insert_id;
        push_finish_response(json_encode(['success' => true]));
        try {
            push_notify_new_urgent($hid, $taskId, (int)$user_id);
        } catch (Throwable $e) {
            error_log('push: ' . $e->getMessage());
            push_log($hid, 'new', $taskId, 'Ошибка: ' . $e->getMessage());
        }
    } else {
        echo json_encode(['success' => false, 'message' => 'db_error', 'error' => $db->error]);
    }
    exit;
}

echo json_encode(['success' => false, 'message' => 'invalid_request']);
?>