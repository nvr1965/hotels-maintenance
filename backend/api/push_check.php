<?php
/* Проверка уведомлений о срочных заявках текущего отеля. Только для администратора отеля.
 * Открыть в браузере, войдя в приложение администратором: <адрес сайта>/backend/api/push_check.php
 * Показывает, всё ли готово на сервере, кто из людей отеля подписан, и отправляет пробное уведомление.
 */
require_once __DIR__ . '/../core/tenancy.php';
$me = app_current();
if (!$me || !$me['hotel_id'] || $me['is_admin'] !== 1) {
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    echo '<p style="font:16px sans-serif">Сначала войдите в приложение администратором отеля, потом откройте эту страницу ещё раз.</p>';
    exit;
}
app_apply_timezone($me['hotel']['timezone']);
$hid = (int)$me['hotel_id'];
$hotel = $me['hotel'];
require_once __DIR__ . '/../core/push.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');

function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

// ---------------------------------------------------------------- сервер
$checks = [];
$checks[] = ['PHP ' . PHP_VERSION, true, ''];
$checks[] = ['Расширение curl', extension_loaded('curl'), ['', 'В C:\\xampp\\php\\php.ini убрать «;» перед extension=curl и перезапустить Apache']];
$checks[] = ['Расширение openssl', extension_loaded('openssl'), ['', 'В php.ini убрать «;» перед extension=openssl и перезапустить Apache']];
$keys = extension_loaded('openssl') ? push_vapid_keys() : null;
$checks[] = ['Ключи уведомлений (push_keys.php)', (bool)$keys, ['', 'Сервер не смог создать ключи, подробности в C:\\xampp\\apache\\logs\\error.log (строки push:)']];
$ca = ini_get('curl.cainfo') ?: ini_get('openssl.cafile') ?: push_ca_file();
$checks[] = ['Сертификаты для https', DIRECTORY_SEPARATOR !== '\\' || $ca !== '', $ca !== '' ? $ca : (DIRECTORY_SEPARATOR === '\\' ? 'Не найден файл сертификатов: в php.ini задать curl.cainfo' : 'системные')];

// Доступ к серверам Google и Apple
$reach = [];
if (extension_loaded('curl')) {
    foreach (['fcm.googleapis.com' => 'Android (Chrome)', 'web.push.apple.com' => 'iPhone'] as $host => $label) {
        $ch = curl_init("https://$host/");
        curl_setopt_array($ch, [CURLOPT_NOBODY => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5]);
        if ($ca !== '' && !ini_get('curl.cainfo')) curl_setopt($ch, CURLOPT_CAINFO, $ca);
        curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        $checks[] = ["Связь с $host ($label)", $code > 0, $code > 0 ? "ответ HTTP $code" : $err];
    }
}

// ---------------------------------------------------------------- подписки
$PUSH_ROLES = push_roles($hotel);
// Подписки людей этого отеля (подписка — на человека, а не на отель)
$subsSql = "SELECT s.*, u.display_name AS name, m.role, (u.active AND m.active) AS active, s.user_id AS worker_id
            FROM push_subscriptions s
            JOIN hotel_members m ON m.user_id = s.user_id AND m.hotel_id = $hid
            JOIN users u ON u.id = s.user_id
            ORDER BY u.display_name, s.id";
$subs = $db->query($subsSql)->fetch_all(MYSQLI_ASSOC);
$roles = "'" . implode("','", $PUSH_ROLES) . "'";
$noSub = $db->query("SELECT u.display_name AS name, m.role FROM hotel_members m JOIN users u ON u.id = m.user_id AND u.active = 1
                     WHERE m.hotel_id = $hid AND m.active = 1 AND m.role IN ($roles)
                       AND NOT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)
                     ORDER BY u.display_name")->fetch_all(MYSQLI_ASSOC);

function device_name(string $ua, string $endpoint): string
{
    if (str_contains($endpoint, 'push.apple.com')) $d = 'iPhone';
    elseif (preg_match('/Android/i', $ua)) $d = 'Android';
    elseif (preg_match('/Windows/i', $ua)) $d = 'Windows';
    elseif (preg_match('/Mac OS/i', $ua)) $d = 'Mac';
    else $d = 'Устройство';
    if (preg_match('/SamsungBrowser/i', $ua)) $d .= ', Samsung Internet';
    elseif (preg_match('/Firefox/i', $ua)) $d .= ', Firefox';
    elseif (preg_match('/Chrome/i', $ua)) $d .= ', Chrome';
    return $d;
}

// ---------------------------------------------------------------- пробная отправка
$results = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'test') {
    $only = (int)($_POST['sub'] ?? 0);
    $count = push_open_urgent_count($hid);
    $messages = [];
    foreach ($subs as $s) {
        if ($only && (int)$s['id'] !== $only) continue;
        $l = in_array($s['lang'], ['ru', 'en', 'he', 'ar'], true) ? $s['lang'] : 'ru';
        $body = ['ru' => 'Проверка: уведомления работают', 'en' => 'Test: notifications work',
                 'he' => 'בדיקה: ההתראות עובדות', 'ar' => 'اختبار: الإشعارات تعمل'][$l];
        $messages[] = [$s, ['type' => 'urgent', 'id' => 0, 'title' => '🔔 ' . $hotel['name'], 'body' => $body,
                            'count' => $count, 'silent' => false, 'lang' => $l]];
    }
    $results = push_send_all($messages, 'test');
}
$sentTo = $subs;
// Подписки с ответом 404/410 push_send_all удалил, список ниже уже без них
if ($results !== null) $subs = $db->query($subsSql)->fetch_all(MYSQLI_ASSOC);

function explain(int $code, string $err): string
{
    if ($code >= 200 && $code < 300) return 'Доставлено в Google/Apple. Если на телефоне не появилось, смотрите настройки уведомлений телефона.';
    if ($code === 404 || $code === 410) return 'Телефон больше не подписан (приложение удалено или запрещены уведомления). Подписка удалена, на телефоне нужно снова нажать «Включить уведомления».';
    if ($code === 403 || $code === 401) return 'Ключи сервера не совпадают с подпиской (push_keys.php меняли или удаляли). На этом телефоне выйти из приложения, войти и снова включить уведомления.';
    if ($code === 0 && preg_match('/certificate|SSL|issuer/i', $err)) return 'Сервер не может проверить сертификат Google/Apple: в php.ini не задан curl.cainfo.';
    if ($code === 0) return 'Сервер не достучался до Google/Apple: нет выхода в интернет, брандмауэр или прокси.';
    return 'Ошибка сервиса уведомлений.';
}
?>
<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Проверка уведомлений</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px;background:#f7f2ec;color:#3f3530}
h1{font-size:20px;margin:0 0 12px} h2{font-size:17px;margin:22px 0 8px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden}
td,th{padding:8px 10px;border-bottom:1px solid #eee3d8;text-align:left;vertical-align:top}
th{font-size:13px;color:#8a7a6e}
.ok{color:#2e7d32;font-weight:bold}.bad{color:#a3301c;font-weight:bold}.muted{color:#8a7a6e;font-size:13px}
button{font-size:15px;padding:9px 16px;border-radius:8px;border:none;background:#844128;color:#fff;cursor:pointer}
.small{padding:5px 10px;font-size:13px;background:#b08a6e}
.wrap{max-width:900px;margin:0 auto}.scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<h1>Проверка уведомлений о срочных заявках: <?= h($hotel['name']) ?></h1>

<h2>Сервер</h2>
<div class="scroll"><table>
<?php foreach ($checks as [$name, $ok, $note]): ?>
<tr><td><?= h($name) ?></td><td class="<?= $ok ? 'ok' : 'bad' ?>"><?= $ok ? 'да' : 'нет' ?></td><td class="muted"><?= h(is_array($note) ? $note[$ok ? 0 : 1] : $note) ?></td></tr>
<?php endforeach; ?>
</table></div>

<?php if ($results !== null): ?>
<h2>Результат пробной отправки</h2>
<?php if (!$results): ?><p class="bad">Отправлять некому: ни один телефон не подписан.</p><?php endif; ?>
<div class="scroll"><table>
<tr><th>Кто</th><th>Устройство</th><th>Ответ</th><th>Что это значит</th></tr>
<?php foreach ($sentTo as $s): if (!isset($results[(int)$s['id']])) continue; $r = $results[(int)$s['id']]; ?>
<tr><td><?= h($s['name'] ?? ('#' . $s['worker_id'])) ?></td><td><?= h(device_name((string)$s['user_agent'], $s['endpoint'])) ?></td>
<td class="<?= $r['code'] >= 200 && $r['code'] < 300 ? 'ok' : 'bad' ?>"><?= $r['code'] ?: 'нет связи' ?><div class="muted"><?= h($r['error']) ?></div></td>
<td><?= h(explain($r['code'], $r['error'])) ?></td></tr>
<?php endforeach; ?>
</table></div>
<?php endif; ?>

<h2>Последние рассылки по настоящим заявкам</h2>
<?php
$log = $db->query("SELECT l.*, t.user_id, w.display_name AS author FROM push_log l
                   LEFT JOIN maintenance_tasks t ON t.id = l.task_id LEFT JOIN users w ON w.id = t.user_id
                   WHERE l.hotel_id = $hid
                   ORDER BY l.id DESC LIMIT 20")->fetch_all(MYSQLI_ASSOC);
?>
<?php if (!$log): ?>
<p class="muted">Записей пока нет. Они появятся после следующей срочной заявки. Если заявку создали, а записи нет, значит рассылка даже не началась: пришлите снимок этой страницы.</p>
<?php else: ?>
<div class="scroll"><table>
<tr><th>Когда</th><th>Заявка</th><th>Автор</th><th>Отправлено / доставлено</th><th>Подробности</th></tr>
<?php foreach ($log as $l): ?>
<tr><td class="muted"><?= h($l['created_at']) ?></td><td>#<?= (int)$l['task_id'] ?></td><td><?= h($l['author'] ?? '') ?></td>
<td class="<?= (int)$l['sent'] > 0 && (int)$l['ok'] === (int)$l['sent'] ? 'ok' : 'bad' ?>"><?= (int)$l['sent'] ?> / <?= (int)$l['ok'] ?></td>
<td class="muted"><?= h($l['note']) ?></td></tr>
<?php endforeach; ?>
</table></div>
<?php endif; ?>

<h2>Подписанные телефоны (<?= count($subs) ?>)</h2>
<form method="post"><input type="hidden" name="action" value="test">
<p><button type="submit">Отправить пробное уведомление всем</button></p></form>
<div class="scroll"><table>
<tr><th>Кто</th><th>Роль</th><th>Устройство</th><th>Подписан</th><th>Последняя доставка</th><th></th></tr>
<?php foreach ($subs as $s):
    $gets = in_array((string)$s['role'], $PUSH_ROLES, true) && (int)$s['active'] === 1; ?>
<tr><td><?= h($s['name'] ?? ('удалённый сотрудник #' . $s['worker_id'])) ?></td>
<td><?= h($s['role']) ?><?php if (!$gets): ?><div class="bad">не получает: <?= (int)$s['active'] !== 1 ? 'заблокирован' : 'эта роль в настройках отеля уведомления не получает' ?></div><?php endif; ?></td>
<td><?= h(device_name((string)$s['user_agent'], $s['endpoint'])) ?><?= (int)$s['silent'] ? ' <span class="muted">(без звука)</span>' : '' ?></td>
<td class="muted"><?= h($s['created_at']) ?></td><td class="muted"><?= h($s['last_ok_at'] ?: 'ещё не было') ?></td>
<td><form method="post"><input type="hidden" name="action" value="test"><input type="hidden" name="sub" value="<?= (int)$s['id'] ?>"><button class="small" type="submit">Тест</button></form></td></tr>
<?php endforeach; ?>
</table></div>

<h2>Получатели без подписки (<?= count($noSub) ?>)</h2>
<?php if ($noSub): ?>
<p class="muted">Им уведомления не придут, пока на их телефоне не нажмут «🔔 Включить уведомления» в шапке приложения.</p>
<div class="scroll"><table>
<?php foreach ($noSub as $w): ?><tr><td><?= h($w['name']) ?></td><td><?= h($w['role']) ?></td></tr><?php endforeach; ?>
</table></div>
<?php else: ?><p class="ok">Все подписаны.</p><?php endif; ?>

<h2>Кто получает уведомления</h2>
<p class="muted">Люди этого отеля с ролями из настройки отеля (по умолчанию Исполнитель и Руководитель), не заблокированные в админке. Автор заявки о своей заявке уведомление не получает. Кто работает в нескольких отелях, видит в заголовке название отеля. На iPhone уведомления работают только в приложении, добавленном на экран «Домой».</p>
</div></body></html>
