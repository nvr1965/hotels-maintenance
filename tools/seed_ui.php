<?php
/* Готовые переводы интерфейса (lang/seed/*.json — ru, he, ar из Ramada) → таблица ui_translations.
 * Запускается при установке и после обновления (deploy.sh). Ручные правки на странице «Языки» не затираются:
 * обновляются только тексты, которые переведены автоматически или ещё не заведены.
 *   php tools/seed_ui.php          — только готовые переводы
 *   php tools/seed_ui.php --fill   — и сразу перевести недостающее на все включённые языки (нужен интернет)
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/../backend/core/db.php';
require_once __DIR__ . '/../backend/core/translate.php';
require_once __DIR__ . '/../backend/core/ui_text.php';

$total = 0;
foreach (glob(__DIR__ . '/../lang/seed/*.json') as $file) {
    $lang = basename($file, '.json');
    $texts = json_decode((string)file_get_contents($file), true);
    if (!is_array($texts)) {
        fwrite(STDERR, "Не читается: $file\n");
        exit(1);
    }
    if (!db_value("SELECT 1 FROM languages WHERE code = ?", [$lang])) {
        echo "$lang: такого языка нет в таблице languages, пропускаю\n";
        continue;
    }
    $n = 0;
    db_tx(function () use ($texts, $lang, &$n) {
        foreach ($texts as $key => $text) {
            $n += db_exec("INSERT INTO ui_translations (key, language_code, text, is_auto) VALUES (?, ?, ?, false)
                           ON CONFLICT (key, language_code) DO UPDATE SET text = EXCLUDED.text, is_auto = false, updated_at = now()
                           WHERE ui_translations.is_auto AND ui_translations.text IS DISTINCT FROM EXCLUDED.text",
                [$key, $lang, $text])->rowCount();
        }
    });
    echo "$lang: " . count($texts) . " текстов, записано $n\n";
    $total += $n;
}
echo "Готово, записано $total.\n";

if (in_array('--fill', $argv, true)) {
    foreach (db_all("SELECT code FROM languages WHERE is_active AND code <> 'en' ORDER BY sort_order") as $l) {
        $code = $l['code'];
        if (!db_value("SELECT pg_try_advisory_lock(hashtext(?))", ['ui_fill:' . $code])) {
            echo "$code: уже переводится другим процессом\n";
            continue;
        }
        try {
            ui_fill_language($code);
        } finally {
            db_exec("SELECT pg_advisory_unlock(hashtext(?))", ['ui_fill:' . $code]);
        }
        echo "$code: не хватает " . ui_missing_count($code) . "\n";
    }
}
