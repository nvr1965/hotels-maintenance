<?php
/* Админка → Справочники текущего отеля: регламентные работы, чек-лист номеров, названия объектов.
 * Название хранится в jsonb {язык: текст}; пустые языки отеля заполняются автопереводом при сохранении.
 * Для фронтенда название отдаётся ещё и полями name_xx (term_xx у объектов) по языкам отеля.
 *
 * GET  ?action=list&dict=routine|checklist|assets
 * POST ?action=save      {dict, key?, values: {name_xx|term_xx…, term_key?, requires_ocr?, ocr_type?}, src_lang?}
 *                        key — id (term_key для assets); без key — новая запись
 * POST ?action=delete    {dict, key, force?}
 * POST ?action=translate {text, from?}  → {translations: {язык: текст}} на все языки отеля
 */
require_once __DIR__ . '/../core/admin.php';
$me = admin_require();
$hid = $me['hotel_id'];
$langs = app_hotel_langs($me['hotel']);

$action = $_GET['action'] ?? 'list';
if ($action !== 'list') api_require_post();

$DICTS = [
    'routine'   => ['table' => 'routine_tasks', 'key' => 'id', 'prefix' => 'name_', 'extra' => ['requires_ocr', 'ocr_type']],
    'checklist' => ['table' => 'room_checklist_dict', 'key' => 'id', 'prefix' => 'name_', 'extra' => []],
    'assets'    => ['table' => 'asset_dictionary', 'key' => 'term_key', 'prefix' => 'term_', 'extra' => []],
];
const OCR_TYPES = ['water_m3', 'water_arad', 'gas_percent'];

/** Сколько записей в работе ссылается на элемент справочника. */
function dict_usage(string $dict, $key): int
{
    global $hid;
    if ($dict === 'routine') {
        return admin_count("SELECT (SELECT COUNT(*) FROM routine_schedule WHERE task_id = ?) + (SELECT COUNT(*) FROM routine_log WHERE task_id = ?)", [$key, $key]);
    }
    if ($dict === 'checklist') return admin_count("SELECT COUNT(*) FROM task_room_checks WHERE check_id = ?", [$key]);
    return admin_count("SELECT COUNT(*) FROM hotel_assets WHERE hotel_id = ? AND asset_key = ?", [$hid, $key]);
}

if ($action === 'translate') {
    $in = admin_input();
    $text = trim((string)($in['text'] ?? ''));
    if ($text === '') admin_fail('empty');
    $from = app_normalize_lang($in['from'] ?? $me['lang']);
    admin_ok(['translations' => i18n_complete([$from => $text], $langs, $from)]);
}

$in = $action === 'list' ? [] : admin_input();
$dictName = $action === 'list' ? ($_GET['dict'] ?? '') : (string)($in['dict'] ?? '');
if (!isset($DICTS[$dictName])) admin_fail('bad_dict');
$D = $DICTS[$dictName];
$table = $D['table'];
$keyCol = $D['key'];
$fields = array_merge($dictName === 'assets' ? ['term_key'] : [], array_map(fn($l) => $D['prefix'] . $l, $langs), $D['extra']);

function dict_load(string $table, string $keyCol, $key): ?array
{
    global $hid;
    return admin_fetch_one("SELECT * FROM " . admin_q($table) . " WHERE hotel_id = ? AND " . admin_q($keyCol) . "::text = ?", [$hid, (string)$key]);
}

if ($action === 'list') {
    $order = $keyCol === 'id' ? 'sort_order, id' : 'term_key';
    $items = [];
    foreach (admin_fetch_all("SELECT * FROM " . admin_q($table) . " WHERE hotel_id = ? ORDER BY $order", [$hid]) as $r) {
        $names = db_json($r['names']);
        $item = ['key' => $r[$keyCol], 'names' => (object)$names];
        if ($keyCol === 'id') $item['id'] = (int)$r['id'];
        else $item['term_key'] = $r['term_key'];
        foreach ($langs as $l) $item[$D['prefix'] . $l] = $names[$l] ?? '';
        if ($dictName === 'routine') {
            $item['requires_ocr'] = (int)$r['requires_ocr'];
            $item['ocr_type'] = $r['ocr_type'];
        }
        $item['usage'] = dict_usage($dictName, $r[$keyCol]);
        $items[] = $item;
    }
    admin_ok(['items' => $items, 'fields' => $fields, 'langs' => $langs, 'ocr_types' => OCR_TYPES]);
}

if ($action === 'save') {
    $vals = is_array($in['values'] ?? null) ? $in['values'] : [];
    $key = $in['key'] ?? null;
    $isNew = $key === null || $key === '';
    $before = $isNew ? null : dict_load($table, $keyCol, $key);
    if (!$isNew && !$before) admin_fail('not_found');

    // Названия: из values[name_xx] или values[names]; языки, которых нет в отеле, сохраняются как были
    $names = $before ? db_json($before['names']) : [];
    foreach (is_array($vals['names'] ?? null) ? $vals['names'] : [] as $l => $v) $names[$l] = trim((string)$v);
    foreach ($vals as $f => $v) {
        if (strpos($f, $D['prefix']) === 0 && $f !== 'term_key') $names[substr($f, strlen($D['prefix']))] = trim((string)$v);
    }
    $names = array_filter($names, fn($v) => $v !== '');
    if (!$names) admin_fail('name_required');
    $src = isset($in['src_lang']) ? app_normalize_lang($in['src_lang']) : (isset($names[$me['lang']]) ? $me['lang'] : null);
    $names = i18n_complete($names, $langs, $src);

    $data = ['names' => json_encode($names, JSON_UNESCAPED_UNICODE)];
    if ($dictName === 'assets') {
        // Объекты ссылаются на название по ключу; ключ по умолчанию — английское название
        $termKey = trim((string)($vals['term_key'] ?? $vals['term_en'] ?? $before['term_key'] ?? $names['en'] ?? ''));
        if ($termKey === '') admin_fail('key_required');
        if (preg_match('/^[0-9]+$/', $termKey)) admin_fail('key_digits');
        $data['term_key'] = $termKey;
    }
    if ($dictName === 'routine') {
        $data['requires_ocr'] = !empty($vals['requires_ocr'] ?? $before['requires_ocr'] ?? false);
        $ocrType = trim((string)($vals['ocr_type'] ?? $before['ocr_type'] ?? ''));
        if ($data['requires_ocr'] && $ocrType === '') admin_fail('ocr_type_required');
        $data['ocr_type'] = $data['requires_ocr'] ? $ocrType : null;
    }

    if ($isNew) {
        if ($dictName === 'assets' && dict_load($table, 'term_key', $data['term_key'])) admin_fail('key_taken');
        $data = ['hotel_id' => $hid] + $data;
        if ($keyCol === 'id') {
            $data['sort_order'] = admin_count("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM " . admin_q($table) . " WHERE hotel_id = ?", [$hid]);
        }
        $cols = array_keys($data);
        $newKey = db_value("INSERT INTO " . admin_q($table) . " (" . implode(', ', array_map('admin_q', $cols)) . ")
                            VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ") RETURNING " . admin_q($keyCol),
            array_values($data));
        if ($keyCol === 'id') $newKey = (int)$newKey;
        admin_audit($me, 'insert', $table, $newKey, null, dict_load($table, $keyCol, $newKey));
        admin_ok(['key' => $newKey]);
    }

    $renamed = $dictName === 'assets' && $data['term_key'] !== $before['term_key'];
    if ($renamed && dict_load($table, 'term_key', $data['term_key'])) admin_fail('key_taken');
    db_tx(function () use ($table, $keyCol, $data, $hid, $key, $renamed, $before) {
        $sets = implode(', ', array_map(fn($f) => admin_q($f) . ' = ?', array_keys($data)));
        admin_exec("UPDATE " . admin_q($table) . " SET $sets WHERE hotel_id = ? AND " . admin_q($keyCol) . "::text = ?",
            array_merge(array_values($data), [$hid, (string)$key]));
        if ($renamed) {
            admin_exec("UPDATE hotel_assets SET asset_key = ? WHERE hotel_id = ? AND asset_key = ?", [$data['term_key'], $hid, $before['term_key']]);
        }
    });
    $newKey = $renamed ? $data['term_key'] : ($keyCol === 'id' ? (int)$key : $key);
    admin_audit($me, 'update', $table, $key, $before, dict_load($table, $keyCol, $newKey));
    admin_ok(['key' => $newKey]);
}

if ($action === 'delete') {
    $key = $in['key'] ?? null;
    $before = dict_load($table, $keyCol, $key);
    if (!$before) admin_fail('not_found');
    $usage = dict_usage($dictName, $key);
    if ($usage > 0 && empty($in['force'])) admin_fail('in_use', ['usage' => $usage]);
    admin_exec("DELETE FROM " . admin_q($table) . " WHERE hotel_id = ? AND " . admin_q($keyCol) . "::text = ?", [$hid, (string)$key]);
    admin_audit($me, 'delete', $table, $key, $before, null);
    admin_ok();
}

admin_fail('bad_action');
