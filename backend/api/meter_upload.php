<?php
// Загрузка фото счётчиков с компьютера (страница «Счётчики» в админке, только для сисадмина).
// Временная вспомогательная система: фото → распознавание Gemini → проверка человеком → запись в базу.
//
//   GET  ?action=init                 — список счётчиков
//   GET  ?action=day&date=YYYY-MM-DD   — что уже записано в базе на эту дату
//   POST action=ocr  (multipart: file, task_id) — сохранить фото и распознать (в базу НЕ пишет)
//   POST action=reocr (JSON: task_id, url) — распознать уже загруженное фото ещё раз
//   GET  ?action=list&from&to          — все записи счётчиков за период (для правки)
//   POST action=edit  (JSON: id, value, date, time) — исправить показание, дату, время
//   POST action=clear (JSON: id)               — удалить показание (запись истории остаётся, без значения)
//   POST action=save (JSON: rows[{task_id, date, time, value, url, gemini}]) — записать показания
require_once __DIR__ . '/../core/api.php';
$me = app_require(null, true);
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/meters.php';

header('Content-Type: application/json; charset=utf-8');

// Фото счётчиков — в папке отеля: uploads/h<id>/meters/ГГГГ-ММ/
define('METER_UPLOAD_DIR', __DIR__ . '/../../uploads/h' . $hid . '/meters');
define('METER_UPLOAD_URL', '/uploads/h' . $hid . '/meters');
const METER_MARK = '[загрузка с компьютера]';

function out(array $data): void
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$input = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST' && str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $input['action'] ?? $action;
}

$meters = meter_tasks($db, $hid, $me['lang'] ?? 'en');

if ($action === 'init') {
    out(['success' => true, 'meters' => array_values($meters), 'today' => date('Y-m-d')]);
}

// Что уже есть в базе на дату: все показания каждого счётчика со временем
if ($action === 'day') {
    $date = app_valid_date($_GET['date'] ?? null);
    if (!$date) out(['success' => false, 'message' => 'Неверная дата']);
    $values = [];
    foreach ($meters as $tid => $m) {
        foreach (meter_readings($db, $tid, $date, $date) as $r) $values[$tid][] = ['time' => $r['time'], 'value' => $r['value']];
    }
    out(['success' => true, 'date' => $date, 'values' => (object)$values]);
}

// Распознавание (очередь к Gemini, разбор 429) — общее со вкладкой «Нераспознанные»: backend/core/meter_ocr.php
require_once __DIR__ . '/../core/meter_ocr.php';

if ($action === 'ocr') {
    set_time_limit(120);
    $taskId = (int)($_POST['task_id'] ?? 0);
    if (!isset($meters[$taskId])) out(['success' => false, 'message' => 'Счётчик не найден']);
    $file = $_FILES['file'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) out(['success' => false, 'message' => 'Фото не загрузилось (код ' . ($file['error'] ?? '?') . ')']);
    if ($file['size'] > 20 * 1024 * 1024) out(['success' => false, 'message' => 'Фото больше 20 МБ']);

    $info = @getimagesize($file['tmp_name']);
    $ext = match ($info[2] ?? 0) { IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', default => null };
    if (!$ext) out(['success' => false, 'message' => 'Нужно фото JPG, PNG или WEBP']);

    $sub = date('Y-m');
    $dir = METER_UPLOAD_DIR . '/' . $sub;
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $name = 'meter' . $taskId . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], "$dir/$name")) out(['success' => false, 'message' => 'Не удалось сохранить фото на сервере']);
    $url = METER_UPLOAD_URL . "/$sub/$name";

    // Дата съёмки из EXIF (у фото из WhatsApp её обычно нет — тогда страница берёт дату из имени файла)
    $taken = null;
    if ($ext === 'jpg' && function_exists('exif_read_data')) {
        $exif = @exif_read_data("$dir/$name");
        $dt = $exif['DateTimeOriginal'] ?? $exif['DateTime'] ?? null;
        if ($dt && preg_match('/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/', $dt, $m)) {
            $taken = ['date' => "$m[1]-$m[2]-$m[3]", 'time' => "$m[4]:$m[5]"];
        }
    }

    out(['success' => true, 'url' => $url, 'taken' => $taken] + meter_ocr("$dir/$name", $meters[$taskId]));
}

// Повторное распознавание уже загруженного фото (кнопка «Распознать ещё раз»), без новой загрузки
if ($action === 'reocr') {
    set_time_limit(120);
    $taskId = (int)($input['task_id'] ?? 0);
    $url = (string)($input['url'] ?? '');
    if (!isset($meters[$taskId])) out(['success' => false, 'message' => 'Счётчик не найден']);
    if (!preg_match('#^' . preg_quote(METER_UPLOAD_URL, '#') . '/\d{4}-\d{2}/[\w.-]+$#', $url)) out(['success' => false, 'message' => 'Неверное фото']);
    $path = METER_UPLOAD_DIR . substr($url, strlen(METER_UPLOAD_URL));
    if (!is_file($path)) out(['success' => false, 'message' => 'Фото не найдено на сервере']);
    out(['success' => true, 'url' => $url] + meter_ocr($path, $meters[$taskId]));
}

if ($action === 'save') {
    $rows = $input['rows'] ?? [];
    if (!is_array($rows) || !$rows) out(['success' => false, 'message' => 'Нечего записывать']);

    $saved = 0;
    $errors = [];
    $workerId = (int)$me['id'];
    foreach ($rows as $row) {
        $taskId = (int)($row['task_id'] ?? 0);
        $date   = app_valid_date($row['date'] ?? null);
        $time   = preg_match('/^\d{2}:\d{2}$/', (string)($row['time'] ?? '')) ? $row['time'] : '12:00';
        $num    = meter_number($row['value'] ?? null);
        $url    = (string)($row['url'] ?? '');
        $name   = $meters[$taskId]['name'] ?? "#$taskId";
        if (!isset($meters[$taskId])) { $errors[] = "$name: счётчик не найден"; continue; }
        if (!$date) { $errors[] = "$name: неверная дата"; continue; }
        if ($num === null) { $errors[] = "$name: показание не число"; continue; }
        if ($url !== '' && !preg_match('#^' . preg_quote(METER_UPLOAD_URL, '#') . '/\d{4}-\d{2}/[\w.-]+$#', $url)) $url = '';

        $value = rtrim(rtrim(number_format($num, 3, '.', ''), '0'), '.');
        $unit  = $meters[$taskId]['unit'];
        $gemini = $row['gemini'] ?? null;
        $raw = '[engine: meter_upload] ' . METER_MARK . ' gemini=' . ($gemini === null || $gemini === '' ? '—' : $gemini) . '; записано=' . $value
             . ($url ? "; фото $url" : '');
        $photo = $url ? [['url' => $url, 'type' => 'photo']] : [];

        try {
            db_tx(function () use ($db, $hid, $taskId, $date, $time, $value, $unit, $raw, $photo, $workerId) {
                // Строка регламента на день (одна в сутки): фото добавляем к имеющимся, значение потом = последнее за день
                $existing = db_one("SELECT id, media, notes FROM routine_schedule WHERE task_id = ? AND target_date = ?", [$taskId, $date]);
                if ($existing) {
                    $sid = (int)$existing['id'];
                    $media = json_decode((string)$existing['media'], true);
                    $notes = (string)($existing['notes'] ?? '');
                    if (!str_contains($notes, METER_MARK)) $notes = trim($notes . ' ' . METER_MARK);
                    db_exec("UPDATE routine_schedule SET status = 'done', media = ?, notes = ? WHERE id = ?",
                        [json_encode(array_merge(is_array($media) ? $media : [], $photo), JSON_UNESCAPED_SLASHES), $notes, $sid]);
                    $repeat = true;
                    meter_materialize_day($db, $taskId, $date);
                } else {
                    $sid = (int)db_value("INSERT INTO routine_schedule (hotel_id, task_id, worker_id, target_date, status, notes, media, ocr_value, ocr_unit, ocr_raw)
                                          VALUES (?, ?, ?, ?, 'done', ?, ?, ?, ?, ?) RETURNING id",
                        [$hid, $taskId, $workerId, $date, METER_MARK, json_encode($photo, JSON_UNESCAPED_SLASHES), $value, $unit, $raw]);
                    $repeat = false;
                }
                // Каждое показание — отдельная запись в истории со своим временем (несколько в сутки)
                db_exec("INSERT INTO routine_log (hotel_id, schedule_id, task_id, worker_id, target_date, status, notes, media,
                                                  ocr_value, ocr_unit, ocr_raw, is_repeat, closed_at)
                         VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?)",
                    [$hid, $sid, $taskId, $workerId, $date, METER_MARK, json_encode($photo, JSON_UNESCAPED_SLASHES),
                     $value, $unit, $raw, $repeat, "$date $time:00"]);
                meter_sync_day($db, $taskId, $date, $unit, $workerId, METER_MARK);
            });
            $saved++;
        } catch (PDOException $e) {
            error_log('hotels: meter_upload save: ' . $e->getMessage());
            $errors[] = "$name: ошибка базы";
        }
    }
    out(['success' => $saved > 0, 'saved' => $saved, 'errors' => $errors]);
}

// ---------- Правка показаний задним числом ----------

// Все показания счётчиков за период (несколько в сутки — каждое отдельной строкой)
if ($action === 'list') {
    $to   = app_valid_date($_GET['to'] ?? null) ?? date('Y-m-d');
    $from = app_valid_date($_GET['from'] ?? null) ?? date('Y-m-d', strtotime("$to -30 days"));
    if ($from > $to) [$from, $to] = [$to, $from];
    if (strtotime($to) - strtotime($from) > 400 * 86400) $from = date('Y-m-d', strtotime("$to -400 days"));
    $rows = [];
    foreach ($meters as $tid => $m) {
        foreach (meter_readings($db, $tid, $from, $to) as $r) $rows[] = ['task_id' => $tid] + $r;
    }
    usort($rows, fn($a, $b) => strcmp($b['at'], $a['at']) ?: $a['task_id'] <=> $b['task_id']);
    out(['success' => true, 'from' => $from, 'to' => $to, 'meters' => array_values($meters), 'rows' => $rows]);
}

// Изменить показание, дату и время одной записи / удалить показание.
// id: 'l123' — запись истории (routine_log), 's45' — старое показание только в регламенте (routine_schedule).
// В заметку дописывается, что было; показание дня в регламенте пересчитывается (= последнее за день).
if ($action === 'edit' || $action === 'clear') {
    $rid = (string)($input['id'] ?? '');
    if (!preg_match('/^([ls])(\d+)$/', $rid, $mm)) out(['success' => false, 'message' => 'Запись не найдена']);
    [$kind, $id] = [$mm[1], (int)$mm[2]];
    $stamp = date('d.m.Y H:i');
    $fmt = fn($d) => date('d.m.Y', strtotime($d));
    $workerId = (int)$me['id'];

    // Ответ (out) выходит из скрипта, поэтому транзакцию ведём вручную: откат при любом выходе без commit
    $db->beginTransaction();
    register_shutdown_function(function () use ($db) { if ($db->inTransaction()) $db->rollBack(); });
    $done = function (array $data) use ($db) { $db->commit(); out($data); };

    // Старое показание только в регламенте — сначала переносим его в историю, дальше правим как обычное
    if ($kind === 's') {
        $srow = db_one("SELECT task_id, target_date::text AS target_date FROM routine_schedule WHERE id = ? AND hotel_id = ?", [$id, $hid]);
        if (!$srow || !isset($meters[(int)$srow['task_id']])) out(['success' => false, 'message' => 'Запись не найдена']);
        $newId = meter_materialize_day($db, (int)$srow['task_id'], $srow['target_date']);
        if (!$newId) out(['success' => false, 'message' => 'Запись уже изменилась, обновите страницу']);
        $id = $newId;
    }

    $row = db_one("SELECT id, task_id, target_date::text AS target_date, closed_at, ocr_value, notes FROM routine_log WHERE id = ? AND hotel_id = ?", [$id, $hid]);
    if (!$row || !isset($meters[(int)$row['task_id']])) out(['success' => false, 'message' => 'Запись не найдена']);
    $taskId = (int)$row['task_id'];
    $unit = $meters[$taskId]['unit'];
    $old = $row['ocr_value'];
    $oldDate = $row['target_date'];
    $oldTime = substr((string)$row['closed_at'], 0, 10) === $oldDate ? substr((string)$row['closed_at'], 11, 5) : '12:00';

    if ($action === 'clear') {
        $notes = trim(($row['notes'] ?? '') . " [$stamp удалено показание " . ($old ?? '—') . ']');
        db_exec("UPDATE routine_log SET ocr_value = NULL, notes = ? WHERE id = ?", [$notes, $id]);
        meter_sync_day($db, $taskId, $oldDate, $unit, $workerId, METER_MARK);
        $done(['success' => true]);
    }

    $num = meter_number($input['value'] ?? null);
    $date = app_valid_date($input['date'] ?? null);
    $time = preg_match('/^\d{2}:\d{2}$/', (string)($input['time'] ?? '')) ? $input['time'] : $oldTime;
    if ($num === null) out(['success' => false, 'message' => 'Показание должно быть числом']);
    if (!$date) out(['success' => false, 'message' => 'Неверная дата']);
    if ($date > date('Y-m-d')) out(['success' => false, 'message' => 'Дата в будущем']);
    $value = rtrim(rtrim(number_format($num, 3, '.', ''), '0'), '.');
    if ($value === (string)$old && $date === $oldDate && $time === $oldTime) $done(['success' => true, 'unchanged' => true]);

    $was = ($old ?? '—') . ' от ' . $fmt($oldDate) . " $oldTime";
    $notes = trim(($row['notes'] ?? '') . " [$stamp правка: было $was, стало $value от " . $fmt($date) . " $time]");
    $schedId = db_value("SELECT id FROM routine_schedule WHERE task_id = ? AND target_date = ?", [$taskId, $date]);
    db_exec("UPDATE routine_log SET ocr_value = ?, ocr_unit = ?, target_date = ?, closed_at = ?, notes = ?, schedule_id = ? WHERE id = ?",
        [$value, $unit, $date, "$date $time:00", $notes, $schedId, $id]);
    // Старые повторные записи того же показания на ту же минуту больше не нужны — иначе они «всплывут» на старом времени
    if ($date !== $oldDate || $time !== $oldTime) {
        db_exec("UPDATE routine_log SET ocr_value = NULL, notes = COALESCE(notes, '') || ' [повтор записи, заменён]'
                 WHERE task_id = ? AND id < ? AND closed_at = ?::timestamp AND target_date = ? AND ocr_value IS NOT NULL",
            [$taskId, $id, $row['closed_at'], $oldDate]);
    }
    meter_sync_day($db, $taskId, $date, $unit, $workerId, METER_MARK);
    if ($date !== $oldDate) meter_sync_day($db, $taskId, $oldDate, $unit, $workerId, METER_MARK);
    $done(['success' => true]);
}

out(['success' => false, 'message' => 'Неизвестное действие']);
