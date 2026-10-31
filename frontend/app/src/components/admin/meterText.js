// Подписи раздела «Счётчики» админки (загрузка фото, правка показаний, ссылка для начальника) — ключи meters.* в lang/.
import { uiText } from '../../i18n';

export const meterText = (lang) => {
    const t = uiText('meters', lang);
    return { ...t, save_db: (n) => (n ? t.save_db_n(n) : t.save_db) };
};
