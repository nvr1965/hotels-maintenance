<?php
/* Админка → Языки (только владелец системы): языки системы и тексты интерфейса на них.
 * Новый язык сразу доступен; все тексты интерфейса переводятся автоматически сразу после ответа,
 * любой перевод можно поправить руками (такой текст автоперевод больше не трогает).
 *
 * GET  ?action=list                         — языки: сколько текстов переведено, сколько автоматически, в скольких отелях
 * POST ?action=save   {code, name, native_name?, rtl?, active?, sort_order?}   — новый язык или правка
 * POST ?action=fill   {code, redo?}         — перевести недостающее (redo — и автоматические заново)
 * GET  ?action=texts&code=xx&q=             — тексты: ключ, английский, перевод, автоматический ли
 * POST ?action=text   {code, key, text}     — поправить перевод (пусто — вернуть автоперевод)
 */
require_once __DIR__ . '/../core/api.php';

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
if ($me['is_superadmin'] !== 1) app_json_fail(403, 'forbidden');
$action = $_GET['action'] ?? 'list';
if (!in_array($action, ['list', 'texts'], true)) api_require_post();
$in = api_input();

const LANG_CODE_RE = '/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/';

function lang_row(string $code): ?array
{
    return db_one("SELECT * FROM languages WHERE code = ?", [$code]);
}

/** Перевести интерфейс на язык после ответа; один процесс на язык. */
function lang_fill_after(array $data, string $code, bool $redo): void
{
    api_ok_then($data, function () use ($code, $redo) {
        if (!db_value("SELECT pg_try_advisory_lock(hashtext(?))", ['ui_fill:' . $code])) return;
        try {
            ui_fill_language($code, $redo);
        } finally {
            db_exec("SELECT pg_advisory_unlock(hashtext(?))", ['ui_fill:' . $code]);
        }
    });
}

/** Идёт ли сейчас автоперевод языка (замок занят другим процессом). */
function lang_filling(string $code): bool
{
    if (db_value("SELECT pg_try_advisory_lock(hashtext(?))", ['ui_fill:' . $code])) {
        db_exec("SELECT pg_advisory_unlock(hashtext(?))", ['ui_fill:' . $code]);
        return false;
    }
    return true;
}

if ($action === 'list') {
    $total = count(ui_base());
    $stats = [];
    foreach (db_all("SELECT language_code, COUNT(*) AS n, COUNT(*) FILTER (WHERE is_auto) AS auto
                     FROM ui_translations GROUP BY language_code") as $r) $stats[$r['language_code']] = $r;
    $hotels = db_exec("SELECT l, COUNT(*) FROM hotels, unnest(languages) AS l GROUP BY l")->fetchAll(PDO::FETCH_KEY_PAIR);
    $out = [];
    foreach (db_all("SELECT * FROM languages ORDER BY sort_order, code") as $l) {
        $c = $l['code'];
        $out[] = [
            'code' => $c, 'name' => $l['name'], 'native_name' => $l['native_name'], 'rtl' => (bool)$l['is_rtl'],
            'active' => (bool)$l['is_active'], 'sort_order' => (int)$l['sort_order'],
            'translated' => $c === 'en' ? $total : min($total, (int)($stats[$c]['n'] ?? 0)),
            'auto' => (int)($stats[$c]['auto'] ?? 0),
            'hotels' => (int)($hotels[$c] ?? 0),
            'filling' => $c !== 'en' && lang_filling($c),
        ];
    }
    api_ok(['languages' => $out, 'total' => $total, 'provider' => translate_provider()]);
}

if ($action === 'save') {
    $code = trim((string)($in['code'] ?? ''));
    if (!preg_match(LANG_CODE_RE, $code)) api_fail('bad_code');
    $name = clean_text($in['name'] ?? '', 60);
    if ($name === '') api_fail('name_required');
    $before = lang_row($code);
    $data = [
        'name' => $name,
        'native_name' => clean_text($in['native_name'] ?? ($before['native_name'] ?? ''), 60) ?: null,
        'is_rtl' => array_key_exists('rtl', $in) ? !empty($in['rtl']) : (bool)($before['is_rtl'] ?? false),
        'is_active' => array_key_exists('active', $in) ? !empty($in['active']) : (bool)($before['is_active'] ?? true),
        'sort_order' => isset($in['sort_order']) ? (int)$in['sort_order'] : (int)($before['sort_order'] ?? 100),
    ];
    if ($code === 'en' && !$data['is_active']) api_fail('base_language'); // английский — основа интерфейса
    if ($before) {
        db_exec("UPDATE languages SET name = ?, native_name = ?, is_rtl = ?, is_active = ?, sort_order = ? WHERE code = ?",
            array_merge(array_values($data), [$code]));
        audit($me, 'update', 'languages', $code, $before, lang_row($code));
        api_ok(['code' => $code]);
    }
    db_exec("INSERT INTO languages (code, name, native_name, is_rtl, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        array_merge([$code], array_values($data)));
    audit($me, 'insert', 'languages', $code, null, lang_row($code));
    // Новый язык: интерфейс переводится сразу, страница «Языки» покажет, сколько готово
    lang_fill_after(['code' => $code, 'filling' => true], $code, false);
}

if ($action === 'fill') {
    $code = (string)($in['code'] ?? '');
    if (!lang_row($code)) api_fail('not_found');
    if ($code === 'en') api_fail('base_language');
    lang_fill_after(['code' => $code, 'filling' => true], $code, !empty($in['redo']));
}

if ($action === 'texts') {
    $code = (string)($_GET['code'] ?? '');
    if (!lang_row($code)) api_fail('not_found');
    $q = mb_strtolower(trim((string)($_GET['q'] ?? '')));
    $tr = [];
    foreach (db_all("SELECT key, text, is_auto FROM ui_translations WHERE language_code = ?", [$code]) as $r) $tr[$r['key']] = $r;
    $rows = [];
    foreach (ui_base() as $key => $en) {
        $t = $tr[$key] ?? null;
        if ($q !== '' && !str_contains(mb_strtolower($key . ' ' . $en . ' ' . ($t['text'] ?? '')), $q)) continue;
        $rows[] = ['key' => $key, 'en' => $en, 'text' => $t['text'] ?? null, 'auto' => $t ? (bool)$t['is_auto'] : null];
    }
    api_ok(['code' => $code, 'rows' => $rows]);
}

if ($action === 'text') {
    $code = (string)($in['code'] ?? '');
    $key = (string)($in['key'] ?? '');
    if ($code === 'en' || !lang_row($code)) api_fail('not_found');
    if (!array_key_exists($key, ui_base())) api_fail('bad_key');
    $text = trim((string)($in['text'] ?? ''));
    $before = db_one("SELECT * FROM ui_translations WHERE key = ? AND language_code = ?", [$key, $code]);
    if ($text === '') {
        // Пусто — убрать ручной перевод: ключ переведётся автоматически при следующем открытии на этом языке
        db_exec("DELETE FROM ui_translations WHERE key = ? AND language_code = ?", [$key, $code]);
    } else {
        if (ui_placeholders($text) !== ui_placeholders(ui_base()[$key])) api_fail('placeholders', ['need' => ui_placeholders(ui_base()[$key])]);
        db_exec("INSERT INTO ui_translations (key, language_code, text, is_auto) VALUES (?, ?, ?, false)
                 ON CONFLICT (key, language_code) DO UPDATE SET text = EXCLUDED.text, is_auto = false, updated_at = now()",
            [$key, $code, $text]);
    }
    audit($me, 'update', 'ui_translations', ['key' => $key, 'lang' => $code], $before,
        db_one("SELECT * FROM ui_translations WHERE key = ? AND language_code = ?", [$key, $code]));
    api_ok();
}

api_fail('bad_action');
