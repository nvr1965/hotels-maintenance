<?php
namespace Hotels\Translation;

/**
 * Дешёвое угадывание языка по письменности, чтобы не переводить текст, уже написанный на языке читателя.
 * Знает языки системы по умолчанию; не уверен — null, и язык определяет сервис.
 */
class LanguageGuesser
{
    private const SCRIPTS = [
        'ru' => '/\p{Cyrillic}/u',
        'he' => '/\p{Hebrew}/u',
        'ar' => '/\p{Arabic}/u',
        'en' => '/[A-Za-z]/',
    ];

    public static function guess(string $text): ?string
    {
        $plain = strip_tags($text);
        $plain = preg_replace('~https?://\S+~', '', $plain) ?? $plain;
        $counts = [];
        foreach (self::SCRIPTS as $locale => $pattern) $counts[$locale] = preg_match_all($pattern, $plain);
        arsort($counts);
        $total = array_sum($counts);
        $top = array_key_first($counts);
        if ($total < 3 || $counts[$top] / $total < 0.7) return null;
        return $top;
    }
}
