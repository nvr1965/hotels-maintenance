<?php
/* Манифест приложения для установки на телефон: имя, цвета и значки — отеля.
 * GET ?hotel=<slug>. Значки отеля — settings.icons {192, 512, maskable192, maskable512}, иначе общие.
 */
require_once __DIR__ . '/../core/api.php';
header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=3600');

$slug = (string)($_GET['hotel'] ?? '');
$h = $slug !== '' ? db_one("SELECT * FROM hotels WHERE slug = ? AND active = 1", [$slug]) : null;
$s = $h ? (json_decode((string)($h['settings_json'] ?? ''), true) ?: []) : [];
$icons = is_array($s['icons'] ?? null) ? $s['icons'] : [];
$icon = fn(string $k, string $def) => is_string($icons[$k] ?? null) && preg_match('#^/[\w./-]+$#', $icons[$k]) ? $icons[$k] : $def;

echo json_encode([
    'id' => '/react/',
    'name' => $h['name'] ?? 'Hotel Service',
    'short_name' => mb_substr($h['name'] ?? 'Hotel', 0, 12),
    'lang' => $h['default_lang'] ?? 'en',
    'dir' => 'auto',
    'start_url' => '/react/' . ($h ? '?hotel=' . rawurlencode($h['slug']) : ''),
    'scope' => '/react/',
    'display' => 'standalone',
    'orientation' => 'portrait',
    'background_color' => '#f7f1eb',
    'theme_color' => $h['color_primary'] ?? '#1f3a5f',
    'icons' => [
        ['src' => $icon('192', '/react/icons/icon-192.png'), 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $icon('512', '/react/icons/icon-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $icon('maskable192', '/react/icons/maskable-192.png'), 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'maskable'],
        ['src' => $icon('maskable512', '/react/icons/maskable-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
