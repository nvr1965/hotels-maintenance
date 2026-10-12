<?php
/* Переключить текущий отель. POST {hotel_id} → то же, что me.php. */
require_once __DIR__ . '/../core/api.php';
api_require_post();

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
$hotelId = (int)(api_input()['hotel_id'] ?? 0);
if (!app_select_hotel($me, $hotelId)) api_fail('forbidden', [], 403);

echo json_encode(app_me_payload(app_current()), JSON_UNESCAPED_UNICODE);
