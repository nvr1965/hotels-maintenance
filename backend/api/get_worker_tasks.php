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

$urgent = [];
$planned = [];
$routine = [];

$nameCol = 'name_ru';
if (in_array($lang, ['en', 'he', 'ar'])) {
    $nameCol = 'name_' . $lang;
}

// 1. Загружаем справочник работ для номеров из room_checklist_dict
$checklistTemplate = [];
$resDict = $db->query("SELECT id, COALESCE($nameCol, name_ru, 'Пункт') as item_name FROM room_checklist_dict WHERE hotel_id = $hid ORDER BY sort_order ASC, id ASC");
if ($resDict) {
    while ($dRow = $resDict->fetch_assoc()) {
        $checklistTemplate[] = [
            'id' => $dRow['id'],
            'text' => $dRow['item_name'],
            'status' => 'pending'
        ];
    }
}

// 2. Открытые заявки отеля с именем автора (users по user_id)
$sql = "SELECT t.id, t.task_type, t.status, t.created_at, t.media, t.user_id,
               COALESCE(t.description_$langEsc, t.description_ru, 'Без описания') as description, 
               COALESCE(d.term_$langEsc, d.term_ru, a.asset_key, 'Объект') as location,
               a.asset_key, a.building, a.floor,
               COALESCE(w.display_name, 'Менеджер') as author_name
        FROM maintenance_tasks t 
        LEFT JOIN hotel_assets a ON t.asset_id = a.id 
        LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND a.asset_key = d.term_en
        LEFT JOIN users w ON t.user_id = w.id
        WHERE t.hotel_id = $hid AND t.status != 'done' AND t.status != 'completed'
        ORDER BY t.created_at DESC";

$res = $db->query($sql);

if ($res) {
    while ($row = $res->fetch_assoc()) {
        $type = trim(strtolower($row['task_type'] ?? 'current'));
        $assetKey = $row['asset_key'] ?? 'Объект';
        $location = $row['location'] ?? $assetKey;
        $building = $row['building'] ?? '-';
        $floor = $row['floor'] ?? '-';
        $description = $row['description'];
        $authorName = $row['author_name'] ?? 'Менеджер';
        
        $rawMedia = $row['media'] ?? '[]';
        $mediaArray = json_decode($rawMedia, true);
        if (!is_array($mediaArray)) {
            $mediaArray = [];
        }

        if ($type === 'planned') {
            $planned[] = [
                'id' => $row['id'],
                'status' => $row['status'] ?: 'pending',
                'created_at' => $row['created_at'],
                'description' => $description,
                'room_name' => $assetKey,
                'building' => $building,
                'floor' => $floor,
                'checklist' => $checklistTemplate
            ];
        } elseif ($type === 'routine' || $type === 'regiment') {
            // Регламенты берутся из routine_tasks (см. блок 3), сюда не попадают
            continue;
        } else {
            $urgent[] = [
                'id' => $row['id'],
                'status' => $row['status'] ?: 'pending',
                'created_at' => $row['created_at'],
                'description' => $description,
                'asset_key' => $assetKey,
                'location' => $location,
                'building' => $building,
                'floor' => $floor,
                'author_name' => $authorName,
                'media' => $mediaArray
            ];
        }
    }
}

// 3. Регламентные задачи: справочник routine_tasks + отметки за СЕГОДНЯ из routine_schedule
$today = date('Y-m-d');

// Каждые сутки заводим в routine_schedule строку на КАЖДУЮ регламентную задачу (status = pending),
// если её за сегодня ещё нет. Так все задачи попадают в БД, а список работника «обновляется» сам.
// INSERT IGNORE + уникальный ключ (task_id, target_date) — повторные вызовы дубликатов не создают.
$db->query("INSERT IGNORE INTO routine_schedule (hotel_id, task_id, target_date, status)
            SELECT hotel_id, id, '$today', 'pending' FROM routine_tasks WHERE hotel_id = $hid");

$sqlRout = "SELECT rt.id, rt.requires_ocr,
                   COALESCE(NULLIF(rt.$nameCol, ''), rt.name_ru, 'Регламентная задача') AS name,
                   rs.status AS sched_status, rs.notes AS sched_notes, rs.media AS sched_media,
                   rs.ocr_value AS sched_ocr_value, rs.ocr_unit AS sched_ocr_unit
            FROM routine_tasks rt
            LEFT JOIN routine_schedule rs ON rs.task_id = rt.id AND rs.target_date = '$today'
            WHERE rt.hotel_id = $hid
            ORDER BY rt.requires_ocr DESC, rt.sort_order ASC, rt.id ASC"; // счётчики — наверху списка
$resRout = $db->query($sqlRout);

$hasSchedule = true;


// Сколько фото счётчиков за сегодня ещё ждут распознавания администратором (close_task.php, отметка '[pending]')
$pendingToday = [];
$resPend = $db->query("SELECT task_id, COUNT(*) AS n FROM routine_log
                       WHERE hotel_id = $hid AND target_date = '$today' AND ocr_raw = '[pending]' GROUP BY task_id");
while ($resPend && ($pr = $resPend->fetch_assoc())) $pendingToday[(int)$pr['task_id']] = (int)$pr['n'];

if ($resRout) {
    while ($row = $resRout->fetch_assoc()) {
        $media = [];
        if ($hasSchedule && !empty($row['sched_media'])) {
            $decoded = json_decode($row['sched_media'], true);
            if (is_array($decoded)) $media = $decoded;
        }
        $routine[] = [
            'id' => (int)$row['id'],
            'status' => ($hasSchedule && ($row['sched_status'] ?? '') === 'done') ? 'done' : 'pending',
            'created_at' => $today,
            'description' => $row['name'],
            'notes' => $hasSchedule ? ($row['sched_notes'] ?? '') : '',
            'media' => $media,
            // Флаг: по фото этой задачи нужно распознавать показания (счётчики)
            'requires_ocr' => !empty($row['requires_ocr']),
            // Сохранённое за сегодня показание счётчика (если задача уже закрыта)
            'ocr_value' => $hasSchedule ? ($row['sched_ocr_value'] ?? null) : null,
            'ocr_unit'  => $hasSchedule ? ($row['sched_ocr_unit'] ?? '') : '',
            // Фото за сегодня, которые ещё ждут распознавания
            'ocr_pending' => $pendingToday[(int)$row['id']] ?? 0
        ];
    }
}

// Подставляем в каждую плановую задачу её РЕАЛЬНЫЙ сохранённый чек-лист
// (раньше всем задачам давался один и тот же пустой шаблон — отметки работника не показывались)
if (!empty($planned)) {
    $plannedIds = array_map(fn($p) => (int)$p['id'], $planned);
    $idsList = implode(',', $plannedIds);
    $resChk = $db->query("SELECT trc.task_id, trc.check_id,
                                  COALESCE(NULLIF(d.$nameCol, ''), d.name_ru, 'Пункт') AS item_name,
                                  trc.status
                           FROM task_room_checks trc
                           JOIN room_checklist_dict d ON d.id = trc.check_id
                           WHERE trc.task_id IN ($idsList)
                           ORDER BY d.sort_order ASC, d.id ASC");
    $checklistByTask = [];
    if ($resChk) {
        while ($c = $resChk->fetch_assoc()) {
            $tid = (int)$c['task_id'];
            if (!isset($checklistByTask[$tid])) $checklistByTask[$tid] = [];
            $checklistByTask[$tid][] = [
                'id' => (int)$c['check_id'],
                'text' => $c['item_name'],
                'status' => $c['status']
            ];
        }
    }
    foreach ($planned as &$p) {
        $p['checklist'] = $checklistByTask[$p['id']] ?? $checklistTemplate;
    }
    unset($p);
}

// Плановые — по возрастанию: здание, затем номер комнаты (числовая сортировка, не строковая)
usort($planned, function ($a, $b) {
    $bc = strnatcasecmp($a['building'] ?? '', $b['building'] ?? '');
    if ($bc !== 0) return $bc;
    return strnatcmp((string)($a['room_name'] ?? ''), (string)($b['room_name'] ?? ''));
});

echo json_encode([
    'success' => true,
    'today' => $today,
    'tasks' => [
        'urgent' => $urgent,
        'planned' => $planned,
        'routine' => $routine
    ]
]);
exit;
?>