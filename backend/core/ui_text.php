<?php
/* Тексты интерфейса на сервере (уведомления, письма, страницы без React).
 * Английские — основа, в lang/en.json (общий файл с интерфейсом); остальные языки — в таблице
 * ui_translations, их заполняет автоперевод при добавлении языка (страница «Языки»).
 */
require_once __DIR__ . '/db.php';

function ui_base(): array
{
    static $en = null;
    if ($en === null) {
        $en = json_decode((string)@file_get_contents(__DIR__ . '/../../lang/en.json'), true);
        if (!is_array($en)) $en = [];
    }
    return $en;
}

/** Текст по ключу на языке $lang (чего нет — по-английски). %s подставляются из $args. */
function ui_t(string $key, string $lang, ...$args): string
{
    static $cache = [];
    if (!isset($cache[$lang])) {
        $cache[$lang] = $lang === 'en' ? [] : db_exec("SELECT key, text FROM ui_translations WHERE language_code = ?", [$lang])
            ->fetchAll(PDO::FETCH_KEY_PAIR);
    }
    $text = $cache[$lang][$key] ?? ui_base()[$key] ?? $key;
    return $args ? vsprintf($text, $args) : $text;
}

/** Пишется ли язык справа налево (по таблице languages). */
function ui_is_rtl(string $lang): bool
{
    return (bool)(app_languages()[$lang]['is_rtl'] ?? false);
}

/**
 * Словарь текстов из кода (выгрузки, страницы без React) на язык $lang: готовый, если он есть в $byLang,
 * иначе английский в автопереводе (через кеш переводов). Значения — строки или списки строк.
 */
function ui_dict(array $byLang, string $lang): array
{
    if (isset($byLang[$lang])) return $byLang[$lang];
    require_once __DIR__ . '/translate.php';
    $en = $byLang['en'];
    $flat = [];
    foreach ($en as $k => $v) {
        if (is_array($v)) foreach ($v as $i => $x) $flat["$k\t$i"] = $x;
        else $flat[$k] = $v;
    }
    $tr = translate_cached_many($flat, 'en', $lang);
    foreach ($en as $k => $v) {
        if (is_array($v)) foreach ($v as $i => $x) $en[$k][$i] = $tr["$k\t$i"];
        else $en[$k] = $tr[$k];
    }
    return $en;
}

/** Метки подстановки в тексте: {1}, {app}, %s — перевод без них (или с лишними) не годится. */
function ui_placeholders(string $s): array
{
    preg_match_all('/\{[a-z0-9_]+\}|%[sd]/i', $s, $m);
    $p = $m[0];
    sort($p);
    return $p;
}

/**
 * Перевести тексты интерфейса на язык $lang: недостающие ключи, а с $redoAuto — и переведённые автоматически
 * раньше (поправленные людьми не трогаются). Пачками по 50, ошибки сервиса — в журнал. Возвращает число записанных.
 */
function ui_fill_language(string $lang, bool $redoAuto = false): int
{
    if ($lang === 'en') return 0;
    require_once __DIR__ . '/translate.php';
    set_time_limit(900);
    $base = ui_base();
    $have = db_exec("SELECT key, is_auto FROM ui_translations WHERE language_code = ?", [$lang])->fetchAll(PDO::FETCH_KEY_PAIR);
    $todo = [];
    foreach ($base as $key => $en) {
        if (!array_key_exists($key, $have) || ($redoAuto && $have[$key])) $todo[$key] = $en;
    }
    $n = 0;
    foreach (array_chunk($todo, 50, true) as $chunk) {
        try {
            $done = translate_texts($chunk, 'en', $lang);
        } catch (Throwable $e) {
            error_log("hotels: ui translate en→{$lang}: " . $e->getMessage());
            continue;
        }
        foreach ($done as $key => $text) {
            $text = trim((string)$text);
            // Перевод сломал метки ({1}, {app}) — записываем английский как «автоматический», чтобы не переводить
            // его заново при каждом открытии; «Перевести заново» на странице «Языки» попробует ещё раз
            if ($text === '' || ui_placeholders($text) !== ui_placeholders($chunk[$key])) $text = $chunk[$key];
            db_exec("INSERT INTO ui_translations (key, language_code, text, is_auto) VALUES (?, ?, ?, true)
                     ON CONFLICT (key, language_code) DO UPDATE SET text = EXCLUDED.text, is_auto = true, updated_at = now()
                     WHERE ui_translations.is_auto", [$key, $lang, $text]);
            $n++;
        }
    }
    return $n;
}

/** Сколько ключей интерфейса ещё без перевода на $lang. */
function ui_missing_count(string $lang): int
{
    if ($lang === 'en') return 0;
    $have = db_exec("SELECT key FROM ui_translations WHERE language_code = ?", [$lang])->fetchAll(PDO::FETCH_COLUMN);
    return count(array_diff(array_keys(ui_base()), $have));
}
