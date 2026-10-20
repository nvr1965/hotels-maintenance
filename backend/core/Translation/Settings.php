<?php
namespace Hotels\Translation;

/**
 * Небольшие общие значения в таблице app_settings (как Setting в общем блоке): порядок переводчиков,
 * а также кеш ответов сервисов на сутки (списки языков DeepL и LibreTranslate).
 */
class Settings
{
    public static function get(string $key)
    {
        $v = db_value("SELECT value FROM app_settings WHERE key = ?", [$key]);
        return $v === null ? null : json_decode((string)$v, true);
    }

    public static function put(string $key, $value): void
    {
        db_exec("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?::jsonb, now())
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
            [$key, json_encode($value, JSON_UNESCAPED_UNICODE)]);
    }

    /** Значение из кеша, не старше $seconds; иначе $make() и запомнить. Ошибка $make() — наружу. */
    public static function remember(string $key, int $seconds, callable $make)
    {
        $row = db_one("SELECT value, updated_at > now() - make_interval(secs => ?) AS fresh FROM app_settings WHERE key = ?",
            [$seconds, 'cache.' . $key]);
        if ($row && $row['fresh']) return json_decode((string)$row['value'], true);
        $value = $make();
        self::put('cache.' . $key, $value);
        return $value;
    }
}
