<?php
/* Web Push: уведомления о срочных заявках на телефоны людей отеля.
 *
 * Получатели — члены отеля заявки с ролями из настройки отеля push_roles (по умолчанию
 * Исполнитель и Руководитель), кроме автора заявки. Цифра на иконке — открытые срочные этого отеля.
 *
 * Без Composer и сторонних библиотек: шифрование содержимого (RFC 8291, aes128gcm)
 * и подпись VAPID (RFC 8292, ES256) сделаны на встроенном в PHP openssl.
 *
 * Ключи VAPID создаются сами при первом вызове и лежат в backend/core/push_keys.php
 * (папку core браузер не видит, см. .htaccess). Если файл удалить, появятся новые ключи
 * и всем придётся заново нажать «Включить уведомления».
 *
 *   push_notify_new_urgent($hotelId, $taskId, $creatorId) — из save_task.php
 *   push_notify_urgent_done($hotelId, $taskId)            — из close_task.php
 */
require_once __DIR__ . '/db.php';

const PUSH_KEYS_FILE = __DIR__ . '/push_keys.php';
const PUSH_TTL       = 4 * 3600;  // телефон был выключен дольше — уведомление уже не нужно
const PUSH_TIMEOUT   = 8;         // сек на всю рассылку
const PUSH_DEFAULT_ROLES = ['worker', 'head'];

/** Контакт для Google/Apple: адрес сайта из config.local.php. */
function push_contact(): string
{
    return (string)(app_config()['site_url'] ?? 'https://example.com');
}

/** Кому в этом отеле слать уведомления о срочных: настройка отеля push_roles. */
function push_roles(array $hotel): array
{
    $s = json_decode((string)($hotel['settings_json'] ?? ''), true);
    $roles = is_array($s['push_roles'] ?? null) ? array_values(array_intersect($s['push_roles'], ['worker', 'manager', 'head'])) : null;
    return $roles ?: PUSH_DEFAULT_ROLES;
}

function push_hotel(int $hotelId): ?array
{
    global $db;
    $st = $db->prepare("SELECT * FROM hotels WHERE id = ?");
    $st->bind_param('i', $hotelId);
    $st->execute();
    $h = $st->get_result()->fetch_assoc();
    $st->close();
    return $h ?: null;
}

const PUSH_TITLE = [
    'ru' => '🚨 Срочная заявка',
    'en' => '🚨 Urgent request',
    'he' => '🚨 קריאה דחופה',
    'ar' => '🚨 طلب عاجل',
];

// ---------------------------------------------------------------- база

function push_ensure_table(): void
{
    // таблицы создаёт db/schema.sql
}

/** Журнал рассылок: страница проверки показывает, что было с настоящими заявками. */
function push_log(?int $hotelId, string $kind, int $taskId, string $note, array $results = []): void
{
    global $db;
    $ok = 0;
    $errs = [];
    foreach ($results as $id => $r) {
        if ($r['code'] >= 200 && $r['code'] < 300) $ok++;
        else $errs[] = "#$id: " . ($r['code'] ?: 'нет связи') . ' ' . mb_substr((string)$r['error'], 0, 80);
    }
    $note = mb_substr(trim($note . ($errs ? ' ' . implode('; ', $errs) : '')), 0, 1000);
    $stmt = $db->prepare("INSERT INTO push_log (hotel_id, kind, task_id, sent, ok, note) VALUES (?, ?, ?, ?, ?, ?)");
    $sent = count($results);
    $stmt->bind_param('isiiis', $hotelId, $kind, $taskId, $sent, $ok, $note);
    $stmt->execute();
    $stmt->close();
    // Храним только последние 1000 записей (на все отели)
    $db->query("DELETE FROM push_log WHERE id < (SELECT m FROM (SELECT MAX(id) - 1000 AS m FROM push_log) x)");
}

function push_save_subscription(int $userId, string $endpoint, string $p256dh, string $auth, string $lang, bool $silent): void
{
    global $db;
    push_ensure_table();
    $hash = hash('sha256', $endpoint);
    $ua = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    $s = $silent ? 1 : 0;
    // Тот же телефон мог раньше принадлежать другому сотруднику — подписка переходит к вошедшему
    $stmt = $db->prepare("INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, lang, silent, user_agent)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth),
                                                  lang = VALUES(lang), silent = VALUES(silent), user_agent = VALUES(user_agent)");
    $stmt->bind_param('isssssis', $userId, $endpoint, $hash, $p256dh, $auth, $lang, $s, $ua);
    $stmt->execute();
    $stmt->close();
}

function push_delete_subscription(string $endpoint, ?int $userId = null): void
{
    global $db;
    push_ensure_table();
    $hash = hash('sha256', $endpoint);
    if ($userId === null) {
        $stmt = $db->prepare("DELETE FROM push_subscriptions WHERE endpoint_hash = ?");
        $stmt->bind_param('s', $hash);
    } else {
        $stmt = $db->prepare("DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?");
        $stmt->bind_param('si', $hash, $userId);
    }
    $stmt->execute();
    $stmt->close();
}

/** Сколько срочных заявок отеля сейчас открыто — это число на иконке приложения. */
function push_open_urgent_count(int $hotelId): int
{
    global $db;
    $res = $db->query("SELECT COUNT(*) FROM maintenance_tasks
                       WHERE hotel_id = " . (int)$hotelId . " AND status NOT IN ('done', 'completed')
                         AND LOWER(TRIM(COALESCE(task_type, 'current'))) NOT IN ('planned', 'routine', 'regiment')");
    return $res ? (int)$res->fetch_row()[0] : 0;
}

/**
 * Подписки людей отеля с нужными ролями (заблокированные не получают).
 * hotel_count — в скольких отелях человек работает: тогда в заголовок добавляется название отеля.
 */
function push_recipients(array $hotel, ?int $exceptUserId = null): array
{
    global $db;
    $roles = "'" . implode("','", push_roles($hotel)) . "'";
    $hid = (int)$hotel['id'];
    $sql = "SELECT s.*, (SELECT COUNT(*) FROM hotel_members x WHERE x.user_id = s.user_id AND x.active = 1) AS hotel_count
            FROM push_subscriptions s
            JOIN users u ON u.id = s.user_id AND u.active = 1
            JOIN hotel_members m ON m.user_id = s.user_id AND m.hotel_id = $hid AND m.active = 1
            WHERE m.role IN ($roles)";
    if ($exceptUserId) $sql .= " AND s.user_id <> " . (int)$exceptUserId;
    $res = $db->query($sql);
    return $res ? $res->fetch_all(MYSQLI_ASSOC) : [];
}

// ---------------------------------------------------------------- что рассылаем

function push_notify_new_urgent(int $hotelId, int $taskId, int $creatorId): void
{
    global $db;
    $hotel = push_hotel($hotelId);
    if (!$hotel) return;
    $subs = push_recipients($hotel, $creatorId);
    if (!$subs) { push_log($hotelId, 'new', $taskId, 'Некому отправлять: ни одного подписанного получателя, кроме автора'); return; }

    $task = [];
    foreach (['ru', 'en', 'he', 'ar'] as $l) {
        $res = $db->query("SELECT COALESCE(NULLIF(t.description_$l, ''), t.description_ru, '') AS d,
                                  COALESCE(dict.term_$l, dict.term_ru, a.asset_key, '') AS loc
                           FROM maintenance_tasks t
                           LEFT JOIN hotel_assets a ON a.id = t.asset_id
                           LEFT JOIN asset_dictionary dict ON dict.hotel_id = a.hotel_id AND a.asset_key = dict.term_en
                           WHERE t.id = $taskId AND t.hotel_id = $hotelId");
        $row = $res ? $res->fetch_assoc() : null;
        if (!$row) { push_log($hotelId, 'new', $taskId, 'Заявка не найдена в базе'); return; }
        $desc = trim(preg_replace('/\s+/u', ' ', (string)$row['d']));
        if (mb_strlen($desc) > 120) $desc = mb_substr($desc, 0, 117) . '…';
        $task[$l] = trim($row['loc'] !== '' ? $row['loc'] . ' · ' . $desc : $desc);
    }
    $count = push_open_urgent_count($hotelId);

    $messages = [];
    foreach ($subs as $s) {
        $l = isset($task[$s['lang']]) ? $s['lang'] : 'ru';
        $messages[] = [$s, [
            'type'   => 'urgent',
            'id'     => $taskId,
            'hotel_id' => $hotelId,
            'title'  => PUSH_TITLE[$l] . ((int)$s['hotel_count'] > 1 ? ' · ' . $hotel['name'] : ''),
            'body'   => $task[$l],
            'count'  => $count,
            'silent' => (int)$s['silent'] === 1,
            'lang'   => $l,
        ]];
    }
    push_log($hotelId, 'new', $taskId, 'Новая срочная заявка', push_send_all($messages, 'urgent-' . $taskId));
}

function push_notify_urgent_done(int $hotelId, int $taskId): void
{
    $hotel = push_hotel($hotelId);
    if (!$hotel) return;
    $subs = push_recipients($hotel);
    if (!$subs) return;
    $count = push_open_urgent_count($hotelId);
    $messages = [];
    foreach ($subs as $s) {
        // iPhone требует показывать уведомление на каждый push, «тихо» убрать нельзя.
        // Там уведомление и цифра обновятся, когда человек откроет приложение.
        if (str_contains($s['endpoint'], '.push.apple.com')) continue;
        $messages[] = [$s, ['type' => 'done', 'id' => $taskId, 'hotel_id' => $hotelId, 'count' => $count]];
    }
    push_send_all($messages, 'urgent-' . $taskId);
}

/** Отдать ответ браузеру и продолжить работу (рассылка не задерживает менеджера). */
function push_finish_response(string $json): void
{
    ignore_user_abort(true);
    if (function_exists('fastcgi_finish_request')) {
        echo $json;
        fastcgi_finish_request();
        return;
    }
    while (ob_get_level() > 0) ob_end_clean();
    header('Connection: close');
    header('Content-Length: ' . strlen($json));
    echo $json;
    flush();
}

// ---------------------------------------------------------------- отправка

/**
 * $messages: [[subscriptionRow, payloadArray], ...]
 * Возвращает [id подписки => ['code' => HTTP-код (0 — не дошло до сервера), 'error' => текст]].
 */
function push_send_all(array $messages, string $topic): array
{
    $results = [];
    if (!$messages) return $results;
    $keys = push_vapid_keys();
    if (!$keys) return $results;
    $ca = push_ca_file();

    $mh = curl_multi_init();
    $handles = [];
    foreach ($messages as [$sub, $payload]) {
        try {
            $req = push_build_request($sub, json_encode($payload, JSON_UNESCAPED_UNICODE), $keys, $topic);
        } catch (Throwable $e) {
            error_log('push: ' . $e->getMessage());
            $results[(int)$sub['id']] = ['code' => 0, 'error' => $e->getMessage()];
            continue;
        }
        $ch = curl_init($sub['endpoint']);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $req['body'],
            CURLOPT_HTTPHEADER     => $req['headers'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => PUSH_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        if ($ca !== '') curl_setopt($ch, CURLOPT_CAINFO, $ca);
        curl_multi_add_handle($mh, $ch);
        $handles[] = [$ch, $sub];
    }
    do {
        $status = curl_multi_exec($mh, $running);
        if ($running) curl_multi_select($mh, 1.0);
    } while ($running && $status === CURLM_OK);

    // Ошибки соединения (нет интернета, сертификаты) curl сообщает только через info_read
    $curlErrors = [];
    while ($info = curl_multi_info_read($mh)) {
        if ($info['result'] !== CURLE_OK) $curlErrors[spl_object_id($info['handle'])] = curl_strerror($info['result']);
    }

    global $db;
    foreach ($handles as [$ch, $sub]) {
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch) ?: ($curlErrors[spl_object_id($ch)] ?? '');
        $results[(int)$sub['id']] = ['code' => $code, 'error' => $code >= 200 && $code < 300 ? '' : ($err !== '' ? $err : substr((string)curl_multi_getcontent($ch), 0, 300))];
        if ($code >= 200 && $code < 300) {
            $db->query("UPDATE push_subscriptions SET last_ok_at = NOW() WHERE id = " . (int)$sub['id']);
        } elseif ($code === 404 || $code === 410) {
            // Подписка больше не существует (приложение удалили, разрешение сняли)
            $db->query("DELETE FROM push_subscriptions WHERE id = " . (int)$sub['id']);
        } else {
            error_log("push: HTTP $code for subscription " . (int)$sub['id'] . ': ' . $results[(int)$sub['id']]['error']);
        }
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $results;
}

/**
 * Файл корневых сертификатов для curl. В XAMPP php.ini часто без curl.cainfo,
 * и тогда curl не может проверить сертификат Google/Apple (HTTP 0, error 60).
 */
function push_ca_file(): string
{
    if (ini_get('curl.cainfo') || ini_get('openssl.cafile')) return '';
    if (DIRECTORY_SEPARATOR !== '\\') return '';
    $candidates = [dirname(PHP_BINARY) . '/extras/ssl/cacert.pem', 'C:/xampp/php/extras/ssl/cacert.pem',
                   'C:/xampp/apache/bin/curl-ca-bundle.crt', dirname(PHP_BINARY, 2) . '/apache/bin/curl-ca-bundle.crt'];
    foreach ($candidates as $c) {
        if (is_file($c)) return $c;
    }
    return '';
}

function push_build_request(array $sub, string $plaintext, array $keys, string $topic): array
{
    $endpoint = $sub['endpoint'];
    $u = parse_url($endpoint);
    $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');

    $jwtHead = push_b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $jwtBody = push_b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => push_contact()]));
    $signed = $jwtHead . '.' . $jwtBody;
    if (!openssl_sign($signed, $der, $keys['private_pem'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('vapid sign failed');
    $jwt = $signed . '.' . push_b64u(push_der_to_raw_sig($der));

    $body = push_encrypt($plaintext, push_b64u_decode($sub['p256dh']), push_b64u_decode($sub['auth']));

    return [
        'body' => $body,
        'headers' => [
            'Authorization: vapid t=' . $jwt . ', k=' . $keys['public'],
            'Content-Type: application/octet-stream',
            'Content-Encoding: aes128gcm',
            'TTL: ' . PUSH_TTL,
            'Urgency: high',
            'Topic: ' . preg_replace('/[^A-Za-z0-9_-]/', '', $topic),
        ],
    ];
}

/** RFC 8291: шифрование содержимого для одного получателя. */
function push_encrypt(string $plaintext, string $uaPublic, string $authSecret): string
{
    if (strlen($uaPublic) !== 65 || $uaPublic[0] !== "\x04" || strlen($authSecret) !== 16) {
        throw new InvalidArgumentException('bad subscription keys');
    }
    $local = push_new_ec_key();
    $localPublic = push_ec_public_raw($local);
    $peer = openssl_pkey_get_public(push_raw_public_to_pem($uaPublic));
    $shared = openssl_pkey_derive($peer, $local, 32);
    if ($shared === false) throw new RuntimeException('ecdh failed');

    $ikm = push_hkdf($authSecret, $shared, "WebPush: info\0" . $uaPublic . $localPublic, 32);
    $salt = random_bytes(16);
    $cek = push_hkdf($salt, $ikm, "Content-Encoding: aes128gcm\0", 16);
    $nonce = push_hkdf($salt, $ikm, "Content-Encoding: nonce\0", 12);

    $tag = '';
    $cipher = openssl_encrypt($plaintext . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($cipher === false) throw new RuntimeException('encrypt failed');

    return $salt . pack('N', 4096) . chr(65) . $localPublic . $cipher . $tag;
}

function push_hkdf(string $salt, string $ikm, string $info, int $len): string
{
    $prk = hash_hmac('sha256', $ikm, $salt, true);
    return substr(hash_hmac('sha256', $info . "\x01", $prk, true), 0, $len);
}

// ---------------------------------------------------------------- ключи

/** ['public' => base64url(65 байт), 'private_pem' => PEM] — создаются при первом вызове. */
function push_vapid_keys(): ?array
{
    if (is_file(PUSH_KEYS_FILE)) {
        $k = require PUSH_KEYS_FILE;
        if (is_array($k) && !empty($k['public']) && !empty($k['private_pem'])) return $k;
    }
    try {
        $key = push_new_ec_key();
    } catch (Throwable $e) {
        error_log('push: ' . $e->getMessage());
        return null;
    }
    openssl_pkey_export($key, $pem, null, push_openssl_config());
    $k = ['public' => push_b64u(push_ec_public_raw($key)), 'private_pem' => $pem];
    $php = "<?php\n// Ключи VAPID для уведомлений. Созданы автоматически " . date('Y-m-d H:i') . ".\n"
         . "// Не пересылать. Если удалить файл, все телефоны придётся подписать заново.\nreturn " . var_export($k, true) . ";\n";
    if (@file_put_contents(PUSH_KEYS_FILE, $php, LOCK_EX) === false) {
        error_log('push: cannot write ' . PUSH_KEYS_FILE);
        return null;
    }
    return $k;
}

function push_openssl_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    // На Windows (XAMPP) openssl без явного openssl.cnf не умеет создавать ключи
    $cfg = [];
    if (DIRECTORY_SEPARATOR === '\\') {
        $candidates = [getenv('OPENSSL_CONF') ?: '', dirname(PHP_BINARY) . '/extras/ssl/openssl.cnf',
                       'C:/xampp/php/extras/ssl/openssl.cnf', 'C:/xampp/apache/conf/openssl.cnf'];
        foreach ($candidates as $c) {
            if ($c !== '' && is_file($c)) { $cfg = ['config' => $c]; break; }
        }
    }
    return $cfg;
}

function push_new_ec_key()
{
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC] + push_openssl_config());
    if ($key === false) throw new RuntimeException('openssl_pkey_new failed: ' . openssl_error_string());
    return $key;
}

function push_ec_public_raw($key): string
{
    $d = openssl_pkey_get_details($key)['ec'];
    return "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
}

function push_raw_public_to_pem(string $raw): string
{
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/** Подпись ECDSA из DER (как отдаёт openssl) в 64 байта R||S (как требует JWT). */
function push_der_to_raw_sig(string $der): string
{
    $pos = 2;
    if (ord($der[1]) & 0x80) $pos += ord($der[1]) & 0x7f;
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$pos + 1]);
        $int = substr($der, $pos + 2, $len);
        $pos += 2 + $len;
        $out .= str_pad(ltrim($int, "\0"), 32, "\0", STR_PAD_LEFT);
    }
    return $out;
}

function push_b64u(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function push_b64u_decode(string $s): string
{
    return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}
