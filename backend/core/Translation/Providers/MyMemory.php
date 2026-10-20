<?php
namespace Hotels\Translation\Providers;

use RuntimeException;

/**
 * MyMemory: бесплатно и без ключа, 5 000 знаков в день (50 000, если указать адрес почты).
 * За раз берёт не больше 500 байт, поэтому длинные тексты идут кусками и склеиваются.
 * Запросы одной пачки уходят параллельно.
 */
class MyMemory extends Provider
{
    private const MAX_BYTES = 450;
    private const PARALLEL = 8;

    public function __construct(private ?string $email = null) {}

    public function translateMany(array $texts, string $targetLocale, ?string $sourceLocale = null): array
    {
        $pieces = [];
        foreach (array_values($texts) as $i => $text) {
            foreach (self::split($text) as $j => $piece) $pieces["$i:$j"] = $piece;
        }
        $done = $this->many($pieces, $targetLocale, $sourceLocale);
        $out = array_fill(0, count($texts), '');
        foreach ($pieces as $key => $piece) {
            [$i, $j] = array_map('intval', explode(':', $key));
            $out[$i] .= ($j === 0 ? '' : ($piece[0] === "\n" ? "\n" : ' ')) . $done[$key];
        }
        return $out;
    }

    /** @param array<string, string> $texts @return array<string, string> */
    private function many(array $texts, string $target, ?string $source): array
    {
        @set_time_limit(300);
        $out = [];
        foreach (array_chunk($texts, self::PARALLEL, true) as $chunk) {
            $mh = curl_multi_init();
            $handles = [];
            foreach ($chunk as $k => $text) {
                $query = array_filter(['q' => $text, 'langpair' => ($source ?: 'autodetect') . '|' . $target, 'de' => $this->email]);
                $ch = curl_init('https://api.mymemory.translated.net/get?' . http_build_query($query));
                curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
                curl_multi_add_handle($mh, $ch);
                $handles[$k] = $ch;
            }
            do {
                $status = curl_multi_exec($mh, $running);
                if ($running) curl_multi_select($mh);
            } while ($running && $status === CURLM_OK);
            $error = '';
            foreach ($handles as $k => $ch) {
                $json = json_decode((string)curl_multi_getcontent($ch), true);
                $text = (string)($json['responseData']['translatedText'] ?? '');
                $code = (int)($json['responseStatus'] ?? curl_getinfo($ch, CURLINFO_HTTP_CODE));
                if ($code !== 200 || $text === '' || str_starts_with($text, 'MYMEMORY WARNING')) {
                    $error = (string)($json['responseDetails'] ?? ($text ?: (curl_error($ch) ?: "HTTP $code")));
                }
                $out[$k] = trim(html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
            }
            curl_multi_close($mh);
            if ($error !== '') throw new RuntimeException('MyMemory: ' . $error);
        }
        return $out;
    }

    /** @return list<string> куски не длиннее MAX_BYTES, разрезанные между словами (абзацы сохраняются) */
    public static function split(string $text): array
    {
        if (strlen($text) <= self::MAX_BYTES) return [$text];
        $parts = [];
        foreach (preg_split('/\R+/u', $text) as $p => $para) {
            $lead = $p > 0 ? "\n" : '';
            $buf = '';
            foreach (preg_split('/\s+/u', $para, -1, PREG_SPLIT_NO_EMPTY) as $word) {
                if ($buf !== '' && strlen($buf) + 1 + strlen($word) > self::MAX_BYTES) {
                    $parts[] = $lead . $buf;
                    $lead = '';
                    $buf = '';
                }
                $buf = $buf === '' ? mb_strcut($word, 0, self::MAX_BYTES) : "$buf $word";
            }
            if ($buf !== '') $parts[] = $lead . $buf;
        }
        return $parts ?: [$text];
    }

    public function name(): string
    {
        return 'mymemory';
    }
}
