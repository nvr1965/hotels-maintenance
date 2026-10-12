<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/gemini_ocr.php';

// Отметка в routine_log.ocr_raw: фото счётчика ждёт распознавания администратором
const METER_PENDING = '[pending]';

header('Content-Type: application/json; charset=utf-8');


$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    echo json_encode(['success' => false, 'message' => 'invalid_input']);
    exit;
}

$taskId   = (int)($input['task_id']   ?? 0);
$taskType = $input['task_type']        ?? 'urgent';
$isDone   = !empty($input['is_done'])  ? 1 : 0;
$notes    = $db->real_escape_string(trim($input['notes'] ?? ''));
$media    = $input['media']            ?? [];
$mediaJson = $db->real_escape_string(json_encode($media));
$workerId = $me['id']; // кто закрыл — из сессии, не из запроса
$lang     = $db->real_escape_string($input['lang'] ?? 'ru');

if ($taskId === 0) {
    echo json_encode(['success' => false, 'message' => 'task_id_required']);
    exit;
}

// ================================================================
//  РЕГЛАМЕНТНЫЕ ЗАДАЧИ
// ================================================================
if ($taskType === 'routine' || $taskType === 'regiment') {

    $statusStr = $isDone ? 'done' : 'pending';
    $today     = date('Y-m-d');

    // ---- Получаем настройки задачи (requires_ocr, ocr_type) ----
    $taskMeta    = null;
    $requiresOcr = false;
    $ocrType     = 'generic';

    $resMeta = $db->query("SELECT requires_ocr, ocr_type FROM routine_tasks WHERE id = $taskId AND hotel_id = $hid LIMIT 1");
    $row = $resMeta->fetch_assoc();
    if (!$row) {
        echo json_encode(['success' => false, 'message' => 'not_found']);
        exit;
    }
    $requiresOcr = !empty($row['requires_ocr']);
    $ocrType     = $row['ocr_type'] ?? 'generic';

    // ---- OCR: пробуем распознать ПОСЛЕДНЕЕ фото из media -------
    $ocrValue  = null;
    $ocrUnit   = '';
    $ocrRaw    = null;
    $ocrError  = null;
    $ocrEngine = null;

    // Если работник вручную исправил значение OCR — используем его
    $ocrManualValue = isset($input['ocr_manual_value']) && $input['ocr_manual_value'] !== null
                    ? trim((string)$input['ocr_manual_value']) // экранируется ниже, при сборке SQL
                    : null;

    // Если работник ввёл значение вручную — пропускаем Gemini
    if ($ocrManualValue !== null) {
        $ocrValue  = $ocrManualValue;
        $ocrUnit   = '';
        $ocrRaw    = json_encode(['source' => 'manual']);
        $ocrEngine = 'manual (работник ввёл/поправил вручную)';
        $requiresOcr = false; // не запускаем Gemini
    }

    // Счётчик: исполнитель только фотографирует, распознавать некогда.
    // Фото сохраняется в истории без показания с отметкой METER_PENDING — показание потом ставит
    // администратор во вкладке «🔎 Нераспознанные» (распознаёт Gemini или вписывает руками).
    $pendingPhoto = null;
    if ($requiresOcr) {
        foreach (array_reverse(is_array($media) ? $media : []) as $item) {
            $url  = is_array($item) ? ($item['url'] ?? '') : (string)$item;
            $type = is_array($item) ? ($item['type'] ?? 'photo') : 'photo';
            if ($url !== '' && $type !== 'video' && !preg_match('/\.(mp4|mov|avi|webm)$/i', $url)) {
                $pendingPhoto = $url;
                break;
            }
        }
        $requiresOcr = false; // Gemini здесь больше не вызывается
    }

    // ---- Записываем / обновляем запись за сегодня (ON DUPLICATE KEY) ----
    $ocrValueSql = $ocrValue !== null ? "'" . $db->real_escape_string($ocrValue) . "'" : 'NULL';
    $ocrUnitSql  = "'" . $db->real_escape_string($ocrUnit) . "'";
    $ocrRawSql   = $ocrRaw  !== null ? "'" . $ocrRaw . "'" : 'NULL';

    $sql = "INSERT INTO routine_schedule
                (hotel_id, task_id, worker_id, target_date, status, notes, media, ocr_value, ocr_unit, ocr_raw)
            VALUES
                ($hid, $taskId, $workerId, '$today', '$statusStr', '$notes', '$mediaJson',
                 $ocrValueSql, $ocrUnitSql, $ocrRawSql)
            ON DUPLICATE KEY UPDATE
                worker_id = VALUES(worker_id),
                status    = VALUES(status),
                notes     = VALUES(notes),
                media     = VALUES(media),
                ocr_value = IF(VALUES(ocr_value) IS NOT NULL, VALUES(ocr_value), ocr_value),
                ocr_unit  = IF(VALUES(ocr_value) IS NOT NULL, VALUES(ocr_unit),  ocr_unit),
                ocr_raw   = IF(VALUES(ocr_value) IS NOT NULL, VALUES(ocr_raw),   ocr_raw)";

    if ($db->query($sql)) {
        $response = ['success' => true];

        // ---- История: каждое закрытие (в том числе повторное) пишем в routine_log ----
        // Для счётчика, значение которого ещё ждёт проверки работником ($requiresOcr всё ещё true),
        // запись в историю появится после подтверждения.
        if (!$requiresOcr) {
            $isRepeat = !empty($input['is_repeat']) ? 1 : 0;

            // Итоговые значения берём из routine_schedule (там уже учтён OCR / ручная правка)
            $sched = null;
            $resSched = $db->query("SELECT id, ocr_value, ocr_unit, ocr_raw FROM routine_schedule
                                    WHERE task_id = $taskId AND target_date = '$today' LIMIT 1");
            if ($resSched) $sched = $resSched->fetch_assoc();

            $stmt = $db->prepare("INSERT INTO routine_log
                (hotel_id, schedule_id, task_id, worker_id, target_date, status, notes, media, ocr_value, ocr_unit, ocr_raw, is_repeat)
                VALUES ($hid, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            if ($stmt) {
                $scheduleId = $sched['id']        ?? null;
                $logNotes   = trim($input['notes'] ?? '');
                $logMedia   = json_encode($media);
                $logOcrVal  = $sched['ocr_value'] ?? null;
                $logOcrUnit = $sched['ocr_unit']  ?? null;
                $logOcrRaw  = $sched['ocr_raw']   ?? null;
                if ($pendingPhoto !== null) {
                    // показания ещё нет — его впишет администратор
                    $logOcrVal  = null;
                    $logOcrUnit = null;
                    $logOcrRaw  = METER_PENDING;
                }
                $stmt->bind_param('iiisssssssi', $scheduleId, $taskId, $workerId, $today, $statusStr,
                                  $logNotes, $logMedia, $logOcrVal, $logOcrUnit, $logOcrRaw, $isRepeat);
                $stmt->execute();
                $stmt->close();
            }
        }

        // Возвращаем на фронтенд распознанное значение (чтобы сразу показать)
        if ($requiresOcr) {
            $response['ocr'] = [
                'value'  => $ocrValue,
                'unit'   => $ocrUnit,
                'error'  => $ocrError,
                'engine' => $ocrEngine ?? null
            ];
        }
        if ($pendingPhoto !== null) $response['pending'] = true;
        echo json_encode($response);
    } else {
        echo json_encode(['success' => false, 'message' => 'db_error', 'error' => $db->error]);
    }

// ================================================================
//  ОБЫЧНЫЕ СРОЧНЫЕ И ПЛАНОВЫЕ ЗАДАЧИ
// ================================================================
} else {
    $statusStr = $isDone ? 'done' : 'in_progress';
    // Заявка должна быть из текущего отеля
    if (!db_one("SELECT id FROM maintenance_tasks WHERE id = ? AND hotel_id = ?", [$taskId, $hid])) {
        echo json_encode(['success' => false, 'message' => 'not_found']);
        exit;
    }
    $sql = "UPDATE maintenance_tasks
            SET status = '$statusStr', notes = '$notes', media = '$mediaJson',
                worker_id = $workerId, updated_at = NOW()
            WHERE id = $taskId AND hotel_id = $hid";

    if ($db->query($sql)) {
        // Чек-лист номера (task_room_checks) — раньше он никак не сохранялся,
        // отметки работника пропадали при перезагрузке страницы
        $checklist = $input['checklist'] ?? [];
        $allowedStatuses = ['pending', 'ok', 'defect', 'fixed'];
        if (is_array($checklist) && !empty($checklist)) {
            $stmtChk = $db->prepare("UPDATE task_room_checks SET status = ? WHERE task_id = ? AND check_id = ?");
            if ($stmtChk) {
                foreach ($checklist as $item) {
                    $checkId = (int)($item['id'] ?? 0);
                    if ($checkId === 0) continue;
                    $newStatus = $item['status'] ?? (!empty($item['done']) ? 'ok' : 'pending'); // 'done' — для совместимости со старыми клиентами
                    if (!in_array($newStatus, $allowedStatuses, true)) $newStatus = 'pending';
                    $stmtChk->bind_param('sii', $newStatus, $taskId, $checkId);
                    $stmtChk->execute();
                }
                $stmtChk->close();
            }
        }
        // Срочная заявка выполнена — убрать уведомление о ней и уменьшить цифру на иконке
        $isUrgent = false;
        if ($isDone) {
            $resType = $db->query("SELECT LOWER(TRIM(COALESCE(task_type, 'current'))) FROM maintenance_tasks WHERE id = $taskId");
            $isUrgent = $resType && !in_array($resType->fetch_row()[0] ?? '', ['planned', 'routine', 'regiment'], true);
        }
        if ($isUrgent) {
            require_once __DIR__ . '/../core/push.php';
            push_finish_response(json_encode(['success' => true]));
            try {
                push_notify_urgent_done($hid, $taskId);
            } catch (Throwable $e) {
                error_log('push: ' . $e->getMessage());
            }
            exit;
        }
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'message' => 'db_error', 'error' => $db->error]);
    }
}
exit;
?>