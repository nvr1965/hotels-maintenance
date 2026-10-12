<?php
// Ссылки для начальника на отчёт по счётчикам (без входа в систему). Только для сисадмина.
//   GET                                   — список ссылок
//   POST JSON {action:'create', label, lang} — новая ссылка
//   POST JSON {action:'revoke', id}         — отключить ссылку (по ней больше ничего не откроется)
require_once __DIR__ . '/../core/api.php';
$me = app_require(null, true);
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/meters.php';

header('Content-Type: application/json; charset=utf-8');

function meter_link_url(string $key, string $lang): string
{
    $scheme = app_is_https() ? 'https' : 'http';
    $host = preg_replace('/[^\w.:-]/', '', $_SERVER['HTTP_HOST'] ?? 'localhost');
    return "$scheme://$host/react/?meters=$key&lang=$lang";
}


function meter_link_list(mysqli $db): array
{
    $out = [];
    global $hid;
    $res = $db->query("SELECT id, link_key, label, lang, created_at, last_used_at FROM meter_report_links WHERE hotel_id = $hid AND revoked = 0 ORDER BY id DESC");
    while ($res && $r = $res->fetch_assoc()) {
        $out[] = ['id' => (int)$r['id'], 'label' => $r['label'], 'lang' => $r['lang'], 'created_at' => $r['created_at'],
                  'last_used_at' => $r['last_used_at'], 'url' => meter_link_url($r['link_key'], $r['lang'])];
    }
    return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $in['action'] ?? '';
    if ($action === 'create') {
        $key = bin2hex(random_bytes(16));
        $label = mb_substr(trim((string)($in['label'] ?? '')), 0, 100);
        $lang = app_normalize_lang($in['lang'] ?? 'he');
        if (!isset($in['lang'])) $lang = 'he';
        $st = $db->prepare("INSERT INTO meter_report_links (hotel_id, link_key, label, lang, created_by) VALUES (?, ?, ?, ?, ?)");
        $uid = (int)$me['id'];
        $st->bind_param('isssi', $hid, $key, $label, $lang, $uid);
        if (!$st->execute()) app_json_fail(500, 'db_error');
    } elseif ($action === 'revoke') {
        $id = (int)($in['id'] ?? 0);
        $db->query("UPDATE meter_report_links SET revoked = 1 WHERE id = $id AND hotel_id = $hid");
    } else {
        app_json_fail(400, 'bad_action');
    }
}

echo json_encode(['success' => true, 'links' => meter_link_list($db)], JSON_UNESCAPED_UNICODE);
