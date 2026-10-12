<?php
// Отчёт по счётчикам для начальника: показания и расход за выбранный период (для графиков)
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&lang=ru[&key=… — ссылка для начальника без входа]
require_once __DIR__ . '/../core/api.php';
require_once __DIR__ . '/../core/meters.php';
$hid = meter_require_access($db);

header('Content-Type: application/json; charset=utf-8');

$lang = $_GET['lang'] ?? 'ru';
$to   = app_valid_date($_GET['to'] ?? null) ?? date('Y-m-d');
$from = app_valid_date($_GET['from'] ?? null) ?? date('Y-m-d', strtotime("$to -29 days"));
if ($from > $to) [$from, $to] = [$to, $from];
// Не больше двух лет за раз
if (strtotime($to) - strtotime($from) > 731 * 86400) $from = date('Y-m-d', strtotime("$to -730 days"));

$meters = meter_tasks($db, $hid, $lang);
echo json_encode(['success' => true] + meter_report($db, $meters, $from, $to), JSON_UNESCAPED_UNICODE);
