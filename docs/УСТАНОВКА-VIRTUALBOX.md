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
4. «Готово». Затем «Настроить» → «Сеть» → Адаптер 1: «NAT» → «Дополнительно» → «Проброс портов» → добавить правило: хост `2222`, гость `22` (это для входа по SSH с вашего компьютера).

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
ssh -p 2222 nick@127.0.0.1
```

Первый раз ответить `yes` и ввести пароль. Обновить систему:

```
sudo apt update && sudo apt -y upgrade && sudo reboot
```

Через минуту войти снова той же командой `ssh`.

## 5. Туннель Cloudflare (адрес сайта снаружи)

Нужен домен `allservice.cat`, подключённый к Cloudflare.

1. https://one.dash.cloudflare.com → Networks → Tunnels → Create a tunnel → Cloudflared.
2. Имя `hotels` → Save.
3. На экране установки показана команда с длинной строкой после `--token` или `service install`. Скопировать только эту строку: это токен.
4. Next → Public Hostname: Subdomain `hotels`, Domain `allservice.cat`, Service: `HTTP`, URL `localhost:80` → Save.

## 6. Поставить приложение

На сервере (вставить свой токен):

```
curl -fsSLO https://raw.githubusercontent.com/nvr1965/hotels-maintenance/feature/postgresql/server/setup_server.sh
sudo BRANCH=feature/postgresql DOMAIN=hotels.allservice.cat TUNNEL_TOKEN=ВАШ_ТОКЕН ADMIN_LOGIN=owner HOTEL_NAME="Ramada" HOTEL_LANG=ru HOTEL_TZ=Asia/Jerusalem bash setup_server.sh
```

Скрипт идёт несколько минут. В конце он печатает пароль владельца `owner` — **записать**, второй раз не покажет (сменить можно: `sudo -u www-data php /var/www/hotels/tools/create_admin.php --login=owner`).

`BRANCH=feature/postgresql` — пока версия 2 не влита в `main`. После слияния эту часть можно не писать.

## 7. Проверить

- Открыть https://hotels.allservice.cat, войти `owner` и паролем из шага 6.
- Админка → «Языки»: добавить, например, French и посмотреть, как переводится интерфейс.

Если туннель ещё не готов, сайт можно открыть через SSH: на вашем компьютере `ssh -p 2222 -L 8080:localhost:80 nick@127.0.0.1` и в браузере http://localhost:8080 (уведомления на телефон так работать не будут, им нужен https).

## 8. Дальше

- Обновить код после изменений: `sudo bash /var/www/hotels/server/deploy.sh`
- Перенести данные Ramada: `docs/ПЕРЕНОС-RAMADA.md`. Тогда в шаге 6 `ADMIN_LOGIN` и `HOTEL_*` не указывать.
- Ключ Gemini и Google (`secrets.php`) положить в `/var/www/hotels/backend/core/` вручную.
- Перед экспериментами удобно сделать снимок машины: VirtualBox → «Снимки» → «Сделать». Откат — одним щелчком.

## Если что-то не так

- Скрипт можно запускать повторно, сделанное он не ломает.
- Состояние туннеля: `sudo systemctl status cloudflared`. Сайт на самом сервере: `curl -I http://localhost/`.
- Ошибки php: `sudo tail -50 /var/log/nginx/error.log`.
