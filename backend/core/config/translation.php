<?php
/*
 * Блок переводов: сервисы машинного перевода, которые пробуются по очереди (как в общем блоке i18n-block).
 * Ключи — в backend/core/secrets.php (в git и архивы не входит); порядок, вкл/выкл и дневные лимиты
 * меняются на странице «Переводчики» общей админки (настройка translators в app_settings).
 *
 * price: free (бесплатно всегда), free_tier (бесплатно до месячного объёма), paid (платно).
 * needs: какие ключи нужны, чтобы сервис работал.
 * fields: что вводится на странице «Переводчики» (secret — ключ, показывается только хвост; text — адрес, почта, модель).
 * Ключи берутся из secrets.php, а введённые в админке (translator_keys.php) — поверх.
 * daily_chars: дневной лимит по умолчанию (0 — без лимита), чтобы не выйти за бесплатный объём.
 */
return [
    // Порядок, пока владелец системы не задал свой
    'order' => ['deepl', 'google', 'gemini', 'libretranslate', 'mymemory', 'claude'],

    'providers' => [
        'deepl' => ['label' => 'DeepL', 'price' => 'free_tier', 'needs' => ['deepl_api_key'], 'daily_chars' => 15000,
            'fields' => ['deepl_api_key' => 'secret'],
            'note' => '500,000 characters a month free'],
        'google' => ['label' => 'Google Translate', 'price' => 'free_tier', 'needs' => ['google_translate_key'], 'daily_chars' => 15000,
            'fields' => ['google_translate_key' => 'secret'],
            'note' => '500,000 characters a month free'],
        'gemini' => ['label' => 'Gemini', 'price' => 'free_tier', 'needs' => ['gemini_api_key'], 'daily_chars' => 0,
            'fields' => ['gemini_api_key' => 'secret', 'gemini_translation_model' => 'text'],
            'note' => 'Free tier with request limits'],
        'libretranslate' => ['label' => 'LibreTranslate', 'price' => 'free', 'needs' => ['libretranslate_url'], 'daily_chars' => 0,
            'fields' => ['libretranslate_url' => 'text', 'libretranslate_key' => 'secret'],
            'note' => 'Open source, on your own server'],
        'mymemory' => ['label' => 'MyMemory', 'price' => 'free', 'needs' => [], 'daily_chars' => 4500,
            'fields' => ['mymemory_email' => 'text'],
            'note' => '5,000 characters a day, 50,000 with mymemory_email'],
        'claude' => ['label' => 'Claude', 'price' => 'paid', 'needs' => ['anthropic_api_key'], 'daily_chars' => 0,
            'fields' => ['anthropic_api_key' => 'secret', 'anthropic_translation_model' => 'text'],
            'note' => 'Any language, paid per use'],
    ],

    // Модели (можно переопределить в secrets.php: gemini_translation_model, anthropic_translation_model)
    'gemini_model' => 'gemini-flash-lite-latest',
    'anthropic_model' => 'claude-haiku-5-5',

    // О чём тексты — от этого зависит качество перевода у Gemini и Claude
    'domain' => 'a hotel maintenance app (rooms, repairs, equipment, meters, staff notes)',
];
