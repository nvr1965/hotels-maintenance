<?php
namespace Hotels\Translation\Providers;

use Hotels\Translation\Settings;
use RuntimeException;
use Throwable;

/** LibreTranslate: открытый код, можно поднять на своём сервере бесплатно (или взять чужой с ключом). */
class LibreTranslate extends Provider
{
    public function __construct(private string $url, private ?string $apiKey = null) {}

    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        $body = json_encode(array_filter([
            'q' => array_values($texts), 'source' => $sourceLocale ?: 'auto', 'target' => $targetLocale,
            'format' => 'text', 'api_key' => $this->apiKey,
        ]), JSON_UNESCAPED_UNICODE);
        [$code, $json] = self::http('POST', rtrim($this->url, '/') . '/translate', ['Content-Type: application/json'], $body, 60);
        $done = $json['translatedText'] ?? null;
        if ($code !== 200) throw self::fail('LibreTranslate', $code, $json);
        if (!is_array($done) || count($done) !== count($texts)) throw new RuntimeException('LibreTranslate returned an unexpected answer');
        return array_map('strval', $done);
    }

    public function supports(string $locale): bool
    {
        try {
            $codes = Settings::remember('libretranslate.languages', 86400, function () {
                [$code, $json] = self::http('GET', rtrim($this->url, '/') . '/languages', [], null, 10);
                if ($code !== 200 || !is_array($json)) throw self::fail('LibreTranslate', $code, $json);
                return array_column($json, 'code');
            });
        } catch (Throwable) {
            return true;
        }
        return in_array($locale, $codes, true);
    }

    public function name(): string
    {
        return 'libretranslate';
    }
}
