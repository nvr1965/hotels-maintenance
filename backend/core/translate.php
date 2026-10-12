<?php
/* Машинный перевод и тексты на языках.
 *
 * Сервисы (выбирается сам, или 'translate_provider' в config.local.php):
 *   google   — Google Cloud Translation, если в secrets.php есть google_translate_key;
 *   gemini   — Gemini, если есть gemini_api_key (тот же ключ, что для счётчиков);
 *   mymemory — бесплатный MyMemory без ключа (5 000 знаков в день, с 'translate_email' 50 000);
 *   fake     — без интернета, «[xx] текст»: только для проверок на своём компьютере.
 * Механизм тот же, что в Allservice (app/admin/translate.php), плюс Gemini.
 *
 * Тексты на языках хранятся как jsonb {"ru": "…", "en": "…"}:
 *   i18n_pick($map, $lang)                       — текст на языке, иначе на английском, иначе любой;
 *   i18n_complete($map, $langs, $src)            — дописать недостающие языки переводом;
 *   i18n_rows_on_the_fly($table, $rows, $col, …) — перевод на лету с записью в ту же строку;
 *   i18n_fill_hotel($hotelId, $langs)            — дописать языки во все справочники отеля.
 * Свободный текст без jsonb (заметки) — translate_cached(): кеш в translation_cache.
 */
require_once __DIR__ . '/gemini_ocr.php';

const TR_GOOGLE_URL = 'https://translation.googleapis.com/language/translate/v2';
const TR_GOOGLE_BATCH = 100;
const TR_MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const TR_MYMEMORY_PARALLEL = 8;
const TR_MYMEMORY_MAX_BYTES = 450;
const TR_GEMINI_MODEL = 'gemini-flash-lite-latest';

function translate_provider(): string
{
    $want = (string)(app_config()['translate_provider'] ?? 'auto');
    if ($want !== 'auto') return $want;
    if (GeminiOCR::secret('google_translate_key') !== '') return 'google';
    if (GeminiOCR::secret('gemini_api_key') !== '') return 'gemini';
    return 'mymemory';
}

/**
 * Переводит тексты, сохраняя ключи. $from = '' — язык определить самим.
 * @throws RuntimeException с ошибкой сервиса
 */
function translate_texts(array $texts, string $from, string $to): array
{
    $texts = array_filter($texts, fn($t) => trim((string)$t) !== '');
    if (!$texts || $from === $to) return $texts;
    switch (translate_provider()) {
        case 'google': return translate_google($texts, $from, $to);
        case 'gemini': return translate_gemini($texts, $from, $to);
        case 'fake':   return array_map(fn($t) => "[$to] $t", $texts);
        default:       return translate_mymemory_split($texts, $from, $to);
    }
}

function translate_lang_name(string $code): string
{
    $l = app_languages()[$code] ?? null;
    return $l ? "{$l['name']} ($code)" : $code;
}

function translate_gemini(array $texts, string $from, string $to): array
{
    $keys = array_keys($texts);
    $prompt = "You translate short texts for a hotel maintenance app (rooms, repairs, equipment, meters). "
        . "Translate each item of the JSON array " . ($from !== '' ? 'from ' . translate_lang_name($from) . ' ' : '')
        . "into " . translate_lang_name($to) . ". Keep numbers, room numbers, placeholders like {1}, {app}, %s and emoji exactly as they are. "
        . "Answer with a JSON array of strings only, same length and order.\n\n"
        . json_encode(array_values($texts), JSON_UNESCAPED_UNICODE);
    $body = json_encode([
        'contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]],
        'generationConfig' => ['temperature' => 0.1, 'responseMimeType' => 'application/json'],
    ], JSON_UNESCAPED_UNICODE);
    $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models/' . TR_GEMINI_MODEL . ':generateContent');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . GeminiOCR::secret('gemini_api_key')],
    ]);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $data = is_string($res) ? json_decode($res, true) : null;
    $raw = $data['candidates'][0]['content']['parts'][0]['text'] ?? null;
    $arr = is_string($raw) ? json_decode($raw, true) : null;
    if ($code !== 200 || !is_array($arr) || count($arr) !== count($keys)) {
        throw new RuntimeException('Gemini: ' . ($data['error']['message'] ?? ($err ?: "HTTP $code")));
    }
    $out = [];
    foreach ($keys as $i => $k) $out[$k] = trim((string)$arr[$i]);
    return $out;
}

function translate_google(array $texts, string $from, string $to): array
{
    $out = [];
    foreach (array_chunk($texts, TR_GOOGLE_BATCH, true) as $chunk) {
        $body = http_build_query(['target' => $to, 'format' => 'text'] + ($from !== '' ? ['source' => $from] : []));
        foreach ($chunk as $text) $body .= '&q=' . rawurlencode($text);
        $ch = curl_init(TR_GOOGLE_URL . '?key=' . rawurlencode(GeminiOCR::secret('google_translate_key')));
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        $data = is_string($res) ? json_decode($res, true) : null;
        if ($code !== 200 || !isset($data['data']['translations'])) {
            throw new RuntimeException('Google: ' . ($data['error']['message'] ?? ($err ?: "HTTP $code")));
        }
        foreach (array_keys($chunk) as $i => $k) {
            $out[$k] = trim(html_entity_decode($data['data']['translations'][$i]['translatedText'] ?? '', ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }
    }
    return $out;
}

// MyMemory берёт не больше 500 байт за раз: длинные тексты переводятся по кускам и склеиваются
function translate_mymemory_split(array $texts, string $from, string $to): array
{
    $pieces = [];
    foreach ($texts as $k => $text) {
        foreach (translate_split($text, TR_MYMEMORY_MAX_BYTES) as $i => $piece) $pieces["$k\x1f$i"] = $piece;
    }
    $out = array_fill_keys(array_keys($texts), '');
    foreach (translate_mymemory($pieces, $from, $to) as $key => $done) {
        [$k, $i] = explode("\x1f", (string)$key);
        $k = array_key_exists($k, $out) ? $k : (int)$k;
        $out[$k] .= ($i === '0' ? '' : ($pieces[$key][0] === "\n" ? "\n" : ' ')) . $done;
    }
    return $out;
}

function translate_split(string $text, int $max): array
{
    if (strlen($text) <= $max) return [$text];
    $parts = [];
    foreach (preg_split('/\R+/u', $text) as $p => $para) {
        $lead = $p > 0 ? "\n" : '';
        $buf = '';
        foreach (preg_split('/\s+/u', $para, -1, PREG_SPLIT_NO_EMPTY) as $word) {
            if ($buf !== '' && strlen($buf) + 1 + strlen($word) > $max) {
                $parts[] = $lead . $buf;
                $lead = '';
                $buf = '';
            }
            $buf = $buf === '' ? mb_strcut($word, 0, $max) : "$buf $word";
        }
        if ($buf !== '') $parts[] = $lead . $buf;
    }
    return $parts;
}

function translate_mymemory(array $texts, string $from, string $to): array
{
    $email = (string)(app_config()['translate_email'] ?? '');
    @set_time_limit(300);
    $out = [];
    foreach (array_chunk($texts, TR_MYMEMORY_PARALLEL, true) as $chunk) {
        $mh = curl_multi_init();
        $handles = [];
        foreach ($chunk as $k => $text) {
            $query = ['q' => $text, 'langpair' => ($from !== '' ? $from : 'autodetect') . "|$to"] + ($email !== '' ? ['de' => $email] : []);
            $ch = curl_init(TR_MYMEMORY_URL . '?' . http_build_query($query));
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
            curl_multi_add_handle($mh, $ch);
            $handles[$k] = $ch;
        }
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) curl_multi_select($mh);
        } while ($running && $status === CURLM_OK);
        $error = '';
        foreach ($handles as $k => $ch) {
            $data = json_decode((string)curl_multi_getcontent($ch), true);
            $text = $data['responseData']['translatedText'] ?? '';
            $code = (int)($data['responseStatus'] ?? curl_getinfo($ch, CURLINFO_HTTP_CODE));
            if ($code !== 200 || $text === '' || str_starts_with($text, 'MYMEMORY WARNING')) {
                $error = $data['responseDetails'] ?? ($text ?: (curl_error($ch) ?: "HTTP $code"));
            }
            $out[$k] = trim(html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
        if ($error !== '') throw new RuntimeException('MyMemory: ' . $error);
    }
    return $out;
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
const I18N_HOTEL_DICTS = ['asset_dictionary', 'room_checklist_dict', 'routine_tasks'];

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
