<?php
/* Отметка и комментарий к пункту чек-листа плановой заявки.
 * В Ramada этот файл работал без входа; здесь — только вошедшие и только заявки своего отеля.
 * POST task_id, check_id, status?, comment?
 */
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];
api_require_post();

$task_id = (int)($_POST['task_id'] ?? 0);
$check_id = (int)($_POST['check_id'] ?? 0);
if (!db_one("SELECT id FROM maintenance_tasks WHERE id = ? AND hotel_id = ?", [$task_id, $hid])) api_fail('not_found');

if (isset($_POST['status'])) {
    $status = (string)$_POST['status'];
    if (!in_array($status, ['pending', 'ok', 'defect', 'fixed'], true)) api_fail('bad_status');
    db_exec("UPDATE task_room_checks SET status = ? WHERE task_id = ? AND check_id = ?", [$status, $task_id, $check_id]);
}

if (isset($_POST['comment'])) {
    // Комментарий хранится на языке автора; другим он переводится при показе (перевод на лету)
    $text = trim((string)$_POST['comment']);
    db_exec("UPDATE task_room_checks SET comment = ?, comment_lang = ? WHERE task_id = ? AND check_id = ?",
        [$text === '' ? [] : [$me['lang'] => $text], $text === '' ? null : $me['lang'], $task_id, $check_id]);
}
api_ok();
