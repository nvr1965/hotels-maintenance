<?php
namespace Hotels\Translation\Providers;

use Hotels\Translation\Settings;
use RuntimeException;
use Throwable;

/** DeepL: очень хорош для европейских языков; бесплатный план — 500 000 знаков в месяц. */
class DeepL extends Provider
{
    /** Для некоторых языков DeepL нужен региональный вариант. */
    private const TARGETS = ['en' => 'EN-GB', 'pt' => 'PT-PT', 'zh' => 'ZH-HANS'];

    public function __construct(private string $apiKey) {}

    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        $body = array_filter([
            'text' => array_values($texts),
            'target_lang' => self::TARGETS[$targetLocale] ?? strtoupper($targetLocale),
            'source_lang' => $sourceLocale ? strtoupper($sourceLocale) : null,
            'tag_handling' => 'html',
        ]);
        [$code, $json] = self::http('POST', $this->host() . '/v2/translate', $this->headers(['Content-Type: application/json']),
            json_encode($body, JSON_UNESCAPED_UNICODE));
        if ($code !== 200 || !isset($json['translations'])) throw self::fail('DeepL', $code, $json);
        $out = array_map(fn($t) => (string)$t['text'], $json['translations']);
        if (count($out) !== count($texts)) throw new RuntimeException('DeepL returned an unexpected answer');
        return $out;
    }

    /**
     * Переводит ли DeepL на язык — по его собственному списку (спрашиваем раз в день).
     * DeepL недоступен — отвечаем «да», чтобы короткий сбой ничего не блокировал.
     */
    public function supports(string $locale): bool
    {
        try {
            $targets = Settings::remember('deepl.targets', 86400, function () {
                [$code, $json] = self::http('GET', $this->host() . '/v2/languages?type=target', $this->headers());
                if ($code !== 200 || !is_array($json)) throw self::fail('DeepL', $code, $json);
                return array_values(array_unique(array_map(fn($l) => strtolower(explode('-', $l['language'])[0]), $json)));
            });
        } catch (Throwable) {
            return true;
        }
        return in_array(strtolower(explode('-', $locale)[0]), $targets, true);
    }

    private function headers(array $more = []): array
    {
        return array_merge(['Authorization: DeepL-Auth-Key ' . $this->apiKey], $more);
    }

    /** Ключи бесплатного плана кончаются на ":fx" и ходят на свой адрес. */
    private function host(): string
    {
        return str_ends_with($this->apiKey, ':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    }

    public function name(): string
    {
        return 'deepl';
    }
}
