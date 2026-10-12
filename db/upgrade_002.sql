-- hotelapp: обновление базы для этапов 2–3 (повторный запуск безопасен).
--   C:\xampp\mysql\bin\mysql.exe -u root hotelapp < db\upgrade_002.sql
SET NAMES utf8mb4;

-- Цвет кнопок отеля
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS color_button CHAR(7) NOT NULL DEFAULT '#1f3a5f' AFTER color_text;

-- Ramada, перенесённая на этапе 1: прежний цвет кнопок и логотип
UPDATE hotels SET color_button = '#844128' WHERE color_primary = '#371f20' AND color_button = '#1f3a5f';
UPDATE hotels SET logo_url = '/brand/ramada.svg' WHERE logo_url IS NULL AND brand_subtitle = 'OLIVIÉ NAZARETH';
UPDATE hotels SET settings_json = JSON_SET(COALESCE(settings_json, '{}'), '$.icons', JSON_OBJECT(
    '192', '/brand/ramada/icon-192.png', '512', '/brand/ramada/icon-512.png',
    'maskable192', '/brand/ramada/maskable-192.png', 'maskable512', '/brand/ramada/maskable-512.png'))
WHERE logo_url = '/brand/ramada.svg' AND JSON_EXTRACT(COALESCE(settings_json, '{}'), '$.icons') IS NULL;
