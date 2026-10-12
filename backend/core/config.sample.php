<?php
/* Скопируйте этот файл в config.local.php и поправьте под свой сервер.
 * config.local.php в пакеты обновлений не входит и при установке не заменяется.
 * Без config.local.php действуют значения ниже (обычный XAMPP: root без пароля).
 */
return [
    'db' => [
        'host' => 'localhost',
        'user' => 'root',
        'pass' => '',
        'name' => 'hotelapp',
    ],
    // Адрес сайта: контакт для уведомлений (Google/Apple)
    'site_url' => 'https://hotel.example.com',
];
