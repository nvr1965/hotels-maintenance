// Приложение не масштабируется жестами (просьба Nick). Мета-тег viewport и touch-action в index.css
// Chrome на Android иногда обходит, поэтому дополнительно гасим сами жесты.
const stop = (e) => e.preventDefault();
// Щипок двумя пальцами
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
// Safari: жесты масштаба
document.addEventListener('gesturestart', stop, { passive: false });
document.addEventListener('gesturechange', stop, { passive: false });
// Двойное касание уже выключено через touch-action в index.css; здесь его не трогаем,
// иначе быстрые повторные нажатия на кнопки терялись бы.
// Ctrl + колесо / жест тачпада на ноутбуке не трогаем: это не телефон.
