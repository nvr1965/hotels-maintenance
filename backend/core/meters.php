<?php
// Счётчики (регламентные задачи с распознаванием, routine_tasks.requires_ocr = 1):
// общий код для страницы загрузки фото, отчёта начальника и выгрузки в Excel.

// Накопительный счётчик (растёт всё время, расход = разница показаний) или уровень (газ в баке, давление)
function meter_kind(?string $ocrType): string
{
    return in_array($ocrType, ['water_m3', 'water_arad', 'electricity_kwh', 'counter'], true) ? 'counter' : 'level';
}

function meter_unit(?string $ocrType): string
{
    return match ($ocrType) {
        'gas_percent'     => '%',
        'water_m3', 'water_arad' => 'm³',
        'pressure_bar'    => 'bar',
        'electricity_kwh' => 'kWh',
        default           => '',
    };
}

// '33 620', '19902,21' → число; мусор → null
function meter_number($raw): ?float
{
    if ($raw === null) return null;
    $s = str_replace([' ', "\u{00A0}", ','], ['', '', '.'], trim((string)$raw));
    return is_numeric($s) ? (float)$s : null;
}

function app_valid_date(?string $d): ?string
{
    if (!$d || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) return null;
    [$y, $m, $day] = array_map('intval', explode('-', $d));
    return checkdate($m, $day, $y) ? $d : null;
}

// Все счётчики: [id => ['id','name','ocr_type','unit','kind']]
function meter_tasks(mysqli $db, int $hotelId, string $lang = 'ru'): array
{
    if (!in_array($lang, ['ru', 'en', 'he', 'ar'], true)) $lang = 'ru';
    $nameCol = 'name_' . $lang;
    $out = [];
    $res = $db->query("SELECT id, COALESCE(NULLIF($nameCol, ''), name_ru, 'Счётчик') AS name, ocr_type
                       FROM routine_tasks WHERE hotel_id = $hotelId AND requires_ocr = 1 ORDER BY sort_order ASC, id ASC");
    if ($res) {
        while ($r = $res->fetch_assoc()) {
            $out[(int)$r['id']] = [
                'id'       => (int)$r['id'],
                'name'     => $r['name'],
                'ocr_type' => $r['ocr_type'],
                'unit'     => meter_unit($r['ocr_type']),
                'kind'     => meter_kind($r['ocr_type']),
            ];
        }
    }
    return $out;
}

// Первое фото (не видео) из JSON поля media
function meter_photo($mediaJson): ?string
{
    $media = json_decode((string)$mediaJson, true);
    if (!is_array($media)) return null;
    foreach (array_reverse($media) as $it) {
        $url = is_array($it) ? ($it['url'] ?? '') : (string)$it;
        $type = is_array($it) ? ($it['type'] ?? '') : '';
        if ($url !== '' && $type !== 'video' && !preg_match('/\.(mp4|mov|webm)$/i', $url)) return $url;
    }
    return null;
}

// Все показания счётчика за даты [$from, $to] — несколько в сутки возможны.
// Источник — routine_log (каждое закрытие/загрузка со временем). Дни, где в истории показаний нет,
// а в routine_schedule есть (старые записи), берутся оттуда как одно показание в 12:00.
// Каждое: ['id' => 'l123'|'s45', 'date', 'time', 'at' => 'Y-m-d H:i', 'value', 'photo', 'notes']
function meter_readings(mysqli $db, int $taskId, string $from, string $to): array
{
    $fromEsc = $db->real_escape_string($from);
    $toEsc   = $db->real_escape_string($to);
    $out = [];
    $logDays = [];
    // Несколько записей истории на одну и ту же минуту — это повторная запись того же показания
    // (раньше «Записать в базу» на тот же день заменял значение): берём последнюю из них.
    $res = $db->query("SELECT id, target_date, closed_at, ocr_value, media, notes FROM routine_log
                       WHERE task_id = $taskId AND target_date BETWEEN '$fromEsc' AND '$toEsc' ORDER BY id ASC");
    $byAt = [];
    while ($res && $r = $res->fetch_assoc()) {
        $closed = (string)$r['closed_at'];
        $time = substr($closed, 0, 10) === $r['target_date'] ? substr($closed, 11, 5) : '12:00';
        $at = $r['target_date'] . ' ' . $time;
        if ($r['ocr_value'] === null || $r['ocr_value'] === '') {
            // запись без показания (например, удалённое) отменяет только показание с тем же временем
            if (isset($byAt[$at]) && str_contains((string)$r['notes'], 'удалено показание')) unset($byAt[$at]);
            continue;
        }
        $byAt[$at] = $r + ['time' => $time, 'at' => $at];
    }
    foreach ($byAt as $at => $r) {
        $v = meter_number($r['ocr_value']);
        if ($v === null) continue;
        $logDays[$r['target_date']] = true;
        $out[] = ['id' => 'l' . $r['id'], 'date' => $r['target_date'], 'time' => $r['time'], 'at' => $at,
                  'value' => $v, 'photo' => meter_photo($r['media']), 'notes' => $r['notes']];
    }
    $res = $db->query("SELECT id, target_date, ocr_value, media, notes FROM routine_schedule
                       WHERE task_id = $taskId AND target_date BETWEEN '$fromEsc' AND '$toEsc'
                         AND ocr_value IS NOT NULL AND ocr_value <> ''");
    while ($res && $r = $res->fetch_assoc()) {
        if (isset($logDays[$r['target_date']])) continue;
        $v = meter_number($r['ocr_value']);
        if ($v === null) continue;
        $out[] = ['id' => 's' . $r['id'], 'date' => $r['target_date'], 'time' => '12:00', 'at' => $r['target_date'] . ' 12:00',
                  'value' => $v, 'photo' => meter_photo($r['media']), 'notes' => $r['notes']];
    }
    // Одинаковое время — по порядку записи (id числом: 'l9' раньше 'l13')
    usort($out, fn($a, $b) => strcmp($a['at'], $b['at']) ?: ((int)substr($a['id'], 1) <=> (int)substr($b['id'], 1)));
    return $out;
}

// Последнее показание до даты $before (не включая)
function meter_reading_before(mysqli $db, int $taskId, string $before): ?array
{
    $b = $db->real_escape_string($before);
    $res = $db->query("SELECT MAX(d) AS d FROM (
                           SELECT MAX(target_date) d FROM routine_log WHERE task_id = $taskId AND target_date < '$b' AND ocr_value IS NOT NULL AND ocr_value <> ''
                           UNION ALL
                           SELECT MAX(target_date) d FROM routine_schedule WHERE task_id = $taskId AND target_date < '$b' AND ocr_value IS NOT NULL AND ocr_value <> ''
                       ) x");
    $d = $res ? ($res->fetch_assoc()['d'] ?? null) : null;
    if (!$d) return null;
    $list = meter_readings($db, $taskId, $d, $d);
    return $list ? end($list) : null;
}

// Если за день показание есть только в routine_schedule (старые записи без истории), переносим его в историю,
// чтобы новое показание того же дня его не скрыло. Возвращает id созданной записи истории или null.
function meter_materialize_day(mysqli $db, int $taskId, string $date): ?int
{
    $d = $db->real_escape_string($date);
    $res = $db->query("SELECT 1 FROM routine_log WHERE task_id = $taskId AND target_date = '$d' AND ocr_value IS NOT NULL AND ocr_value <> '' LIMIT 1");
    if ($res && $res->fetch_assoc()) return null;
    $res = $db->query("SELECT id, worker_id, ocr_value, ocr_unit, ocr_raw, media FROM routine_schedule
                       WHERE task_id = $taskId AND target_date = '$d' AND ocr_value IS NOT NULL AND ocr_value <> '' LIMIT 1");
    $s = $res ? $res->fetch_assoc() : null;
    if (!$s) return null;
    $st = $db->prepare("INSERT INTO routine_log (hotel_id, schedule_id, task_id, worker_id, target_date, status, notes, media, ocr_value, ocr_unit, ocr_raw, is_repeat, closed_at)
                        VALUES ((SELECT hotel_id FROM routine_tasks WHERE id = $taskId), ?, ?, ?, ?, 'done', '[из регламента]', ?, ?, ?, ?, 0, ?)");
    $sid = (int)$s['id']; $wid = $s['worker_id'] !== null ? (int)$s['worker_id'] : null; $at = "$date 12:00:00";
    $st->bind_param('iiissssss', $sid, $taskId, $wid, $date, $s['media'], $s['ocr_value'], $s['ocr_unit'], $s['ocr_raw'], $at);
    return $st->execute() ? (int)$db->insert_id : null;
}

// После правки показаний за день: в routine_schedule (одна строка в сутки — её читают регламент и приложение работников)
// кладём последнее за этот день показание из истории; нет показаний — значение очищаем.
function meter_sync_day(mysqli $db, int $taskId, string $date, string $unit, int $workerId, string $mark): void
{
    $d = $db->real_escape_string($date);
    $res = $db->query("SELECT ocr_value FROM routine_log WHERE task_id = $taskId AND target_date = '$d'
                         AND ocr_value IS NOT NULL AND ocr_value <> '' ORDER BY closed_at DESC, id DESC LIMIT 1");
    $last = $res ? ($res->fetch_assoc()['ocr_value'] ?? null) : null;
    $res = $db->query("SELECT id FROM routine_schedule WHERE task_id = $taskId AND target_date = '$d' LIMIT 1");
    $sid = $res ? ($res->fetch_assoc()['id'] ?? null) : null;
    if ($sid) {
        $st = $db->prepare("UPDATE routine_schedule SET ocr_value = ?, ocr_unit = ?" . ($last !== null ? ", status = 'done'" : '') . " WHERE id = ?");
        $u = $last !== null ? $unit : null;
        $st->bind_param('ssi', $last, $u, $sid);
        $st->execute();
    } elseif ($last !== null) {
        $st = $db->prepare("INSERT INTO routine_schedule (hotel_id, task_id, worker_id, target_date, status, notes, media, ocr_value, ocr_unit)
                            VALUES ((SELECT hotel_id FROM routine_tasks WHERE id = $taskId), ?, ?, ?, 'done', ?, '[]', ?, ?)");
        $st->bind_param('iissss', $taskId, $workerId, $date, $mark, $last, $unit);
        $st->execute();
        $newId = (int)$db->insert_id;
        $db->query("UPDATE routine_log SET schedule_id = $newId WHERE task_id = $taskId AND target_date = '$d' AND schedule_id IS NULL");
    }
}

// Отчёт за период по каждому счётчику: все показания (точки графика), расход по дням и итоги.
// Для счётчика (counter): delta — прирост с прошлого показания; расход раскладывается по дням пропорционально времени.
// Сомнительные показания (меньше последнего верного или выше следующего) помечаются anomaly и в расход не идут.
// Для уровня (level, газ): delta — изменение уровня; расход = сумма падений, пополнения считаются отдельно.
function meter_report(mysqli $db, array $meters, string $from, string $to): array
{
    $result = [];
    $days = (int)round((strtotime($to) - strtotime($from)) / 86400) + 1;
    $ts = fn(string $at) => strtotime($at . ':00');

    foreach ($meters as $id => $m) {
        $prev = meter_reading_before($db, (int)$id, $from);
        $base = $prev;
        $points = [];
        foreach (meter_readings($db, (int)$id, $from, $to) as $r) {
            $points[] = ['id' => $r['id'], 'date' => $r['date'], 'time' => $r['time'], 'at' => $r['at'], 'value' => $r['value'],
                         'delta' => null, 'per_day' => null, 'gap' => null, 'anomaly' => false, 'photo' => $r['photo']];
        }

        if ($m['kind'] === 'counter') {
            $good = $prev['value'] ?? null;
            $n = count($points);
            for ($i = 0; $i < $n; $i++) {
                $v = $points[$i]['value'];
                $next = $points[$i + 1]['value'] ?? null;
                $bad = ($good !== null && $v < $good) || ($next !== null && $v > $next && ($good === null || $next >= $good));
                $points[$i]['anomaly'] = $bad;
                if (!$bad) $good = $v;
            }
        }

        $daily = [];   // date => ['value' => последнее за день, 'use' => расход/изменение за день]
        foreach ($points as $i => $p) {
            if ($p['anomaly']) continue;
            $daily[$p['date']]['value'] = $p['value'];
            if ($prev) {
                $gap = max(0, ($ts($p['at']) - $ts($prev['at'])) / 86400);
                $delta = round($p['value'] - $prev['value'], 3);
                $points[$i]['delta'] = $delta;
                $points[$i]['gap'] = round($gap, 3);
                if ($m['kind'] === 'counter') {
                    if ($gap >= 1) $points[$i]['per_day'] = round($delta / $gap, 3);
                    // Расход за промежуток раскладываем по календарным дням пропорционально времени
                    $t0 = $ts($prev['at']); $t1 = $ts($p['at']);
                    if ($t1 <= $t0) {
                        $daily[$p['date']]['use'] = ($daily[$p['date']]['use'] ?? 0) + $delta;
                    } else {
                        for ($dayStart = strtotime(date('Y-m-d', $t0)); $dayStart < $t1; $dayStart = strtotime('+1 day', $dayStart)) {
                            $dayEnd = strtotime('+1 day', $dayStart);
                            $overlap = min($t1, $dayEnd) - max($t0, $dayStart);
                            if ($overlap <= 0) continue;
                            $d = date('Y-m-d', $dayStart);
                            if ($d < $from || $d > $to) continue;
                            $daily[$d]['use'] = ($daily[$d]['use'] ?? 0) + $delta * $overlap / ($t1 - $t0);
                        }
                    }
                } else {
                    $daily[$p['date']]['use'] = ($daily[$p['date']]['use'] ?? 0) + $delta;
                }
            }
            $prev = ['at' => $p['at'], 'value' => $p['value']];
        }
        ksort($daily);
        $dailyList = [];
        foreach ($daily as $d => $x) {
            $dailyList[] = ['date' => $d, 'value' => $x['value'] ?? null, 'use' => isset($x['use']) ? round($x['use'], 3) : null];
        }

        $goodPts = array_values(array_filter($points, fn($p) => !$p['anomaly']));
        $values = array_column($goodPts, 'value');
        $stats = [
            'count' => count($points),
            'first' => $values ? reset($values) : null,
            'last'  => $values ? end($values) : null,
            'last_date' => $goodPts ? end($goodPts)['date'] : null,
            'last_time' => $goodPts ? end($goodPts)['time'] : null,
            'min'   => $values ? min($values) : null,
            'max'   => $values ? max($values) : null,
            'consumption' => null, 'avg_per_day' => null, 'refills' => 0, 'anomalies' => 0,
        ];
        if ($points) {
            $sum = 0.0;
            foreach ($points as $p) {
                if ($p['anomaly']) { $stats['anomalies']++; continue; }
                if ($p['delta'] === null) continue;
                if ($m['kind'] === 'counter') $sum += $p['delta'];
                elseif ($p['delta'] < 0) $sum += -$p['delta'];
                elseif ($p['delta'] > 0) $stats['refills']++;
            }
            $stats['consumption'] = round($sum, 2);
            // Средний расход в сутки: от показания, с которого начался отсчёт, до последнего
            $startAt = $base['at'] ?? ($goodPts[0]['at'] ?? null);
            $endAt = $goodPts ? end($goodPts)['at'] : null;
            if ($startAt && $endAt) {
                $span = ($ts($endAt) - $ts($startAt)) / 86400;
                if ($span >= 1) $stats['avg_per_day'] = round($sum / $span, 2);
            }
        }
        $result[] = $m + ['points' => $points, 'daily' => $dailyList, 'stats' => $stats];
    }
    return ['from' => $from, 'to' => $to, 'days' => $days, 'meters' => $result];
}

// ---------- Ссылка для начальника: отчёт по счётчикам без входа в систему ----------
// Ключ в ссылке даёт доступ ТОЛЬКО к отчёту и Excel по счётчикам (get_meter_report / export_meter_excel).
// Ссылки создаёт и отключает сисадмин на странице «📷 Счётчики» (meter_link.php).

function meter_links_table(mysqli $db): void
{
    // таблицу создаёт db/schema.sql
}

// Действующая ссылка по ключу или null (с hotel_id — отчёт только этого отеля)
function meter_link(mysqli $db, ?string $key): ?array
{
    if (!$key || !preg_match('/^[a-f0-9]{32}$/', $key)) return null;
    meter_links_table($db);
    $st = $db->prepare("SELECT l.id, l.label, l.lang, l.hotel_id, h.timezone FROM meter_report_links l
                        JOIN hotels h ON h.id = l.hotel_id AND h.active = 1
                        WHERE l.link_key = ? AND l.revoked = 0");
    $st->bind_param('s', $key);
    $st->execute();
    $row = $st->get_result()->fetch_assoc();
    if (!$row) return null;
    $db->query("UPDATE meter_report_links SET last_used_at = NOW() WHERE id = " . (int)$row['id']);
    return $row;
}

// Пускает по ключу из ссылки (?key=…) или вошедшего руководителя / администратора / наблюдателя сети.
// Возвращает id отеля, по которому строится отчёт.
function meter_require_access(mysqli $db): int
{
    $key = $_GET['key'] ?? null;
    if ($key !== null && $key !== '') {
        $link = meter_link($db, $key);
        if (!$link) app_json_fail(403, 'link_disabled');
        app_apply_timezone((string)$link['timezone']);
        return (int)$link['hotel_id'];
    }
    return app_require(['head', 'viewer'])['hotel_id'];
}
