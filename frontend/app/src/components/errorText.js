// Тексты сообщений об ошибках на языке интерфейса (раньше были зашиты по-русски).
const ERR = {
    ru: { network: 'Ошибка сети', server: 'Ошибка сервера', upload_save: 'Ошибка сохранения файла на сервер', upload_fail: 'Не удалось загрузить файл', create_failed: 'Не удалось создать задачи', close_failed: 'Не удалось закрыть заявку', admin_wip: 'Интерфейс администратора в разработке' },
    en: { network: 'Network error', server: 'Server error', upload_save: 'Could not save the file on the server', upload_fail: 'Could not upload the file', create_failed: 'Could not create the tasks', close_failed: 'Could not close the ticket', admin_wip: 'Admin interface is under development' },
    he: { network: 'שגיאת רשת', server: 'שגיאת שרת', upload_save: 'שמירת הקובץ בשרת נכשלה', upload_fail: 'העלאת הקובץ נכשלה', create_failed: 'יצירת המשימות נכשלה', close_failed: 'סגירת הקריאה נכשלה', admin_wip: 'ממשק הניהול בפיתוח' },
    ar: { network: 'خطأ في الشبكة', server: 'خطأ في الخادم', upload_save: 'تعذر حفظ الملف على الخادم', upload_fail: 'تعذر رفع الملف', create_failed: 'تعذر إنشاء المهام', close_failed: 'تعذر إغلاق الطلب', admin_wip: 'واجهة الإدارة قيد التطوير' }
};

export const errText = (lang, key, detail) => {
    const msg = (ERR[lang] || ERR.ru)[key] || ERR.ru[key];
    return detail ? `${msg}: ${detail}` : msg;
};
