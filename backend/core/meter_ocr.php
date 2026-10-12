<?php
// Распознавание фото счётчика через Gemini — общее для страницы загрузки (meter_upload.php)
// и вкладки «Нераспознанные счётчики» (meter_pending.php).

// Не чаще одного запроса к Gemini раз в METER_OCR_GAP секунд — с этой страницы и с любой вкладки.
// Бесплатный ключ ограничен числом запросов в минуту: три фото разом + повторы и дают 429.
const METER_OCR_GAP = 6;
function meter_ocr_pace(): void
{
    $f = @fopen(sys_get_temp_dir() . '/hotelapp_meter_ocr.lock', 'c+');
    if (!$f) return;
    flock($f, LOCK_EX);
    $last = (float)stream_get_contents($f);
    $wait = $last + METER_OCR_GAP - microtime(true);
    if ($wait > 0) usleep((int)($wait * 1e6));
    ftruncate($f, 0); rewind($f); fwrite($f, (string)microtime(true)); fflush($f);
    flock($f, LOCK_UN);
    fclose($f);
}

// Что именно ответил Google на 429: лимит в минуту или на сутки, и через сколько секунд можно снова
function meter_ocr_limit(string $raw): array
{
    $j = json_decode($raw, true);
    $kind = 'minute';
    $retry = 60;
    foreach ($j['error']['details'] ?? [] as $d) {
        foreach ($d['violations'] ?? [] as $v) {
            if (stripos((string)($v['quotaId'] ?? ''), 'PerDay') !== false) $kind = 'day';
        }
        if (isset($d['retryDelay']) && preg_match('/^(\d+)/', (string)$d['retryDelay'], $m)) $retry = max(5, (int)$m[1] + 2);
    }
    if (stripos((string)($j['error']['message'] ?? ''), 'per day') !== false) $kind = 'day';
    return [$kind, min($retry, 120)];
}

function meter_ocr(string $path, array $meter): array
{
    require_once __DIR__ . '/../core/gemini_ocr.php';
    $t0 = microtime(true);
    meter_ocr_pace();
    $r = GeminiOCR::read($path, (string)$meter['ocr_type'], 'ru');
    $err = (string)($r['error'] ?? '');
    // 503 и т.п. — Google временно перегружен: одна спокойная повторная попытка через 10 сек (лимит такие не тратят)
    if ($r['value'] === null && preg_match('/HTTP 5\d\d/', $err)) {
        sleep(10);
        meter_ocr_pace();
        $r = GeminiOCR::read($path, (string)$meter['ocr_type'], 'ru');
        $err = (string)($r['error'] ?? '');
    }
    $out = ['value' => $r['value'], 'unit' => $r['unit'] ?: $meter['unit'], 'error' => $r['error'] ?? null,
            'engine' => $r['engine'] ?? 'gemini', 'limit' => null, 'retry_after' => null];
    if ($r['value'] === null && str_contains($err, '429')) {
        [$kind, $retry] = meter_ocr_limit((string)($r['raw'] ?? ''));
        $out['limit'] = $kind;
        $out['retry_after'] = $kind === 'minute' ? $retry : null;
        $out['error'] = $kind === 'day'
            ? 'Дневной бесплатный лимит Gemini исчерпан (429). Он обновится в полночь по тихоокеанскому времени США. До этого введите цифры вручную'
            : 'Лимит Gemini в минуту (429)';
    } elseif ($r['value'] === null && preg_match('/HTTP (5\d\d)/', $err, $m)) {
        $out['error'] = "Сервер Gemini (Google) сейчас перегружен ($m[1]). Нажмите «Распознать ещё раз» через минуту-две или введите цифры вручную";
    }
    $out['ms'] = (int)round((microtime(true) - $t0) * 1000);
    return $out;
}
