<?php
// Объекты отеля для выбора места заявки: название на языке интерфейса, корпус и этаж
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];
$lang = api_lang($me);

$lblBldg = ui_t('bldg', $lang);
$lblFloor = ui_t('floor', $lang);

$locations = [];
foreach (db_all("SELECT a.id, a.building, a.floor, a.asset_key, d.names
                 FROM hotel_assets a
                 LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND a.asset_key = d.term_key
                 WHERE a.hotel_id = ? ORDER BY a.id ASC", [$hid]) as $row) {
    $name = ($row['names'] !== null ? i18n_pick($row['names'], $lang) : '') ?: ($row['asset_key'] ?: ui_t('object', $lang) . ' #' . $row['id']);
    $building = (string)($row['building'] ?? '');
    $floor = (string)($row['floor'] ?? '');
    $label = $name;
    if ($building !== '' || $floor !== '') $label .= " ({$lblBldg}: {$building}, {$lblFloor}: {$floor})";
    // Номер гостиницы = чисто цифровой asset_key
    $isRoom = preg_match('/^[0-9]+$/', (string)$row['asset_key']);
    $locations[] = [
        'id' => (int)$row['id'],
        'name' => $label,          // полное название
        'short' => $name,          // без здания и этажа — для пошагового выбора
        'building' => $building,
        'floor' => $floor,
        'is_room' => $isRoom ? 1 : 0,
    ];
}
api_ok(['locations' => $locations]);
