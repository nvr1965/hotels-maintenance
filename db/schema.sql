-- hotelapp: база для сети гостиниц (сеть → отели → объекты).
-- Создаётся рядом с базой ramada, ramada не меняется.
--
--   mysql -u root < schema.sql            (создаст базу hotelapp)
--
-- Повторный запуск безопасен: CREATE TABLE IF NOT EXISTS.
-- Языки пока те же четыре колонки *_ru/_en/_he/_ar, как в Ramada.

CREATE DATABASE IF NOT EXISTS hotelapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hotelapp;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------- сеть и отели

-- Сеть (компания). Отдельный отель — это сеть из одного отеля.
CREATE TABLE IF NOT EXISTS organizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(60) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Отель. Всё, что в Ramada было зашито в код (название, цвета, часовой пояс, языки), лежит здесь.
CREATE TABLE IF NOT EXISTS hotels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(60) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    default_lang CHAR(2) NOT NULL DEFAULT 'en',
    languages VARCHAR(40) NOT NULL DEFAULT 'ru,en,he,ar',
    -- Брендинг: заголовок на экране входа (на каждом языке), подпись, цвета, логотип
    brand_title_ru VARCHAR(200) NULL,
    brand_title_en VARCHAR(200) NULL,
    brand_title_he VARCHAR(200) NULL,
    brand_title_ar VARCHAR(200) NULL,
    brand_subtitle VARCHAR(200) NULL,
    color_primary CHAR(7) NOT NULL DEFAULT '#1f3a5f',
    color_accent CHAR(7) NOT NULL DEFAULT '#c9a96e',
    color_text CHAR(7) NOT NULL DEFAULT '#ffffff',
    logo_url VARCHAR(255) NULL,
    address VARCHAR(255) NULL,
    -- Прочие настройки без отдельной колонки (кому слать уведомления, включено ли распознавание и т.п.)
    settings_json TEXT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_slug (org_id, slug),
    CONSTRAINT fk_hotels_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- люди

-- Пользователь один на всю систему: один человек может работать в нескольких отелях.
-- id перенесённых из Ramada сотрудников совпадают с workers.id.
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    login VARCHAR(100) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    lang CHAR(2) NOT NULL DEFAULT 'ru',
    active TINYINT(1) NOT NULL DEFAULT 1,
    -- Владелец системы: видит все сети. Обычно один человек.
    is_superadmin TINYINT(1) NOT NULL DEFAULT 0,
    last_hotel_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Роль в сети: администратор (все отели сети как администратор отеля) или наблюдатель (только отчёты).
CREATE TABLE IF NOT EXISTS org_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    org_id INT NOT NULL,
    user_id INT NOT NULL,
    role ENUM('org_admin','org_viewer') NOT NULL DEFAULT 'org_viewer',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_user (org_id, user_id),
    KEY idx_user (user_id),
    CONSTRAINT fk_om_org FOREIGN KEY (org_id) REFERENCES organizations(id),
    CONSTRAINT fk_om_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Роль в отеле. worker — Исполнитель, manager — Менеджер, head — Руководитель.
-- is_admin — администратор отеля (бывший флаг sysadmin в Ramada).
CREATE TABLE IF NOT EXISTS hotel_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    user_id INT NOT NULL,
    role ENUM('worker','manager','head') NOT NULL DEFAULT 'worker',
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_hotel_user (hotel_id, user_id),
    KEY idx_user (user_id),
    CONSTRAINT fk_hm_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id),
    CONSTRAINT fk_hm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- «Запомнить меня»: хранится только sha256 от validator, как в Ramada
CREATE TABLE IF NOT EXISTS auth_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    selector CHAR(24) NOT NULL,
    validator_hash CHAR(64) NOT NULL,
    user_id INT NOT NULL,
    lang CHAR(2) NOT NULL DEFAULT 'ru',
    hotel_id INT NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    UNIQUE KEY uq_selector (selector),
    KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- справочники (у каждого отеля свои)

-- Названия объектов: ключ term_en уникален внутри отеля
CREATE TABLE IF NOT EXISTS asset_dictionary (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    term_en VARCHAR(150) NOT NULL,
    term_ru VARCHAR(150) NULL,
    term_he VARCHAR(150) NULL,
    term_ar VARCHAR(150) NULL,
    UNIQUE KEY uq_hotel_term (hotel_id, term_en),
    CONSTRAINT fk_ad_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Объекты отеля: номера (asset_key из цифр) и прочее (asset_key = term_en из справочника)
CREATE TABLE IF NOT EXISTS hotel_assets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    building VARCHAR(50) NULL,
    floor VARCHAR(20) NULL,
    asset_key VARCHAR(150) NOT NULL,
    KEY idx_hotel_key (hotel_id, asset_key),
    CONSTRAINT fk_ha_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Пункты чек-листа номера
CREATE TABLE IF NOT EXISTS room_checklist_dict (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    name_ru VARCHAR(255) NULL,
    name_en VARCHAR(255) NULL,
    name_he VARCHAR(255) NULL,
    name_ar VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    KEY idx_hotel (hotel_id),
    CONSTRAINT fk_rcd_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Регламентные работы (requires_ocr = 1 — счётчик по фото)
CREATE TABLE IF NOT EXISTS routine_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    name_ru VARCHAR(255) NULL,
    name_en VARCHAR(255) NULL,
    name_he VARCHAR(255) NULL,
    name_ar VARCHAR(255) NULL,
    requires_ocr TINYINT(1) NOT NULL DEFAULT 0,
    ocr_type VARCHAR(30) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    KEY idx_hotel (hotel_id),
    CONSTRAINT fk_rt_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- работа

-- Заявки: task_type current (срочная) | planned (плановый обход).
-- user_id — автор срочной, creator_id — автор плановой, worker_id — кто закрыл.
CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    task_type VARCHAR(20) NOT NULL DEFAULT 'current',
    asset_id INT NULL,
    user_id INT NULL,
    creator_id INT NULL,
    worker_id INT NULL,
    description_ru TEXT NULL,
    description_en TEXT NULL,
    description_he TEXT NULL,
    description_ar TEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    notes TEXT NULL,
    media TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL,
    KEY idx_hotel_status (hotel_id, status),
    KEY idx_hotel_type (hotel_id, task_type),
    KEY idx_asset (asset_id),
    CONSTRAINT fk_mt_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_workers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    worker_id INT NOT NULL,
    KEY idx_task (task_id),
    KEY idx_worker (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_room_checks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    check_id INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    comment_ru TEXT NULL,
    comment_en TEXT NULL,
    comment_he TEXT NULL,
    comment_ar TEXT NULL,
    KEY idx_task_check (task_id, check_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Отметки регламентных работ за день (одна строка на работу в день)
CREATE TABLE IF NOT EXISTS routine_schedule (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    task_id INT NOT NULL,
    worker_id INT NULL,
    target_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    notes TEXT NULL,
    media TEXT NULL,
    ocr_value VARCHAR(50) NULL,
    ocr_unit VARCHAR(20) NULL,
    ocr_raw TEXT NULL,
    UNIQUE KEY uq_task_date (task_id, target_date),
    KEY idx_hotel_date (hotel_id, target_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- История закрытий регламентных работ и показаний счётчиков
CREATE TABLE IF NOT EXISTS routine_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    schedule_id INT NULL,
    task_id INT NOT NULL,
    worker_id INT NULL,
    target_date DATE NOT NULL,
    status ENUM('pending','done') NOT NULL DEFAULT 'done',
    notes TEXT NULL,
    media TEXT NULL,
    ocr_value VARCHAR(50) NULL,
    ocr_unit VARCHAR(20) NULL,
    ocr_raw TEXT NULL,
    is_repeat TINYINT(1) NOT NULL DEFAULT 0,
    closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_task_date (task_id, target_date),
    KEY idx_hotel_date (hotel_id, target_date),
    KEY idx_worker (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ссылка для начальника на отчёт по счётчикам (без входа), теперь у каждого отеля своя
CREATE TABLE IF NOT EXISTS meter_report_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NOT NULL,
    link_key CHAR(32) NOT NULL,
    label VARCHAR(100) NOT NULL DEFAULT '',
    lang CHAR(2) NOT NULL DEFAULT 'he',
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    revoked TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_key (link_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- уведомления и журнал

-- Подписка телефона. Получатели выбираются по hotel_members отеля заявки.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    endpoint TEXT NOT NULL,
    endpoint_hash CHAR(64) NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(64) NOT NULL,
    lang CHAR(2) NOT NULL DEFAULT 'ru',
    silent TINYINT(1) NOT NULL DEFAULT 0,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_ok_at DATETIME NULL,
    UNIQUE KEY uq_endpoint (endpoint_hash),
    KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hotel_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kind VARCHAR(10) NOT NULL,
    task_id INT NOT NULL,
    sent INT NOT NULL DEFAULT 0,
    ok INT NOT NULL DEFAULT 0,
    note VARCHAR(1000) NOT NULL DEFAULT '',
    KEY idx_hotel (hotel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Журнал правок администраторов (кто, где, что было и что стало)
CREATE TABLE IF NOT EXISTS admin_audit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    org_id INT NULL,
    hotel_id INT NULL,
    user_id INT NULL,
    user_name VARCHAR(100) NULL,
    action VARCHAR(20) NOT NULL,
    tbl VARCHAR(64) NOT NULL,
    row_key VARCHAR(255) NULL,
    before_json MEDIUMTEXT NULL,
    after_json MEDIUMTEXT NULL,
    KEY idx_at (at),
    KEY idx_hotel (hotel_id),
    KEY idx_tbl (tbl)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
