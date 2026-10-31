<?php
namespace Hotels\Translation;

/** Ни один сервис не настроен: тексты показываются как написаны. */
class NullTranslator implements Translator
{
    public function translate(string $text, string $targetLocale, ?string $sourceLocale = null): string
    {
        return $text;
    }

    public function name(): string
    {
        return 'null';
    }
}
