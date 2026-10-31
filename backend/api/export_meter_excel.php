<?php
// Выгрузка счётчиков в Excel: таблица показаний по дням, расход, итоги и настоящие диаграммы Excel.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&lang=xx[&key=… — ссылка для начальника без входа]
require_once __DIR__ . '/../core/api.php';
require_once __DIR__ . '/../core/meters.php';
$hid = meter_require_access($db);
require_once __DIR__ . '/../core/xlsx_chart_writer.php';

// Готовые тексты на 4 языках; любой другой язык — английские в автопереводе
$lang = api_lang();
$rtl = ui_is_rtl($lang);

$to   = app_valid_date($_GET['to'] ?? null) ?? date('Y-m-d');
$from = app_valid_date($_GET['from'] ?? null) ?? date('Y-m-d', strtotime("$to -29 days"));
if ($from > $to) [$from, $to] = [$to, $from];
if (strtotime($to) - strtotime($from) > 731 * 86400) $from = date('Y-m-d', strtotime("$to -730 days"));

$T = ui_dict([
    'ru' => ['reading' => 'Показание', 'months' => 'По месяцам', 'month_names' => ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'], 'skipped' => 'не в таблице и графиках', 'data' => 'Показания', 'charts' => 'Графики', 'summary' => 'Итоги', 'title' => 'Счётчики: показания и расход',
             'period' => 'Период', 'date' => 'Дата', 'per_day' => 'расход в сутки', 'change' => 'изменение',
             'meter' => 'Счётчик', 'unit' => 'Ед.', 'count' => 'Показаний', 'first' => 'Первое', 'last' => 'Последнее',
             'min' => 'Мин.', 'max' => 'Макс.', 'cons' => 'Расход за период', 'avg' => 'В среднем в сутки',
             'refills' => 'Пополнений', 'anom' => 'Сомнительных', 'cons_chart' => 'расход в сутки',
             'note' => 'Показание — последнее за день (все показания со временем — на листе «Все показания»). Расход в сутки — разница показаний, разложенная по дням пропорционально времени. Отрицательная разница (ошибка распознавания) в расход не идёт.', 'all' => 'Все показания', 'time' => 'Время',
             'none' => 'Нет счётчиков (регламентных задач с распознаванием).'],
    'en' => ['reading' => 'Reading', 'months' => 'By month', 'month_names' => ['January','February','March','April','May','June','July','August','September','October','November','December'], 'skipped' => 'left out of table and charts', 'data' => 'Readings', 'charts' => 'Charts', 'summary' => 'Summary', 'title' => 'Meters: readings and consumption',
             'period' => 'Period', 'date' => 'Date', 'per_day' => 'per day', 'change' => 'change',
             'meter' => 'Meter', 'unit' => 'Unit', 'count' => 'Readings', 'first' => 'First', 'last' => 'Last',
             'min' => 'Min', 'max' => 'Max', 'cons' => 'Consumption', 'avg' => 'Average per day',
             'refills' => 'Refills', 'anom' => 'Doubtful', 'cons_chart' => 'consumption per day',
             'note' => 'Reading = last of the day (every reading with its time is on the «All readings» sheet). Per day = difference between readings spread over the days between them. Negative differences (recognition errors) are excluded.', 'all' => 'All readings', 'time' => 'Time',
             'none' => 'No meters (routine tasks with recognition).'],
    'he' => ['reading' => 'קריאה', 'months' => 'לפי חודשים', 'month_names' => ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'], 'skipped' => 'לא נכללו בטבלה ובגרפים', 'data' => 'קריאות', 'charts' => 'גרפים', 'summary' => 'סיכום', 'title' => 'מונים: קריאות וצריכה',
             'period' => 'תקופה', 'date' => 'תאריך', 'per_day' => 'ליום', 'change' => 'שינוי',
             'meter' => 'מונה', 'unit' => 'יח׳', 'count' => 'קריאות', 'first' => 'ראשונה', 'last' => 'אחרונה',
             'min' => 'מינ׳', 'max' => 'מקס׳', 'cons' => 'צריכה בתקופה', 'avg' => 'ממוצע ליום',
             'refills' => 'מילויים', 'anom' => 'מפוקפקות', 'cons_chart' => 'צריכה ליום',
             'note' => 'קריאה = האחרונה ביום (כל הקריאות עם שעה — בגיליון «כל הקריאות»). צריכה ליום = הפרש הקריאות מחולק על פני הימים ביניהן. הפרש שלילי (שגיאת זיהוי) אינו נספר.', 'all' => 'כל הקריאות', 'time' => 'שעה',
             'none' => 'אין מונים.'],
    'ar' => ['reading' => 'القراءة', 'months' => 'حسب الشهر', 'month_names' => ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'], 'skipped' => 'غير مدرجة في الجدول والرسوم', 'data' => 'القراءات', 'charts' => 'الرسوم', 'summary' => 'الملخص', 'title' => 'العدادات: القراءات والاستهلاك',
             'period' => 'الفترة', 'date' => 'التاريخ', 'per_day' => 'يوميًا', 'change' => 'التغيير',
             'meter' => 'العداد', 'unit' => 'الوحدة', 'count' => 'القراءات', 'first' => 'الأولى', 'last' => 'الأخيرة',
             'min' => 'الأدنى', 'max' => 'الأعلى', 'cons' => 'الاستهلاك', 'avg' => 'المتوسط اليومي',
             'refills' => 'التعبئات', 'anom' => 'مشكوك فيها', 'cons_chart' => 'الاستهلاك اليومي',
             'note' => 'القراءة = آخر قراءة في اليوم (كل القراءات مع الوقت في ورقة «كل القراءات»). الاستهلاك اليومي = فرق القراءات موزعًا على الأيام بينها. الفرق السالب (خطأ في التعرف) لا يُحتسب.', 'all' => 'كل القراءات', 'time' => 'الوقت',
             'none' => 'لا توجد عدادات.'],
], $lang);

$report = meter_report($db, meter_tasks($db, $hid, $lang), $from, $to);
$meters = $report['meters'];

$dates = [];
for ($t = strtotime($from); $t <= strtotime($to); $t = strtotime('+1 day', $t)) $dates[] = date('Y-m-d', $t);
$dateRow = array_flip($dates);

$fmtDate = fn(string $d) => date('d.m.Y', strtotime($d));
$label = fn(array $m) => $m['name'] . ($m['unit'] ? " ({$m['unit']})" : '');

$wb = new XlsxChartBook();

// Значения по дням: последнее показание дня; расход за день (у счётчика — разложен по времени между показаниями)
$grid = [];
$doubtful = []; // сомнительные показания — в таблицу и графики не попадают, перечисляются под таблицей
foreach ($meters as $k => $m) {
    foreach ($m['points'] as $p) {
        if ($p['anomaly'] && isset($dateRow[$p['date']])) $doubtful[] = $m['name'] . ' ' . $fmtDate($p['date']) . ' ' . $p['time'] . ' = ' . $p['value'];
    }
    foreach ($m['daily'] as $x) {
        if (!isset($dateRow[$x['date']])) continue;
        if ($x['value'] !== null) $grid[$x['date']][$k]['value'] = $x['value'];
        if ($x['use'] !== null) $grid[$x['date']][$k]['use'] = $x['use'];
    }
}
$colors = ['844128', '7A5A30', '26875A', '371F20', 'B45309', '5D3A2E'];

// Масштаб оси Y: у накопительных счётчиков числа большие (33000) — показываем только нужный диапазон
$axis = function (array $m, array $vals): array {
    if ($m['unit'] === '%') return ['min' => 0, 'max' => 100];
    if (!$vals) return [];
    $lo = min($vals); $hi = max($vals);
    $pad = max(1, ($hi - $lo) * 0.08);
    $step = 10 ** max(0, floor(log10(max(1, $hi - $lo + 2 * $pad))) - 1);
    $min = floor(($lo - $pad) / $step) * $step;
    if ($min < 0 && $lo >= 0) $min = 0;
    return ['min' => $min, 'max' => ceil(($hi + $pad) / $step) * $step];
};

// ---------- Лист 1: по месяцам — даты в колонках, под каждым месяцем его графики ----------
$monthSheet = $wb->sheet($T['months'], array_merge([30], array_fill(0, 31, 7.5)), $rtl);
$monthSheet->fitWidth = true;
$monthSheet->row([[$T['title'], 'title']]);
$monthSheet->row([[$T['period'] . ': ' . $fmtDate($from) . ' — ' . $fmtDate($to), 'muted']]);
if (!$meters) $monthSheet->row([$T['none']]);
$months = [];
foreach ($dates as $d) $months[substr($d, 0, 7)][] = $d;
foreach ($meters ? $months : [] as $ym => $mDates) {
    $monthSheet->row([]);
    $monthSheet->row([[$T['month_names'][(int)substr($ym, 5, 2) - 1] . ' ' . substr($ym, 0, 4), 'title']]);
    $head = [[$T['meter'], 'head']];
    foreach ($mDates as $d) $head[] = [XlsxChartBook::excelDate($d), 'headdate'];
    $hr = $monthSheet->row($head);
    $lastCol = count($mDates);
    $rowsOf = [];
    foreach ($meters as $k => $m) {
        $cells = [[$label($m), 'label']];
        $useCells = [['   ' . ($m['kind'] === 'counter' ? $T['per_day'] : $T['change']) . ($m['unit'] ? ", {$m['unit']}" : ''), 'muted']];
        $vals = [];
        foreach ($mDates as $d) {
            $v = $grid[$d][$k]['value'] ?? null;
            $u = $grid[$d][$k]['use'] ?? null;
            if ($v !== null) $vals[] = (float)$v;
            $cells[] = $v === null ? null : (float)$v;
            $useCells[] = $u === null ? null : (float)round($u, 2);
        }
        $rowsOf[$k] = ['value' => $monthSheet->row($cells), 'use' => $monthSheet->row($useCells), 'vals' => $vals];
    }
    // Графики месяца: показания всех счётчиков в ряд, под ними — расход в сутки накопительных счётчиков
    $monthSheet->row([]);
    $chartRow = $monthSheet->row([]) + 1;
    $hasUse = false;
    foreach ($meters as $k => $m) {
        $col = 1 + $k * 10;
        $monthSheet->chart([
            'type' => 'line', 'title' => $label($m), 'data' => $monthSheet, 'color' => $colors[$k % count($colors)],
            'cat' => [$hr, 1, $hr, $lastCol], 'val' => [$rowsOf[$k]['value'], 1, $rowsOf[$k]['value'], $lastCol],
            'at' => [$chartRow, $col], 'size' => [10, 16],
        ] + $axis($m, $rowsOf[$k]['vals']));
        if ($m['kind'] === 'counter') {
            $hasUse = true;
            $monthSheet->chart([
                'type' => 'column', 'title' => $m['name'] . ': ' . $T['cons_chart'] . ($m['unit'] ? " ({$m['unit']})" : ''),
                'data' => $monthSheet, 'color' => 'CDAA7C',
                'cat' => [$hr, 1, $hr, $lastCol], 'val' => [$rowsOf[$k]['use'], 1, $rowsOf[$k]['use'], $lastCol],
                'at' => [$chartRow + 17, $col], 'size' => [10, 14],
            ]);
        }
    }
    // Пустые строки под графиками, чтобы следующий месяц начинался ниже
    $chartRows = $hasUse ? 32 : 17;
    for ($i = 0; $i < $chartRows; $i++) $monthSheet->row([]);
}
if ($doubtful) $monthSheet->row([[$T['anom'] . ' (' . $T['skipped'] . '): ' . implode('; ', $doubtful), 'muted']]);

// ---------- Лист 2: показания по дням (столбиком) ----------
$widths = [13];
foreach ($meters as $m) { $widths[] = 16; $widths[] = 14; }
$data = $wb->sheet($T['data'], $widths, $rtl);
$data->row([[$T['title'], 'title']]);
$data->row([[$T['period'] . ': ' . $fmtDate($from) . ' — ' . $fmtDate($to), 'muted']]);
$data->row([]);
$head = [[$T['date'], 'head']];
foreach ($meters as $m) {
    $head[] = [$label($m), 'head'];
    $head[] = [($m['kind'] === 'counter' ? $T['per_day'] : $T['change']) . ($m['unit'] ? ", {$m['unit']}" : ''), 'head'];
}
$headRow = $data->row($head);
$data->freezeRows = $headRow + 1;

$firstData = $headRow + 1;
foreach ($dates as $d) {
    $cells = [[XlsxChartBook::excelDate($d), 'date']];
    foreach ($meters as $k => $m) {
        $v = $grid[$d][$k]['value'] ?? null;
        $u = $grid[$d][$k]['use'] ?? null;
        $cells[] = $v === null ? null : (float)$v;
        $cells[] = $u === null ? null : (float)round($u, 2);
    }
    $data->row($cells);
}
$lastData = $firstData + count($dates) - 1;
$data->row([]);
$data->row([[$T['note'], 'muted']]);
if ($doubtful) $data->row([[$T['anom'] . ' (' . $T['skipped'] . '): ' . implode('; ', $doubtful), 'muted']]);

// ---------- Лист 3: диаграммы за весь период ----------
$charts = $wb->sheet($T['charts'], array_fill(0, 20, 9.5), $rtl);
if (!$meters) $charts->row([$T['none']]);
$row = 0;
foreach ($meters as $k => $m) {
    $valCol = 1 + $k * 2;
    $opt = [
        'type' => 'line', 'title' => $label($m), 'data' => $data, 'color' => $colors[$k % count($colors)],
        'cat' => [$firstData, 0, $lastData, 0], 'val' => [$firstData, $valCol, $lastData, $valCol],
        'at' => [$row, 0], 'size' => [10, 18],
    ] + $axis($m, array_column(array_filter($m['points'], fn($p) => !$p['anomaly'] && isset($dateRow[$p['date']])), 'value'));
    $charts->chart($opt);
    if ($m['kind'] === 'counter') {
        $charts->chart([
            'type' => 'column', 'title' => $m['name'] . ': ' . $T['cons_chart'] . ($m['unit'] ? " ({$m['unit']})" : ''),
            'data' => $data, 'color' => 'CDAA7C',
            'cat' => [$firstData, 0, $lastData, 0], 'val' => [$firstData, $valCol + 1, $lastData, $valCol + 1],
            'at' => [$row, 10], 'size' => [10, 18],
        ]);
    }
    $row += 19;
}

// ---------- Лист 4: итоги ----------
$sum = $wb->sheet($T['summary'], [28, 7, 11, 13, 13, 13, 13, 16, 16, 12, 13], $rtl);
$sum->row([[$T['title'], 'title']]);
$sum->row([[$T['period'] . ': ' . $fmtDate($from) . ' — ' . $fmtDate($to), 'muted']]);
$sum->row([]);
$sum->row(array_map(fn($h) => [$h, 'head'], [$T['meter'], $T['unit'], $T['count'], $T['first'], $T['last'], $T['min'], $T['max'], $T['cons'], $T['avg'], $T['refills'], $T['anom']]));
foreach ($meters as $m) {
    $st = $m['stats'];
    $f = fn($v) => $v === null ? null : (float)$v;
    $sum->row([$m['name'], $m['unit'], (int)$st['count'], $f($st['first']), $f($st['last']), $f($st['min']), $f($st['max']),
               $f($st['consumption']), $f($st['avg_per_day']), $m['kind'] === 'level' ? (int)$st['refills'] : null, (int)$st['anomalies']]);
}

// ---------- Лист 5: все показания со временем (по несколько в сутки) ----------
$allSheet = $wb->sheet($T['all'], [13, 8, 30, 14, 14, 40], $rtl);
$allSheet->row([[$T['all'], 'title']]);
$allSheet->row([[$T['period'] . ': ' . $fmtDate($from) . ' — ' . $fmtDate($to), 'muted']]);
$allSheet->row([]);
$allSheet->freezeRows = $allSheet->row(array_map(fn($h) => [$h, 'head'], [$T['date'], $T['time'], $T['meter'], $T['reading'], $T['change'], ''])) + 1;
$all = [];
foreach ($meters as $m) foreach ($m['points'] as $p) $all[] = [$p, $m];
usort($all, fn($a, $b) => strcmp($a[0]['at'], $b[0]['at']) ?: strcmp($a[1]['name'], $b[1]['name']));
foreach ($all as [$p, $m]) {
    $allSheet->row([[XlsxChartBook::excelDate($p['date']), 'date'], $p['time'], $label($m), (float)$p['value'],
                    $p['delta'] === null ? null : (float)$p['delta'], $p['anomaly'] ? [$T['anom'], 'muted'] : null]);
}

$tmp = tempnam(sys_get_temp_dir(), 'mtr');
if (!$wb->save($tmp)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Не удалось собрать Excel (нужно расширение PHP zip)';
    exit;
}
$fname = 'meters_' . $from . '_' . $to . '.xlsx';
header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header('Content-Disposition: attachment; filename="' . $fname . '"');
header('Content-Length: ' . filesize($tmp));
header('Cache-Control: no-store');
readfile($tmp);
@unlink($tmp);
