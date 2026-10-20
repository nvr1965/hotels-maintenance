<?php
/* Админка → Переводчики (только владелец системы), как в общем блоке i18n-block:
 * какие сервисы перевода настроены, порядок, в котором их пробуют, вкл/выкл, дневные лимиты, проверка.
 *
 * GET  ?action=list                              — сервисы по порядку: настроен ли, сколько знаков ушло сегодня
 * POST ?action=save  {translators: [{id, on, daily_chars}]}   — порядок, вкл/выкл, лимиты
 * POST ?action=check {id, lang}                  — перевести пробную фразу одним сервисом
 */
require_once __DIR__ . '/../core/api.php';

use Hotels\Translation\Settings;
use Hotels\Translation\TranslatorChain;

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
if ($me['is_superadmin'] !== 1) app_json_fail(403, 'forbidden');
$action = $_GET['action'] ?? 'list';
if ($action !== 'list') api_require_post();
$in = api_input();

if ($action === 'list') {
    api_ok(['translators' => TranslatorChain::get()->describe()]);
}

if ($action === 'save') {
    $catalog = TranslatorChain::config()['providers'];
    $rows = [];
    foreach ((array)($in['translators'] ?? []) as $row) {
        $id = (string)($row['id'] ?? '');
        if ($id === 'fake') continue; // проверочный, только на своём компьютере
        if (!isset($catalog[$id]) || isset($rows[$id])) api_fail('bad_translator');
        $rows[$id] = ['id' => $id, 'on' => !empty($row['on']), 'daily_chars' => max(0, min(100000000, (int)($row['daily_chars'] ?? 0)))];
    }
    $before = Settings::get('translators');
    Settings::put('translators', array_values($rows));
    audit($me, 'update', 'app_settings', 'translators', ['value' => $before], ['value' => array_values($rows)]);
    api_ok();
}

if ($action === 'check') {
    $lang = (string)($in['lang'] ?? '');
    if (!preg_match('/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/', $lang)) api_fail('bad_code');
    $provider = TranslatorChain::get()->only((string)($in['id'] ?? ''));
    if (!$provider) api_fail('not_ready');
    try {
        if (!$provider->supports($lang)) api_ok(['ok' => false, 'text' => 'unsupported']);
        api_ok(['ok' => true, 'text' => $provider->translate('Good morning! The air conditioner in room 204 is fixed.', $lang, 'en')]);
    } catch (Throwable $e) {
        api_ok(['ok' => false, 'text' => mb_strimwidth($e->getMessage(), 0, 300, '…')]);
    }
}

api_fail('bad_action');
