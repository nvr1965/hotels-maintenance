<?php
namespace Hotels\Translation\Providers;

/** Без интернета, «[xx] текст»: только для проверок на своём компьютере ('translate_provider' => 'fake'). */
class Fake extends Provider
{
    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        return array_map(fn($t) => "[$targetLocale] $t", array_values($texts));
    }

    public function name(): string
    {
        return 'fake';
    }
}
