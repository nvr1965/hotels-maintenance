<?php
// Корень сайта: приложение живёт в /react/ (экран выбора языка — уже в нём, в оформлении отеля).
// ?hotel=<slug> передаётся дальше, чтобы до входа показать нужный отель.
$q = isset($_GET['hotel']) && preg_match('/^[a-z0-9-]{1,60}$/', (string)$_GET['hotel']) ? '?hotel=' . $_GET['hotel'] : '';
header('Location: /react/' . $q, true, 302);
