<?php
/* Админка → Справочники текущего отеля: регламентные работы, чек-лист номеров, названия объектов.
 * Каждая запись — на 4 языках, есть автоперевод (backend/core/translator.php).
 *
 * GET  ?action=list&dict=routine|checklist|assets
 * POST ?action=save      {dict, key?, values: {...}}   key — id (или term_en для assets); без key — новая запись
 * POST ?action=delete    {dict, key, force?}
 * POST ?action=translate {text}  → {ru, en, he, ar}
 */
require_once __DIR__ . '/../core/admin.php';
$me = admin_require();
$hid = $me['hotel_id'];

$action = $_GET['action'] ?? 'list';
if ($action !== 'list') api_require_post();

// Описание справочников. Поля, которых нет в базе, просто пропускаются.
$DICTS = [
    'routine' => [
        'table' => 'routine_tasks', 'key' => 'id',
        'fields' => ['name_ru', 'name_en', 'name_he', 'name_ar', 'requires_ocr', 'ocr_type'],
        'order' => 'sort_order ASC, id ASC',
    ],
    'checklist' => [
        'table' => 'room_checklist_dict', 'key' => 'id',
        'fields' => ['name_ru', 'name_en', 'name_he', 'name_ar'],
        'order' => 'sort_order ASC, id ASC',
    ],
    'assets' => [
        'table' => 'asset_dictionary', 'key' => 'term_en',
        'fields' => ['term_en', 'term_ru', 'term_he', 'term_ar'],
        'order' => 'term_en ASC',
    ],
];
const OCR_TYPES = ['water_m3', 'water_arad', 'gas_percent'];

/** Сколько записей в работе ссылается на элемент справочника. */
function dict_usage(string $dict, $key): int
{
    global $hid;
    $n = 0;
    if ($dict === 'routine') {
        // id регламента принадлежит одному отелю, отдельная проверка отеля не нужна
        foreach (['routine_schedule', 'routine_log'] as $t) $n += admin_count("SELECT COUNT(*) FROM `$t` WHERE task_id = ?", [$key]);
    } elseif ($dict === 'checklist') {
        $n += admin_count("SELECT COUNT(*) FROM task_room_checks WHERE check_id = ?", [$key]);
    } elseif ($dict === 'assets') {
        $n += admin_count("SELECT COUNT(*) FROM hotel_assets WHERE hotel_id = ? AND asset_key = ?", [$hid, $key]);
    }
    return $n;
}

if ($action === 'translate') {
    $in = admin_input();
    $text = trim((string)($in['text'] ?? ''));
    if ($text === '') admin_fail('empty');
    require_once __DIR__ . '/../core/translator.php';
    $tr = (new Translator())->translateToAll($text);
    admin_ok(['translations' => $tr]);
}

$dictName = $_GET['dict'] ?? '';
$in = $action === 'list' ? [] : admin_input();
if ($action !== 'list') $dictName = (string)($in['dict'] ?? '');
if (!isset($DICTS[$dictName])) admin_fail('bad_dict');
$D = $DICTS[$dictName];

$cols = admin_columns($D['table']);
$fields = array_values(array_filter($D['fields'], fn($f) => isset($cols[$f])));
$keyCol = $D['key'];
$table = $D['table'];

function dict_load(string $table, string $keyCol, $key): ?array
{
    global $hid;
    return admin_fetch_one("SELECT * FROM " . admin_q($table) . " WHERE hotel_id = ? AND " . admin_q($keyCol) . " = ?", [$hid, $key]);
}

if ($action === 'list') {
    $rows = admin_fetch_all("SELECT * FROM " . admin_q($table) . " WHERE hotel_id = ? ORDER BY " . $D['order'], [$hid]);
    $items = [];
    foreach ($rows as $r) {
        $item = ['key' => $r[$keyCol]];
        foreach ($fields as $f) $item[$f] = $r[$f];
        if ($keyCol === 'id') $item['id'] = (int)$r['id'];
        $item['usage'] = dict_usage($dictName, $r[$keyCol]);
        $items[] = $item;
    }
    admin_ok(['items' => $items, 'fields' => $fields, 'ocr_types' => OCR_TYPES]);
}

if ($action === 'save') {
    $vals = is_array($in['values'] ?? null) ? $in['values'] : [];
    $key = $in['key'] ?? null;
    $data = [];
    foreach ($fields as $f) {
        if (!array_key_exists($f, $vals)) continue;
        $v = $vals[$f];
        if ($f === 'requires_ocr') $v = !empty($v) ? 1 : 0;
        elseif ($f === 'ocr_type') {
            $v = trim((string)$v);
            if ($v === '') $v = null;
        } else $v = trim((string)$v);
        $data[$f] = $v;
    }

    // Хотя бы одно название, а у названий объектов обязателен английский ключ
    $nameFields = array_filter($fields, fn($f) => preg_match('/^(name|term)_/', $f));
    $hasName = false;
    foreach ($nameFields as $f) if (($data[$f] ?? '') !== '') $hasName = true;
    if (!$hasName) admin_fail('name_required');
    if ($dictName === 'assets') {
        if (($data['term_en'] ?? '') === '') admin_fail('key_required');
        if (preg_match('/^[0-9]+$/', $data['term_en'])) admin_fail('key_digits');
    }
    if (!empty($data['requires_ocr']) && isset($cols['ocr_type']) && empty($data['ocr_type'])) admin_fail('ocr_type_required');
    if (array_key_exists('ocr_type', $data) && empty($data['requires_ocr'])) $data['ocr_type'] = null;

    $isNew = $key === null || $key === '';
    if ($isNew) {
        if ($dictName === 'assets' && dict_load($table, 'term_en', $data['term_en'])) admin_fail('key_taken');
        $data = ['hotel_id' => $hid] + $data;
        if (isset($cols['sort_order'])) {
            $data['sort_order'] = (int)admin_count("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM " . admin_q($table) . " WHERE hotel_id = ?", [$hid]);
        }
        $names = array_keys($data);
        admin_exec("INSERT INTO " . admin_q($table) . " (" . implode(', ', array_map('admin_q', $names)) . ")
                    VALUES (" . implode(', ', array_fill(0, count($names), '?')) . ")",
            array_values($data));
        global $db;
        $newKey = $keyCol === 'id' ? (int)$db->insert_id : $data['term_en'];
        admin_audit($me, 'insert', $table, $newKey, null, dict_load($table, $keyCol, $newKey));
        admin_ok(['key' => $newKey]);
    }

    $before = dict_load($table, $keyCol, $key);
    if (!$before) admin_fail('not_found');
    $renamed = $dictName === 'assets' && $data['term_en'] !== $before['term_en'];
    if ($renamed && dict_load($table, 'term_en', $data['term_en'])) admin_fail('key_taken');

    $sets = [];
    $params = [];
    foreach ($data as $f => $v) {
        $sets[] = admin_q($f) . ' = ?';
        $params[] = $v;
    }
    $params[] = $hid;
    $params[] = $key;
    admin_exec("UPDATE " . admin_q($table) . " SET " . implode(', ', $sets) . " WHERE hotel_id = ? AND " . admin_q($keyCol) . " = ?", $params);

    // Объекты ссылаются на название по английскому ключу — переименовываем и у них
    if ($renamed) {
        admin_exec("UPDATE hotel_assets SET asset_key = ? WHERE hotel_id = ? AND asset_key = ?", [$data['term_en'], $hid, $before['term_en']]);
    }
    $newKey = $renamed ? $data['term_en'] : $key;
    admin_audit($me, 'update', $table, $key, $before, dict_load($table, $keyCol, $newKey));
    admin_ok(['key' => $newKey]);
}

if ($action === 'delete') {
    $key = $in['key'] ?? null;
    $before = dict_load($table, $keyCol, $key);
    if (!$before) admin_fail('not_found');
    $usage = dict_usage($dictName, $key);
    if ($usage > 0 && empty($in['force'])) admin_fail('in_use', ['usage' => $usage]);
    admin_exec("DELETE FROM " . admin_q($table) . " WHERE hotel_id = ? AND " . admin_q($keyCol) . " = ?", [$hid, $key]);
    admin_audit($me, 'delete', $table, $key, $before, null);
    admin_ok();
}

admin_fail('bad_action');
