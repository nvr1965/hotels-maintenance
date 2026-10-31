<?php
/* Каталог зон отеля: ресторан, бар, бассейн, спа, парковка…
 * key — английское название, оно же term_key справочника названий (asset_dictionary, kind = 'facility').
 * outdoor — обычно на территории, а не в корпусе (так предлагается по умолчанию).
 * Названия на базовых языках; на остальные языки отеля их допишет автоперевод (i18n_fill_hotel).
 */
require_once __DIR__ . '/db.php';

const FACILITY_GROUPS = ['food', 'leisure', 'service', 'technical'];

const FACILITIES = [
    // еда и напитки
    ['key' => 'Restaurant', 'icon' => '🍽️', 'group' => 'food', 'names' => ['en' => 'Restaurant', 'ru' => 'Ресторан', 'he' => 'מסעדה', 'ar' => 'مطعم']],
    ['key' => 'Bar', 'icon' => '🍸', 'group' => 'food', 'names' => ['en' => 'Bar', 'ru' => 'Бар', 'he' => 'בר', 'ar' => 'بار']],
    ['key' => 'Lobby bar', 'icon' => '☕', 'group' => 'food', 'names' => ['en' => 'Lobby bar', 'ru' => 'Лобби-бар', 'he' => 'בר לובי', 'ar' => 'بار الردهة']],
    ['key' => 'Pool bar', 'icon' => '🍹', 'group' => 'food', 'outdoor' => true, 'names' => ['en' => 'Pool bar', 'ru' => 'Бар у бассейна', 'he' => 'בר בריכה', 'ar' => 'بار المسبح']],
    ['key' => 'Breakfast room', 'icon' => '🥐', 'group' => 'food', 'names' => ['en' => 'Breakfast room', 'ru' => 'Зал для завтраков', 'he' => 'חדר ארוחת בוקר', 'ar' => 'قاعة الإفطار']],
    ['key' => 'Kitchen', 'icon' => '🍳', 'group' => 'food', 'names' => ['en' => 'Kitchen', 'ru' => 'Кухня', 'he' => 'מטבח', 'ar' => 'مطبخ']],
    // отдых
    ['key' => 'Swimming pool', 'icon' => '🏊', 'group' => 'leisure', 'outdoor' => true, 'names' => ['en' => 'Swimming pool', 'ru' => 'Бассейн', 'he' => 'בריכת שחייה', 'ar' => 'مسبح']],
    ['key' => 'Indoor pool', 'icon' => '🌊', 'group' => 'leisure', 'names' => ['en' => 'Indoor pool', 'ru' => 'Крытый бассейн', 'he' => 'בריכה מקורה', 'ar' => 'مسبح داخلي']],
    ['key' => 'Spa', 'icon' => '💆', 'group' => 'leisure', 'names' => ['en' => 'Spa', 'ru' => 'Спа', 'he' => 'ספא', 'ar' => 'سبا']],
    ['key' => 'Sauna', 'icon' => '🧖', 'group' => 'leisure', 'names' => ['en' => 'Sauna', 'ru' => 'Сауна', 'he' => 'סאונה', 'ar' => 'ساونا']],
    ['key' => 'Gym', 'icon' => '🏋️', 'group' => 'leisure', 'names' => ['en' => 'Gym', 'ru' => 'Спортзал', 'he' => 'חדר כושר', 'ar' => 'صالة رياضية']],
    ['key' => 'Kids club', 'icon' => '🧸', 'group' => 'leisure', 'names' => ['en' => 'Kids club', 'ru' => 'Детский клуб', 'he' => 'מועדון ילדים', 'ar' => 'نادي الأطفال']],
    ['key' => 'Playground', 'icon' => '🛝', 'group' => 'leisure', 'outdoor' => true, 'names' => ['en' => 'Playground', 'ru' => 'Детская площадка', 'he' => 'גן משחקים', 'ar' => 'ملعب أطفال']],
    ['key' => 'Beach', 'icon' => '🏖️', 'group' => 'leisure', 'outdoor' => true, 'names' => ['en' => 'Beach', 'ru' => 'Пляж', 'he' => 'חוף', 'ar' => 'شاطئ']],
    ['key' => 'Garden', 'icon' => '🌳', 'group' => 'leisure', 'outdoor' => true, 'names' => ['en' => 'Garden', 'ru' => 'Сад', 'he' => 'גינה', 'ar' => 'حديقة']],
    // обслуживание гостей
    ['key' => 'Reception', 'icon' => '🛎️', 'group' => 'service', 'names' => ['en' => 'Reception', 'ru' => 'Ресепшн', 'he' => 'קבלה', 'ar' => 'الاستقبال']],
    ['key' => 'Lobby', 'icon' => '🛋️', 'group' => 'service', 'names' => ['en' => 'Lobby', 'ru' => 'Лобби', 'he' => 'לובי', 'ar' => 'الردهة']],
    ['key' => 'Conference hall', 'icon' => '🎤', 'group' => 'service', 'names' => ['en' => 'Conference hall', 'ru' => 'Конференц-зал', 'he' => 'אולם כנסים', 'ar' => 'قاعة المؤتمرات']],
    ['key' => 'Parking', 'icon' => '🅿️', 'group' => 'service', 'outdoor' => true, 'names' => ['en' => 'Parking', 'ru' => 'Парковка', 'he' => 'חניון', 'ar' => 'موقف السيارات']],
    // хозяйство
    ['key' => 'Laundry', 'icon' => '🧺', 'group' => 'technical', 'names' => ['en' => 'Laundry', 'ru' => 'Прачечная', 'he' => 'מכבסה', 'ar' => 'مغسلة']],
    ['key' => 'Warehouse', 'icon' => '📦', 'group' => 'technical', 'names' => ['en' => 'Warehouse', 'ru' => 'Склад', 'he' => 'מחסן', 'ar' => 'مستودع']],
    ['key' => 'Boiler room', 'icon' => '🔥', 'group' => 'technical', 'names' => ['en' => 'Boiler room', 'ru' => 'Котельная', 'he' => 'חדר דוודים', 'ar' => 'غرفة المراجل']],
    ['key' => 'Electrical room', 'icon' => '⚡', 'group' => 'technical', 'names' => ['en' => 'Electrical room', 'ru' => 'Электрощитовая', 'he' => 'חדר חשמל', 'ar' => 'غرفة الكهرباء']],
    ['key' => 'Staff room', 'icon' => '👥', 'group' => 'technical', 'names' => ['en' => 'Staff room', 'ru' => 'Комната персонала', 'he' => 'חדר צוות', 'ar' => 'غرفة الموظفين']],
];

/** Значки, из которых выбирают значок своей зоны. */
const FACILITY_ICONS = ['📍', '🍽️', '🍸', '☕', '🍹', '🥐', '🍳', '🏊', '🌊', '💆', '🧖', '🏋️', '🧸', '🛝', '🏖️', '🌳',
    '🛎️', '🛋️', '🎤', '🅿️', '🧺', '📦', '🔥', '⚡', '👥', '⛪', '🎾', '⛳', '🎰', '🛍️', '💈', '🚗', '🛗', '❄️', '💧', '🗑️'];

/** Каталог для админки: название на языке $lang, группа, значок. */
function facility_catalog(string $lang): array
{
    return array_map(fn($f) => [
        'key' => $f['key'], 'icon' => $f['icon'], 'group' => $f['group'], 'outdoor' => !empty($f['outdoor']),
        'name' => i18n_pick($f['names'], $lang) ?: $f['key'], 'names' => $f['names'],
    ], FACILITIES);
}

function facility_find(string $key): ?array
{
    foreach (FACILITIES as $f) if ($f['key'] === $key) return $f;
    return null;
}

/** Значок — эмодзи без букв и цифр, не длиннее 16 байт; иначе null. */
function facility_icon($v): ?string
{
    $v = trim((string)$v);
    if ($v === '' || strlen($v) > 16 || preg_match('/[\p{L}\p{N}\s<>"\'&]/u', $v)) return null;
    return $v;
}

/** Завести зону в справочнике названий отеля (если её там нет) или пометить существующее название зоной.
 *  $names — {язык: текст}; ключ — английское название. → term_key */
function facility_ensure(int $hotelId, string $key, array $names, ?string $icon): string
{
    db_exec("INSERT INTO asset_dictionary (hotel_id, term_key, names, kind, icon) VALUES (?, ?, ?, 'facility', ?)
             ON CONFLICT (hotel_id, term_key) DO UPDATE SET kind = 'facility', icon = COALESCE(asset_dictionary.icon, EXCLUDED.icon)",
        [$hotelId, $key, json_encode($names, JSON_UNESCAPED_UNICODE), $icon]);
    return $key;
}
