<?php
namespace Hotels\Translation;

use Hotels\Translation\Providers\Claude;
use Hotels\Translation\Providers\DeepL;
use Hotels\Translation\Providers\Fake;
use Hotels\Translation\Providers\Gemini;
use Hotels\Translation\Providers\Google;
use Hotels\Translation\Providers\LibreTranslate;
use Hotels\Translation\Providers\MyMemory;
use Hotels\Translation\Providers\Provider;
use RuntimeException;
use Throwable;

/**
 * Блок переводов: сервисы по очереди. Каждый текст уходит первому, который настроен (есть ключ в secrets.php),
 * включён, знает язык и не исчерпал дневной лимит знаков; если сервис упал, пробуется следующий.
 * Так бесплатные идут первыми, а платные остаются в резерве.
 *
 * Порядок, вкл/выкл и лимиты — со страницы «Переводчики» (настройка translators), иначе из config/translation.php.
 */
class TranslatorChain implements Translator
{
    /** Какой сервис перевёл последним — записывается рядом с сохранённым переводом. */
    private ?string $last = null;

    /** @var array<string, Provider|null> */
    private array $built = [];

    /** @param list<array{id: string, on: bool, daily_chars: int}> $entries */
    public function __construct(private array $entries) {}

    public static function config(): array
    {
        static $c = null;
        return $c ??= require __DIR__ . '/../config/translation.php';
    }

    /** Цепочка для этого запроса (одна на процесс). */
    public static function get(): self
    {
        static $chain = null;
        return $chain ??= self::fromSettings();
    }

    public static function fromSettings(): self
    {
        $catalog = self::config()['providers'];
        $order = self::config()['order'];
        $saved = Settings::get('translators');
        if (!is_array($saved)) {
            $saved = array_map(fn($id) => ['id' => $id, 'on' => true, 'daily_chars' => $catalog[$id]['daily_chars'] ?? 0], $order);
        }
        $entries = self::merge($saved, $catalog);
        // Проверка без интернета на своём компьютере: «[xx] текст» идёт первым
        $fake = (string)(app_config()['translate_provider'] ?? '') === 'fake';
        if ($fake) array_unshift($entries, ['id' => 'fake', 'on' => true, 'daily_chars' => 0]);
        $chain = new self($entries);
        if ($fake) $chain->built['fake'] = new Fake();
        return $chain;
    }

    /** Сохранённый (или заданный) список, а в конце — остальные известные сервисы, выключенные. */
    private static function merge(array $saved, array $catalog): array
    {
        $entries = [];
        foreach ($saved as $row) {
            if (isset($row['id'], $catalog[$row['id']])) {
                $entries[$row['id']] = ['id' => $row['id'], 'on' => (bool)($row['on'] ?? true), 'daily_chars' => max(0, (int)($row['daily_chars'] ?? 0))];
            }
        }
        foreach ($catalog as $id => $info) {
            $entries[$id] ??= ['id' => $id, 'on' => false, 'daily_chars' => (int)$info['daily_chars']];
        }
        return array_values($entries);
    }

    /** Для проверок: этот объект вместо сервиса $id. */
    public function with(string $id, Provider $provider): self
    {
        $this->built[$id] = $provider;
        return $this;
    }

    /** Все сервисы для страницы «Переводчики»: что это, настроен ли, сколько знаков ушло сегодня. */
    public function describe(): array
    {
        $catalog = self::config()['providers'];
        return array_map(fn(array $e) => $e + [
            'label' => $catalog[$e['id']]['label'] ?? $e['id'],
            'price' => $catalog[$e['id']]['price'] ?? 'free',
            'note' => $catalog[$e['id']]['note'] ?? '',
            'ready' => $this->ready($e['id']),
            'needs' => $catalog[$e['id']]['needs'] ?? [],
            'fields' => self::fields($catalog[$e['id']]['fields'] ?? []),
            'used_today' => $this->usedToday($e['id']),
        ], $this->entries);
    }

    /**
     * Поля ключей для админки. Значение ключа наружу не отдаётся никогда — только последние 4 знака;
     * адрес, почта и модель видны целиком.
     */
    private static function fields(array $fields): array
    {
        $out = [];
        foreach ($fields as $name => $type) {
            $v = app_secret($name);
            $out[] = [
                'name' => $name, 'secret' => $type === 'secret', 'source' => app_secret_source($name),
                'value' => $type === 'secret' ? '' : $v,
                'hint' => $type === 'secret' && $v !== '' ? '…' . mb_substr($v, -4) : '',
            ];
        }
        return $out;
    }

    /** Может ли хоть один сервис переводить. */
    public function available(): bool
    {
        foreach ($this->entries as $e) if ($e['on'] && $this->ready($e['id'])) return true;
        return false;
    }

    public function translate(string $text, string $targetLocale, ?string $sourceLocale = null): string
    {
        return $this->translateMany([$text], $targetLocale, $sourceLocale)[0];
    }

    /**
     * @param list<string> $texts
     * @return list<string>
     * @throws RuntimeException если ни один сервис не смог
     */
    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        $chars = array_sum(array_map('mb_strlen', $texts));
        $errors = [];
        foreach ($this->entries as $e) {
            $provider = $e['on'] ? $this->provider($e['id']) : null;
            if (!$provider || ($e['daily_chars'] > 0 && $this->usedToday($e['id']) + $chars > $e['daily_chars'])) continue;
            if (!$provider->supports($targetLocale)) continue;
            try {
                $done = $provider->translateMany(array_values($texts), $targetLocale, $sourceLocale ?: null);
            } catch (Throwable $ex) {
                error_log('hotels: translator ' . $e['id'] . ' failed, trying the next one: ' . $ex->getMessage());
                $errors[] = $e['id'] . ': ' . $ex->getMessage();
                continue;
            }
            $this->record($e['id'], $chars);
            $this->last = $e['id'];
            return $done;
        }
        throw new RuntimeException('No translator could translate into ' . $targetLocale . ($errors ? ' (' . implode('; ', $errors) . ')' : ''));
    }

    /** Возьмёт ли этот язык хоть один включённый сервис. */
    public function supports(string $locale): bool
    {
        foreach ($this->entries as $e) {
            $provider = $e['on'] ? $this->provider($e['id']) : null;
            if ($provider && $provider->supports($locale)) return true;
        }
        return false;
    }

    /** Один сервис отдельно — для кнопки «Проверить». */
    public function only(string $id): ?Provider
    {
        return $this->provider($id);
    }

    public function name(): string
    {
        return $this->last ?? 'chain';
    }

    public function usedToday(string $id): int
    {
        return (int)(db_value("SELECT chars FROM translator_usage WHERE provider = ? AND day = CURRENT_DATE", [$id]) ?? 0);
    }

    private function record(string $id, int $chars): void
    {
        db_exec("INSERT INTO translator_usage (provider, day, chars) VALUES (?, CURRENT_DATE, ?)
                 ON CONFLICT (provider, day) DO UPDATE SET chars = translator_usage.chars + EXCLUDED.chars", [$id, $chars]);
    }

    private function ready(string $id): bool
    {
        if (isset($this->built[$id])) return true;
        foreach (self::config()['providers'][$id]['needs'] ?? [] as $secret) {
            if (app_secret($secret) === '') return false;
        }
        return isset(self::config()['providers'][$id]);
    }

    private function provider(string $id): ?Provider
    {
        if (!array_key_exists($id, $this->built)) $this->built[$id] = $this->ready($id) ? self::build($id) : null;
        return $this->built[$id];
    }

    private static function build(string $id): ?Provider
    {
        $c = self::config();
        return match ($id) {
            'deepl' => new DeepL(app_secret('deepl_api_key')),
            'google' => new Google(app_secret('google_translate_key')),
            'gemini' => new Gemini(app_secret('gemini_api_key'), app_secret('gemini_translation_model') ?: $c['gemini_model'], $c['domain']),
            'libretranslate' => new LibreTranslate(app_secret('libretranslate_url'), app_secret('libretranslate_key') ?: null),
            'mymemory' => new MyMemory((app_secret('mymemory_email') ?: (string)(app_config()['translate_email'] ?? '')) ?: null),
            'claude' => new Claude(app_secret('anthropic_api_key'), app_secret('anthropic_translation_model') ?: $c['anthropic_model'], $c['domain']),
            default => null,
        };
    }
}
