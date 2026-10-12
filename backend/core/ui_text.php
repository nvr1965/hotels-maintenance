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
