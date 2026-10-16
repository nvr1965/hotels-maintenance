<?php
/* Перенос данных Ramada (MySQL/MariaDB) в Hotels Maintenance (PostgreSQL) как первого отеля сети.
 *
 * Из базы Ramada только читает (SELECT), в неё ничего не пишет.
 * id сотрудников, объектов, заявок, регламентов и истории сохраняются, поэтому все ссылки
 * между записями и адреса фото (/uploads/...) остаются прежними.
 * Тексты на четырёх языках (колонки *_ru/_en/_he/_ar) становятся jsonb {"ru": …, "en": …}.
 *
 * Запуск на сервере (PostgreSQL — из backend/core/config.local.php):
 *   php tools/migrate_ramada.php --dry-run      только проверка и отчёт
 *   php tools/migrate_ramada.php                перенос в пустую базу
 *   php tools/migrate_ramada.php --replace      стереть всё и перенести заново (свежие данные)
 *
 * Где взять базу Ramada: дамп с компьютера с XAMPP загрузить в MariaDB на сервере
 * (см. docs/ПЕРЕНОС-RAMADA.md) или подключиться к XAMPP по сети.
 *   --src-host=127.0.0.1 --src-port=3306 --src-user=root --src-pass= --source=ramada
 *
 * Прочие параметры (необязательные):
 *   --org-name="..." --org-slug=...         сеть (по умолчанию «Ramada», ramada)
 *   --hotel-name="..." --hotel-slug=...     отель (по умолчанию «Ramada Olivié Nazareth», ramada-nazareth)
 *   --superadmin=<логин или id>             сделать этого пользователя владельцем системы
 *   --with-push                             перенести подписки телефонов на уведомления
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$opt = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/', $a, $m)) $opt[$m[1]] = $m[2] ?? true;
    else fail("Непонятный параметр: $a");
}
$SRC = (string)($opt['source'] ?? 'ramada');
$DRY = isset($opt['dry-run']);
$REPLACE = isset($opt['replace']);
$WITH_PUSH = isset($opt['with-push']);
if (!preg_match('/^[A-Za-z0-9_]+$/', $SRC)) fail("Плохое имя базы: $SRC");

const LANGS = ['ru', 'en', 'he', 'ar'];   // языки Ramada
const TZ = 'Asia/Jerusalem';              // время в базе Ramada — местное

function out(string $s = ''): void { echo $s, PHP_EOL; }
function fail(string $s): void { fwrite(STDERR, "ОШИБКА: $s" . PHP_EOL); exit(1); }

// ---------------------------------------------------------------- подключения

try {
    $my = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $opt['src-host'] ?? '127.0.0.1', (int)($opt['src-port'] ?? 3306), $SRC),
        (string)($opt['src-user'] ?? 'root'), (string)($opt['src-pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (PDOException $e) {
    fail("Нет связи с базой Ramada ($SRC): " . $e->getMessage());
}

require_once __DIR__ . '/../backend/core/config.php';
$c = app_config()['db'];
try {
    $pg = new PDO(sprintf('pgsql:host=%s;port=%d;dbname=%s', $c['host'], (int)$c['port'], $c['name']), $c['user'], $c['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    // Время из Ramada записано без пояса — читаем его как израильское
    $pg->exec("SET TIME ZONE '" . TZ . "'");
} catch (PDOException $e) {
    fail("Нет связи с PostgreSQL ({$c['name']}): " . $e->getMessage());
}

function my_tables(PDO $my): array
{
    return $my->query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")
        ->fetchAll(PDO::FETCH_COLUMN);
}
function my_columns(PDO $my, string $t): array
{
    $st = $my->prepare("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION");
    $st->execute([$t]);
    return $st->fetchAll(PDO::FETCH_COLUMN);
}

// {"ru": …, "en": …} из колонок prefix_ru … prefix_ar; пустые языки не пишем
function i18n(array $r, string $prefix): string
{
    $o = [];
    foreach (LANGS as $l) {
        $v = trim((string)($r["{$prefix}_$l"] ?? ''));
        if ($v !== '') $o[$l] = $v;
    }
    return json_encode((object)$o, JSON_UNESCAPED_UNICODE);
}
$bool = fn($v) => !empty($v) && $v !== '0' ? 't' : 'f';
$nz = fn($v, $d) => ($v === null || trim((string)$v) === '') ? $d : trim((string)$v);
$dt = fn($v) => ($v === null || $v === '' || str_starts_with((string)$v, '0000-00-00')) ? null : $v;

/*
 * Что и куда. Для каждой новой таблицы: исходная таблица, нужные исходные колонки (для проверки)
 * и функция «исходная строка → новая строка». {H} подставляется в замыкание через $H.
 */
$H = 0;
$PLAN = [
    'asset_dictionary' => ['from' => 'asset_dictionary', 'uses' => ['term_en', 'term_ru', 'term_he', 'term_ar'],
        'where' => "term_en IS NOT NULL AND term_en <> ''",
        'map' => fn($r) => ['hotel_id' => $GLOBALS['H'], 'term_key' => trim($r['term_en']), 'names' => i18n($r, 'term')]],
    'hotel_assets' => ['from' => 'hotel_assets', 'uses' => ['building', 'floor', 'asset_key'],
        'map' => fn($r) => ['id' => $r['id'], 'hotel_id' => $GLOBALS['H'], 'building' => $r['building'] ?? null,
            'floor' => $r['floor'] ?? null, 'asset_key' => (string)$r['asset_key']]],
    'room_checklist_dict' => ['from' => 'room_checklist_dict', 'uses' => ['name_ru', 'name_en', 'name_he', 'name_ar'],
        'map' => fn($r) => ['id' => $r['id'], 'hotel_id' => $GLOBALS['H'], 'names' => i18n($r, 'name'), 'sort_order' => $r['id']]],
    'routine_tasks' => ['from' => 'routine_tasks', 'uses' => ['name_ru', 'name_en', 'name_he', 'name_ar', 'requires_ocr', 'ocr_type'],
        'map' => fn($r) => ['id' => $r['id'], 'hotel_id' => $GLOBALS['H'], 'names' => i18n($r, 'name'),
            'requires_ocr' => $bool($r['requires_ocr'] ?? 0), 'ocr_type' => $r['ocr_type'] ?? null, 'sort_order' => $r['id']]],
    'maintenance_tasks' => ['from' => 'maintenance_tasks', 'uses' => ['task_type', 'asset_id', 'user_id', 'creator_id', 'worker_id',
            'description_ru', 'description_en', 'description_he', 'description_ar', 'status', 'notes', 'media', 'created_at', 'updated_at'],
        'map' => fn($r) => ['id' => $r['id'], 'hotel_id' => $GLOBALS['H'], 'task_type' => $nz($r['task_type'] ?? null, 'current'),
            'asset_id' => $r['asset_id'] ?? null, 'user_id' => $r['user_id'] ?? null, 'creator_id' => $r['creator_id'] ?? null,
            'worker_id' => $r['worker_id'] ?? null, 'description' => i18n($r, 'description'),
            'status' => $nz($r['status'] ?? null, 'pending'), 'notes' => $r['notes'] ?? null, 'media' => $r['media'] ?? null,
            'created_at' => $dt($r['created_at'] ?? null) ?? date('Y-m-d H:i:s'), 'updated_at' => $dt($r['updated_at'] ?? null)]],
    'task_workers' => ['from' => 'task_workers', 'uses' => ['task_id', 'worker_id'],
        'map' => fn($r) => ['task_id' => $r['task_id'], 'worker_id' => $r['worker_id']]],
    'task_room_checks' => ['from' => 'task_room_checks', 'uses' => ['task_id', 'check_id', 'status', 'comment_ru', 'comment_en', 'comment_he', 'comment_ar'],
        'map' => fn($r) => ['task_id' => $r['task_id'], 'check_id' => $r['check_id'], 'status' => $nz($r['status'] ?? null, 'pending'),
            'comment' => i18n($r, 'comment')]],
    'routine_schedule' => ['from' => 'routine_schedule', 'uses' => ['task_id', 'worker_id', 'target_date', 'status', 'notes', 'media', 'ocr_value', 'ocr_unit', 'ocr_raw'],
        'map' => fn($r) => ['id' => $r['id'], 'hotel_id' => $GLOBALS['H'], 'task_id' => $r['task_id'], 'worker_id' => $r['worker_id'] ?? null,
            'target_date' => $r['target_date'], 'status' => $nz($r['status'] ?? null, 'pending'), 'notes' => $r['notes'] ?? null,
            'media' => $r['media'] ?? null, 'ocr_value' => $r['ocr_value'] ?? null, 'ocr_unit' => $r['ocr_unit'] ?? null, 'ocr_raw' => $r['ocr_raw'] ?? null]],
    'routine_log' => ['from' => 'routine_log', 'uses' => ['schedule_id', 'task_id', 'worker_id', 'target_date', 'status', 'notes', 'media',
            'ocr_value', 'ocr_unit', 'ocr_raw', 'is_repeat', 'closed_at'],
        'map' => fn($r) => ['id' => $r['id'], 'hotel_id' => $GLOBALS['H'], 'schedule_id' => $r['schedule_id'] ?? null, 'task_id' => $r['task_id'],
            'worker_id' => $r['worker_id'] ?? null, 'target_date' => $r['target_date'],
            'status' => in_array($r['status'] ?? 'done', ['pending', 'done'], true) ? ($r['status'] ?? 'done') : 'done',
            'notes' => $r['notes'] ?? null, 'media' => $r['media'] ?? null, 'ocr_value' => $r['ocr_value'] ?? null,
            'ocr_unit' => $r['ocr_unit'] ?? null, 'ocr_raw' => $r['ocr_raw'] ?? null, 'is_repeat' => $bool($r['is_repeat'] ?? 0),
            'closed_at' => $dt($r['closed_at'] ?? null) ?? ($r['target_date'] . ' 00:00:00')]],
    'meter_report_links' => ['from' => 'meter_report_links', 'uses' => ['link_key', 'label', 'lang', 'created_by', 'created_at', 'last_used_at', 'revoked'],
        'map' => fn($r) => ['id' => $r['id'], 'hotel_id' => $GLOBALS['H'], 'link_key' => $r['link_key'], 'label' => (string)($r['label'] ?? ''),
            'lang' => $nz($r['lang'] ?? null, 'he'), 'created_by' => $r['created_by'] ?? null,
            'created_at' => $dt($r['created_at'] ?? null) ?? date('Y-m-d H:i:s'), 'last_used_at' => $dt($r['last_used_at'] ?? null),
            'revoked' => $bool($r['revoked'] ?? 0)]],
    'push_log' => ['from' => 'push_log', 'uses' => ['created_at', 'kind', 'task_id', 'sent', 'ok', 'note'],
        'map' => fn($r) => ['hotel_id' => $GLOBALS['H'], 'created_at' => $dt($r['created_at'] ?? null) ?? date('Y-m-d H:i:s'),
            'kind' => (string)$r['kind'], 'task_id' => (int)$r['task_id'], 'sent' => (int)($r['sent'] ?? 0), 'ok' => (int)($r['ok'] ?? 0),
            'note' => (string)($r['note'] ?? '')]],
    'admin_audit' => ['from' => 'admin_audit', 'uses' => ['at', 'worker_id', 'worker_name', 'action', 'tbl', 'row_key', 'before_json', 'after_json'],
        'map' => fn($r) => ['hotel_id' => $GLOBALS['H'], 'at' => $dt($r['at'] ?? null) ?? date('Y-m-d H:i:s'), 'user_id' => $r['worker_id'] ?? null,
            'user_name' => $r['worker_name'] ?? null, 'action' => (string)$r['action'], 'tbl' => (string)$r['tbl'], 'row_key' => $r['row_key'] ?? null,
            'before_json' => json_ok($r['before_json'] ?? null), 'after_json' => json_ok($r['after_json'] ?? null)]],
];
if ($WITH_PUSH) {
    $PLAN['push_subscriptions'] = ['from' => 'push_subscriptions', 'uses' => ['worker_id', 'endpoint', 'endpoint_hash', 'p256dh', 'auth', 'lang', 'silent',
            'user_agent', 'created_at', 'last_ok_at'],
        'map' => fn($r) => ['user_id' => $r['worker_id'], 'endpoint' => $r['endpoint'], 'endpoint_hash' => $r['endpoint_hash'], 'p256dh' => $r['p256dh'],
            'auth' => $r['auth'], 'lang' => $nz($r['lang'] ?? null, 'ru'), 'silent' => $bool($r['silent'] ?? 0), 'user_agent' => $r['user_agent'] ?? null,
            'created_at' => $dt($r['created_at'] ?? null) ?? date('Y-m-d H:i:s'), 'last_ok_at' => $dt($r['last_ok_at'] ?? null)]];
}
// Без переноса: auth_tokens (все войдут заново). Подписки на уведомления — только с --with-push.

// Журнал хранил JSON текстом; битый JSON сохраняем как строку внутри JSON
function json_ok($v): ?string
{
    if ($v === null || $v === '') return null;
    json_decode((string)$v);
    return json_last_error() === JSON_ERROR_NONE ? (string)$v : json_encode((string)$v, JSON_UNESCAPED_UNICODE);
}

$KNOWN_WORKER_COLS = ['id', 'name', 'role', 'sysadmin', 'password_hash', 'active'];

// ---------------------------------------------------------------- проверки и отчёт

$srcTables = my_tables($my);
if (!in_array('workers', $srcTables, true)) fail("В базе $SRC нет таблицы workers — это точно база Ramada?");
if (!(int)$pg->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'hotels'")->fetchColumn()) {
    fail("В PostgreSQL ({$c['name']}) нет таблиц. Сначала загрузите db/pg/01_schema.sql");
}

out("Перенос Ramada ($SRC) → PostgreSQL ({$c['name']})" . ($DRY ? ' — проверка, без записи' : ''));
out();

$warnings = [];
$handled = array_merge(['workers', 'auth_tokens', 'push_subscriptions'], array_column($PLAN, 'from'));
foreach ($srcTables as $t) {
    if (!in_array($t, $handled, true)) {
        $warnings[] = "Таблица $t не переносится (неизвестна новой схеме): " . $my->query("SELECT COUNT(*) FROM `$t`")->fetchColumn() . ' строк';
    }
}
foreach (array_diff(my_columns($my, 'workers'), $KNOWN_WORKER_COLS) as $col) $warnings[] = "Колонка workers.$col не переносится";
foreach ($PLAN as $p) {
    if (!in_array($p['from'], $srcTables, true)) continue;
    foreach (array_diff(my_columns($my, $p['from']), $p['uses'], ['id']) as $col) $warnings[] = "Колонка {$p['from']}.$col не переносится";
}

// Логины: в Ramada логин = имя. Совпадающие имена (без учёта регистра) получат приписку « #id».
$workers = $my->query("SELECT * FROM workers ORDER BY id")->fetchAll();
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

$superId = null;
if (isset($opt['superadmin'])) {
    foreach ($workers as $w) {
        if ((string)$w['id'] === (string)$opt['superadmin'] || mb_strtolower($w['_login']) === mb_strtolower((string)$opt['superadmin'])) $superId = (int)$w['id'];
    }
    if ($superId === null) fail("Нет сотрудника с логином или id «{$opt['superadmin']}» для --superadmin");
}

$nonEmpty = array_filter(['users', 'maintenance_tasks', 'hotels'], fn($t) => (int)$pg->query("SELECT COUNT(*) FROM $t")->fetchColumn() > 0);
if ($nonEmpty && !$REPLACE && !$DRY) {
    fail('В новой базе уже есть данные (' . implode(', ', $nonEmpty) . '). Для повторного переноса запустите с --replace (всё будет стёрто)');
}

out('Предупреждения:');
foreach ($warnings ?: ['нет'] as $w) out("  - $w");
out();

$count = fn(array $p) => in_array($p['from'], $srcTables, true)
    ? (int)$my->query("SELECT COUNT(*) FROM `{$p['from']}`" . (isset($p['where']) ? " WHERE {$p['where']}" : ''))->fetchColumn() : 0;

if ($DRY) {
    out('Сколько строк будет перенесено:');
    out(sprintf('  %-22s %8d', 'users / hotel_members', count($workers)));
    foreach ($PLAN as $dst => $p) out(sprintf('  %-22s %8d', $dst, $count($p)));
    out();
    out('Проверка закончена, ничего не записано.');
    exit(0);
}

// ---------------------------------------------------------------- перенос

function insert(PDO $pg, string $table, array $row): void
{
    static $cache = [];
    $cols = array_keys($row);
    $key = $table . ':' . implode(',', $cols);
    $cache[$key] ??= $pg->prepare("INSERT INTO $table (" . implode(', ', $cols) . ') VALUES ('
        . implode(', ', array_fill(0, count($cols), '?')) . ')');
    $cache[$key]->execute(array_values($row));
}

$pg->beginTransaction();
try {
    if ($REPLACE) {
        out('Стираю данные в новой базе…');
        // Языки и переводы интерфейса не трогаем: это настройки системы, а не данные Ramada
        $tables = $pg->query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                              AND tablename NOT IN ('languages', 'ui_translations', 'translation_cache')")->fetchAll(PDO::FETCH_COLUMN);
        $pg->exec('TRUNCATE ' . implode(', ', $tables) . ' RESTART IDENTITY CASCADE');
    }

    $orgName = (string)($opt['org-name'] ?? 'Ramada');
    $orgSlug = (string)($opt['org-slug'] ?? 'ramada');
    $hotelName = (string)($opt['hotel-name'] ?? 'Ramada Olivié Nazareth');
    $hotelSlug = (string)($opt['hotel-slug'] ?? 'ramada-nazareth');
    $st = $pg->prepare('INSERT INTO organizations (name, slug) VALUES (?, ?) RETURNING id');
    $st->execute([$orgName, $orgSlug]);
    $orgId = (int)$st->fetchColumn();

    // Брендинг Ramada — то, что раньше было зашито в index.php и App.jsx
    $titles = [
        'ru' => 'Обслуживание Гостиницы Рамада, сервисная служба',
        'en' => 'Ramada Hotel Maintenance, Service Department',
        'he' => 'תחזוקת מלון רמדה, מחלקת שירות',
        'ar' => 'صيانة فندق رمادا، قسم الخدمة',
    ];
    $settings = ['push_roles' => ['worker', 'head'], 'meter_ocr' => true,
        'icons' => ['192' => '/brand/ramada/icon-192.png', '512' => '/brand/ramada/icon-512.png',
                    'maskable192' => '/brand/ramada/maskable-192.png', 'maskable512' => '/brand/ramada/maskable-512.png']];
    $st = $pg->prepare("INSERT INTO hotels (org_id, name, slug, timezone, default_lang, languages, brand_title, brand_subtitle,
            color_primary, color_accent, color_text, color_button, logo_url, settings)
        VALUES (?, ?, ?, ?, 'ru', '{ru,en,he,ar}', ?, 'OLIVIÉ NAZARETH', '#371f20', '#cdaa7c', '#f9edd3', '#844128', '/brand/ramada.svg', ?)
        RETURNING id");
    $st->execute([$orgId, $hotelName, $hotelSlug, TZ, json_encode($titles, JSON_UNESCAPED_UNICODE), json_encode($settings)]);
    $H = (int)$st->fetchColumn();

    foreach ($workers as $w) {
        $id = (int)$w['id'];
        $name = trim((string)$w['name']) !== '' ? trim((string)$w['name']) : $w['_login'];
        $active = array_key_exists('active', $w) ? !empty($w['active']) : true;
        $isAdmin = (int)($w['sysadmin'] ?? 0) === 1;
        insert($pg, 'users', ['id' => $id, 'login' => $w['_login'], 'display_name' => $name, 'password_hash' => (string)($w['password_hash'] ?? ''),
            'lang' => 'ru', 'active' => $bool($active), 'is_superadmin' => $bool($id === $superId), 'last_hotel_id' => $H]);
        insert($pg, 'hotel_members', ['hotel_id' => $H, 'user_id' => $id, 'role' => $w['_role'], 'is_admin' => $bool($isAdmin), 'active' => $bool($active)]);
        // Сисадмин Ramada становится администратором сети (может заводить новые отели)
        if ($isAdmin && $active) insert($pg, 'org_members', ['org_id' => $orgId, 'user_id' => $id, 'role' => 'org_admin']);
    }

    foreach ($PLAN as $dst => $p) {
        if (!in_array($p['from'], $srcTables, true)) continue;
        $res = $my->query("SELECT * FROM `{$p['from']}`" . (isset($p['where']) ? " WHERE {$p['where']}" : '') . ' ORDER BY 1');
        while ($r = $res->fetch()) insert($pg, $dst, $p['map']($r));
    }

    // Счётчики id продолжаются после перенесённых
    foreach ($pg->query("SELECT table_name FROM information_schema.columns
                         WHERE table_schema = 'public' AND column_name = 'id' AND is_identity = 'YES'")->fetchAll(PDO::FETCH_COLUMN) as $t) {
        $pg->query("SELECT setval(pg_get_serial_sequence('$t', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM $t), 1),
                    (SELECT COUNT(*) > 0 FROM $t))");
    }
    $pg->commit();
} catch (Throwable $e) {
    $pg->rollBack();
    fail('Перенос отменён, новая база не изменена: ' . $e->getMessage());
}

// ---------------------------------------------------------------- сверка

out('Сверка (было в Ramada → стало):');
$bad = 0;
$rows = [['workers', count($workers), 'users']];
foreach ($PLAN as $dst => $p) $rows[] = [$p['from'], in_array($p['from'], $srcTables, true) ? $count($p) : null, $dst];
foreach ($rows as [$src, $a, $dst]) {
    if ($a === null) {
        out(sprintf('  %-22s нет в Ramada', $src));
        continue;
    }
    $b = (int)$pg->query("SELECT COUNT(*) FROM $dst")->fetchColumn();
    if ($a !== $b) $bad++;
    out(sprintf('  %-22s %8d → %-8d %s', $dst, $a, $b, $a === $b ? 'ок' : 'НЕ СОВПАДАЕТ'));
}
out();
out("Сеть: $orgName (id $orgId), отель: $hotelName (id $H)");
out('Администраторы сети: ' . (int)$pg->query('SELECT COUNT(*) FROM org_members')->fetchColumn() . ', владелец системы: '
    . ((string)$pg->query("SELECT string_agg(login, ', ') FROM users WHERE is_superadmin")->fetchColumn() ?: 'не назначен (--superadmin=<логин>)'));
out($bad ? "Готово, но $bad таблиц не сошлись — пришлите этот вывод." : 'Готово, всё сошлось.');
exit($bad ? 2 : 0);
