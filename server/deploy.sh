#!/usr/bin/env bash
# Выложить свежий код на сервер: sudo bash /var/www/hotels/server/deploy.sh [ветка]
# Берёт ветку с GitHub, обновляет схему базы (повторный запуск схемы безопасен) и тексты интерфейса.
# config.local.php, secrets.php, push_keys.php и фото (uploads/) не трогаются: их нет в git.
set -euo pipefail
APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
BRANCH=${1:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}
[ "$(id -u)" -eq 0 ] || { echo "Запускайте через sudo"; exit 1; }

before=$(git -C "$APP_DIR" rev-parse --short HEAD)
git -C "$APP_DIR" fetch -q origin "$BRANCH"
git -C "$APP_DIR" checkout -q "$BRANCH"
git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
after=$(git -C "$APP_DIR" rev-parse --short HEAD)
echo "Код: $before → $after ($BRANCH)"

CONF="$APP_DIR/backend/core/config.local.php"
eval "$(php -r '$c = require $argv[1]; $d = $c["db"]; printf("DB_HOST=%s DB_NAME=%s DB_USER=%s DB_PASS=%s", escapeshellarg($d["host"]), escapeshellarg($d["name"]), escapeshellarg($d["user"]), escapeshellarg($d["pass"]));' "$CONF")"
PGPASSWORD="$DB_PASS" psql -q -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/pg/01_schema.sql"
echo "Схема базы обновлена"

sudo -u www-data php "$APP_DIR/tools/seed_ui.php" --fill || echo "Перевод не удался: переведётся сам при первом открытии"
systemctl reload php8.3-fpm
echo "Готово"
