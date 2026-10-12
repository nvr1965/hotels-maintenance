<?php
/* Брендинг для экрана входа (до входа): GET ?hotel=<slug>, без slug — первый отель.
 * Отдаёт только то, что и так видно на экране: название, цвета, логотип, языки.
 */
require_once __DIR__ . '/../core/api.php';

$slug = (string)($_GET['hotel'] ?? '');
$sql = "SELECT h.*, o.name AS org_name FROM hotels h JOIN organizations o ON o.id = h.org_id
        WHERE h.active = 1 AND o.active = 1";
$h = $slug !== '' ? db_one("$sql AND h.slug = ? ORDER BY h.id LIMIT 1", [$slug]) : db_one("$sql ORDER BY h.id LIMIT 1");
if (!$h) api_fail('not_found', [], 404);

$p = app_hotel_public($h);
unset($p['settings'], $p['org_id'], $p['timezone']);
api_ok(['hotel' => $p]);
