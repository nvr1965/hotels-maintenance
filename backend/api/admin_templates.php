<?php
/* Шаблоны структуры отеля (только владелец системы): корпуса, этажи, номера, общие объекты.
 * Применяются при создании отеля (net_admin.php, hotel_save с template_id).
 *
 * GET  ?action=list                          — шаблоны со сводкой (корпусов, номеров, объектов)
 * POST ?action=save        {id?, name, structure}
 * POST ?action=delete      {id}
 * GET  ?action=from_hotel&hotel_id=          — структура готового отеля (чтобы сохранить как шаблон)
 * POST ?action=preview     {structure}        — сколько номеров и объектов получится, первые номера каждого корпуса
 */
require_once __DIR__ . '/../core/api.php';

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
if ($me['is_superadmin'] !== 1) app_json_fail(403, 'forbidden');
$action = $_GET['action'] ?? 'list';
if (!in_array($action, ['list', 'from_hotel'], true)) api_require_post();
$in = api_input();

function tpl_summary(array $s): array
{
    $assets = tpl_assets($s);
    $rooms = array_filter($assets, fn($a) => preg_match('/^[0-9]+$/', $a[2]));
    $sample = [];
    foreach ($s['buildings'] as $b) {
        $keys = array_column(array_filter($rooms, fn($a) => $a[0] === $b['name']), 2);
        $sample[] = ['building' => $b['name'], 'first' => array_slice($keys, 0, 3), 'last' => $keys ? end($keys) : null];
    }
    return ['buildings' => count($s['buildings']), 'rooms' => count($rooms), 'common' => count($assets) - count($rooms), 'sample' => $sample];
}

if ($action === 'list') {
    $items = [];
    foreach (db_all("SELECT id, name, structure, updated_at FROM hotel_templates ORDER BY name, id") as $r) {
        $s = db_json($r['structure']);
        $items[] = ['id' => (int)$r['id'], 'name' => $r['name'], 'structure' => $s, 'summary' => tpl_summary($s), 'updated_at' => $r['updated_at']];
    }
    $hotels = array_map(fn($h) => ['id' => (int)$h['id'], 'name' => $h['name']], db_all("SELECT id, name FROM hotels ORDER BY name"));
    api_ok(['items' => $items, 'hotels' => $hotels]);
}

if ($action === 'preview') {
    api_ok(['summary' => tpl_summary(tpl_normalize($in['structure'] ?? null))]);
}

if ($action === 'from_hotel') {
    $hotelId = (int)($_GET['hotel_id'] ?? 0);
    $h = db_one("SELECT name FROM hotels WHERE id = ?", [$hotelId]);
    if (!$h) api_fail('not_found');
    api_ok(['name' => $h['name'], 'structure' => tpl_from_hotel($hotelId)]);
}

if ($action === 'save') {
    $id = (int)($in['id'] ?? 0);
    $before = $id ? db_one("SELECT * FROM hotel_templates WHERE id = ?", [$id]) : null;
    if ($id && !$before) api_fail('not_found');
    $name = clean_text($in['name'] ?? '', 100);
    if ($name === '') api_fail('name_required');
    $st = tpl_normalize($in['structure'] ?? null);
    // У общего объекта нужно английское название: по нему объект связан со справочником названий отеля
    foreach ($st['common'] as &$c) {
        if (!isset($c['names']['en'])) {
            $src = isset($c['names'][$me['lang']]) ? $me['lang'] : array_key_first($c['names']);
            $c['names'] = i18n_complete($c['names'], ['en'], $src);
        }
    }
    unset($c);
    $s = json_encode($st, JSON_UNESCAPED_UNICODE);
    if ($before) {
        db_exec("UPDATE hotel_templates SET name = ?, structure = ?, updated_at = now() WHERE id = ?", [$name, $s, $id]);
        audit($me, 'update', 'hotel_templates', $id, $before, db_one("SELECT * FROM hotel_templates WHERE id = ?", [$id]));
    } else {
        $id = (int)db_value("INSERT INTO hotel_templates (name, structure, created_by) VALUES (?, ?, ?) RETURNING id", [$name, $s, $me['id']]);
        audit($me, 'insert', 'hotel_templates', $id, null, db_one("SELECT * FROM hotel_templates WHERE id = ?", [$id]));
    }
    api_ok(['id' => $id]);
}

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    $before = db_one("SELECT * FROM hotel_templates WHERE id = ?", [$id]);
    if (!$before) api_fail('not_found');
    db_exec("DELETE FROM hotel_templates WHERE id = ?", [$id]);
    audit($me, 'delete', 'hotel_templates', $id, $before, null);
    api_ok();
}

api_fail('bad_action');
