<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require(['head', 'viewer']);
$hid = $me['hotel_id'];
require_once __DIR__ . '/../core/xlsx_writer.php';


// Готовые тексты на 4 языках; любой другой язык — английские в автопереводе
$lang = api_lang($me);
$rtl = ui_is_rtl($lang);

// ---- Переводы для шапки/статусов таблицы ----
$T = ui_dict([
    'ru' => ['sheet' => 'Регламент', 'log_sheet' => 'Журнал', 'date' => 'Дата', 'time' => 'Время', 'worker' => 'Исполнитель', 'value' => 'Показание', 'notes' => 'Примечание', 'photos' => 'Фото', 'repeat' => 'Повтор', 'wait' => 'ждёт администратора',  'num' => '№', 'name' => 'Название', 'counter' => 'Счётчик?', 'yes' => 'Да',
              'pending' => 'Не проверено', 'done' => 'Выполнено', 'chart_title' => 'График показаний',
              'no_gd' => 'Графики недоступны: в PHP на сервере не включено расширение GD (php.ini -> extension=gd -> перезапустить Apache)'],
    'en' => ['sheet' => 'Routine', 'log_sheet' => 'Log', 'date' => 'Date', 'time' => 'Time', 'worker' => 'Done by', 'value' => 'Reading', 'notes' => 'Notes', 'photos' => 'Photos', 'repeat' => 'Repeat', 'wait' => 'waiting for admin',  'num' => '#', 'name' => 'Name', 'counter' => 'Counter?', 'yes' => 'Yes',
              'pending' => 'Not checked', 'done' => 'Done', 'chart_title' => 'Reading history',
              'no_gd' => 'Charts unavailable: PHP GD extension is not enabled on the server (php.ini -> extension=gd -> restart the web server)'],
    'he' => ['sheet' => 'שגרה', 'log_sheet' => 'יומן', 'date' => 'תאריך', 'time' => 'שעה', 'worker' => 'בוצע על ידי', 'value' => 'קריאה', 'notes' => 'הערה', 'photos' => 'תמונות', 'repeat' => 'חזרה', 'wait' => 'ממתין למנהל',  'num' => '#', 'name' => 'שם', 'counter' => 'מונה?', 'yes' => 'כן',
              'pending' => 'לא נבדק', 'done' => 'בוצע', 'chart_title' => 'היסטוריית קריאות',
              'no_gd' => 'גרפים אינם זמינים: הרחבת GD של PHP אינה מופעלת בשרת (php.ini -> extension=gd -> הפעל מחדש את Apache)'],
    'ar' => ['sheet' => 'دوري', 'log_sheet' => 'السجل', 'date' => 'التاريخ', 'time' => 'الوقت', 'worker' => 'نفّذها', 'value' => 'القراءة', 'notes' => 'ملاحظة', 'photos' => 'صور', 'repeat' => 'تكرار', 'wait' => 'بانتظار المسؤول',  'num' => '#', 'name' => 'الاسم', 'counter' => 'عداد؟', 'yes' => 'نعم',
              'pending' => 'لم يُفحص', 'done' => 'منجز', 'chart_title' => 'سجل القراءات',
              'no_gd' => 'الرسوم البيانية غير متاحة: امتداد GD في PHP غير مفعّل على الخادم (php.ini -> extension=gd -> أعد تشغيل Apache)'],
], $lang);

// Период таблицы — N последних дней (по умолчанию 30, максимум 92)
$days = isset($_GET['days']) ? max(3, min(92, (int)$_GET['days'])) : 30;
$isDate = fn($s) => is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) && strtotime($s) !== false;
$to = $isDate($_GET['to'] ?? null) ? $_GET['to'] : date('Y-m-d');
if ($isDate($_GET['from'] ?? null)) {
    // Произвольный период «с … по …» (не больше 92 дней)
    $from = $_GET['from'];
    if ($from > $to) [$from, $to] = [$to, $from];
    if ((strtotime($to) - strtotime($from)) / 86400 > 91) $from = date('Y-m-d', strtotime($to . ' -91 days'));
} else {
    $from = date('Y-m-d', strtotime($to . " -" . ($days - 1) . " days"));
}
// ---- Задачи на языке пользователя ----
$tasks = [];
foreach (db_all("SELECT id, names, requires_ocr, ocr_type FROM routine_tasks WHERE hotel_id = ? ORDER BY sort_order, id", [$hid]) as $r) {
    $r['name'] = i18n_pick($r['names'], $lang);
    $tasks[(int)$r['id']] = $r;
}

// ---- Отметки/показания за период таблицы ----
$byTaskDate = [];
foreach (db_all("SELECT task_id, target_date::text AS target_date, status, ocr_value, ocr_unit
                 FROM routine_schedule WHERE hotel_id = ? AND target_date BETWEEN ? AND ?", [$hid, $from, $to]) as $r) {
    $byTaskDate[(int)$r['task_id']][$r['target_date']] = $r;
}

$dates = [];
$cursor = strtotime($from);
$end = strtotime($to);
while ($cursor <= $end) {
    $dates[] = date('Y-m-d', $cursor);
    $cursor = strtotime('+1 day', $cursor);
}

// ============================================================
// Рисуем PNG-график показаний счётчика через GD (без библиотек)
// ============================================================
function findUnicodeFont(): ?string
{
    // Типичные пути на Windows (XAMPP) — первый существующий и используем.
    // Tahoma/Arial поддерживают кириллицу, иврит и арабский в достаточном объёме.
    $candidates = [
        'C:\\Windows\\Fonts\\tahoma.ttf',
        'C:\\Windows\\Fonts\\arial.ttf',
        'C:\\Windows\\Fonts\\calibri.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', // на случай Linux-хостинга
    ];
    foreach ($candidates as $path) {
        if (is_file($path)) return $path;
    }
    return null;
}

function renderCounterChartPng(array $points, string $title, string $unit, bool $rtl): ?string
{
    // Если в PHP не включено расширение GD — графики просто пропускаем (таблица всё равно соберётся).
    // Включить: php.ini -> раскомментировать "extension=gd" -> перезапустить Apache.
    if (!function_exists('imagecreatetruecolor')) return null;

    // $points: [['date'=>'YYYY-MM-DD', 'value'=>float], ...] — только точки с реальным значением
    $points = array_values(array_filter($points, fn($p) => $p['value'] !== null));
    if (count($points) < 2) return null; // нечего рисовать

    $w = 640; $h = 280;
    $padL = 55; $padR = 20; $padT = 45; $padB = 45;

    $img = imagecreatetruecolor($w, $h);
    $white = imagecolorallocate($img, 255, 255, 255);
    $gray  = imagecolorallocate($img, 209, 213, 219);
    $dark  = imagecolorallocate($img, 31, 41, 55);
    $blue  = imagecolorallocate($img, 79, 70, 229);
    imagefill($img, 0, 0, $white);

    $values = array_column($points, 'value');
    $minV = min($values); $maxV = max($values);
    if ($minV === $maxV) { $minV -= 1; $maxV += 1; }

    $plotW = $w - $padL - $padR;
    $plotH = $h - $padT - $padB;
    $n = count($points);

    $xOf = fn($i) => $padL + ($n > 1 ? $i * $plotW / ($n - 1) : $plotW / 2);
    $yOf = fn($v) => $padT + $plotH - (($v - $minV) / ($maxV - $minV)) * $plotH;

    // Оси
    imageline($img, $padL, $padT + $plotH, $w - $padR, $padT + $plotH, $gray);
    imageline($img, $padL, $padT, $padL, $padT + $plotH, $gray);

    // Линия графика
    for ($i = 0; $i < $n - 1; $i++) {
        imageline($img, (int)$xOf($i), (int)$yOf($points[$i]['value']), (int)$xOf($i + 1), (int)$yOf($points[$i + 1]['value']), $blue);
    }
    foreach ($points as $i => $p) {
        $x = (int)$xOf($i); $y = (int)$yOf($p['value']);
        imagefilledellipse($img, $x, $y, 6, 6, $blue);
    }

    $font = findUnicodeFont();
    if ($font) {
        // Заголовок — справа для RTL-языков, слева для остальных
        $titleText = $title . ($unit ? " ($unit)" : '');
        $bbox = imagettfbbox(12, 0, $font, $titleText);
        $titleW = abs($bbox[2] - $bbox[0]);
        $titleX = $rtl ? ($w - $padR - $titleW) : $padL;
        imagettftext($img, 12, 0, $titleX, 22, $dark, $font, $titleText);

        // Подписи min/max по оси Y
        imagettftext($img, 9, 0, 5, (int)$yOf($maxV) + 4, $dark, $font, number_format($maxV, 1));
        imagettftext($img, 9, 0, 5, (int)$yOf($minV) + 4, $dark, $font, number_format($minV, 1));

        // Подписи дат по оси X (не чаще, чем раз в ~70px, чтобы не наслаивались)
        $step = max(1, (int)ceil(70 * ($n - 1) / max(1, $plotW)));
        for ($i = 0; $i < $n; $i += $step) {
            $label = substr($points[$i]['date'], 5); // MM-DD
            $bbox = imagettfbbox(8, 0, $font, $label);
            $lw = abs($bbox[2] - $bbox[0]);
            imagettftext($img, 8, 0, (int)$xOf($i) - (int)($lw / 2), $h - $padB + 20, $dark, $font, $label);
        }
    }

    ob_start();
    imagepng($img);
    $png = ob_get_clean();
    imagedestroy($img);
    return $png;
}

// ============================================================
// Собираем .xlsx
// ============================================================
$wb = new XlsxWriter();

$colWidths = array_merge([5, 30, 12], array_fill(0, count($dates), 11));
$sheet = $wb->addSheet($T['sheet'], $colWidths, $rtl);

$header = [$T['num'], $T['name'], $T['counter']];
foreach ($dates as $d) $header[] = $d;
$sheet->addRow($header, true);

$rowNum = 1;
foreach ($tasks as $tid => $t) {
    $row = [$rowNum++, $t['name'], !empty($t['requires_ocr']) ? $T['yes'] : ''];
    foreach ($dates as $d) {
        $cell = $byTaskDate[$tid][$d] ?? null;
        if (!$cell) { $row[] = ''; continue; }
        if ($cell['status'] === 'done') {
            $row[] = $cell['ocr_value'] !== null ? $cell['ocr_value'] . ' ' . ($cell['ocr_unit'] ?? '') : $T['done'];
        } elseif ($cell['status'] === 'pending') {
            $row[] = $T['pending'];
        } else {
            $row[] = (string)$cell['status'];
        }
    }
    $sheet->addRow($row);
}

// ---- Графики по каждому счётчику — отдельно от таблицы, более широкая ретроспектива (90 дней) ----
$chartFrom = min($from, date('Y-m-d', strtotime($to . ' -90 days')));

if (!function_exists('imagecreatetruecolor')) {
    $sheet->addRow([]);
    $sheet->addRow([$T['no_gd']]);
}

$nextImageRow = count($tasks) + 3; // отступ после таблицы
foreach ($tasks as $tid => $t) {
    if (empty($t['requires_ocr'])) continue;

    $points = [];
    foreach (db_all("SELECT target_date::text AS target_date, ocr_value FROM routine_schedule
                     WHERE task_id = ? AND target_date BETWEEN ? AND ? ORDER BY target_date", [$tid, $chartFrom, $to]) as $r) {
        $points[] = ['date' => $r['target_date'], 'value' => $r['ocr_value'] !== null ? (float)$r['ocr_value'] : null];
    }

    $unit = '';
    foreach ($dates as $d) { if (($byTaskDate[$tid][$d]['ocr_unit'] ?? null)) { $unit = $byTaskDate[$tid][$d]['ocr_unit']; break; } }

    $png = renderCounterChartPng($points, $t['name'], $unit, $rtl);
    if ($png !== null) {
        $sheet->addImage($png, $nextImageRow, 0, 640, 280);
        $nextImageRow += 16; // ~280px картинки ≈ высота ~16 стандартных строк — следующий график ниже без наложения
    }
}

// ---- Второй лист «Журнал»: каждое выполнение за период (кто, когда, примечание, показание) ----
{
    $logSheet = $wb->addSheet($T['log_sheet'], [12, 8, 30, 18, 14, 40, 7, 8], $rtl);
    $logSheet->addRow([$T['date'], $T['time'], $T['name'], $T['worker'], $T['value'], $T['notes'], $T['photos'], $T['repeat']], true);
    $log = db_all("SELECT l.task_id, l.target_date::text AS target_date, l.closed_at, l.notes, l.notes_lang, l.media,
                          l.ocr_value, l.ocr_unit, l.ocr_raw, l.is_repeat, w.display_name AS worker
                   FROM routine_log l LEFT JOIN users w ON w.id = l.worker_id
                   WHERE l.hotel_id = ? AND l.target_date BETWEEN ? AND ? AND l.status = 'done'
                   ORDER BY l.target_date, l.closed_at, l.id", [$hid, $from, $to]);
    foreach (i18n_free_rows($log, 'notes', 'notes_lang', $lang) as $r) {
        $media = json_decode($r['media'] ?? '[]', true);
        $value = ($r['ocr_value'] !== null && $r['ocr_value'] !== '') ? trim($r['ocr_value'] . ' ' . ($r['ocr_unit'] ?? ''))
               : ($r['ocr_raw'] === '[pending]' ? $T['wait'] : '');
        $logSheet->addRow([
            $r['target_date'], substr((string)$r['closed_at'], 11, 5),
            $tasks[(int)$r['task_id']]['name'] ?? ('#' . $r['task_id']),
            (string)($r['worker'] ?? ''), $value, (string)($r['notes'] ?? ''),
            is_array($media) && count($media) ? count($media) : '', !empty($r['is_repeat']) ? $T['yes'] : '',
        ]);
    }
}

$filename = 'routine_' . $lang . '_' . $from . '_' . $to . '.xlsx';
$tmpPath = tempnam(sys_get_temp_dir(), 'xlsx');
$wb->save($tmpPath);

header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Content-Length: ' . filesize($tmpPath));
readfile($tmpPath);
unlink($tmpPath);
exit;