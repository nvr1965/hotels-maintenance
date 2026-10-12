<?php
/* Перенос данных Ramada в hotelapp как первого отеля сети.
 *
 * Из базы ramada только читает (SELECT), в неё ничего не пишет.
 * id сотрудников, объектов, заявок, регламентов и истории сохраняются, поэтому все ссылки
 * между записями и адреса фото (/uploads/...) остаются прежними.
 *
 * Запуск (XAMPP, из папки сайта hotelapp):
 *   C:\xampp\php\php.exe tools\migrate_ramada.php --dry-run      — только проверка и отчёт
 *   C:\xampp\php\php.exe tools\migrate_ramada.php                — перенос в пустую базу hotelapp
 *   C:\xampp\php\php.exe tools\migrate_ramada.php --replace      — стереть hotelapp и перенести заново (свежие данные)
 *
 * Параметры (необязательные):
 *   --source=ramada --target=hotelapp       имена баз (сервер и пароль — из backend/core/config.local.php)
 *   --org-name="..." --org-slug=...         сеть (по умолчанию «Ramada», ramada)
 *   --hotel-name="..." --hotel-slug=...     отель (по умолчанию «Ramada Olivié Nazareth», ramada-nazareth)
 *   --superadmin=<логин или id>             сделать этого пользователя владельцем системы
 *   --with-push                             перенести подписки телефонов на уведомления (см. ИНСТРУКЦИЯ.md)
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);

$opt = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/', $a, $m)) $opt[$m[1]] = $m[2] ?? true;
    else fail("Непонятный параметр: $a");
}
$SRC = $opt['source'] ?? 'ramada';
$DST = $opt['target'] ?? 'hotelapp';
$DRY = isset($opt['dry-run']);
$REPLACE = isset($opt['replace']);
$WITH_PUSH = isset($opt['with-push']);
foreach ([$SRC, $DST] as $n) if (!preg_match('/^[A-Za-z0-9_]+$/', $n)) fail("Плохое имя базы: $n");
if ($SRC === $DST) fail('Исходная и новая база совпадают');

function out(string $s = ''): void { echo $s, PHP_EOL; }
function fail(string $s): void { fwrite(STDERR, "ОШИБКА: $s" . PHP_EOL); exit(1); }

require_once __DIR__ . '/../backend/core/config.php';
$c = app_config()['db'];
try {
    $db = new mysqli($c['host'], $c['user'], $c['pass']);
    $db->set_charset('utf8mb4');
} catch (mysqli_sql_exception $e) {
    fail('Нет связи с MySQL: ' . $e->getMessage());
}

function q(string $sql)
{
    global $db;
    return $db->query($sql);
}
function val(string $sql) { $r = q($sql)->fetch_row(); return $r[0] ?? null; }
function esc(string $s): string { global $db; return $db->real_escape_string($s); }

function table_exists(string $dbName, string $t): bool
{
    return (int)val("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '" . esc($dbName) . "' AND TABLE_NAME = '" . esc($t) . "'") > 0;
}
function columns(string $dbName, string $t): array
{
    $cols = [];
    $res = q("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '" . esc($dbName) . "' AND TABLE_NAME = '" . esc($t) . "' ORDER BY ORDINAL_POSITION");
    while ($r = $res->fetch_row()) $cols[] = $r[0];
    return $cols;
}

// ---------------------------------------------------------------- проверки

if ((int)val("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '" . esc($SRC) . "'") === 0) fail("Нет базы $SRC");
if ((int)val("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '" . esc($DST) . "'") === 0
    || !table_exists($DST, 'hotels')) fail("Нет базы $DST или в ней нет таблиц. Сначала загрузите db/schema.sql");
if (!table_exists($SRC, 'workers')) fail("В базе $SRC нет таблицы workers — это точно база Ramada?");

out("Перенос $SRC → $DST" . ($DRY ? ' (проверка, без записи)' : ''));
out();

/*
 * Что и куда переносим. Для каждой новой таблицы: исходная таблица и колонки «новая => выражение по исходной».
 * Выражение — имя исходной колонки или SQL; колонки, которых нет в исходной таблице, пропускаются (останется значение по умолчанию).
 * {H} — id нового отеля.
 */
$PLAN = [
    'asset_dictionary' => ['from' => 'asset_dictionary', 'cols' => [
        'hotel_id' => '{H}', 'term_en' => 'term_en', 'term_ru' => 'term_ru', 'term_he' => 'term_he', 'term_ar' => 'term_ar',
    ], 'where' => "term_en IS NOT NULL AND term_en <> ''"],
    'hotel_assets' => ['from' => 'hotel_assets', 'cols' => [
        'id' => 'id', 'hotel_id' => '{H}', 'building' => 'building', 'floor' => 'floor', 'asset_key' => 'asset_key',
    ]],
    'room_checklist_dict' => ['from' => 'room_checklist_dict', 'cols' => [
        'id' => 'id', 'hotel_id' => '{H}', 'name_ru' => 'name_ru', 'name_en' => 'name_en', 'name_he' => 'name_he', 'name_ar' => 'name_ar',
        'sort_order' => 'id',
    ]],
    'routine_tasks' => ['from' => 'routine_tasks', 'cols' => [
        'id' => 'id', 'hotel_id' => '{H}', 'name_ru' => 'name_ru', 'name_en' => 'name_en', 'name_he' => 'name_he', 'name_ar' => 'name_ar',
        'requires_ocr' => 'COALESCE(requires_ocr, 0)', 'ocr_type' => 'ocr_type', 'sort_order' => 'id',
    ]],
    'maintenance_tasks' => ['from' => 'maintenance_tasks', 'cols' => [
        'id' => 'id', 'hotel_id' => '{H}', 'task_type' => "COALESCE(NULLIF(TRIM(task_type), ''), 'current')", 'asset_id' => 'asset_id',
        'user_id' => 'user_id', 'creator_id' => 'creator_id', 'worker_id' => 'worker_id',
        'description_ru' => 'description_ru', 'description_en' => 'description_en', 'description_he' => 'description_he', 'description_ar' => 'description_ar',
        'status' => "COALESCE(NULLIF(status, ''), 'pending')", 'notes' => 'notes', 'media' => 'media',
        'created_at' => 'COALESCE(created_at, NOW())', 'updated_at' => 'updated_at',
    ]],
    'task_workers' => ['from' => 'task_workers', 'cols' => ['task_id' => 'task_id', 'worker_id' => 'worker_id']],
    'task_room_checks' => ['from' => 'task_room_checks', 'cols' => [
        'task_id' => 'task_id', 'check_id' => 'check_id', 'status' => "COALESCE(NULLIF(status, ''), 'pending')",
        'comment_ru' => 'comment_ru', 'comment_en' => 'comment_en', 'comment_he' => 'comment_he', 'comment_ar' => 'comment_ar',
    ]],
    'routine_schedule' => ['from' => 'routine_schedule', 'cols' => [
        'id' => 'id', 'hotel_id' => '{H}', 'task_id' => 'task_id', 'worker_id' => 'worker_id', 'target_date' => 'target_date',
        'status' => "COALESCE(NULLIF(status, ''), 'pending')", 'notes' => 'notes', 'media' => 'media',
        'ocr_value' => 'ocr_value', 'ocr_unit' => 'ocr_unit', 'ocr_raw' => 'ocr_raw',
    ]],
    'routine_log' => ['from' => 'routine_log', 'cols' => [
        'id' => 'id', 'hotel_id' => '{H}', 'schedule_id' => 'schedule_id', 'task_id' => 'task_id', 'worker_id' => 'worker_id',
        'target_date' => 'target_date', 'status' => 'status', 'notes' => 'notes', 'media' => 'media',
        'ocr_value' => 'ocr_value', 'ocr_unit' => 'ocr_unit', 'ocr_raw' => 'ocr_raw', 'is_repeat' => 'is_repeat', 'closed_at' => 'closed_at',
    ]],
    'meter_report_links' => ['from' => 'meter_report_links', 'cols' => [
        'id' => 'id', 'hotel_id' => '{H}', 'link_key' => 'link_key', 'label' => 'label', 'lang' => 'lang', 'created_by' => 'created_by',
        'created_at' => 'created_at', 'last_used_at' => 'last_used_at', 'revoked' => 'revoked',
    ]],
    'push_log' => ['from' => 'push_log', 'cols' => [
        'hotel_id' => '{H}', 'created_at' => 'created_at', 'kind' => 'kind', 'task_id' => 'task_id', 'sent' => 'sent', 'ok' => 'ok', 'note' => 'note',
    ]],
    'admin_audit' => ['from' => 'admin_audit', 'cols' => [
        'hotel_id' => '{H}', 'at' => 'at', 'user_id' => 'worker_id', 'user_name' => 'worker_name', 'action' => 'action', 'tbl' => 'tbl',
        'row_key' => 'row_key', 'before_json' => 'before_json', 'after_json' => 'after_json',
    ]],
];
if ($WITH_PUSH) {
    $PLAN['push_subscriptions'] = ['from' => 'push_subscriptions', 'cols' => [
        'user_id' => 'worker_id', 'endpoint' => 'endpoint', 'endpoint_hash' => 'endpoint_hash', 'p256dh' => 'p256dh', 'auth' => 'auth',
        'lang' => 'lang', 'silent' => 'silent', 'user_agent' => 'user_agent', 'created_at' => 'created_at', 'last_ok_at' => 'last_ok_at',
    ]];
}
// Без переноса: auth_tokens (все войдут заново), sessions. Подписки на уведомления — только с --with-push.

// Сотрудники: колонки workers, которые мы понимаем
$KNOWN_WORKER_COLS = ['id', 'name', 'role', 'sysadmin', 'password_hash', 'active'];

// ---------------------------------------------------------------- отчёт о составе исходной базы

$warnings = [];
$srcTables = array_map(fn($r) => $r[0], q("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '" . esc($SRC) . "' AND TABLE_TYPE = 'BASE TABLE'")->fetch_all());
$handled = array_merge(['workers', 'auth_tokens', 'push_subscriptions'], array_column($PLAN, 'from'));
foreach ($srcTables as $t) {
    if (!in_array($t, $handled, true)) $warnings[] = "Таблица $SRC.$t не переносится (неизвестна новой схеме): " . val("SELECT COUNT(*) FROM `$SRC`.`$t`") . ' строк';
}
$wc = columns($SRC, 'workers');
foreach (array_diff($wc, $KNOWN_WORKER_COLS) as $col) $warnings[] = "Колонка workers.$col не переносится";
foreach ($PLAN as $dst => $p) {
    if (!table_exists($SRC, $p['from'])) continue;
    $have = columns($SRC, $p['from']);
    $used = [];
    foreach ($p['cols'] as $expr) {
        foreach ($have as $h) if (preg_match('/\b' . preg_quote($h, '/') . '\b/', $expr)) $used[] = $h;
    }
    foreach (array_diff($have, $used, ['id']) as $col) $warnings[] = "Колонка {$p['from']}.$col не переносится";
}

// Логины: в Ramada логин = имя. Совпадающие имена (без учёта регистра) получат приписку « #id».
$workers = q("SELECT * FROM `$SRC`.workers ORDER BY id")->fetch_all(MYSQLI_ASSOC);
$seen = [];
foreach ($workers as &$w) {
    $login = trim(preg_replace('/\s+/u', ' ', (string)$w['name']));
    if ($login === '') $login = 'user' . $w['id'];
    $k = mb_strtolower($login);
    if (isset($seen[$k])) {
        $warnings[] = "Имя «{$w['name']}» повторяется (id {$seen[$k]} и {$w['id']}): у id {$w['id']} логин будет «$login #{$w['id']}»";
        $login .= ' #' . $w['id'];
    } else $seen[$k] = $w['id'];
    $w['_login'] = $login;
    $role = strtolower(trim((string)($w['role'] ?? '')));
    if (!in_array($role, ['worker', 'manager', 'head'], true)) {
        if ($role !== '') $warnings[] = "У сотрудника id {$w['id']} неизвестная роль «{$w['role']}», будет Исполнитель";
        $role = 'worker';
    }
    $w['_role'] = $role;
    if (($w['password_hash'] ?? '') !== '' && !preg_match('/^\$2[aby]\$|^\$argon2/', (string)$w['password_hash'])) {
        $warnings[] = "У сотрудника id {$w['id']} пароль открытым текстом: при первом входе он заменится хэшем";
    }
}
unset($w);

// --superadmin: логин или id (id удобнее, если логин по-русски, а консоль Windows путает буквы)
$superId = null;
if (isset($opt['superadmin'])) {
    foreach ($workers as $w) {
        if ((string)$w['id'] === (string)$opt['superadmin'] || mb_strtolower($w['_login']) === mb_strtolower((string)$opt['superadmin'])) $superId = (int)$w['id'];
    }
    if ($superId === null) fail("Нет сотрудника с логином или id «{$opt['superadmin']}» для --superadmin");
}

$dataTables = ['users', 'maintenance_tasks', 'hotels'];
$nonEmpty = array_filter($dataTables, fn($t) => (int)val("SELECT COUNT(*) FROM `$DST`.`$t`") > 0);
if ($nonEmpty && !$REPLACE) {
    fail("В $DST уже есть данные (" . implode(', ', $nonEmpty) . "). Для повторного переноса запустите с --replace (всё в $DST будет стёрто)");
}

out('Предупреждения:');
foreach ($warnings ?: ['нет'] as $w) out("  - $w");
out();

if ($DRY) {
    out('Сколько строк будет перенесено:');
    out(sprintf('  %-22s %8d', 'users / hotel_members', count($workers)));
    foreach ($PLAN as $dst => $p) {
        $n = table_exists($SRC, $p['from']) ? (int)val("SELECT COUNT(*) FROM `$SRC`.`{$p['from']}`" . (isset($p['where']) ? " WHERE {$p['where']}" : '')) : 0;
        out(sprintf('  %-22s %8d', $dst, $n));
    }
    out();
    out('Проверка закончена, ничего не записано.');
    exit(0);
}

// ---------------------------------------------------------------- перенос

q("USE `$DST`");
q('SET FOREIGN_KEY_CHECKS = 0');
if ($REPLACE) {
    out("Стираю данные в {$DST}…");
    $res = q("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '" . esc($DST) . "' AND TABLE_TYPE = 'BASE TABLE'");
    foreach ($res->fetch_all() as [$t]) q("TRUNCATE TABLE `$t`");
}
$db->begin_transaction();
try {
    $orgName = (string)($opt['org-name'] ?? 'Ramada');
    $orgSlug = (string)($opt['org-slug'] ?? 'ramada');
    $hotelName = (string)($opt['hotel-name'] ?? 'Ramada Olivié Nazareth');
    $hotelSlug = (string)($opt['hotel-slug'] ?? 'ramada-nazareth');
    q("INSERT INTO organizations (name, slug) VALUES ('" . esc($orgName) . "', '" . esc($orgSlug) . "')");
    $orgId = (int)$db->insert_id;

    // Брендинг Ramada — то, что раньше было зашито в index.php и App.jsx
    $stmt = $db->prepare("INSERT INTO hotels (org_id, name, slug, timezone, default_lang, languages,
            brand_title_ru, brand_title_en, brand_title_he, brand_title_ar, brand_subtitle,
            color_primary, color_accent, color_text, color_button, logo_url, settings_json)
        VALUES (?, ?, ?, 'Asia/Jerusalem', 'ru', 'ru,en,he,ar', ?, ?, ?, ?, 'OLIVIÉ NAZARETH', '#371f20', '#cdaa7c', '#f9edd3', '#844128', '/brand/ramada.svg', ?)");
    $titles = [
        'Обслуживание Гостиницы Рамада, сервисная служба',
        'Ramada Hotel Maintenance, Service Department',
        'תחזוקת מלון רמדה, מחלקת שירות',
        'صيانة فندق رمادا، قسم الخدمة',
    ];
    // Кому слать уведомления о срочных заявках — как было в Ramada
    $settings = json_encode(['push_roles' => ['worker', 'head'], 'meter_ocr' => true,
        // Прежние значки Ramada для установки на телефон (brand/ramada/)
        'icons' => ['192' => '/brand/ramada/icon-192.png', '512' => '/brand/ramada/icon-512.png',
                    'maskable192' => '/brand/ramada/maskable-192.png', 'maskable512' => '/brand/ramada/maskable-512.png']],
        JSON_UNESCAPED_UNICODE);
    $stmt->bind_param('isssssss', $orgId, $hotelName, $hotelSlug, $titles[0], $titles[1], $titles[2], $titles[3], $settings);
    $stmt->execute();
    $H = (int)$db->insert_id;
    $stmt->close();

    $insU = $db->prepare("INSERT INTO users (id, login, display_name, password_hash, lang, active, is_superadmin, last_hotel_id)
                          VALUES (?, ?, ?, ?, 'ru', ?, ?, ?)");
    $insM = $db->prepare("INSERT INTO hotel_members (hotel_id, user_id, role, is_admin, active) VALUES (?, ?, ?, ?, ?)");
    $insO = $db->prepare("INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'org_admin')");
    foreach ($workers as $w) {
        $id = (int)$w['id'];
        $name = trim((string)$w['name']) !== '' ? trim((string)$w['name']) : $w['_login'];
        $hash = (string)($w['password_hash'] ?? '');
        $active = array_key_exists('active', $w) ? (int)$w['active'] : 1;
        $isAdmin = (int)($w['sysadmin'] ?? 0) === 1 ? 1 : 0;
        $isSuper = $id === $superId ? 1 : 0;
        $insU->bind_param('isssiii', $id, $w['_login'], $name, $hash, $active, $isSuper, $H);
        $insU->execute();
        $insM->bind_param('iisii', $H, $id, $w['_role'], $isAdmin, $active);
        $insM->execute();
        // Сисадмин Ramada становится администратором сети (может заводить новые отели)
        if ($isAdmin && $active) {
            $insO->bind_param('ii', $orgId, $id);
            $insO->execute();
        }
    }
    $insU->close();
    $insM->close();
    $insO->close();

    foreach ($PLAN as $dst => $p) {
        if (!table_exists($SRC, $p['from'])) continue;
        $have = columns($SRC, $p['from']);
        $dstCols = [];
        $exprs = [];
        foreach ($p['cols'] as $col => $expr) {
            if ($expr === '{H}') {
                $dstCols[] = "`$col`";
                $exprs[] = (string)$H;
                continue;
            }
            // Колонку без исходной пропускаем — останется значение по умолчанию
            $ok = false;
            foreach ($have as $h) if (preg_match('/\b' . preg_quote($h, '/') . '\b/', $expr)) $ok = true;
            if (!$ok) continue;
            $dstCols[] = "`$col`";
            $exprs[] = $expr;
        }
        $where = isset($p['where']) ? " WHERE {$p['where']}" : '';
        q("INSERT INTO `$DST`.`$dst` (" . implode(', ', $dstCols) . ") SELECT " . implode(', ', $exprs) . " FROM `$SRC`.`{$p['from']}`$where");
    }
    $db->commit();
} catch (Throwable $e) {
    $db->rollback();
    fail('Перенос отменён, база не изменена: ' . $e->getMessage());
}
q('SET FOREIGN_KEY_CHECKS = 1');

// ---------------------------------------------------------------- сверка

out('Сверка (было в Ramada → стало):');
$bad = 0;
$cmp = ['workers' => 'users'];
foreach ($PLAN as $dst => $p) $cmp[$p['from']] = $dst;
foreach ($cmp as $src => $dst) {
    if (!table_exists($SRC, $src)) {
        out(sprintf('  %-22s нет в Ramada', $src));
        continue;
    }
    $where = isset($PLAN[$dst]['where']) ? " WHERE {$PLAN[$dst]['where']}" : '';
    $a = (int)val("SELECT COUNT(*) FROM `$SRC`.`$src`$where");
    $b = (int)val("SELECT COUNT(*) FROM `$DST`.`$dst`");
    $mark = $a === $b ? 'ок' : 'НЕ СОВПАДАЕТ';
    if ($a !== $b) $bad++;
    out(sprintf('  %-22s %8d → %-8d %s', $dst, $a, $b, $mark));
}
out();
out("Сеть: $orgName (id $orgId), отель: $hotelName (id $H)");
out('Администраторы сети: ' . (int)val("SELECT COUNT(*) FROM `$DST`.org_members") . ', владелец системы: '
    . ((string)val("SELECT GROUP_CONCAT(login) FROM `$DST`.users WHERE is_superadmin = 1") ?: 'не назначен (--superadmin=<логин>)'));
out($bad ? "Готово, но $bad таблиц не сошлись — пришлите этот вывод." : 'Готово, всё сошлось.');
exit($bad ? 2 : 0);
