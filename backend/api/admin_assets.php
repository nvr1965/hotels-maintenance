<?php
/* Админка → Объекты (таблица hotel_assets): номера и прочие объекты текущего отеля по корпусам и этажам.
 * Номер = asset_key из одних цифр; другой объект = английский ключ из справочника названий
 * (asset_dictionary.term_en), название на языке берётся оттуда.
 *
 * GET  ?action=list&lang=ru
 * POST ?action=save      {id?, building, floor, asset_key}
 * POST ?action=delete    {id, force?}
 * POST ?action=generate  {building, floor, from, to}   — номера с from по to, существующие пропускаются
 */
require_once __DIR__ . '/../core/admin.php';
$me = admin_require();
$hid = $me['hotel_id'];

$action = $_GET['action'] ?? 'list';
if ($action !== 'list') api_require_post();

function asset_load(int $id): ?array
{
    global $hid;
    return admin_fetch_one("SELECT * FROM hotel_assets WHERE id = ? AND hotel_id = ?", [$id, $hid]);
}

function asset_usage(int $id): int
{
    global $hid;
    return admin_count("SELECT COUNT(*) FROM maintenance_tasks WHERE asset_id = ? AND hotel_id = ?", [$id, $hid]);
}

function asset_exists(string $building, string $floor, string $key, int $exceptId = 0): bool
{
    global $hid;
    return admin_count("SELECT COUNT(*) FROM hotel_assets
                        WHERE hotel_id = ? AND COALESCE(building, '') = ? AND COALESCE(floor, '') = ? AND asset_key = ? AND id <> ?",
        [$hid, $building, $floor, $key, $exceptId]) > 0;
}

if ($action === 'list') {
    $lang = in_array($_GET['lang'] ?? '', ADMIN_LANGS, true) ? $_GET['lang'] : 'ru';
    $hasDict = true;
    $nameSql = "COALESCE(NULLIF(d.term_$lang, ''), NULLIF(d.term_ru, ''), a.asset_key)";
    $join = "LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND d.term_en = a.asset_key";
    $usage = [];
    foreach (admin_fetch_all("SELECT asset_id, COUNT(*) n FROM maintenance_tasks WHERE hotel_id = ? GROUP BY asset_id", [$hid]) as $u) {
        $usage[(int)$u['asset_id']] = (int)$u['n'];
    }
    $items = [];
    foreach (admin_fetch_all("SELECT a.id, a.building, a.floor, a.asset_key, $nameSql AS name
                              FROM hotel_assets a $join
                              WHERE a.hotel_id = ?
                              ORDER BY a.building ASC, CAST(a.floor AS SIGNED) ASC, a.floor ASC,
                                       (a.asset_key REGEXP '^[0-9]+$') ASC, CAST(a.asset_key AS UNSIGNED) ASC, a.asset_key ASC", [$hid]) as $r) {
        $items[] = [
            'id' => (int)$r['id'],
            'building' => (string)($r['building'] ?? ''),
            'floor' => (string)($r['floor'] ?? ''),
            'asset_key' => (string)$r['asset_key'],
            'name' => (string)$r['name'],
            'is_room' => preg_match('/^[0-9]+$/', (string)$r['asset_key']) ? 1 : 0,
            'usage' => $usage[(int)$r['id']] ?? 0,
        ];
    }
    $terms = [];
    if ($hasDict) {
        foreach (admin_fetch_all("SELECT term_en, COALESCE(NULLIF(term_$lang, ''), term_en) AS name FROM asset_dictionary WHERE hotel_id = ? ORDER BY name ASC", [$hid]) as $t) {
            $terms[] = ['key' => $t['term_en'], 'name' => $t['name']];
        }
    }
    admin_ok(['items' => $items, 'terms' => $terms]);
}

$in = admin_input();
$clean = fn($v) => trim(preg_replace('/\s+/u', ' ', (string)$v));

if ($action === 'save') {
    $id = (int)($in['id'] ?? 0);
    $building = $clean($in['building'] ?? '');
    $floor = $clean($in['floor'] ?? '');
    $key = $clean($in['asset_key'] ?? '');
    if ($key === '') admin_fail('key_required');
    if (asset_exists($building, $floor, $key, $id)) admin_fail('asset_exists');

    if ($id === 0) {
        admin_exec("INSERT INTO hotel_assets (hotel_id, building, floor, asset_key) VALUES (?, ?, ?, ?)", [$hid, $building, $floor, $key]);
        global $db;
        $newId = (int)$db->insert_id;
        admin_audit($me, 'insert', 'hotel_assets', $newId, null, asset_load($newId));
        admin_ok(['id' => $newId]);
    }
    $before = asset_load($id);
    if (!$before) admin_fail('not_found');
    admin_exec("UPDATE hotel_assets SET building = ?, floor = ?, asset_key = ? WHERE id = ? AND hotel_id = ?", [$building, $floor, $key, $id, $hid]);
    admin_audit($me, 'update', 'hotel_assets', $id, $before, asset_load($id));
    admin_ok();
}

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    $before = asset_load($id);
    if (!$before) admin_fail('not_found');
    $usage = asset_usage($id);
    if ($usage > 0 && empty($in['force'])) admin_fail('in_use', ['usage' => $usage]);
    admin_exec("DELETE FROM hotel_assets WHERE id = ? AND hotel_id = ?", [$id, $hid]);
    admin_audit($me, 'delete', 'hotel_assets', $id, $before, null);
    admin_ok();
}

if ($action === 'generate') {
    $building = $clean($in['building'] ?? '');
    $floor = $clean($in['floor'] ?? '');
    $from = (int)($in['from'] ?? 0);
    $to = (int)($in['to'] ?? 0);
    if ($from <= 0 || $to < $from) admin_fail('bad_range');
    if ($to - $from > 300) admin_fail('range_too_big');

    $added = [];
    $skipped = 0;
    for ($n = $from; $n <= $to; $n++) {
        $key = (string)$n;
        // Номер уникален в корпусе (этаж мог быть записан иначе)
        if (admin_count("SELECT COUNT(*) FROM hotel_assets WHERE hotel_id = ? AND COALESCE(building, '') = ? AND asset_key = ?", [$hid, $building, $key]) > 0) {
            $skipped++;
            continue;
        }
        admin_exec("INSERT INTO hotel_assets (hotel_id, building, floor, asset_key) VALUES (?, ?, ?, ?)", [$hid, $building, $floor, $key]);
        global $db;
        $added[] = (int)$db->insert_id;
    }
    if ($added) {
        admin_audit($me, 'generate', 'hotel_assets', "$building/$floor/$from-$to", null,
            ['building' => $building, 'floor' => $floor, 'from' => $from, 'to' => $to, 'ids' => $added]);
    }
    admin_ok(['added' => count($added), 'skipped' => $skipped]);
}

admin_fail('bad_action');
