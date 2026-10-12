<?php
/* Подписка телефона на уведомления о срочных заявках.
 *
 * GET                                   — публичный ключ VAPID и нужны ли уведомления этому пользователю
 * POST {action:"subscribe", subscription, silent}   — сохранить/обновить подписку этого устройства
 * POST {action:"unsubscribe", endpoint}              — убрать подписку (выход из приложения)
 */
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/push.php';

header('Content-Type: application/json; charset=utf-8');

$eligible = in_array($me['role'], push_roles($me['hotel']), true);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $keys = $eligible ? push_vapid_keys() : null;
    echo json_encode(['success' => true, 'eligible' => $eligible, 'publicKey' => $keys['public'] ?? null,
                      'count' => $eligible ? push_open_urgent_count($hid) : 0]);
    exit;
}

$in = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $in['action'] ?? '';

if ($action === 'unsubscribe') {
    $endpoint = (string)($in['endpoint'] ?? '');
    if ($endpoint !== '') push_delete_subscription($endpoint, $me['id']);
    echo json_encode(['success' => true]);
    exit;
}

if ($action === 'subscribe') {
    if (!$eligible) { echo json_encode(['success' => false, 'message' => 'not_needed']); exit; }
    $sub = $in['subscription'] ?? [];
    $endpoint = (string)($sub['endpoint'] ?? '');
    $p256dh = (string)($sub['keys']['p256dh'] ?? '');
    $auth = (string)($sub['keys']['auth'] ?? '');
    if (!preg_match('~^https://[^\s]+$~', $endpoint) || strlen($endpoint) > 2000
        || !preg_match('/^[A-Za-z0-9_-]{80,100}$/', $p256dh) || !preg_match('/^[A-Za-z0-9_-]{16,30}$/', $auth)) {
        echo json_encode(['success' => false, 'message' => 'bad_subscription']);
        exit;
    }
    push_save_subscription($me['id'], $endpoint, $p256dh, $auth, $me['lang'], !empty($in['silent']));
    echo json_encode(['success' => true]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'invalid_request']);
