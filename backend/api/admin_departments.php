<?php
/* Админка → Службы текущего отеля: обслуживание здания, уборка номеров, кухни…
 * Название на языках отеля (пустые заполняются автопереводом), значок и цвет.
 *
 * GET  ?action=list                                  — службы и сколько в них сотрудников, открытых заявок, регламентов
 * POST ?action=save   {id?, names: {язык: текст}, icon?, color?, active?}   — без id новая служба
 * POST ?action=move   {id, dir: -1|1}                — выше или ниже в списке
 * POST ?action=delete {id}                           — только пустую; занятую можно выключить
 */
require_once __DIR__ . '/../core/admin.php';
$me = admin_require();
$hid = $me['hotel_id'];
$langs = app_hotel_langs($me['hotel']);

$action = $_GET['action'] ?? 'list';
if ($action !== 'list') api_require_post();
$in = $action === 'list' ? [] : admin_input();

function dep_load(int $id): ?array
{
    global $hid;
    return admin_fetch_one("SELECT * FROM hotel_departments WHERE id = ? AND hotel_id = ?", [$id, $hid]);
}

/** Что держит службу: сотрудники (основная и дополнительная служба), заявки, регламенты, пункты чек-листа. */
function dep_usage(int $id): array
{
    return [
        'staff' => admin_count("SELECT (SELECT COUNT(*) FROM hotel_members WHERE department_id = ? AND active)
                                     + (SELECT COUNT(*) FROM member_departments WHERE department_id = ?)", [$id, $id]),
        'open_tasks' => admin_count("SELECT COUNT(*) FROM maintenance_tasks WHERE department_id = ? AND status NOT IN ('done', 'completed')", [$id]),
        'tasks' => admin_count("SELECT COUNT(*) FROM maintenance_tasks WHERE department_id = ?", [$id]),
        'routine' => admin_count("SELECT COUNT(*) FROM routine_tasks WHERE department_id = ?", [$id]),
        'checklist' => admin_count("SELECT COUNT(*) FROM room_checklist_dict WHERE department_id = ?", [$id]),
    ];
}

if ($action === 'list') {
    $items = [];
    foreach (admin_fetch_all("SELECT * FROM hotel_departments WHERE hotel_id = ? ORDER BY sort_order, id", [$hid]) as $d) {
        $names = db_json($d['names']);
        $items[] = ['id' => (int)$d['id'], 'names' => (object)$names, 'icon' => $d['icon'], 'color' => $d['color'],
            'active' => (bool)$d['active'], 'usage' => dep_usage((int)$d['id'])];
    }
    admin_ok(['items' => $items, 'langs' => $langs]);
}

if ($action === 'save') {
    $id = (int)($in['id'] ?? 0);
    $before = $id ? dep_load($id) : null;
    if ($id && !$before) admin_fail('not_found');

    $names = $before ? db_json($before['names']) : [];
    foreach (is_array($in['names'] ?? null) ? $in['names'] : [] as $l => $v) $names[(string)$l] = clean_text((string)$v, 80);
    $names = array_filter($names, fn($v) => $v !== '');
    if (!$names) admin_fail('name_required');
    $src = isset($in['src_lang']) ? app_normalize_lang($in['src_lang']) : (isset($names[$me['lang']]) ? $me['lang'] : null);
    $names = i18n_complete($names, $langs, $src);

    $icon = trim((string)($in['icon'] ?? $before['icon'] ?? '🛠️'));
    if ($icon === '' || mb_strlen($icon) > 8) $icon = '🛠️';
    $color = (string)($in['color'] ?? $before['color'] ?? '#1f3a5f');
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) admin_fail('bad_color');
    $active = array_key_exists('active', $in) ? !empty($in['active']) : (bool)($before['active'] ?? true);
    $json = json_encode($names, JSON_UNESCAPED_UNICODE);

    if (!$before) {
        $order = admin_count("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hotel_departments WHERE hotel_id = ?", [$hid]);
        $id = (int)db_value("INSERT INTO hotel_departments (hotel_id, names, icon, color, sort_order, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            [$hid, $json, $icon, $color, $order, $active]);
        admin_audit($me, 'insert', 'hotel_departments', $id, null, dep_load($id));
        admin_ok(['id' => $id]);
    }
    admin_exec("UPDATE hotel_departments SET names = ?, icon = ?, color = ?, active = ? WHERE id = ? AND hotel_id = ?",
        [$json, $icon, $color, $active, $id, $hid]);
    admin_audit($me, 'update', 'hotel_departments', $id, $before, dep_load($id));
    admin_ok(['id' => $id]);
}

if ($action === 'move') {
    $id = (int)($in['id'] ?? 0);
    if (!dep_load($id)) admin_fail('not_found');
    $dir = (int)($in['dir'] ?? 0) < 0 ? -1 : 1;
    $ids = array_map('intval', array_column(admin_fetch_all("SELECT id FROM hotel_departments WHERE hotel_id = ? ORDER BY sort_order, id", [$hid]), 'id'));
    $i = array_search($id, $ids, true);
    $j = $i + $dir;
    if ($j >= 0 && $j < count($ids)) {
        [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        db_tx(function () use ($ids, $hid) {
            foreach ($ids as $n => $depId) admin_exec("UPDATE hotel_departments SET sort_order = ? WHERE id = ? AND hotel_id = ?", [$n + 1, $depId, $hid]);
        });
    }
    admin_ok();
}

if ($action === 'delete') {
    $id = (int)($in['id'] ?? 0);
    $before = dep_load($id);
    if (!$before) admin_fail('not_found');
    $u = dep_usage($id);
    // Удалить можно только пустую службу: у занятой пропали бы сотрудники и история заявок
    if ($u['staff'] + $u['tasks'] + $u['routine'] + $u['checklist'] > 0) admin_fail('dep_in_use', ['usage' => $u]);
    admin_exec("DELETE FROM hotel_departments WHERE id = ? AND hotel_id = ?", [$id, $hid]);
    admin_audit($me, 'delete', 'hotel_departments', $id, $before, null);
    admin_ok();
}

admin_fail('bad_action');
