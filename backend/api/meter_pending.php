<?php
/* Админка → «🔎 Нераспознанные»: фото счётчиков, которые исполнители сняли без распознавания.
 *
 * Исполнитель только фотографирует (close_task.php): в routine_log появляется запись без показания
 * с отметкой ocr_raw = '[pending]'. Здесь администратор распознаёт фото через Gemini (по одному,
 * через общую очередь meter_ocr) или вписывает показание руками.
 *
 * GET  ?action=count                     — сколько фото ждёт (для значка на вкладке)
 * GET  ?action=list                      — все ждущие фото + предыдущее показание счётчика
 * POST ?action=ocr     {id, url}         — распознать одно фото (в базу не пишет)
 * POST ?action=save    {id, value, gemini?} — записать показание
 * POST ?action=skip    {id}              — убрать из списка без показания (плохое фото, дубль)
 */
require_once __DIR__ . '/../core/admin.php';
$me = admin_require();
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/meters.php';
require_once __DIR__ . '/../core/meter_ocr.php';

const PENDING = '[pending]';
const PENDING_SKIPPED = '[pending:skipped]';
const PENDING_MARK = '[нераспознанные]';

$action = $_GET['action'] ?? 'list';
$in = $_SERVER['REQUEST_METHOD'] === 'POST' ? admin_input() : [];


/** Ждущая запись (только счётчик, только с отметкой '[pending]'). */
function pending_row(int $id): ?array
{
    global $hid;
    return admin_fetch_one("SELECT l.* FROM routine_log l JOIN routine_tasks rt ON rt.id = l.task_id
                            WHERE l.id = ? AND rt.hotel_id = ? AND rt.requires_ocr = 1 AND l.ocr_raw = ?", [$id, $hid, PENDING]);
}

/** Все фото (не видео) записи. */
function pending_photos($mediaJson): array
{
    $media = json_decode((string)$mediaJson, true);
    $out = [];
    foreach (is_array($media) ? $media : [] as $it) {
        $url = is_array($it) ? ($it['url'] ?? '') : (string)$it;
        $type = is_array($it) ? ($it['type'] ?? '') : '';
        if ($url === '' || $type === 'video' || preg_match('/\.(mp4|mov|avi|webm)$/i', $url)) continue;
        $out[] = '/' . ltrim($url, '/');
    }
    return $out;
}


if ($action === 'count') {
    admin_ok(['count' => admin_count("SELECT COUNT(*) FROM routine_log l JOIN routine_tasks rt ON rt.id = l.task_id
                                      WHERE rt.hotel_id = ? AND rt.requires_ocr = 1 AND l.ocr_raw = ?", [$hid, PENDING])]);
}

if ($action === 'list') {
    $meters = meter_tasks($db, $hid, $me['lang'] ?? 'ru');
    $rows = admin_fetch_all("SELECT l.id, l.task_id, l.worker_id, w.display_name AS worker_name, l.target_date, l.closed_at, l.media, l.notes
                             FROM routine_log l
                             JOIN routine_tasks rt ON rt.id = l.task_id AND rt.requires_ocr = 1 AND rt.hotel_id = ?
                             LEFT JOIN users w ON w.id = l.worker_id
                             WHERE l.ocr_raw = ?
                             ORDER BY l.closed_at ASC, l.id ASC LIMIT 500", [$hid, PENDING]);

    // Предыдущее показание каждого фото — чтобы сразу было видно, если цифры не сходятся
    $readings = [];
    $span = [];
    foreach ($rows as $r) {
        $tid = (int)$r['task_id'];
        $span[$tid][0] = min($span[$tid][0] ?? $r['target_date'], $r['target_date']);
        $span[$tid][1] = max($span[$tid][1] ?? $r['target_date'], $r['target_date']);
    }
    foreach ($span as $tid => [$from, $to]) {
        $readings[$tid] = meter_readings($db, $tid, date('Y-m-d', strtotime("$from -120 days")), $to);
    }

    $out = [];
    foreach ($rows as $r) {
        $tid = (int)$r['task_id'];
        $closed = (string)$r['closed_at'];
        $time = substr($closed, 0, 10) === $r['target_date'] ? substr($closed, 11, 5) : '12:00';
        $at = $r['target_date'] . ' ' . $time;
        $prev = null;
        foreach ($readings[$tid] ?? [] as $rd) {
            if ($rd['at'] < $at) $prev = $rd; else break;
        }
        $out[] = [
            'id'          => (int)$r['id'],
            'task_id'     => $tid,
            'meter'       => $meters[$tid]['name'] ?? "#$tid",
            'unit'        => $meters[$tid]['unit'] ?? '',
            'kind'        => $meters[$tid]['kind'] ?? 'counter',
            'date'        => $r['target_date'],
            'time'        => $time,
            'worker'      => $r['worker_name'],
            'notes'       => (string)$r['notes'],
            'photos'      => pending_photos($r['media']),
            'prev'        => $prev ? ['value' => $prev['value'], 'date' => $prev['date'], 'time' => $prev['time']] : null,
        ];
    }
    admin_ok(['rows' => $out, 'meters' => array_values($meters)]);
}

if ($action === 'ocr') {
    set_time_limit(180);
    $row = pending_row((int)($in['id'] ?? 0));
    if (!$row) admin_fail('already_done');
    $photos = pending_photos($row['media']);
    $url = (string)($in['url'] ?? '');
    if ($url === '' && $photos) $url = end($photos);
    if (!in_array($url, $photos, true)) admin_fail('no_photo');
    $path = realpath(__DIR__ . '/../../' . ltrim($url, '/'));
    $uploads = realpath(__DIR__ . '/../../uploads');
    if (!$path || !$uploads || !str_starts_with($path, $uploads) || !is_file($path)) admin_fail('photo_missing');
    $meters = meter_tasks($db, $hid, 'ru');
    $meter = $meters[(int)$row['task_id']] ?? null;
    if (!$meter) admin_fail('not_found');
    admin_ok(['url' => $url] + meter_ocr($path, $meter));
}

if ($action === 'save') {
    $id = (int)($in['id'] ?? 0);
    $num = meter_number($in['value'] ?? null);
    if ($num === null) admin_fail('not_number');
    $db->begin_transaction();
    $row = admin_fetch_one("SELECT l.* FROM routine_log l JOIN routine_tasks rt ON rt.id = l.task_id
                            WHERE l.id = ? AND rt.hotel_id = ? AND rt.requires_ocr = 1 AND l.ocr_raw = ? FOR UPDATE", [$id, $hid, PENDING]);
    if (!$row) { $db->rollback(); admin_fail('already_done'); }
    $taskId = (int)$row['task_id'];
    $meters = meter_tasks($db, $hid, 'ru');
    $unit = $meters[$taskId]['unit'] ?? '';
    $value = rtrim(rtrim(number_format($num, 3, '.', ''), '0'), '.');
    $gemini = $in['gemini'] ?? null;
    $gemini = ($gemini === null || $gemini === '') ? '—' : mb_substr((string)$gemini, 0, 30);
    $raw = '[engine: meter_pending] ' . PENDING_MARK . " gemini=$gemini; записано=$value; администратор " . $me['name'];
    $notes = trim(($row['notes'] ?? '') . ' [' . date('d.m.Y H:i') . ' показание ' . $value . ' вписал ' . $me['name'] . ']');
    admin_exec("UPDATE routine_log SET ocr_value = ?, ocr_unit = ?, ocr_raw = ?, notes = ? WHERE id = ?", [$value, $unit, $raw, $notes, $id]);
    meter_sync_day($db, $taskId, $row['target_date'], $unit, (int)($row['worker_id'] ?? $me['id']), PENDING_MARK);
    $db->commit();
    admin_audit($me, 'update', 'routine_log', $id, ['ocr_value' => null, 'ocr_raw' => PENDING],
                ['ocr_value' => $value, 'ocr_unit' => $unit, 'gemini' => $gemini]);
    admin_ok(['value' => $value]);
}

if ($action === 'skip') {
    $id = (int)($in['id'] ?? 0);
    $row = pending_row($id);
    if (!$row) admin_fail('already_done');
    $notes = trim(($row['notes'] ?? '') . ' [' . date('d.m.Y H:i') . ' без показания, убрал ' . $me['name'] . ']');
    admin_exec("UPDATE routine_log SET ocr_raw = ?, notes = ? WHERE id = ? AND ocr_raw = ?", [PENDING_SKIPPED, $notes, $id, PENDING]);
    admin_audit($me, 'update', 'routine_log', $id, ['ocr_raw' => PENDING], ['ocr_raw' => PENDING_SKIPPED]);
    admin_ok();
}

admin_fail('unknown_action');
