# Сервер Hotels Maintenance в VirtualBox: по шагам

Позже то же самое делается на выделенном сервере, начиная с шага 4.

## 1. Скачать

- VirtualBox: https://www.virtualbox.org/wiki/Downloads
- Ubuntu Server 24.04 LTS (файл `.iso`): https://ubuntu.com/download/server

## 2. Создать виртуальную машину

VirtualBox → «Создать»:

1. Имя `hotels`, образ ISO — скачанный файл Ubuntu. Галочку «Пропустить автоматическую установку» поставить (установим сами, так надёжнее).
2. Память 4096 МБ, процессоров 2.
3. Диск 40 ГБ (динамический, место занимается по мере заполнения).
4. «Готово». Затем «Настроить» → «Сеть» → Адаптер 1: «NAT» → «Дополнительно» → «Проброс портов» → добавить два правила (2222–2224 и 8080–8082 заняты другими машинами):
   - `ssh`: хост `2225`, гость `22`
   - `http`: хост `8083`, гость `80`

## 3. Установить Ubuntu

Запустить машину, дальше по экрану:

1. Язык English (сообщения сервера проще искать в интернете).
2. Тип установки: Ubuntu Server. Сеть, прокси, зеркало — оставить как есть.
3. Диск: «Use an entire disk», дальше «Done» и «Continue».
4. Имя пользователя, например `nick`, имя сервера `hotels`, пароль — запомнить.
5. **Поставить галочку «Install OpenSSH server».**
6. Дополнительные пакеты (snaps) не выбирать. Дождаться конца, «Reboot Now». Если просит вынуть диск — просто Enter.

## 4. Войти на сервер

Удобнее с вашего компьютера, чтобы копировать команды (Windows: PowerShell; Mac: Терминал):

```
ssh -p 2225 nick@localhost
```

Первый раз ответить `yes` и ввести пароль. Обновить систему:

```
sudo apt update && sudo apt -y upgrade && sudo reboot
```

Через минуту войти снова той же командой `ssh`.

## 5. Туннель Cloudflare (позже, сейчас пропустить)

Нужен домен `allservice.cat`, подключённый к Cloudflare.

1. https://one.dash.cloudflare.com → Networks → Tunnels → Create a tunnel → Cloudflared.
2. Имя `hotels` → Save.
3. На экране установки показана команда с длинной строкой после `--token` или `service install`. Скопировать только эту строку: это токен.
4. Next → Public Hostname: Subdomain `hotels`, Domain `allservice.cat`, Service: `HTTP`, URL `localhost:80` → Save.

## 6. Поставить приложение

На сервере:

```
curl -fsSLO https://raw.githubusercontent.com/nvr1965/hotels-maintenance/feature/postgresql/server/setup_server.sh
sudo BRANCH=feature/postgresql LISTEN=80 ADMIN_LOGIN=owner HOTEL_NAME="Test Hotel" HOTEL_LANG=ru HOTEL_TZ=Asia/Jerusalem bash setup_server.sh
```

Для туннеля (позже): `sudo BRANCH=feature/postgresql LISTEN=80 DOMAIN=hotels.allservice.cat TUNNEL_TOKEN=ВАШ_ТОКЕН bash setup_server.sh` (без `ADMIN_LOGIN`, иначе пароль владельца сменится).

Скрипт идёт несколько минут. В конце он печатает пароль владельца `owner` — **записать**, второй раз не покажет (сменить можно: `sudo -u www-data php /var/www/hotels/tools/create_admin.php --login=owner`).

`BRANCH=feature/postgresql` — пока версия 2 не влита в `main`. После слияния эту часть можно не писать.

## 7. Проверить

- Открыть http://localhost:8083, войти `owner` и паролем из шага 6. Когда будет туннель — https://hotels.allservice.cat.
- Админка → «Языки»: добавить, например, French и посмотреть, как переводится интерфейс.

Уведомления на телефон заработают только через туннель: им нужен https.

## 8. Дальше

- Обновить код после изменений: `sudo bash /var/www/hotels/server/deploy.sh`
- Ключ Gemini и Google (`secrets.php`) положить в `/var/www/hotels/backend/core/` вручную.
- Перед экспериментами удобно сделать снимок машины: VirtualBox → «Снимки» → «Сделать». Откат — одним щелчком.

## Если что-то не так

- Скрипт можно запускать повторно, сделанное он не ломает.
- Состояние туннеля: `sudo systemctl status cloudflared`. Сайт на самом сервере: `curl -I http://localhost/`.
- Ошибки php: `sudo tail -50 /var/log/nginx/error.log`.
