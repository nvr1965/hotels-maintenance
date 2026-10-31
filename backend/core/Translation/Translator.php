<?php
namespace Hotels\Translation;

interface Translator
{
    /** Перевести простой текст или простой HTML на язык $targetLocale, не трогая разметку. */
    public function translate(string $text, string $targetLocale, ?string $sourceLocale = null): string;

    public function name(): string;
}
