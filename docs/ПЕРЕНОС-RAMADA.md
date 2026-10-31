# Перенос Ramada на сервер Hotels Maintenance

Работающий сайт Ramada при переносе не меняется: из его базы только читаем, фото копируем.

## 1. Сервер

```bash
sudo DOMAIN=hotels.allservice.cat TUNNEL_TOKEN=<токен> BRANCH=main bash setup_server.sh
```

`ADMIN_LOGIN` здесь не указывать: владельцем системы станет сотрудник Ramada (шаг 3).

## 2. База Ramada на сервере

На компьютере с XAMPP сделать дамп (phpMyAdmin → Экспорт, или `mysqldump -u root ramada > ramada.sql`), перенести файл на сервер и загрузить во временную MariaDB:

```bash
sudo apt-get install -y mariadb-server php8.3-mysql
sudo mysql -e "CREATE DATABASE ramada CHARACTER SET utf8mb4"
sudo mysql ramada < ramada.sql
```

## 3. Перенос

```bash
cd /var/www/hotels
sudo php tools/migrate_ramada.php --src-host=localhost --dry-run          # проверка и отчёт, ничего не пишет
sudo php tools/migrate_ramada.php --src-host=localhost --superadmin=Admin  # перенос в пустую базу
```

`--superadmin` — логин сотрудника Ramada, который станет владельцем системы (видит вкладки «Сеть и отели», «Языки», «База данных»).
Повторить перенос со свежими данными: добавить `--replace` (всё в новой базе стирается и переносится заново).

## 4. Фото

Папку `uploads/` сайта Ramada скопировать в `/var/www/hotels/uploads/`, адреса фото в заявках останутся прежними:

```bash
sudo rsync -a ramada/uploads/ /var/www/hotels/uploads/
sudo chown -R www-data:www-data /var/www/hotels/uploads
```

## 5. Ключи

`secrets.php` (Gemini, Google) положить в `/var/www/hotels/backend/core/` вручную, через git и архивы он не передаётся.
Ключи уведомлений (`push_keys.php`) лучше перенести тем же способом: тогда телефоны, на которых уже включены уведомления, продолжат их получать (вместе с `--with-push` при переносе).

```bash
sudo chown root:www-data /var/www/hotels/backend/core/{secrets,push_keys}.php
sudo chmod 640 /var/www/hotels/backend/core/{secrets,push_keys}.php
```

## 6. Проверка

Открыть сайт, войти сотрудником Ramada, проверить заявки, регламенты, счётчики и выгрузки. Временную MariaDB после этого можно удалить: `sudo apt-get purge -y mariadb-server`.
