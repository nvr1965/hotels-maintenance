<?php
// Задачи работника: срочные, плановые (с чек-листом номера) и регламентные за сегодня.
// Тексты — на языке интерфейса, написанное людьми переводится на лету (оригинал в *_orig).
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];
$lang = api_lang($me);

$urgent = [];
$planned = [];
$routine = [];

// 1. Шаблон чек-листа номера
$checklistTemplate = [];
foreach (db_all("SELECT id, names FROM room_checklist_dict WHERE hotel_id = ? ORDER BY sort_order, id", [$hid]) as $d) {
    $checklistTemplate[] = ['id' => (int)$d['id'], 'text' => i18n_pick($d['names'], $lang), 'status' => 'pending'];
}

// 2. Открытые заявки отеля с именем автора
$rows = db_all("SELECT t.id, t.task_type, t.status, t.created_at, t.media, t.description, t.description_lang,
                       d.names AS loc_names, a.asset_key, a.building, a.floor, w.display_name AS author_name
                FROM maintenance_tasks t
                LEFT JOIN hotel_assets a ON t.asset_id = a.id
                LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND a.asset_key = d.term_key
                LEFT JOIN users w ON t.user_id = w.id
                WHERE t.hotel_id = ? AND t.status NOT IN ('done', 'completed')
                ORDER BY t.created_at DESC", [$hid]);
$rows = i18n_rows_on_the_fly('maintenance_tasks', $rows, 'description', $lang);

foreach ($rows as $row) {
    $type = trim(strtolower($row['task_type'] ?? 'current'));
    if ($type === 'routine' || $type === 'regiment') continue; // регламенты — из routine_tasks, блок 3
    $assetKey = $row['asset_key'] ?? ui_t('object', $lang);
    $media = json_decode((string)$row['media'], true);
    $item = [
        'id' => (int)$row['id'],
        'status' => $row['status'] ?: 'pending',
        'created_at' => $row['created_at'],
        'description' => $row['description'] !== '' ? $row['description'] : ui_t('no_description', $lang),
        'description_orig' => $row['description_orig'],
        'building' => $row['building'] ?? '-',
        'floor' => $row['floor'] ?? '-',
    ];
    if ($type === 'planned') {
        $planned[] = $item + ['room_name' => $assetKey, 'checklist' => $checklistTemplate];
    } else {
        $urgent[] = $item + [
            'asset_key' => $assetKey,
            'location' => ($row['loc_names'] !== null ? i18n_pick($row['loc_names'], $lang) : '') ?: $assetKey,
            'author_name' => $row['author_name'] ?? '',
            'media' => is_array($media) ? $media : [],
        ];
    }
}

// 3. Регламентные задачи и отметки за сегодня (дата — в часовом поясе отеля)
$today = date('Y-m-d');

// Каждые сутки заводим на каждую регламентную задачу строку за сегодня; повторные вызовы дубликатов не создают
// (NOT EXISTS — чтобы не расходовать номера строк при каждом открытии списка)
db_exec("INSERT INTO routine_schedule (hotel_id, task_id, target_date, status)
         SELECT rt.hotel_id, rt.id, ?::date, 'pending' FROM routine_tasks rt
         WHERE rt.hotel_id = ? AND NOT EXISTS (SELECT 1 FROM routine_schedule rs WHERE rs.task_id = rt.id AND rs.target_date = ?::date)
         ON CONFLICT (task_id, target_date) DO NOTHING", [$today, $hid, $today]);

$rout = db_all("SELECT rt.id, rt.requires_ocr, rt.names,
                       rs.status AS sched_status, rs.notes, rs.notes_lang, rs.media AS sched_media,
                       rs.ocr_value AS sched_ocr_value, rs.ocr_unit AS sched_ocr_unit
                FROM routine_tasks rt
                LEFT JOIN routine_schedule rs ON rs.task_id = rt.id AND rs.target_date = ?
                WHERE rt.hotel_id = ?
                ORDER BY rt.requires_ocr DESC, rt.sort_order, rt.id", [$today, $hid]); // счётчики — наверху
$rout = i18n_free_rows($rout, 'notes', 'notes_lang', $lang);

// Сколько фото счётчиков за сегодня ещё ждут распознавания администратором (отметка '[pending]')
$pendingToday = db_exec("SELECT task_id, COUNT(*) FROM routine_log
                         WHERE hotel_id = ? AND target_date = ? AND ocr_raw = '[pending]' GROUP BY task_id",
                        [$hid, $today])->fetchAll(PDO::FETCH_KEY_PAIR);

foreach ($rout as $row) {
    $media = json_decode((string)$row['sched_media'], true);
    $routine[] = [
        'id' => (int)$row['id'],
        'status' => ($row['sched_status'] ?? '') === 'done' ? 'done' : 'pending',
        'created_at' => $today,
        'description' => i18n_pick($row['names'], $lang) ?: ui_t('routine_task', $lang),
        'notes' => $row['notes'] ?? '',
        'notes_orig' => $row['notes_orig'] ?? null,
        'media' => is_array($media) ? $media : [],
        'requires_ocr' => (bool)$row['requires_ocr'],          // по фото распознаются показания
        'ocr_value' => $row['sched_ocr_value'],                // показание за сегодня, если уже есть
        'ocr_unit' => $row['sched_ocr_unit'] ?? '',
        'ocr_pending' => (int)($pendingToday[$row['id']] ?? 0), // фото, ждущие распознавания
    ];
}

// Сохранённый чек-лист каждой плановой задачи
if ($planned) {
    $byTask = [];
    $chk = db_all("SELECT trc.task_id, trc.check_id, d.names, trc.status
                   FROM task_room_checks trc
                   JOIN room_checklist_dict d ON d.id = trc.check_id
                   WHERE trc.task_id IN (" . sql_int_list(array_column($planned, 'id')) . ")
                   ORDER BY d.sort_order, d.id");
    foreach ($chk as $c) {
        $byTask[(int)$c['task_id']][] = ['id' => (int)$c['check_id'], 'text' => i18n_pick($c['names'], $lang), 'status' => $c['status']];
    }
    foreach ($planned as &$p) $p['checklist'] = $byTask[$p['id']] ?? $checklistTemplate;
    unset($p);
}

// Плановые — по зданию, затем по номеру (естественная сортировка)
usort($planned, function ($a, $b) {
    $bc = strnatcasecmp($a['building'] ?? '', $b['building'] ?? '');
    return $bc !== 0 ? $bc : strnatcmp((string)$a['room_name'], (string)$b['room_name']);
});

api_ok(['today' => $today, 'tasks' => ['urgent' => $urgent, 'planned' => $planned, 'routine' => $routine]]);
