<?php
namespace Hotels\Translation\Providers;

use RuntimeException;

/** Anthropic Claude: любой язык, хорошо держит тон; платно за использование. Без SDK — прямой запрос к API. */
class Claude extends Provider
{
    public function __construct(private string $apiKey, private string $model, private string $domain) {}

    public function translate(string $text, string $targetLocale, ?string $sourceLocale = null): string
    {
        $target = self::langName($targetLocale);
        $body = json_encode([
            'model' => $this->model,
            'max_tokens' => 4000,
            'system' => 'You translate texts of ' . $this->domain . '. Translate the user\'s text into ' . $target . '. '
                . 'Keep the tone, names, numbers, emoji, links, HTML tags and placeholders such as {1} exactly as they are. '
                . 'If the text is already in ' . $target . ', return it unchanged. Reply with the translation only, no notes or quotes.',
            'messages' => [['role' => 'user', 'content' => $text]],
        ], JSON_UNESCAPED_UNICODE);
        [$code, $json] = self::http('POST', 'https://api.anthropic.com/v1/messages', [
            'Content-Type: application/json', 'x-api-key: ' . $this->apiKey, 'anthropic-version: 2023-06-01',
        ], $body, 60);
        if ($code !== 200) throw self::fail('Claude', $code, $json);
        $stop = $json['stop_reason'] ?? '';
        if ($stop === 'refusal') throw new RuntimeException('Translation refused');
        // Обрезанный на полуслове перевод не сохраняем: текст остаётся на языке оригинала
        if ($stop === 'max_tokens') throw new RuntimeException('Translation too long');
        foreach ($json['content'] ?? [] as $block) {
            if (($block['type'] ?? '') === 'text') return trim((string)$block['text']);
        }
        throw new RuntimeException('Empty translation response');
    }

    public function name(): string
    {
        return 'claude';
    }
}
