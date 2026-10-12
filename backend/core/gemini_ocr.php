<?php
// GeminiOCR - считывание показаний счётчиков через Gemini
// require_once '../core/gemini_ocr.php';
// $result = GeminiOCR::read($absPath, $ocrType, $lang);

class GeminiOCR
{
    // Ключи — в backend/core/secrets.php (в пакеты не входит):
    //   <?php return ['gemini_api_key' => '...', 'openrouter_api_key' => ''];
    public static function secret(string $name): string
    {
        static $s = null;
        if ($s === null) {
            $f = __DIR__ . '/secrets.php';
            $s = is_file($f) ? require $f : [];
            if (!is_array($s)) $s = [];
        }
        return (string)($s[$name] ?? '');
    }
    // Тестируем сейчас только gemini-3.5-flash в чистом виде (без второй модели), чтобы оценить
    // именно её точность саму по себе. Другие варианты на всякий случай оставлены в комментарии:
    // 'gemini-flash-lite-latest' — лёгкая, высокий лимит
    // 'gemini-2.5-flash'         — предыдущая рабочая версия
    const MODEL   = 'gemini-3.5-flash';
    const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' . self::MODEL . ':generateContent?key=';
    const TIMEOUT     = 25;
    const RETRY_COUNT = 2;
    const RETRY_DELAY = 3000;

    // ---- Второй проход через Qwen/OpenRouter — ВРЕМЕННО ОТКЛЮЧЁН ----
    // Пока тестируем чистый gemini-3.5-flash отдельно (соединение с openrouter.ai с этого сервера
    // было медленным/нестабильным и путало картину тестов). Весь код второй модели оставлен как есть —
    // чтобы включить обратно, просто поставьте true.
    const ENABLE_QWEN_CROSSCHECK = false;
    // Бесплатный ключ: openrouter.ai -> Sign up -> Keys -> Create key (карта не нужна).
    // Пока здесь плейсхолдер — вставьте свой ключ, иначе второй проход просто пропускается.
    // Бесплатный каталог OpenRouter меняется практически ежедневно — модели, рабочие вчера,
    // сегодня могут отдавать 404. Поэтому список моделей не хранится тут: read() запрашивает
    // его у самого OpenRouter (см. fetchFreeVisionModels) и пробует по порядку.
    // Этот список — только аварийный запасной вариант, если сам запрос списка не удался.
    const OPENROUTER_FALLBACK_MODELS = [
        'openrouter/free',
        'google/gemma-3-27b-it:free',
        'qwen/qwen2.5-vl-32b-instruct:free',
    ];
    const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
    const OPENROUTER_URL        = 'https://openrouter.ai/api/v1/chat/completions';
    const OPENROUTER_MODELS_CACHE_FILE = __DIR__ . '/.openrouter_free_vision_models.json';
    const OPENROUTER_MODELS_CACHE_TTL  = 3600; // сек — не спрашивать список чаще раза в час
    const OPENROUTER_MAX_ATTEMPTS      = 3;    // не пробовать больше N моделей подряд (иначе работник долго ждёт)
    // ВАЖНО: с вашего сервера соединение к openrouter.ai само по себе устанавливается медленно —
    // при таймауте 15 сек обрывались ВСЕ запросы подряд (у разных моделей, ~55 байт и обрыв на 15 сек
    // у каждой — явный признак, что дело в сети, а не в конкретной модели). 25 сек — минимум, который
    // реально работал (тот самый первый успешный HTTP 200 от openrouter/free был именно на нём).
    const OPENROUTER_TIMEOUT           = 25;

    public static function read(string $imagePath, string $ocrType = 'generic', string $lang = 'ru'): array
    {
        if (str_starts_with($imagePath, '/uploads/')) {
            $imagePath = __DIR__ . '/../../' . ltrim($imagePath, '/');
        }
        if (!file_exists($imagePath)) {
            return self::err("Файл не найден: $imagePath");
        }

        $prompt = self::buildPrompt($ocrType, $lang);
        // Стрелочный манометр и цифровой Octave выигрывают от небольшого «мышления»
        $thinking = in_array($ocrType, ['gas_percent', 'water_m3'], true) ? 1024 : 0;

        // Для газа и Octave сначала находим прибор в кадре и вырезаем его крупным планом
        // (из оригинального фото — так цифры и стрелка получаются намного чётче).
        $imageData = self::cropToTarget($imagePath, $ocrType);
        if ($imageData !== null) {
            $prompt .= "\n\nИзображение уже обрезано по нужному прибору и увеличено — читай показание с него.";
        } else {
            $imageData = self::resizeAndEncode($imagePath);
        }

        $body = json_encode([
            'contents' => [[
                'parts' => [
                    ['text' => $prompt],
                    ['inline_data' => ['mime_type' => 'image/jpeg', 'data' => $imageData]]
                ]
            ]],
            'generationConfig' => [
                'temperature'     => 0.0,
                'maxOutputTokens' => $thinking > 0 ? 3072 : 256,
                'thinkingConfig'  => ['thinkingBudget' => $thinking],
            ]
        ]);

        [$httpCode, $raw, $curlErr] = self::post($body);

        if ($curlErr)          return self::err("CURL: $curlErr");
        if ($httpCode === 429) return self::err("Превышен лимит Gemini API (429). Попробуйте позже.", (string)$raw);
        if ($httpCode !== 200) return self::err("HTTP $httpCode от Gemini API", (string)$raw);

        $text = self::extractText($raw);
        $geminiResult = self::parseResponse($text, $ocrType, $raw);

        // Всегда спрашиваем и Qwen2.5-VL — независимый второй взгляд на то же самое фото.
        // Если оба сошлись — доверяем. Если разошлись — Gemini один раз УЖЕ был уверенно неправ
        // на реальных показаниях (85 вместо 87, обрезанные цифры и т.п.), поэтому в случае
        // расхождения лучше честно попросить работника ввести вручную, чем подставить
        // случайно выбранное из двух чисел.
        $qwenResult = null;
        if (self::ENABLE_QWEN_CROSSCHECK && self::secret('openrouter_api_key') !== '') {
            $qwenResult = self::readWithQwen($prompt, $imageData, $ocrType);
        }

        return self::combineResults($geminiResult, $qwenResult);
    }

    // Сверяет результаты двух моделей. Совпали — используем (значения из Gemini, с пометкой).
    // Разошлись — не доверяем ни одному, просим работника проверить вручную (с обоими числами в error,
    // чтобы было видно, что именно не сошлось). Ответил только один — используем его, а причину
    // молчания второго кладём в engine, чтобы было видно в окне проверки и в БД (ocr_raw).
    private static function combineResults(array $gemini, ?array $qwen): array
    {
        $gv = $gemini['value'];
        $qv = $qwen['value'] ?? null;
        $qwenErr = $qwen['qwen_error'] ?? ($qwen === null ? 'сверка временно отключена (ENABLE_QWEN_CROSSCHECK = false)' : null);

        if ($gv !== null && $qv !== null) {
            if ((string)$gv === (string)$qv) {
                $modelUsed = $qwen['qwen_model'] ?? 'qwen';
                $gemini['engine'] = "gemini+$modelUsed (совпали)";
                return $gemini;
            }
            return [
                'value' => null,
                'unit'  => $gemini['unit'] ?: ($qwen['unit'] ?? ''),
                'raw'   => $gemini['raw'],
                'error' => "Gemini прочитал $gv, Qwen прочитал $qv — показания разошлись, введите вручную",
                'engine' => 'gemini vs qwen (расхождение)',
            ];
        }

        if ($gv !== null) {
            $gemini['engine'] = $qwenErr ? "gemini (qwen: $qwenErr)" : 'gemini (qwen не распознал)';
            return $gemini;
        }
        if ($qv !== null) {
            $modelUsed = $qwen['qwen_model'] ?? 'qwen';
            $qwen['engine'] = "$modelUsed (gemini не смог)";
            return $qwen;
        }

        $gemini['engine'] = $qwenErr ? "gemini+qwen оба не смогли (qwen: $qwenErr)" : 'gemini+qwen (оба не смогли)';
        return $gemini;
    }

    // Спрашивает у самого OpenRouter, какие модели СЕЙЧАС бесплатны (pricing.prompt == 0)
    // и умеют принимать картинку (architecture.input_modalities содержит "image").
    // Кэширует на час в файл рядом, чтобы не дёргать /models на каждое фото.
    // Версия логики фильтрации — поднимайте при изменении правил отбора моделей,
    // чтобы старый закэшированный (по прежним правилам) список не использовался ещё час.
    const OPENROUTER_MODELS_CACHE_VERSION = 2;

    private static function fetchFreeVisionModels(): array
    {
        $cacheFile = self::OPENROUTER_MODELS_CACHE_FILE;
        if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < self::OPENROUTER_MODELS_CACHE_TTL) {
            $cached = json_decode((string)file_get_contents($cacheFile), true);
            if (is_array($cached) && ($cached['v'] ?? 0) === self::OPENROUTER_MODELS_CACHE_VERSION && !empty($cached['models'])) {
                return $cached['models'];
            }
        }

        $ch = curl_init(self::OPENROUTER_MODELS_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . self::secret('openrouter_api_key')],
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $raw = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($httpCode !== 200) return [];

        $json = json_decode((string)$raw, true);
        $models = [];
        foreach (($json['data'] ?? []) as $m) {
            $promptPrice = (float)($m['pricing']['prompt'] ?? 1);
            $completionPrice = (float)($m['pricing']['completion'] ?? 1);
            $inputModalities = $m['architecture']['input_modalities'] ?? [];
            $isStealth = str_starts_with((string)($m['id'] ?? ''), 'stealth/');
            if ($promptPrice === 0.0 && $completionPrice === 0.0 && in_array('image', $inputModalities, true) && !$isStealth) {
                $models[] = $m['id'];
            }
        }

        if (!empty($models)) {
            @file_put_contents($cacheFile, json_encode(['v' => self::OPENROUTER_MODELS_CACHE_VERSION, 'models' => $models]));
        }
        return $models;
    }

    // Второй проход через бесплатную vision-модель (OpenRouter).
    // Тот же промпт и то же уже обрезанное/увеличенное фото, что и для Gemini.
    // Возвращает массив ВСЕГДА (никогда null), даже при ошибке — 'qwen_error' описывает,
    // что именно пошло не так (видно в диагностической строке 🔧 в окне проверки и в БД).
    // Список моделей — живой (fetchFreeVisionModels), плюс аварийный запасной в конце.
    private static function readWithQwen(string $prompt, string $imageData, string $ocrType): array
    {
        $errors = [];

        $candidates = array_values(array_unique(array_merge(
            ['openrouter/free'], // сначала всегда сам умный роутер — он быстрее и обычно достаточно
            self::fetchFreeVisionModels(),
            self::OPENROUTER_FALLBACK_MODELS
        )));
        $candidates = array_slice($candidates, 0, self::OPENROUTER_MAX_ATTEMPTS);

        foreach ($candidates as $model) {
            $body = json_encode([
                'model' => $model,
                'temperature' => 0.0,
                // Многие бесплатные модели сейчас — «размышляющие» (длинный reasoning перед самим
                // ответом), и 1500 токенов регулярно не хватает — обрывается на середине размышлений,
                // так и не дойдя до content. Даём заметно больше запаса.
                'max_tokens' => 4096,
                'messages' => [[
                    'role' => 'user',
                    'content' => [
                        ['type' => 'text', 'text' => $prompt],
                        ['type' => 'image_url', 'image_url' => ['url' => 'data:image/jpeg;base64,' . $imageData]],
                    ],
                ]],
            ]);

            $ch = curl_init(self::OPENROUTER_URL);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_HTTPHEADER     => [
                    'Content-Type: application/json',
                    'Authorization: Bearer ' . self::secret('openrouter_api_key'),
                ],
                CURLOPT_TIMEOUT        => self::OPENROUTER_TIMEOUT,
                CURLOPT_SSL_VERIFYPEER => true,
            ]);
            $raw = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlErr = curl_error($ch);
            curl_close($ch);

            if ($curlErr) { $errors[] = "$model — CURL: $curlErr"; continue; }
            if ($httpCode !== 200) {
                $j = json_decode((string)$raw, true);
                $apiMsg = $j['error']['message'] ?? substr((string)$raw, 0, 150);
                $errors[] = "$model — HTTP $httpCode: $apiMsg";
                continue;
            }

            $json = json_decode((string)$raw, true);
            $text = trim($json['choices'][0]['message']['content'] ?? '');
            if ($text === '') {
                $finishReason = $json['choices'][0]['finish_reason'] ?? '?';
                $errors[] = "$model — пустой ответ (finish_reason: $finishReason)";
                continue;
            }

            $result = self::parseResponse($text, $ocrType, (string)$raw);
            $result['qwen_error'] = null;
            $result['qwen_model'] = $model;
            return $result;
        }

        // Ни одна модель из списка не ответила
        return ['value' => null, 'unit' => '', 'raw' => '', 'error' => null, 'qwen_error' => implode(' | ', $errors)];
    }

    // Отправка запроса в Gemini с повтором при 429. Возвращает [httpCode, raw, curlError]
    private static function post(string $body): array
    {
        $raw      = null;
        $httpCode = 0;
        $curlErr  = '';

        for ($attempt = 0; $attempt <= self::RETRY_COUNT; $attempt++) {
            if ($attempt > 0) usleep(self::RETRY_DELAY * 1000);
            $ch = curl_init(self::API_URL . urlencode(self::secret('gemini_api_key')));
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_TIMEOUT        => self::TIMEOUT,
                CURLOPT_SSL_VERIFYPEER => true,
            ]);
            $raw      = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlErr  = curl_error($ch);
            curl_close($ch);
            if ($httpCode === 200) break;
            // 429 (лимит) и любой 5xx (503 и т.п. — временная перегрузка Google) стоит повторить.
            // Остальное (400/403/404 — ошибка запроса/ключа) повторять бессмысленно, сдаёмся сразу.
            $isTransient = $httpCode === 429 || ($httpCode >= 500 && $httpCode < 600);
            if (!$isTransient) break;
        }
        return [$httpCode, $raw, $curlErr];
    }

    // Склеивает текстовые части ответа (части «thought» пропускает)
    private static function extractText($raw): string
    {
        $json = json_decode((string)$raw, true);
        $text = '';
        foreach (($json['candidates'][0]['content']['parts'] ?? []) as $part) {
            if (!empty($part['thought'])) continue;
            $text .= $part['text'] ?? '';
        }
        return trim($text);
    }

    // Находит прибор на фото (Gemini возвращает рамку) и вырезает его из оригинала.
    // Возвращает base64 JPEG или null — тогда используется полное фото.
    private static function cropToTarget(string $path, string $ocrType): ?string
    {
        $targets = [
            'gas_percent' => 'the small round white Rochester Gauges level indicator dial (labelled "% TOT. VOL.") including its whole glass face; NOT the larger pressure gauge',
            'water_m3'    => 'the liquid-crystal display panel of the water meter with all its digits (it may be rotated)',
        ];
        if (!isset($targets[$ocrType])) return null;

        $src = self::loadOriented($path);
        if (!$src) return null;
        $w = imagesx($src);
        $h = imagesy($src);

        // Уменьшенная копия для поиска
        $small = self::scaleTo($src, 1024);
        ob_start();
        imagejpeg($small, null, 85);
        $smallB64 = base64_encode(ob_get_clean());
        if ($small !== $src) imagedestroy($small);

        $detectPrompt = 'Find ' . $targets[$ocrType] . ' in this photo. '
            . 'Return ONLY JSON like {"box_2d":[ymin,xmin,ymax,xmax]} with integer coordinates normalized to 0-1000. '
            . 'The box must fully contain the object.';
        $body = json_encode([
            'contents' => [[
                'parts' => [
                    ['text' => $detectPrompt],
                    ['inline_data' => ['mime_type' => 'image/jpeg', 'data' => $smallB64]]
                ]
            ]],
            'generationConfig' => [
                'temperature'      => 0.0,
                'maxOutputTokens'  => 256,
                'responseMimeType' => 'application/json',
                'thinkingConfig'   => ['thinkingBudget' => 0],
            ]
        ]);

        [$code, $raw, $err] = self::post($body);
        if ($err || $code !== 200) { imagedestroy($src); return null; }

        $det = json_decode(self::extractText($raw), true);
        $box = null;
        if (is_array($det)) {
            if (isset($det['box_2d']))            $box = $det['box_2d'];
            elseif (isset($det[0]['box_2d']))     $box = $det[0]['box_2d'];
            elseif (count($det) === 4 && isset($det[0]) && is_numeric($det[0])) $box = $det;
        }
        if (!is_array($box) || count($box) !== 4) { imagedestroy($src); return null; }
        [$ymin, $xmin, $ymax, $xmax] = array_map('floatval', array_values($box));
        if ($ymax <= $ymin || $xmax <= $xmin) { imagedestroy($src); return null; }

        // Отступ 10% вокруг рамки, чтобы не срезать края прибора
        $bw = ($xmax - $xmin) / 1000 * $w;
        $bh = ($ymax - $ymin) / 1000 * $h;
        $x0 = max(0, (int)floor($xmin / 1000 * $w - $bw * 0.10));
        $y0 = max(0, (int)floor($ymin / 1000 * $h - $bh * 0.10));
        $x1 = min($w, (int)ceil($xmax / 1000 * $w + $bw * 0.10));
        $y1 = min($h, (int)ceil($ymax / 1000 * $h + $bh * 0.10));
        $cw = $x1 - $x0;
        $ch = $y1 - $y0;

        // Защита от явно неверной рамки: слишком мелкая — читаем полное фото
        if ($cw < 80 || $ch < 80 || ($cw * $ch) < 0.02 * $w * $h) { imagedestroy($src); return null; }

        $crop = imagecrop($src, ['x' => $x0, 'y' => $y0, 'width' => $cw, 'height' => $ch]);
        imagedestroy($src);
        if (!$crop) return null;

        $out = self::scaleTo($crop, 1600);
        ob_start();
        imagejpeg($out, null, 92);
        $b64 = base64_encode(ob_get_clean());
        if ($out !== $crop) imagedestroy($out);
        imagedestroy($crop);
        return $b64;
    }

    // Загружает изображение и применяет поворот по EXIF (GD его не учитывает сам)
    private static function loadOriented(string $path)
    {
        if (!function_exists('imagecreatefromjpeg')) return null;
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $src = match($ext) {
            'png'  => @imagecreatefrompng($path),
            'webp' => @imagecreatefromwebp($path),
            'gif'  => @imagecreatefromgif($path),
            default => @imagecreatefromjpeg($path),
        };
        if (!$src) return null;

        if (in_array($ext, ['jpg', 'jpeg']) && function_exists('exif_read_data')) {
            $exif = @exif_read_data($path);
            $orientation = $exif['Orientation'] ?? 1;
            $deg = match((int)$orientation) { 3 => 180, 6 => -90, 8 => 90, default => 0 };
            if ($deg !== 0) {
                $rot = imagerotate($src, $deg, 0);
                if ($rot) { imagedestroy($src); $src = $rot; }
            }
        }
        return $src;
    }

    // Уменьшает изображение так, чтобы большая сторона была не больше $max. Иначе возвращает то же самое.
    private static function scaleTo($img, int $max)
    {
        $w = imagesx($img);
        $h = imagesy($img);
        if ($w <= $max && $h <= $max) return $img;
        if ($w > $h) { $nw = $max; $nh = (int)round($h * $max / $w); }
        else         { $nh = $max; $nw = (int)round($w * $max / $h); }
        $dst = imagecreatetruecolor($nw, $nh);
        imagecopyresampled($dst, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
        return $dst;
    }

    private static function buildPrompt(string $ocrType, string $lang): string
    {
        $langHint = match($lang) {
            'en' => 'Reply strictly in English.',
            'he' => 'ענה אך ורק בעברית.',
            'ar' => 'أجب باللغة العربية فقط.',
            default => 'Отвечай строго на русском.',
        };

        $typeHint = match($ocrType) {
            'gas_percent' =>
                'На фото — уровнемер сжиженного газа LPG Rochester Gauges (S-01826B): маленький БЕЛЫЙ круглый циферблат с надписью «% TOT. VOL.».'
                . ' Читай ТОЛЬКО его. Все остальные приборы в кадре (в том числе БОЛЬШОЙ манометр давления SHUNA с bar/psi и его чёрная стрелка), жёлтые колпаки, трубки — ИГНОРИРУЙ.'
                . "\n"
                . ' УСТРОЙСТВО ЦИФЕРБЛАТА: числа напечатаны по дуге ПО ЧАСОВОЙ стрелке: 5 (внизу слева), 10, 20, 30, 40 (примерно вверху), 50, 60, 70, 80, 85 (красное MAX), 90, 95 (внизу справа).'
                . ' ВАЖНО: красная надпись «MAX•85» — тоже ОБЫЧНАЯ отметка шкалы (85%), а не служебный текст. Возле каждого числа есть маленькая точка-отметка; для 85 это точка перед «MAX».'
                . ' Если остриё указывает на эту точку или на надпись MAX•85 — ответ 85, а не 80 и не 90.'
                . ' Красная дуга слева (от 5 до 20) — закрашенная зона низкого уровня, она НЕ стрелка. Между числами есть мелкие точки-отметки.'
                . ' В центре тёмная круглая втулка (магнит) — не стрелка.'
                . ' СТРЕЛКА — тёмный конусный указатель, выходящий из втулки. У неё длинное острое остриё и короткий противовес-хвостик с противоположной стороны.'
                . ' Читай по ОСТРИЮ (оно тянется к числам), хвостик игнорируй.'
                . "\n"
                . ' КАК ЧИТАТЬ: 1) найди остриё стрелки; 2) определи, на какую точку-отметку оно указывает (у каждого числа, включая MAX•85, есть своя точка); 3) назови число этой отметки.'
                . ' ПО УМОЛЧАНИЮ выбирай ЦЕЛОЕ напечатанное число той отметки, на которую указывает остриё (5,10,20,30,40,50,60,70,80,85,90,95) — не придумывай промежуточное значение «на глаз».'
                . ' Промежуточное значение (не кратное отметкам шкалы) допустимо ТОЛЬКО если остриё находится явно и заметно (больше чем на четверть интервала) между двумя соседними отметками — и то, предпочитай круглые числа вроде 5, а не случайные вроде 87.'
                . ' Если сомневаешься, ближе остриё к отметке A или чуть дальше — выбирай саму отметку A, а не число между A и B.'
                . ' Опирайся на напечатанные числа и точки-отметки, а НЕ на положение «как на часах» — шкала несимметрична.'
                . "\n"
                . ' ФОРМАТ ОТВЕТА: одна короткая строка — между какими числами стрелка, затем ПОСЛЕДНЕЙ строкой: ANSWER: <целое число> (или ANSWER: NULL).',

            'water_m3' =>
                'На фото — цифровой водосчётчик Octave: ЖК-дисплей (тёмно-зелёный, возможны блики и пыль).'
                . ' ВАЖНО: снимок может быть повёрнут на 90° или перевёрнут (цифры идут снизу вверх или сверху вниз).'
                . ' Сначала мысленно поверни изображение так, чтобы цифры читались слева направо, и только потом читай.'
                . ' Бледные, едва заметные сегменты — это НЕ горящие сегменты дисплея (пустые разряды), не считай их цифрами.'
                . ' ВЕРХНЯЯ (после поворота) строка — накопленный объём в м³ (крупные цифры; справа в конце — маленькая приподнятая цифра и единица m³).'
                . ' Самая левая цифра может быть обрезана краем дисплея — это ведущий ноль, он не важен.'
                . ' Мелкие точки и запятые между цифрами — разделители разрядов, а не десятичная точка.'
                . ' Все КРУПНЫЕ цифры одного размера — это целая часть, НИ ОДНУ крупную цифру не отбрасывай (ни первую значащую, ни последнюю крупную).'
                . ' Десятые доли — ОДНА отдельная цифра, заметно МЕНЬШЕ остальных (примерно вдвое) и приподнятая к верхнему краю; только её не включай в ответ.'
                . ' СРЕДНЯЯ строка (например «14.13 m³/h») — это расход (скорость потока), СОВЕРШЕННО ДРУГОЕ число, не путай его с объёмом и никогда не бери из неё ни одной цифры для ответа. Нижние строки и наклейку с надписями (M25, 1781, S/N, 100 m³/h) — тоже ИГНОРИРУЙ.'
                . "\n"
                . ' ВАЖНО: верхняя и средняя строки физически разделены рамкой на дисплее — это два независимых счётчика, стоящих один под другим. Прежде чем читать цифры, сначала мысленно обведи ТОЛЬКО верхнюю строку (объём, м³) и полностью забудь про среднюю — цифры для ответа берутся только из этой верхней области.'
                . ' КАК ЧИТАТЬ: 1) глядя ТОЛЬКО на верхнюю строку, выпиши КАЖДУЮ её крупную цифру слева направо, включая нули (обычно их 8-9) и посчитай их — не заглядывай в среднюю строку на этом шаге; 2) отдельно отметь мелкую приподнятую цифру в конце верхней строки и отбрось только её; 3) убери ведущие нули слева.'
                . ' Обычно после нулей остаётся 4-6 значащих цифр. Если получилось меньше 4 — ты либо пропустил цифры, либо случайно взял их из средней строки; пересчитай, глядя только на верхнюю строку.'
                . ' Пример: крупные «0 0 0 0 1 8 5 0 7» (верхняя строка) и мелкая «6» → выписано 000018507 | 6 → ответ 18507 (все пять значащих цифр сохранены, средняя строка с расходом в ответ не попала).'
                . "\n"
                . ' ФОРМАТ ОТВЕТА: короткая строка с выписанными цифрами, затем ПОСЛЕДНЕЙ строкой: ANSWER: <целое число> (или ANSWER: NULL).',

            'water_arad' =>
                'На фото — механический водосчётчик ARAD M50.'
                . ' В верхней части циферблата прямоугольное окошко с барабанными цифрами, над ним m3.'
                . "\n"
                . ' ГЛАВНАЯ ОШИБКА, которую нужно избежать: НЕ отбрасывай последние цифры барабана как «дробную часть»,'
                . ' если только на самом окошке НЕТ явно напечатанной точки или запятой между цифрами.'
                . ' Три маленькие стрелочные шкалы снизу (x0.001, x0.01, x0.1) — это ОТДЕЛЬНЫЙ дополнительный циферблат тонких долей,'
                . ' они НЕ говорят о том, что у барабана есть скрытая дробная часть. Барабан сам по себе — цельное целое число.'
                . "\n"
                . ' Между соседними барабанами есть тёмные вертикальные зазоры-разделители.'
                . ' Эти зазоры НЕ являются цифрой "1" — не считай их за цифру!'
                . "\n"
                . ' КАК ЧИТАТЬ:'
                . ' 1. Посчитай, сколько всего барабанов-цифр в окошке (обычно 6-7), включая ведущие нули.'
                . ' 2. Если между какими-то двумя барабанами ЯВНО напечатана точка/запятая — всё, что ДО неё, это ответ; то, что ПОСЛЕ, отбрось.'
                . ' 3. Если точки/запятой НЕТ вообще — ответ это ВСЕ барабаны целиком, без исключений, только убери ведущие нули слева.'
                . "\n"
                . ' ПРИМЕР С ТОЧКОЙ: окошко «0198.21» → до точки 0198 → без ведущих нулей = 198.'
                . ' ПРИМЕР БЕЗ ТОЧКИ: окошко «019854» (6 барабанов, точки нет) → ответ = 19854 (все цифры, только убрали один ведущий ноль).'
                . "\n"
                . ' Три стрелки внизу (x0.001, x0.01, x0.1) для ответа не нужны — ИГНОРИРУЙ их.'
                . ' Верни ТОЛЬКО целое число. Никаких слов, единиц, пояснений.',

            'pressure_bar' =>
                'На фото — манометр давления.'
                . ' Найди значение стрелки в bar. Верни число и единицу, например: 2.5 bar',

            default =>
                'На фото — измерительный прибор. Найди главное числовое показание. Верни только цифру.',
        };

        return "Ты точный считыватель показаний приборов. $langHint\n\n$typeHint\n\nЕсли показание нечитаемо — верни NULL.";
    }

    private static function resizeAndEncode(string $path): string
    {
        $src = self::loadOriented($path);
        if (!$src) return base64_encode(file_get_contents($path));

        $out = self::scaleTo($src, 1280);
        ob_start();
        imagejpeg($out, null, 92);
        $b64 = base64_encode(ob_get_clean());
        if ($out !== $src) imagedestroy($out);
        imagedestroy($src);
        return $b64;
    }

    private static function parseResponse(string $text, string $ocrType, string $raw): array
    {
        // Промпты со строкой «ANSWER: ...» — берём последнюю такую строку
        if (preg_match_all('/ANSWER\s*:\s*(NULL|\d+(?:[.,]\d+)?)/i', $text, $am) && !empty($am[1])) {
            $text = end($am[1]);
        }
        if (strtoupper(trim($text)) === 'NULL' || $text === '') {
            return ['value' => null, 'unit' => '', 'raw' => $raw, 'error' => 'Gemini не смог прочитать показание'];
        }
        preg_match('/\d+(?:[.,]\d+)?/', $text, $m);
        $value = isset($m[0]) ? str_replace(',', '.', $m[0]) : null;

        $unit = match($ocrType) {
            'gas_percent'  => '%',
            'water_m3'     => 'm³',
            'water_arad'   => 'm³',
            'pressure_bar' => 'bar',
            default        => '',
        };
        if (preg_match('/\d+(?:[.,]\d+)?\s*(m³|m3|bar|psi|%)/i', $text, $um)) {
            $u = strtolower($um[1]);
            $unit = ($u === 'm3') ? 'm³' : $u;
        }
        return ['value' => $value, 'unit' => $unit, 'raw' => $raw, 'error' => null];
    }

    private static function err(string $msg, string $raw = ''): array
    {
        return ['value' => null, 'unit' => '', 'raw' => $raw, 'error' => $msg];
    }
}