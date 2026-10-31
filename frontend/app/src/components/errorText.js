// Тексты сообщений об ошибках на языке интерфейса (раньше были зашиты по-русски).
import { uiText } from '../i18n';

export const errText = (lang, key, detail) => {
    const msg = uiText('errors', lang)[key];
    return detail ? `${msg}: ${detail}` : msg;
};
