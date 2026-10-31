<?php
/* Скопируйте этот файл в config.local.php и впишите пароль базы.
 * config.local.php в git и в пакеты не входит (setup_server.sh создаёт его сам).
 */
return [
    // PostgreSQL
    'db' => [
        'host' => '127.0.0.1',
        'port' => 5432,
        'name' => 'hotels',
        'user' => 'hotels',
        'pass' => '',
    ],
    // Адрес сайта: контакт для уведомлений (Google/Apple)
    'site_url' => 'https://hotel.example.com',
];
