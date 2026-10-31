<?php
namespace Hotels\Translation\Providers;

use RuntimeException;

/** Google Gemini: много языков, которых нет у DeepL (узбекский, грузинский, персидский…); есть бесплатный уровень. */
class Gemini extends Provider
{
    public function __construct(private string $apiKey, private string $model, private string $domain) {}

    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        $prompt = 'You translate short texts of ' . $this->domain . '. Translate each item of the JSON array '
            . ($sourceLocale ? 'from ' . self::langName($sourceLocale) . ' ' : '') . 'into ' . self::langName($targetLocale) . '. '
            . 'Keep the tone, names, numbers, room numbers, emoji, links, HTML tags and placeholders such as {1}, {app}, %s exactly as they are. '
            . "Answer with a JSON array of strings only, same length and order.\n\n"
            . json_encode(array_values($texts), JSON_UNESCAPED_UNICODE);
        $body = json_encode([
            'contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]],
            'generationConfig' => ['temperature' => 0.1, 'responseMimeType' => 'application/json'],
        ], JSON_UNESCAPED_UNICODE);
        [$code, $json] = self::http('POST', 'https://generativelanguage.googleapis.com/v1beta/models/' . $this->model . ':generateContent',
            ['Content-Type: application/json', 'x-goog-api-key: ' . $this->apiKey], $body, 60);
        if ($code !== 200) throw self::fail('Gemini', $code, $json);
        $done = json_decode((string)($json['candidates'][0]['content']['parts'][0]['text'] ?? ''), true);
        if (!is_array($done) || count($done) !== count($texts)) {
            // Половинный или сдвинутый ответ не сохраняем никогда: тексты остаются как были
            throw new RuntimeException('Gemini returned an unexpected answer');
        }
        return array_map(fn($t) => trim((string)$t), array_values($done));
    }

    public function name(): string
    {
        return 'gemini';
    }
}
