<?php
/* Тексты интерфейса на языке (без входа: нужны и экрану входа). GET ?lang=xx[&have=версия]
 * → {languages: [{code, name, rtl}], lang, version, texts: {ключ: текст} | null (если версия та же)}
 * Английские тексты фронтенд берёт из своей сборки (lang/en.json), здесь — переводы.
 * Если каких-то ключей на этом языке ещё нет, они переводятся автоматически сразу после ответа
 * (при следующем открытии уже придут переведёнными).
 */
require_once __DIR__ . '/../core/api.php';

$languages = array_values(array_map(fn($l) => ['code' => $l['code'], 'name' => $l['native_name'] ?: $l['name'], 'rtl' => (bool)$l['is_rtl']],
    app_languages()));
$lang = app_normalize_lang($_GET['lang'] ?? 'en');

$texts = [];
$version = 'en';
if ($lang !== 'en') {
    $texts = db_exec("SELECT key, text FROM ui_translations WHERE language_code = ?", [$lang])->fetchAll(PDO::FETCH_KEY_PAIR);
    $version = substr(hash('sha256', json_encode($texts, JSON_UNESCAPED_UNICODE)), 0, 16);
}
$out = [
    'languages' => $languages,
    'lang' => $lang,
    'version' => $version,
    'texts' => ($_GET['have'] ?? '') === $version ? null : (object)$texts,
];

// Не чаще раза в 10 минут на язык: если сервис перевода недоступен, не дёргаем его на каждом открытии
$mark = sys_get_temp_dir() . '/hotels_ui_fill_' . preg_replace('/[^a-zA-Z-]/', '', $lang);
if ($lang !== 'en' && count($texts) < count(ui_base()) && (!is_file($mark) || filemtime($mark) < time() - 600)) {
    @touch($mark);
    // Переводит только один процесс на язык; остальные просто отвечают тем, что есть
    api_ok_then($out + ['filling' => true], function () use ($lang) {
        if (!db_value("SELECT pg_try_advisory_lock(hashtext(?))", ['ui_fill:' . $lang])) return;
        try {
            ui_fill_language($lang);
        } finally {
            db_exec("SELECT pg_advisory_unlock(hashtext(?))", ['ui_fill:' . $lang]);
        }
    });
}
api_ok($out);
