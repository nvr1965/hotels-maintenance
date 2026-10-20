<?php
namespace Hotels\Translation\Providers;

use Hotels\Translation\Translator;
use RuntimeException;

/**
 * Один сервис машинного перевода. Сервисы выстроены в TranslatorChain: он берёт первый, который настроен,
 * знает язык и не исчерпал дневной лимит, а при ошибке переходит к следующему.
 */
abstract class Provider implements Translator
{
    /**
     * Несколько текстов сразу, в том же порядке. У кого нет пачечного вызова — по одному.
     * @param list<string> $texts
     * @return list<string>
     */
    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        return array_map(fn($t) => $this->translate($t, $targetLocale, $sourceLocale), array_values($texts));
    }

    public function translate(string $text, string $targetLocale, ?string $sourceLocale = null): string
    {
        return $this->translateMany([$text], $targetLocale, $sourceLocale)[0] ?? $text;
    }

    /** Переводит ли сервис на этот язык. */
    public function supports(string $locale): bool
    {
        return true;
    }

    /**
     * HTTP-запрос: [код ответа, разобранный JSON или null, тело].
     * @param array<int, string> $headers
     */
    protected static function http(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 30): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) throw new RuntimeException(static::class . ': ' . ($err ?: 'no answer'));
        return [$code, json_decode((string)$raw, true), (string)$raw];
    }

    /** Ошибка сервиса из ответа: его сообщение, иначе HTTP-код. */
    protected static function fail(string $who, int $code, $json): RuntimeException
    {
        $m = is_array($json) ? ($json['error']['message'] ?? $json['message'] ?? $json['error'] ?? null) : null;
        return new RuntimeException($who . ': ' . (is_string($m) ? $m : "HTTP $code"));
    }

    /** Название языка для подсказки моделям: «Russian (ru)». */
    protected static function langName(string $code): string
    {
        $name = function_exists('db_value') ? db_value("SELECT name FROM languages WHERE code = ?", [$code]) : null;
        return ($name ?: $code) . " ($code)";
    }
}
