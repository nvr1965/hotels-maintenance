<?php
namespace Hotels\Translation\Providers;

use RuntimeException;

/** Google Cloud Translation: больше 100 языков; первые 500 000 знаков в месяц бесплатно. */
class Google extends Provider
{
    public function __construct(private string $apiKey) {}

    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        $out = [];
        foreach (array_chunk(array_values($texts), 100) as $chunk) {
            // Несколько текстов — несколько полей q, обычный массив формы так не умеет
            $body = http_build_query(array_filter(['target' => $targetLocale, 'source' => $sourceLocale, 'format' => 'text']))
                . '&' . implode('&', array_map(fn($t) => 'q=' . rawurlencode($t), $chunk));
            [$code, $json] = self::http('POST', 'https://translation.googleapis.com/language/translate/v2?key=' . rawurlencode($this->apiKey),
                ['Content-Type: application/x-www-form-urlencoded'], $body);
            $done = $json['data']['translations'] ?? null;
            if ($code !== 200 || !is_array($done)) throw self::fail('Google', $code, $json);
            if (count($done) !== count($chunk)) throw new RuntimeException('Google returned an unexpected answer');
            foreach ($done as $item) $out[] = html_entity_decode((string)$item['translatedText'], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }
        return $out;
    }

    public function name(): string
    {
        return 'google';
    }
}
