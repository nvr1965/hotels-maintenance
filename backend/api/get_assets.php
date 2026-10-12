<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];

header('Content-Type: application/json; charset=utf-8');

$lang = isset($_GET['lang']) ? $_GET['lang'] : 'ru';
if (!in_array($lang, ['ru', 'en', 'he', 'ar'])) {
    $lang = 'ru';
}
$langEsc = $db->real_escape_string($lang);

// Словарь для локализации служебных подписей
$labels = [
    'ru' => ['bldg' => 'Корпус', 'floor' => 'Этаж'],
    'en' => ['bldg' => 'Bldg', 'floor' => 'Floor'],
    'he' => ['bldg' => 'בניין', 'floor' => 'קומה'],
    'ar' => ['bldg' => 'مبنى', 'floor' => 'طابق']
];

$lblBldg = $labels[$lang]['bldg'];
$lblFloor = $labels[$lang]['floor'];

// Запрос с соединением таблицы переводов asset_dictionary по английскому ключу объекта
$query = "
    SELECT a.id, a.building, a.floor, a.asset_key, 
           COALESCE(d.term_$langEsc, d.term_ru, a.asset_key, CONCAT('Объект #', a.id)) as asset_name
    FROM hotel_assets a
    LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND a.asset_key = d.term_en
    WHERE a.hotel_id = $hid
    ORDER BY a.id ASC
";

$res = $db->query($query);

$locations = [];
if ($res) {
    while ($row = $res->fetch_assoc()) {
        $name = $row['asset_name'];
        $building = $row['building'] ?? '';
        $floor = $row['floor'] ?? '';
        
        $label = $name;
        if ($building !== '' || $floor !== '') {
            $label .= " ({$lblBldg}: {$building}, {$lblFloor}: {$floor})";
        }

        // Номер гостиницы = чисто цифровой asset_key (то же правило, что в batch_planned.php)
        $isRoom = isset($row['asset_key']) && preg_match('/^[0-9]+$/', (string)$row['asset_key']);

        $locations[] = [
            'id' => $row['id'],
            'name' => $label,          // полное название, как раньше
            'short' => $name,          // без здания и этажа — для пошагового выбора
            'building' => (string)$building,
            'floor' => (string)$floor,
            'is_room' => $isRoom ? 1 : 0
        ];
    }
}

echo json_encode(['success' => true, 'locations' => $locations]);
exit;
?>