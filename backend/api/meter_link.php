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


function meter_link_list(): array
{
    global $hid;
    $out = [];
    foreach (db_all("SELECT id, link_key, label, lang, created_at, last_used_at FROM meter_report_links
                     WHERE hotel_id = ? AND NOT revoked ORDER BY id DESC", [$hid]) as $r) {
        $out[] = ['id' => (int)$r['id'], 'label' => $r['label'], 'lang' => $r['lang'], 'created_at' => $r['created_at'],
                  'last_used_at' => $r['last_used_at'], 'url' => meter_link_url($r['link_key'], $r['lang'])];
    }
    return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = api_input();
    $action = $in['action'] ?? '';
    if ($action === 'create') {
        $label = mb_substr(trim((string)($in['label'] ?? '')), 0, 100);
        // Язык отчёта: заданный, иначе основной язык отеля
        $lang = app_normalize_lang($in['lang'] ?? $me['hotel']['default_lang']);
        db_exec("INSERT INTO meter_report_links (hotel_id, link_key, label, lang, created_by) VALUES (?, ?, ?, ?, ?)",
            [$hid, bin2hex(random_bytes(16)), $label, $lang, $me['id']]);
    } elseif ($action === 'revoke') {
        db_exec("UPDATE meter_report_links SET revoked = true WHERE id = ? AND hotel_id = ?", [(int)($in['id'] ?? 0), $hid]);
    } else {
        app_json_fail(400, 'bad_action');
    }
}

api_ok(['links' => meter_link_list()]);
