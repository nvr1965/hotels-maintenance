// Общее для разделов админки: тексты на 4 языках, запросы к API, стили.

export const LANG_NAMES = { ru: 'Русский', en: 'English', he: 'עברית', ar: 'العربية' };
export const LANG_LIST = ['ru', 'en', 'he', 'ar'];
export const isRtl = (lang) => lang === 'he' || lang === 'ar';

const T = {
    ru: {
        save: 'Сохранить', cancel: 'Отмена', add: 'Добавить', edit: 'Изменить', delete: 'Удалить', close: 'Закрыть',
        loading: 'Загрузка…', saved: 'Сохранено', deleted: 'Удалено', search: 'Поиск…', all: 'Все', actions: 'Действия',
        yes: 'Да', no: 'Нет', empty: 'Пусто', refresh: 'Обновить', total: 'Всего', back: 'Назад',
        confirm_delete: 'Удалить безвозвратно?',
        translate: '🌐 Перевести на все языки', translating: 'Перевожу…', translate_hint: 'Впишите текст на любом языке и нажмите «Перевести». Перевод можно поправить.',
        // ошибки сервера
        err_network: 'Нет связи с сервером', err_unknown: 'Не получилось',
        err_forbidden: 'Нужны права администратора', err_auth_required: 'Нужно войти заново',
        err_name_required: 'Впишите название / имя', err_name_taken: 'Сотрудник с таким именем уже есть (имя — это логин)',
        err_password_required: 'Задайте пароль', err_password_short: 'Пароль слишком короткий (минимум 4 символа)',
        err_bad_role: 'Неизвестная роль', err_self_lockout: 'Нельзя заблокировать, удалить себя или снять с себя права администратора',
        err_last_admin: 'Должен остаться хотя бы один действующий администратор', err_not_found: 'Запись не найдена (обновите страницу)',
        err_key_required: 'Нужен английский ключ', err_key_taken: 'Такой ключ уже есть', err_key_digits: 'Ключ из одних цифр — это номер комнаты, добавьте его во вкладке «Объекты»',
        err_ocr_type_required: 'Выберите тип счётчика', err_asset_exists: 'Такой объект в этом корпусе и на этом этаже уже есть',
        err_bad_range: 'Неверный диапазон номеров', err_range_too_big: 'Слишком много номеров за раз (не больше 300)',
        err_readonly: 'Эту таблицу можно только смотреть', err_nothing_to_save: 'Нечего сохранять', err_no_table: 'Таблица не найдена',
        err_db_error: 'Ошибка базы данных',
        in_use: (n) => `Используется в ${n} записях. Всё равно удалить? История останется, но без этой связи.`,
        // вкладки
        tab_network: '🏨 Сеть и отели', tab_users: '👥 Сотрудники', tab_dicts: '📚 Справочники', tab_assets: '🏢 Объекты', tab_tasks: '📋 Заявки', tab_meters: '📷 Счётчики', tab_db: '🗄️ База данных',
        // сотрудники
        new_user: '＋ Новый сотрудник', name_login: 'Имя (это логин для входа)', password: 'Пароль', password_keep: 'Новый пароль (пусто — не менять)',
        role: 'Роль', sysadmin: 'Администратор', active: 'Доступ', blocked: 'Заблокирован', allowed: 'Разрешён',
        block: '🚫 Заблокировать', unblock: '✅ Разблокировать', logout_all: '🚪 Выйти на всех устройствах', logout_done: 'Запомненные входы удалены',
        devices: 'Запомнено устройств', last_seen: 'Последний вход', you: 'это вы', plain_pw: 'Пароль хранится открытым текстом, задайте новый',
        user_links: (n) => `У сотрудника ${n} записей в истории. Лучше заблокировать его, тогда история сохранится с именем. Всё равно удалить?`,
        rights_title: 'Что может каждая роль',
        role_worker: 'Исполнитель', role_manager: 'Менеджер', role_head: 'Руководитель',
        role_worker_d: 'Видит и закрывает заявки, регламентные работы и обходы номеров.',
        role_manager_d: 'Создаёт срочные заявки по объектам и следит за ними.',
        role_head_d: 'Всё, что исполнитель, плюс создаёт заявки и плановые обходы, видит отчёты и счётчики.',
        sysadmin_d: 'Галочка «Администратор» к любой роли: открывает эту админку (сотрудники, справочники, объекты, вся база).',
        // справочники
        dict_routine: '📋 Регламентные работы', dict_checklist: '🚪 Чек-лист номера', dict_assets: '🏷️ Названия объектов',
        dict_routine_d: 'Ежедневные работы. Новая работа появится у сотрудников сегодня же.',
        dict_checklist_d: 'Пункты проверки номера. Новые пункты попадут в обходы, созданные после добавления.',
        dict_assets_d: 'Названия объектов (насосная, бассейн, лобби…). Английский ключ связывает название с объектами.',
        new_item: '＋ Новая запись', requires_ocr: 'Счётчик (фото с распознаванием)', ocr_type: 'Тип счётчика',
        ocr_water_m3: 'Вода, Octave (м³)', ocr_water_arad: 'Вода, ARAD (м³)', ocr_gas_percent: 'Газ, уровень (%)',
        term_en: 'Английский ключ', usage: 'Используется',
        // объекты
        new_asset: '＋ Новый объект', gen_rooms: '🔢 Добавить номера диапазоном', building: 'Корпус', floor: 'Этаж',
        asset_kind: 'Что это', kind_room: 'Номер комнаты', kind_object: 'Объект из справочника', room_number: 'Номер',
        object_name: 'Название', from: 'С', to: 'По', generate: 'Добавить номера', gen_done: (a, s) => `Добавлено: ${a}, пропущено (уже были): ${s}`,
        rooms: 'номера', objects: 'объекты', tasks_count: 'заявок', no_building: '(без корпуса)', no_floor: '(без этажа)',
        need_term: 'Нужного названия нет? Добавьте его в «Справочники → Названия объектов».',
        // заявки
        type: 'Тип', desc: 'Описание', status: 'Статус', created: 'Создано',
        // база данных
        db_tables: 'Таблицы', db_rows: 'строк', db_readonly: 'только просмотр', db_new_row: '＋ Новая строка',
        db_backup: '💾 Скачать копию базы (.sql)', db_backup_d: 'Перед серьёзными правками скачайте копию. Восстановить: phpMyAdmin → hotelapp → Импорт.',
        db_warn: 'Здесь правится база напрямую. Для сотрудников, справочников и объектов удобнее и безопаснее свои вкладки.',
        db_null: 'NULL', db_secret_hint: 'скрыто; впишите новое значение, чтобы заменить', db_auto: 'выдаётся автоматически',
        db_audit: '🧾 Журнал изменений', db_audit_d: 'Кто, когда и что менял через админку.',
        page: 'Стр.', of: 'из', prev: '◀', next: '▶',
        audit_at: 'Когда', audit_who: 'Кто', audit_action: 'Действие', audit_table: 'Таблица', audit_row: 'Запись', audit_change: 'Изменения',
        act_insert: 'добавил', act_update: 'изменил', act_delete: 'удалил', act_generate: 'добавил номера', act_backup: 'скачал копию', act_logout_all: 'выход везде',
        // нераспознанные счётчики
        tab_pending: '🔎 Нераспознанные',
        pend_hint: 'Фото счётчиков, которые исполнители сняли без распознавания. Распознайте их через ИИ (по одному, по очереди) или впишите показание сами и нажмите «Записать».',
        pend_ocr_all: '🤖 Распознать все по очереди', pend_stop: '⏹ Остановить', pend_save_all: (n) => `💾 Записать все заполненные (${n})`,
        pend_ocr: '🤖 Распознать', pend_ocr_again: '🤖 Ещё раз', pend_save: '💾 Записать', pend_skip: 'Без показания',
        pend_skip_confirm: 'Убрать фото из списка без показания? Фото останется в истории.',
        pend_queued: '⏳ В очереди…', pend_running: '🤖 Распознаю…', pend_wait: (n) => `⏳ Лимит ИИ в минуту, повторю через ${n} с`,
        pend_ai: 'ИИ прочитал', pend_ai_fail: 'ИИ не распознал', pend_day_limit: 'Дневной бесплатный лимит ИИ исчерпан, он обновится в 10:00 по Израилю. До этого впишите показания руками.',
        pend_prev: 'Предыдущее', pend_no_prev: 'предыдущего показания нет', pend_less: '⚠️ Меньше предыдущего показания, проверьте',
        pend_value: 'Показание', pend_empty: 'Все фото счётчиков распознаны 👍', pend_saved: 'Записано', pend_saved_n: (n) => `Записано показаний: ${n}`,
        pend_worker: 'Снял', pend_rotate: '↻ Повернуть', pend_no_photo: 'Фото нет', pend_all_meters: 'Все счётчики',
        err_not_number: 'Показание должно быть числом', err_already_done: 'Это фото уже обработано (обновите список)',
        err_no_photo: 'У записи нет фото', err_photo_missing: 'Файл фото не найден на сервере', err_unknown_action: 'Неизвестное действие',
    },
    en: {
        save: 'Save', cancel: 'Cancel', add: 'Add', edit: 'Edit', delete: 'Delete', close: 'Close',
        loading: 'Loading…', saved: 'Saved', deleted: 'Deleted', search: 'Search…', all: 'All', actions: 'Actions',
        yes: 'Yes', no: 'No', empty: 'Empty', refresh: 'Refresh', total: 'Total', back: 'Back',
        confirm_delete: 'Delete permanently?',
        translate: '🌐 Translate to all languages', translating: 'Translating…', translate_hint: 'Type the text in any language and press “Translate”. You can correct the result.',
        err_network: 'No connection to the server', err_unknown: 'Something went wrong',
        err_forbidden: 'Administrator rights required', err_auth_required: 'Please log in again',
        err_name_required: 'Enter a name', err_name_taken: 'A staff member with this name already exists (the name is the login)',
        err_password_required: 'Set a password', err_password_short: 'Password too short (at least 4 characters)',
        err_bad_role: 'Unknown role', err_self_lockout: 'You cannot block or delete yourself or remove your own admin rights',
        err_last_admin: 'At least one active administrator must remain', err_not_found: 'Record not found (refresh the page)',
        err_key_required: 'English key is required', err_key_taken: 'This key already exists', err_key_digits: 'A digits-only key is a room number; add it in the “Objects” tab',
        err_ocr_type_required: 'Choose the meter type', err_asset_exists: 'This object already exists in this building and floor',
        err_bad_range: 'Invalid room range', err_range_too_big: 'Too many rooms at once (max 300)',
        err_readonly: 'This table is read-only', err_nothing_to_save: 'Nothing to save', err_no_table: 'Table not found',
        err_db_error: 'Database error',
        in_use: (n) => `Used in ${n} records. Delete anyway? History stays, but without this link.`,
        tab_network: '🏨 Network & hotels', tab_users: '👥 Staff', tab_dicts: '📚 Dictionaries', tab_assets: '🏢 Objects', tab_tasks: '📋 Tasks', tab_meters: '📷 Meters', tab_db: '🗄️ Database',
        new_user: '＋ New staff member', name_login: 'Name (used as login)', password: 'Password', password_keep: 'New password (empty = keep)',
        role: 'Role', sysadmin: 'Administrator', active: 'Access', blocked: 'Blocked', allowed: 'Allowed',
        block: '🚫 Block', unblock: '✅ Unblock', logout_all: '🚪 Log out everywhere', logout_done: 'Remembered logins removed',
        devices: 'Remembered devices', last_seen: 'Last login', you: 'you', plain_pw: 'Password stored as plain text, set a new one',
        user_links: (n) => `This person has ${n} history records. Better block them so history keeps the name. Delete anyway?`,
        rights_title: 'What each role can do',
        role_worker: 'Worker', role_manager: 'Manager', role_head: 'Head',
        role_worker_d: 'Sees and closes tasks, routine work and room inspections.',
        role_manager_d: 'Creates urgent tasks for objects and follows them.',
        role_head_d: 'Everything a worker can, plus creates tasks and planned inspections, sees reports and meters.',
        sysadmin_d: 'The “Administrator” box works with any role: opens this admin panel (staff, dictionaries, objects, whole database).',
        dict_routine: '📋 Routine work', dict_checklist: '🚪 Room checklist', dict_assets: '🏷️ Object names',
        dict_routine_d: 'Daily routine work. A new item shows up for staff today.',
        dict_checklist_d: 'Room inspection items. New items go into inspections created afterwards.',
        dict_assets_d: 'Object names (pump room, pool, lobby…). The English key links the name to objects.',
        new_item: '＋ New entry', requires_ocr: 'Meter (photo with recognition)', ocr_type: 'Meter type',
        ocr_water_m3: 'Water, Octave (m³)', ocr_water_arad: 'Water, ARAD (m³)', ocr_gas_percent: 'Gas level (%)',
        term_en: 'English key', usage: 'Used',
        new_asset: '＋ New object', gen_rooms: '🔢 Add a range of rooms', building: 'Building', floor: 'Floor',
        asset_kind: 'Kind', kind_room: 'Room number', kind_object: 'Object from dictionary', room_number: 'Number',
        object_name: 'Name', from: 'From', to: 'To', generate: 'Add rooms', gen_done: (a, s) => `Added: ${a}, skipped (already existed): ${s}`,
        rooms: 'rooms', objects: 'objects', tasks_count: 'tasks', no_building: '(no building)', no_floor: '(no floor)',
        need_term: 'Name missing? Add it in “Dictionaries → Object names”.',
        type: 'Type', desc: 'Description', status: 'Status', created: 'Created',
        db_tables: 'Tables', db_rows: 'rows', db_readonly: 'read-only', db_new_row: '＋ New row',
        db_backup: '💾 Download database copy (.sql)', db_backup_d: 'Download a copy before major edits. Restore: phpMyAdmin → hotelapp → Import.',
        db_warn: 'This edits the database directly. Staff, dictionaries and objects are easier and safer in their own tabs.',
        db_null: 'NULL', db_secret_hint: 'hidden; type a new value to replace', db_auto: 'assigned automatically',
        db_audit: '🧾 Change log', db_audit_d: 'Who changed what and when through the admin panel.',
        page: 'Page', of: 'of', prev: '◀', next: '▶',
        audit_at: 'When', audit_who: 'Who', audit_action: 'Action', audit_table: 'Table', audit_row: 'Record', audit_change: 'Changes',
        act_insert: 'added', act_update: 'changed', act_delete: 'deleted', act_generate: 'added rooms', act_backup: 'downloaded copy', act_logout_all: 'logged out everywhere',
        tab_pending: '🔎 Unrecognized',
        pend_hint: 'Meter photos the staff took without recognition. Recognize them with AI (one at a time, in a queue) or type the reading yourself and press “Save”.',
        pend_ocr_all: '🤖 Recognize all in turn', pend_stop: '⏹ Stop', pend_save_all: (n) => `💾 Save all filled in (${n})`,
        pend_ocr: '🤖 Recognize', pend_ocr_again: '🤖 Again', pend_save: '💾 Save', pend_skip: 'No reading',
        pend_skip_confirm: 'Remove this photo from the list without a reading? The photo stays in history.',
        pend_queued: '⏳ Queued…', pend_running: '🤖 Recognizing…', pend_wait: (n) => `⏳ AI per-minute limit, retrying in ${n} s`,
        pend_ai: 'AI read', pend_ai_fail: 'AI could not read it', pend_day_limit: 'The free daily AI limit is used up; it resets at 10:00 Israel time. Until then type the readings by hand.',
        pend_prev: 'Previous', pend_no_prev: 'no previous reading', pend_less: '⚠️ Lower than the previous reading, please check',
        pend_value: 'Reading', pend_empty: 'All meter photos are recognized 👍', pend_saved: 'Saved', pend_saved_n: (n) => `Readings saved: ${n}`,
        pend_worker: 'Taken by', pend_rotate: '↻ Rotate', pend_no_photo: 'No photo', pend_all_meters: 'All meters',
        err_not_number: 'The reading must be a number', err_already_done: 'This photo is already processed (refresh the list)',
        err_no_photo: 'The record has no photo', err_photo_missing: 'Photo file not found on the server', err_unknown_action: 'Unknown action',
    },
    he: {
        save: 'שמירה', cancel: 'ביטול', add: 'הוספה', edit: 'עריכה', delete: 'מחיקה', close: 'סגירה',
        loading: 'טוען…', saved: 'נשמר', deleted: 'נמחק', search: 'חיפוש…', all: 'הכול', actions: 'פעולות',
        yes: 'כן', no: 'לא', empty: 'ריק', refresh: 'רענון', total: 'סה״כ', back: 'חזרה',
        confirm_delete: 'למחוק לצמיתות?',
        translate: '🌐 תרגום לכל השפות', translating: 'מתרגם…', translate_hint: 'כתבו את הטקסט בכל שפה ולחצו „תרגום”. אפשר לתקן את התוצאה.',
        err_network: 'אין חיבור לשרת', err_unknown: 'משהו השתבש',
        err_forbidden: 'נדרשות הרשאות מנהל', err_auth_required: 'יש להתחבר מחדש',
        err_name_required: 'יש להזין שם', err_name_taken: 'כבר קיים עובד בשם הזה (השם הוא שם המשתמש)',
        err_password_required: 'יש להגדיר סיסמה', err_password_short: 'הסיסמה קצרה מדי (לפחות 4 תווים)',
        err_bad_role: 'תפקיד לא מוכר', err_self_lockout: 'אי אפשר לחסום או למחוק את עצמך או להסיר ממך הרשאות מנהל',
        err_last_admin: 'חייב להישאר לפחות מנהל פעיל אחד', err_not_found: 'הרשומה לא נמצאה (רעננו את הדף)',
        err_key_required: 'נדרש מפתח באנגלית', err_key_taken: 'המפתח הזה כבר קיים', err_key_digits: 'מפתח מספרי בלבד הוא מספר חדר; הוסיפו אותו בלשונית „נכסים”',
        err_ocr_type_required: 'בחרו סוג מונה', err_asset_exists: 'הנכס הזה כבר קיים בבניין ובקומה האלה',
        err_bad_range: 'טווח חדרים שגוי', err_range_too_big: 'יותר מדי חדרים בבת אחת (עד 300)',
        err_readonly: 'טבלה זו לצפייה בלבד', err_nothing_to_save: 'אין מה לשמור', err_no_table: 'הטבלה לא נמצאה',
        err_db_error: 'שגיאת מסד נתונים',
        in_use: (n) => `בשימוש ב-${n} רשומות. למחוק בכל זאת? ההיסטוריה תישאר, אך ללא הקישור.`,
        tab_network: '🏨 רשת ומלונות', tab_users: '👥 עובדים', tab_dicts: '📚 מילונים', tab_assets: '🏢 נכסים', tab_tasks: '📋 משימות', tab_meters: '📷 מונים', tab_db: '🗄️ מסד נתונים',
        new_user: '＋ עובד חדש', name_login: 'שם (משמש להתחברות)', password: 'סיסמה', password_keep: 'סיסמה חדשה (ריק = ללא שינוי)',
        role: 'תפקיד', sysadmin: 'מנהל מערכת', active: 'גישה', blocked: 'חסום', allowed: 'מורשה',
        block: '🚫 חסימה', unblock: '✅ ביטול חסימה', logout_all: '🚪 התנתקות מכל המכשירים', logout_done: 'ההתחברויות השמורות נמחקו',
        devices: 'מכשירים שמורים', last_seen: 'כניסה אחרונה', you: 'זה אתה', plain_pw: 'הסיסמה שמורה כטקסט גלוי, הגדירו חדשה',
        user_links: (n) => `לעובד יש ${n} רשומות בהיסטוריה. עדיף לחסום אותו כדי שההיסטוריה תשמור את שמו. למחוק בכל זאת?`,
        rights_title: 'מה כל תפקיד יכול',
        role_worker: 'מבצע', role_manager: 'מנהל משמרת', role_head: 'אחראי',
        role_worker_d: 'רואה וסוגר משימות, עבודות שוטפות וביקורות חדרים.',
        role_manager_d: 'פותח קריאות דחופות לנכסים ועוקב אחריהן.',
        role_head_d: 'כל מה שמבצע יכול, ובנוסף פותח משימות וביקורות מתוכננות, רואה דוחות ומונים.',
        sysadmin_d: 'הסימון „מנהל מערכת” מתאים לכל תפקיד: פותח את פאנל הניהול הזה (עובדים, מילונים, נכסים, כל המסד).',
        dict_routine: '📋 עבודות שוטפות', dict_checklist: '🚪 צ׳ק-ליסט חדר', dict_assets: '🏷️ שמות נכסים',
        dict_routine_d: 'עבודות יומיות. עבודה חדשה תופיע אצל העובדים כבר היום.',
        dict_checklist_d: 'סעיפי בדיקת חדר. סעיפים חדשים ייכנסו לביקורות שייפתחו אחרי ההוספה.',
        dict_assets_d: 'שמות נכסים (חדר משאבות, בריכה, לובי…). המפתח באנגלית מקשר את השם לנכסים.',
        new_item: '＋ רשומה חדשה', requires_ocr: 'מונה (צילום עם זיהוי)', ocr_type: 'סוג מונה',
        ocr_water_m3: 'מים, Octave (מ״ק)', ocr_water_arad: 'מים, ARAD (מ״ק)', ocr_gas_percent: 'גז, מפלס (%)',
        term_en: 'מפתח באנגלית', usage: 'בשימוש',
        new_asset: '＋ נכס חדש', gen_rooms: '🔢 הוספת טווח חדרים', building: 'בניין', floor: 'קומה',
        asset_kind: 'סוג', kind_room: 'מספר חדר', kind_object: 'נכס מהמילון', room_number: 'מספר',
        object_name: 'שם', from: 'מ-', to: 'עד', generate: 'הוספת חדרים', gen_done: (a, s) => `נוספו: ${a}, דולגו (כבר קיימים): ${s}`,
        rooms: 'חדרים', objects: 'נכסים', tasks_count: 'משימות', no_building: '(ללא בניין)', no_floor: '(ללא קומה)',
        need_term: 'השם חסר? הוסיפו אותו ב„מילונים ← שמות נכסים”.',
        type: 'סוג', desc: 'תיאור', status: 'סטטוס', created: 'נוצר',
        db_tables: 'טבלאות', db_rows: 'שורות', db_readonly: 'צפייה בלבד', db_new_row: '＋ שורה חדשה',
        db_backup: '💾 הורדת עותק של המסד (.sql)', db_backup_d: 'לפני שינויים גדולים הורידו עותק. שחזור: phpMyAdmin ← hotelapp ← ייבוא.',
        db_warn: 'כאן עורכים את המסד ישירות. עובדים, מילונים ונכסים נוחים ובטוחים יותר בלשוניות שלהם.',
        db_null: 'NULL', db_secret_hint: 'מוסתר; הקלידו ערך חדש כדי להחליף', db_auto: 'נקבע אוטומטית',
        db_audit: '🧾 יומן שינויים', db_audit_d: 'מי שינה מה ומתי דרך פאנל הניהול.',
        page: 'עמ׳', of: 'מתוך', prev: '▶', next: '◀',
        audit_at: 'מתי', audit_who: 'מי', audit_action: 'פעולה', audit_table: 'טבלה', audit_row: 'רשומה', audit_change: 'שינויים',
        act_insert: 'הוסיף', act_update: 'שינה', act_delete: 'מחק', act_generate: 'הוסיף חדרים', act_backup: 'הוריד עותק', act_logout_all: 'התנתקות מכל המכשירים',
        tab_pending: '🔎 לא מזוהים',
        pend_hint: 'תמונות מונים שהעובדים צילמו בלי זיהוי. זהו אותן בבינה מלאכותית (אחת־אחת, בתור) או הקלידו את הקריאה בעצמכם ולחצו „שמירה”.',
        pend_ocr_all: '🤖 לזהות הכול לפי התור', pend_stop: '⏹ עצירה', pend_save_all: (n) => `💾 לשמור את כל המלאים (${n})`,
        pend_ocr: '🤖 זיהוי', pend_ocr_again: '🤖 שוב', pend_save: '💾 שמירה', pend_skip: 'ללא קריאה',
        pend_skip_confirm: 'להסיר את התמונה מהרשימה ללא קריאה? התמונה תישאר בהיסטוריה.',
        pend_queued: '⏳ בתור…', pend_running: '🤖 מזהה…', pend_wait: (n) => `⏳ מגבלת בינה מלאכותית לדקה, ניסיון חוזר בעוד ${n} שנ׳`,
        pend_ai: 'הבינה המלאכותית קראה', pend_ai_fail: 'הבינה המלאכותית לא זיהתה', pend_day_limit: 'המכסה היומית החינמית נוצלה; היא מתחדשת ב־10:00 שעון ישראל. עד אז הקלידו את הקריאות ידנית.',
        pend_prev: 'קודמת', pend_no_prev: 'אין קריאה קודמת', pend_less: '⚠️ נמוכה מהקריאה הקודמת, בדקו',
        pend_value: 'קריאה', pend_empty: 'כל תמונות המונים זוהו 👍', pend_saved: 'נשמר', pend_saved_n: (n) => `נשמרו קריאות: ${n}`,
        pend_worker: 'צילם', pend_rotate: '↻ סיבוב', pend_no_photo: 'אין תמונה', pend_all_meters: 'כל המונים',
        err_not_number: 'הקריאה חייבת להיות מספר', err_already_done: 'התמונה הזאת כבר טופלה (רעננו את הרשימה)',
        err_no_photo: 'לרשומה אין תמונה', err_photo_missing: 'קובץ התמונה לא נמצא בשרת', err_unknown_action: 'פעולה לא מוכרת',
    },
    ar: {
        save: 'حفظ', cancel: 'إلغاء', add: 'إضافة', edit: 'تعديل', delete: 'حذف', close: 'إغلاق',
        loading: 'جارٍ التحميل…', saved: 'تم الحفظ', deleted: 'تم الحذف', search: 'بحث…', all: 'الكل', actions: 'إجراءات',
        yes: 'نعم', no: 'لا', empty: 'فارغ', refresh: 'تحديث', total: 'المجموع', back: 'رجوع',
        confirm_delete: 'حذف نهائياً؟',
        translate: '🌐 ترجمة إلى كل اللغات', translating: 'جارٍ الترجمة…', translate_hint: 'اكتب النص بأي لغة واضغط «ترجمة». يمكن تصحيح النتيجة.',
        err_network: 'لا يوجد اتصال بالخادم', err_unknown: 'حدث خطأ',
        err_forbidden: 'مطلوب صلاحيات المسؤول', err_auth_required: 'يرجى تسجيل الدخول من جديد',
        err_name_required: 'أدخل الاسم', err_name_taken: 'يوجد موظف بهذا الاسم (الاسم هو اسم الدخول)',
        err_password_required: 'حدد كلمة مرور', err_password_short: 'كلمة المرور قصيرة جداً (4 أحرف على الأقل)',
        err_bad_role: 'دور غير معروف', err_self_lockout: 'لا يمكنك حظر نفسك أو حذفها أو إزالة صلاحيات المسؤول عنك',
        err_last_admin: 'يجب أن يبقى مسؤول نشط واحد على الأقل', err_not_found: 'السجل غير موجود (حدّث الصفحة)',
        err_key_required: 'المفتاح الإنجليزي مطلوب', err_key_taken: 'هذا المفتاح موجود', err_key_digits: 'المفتاح الرقمي فقط هو رقم غرفة؛ أضفه في تبويب «المرافق»',
        err_ocr_type_required: 'اختر نوع العداد', err_asset_exists: 'هذا المرفق موجود في هذا المبنى والطابق',
        err_bad_range: 'نطاق غرف غير صحيح', err_range_too_big: 'عدد كبير من الغرف دفعة واحدة (الحد 300)',
        err_readonly: 'هذا الجدول للعرض فقط', err_nothing_to_save: 'لا شيء للحفظ', err_no_table: 'الجدول غير موجود',
        err_db_error: 'خطأ في قاعدة البيانات',
        in_use: (n) => `مستخدم في ${n} سجلات. الحذف على أي حال؟ يبقى السجل التاريخي لكن بدون هذا الربط.`,
        tab_network: '🏨 الشبكة والفنادق', tab_users: '👥 الموظفون', tab_dicts: '📚 القواميس', tab_assets: '🏢 المرافق', tab_tasks: '📋 المهام', tab_meters: '📷 العدادات', tab_db: '🗄️ قاعدة البيانات',
        new_user: '＋ موظف جديد', name_login: 'الاسم (يُستخدم للدخول)', password: 'كلمة المرور', password_keep: 'كلمة مرور جديدة (فارغ = بدون تغيير)',
        role: 'الدور', sysadmin: 'مسؤول النظام', active: 'الوصول', blocked: 'محظور', allowed: 'مسموح',
        block: '🚫 حظر', unblock: '✅ إلغاء الحظر', logout_all: '🚪 الخروج من كل الأجهزة', logout_done: 'تم حذف تسجيلات الدخول المحفوظة',
        devices: 'أجهزة محفوظة', last_seen: 'آخر دخول', you: 'أنت', plain_pw: 'كلمة المرور محفوظة كنص عادي، عيّن كلمة جديدة',
        user_links: (n) => `لدى الموظف ${n} سجلات في التاريخ. الأفضل حظره ليبقى اسمه في السجل. الحذف على أي حال؟`,
        rights_title: 'ماذا يستطيع كل دور',
        role_worker: 'منفّذ', role_manager: 'مدير', role_head: 'مسؤول القسم',
        role_worker_d: 'يرى ويغلق المهام والأعمال الدورية وفحوصات الغرف.',
        role_manager_d: 'ينشئ طلبات عاجلة للمرافق ويتابعها.',
        role_head_d: 'كل ما يستطيعه المنفّذ، بالإضافة إلى إنشاء المهام والفحوصات المخططة، ويرى التقارير والعدادات.',
        sysadmin_d: 'خانة «مسؤول النظام» مع أي دور: تفتح لوحة الإدارة هذه (الموظفون، القواميس، المرافق، كل القاعدة).',
        dict_routine: '📋 الأعمال الدورية', dict_checklist: '🚪 قائمة فحص الغرفة', dict_assets: '🏷️ أسماء المرافق',
        dict_routine_d: 'أعمال يومية. يظهر العمل الجديد للموظفين اليوم.',
        dict_checklist_d: 'بنود فحص الغرفة. البنود الجديدة تدخل في الفحوصات المنشأة بعد الإضافة.',
        dict_assets_d: 'أسماء المرافق (غرفة المضخات، المسبح، اللوبي…). المفتاح الإنجليزي يربط الاسم بالمرافق.',
        new_item: '＋ سجل جديد', requires_ocr: 'عداد (صورة مع تعرّف)', ocr_type: 'نوع العداد',
        ocr_water_m3: 'ماء، Octave (م³)', ocr_water_arad: 'ماء، ARAD (م³)', ocr_gas_percent: 'غاز، المستوى (%)',
        term_en: 'المفتاح الإنجليزي', usage: 'مستخدم',
        new_asset: '＋ مرفق جديد', gen_rooms: '🔢 إضافة نطاق غرف', building: 'المبنى', floor: 'الطابق',
        asset_kind: 'النوع', kind_room: 'رقم غرفة', kind_object: 'مرفق من القاموس', room_number: 'الرقم',
        object_name: 'الاسم', from: 'من', to: 'إلى', generate: 'إضافة الغرف', gen_done: (a, s) => `أُضيف: ${a}، تم تخطي (موجودة): ${s}`,
        rooms: 'غرف', objects: 'مرافق', tasks_count: 'مهام', no_building: '(بدون مبنى)', no_floor: '(بدون طابق)',
        need_term: 'الاسم غير موجود؟ أضفه في «القواميس ← أسماء المرافق».',
        type: 'النوع', desc: 'الوصف', status: 'الحالة', created: 'تاريخ الإنشاء',
        db_tables: 'الجداول', db_rows: 'صفوف', db_readonly: 'للعرض فقط', db_new_row: '＋ صف جديد',
        db_backup: '💾 تنزيل نسخة من القاعدة (.sql)', db_backup_d: 'نزّل نسخة قبل التعديلات الكبيرة. الاستعادة: phpMyAdmin ← hotelapp ← استيراد.',
        db_warn: 'هنا تُعدّل القاعدة مباشرة. الموظفون والقواميس والمرافق أسهل وأكثر أماناً في تبويباتها.',
        db_null: 'NULL', db_secret_hint: 'مخفي؛ اكتب قيمة جديدة للاستبدال', db_auto: 'يُعيَّن تلقائياً',
        db_audit: '🧾 سجل التغييرات', db_audit_d: 'من غيّر ماذا ومتى عبر لوحة الإدارة.',
        page: 'صفحة', of: 'من', prev: '▶', next: '◀',
        audit_at: 'متى', audit_who: 'من', audit_action: 'الإجراء', audit_table: 'الجدول', audit_row: 'السجل', audit_change: 'التغييرات',
        act_insert: 'أضاف', act_update: 'عدّل', act_delete: 'حذف', act_generate: 'أضاف غرفاً', act_backup: 'نزّل نسخة', act_logout_all: 'خروج من كل الأجهزة',
        tab_pending: '🔎 غير المقروءة',
        pend_hint: 'صور العدادات التي التقطها العاملون دون قراءة. اقرأها بالذكاء الاصطناعي (واحدة تلو الأخرى) أو اكتب القراءة بنفسك واضغط «حفظ».',
        pend_ocr_all: '🤖 قراءة الكل بالدور', pend_stop: '⏹ إيقاف', pend_save_all: (n) => `💾 حفظ كل المعبأة (${n})`,
        pend_ocr: '🤖 قراءة', pend_ocr_again: '🤖 مرة أخرى', pend_save: '💾 حفظ', pend_skip: 'بدون قراءة',
        pend_skip_confirm: 'إزالة الصورة من القائمة بدون قراءة؟ ستبقى الصورة في السجل.',
        pend_queued: '⏳ في الدور…', pend_running: '🤖 جارٍ القراءة…', pend_wait: (n) => `⏳ حد الذكاء الاصطناعي في الدقيقة، إعادة المحاولة بعد ${n} ث`,
        pend_ai: 'قرأ الذكاء الاصطناعي', pend_ai_fail: 'لم يتمكن الذكاء الاصطناعي من القراءة', pend_day_limit: 'انتهى الحد اليومي المجاني للذكاء الاصطناعي، ويتجدد الساعة 10:00 بتوقيت إسرائيل. حتى ذلك الحين اكتب القراءات يدوياً.',
        pend_prev: 'السابقة', pend_no_prev: 'لا توجد قراءة سابقة', pend_less: '⚠️ أقل من القراءة السابقة، يرجى التحقق',
        pend_value: 'القراءة', pend_empty: 'تمت قراءة كل صور العدادات 👍', pend_saved: 'تم الحفظ', pend_saved_n: (n) => `تم حفظ القراءات: ${n}`,
        pend_worker: 'التقطها', pend_rotate: '↻ تدوير', pend_no_photo: 'لا توجد صورة', pend_all_meters: 'كل العدادات',
        err_not_number: 'يجب أن تكون القراءة رقماً', err_already_done: 'تمت معالجة هذه الصورة (حدّث القائمة)',
        err_no_photo: 'لا توجد صورة في السجل', err_photo_missing: 'ملف الصورة غير موجود على الخادم', err_unknown_action: 'إجراء غير معروف',
    },
};

export function tr(lang) {
    return T[lang] || T.ru;
}

/** Текст ошибки сервера на языке интерфейса. */
export function errText(t, data) {
    const code = data?.message;
    const msg = (code && t['err_' + code]) || code || t.err_unknown;
    return data?.error ? `${msg}: ${data.error}` : msg;
}

/** Запрос к API админки. Возвращает JSON-ответ; при обрыве — { success:false, message:'network' }. */
export async function api(url, body) {
    try {
        const res = await fetch(url, body === undefined ? { cache: 'no-store' } : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 401) return { success: false, message: 'auth_required' };
        if (res.status === 403) return { success: false, message: 'forbidden' };
        return await res.json();
    } catch {
        return { success: false, message: 'network' };
    }
}

// Стили в тон приложению
export const S = {
    field: { padding: '9px 11px', border: '1px solid #d9cec5', borderRadius: '10px', fontSize: '16px', background: '#fff', minWidth: 0, width: '100%', boxSizing: 'border-box', color: '#2b2320' },
    label: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '15px', color: '#5a4f48', fontWeight: 600, minWidth: 0 },
    btn: { minHeight: '40px', padding: '7px 14px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: '1px solid #d9cec5', background: '#fff', color: '#3f3530' },
    primary: { minHeight: '40px', padding: '7px 16px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: 'none', background: 'var(--brand-button, #844128)', color: '#fff' },
    danger: { minHeight: '40px', padding: '7px 14px', borderRadius: '10px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer', border: '1px solid #e9b8ae', background: '#fff5f3', color: '#a3301c' },
    card: { background: '#fcf9f6', border: '1px solid #ebe3dc', borderRadius: '12px', padding: '14px' },
    th: { padding: '10px', fontSize: '14px', color: '#5a4f48', borderBottom: '2px solid #ebe3dc', whiteSpace: 'nowrap' },
    td: { padding: '9px 10px', borderBottom: '1px solid #f3ebe2', verticalAlign: 'top' },
    hint: { fontSize: '14px', color: '#7d726a' },
    badge: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '13px', fontWeight: 'bold', background: bg, color: fg }),
};

export function Message({ msg }) {
    if (!msg) return null;
    return (
        <div role="status" style={{ padding: '10px 14px', borderRadius: '10px', fontWeight: 600,
            background: msg.ok ? '#e7f6ec' : '#fdecea', color: msg.ok ? '#1f6b3d' : '#a3301c', border: `1px solid ${msg.ok ? '#b9e2c6' : '#f2c3bb'}` }}>
            {msg.text}
        </div>
    );
}

/** Переключатель-«пилюли» для подразделов. */
export function Pills({ items, value, onChange }) {
    return (
        <div style={{ display: 'flex', gap: '4px', padding: '4px', background: '#f1e3d2', borderRadius: '12px', flexWrap: 'wrap' }}>
            {items.map(([key, label]) => (
                <button key={key} type="button" onClick={() => onChange(key)}
                    style={{ flex: '1 1 auto', minWidth: 0, minHeight: '42px', padding: '8px 10px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px',
                        background: value === key ? '#fff' : 'transparent', color: value === key ? 'var(--brand-button, #844128)' : '#5a4f48', boxShadow: value === key ? '0 1px 3px rgba(55,31,32,0.15)' : 'none' }}>
                    {label}
                </button>
            ))}
        </div>
    );
}
