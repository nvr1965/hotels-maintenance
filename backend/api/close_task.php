<?php
// Закрытие задачи работником: регламентная (отметка за сегодня + история) или срочная/плановая.
// Заметки хранятся на языке автора (notes_lang), остальным показываются в переводе.
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];

// Отметка в routine_log.ocr_raw: фото счётчика ждёт распознавания администратором
const METER_PENDING = '[pending]';

$input = api_input();
$taskId    = (int)($input['task_id'] ?? 0);
$taskType  = $input['task_type'] ?? 'urgent';
$isDone    = !empty($input['is_done']);
$notes     = trim((string)($input['notes'] ?? ''));
$notesLang = $notes !== '' ? app_normalize_lang($me['lang'] ?? 'en') : null;
$media     = is_array($input['media'] ?? null) ? $input['media'] : [];
$mediaJson = json_encode($media);
$workerId  = $me['id']; // кто закрыл — из сессии, не из запроса

if ($taskId === 0) api_fail('task_id_required');
$opId = api_client_op($me, $input['client_op_id'] ?? null);

// ================================================================
//  РЕГЛАМЕНТНЫЕ ЗАДАЧИ
// ================================================================
if ($taskType === 'routine' || $taskType === 'regiment') {
    $statusStr = $isDone ? 'done' : 'pending';
    // Без связи закрыли вчера, а дошло сегодня — отметка ставится на тот день, когда закрыли
    $today = date('Y-m-d', api_done_time($input['done_at'] ?? null));

    $task = db_one("SELECT requires_ocr FROM routine_tasks WHERE id = ? AND hotel_id = ?", [$taskId, $hid]);
    if (!$task) api_fail('not_found');

    // Значение, введённое или поправленное работником вручную
    $ocrValue = $ocrRaw = null;
    $manual = $input['ocr_manual_value'] ?? null;
    if ($manual !== null && trim((string)$manual) !== '') {
        $ocrValue = trim((string)$manual);
        $ocrRaw = json_encode(['source' => 'manual']);
    }

    // Счётчик без ручного значения: работник только фотографирует. Последнее фото попадает в историю
    // с отметкой METER_PENDING, показание потом ставит администратор («Нераспознанные»).
    $pendingPhoto = null;
    if ($task['requires_ocr'] && $ocrValue === null) {
        foreach (array_reverse($media) as $item) {
            $url  = is_array($item) ? ($item['url'] ?? '') : (string)$item;
            $type = is_array($item) ? ($item['type'] ?? 'photo') : 'photo';
            if ($url !== '' && $type !== 'video' && !preg_match('/\.(mp4|mov|avi|webm)$/i', $url)) {
                $pendingPhoto = $url;
                break;
            }
        }
    }

    // Отметка за сегодня; показание перезаписывается, только если пришло новое
    $sched = db_one("INSERT INTO routine_schedule
                         (hotel_id, task_id, worker_id, target_date, status, notes, notes_lang, media, ocr_value, ocr_unit, ocr_raw)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
                     ON CONFLICT (task_id, target_date) DO UPDATE SET
                         worker_id  = EXCLUDED.worker_id,
                         status     = EXCLUDED.status,
                         notes      = EXCLUDED.notes,
                         notes_lang = EXCLUDED.notes_lang,
                         media      = EXCLUDED.media,
                         ocr_value  = COALESCE(EXCLUDED.ocr_value, routine_schedule.ocr_value),
                         ocr_unit   = CASE WHEN EXCLUDED.ocr_value IS NOT NULL THEN EXCLUDED.ocr_unit ELSE routine_schedule.ocr_unit END,
                         ocr_raw    = CASE WHEN EXCLUDED.ocr_value IS NOT NULL THEN EXCLUDED.ocr_raw ELSE routine_schedule.ocr_raw END
                     RETURNING id, ocr_value, ocr_unit, ocr_raw",
                    [$hid, $taskId, $workerId, $today, $statusStr, $notes, $notesLang, $mediaJson, $ocrValue, $ocrRaw]);

    // История: каждое закрытие, в том числе повторное
    $pending = $pendingPhoto !== null;
    db_exec("INSERT INTO routine_log
                 (hotel_id, schedule_id, task_id, worker_id, target_date, status, notes, notes_lang, media,
                  ocr_value, ocr_unit, ocr_raw, is_repeat)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [$hid, $sched['id'], $taskId, $workerId, $today, $statusStr, $notes, $notesLang, $mediaJson,
             $pending ? null : $sched['ocr_value'], $pending ? null : $sched['ocr_unit'],
             $pending ? METER_PENDING : $sched['ocr_raw'], !empty($input['is_repeat'])]);

    api_client_op_done($opId, $me, $pending ? ['pending' => true] : []);
    api_ok($pending ? ['pending' => true] : []);
}

// ================================================================
//  СРОЧНЫЕ И ПЛАНОВЫЕ ЗАДАЧИ
// ================================================================
$statusStr = $isDone ? 'done' : 'in_progress';
$type = db_value("SELECT lower(trim(task_type)) FROM maintenance_tasks WHERE id = ? AND hotel_id = ?", [$taskId, $hid]);
if ($type === null) api_fail('not_found');

db_tx(function () use ($input, $taskId, $hid, $statusStr, $notes, $notesLang, $mediaJson, $workerId) {
    db_exec("UPDATE maintenance_tasks
             SET status = ?, notes = ?, notes_lang = ?, media = ?, worker_id = ?, updated_at = now()
             WHERE id = ? AND hotel_id = ?",
            [$statusStr, $notes, $notesLang, $mediaJson, $workerId, $taskId, $hid]);

    // Чек-лист номера
    $allowed = ['pending', 'ok', 'defect', 'fixed'];
    foreach ((array)($input['checklist'] ?? []) as $item) {
        $checkId = (int)($item['id'] ?? 0);
        if ($checkId === 0) continue;
        $st = $item['status'] ?? (!empty($item['done']) ? 'ok' : 'pending'); // 'done' — старые клиенты
        if (!in_array($st, $allowed, true)) $st = 'pending';
        db_exec("UPDATE task_room_checks SET status = ? WHERE task_id = ? AND check_id = ?", [$st, $taskId, $checkId]);
    }
});
api_client_op_done($opId, $me);

// Срочная выполнена — убрать уведомление о ней и уменьшить цифру на иконке
if ($isDone && !in_array($type, ['planned', 'routine', 'regiment'], true)) {
    require_once __DIR__ . '/../core/push.php';
    push_finish_response(json_encode(['success' => true]));
    try {
        push_notify_urgent_done($hid, $taskId);
    } catch (Throwable $e) {
        error_log('push: ' . $e->getMessage());
    }
    exit;
}
api_ok();
