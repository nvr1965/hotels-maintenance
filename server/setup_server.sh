#!/usr/bin/env bash
# Hotels Maintenance: сервер с нуля на Ubuntu 24.04 или новее (виртуальном или выделенном).
# nginx + php-fpm (версия, какая есть в системе, от 8.3) + PostgreSQL, снаружи доступ только через Cloudflare Tunnel (порты наружу не открываются).
#
#   sudo DOMAIN=hotels.allservice.cat TUNNEL_TOKEN=<токен туннеля> ADMIN_LOGIN=owner bash setup_server.sh
#
# Переменные (все необязательные):
#   DOMAIN        адрес сайта снаружи                    (hotels.allservice.cat)
#   TUNNEL_TOKEN  токен туннеля из панели Cloudflare     (без него туннель ставится позже, см. конец вывода)
#   REPO          откуда брать код                       (https://github.com/nvr1965/hotels-maintenance.git)
#   BRANCH        ветка                                  (main)
#   APP_DIR       куда ставить                           (/var/www/hotels)
#   LISTEN        где слушает nginx                      (127.0.0.1:80 — только для туннеля;
#                 80 — для VirtualBox с пробросом порта сайта, снаружи машина всё равно не видна)
#   ADMIN_LOGIN   завести владельца системы и первый отель (пароль напечатается один раз)
#   HOTEL_NAME, HOTEL_LANG, HOTEL_TZ   первый отель      (Hotel, en, UTC)
#
# Скрипт можно запускать повторно: что уже сделано, не переделывается; пароль базы и config.local.php не меняются.
set -euo pipefail

DOMAIN=${DOMAIN:-hotels.allservice.cat}
REPO=${REPO:-https://github.com/nvr1965/hotels-maintenance.git}
BRANCH=${BRANCH:-main}
APP_DIR=${APP_DIR:-/var/www/hotels}
DB_NAME=${DB_NAME:-hotels}
DB_USER=${DB_USER:-hotels}
LISTEN=${LISTEN:-127.0.0.1:80}

say() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Запускайте через sudo"; exit 1; }
. /etc/os-release
echo "Система: ${PRETTY_NAME:-неизвестно}"

say "Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq nginx postgresql git curl unzip ca-certificates cron \
    php-fpm php-cli php-pgsql php-curl php-gd php-mbstring php-xml php-zip php-intl
# Версия PHP — та, что пришла с системой (24.04: 8.3, новее: 8.4 и выше)
PHP=$(php -r 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;')
echo "PHP $PHP"

say "Код: $REPO ($BRANCH) → $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch -q origin "$BRANCH"
    git -C "$APP_DIR" checkout -q "$BRANCH"
    git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
    git clone -q -b "$BRANCH" "$REPO" "$APP_DIR"
fi
# Писать php может только туда, где это нужно: фото, сессии, ключи уведомлений (создаются сами)
mkdir -p "$APP_DIR/uploads" "$APP_DIR/backend/sessions"
chown -R www-data:www-data "$APP_DIR/uploads" "$APP_DIR/backend/sessions"
chgrp www-data "$APP_DIR/backend/core" && chmod 2775 "$APP_DIR/backend/core"

say "PostgreSQL: база $DB_NAME"
systemctl enable --now postgresql >/dev/null 2>&1 || systemctl start postgresql
CONF="$APP_DIR/backend/core/config.local.php"
if [ -f "$CONF" ]; then
    DB_PASS=$(php -r '$c = require $argv[1]; echo $c["db"]["pass"] ?? "";' "$CONF")
else
    DB_PASS=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
fi
if ! sudo -u postgres psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1; then
    sudo -u postgres psql -qc "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
else
    sudo -u postgres psql -qc "ALTER ROLE $DB_USER PASSWORD '$DB_PASS'"
fi
sudo -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 \
    || sudo -u postgres createdb -O "$DB_USER" -E UTF8 -T template0 "$DB_NAME"

if [ ! -f "$CONF" ]; then
    cat > "$CONF" <<PHPCONF
<?php
// Создан setup_server.sh. В git и в пакеты не входит.
return [
    'db' => ['host' => '127.0.0.1', 'port' => 5432, 'name' => '$DB_NAME', 'user' => '$DB_USER', 'pass' => '$DB_PASS'],
    'site_url' => 'https://$DOMAIN',
];
PHPCONF
fi
chown root:www-data "$CONF" && chmod 640 "$CONF"
PGPASSWORD="$DB_PASS" psql -q -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/pg/01_schema.sql"

say "PHP"
cat > /etc/php/$PHP/fpm/conf.d/90-hotels.ini <<'INI'
upload_max_filesize = 25M
post_max_size = 30M
memory_limit = 256M
max_execution_time = 120
date.timezone = UTC
expose_php = Off
INI
systemctl restart php$PHP-fpm

say "nginx"
cat > /etc/nginx/sites-available/hotels <<NGINX
# Hotels Maintenance. Снаружи — через туннель (или проброс порта VirtualBox).
server {
    listen $LISTEN default_server;
    server_name $DOMAIN localhost;
    root $APP_DIR;
    index index.php index.html;
    client_max_body_size 30m;
    server_tokens off;

    # Служебное из браузера не открывается
    location ~ ^/(backend/core|backend/sessions|tools|db|docs|server|lang|frontend)(/|\$) { return 404; }
    location ~ /\. { return 404; }
    # В папке фото php не выполняется
    location ^~ /uploads/ { try_files \$uri =404; }

    location ^~ /react/ {
        location ~ /\. { return 404; }
        location ~ ^/react/(index\.html|sw\.js|manifest\.webmanifest)\$ { add_header Cache-Control "no-cache, must-revalidate"; }
        location ^~ /react/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files \$uri =404; }
        try_files \$uri \$uri/ /react/index.html;
    }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php$PHP-fpm.sock;
        fastcgi_read_timeout 120s;
    }
}
NGINX
grep -q webmanifest /etc/nginx/mime.types || sed -i 's#^}#    application/manifest+json webmanifest;\n}#' /etc/nginx/mime.types
ln -sf /etc/nginx/sites-available/hotels /etc/nginx/sites-enabled/hotels
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx

say "Тексты интерфейса"
sudo -u www-data php "$APP_DIR/tools/seed_ui.php" --fill || echo "Перевод не удался (нет интернета?): переведётся сам при первом открытии"

say "Резервная копия базы каждую ночь (/var/backups/hotels, 14 дней)"
mkdir -p /var/backups/hotels && chmod 700 /var/backups/hotels
cat > /etc/cron.daily/hotels-backup <<CRON
#!/bin/sh
sudo -u postgres pg_dump -Fc $DB_NAME > /var/backups/hotels/$DB_NAME-\$(date +%F).dump
find /var/backups/hotels -name '*.dump' -mtime +14 -delete
CRON
chmod 755 /etc/cron.daily/hotels-backup

say "Cloudflare Tunnel"
install_cloudflared() {
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -q && apt-get install -yq cloudflared
}
command -v cloudflared >/dev/null || install_cloudflared || echo "cloudflared не установился, сайт работает локально; повторите скрипт позже"
if [ -n "${TUNNEL_TOKEN:-}" ] && command -v cloudflared >/dev/null; then
    systemctl is-active -q cloudflared || cloudflared service install "$TUNNEL_TOKEN"
    TUNNEL_NOTE="туннель запущен (служба cloudflared)"
else
    TUNNEL_NOTE="туннель ещё не подключён: в Cloudflare Zero Trust → Networks → Tunnels создать туннель,
   в Public Hostname указать $DOMAIN → http://localhost:80, затем: sudo cloudflared service install <токен>"
fi

if [ -n "${ADMIN_LOGIN:-}" ]; then
    say "Владелец системы"
    sudo -u www-data php "$APP_DIR/tools/create_admin.php" --login="$ADMIN_LOGIN" \
        --hotel="${HOTEL_NAME:-Hotel}" --lang="${HOTEL_LANG:-en}" --timezone="${HOTEL_TZ:-UTC}"
fi

say "Готово"
cat <<DONE
 Сайт: https://$DOMAIN   (на самом сервере: curl -I http://localhost/; nginx слушает $LISTEN)
 Код: $APP_DIR, ветка $BRANCH; обновление: sudo bash $APP_DIR/server/deploy.sh
 База: $DB_NAME, пароль в $CONF
 Cloudflare: $TUNNEL_NOTE
DONE
[ -n "${ADMIN_LOGIN:-}" ] || echo " Владелец системы: sudo -u www-data php $APP_DIR/tools/create_admin.php --login=owner --hotel=\"Название\""
