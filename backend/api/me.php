<?php
/* Кто вошёл на этом устройстве, текущий отель с брендингом и список отелей для переключения. 401 — никто. */
require_once __DIR__ . '/../core/api.php';

$me = app_current();
if (!$me) app_json_fail(401, 'auth_required');
echo json_encode(app_me_payload($me), JSON_UNESCAPED_UNICODE);
