<?php
class Translator {
    public function translateToAll($text) {
        $text = trim($text);
        
        if (empty($text)) {
            return ['ru' => '', 'en' => '', 'he' => '', 'ar' => ''];
        }

        // Базовый fallback: исходный текст записывается во все колонки
        $translations = [
            'ru' => $text,
            'en' => $text,
            'he' => $text,
            'ar' => $text
        ];

        $targets = ['ru', 'en', 'he', 'ar'];

        foreach ($targets as $lang) {
            $url = 'https://api.mymemory.translated.net/get?q=' . urlencode($text) . '&langpair=autodetect|' . $lang;

            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
            curl_setopt($ch, CURLOPT_TIMEOUT, 5);
            curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            
            $response = curl_exec($ch);
            $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($http_code === 200 && $response) {
                $res = json_decode($response, true);
                
                // Проверяем успешный статус и наличие перевода
                if (isset($res['responseStatus']) && (int)$res['responseStatus'] === 200 && isset($res['responseData']['translatedText'])) {
                    $translated = trim($res['responseData']['translatedText']);
                    
                    // Отсеиваем служебные ошибки и предупреждения API (включая одинаковые языки)
                    if (!empty($translated) && 
                        strpos($translated, 'MYMEMORY WARNING') === false && 
                        strpos($translated, 'PLEASE SELECT TWO DISTINCT LANGUAGES') === false) {
                        $translations[$lang] = htmlspecialchars_decode($translated, ENT_QUOTES);
                    }
                }
            }
        }

        return $translations;
    }
}
?>