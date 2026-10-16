<?php
/* Шаблоны структуры отеля: корпуса, этажи, номера, общие объекты на этажах.
 * Шаблон задаёт только начало: при создании отеля по нему заводятся объекты (hotel_assets),
 * дальше отель правится сам по себе, шаблон не меняется.
 *
 * structure (jsonb):
 *   numbering   'floor' — этаж + номер (101, 102… 201…), 'sequential' — сквозная в корпусе (1, 2, 3…)
 *   buildings   [{name, floor_from, floor_to, room_from, room_to, rooms_per_floor}]
 *               room_from..room_to — этажи с номерами (внутри floor_from..floor_to)
 *   common      [{names: {язык: текст}, where: 'all' | 'rooms'}] — общий объект на каждом этаже
 *               (all — на всех этажах корпуса, rooms — только на этажах с номерами)
 */
require_once __DIR__ . '/db.php';

const TPL_MAX_ASSETS = 5000;

/** Проверить и привести структуру к виду выше. Ошибка — api_fail с кодом. */
function tpl_normalize($s): array
{
    if (!is_array($s)) api_fail('bad_structure');
    $num = ($s['numbering'] ?? 'floor') === 'sequential' ? 'sequential' : 'floor';
    $buildings = [];
    foreach (is_array($s['buildings'] ?? null) ? $s['buildings'] : [] as $b) {
        $name = clean_text((string)($b['name'] ?? ''), 40);
        $ff = (int)($b['floor_from'] ?? 1);
        $ft = (int)($b['floor_to'] ?? $ff);
        if ($ft < $ff || $ff < -10 || $ft > 200) api_fail('bad_floors', ['building' => $name]);
        $rf = (int)($b['room_from'] ?? max($ff, 1));
        $rt = (int)($b['room_to'] ?? $ft);
        $per = (int)($b['rooms_per_floor'] ?? 0);
        if ($per < 0 || $per > 500) api_fail('bad_rooms', ['building' => $name]);
        if ($per > 0 && ($rf < $ff || $rt > $ft || $rt < $rf)) api_fail('bad_room_floors', ['building' => $name]);
        $buildings[] = ['name' => $name, 'floor_from' => $ff, 'floor_to' => $ft, 'room_from' => $rf, 'room_to' => $rt, 'rooms_per_floor' => $per];
    }
    if (!$buildings) api_fail('no_buildings');
    if (count(array_unique(array_column($buildings, 'name'))) !== count($buildings)) api_fail('building_names');
    $common = [];
    foreach (is_array($s['common'] ?? null) ? $s['common'] : [] as $c) {
        $names = [];
        foreach (is_array($c['names'] ?? null) ? $c['names'] : [] as $l => $v) {
            $v = clean_text((string)$v, 80);
            if ($v !== '') $names[(string)$l] = $v;
        }
        if (!$names) continue;
        $common[] = ['names' => $names, 'where' => ($c['where'] ?? 'all') === 'rooms' ? 'rooms' : 'all'];
    }
    $out = ['numbering' => $num, 'buildings' => $buildings, 'common' => $common];
    if (count(tpl_assets($out)) > TPL_MAX_ASSETS) api_fail('too_many_assets', ['max' => TPL_MAX_ASSETS]);
    return $out;
}

/** Номер комнаты: этаж + номер на этаже (101, 102… при 100 и больше номерах на этаже — 1001…),
 *  на нулевом и подземных этажах — просто 1, 2, 3…; сквозная — подряд по всему корпусу. */
function tpl_room_key(string $numbering, int $floor, int $n, int $per, int &$seq): string
{
    if ($numbering === 'sequential') return (string)(++$seq);
    return (string)($floor > 0 ? $floor * ($per >= 100 ? 1000 : 100) + $n : $n);
}

/** Ключ общего объекта (как term_key справочника названий): английское название или первое. */
function tpl_common_key(array $c): string
{
    return $c['names']['en'] ?? reset($c['names']);
}

/** Все объекты по шаблону: [[building, floor, asset_key], …] */
function tpl_assets(array $s): array
{
    $out = [];
    foreach ($s['buildings'] as $b) {
        $seq = 0;
        for ($f = $b['floor_from']; $f <= $b['floor_to']; $f++) {
            $roomsHere = $b['rooms_per_floor'] > 0 && $f >= $b['room_from'] && $f <= $b['room_to'];
            foreach ($s['common'] as $c) {
                if ($c['where'] === 'all' || $roomsHere) $out[] = [$b['name'], (string)$f, tpl_common_key($c)];
            }
            if (!$roomsHere) continue;
            for ($n = 1; $n <= $b['rooms_per_floor']; $n++) {
                $out[] = [$b['name'], (string)$f, tpl_room_key($s['numbering'], $f, $n, $b['rooms_per_floor'], $seq)];
            }
        }
    }
    return $out;
}

/** Завести объекты отеля по шаблону (существующие пропускаются). → ['rooms' => n, 'common' => n, 'skipped' => n] */
function tpl_apply(int $hotelId, array $s): array
{
    // Общие объекты — в справочник названий; недостающие языки отеля допишет i18n_fill_hotel
    foreach ($s['common'] as $c) {
        db_exec("INSERT INTO asset_dictionary (hotel_id, term_key, names) VALUES (?, ?, ?) ON CONFLICT (hotel_id, term_key) DO NOTHING",
            [$hotelId, tpl_common_key($c), json_encode($c['names'], JSON_UNESCAPED_UNICODE)]);
    }
    $have = [];
    foreach (db_all("SELECT COALESCE(building, '') AS b, COALESCE(floor, '') AS f, asset_key FROM hotel_assets WHERE hotel_id = ?", [$hotelId]) as $r) {
        $have[$r['b'] . "\0" . $r['f'] . "\0" . $r['asset_key']] = true;
    }
    $n = ['rooms' => 0, 'common' => 0, 'skipped' => 0];
    global $db;
    $ins = $db->prepare("INSERT INTO hotel_assets (hotel_id, building, floor, asset_key) VALUES (?, ?, ?, ?)");
    foreach (tpl_assets($s) as [$b, $f, $key]) {
        if (isset($have["$b\0$f\0$key"])) { $n['skipped']++; continue; }
        $ins->execute([$hotelId, $b, $f, $key]);
        $n[preg_match('/^[0-9]+$/', $key) ? 'rooms' : 'common']++;
    }
    return $n;
}

/** Шаблон по готовому отелю: корпуса и этажи как есть, номеров на этаже — сколько больше всего,
 *  общие объекты — те, что есть хотя бы на половине этажей корпуса. Дальше его можно поправить. */
function tpl_from_hotel(int $hotelId): array
{
    $rows = db_all("SELECT a.building, a.floor, a.asset_key, d.names FROM hotel_assets a
                    LEFT JOIN asset_dictionary d ON d.hotel_id = a.hotel_id AND d.term_key = a.asset_key
                    WHERE a.hotel_id = ? AND a.floor ~ '^-?[0-9]+$'", [$hotelId]);
    $byB = [];
    foreach ($rows as $r) $byB[(string)($r['building'] ?? '')][] = $r;
    ksort($byB, SORT_NATURAL);
    $buildings = [];
    $commonCount = [];
    $commonNames = [];
    $floorTotal = 0;
    $floorKeyed = 0;
    $floorMatch = 0;
    foreach ($byB as $bName => $list) {
        $floors = array_map(fn($r) => (int)$r['floor'], $list);
        $rooms = array_filter($list, fn($r) => preg_match('/^[0-9]+$/', $r['asset_key']));
        $perFloor = [];
        foreach ($rooms as $r) {
            $f = (int)$r['floor'];
            $perFloor[$f] = ($perFloor[$f] ?? 0) + 1;
            $floorKeyed++;
            if ($f > 0 && intdiv((int)$r['asset_key'], 100) === $f) $floorMatch++;
        }
        $nFloors = max($floors) - min($floors) + 1;
        $floorTotal += $nFloors;
        $seen = [];
        foreach ($list as $r) {
            if (preg_match('/^[0-9]+$/', $r['asset_key'])) continue;
            $seen[$r['asset_key']][(int)$r['floor']] = true;
            if ($r['names'] !== null) $commonNames[$r['asset_key']] = db_json($r['names']);
        }
        foreach ($seen as $k => $fl) if (count($fl) * 2 >= $nFloors) $commonCount[$k] = ($commonCount[$k] ?? 0) + 1;
        $buildings[] = [
            'name' => $bName, 'floor_from' => min($floors), 'floor_to' => max($floors),
            'room_from' => $perFloor ? min(array_keys($perFloor)) : max(1, min($floors)),
            'room_to' => $perFloor ? max(array_keys($perFloor)) : max($floors),
            'rooms_per_floor' => $perFloor ? max($perFloor) : 0,
        ];
    }
    $common = [];
    foreach (array_keys($commonCount) as $k) $common[] = ['names' => $commonNames[$k] ?? ['en' => $k], 'where' => 'all'];
    return [
        'numbering' => $floorKeyed && $floorMatch * 2 >= $floorKeyed ? 'floor' : 'sequential',
        'buildings' => $buildings ?: [['name' => '', 'floor_from' => 1, 'floor_to' => 1, 'room_from' => 1, 'room_to' => 1, 'rooms_per_floor' => 0]],
        'common' => $common,
    ];
}
