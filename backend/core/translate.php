<?php
/* Машинный перевод и тексты на языках.
 *
 * Сервисы — цепочка переводчиков (backend/core/Translation, как в общем блоке i18n-block): DeepL, Google, Gemini,
 * LibreTranslate, MyMemory, Claude. Текст уходит первому настроенному и включённому сервису, который знает язык
 * и не исчерпал дневной лимит; упал — пробуется следующий. Порядок и лимиты — на странице «Переводчики».
 * Ключи — в secrets.php. 'translate_provider' => 'fake' в config.local.php — без интернета, «[xx] текст».
 *
 * Тексты на языках хранятся как jsonb {"ru": "…", "en": "…"}:
 *   i18n_pick($map, $lang)                       — текст на языке, иначе на английском, иначе любой;
 *   i18n_complete($map, $langs, $src)            — дописать недостающие языки переводом;
 *   i18n_rows_on_the_fly($table, $rows, $col, …) — перевод на лету с записью в ту же строку;
 *   i18n_fill_hotel($hotelId, $langs)            — дописать языки во все справочники отеля.
 * Свободный текст без jsonb (заметки) — translate_cached(): кеш в translation_cache.
 */
require_once __DIR__ . '/Translation/bootstrap.php';

use Hotels\Translation\LanguageGuesser;
use Hotels\Translation\TranslatorChain;

/** Какой сервис перевёл последним (для записи в кеш), до первого перевода — 'chain'. */
function translate_provider(): string
{
    return TranslatorChain::get()->name();
}

/**
 * Переводит тексты, сохраняя ключи. $from = '' — язык определить самим (по письменности, иначе сервис).
 * @throws RuntimeException если ни один сервис не смог
 */
function translate_texts(array $texts, string $from, string $to): array
{
    $texts = array_filter($texts, fn($t) => trim((string)$t) !== '');
    if (!$texts || $from === $to) return $texts;
    if ($from === '') {
        // Текст уже на языке читателя — не переводим
        $guess = LanguageGuesser::guess(implode(' ', $texts));
        if ($guess === $to) return $texts;
    }
    $done = TranslatorChain::get()->translateMany(array_values(array_map('strval', $texts)), $to, $from !== '' ? $from : null);
    return array_combine(array_keys($texts), array_map(fn($t) => trim((string)$t), $done));
}

// ---------------------------------------------------------------- тексты на языках (jsonb)

/** Текст на языке $lang: иначе на английском, иначе первый непустой. */
function i18n_pick($map, string $lang): string
{
    $m = db_json($map);
    foreach ([$lang, 'en'] as $l) if (isset($m[$l]) && trim((string)$m[$l]) !== '') return (string)$m[$l];
    foreach ($m as $v) if (is_string($v) && trim($v) !== '') return $v;
    return '';
}

/** Исходный язык карты: заданный, иначе английский, иначе первый непустой. */
function i18n_source(array $m, ?string $src = null): ?string
{
    if ($src && trim((string)($m[$src] ?? '')) !== '') return $src;
    if (trim((string)($m['en'] ?? '')) !== '') return 'en';
    foreach ($m as $l => $v) if (is_string($v) && trim($v) !== '') return (string)$l;
    return null;
}

/**
 * Дописывает в карту недостающие языки из $langs переводом с исходного.
 * Если перевод не удался, язык остаётся пустым (покажется исходный текст) — сохранение не ломается.
 */
function i18n_complete(array $m, array $langs, ?string $src = null): array
{
    $m = array_filter(array_map(fn($v) => trim((string)$v), $m), fn($v) => $v !== '');
    $from = i18n_source($m, $src);
    if ($from === null) return $m;
    foreach ($langs as $l) {
        if ($l === $from || isset($m[$l])) continue;
        try {
            $t = translate_texts(['x' => $m[$from]], $from, $l)['x'] ?? '';
            if ($t !== '') $m[$l] = $t;
        } catch (Throwable $e) {
            error_log("hotels: translate {$from}→{$l}: " . $e->getMessage());
        }
    }
    return $m;
}

/** Справочники отеля (jsonb names), в которых заполняются недостающие языки. */
const I18N_HOTEL_DICTS = ['asset_dictionary', 'room_checklist_dict', 'routine_tasks', 'hotel_departments'];

/**
 * Дописать во все справочники отеля недостающие языки из $langs (автоперевод пачками: один вызов
 * сервиса на пару языков и таблицу). Нужен после копирования справочников и при добавлении языка.
 * Возвращает число дописанных переводов; ошибки сервиса пишутся в журнал, остальное продолжается.
 */
function i18n_fill_hotel(int $hotelId, array $langs): int
{
    set_time_limit(600);
    $n = 0;
    foreach (I18N_HOTEL_DICTS as $table) {
        $todo = [];
        foreach (db_all("SELECT id, names FROM $table WHERE hotel_id = ?", [$hotelId]) as $r) {
            $m = db_json($r['names']);
            $src = i18n_source($m);
            if ($src === null) continue;
            foreach ($langs as $l) {
                if ($l !== $src && trim((string)($m[$l] ?? '')) === '') $todo["$src>$l"][(int)$r['id']] = $m[$src];
            }
        }
        foreach ($todo as $pair => $texts) {
            [$from, $to] = explode('>', $pair);
            foreach (array_chunk($texts, 50, true) as $chunk) {
                try {
                    $done = translate_texts($chunk, $from, $to);
                } catch (Throwable $e) {
                    error_log("hotels: translate {$from}→{$to} ($table): " . $e->getMessage());
                    continue;
                }
                foreach ($done as $id => $t) {
                    if ($t === '') continue;
                    db_exec("UPDATE $table SET names = names || jsonb_build_object(?::text, ?::text) WHERE id = ?", [$to, $t, $id]);
                    $n++;
                }
            }
        }
    }
    return $n;
}

/** Свободный текст на язык $to через кеш. $from = '' — определить. При ошибке — исходный текст. */
function translate_cached(string $text, string $from, string $to): string
{
    $text = trim($text);
    if ($text === '' || $from === $to) return $text;
    $hash = hash('sha256', $text);
    $hit = db_value("SELECT text FROM translation_cache WHERE src_hash = ? AND from_lang = ? AND to_lang = ?", [$hash, $from, $to]);
    if ($hit !== null) return (string)$hit;
    try {
        $t = translate_texts(['x' => $text], $from, $to)['x'] ?? '';
    } catch (Throwable $e) {
        error_log("hotels: translate {$from}→{$to}: " . $e->getMessage());
        return $text;
    }
    if ($t === '') return $text;
    db_exec("INSERT INTO translation_cache (src_hash, from_lang, to_lang, text, provider) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT DO NOTHING", [$hash, $from, $to, $t, translate_provider()]);
    return $t;
}

/** Пачка текстов на язык $to через кеш (ключи сохраняются); недостающее — одним вызовом сервиса. При ошибке — исходные. */
function translate_cached_many(array $texts, string $from, string $to): array
{
    if ($from === $to || !$texts) return $texts;
    $hashes = array_map(fn($t) => hash('sha256', trim((string)$t)), $texts);
    $hit = db_exec("SELECT src_hash, text FROM translation_cache WHERE from_lang = ? AND to_lang = ? AND src_hash = ANY(?::char(64)[])",
        [$from, $to, '{' . implode(',', array_unique($hashes)) . '}'])->fetchAll(PDO::FETCH_KEY_PAIR);
    $miss = [];
    foreach ($texts as $k => $t) if (trim((string)$t) !== '' && !isset($hit[$hashes[$k]])) $miss[$hashes[$k]] = trim((string)$t);
    if ($miss) {
        try {
            foreach (translate_texts($miss, $from, $to) as $h => $t) {
                if ($t === '') continue;
                $hit[$h] = $t;
                db_exec("INSERT INTO translation_cache (src_hash, from_lang, to_lang, text, provider) VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT DO NOTHING", [$h, $from, $to, $t, translate_provider()]);
            }
        } catch (Throwable $e) {
            error_log("hotels: translate {$from}→{$to}: " . $e->getMessage());
        }
    }
    $out = [];
    foreach ($texts as $k => $t) $out[$k] = $hit[$hashes[$k]] ?? $t;
    return $out;
}

/**
 * Перевод на лету для строк с jsonb-колонкой: тем, у кого нет нужного языка, он дописывается
 * переводом с языка автора ($col . '_lang') и сохраняется, второй раз сервис не вызывается.
 * $rows — строки с 'id' и $col (jsonb-текст). Возвращает строки, где $col уже текст на $lang,
 * а $col . '_orig' — оригинал (если язык другой).
 */
function i18n_rows_on_the_fly(string $table, array $rows, string $col, string $lang): array
{
    if (!preg_match('/^[a-z_]+$/', $table . $col)) throw new InvalidArgumentException('bad identifier');
    // Недостающие переводы собираем по исходному языку и переводим пачкой: один вызов сервиса на язык автора
    $maps = $todo = [];
    foreach ($rows as $i => $r) {
        $m = db_json($r[$col] ?? null);
        $src = i18n_source($m, $r[$col . '_lang'] ?? null);
        $maps[$i] = [$m, $src];
        if ($src !== null && $src !== $lang && trim((string)($m[$lang] ?? '')) === '') $todo[$src][$i] = $m[$src];
    }
    foreach ($todo as $src => $texts) {
        try {
            $done = translate_texts($texts, $src, $lang);
        } catch (Throwable $e) {
            error_log("hotels: translate {$src}→{$lang}: " . $e->getMessage());
            continue;
        }
        foreach ($done as $i => $t) {
            if ($t === '') continue;
            $maps[$i][0][$lang] = $t;
            // Язык автора, если не был записан, фиксируем: иначе исходным стал бы английский перевод
            db_exec("UPDATE $table SET $col = $col || jsonb_build_object(?::text, ?::text), {$col}_lang = COALESCE({$col}_lang, ?)
                     WHERE id = ?", [$lang, $t, $src, $rows[$i]['id']]);
        }
    }
    foreach ($rows as $i => &$r) {
        [$m, $src] = $maps[$i];
        $r[$col] = i18n_pick($m, $lang);
        // Оригинал — только если показан перевод (не удалось перевести — показан сам оригинал)
        $r[$col . '_orig'] = $src !== null && $src !== $lang && trim((string)($m[$lang] ?? '')) !== '' ? (string)($m[$src] ?? '') : null;
    }
    unset($r);
    return $rows;
}

/**
 * Свободный текст в строках ($col, язык автора в $langCol) на язык $lang: из кеша, недостающее — одной пачкой.
 * В строке остаётся перевод, оригинал — в $col . '_orig' (если язык другой). Без языка автора текст не трогаем.
 */
function i18n_free_rows(array $rows, string $col, string $langCol, string $lang): array
{
    $todo = [];
    foreach ($rows as $i => $r) {
        $text = trim((string)($r[$col] ?? ''));
        $src = (string)($r[$langCol] ?? '');
        if ($text !== '' && $src !== '' && $src !== $lang) $todo[$src][$i] = $text;
    }
    foreach ($todo as $src => $texts) {
        $hashes = array_map(fn($t) => hash('sha256', $t), $texts);
        $hit = $hashes ? db_exec("SELECT src_hash, text FROM translation_cache WHERE from_lang = ? AND to_lang = ? AND src_hash = ANY(?::char(64)[])",
            [$src, $lang, '{' . implode(',', array_unique($hashes)) . '}'])->fetchAll(PDO::FETCH_KEY_PAIR) : [];
        $miss = array_filter($texts, fn($t, $i) => !isset($hit[$hashes[$i]]), ARRAY_FILTER_USE_BOTH);
        if ($miss) {
            try {
                foreach (translate_texts(array_unique($miss), $src, $lang) as $i => $t) {
                    if ($t === '') continue;
                    $hit[$hashes[$i]] = $t;
                    db_exec("INSERT INTO translation_cache (src_hash, from_lang, to_lang, text, provider) VALUES (?, ?, ?, ?, ?)
                             ON CONFLICT DO NOTHING", [$hashes[$i], $src, $lang, $t, translate_provider()]);
                }
            } catch (Throwable $e) {
                error_log("hotels: translate {$src}→{$lang}: " . $e->getMessage());
            }
        }
        foreach ($texts as $i => $t) {
            if (!isset($hit[$hashes[$i]])) continue;
            $rows[$i][$col . '_orig'] = $t;
            $rows[$i][$col] = $hit[$hashes[$i]];
        }
    }
    return $rows;
}
