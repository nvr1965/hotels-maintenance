<?php
/* Службы отеля (hotel_departments): обслуживание здания, уборка номеров, кухня…
 * У каждого сотрудника одна основная служба (hotel_members.department_id);
 * у тех, кто работает в нескольких, остальные — в member_departments.
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/translate.php';

const DEP_DEFAULT_NAMES = ['en' => 'Building maintenance', 'ru' => 'Обслуживание здания', 'he' => 'תחזוקת מבנה', 'ar' => 'صيانة المبنى'];

/** Новому отелю — служба «Обслуживание здания» (схема базы больше не будет заводить её сама). */
function dep_create_default(int $hotelId): int
{
    $id = (int)db_value("INSERT INTO hotel_departments (hotel_id, names, icon, sort_order) VALUES (?, ?, '🛠️', 1) RETURNING id",
        [$hotelId, json_encode(DEP_DEFAULT_NAMES, JSON_UNESCAPED_UNICODE)]);
    dep_mark_init($hotelId);
    return $id;
}

function dep_mark_init(int $hotelId): void
{
    db_exec("UPDATE hotels SET settings = settings || '{\"departments_init\": true}' WHERE id = ?", [$hotelId]);
}

/** Скопировать службы отеля; возвращает [старый id => новый id]. */
function dep_copy(int $fromHotel, int $toHotel): array
{
    $map = [];
    foreach (db_all("SELECT * FROM hotel_departments WHERE hotel_id = ? ORDER BY sort_order, id", [$fromHotel]) as $d) {
        $map[(int)$d['id']] = (int)db_value("INSERT INTO hotel_departments (hotel_id, names, icon, color, sort_order, active)
                                             VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            [$toHotel, $d['names'], $d['icon'], $d['color'], $d['sort_order'], $d['active']]);
    }
    dep_mark_init($toHotel);
    return $map;
}

/** Службы отеля по порядку: [{id, name, icon, color, active}] на языке $lang. */
function dep_list(int $hotelId, string $lang, bool $activeOnly = true): array
{
    $out = [];
    foreach (db_all("SELECT * FROM hotel_departments WHERE hotel_id = ?" . ($activeOnly ? " AND active" : "") . " ORDER BY sort_order, id", [$hotelId]) as $d) {
        $out[] = ['id' => (int)$d['id'], 'name' => i18n_pick($d['names'], $lang), 'icon' => $d['icon'], 'color' => $d['color'], 'active' => (bool)$d['active']];
    }
    return $out;
}
