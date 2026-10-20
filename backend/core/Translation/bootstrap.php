<?php
// Блок переводов (как app/Translation общего блока i18n-block): подключить всё одной строкой
require_once __DIR__ . '/Translator.php';
require_once __DIR__ . '/NullTranslator.php';
require_once __DIR__ . '/LanguageGuesser.php';
require_once __DIR__ . '/Settings.php';
foreach (['Provider', 'DeepL', 'Google', 'Gemini', 'LibreTranslate', 'MyMemory', 'Claude', 'Fake'] as $p) {
    require_once __DIR__ . "/Providers/$p.php";
}
require_once __DIR__ . '/TranslatorChain.php';
