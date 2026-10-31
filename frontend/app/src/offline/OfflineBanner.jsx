import { useEffect, useState, useRef } from 'react';
import Icon from '../components/mgr/Icon';
import { subscribe, flush, onSent, refreshCounts, retryFailed, askPersistentStorage } from './outbox';
import { uiText, dirOf } from '../i18n';

// Тексты без эмодзи: значок рисуется рядом одноцветным SVG

// Запускает отправку очереди (при старте, при появлении сети, при возврате в приложение, раз в 30 с)
// и сообщает о дошедших операциях через onDelivered.
export function useOutbox(userId, onDelivered) {
    const [st, setSt] = useState({ pending: 0, failed: 0, sending: false, offline: false });
    const cbRef = useRef(onDelivered);
    cbRef.current = onDelivered;

    useEffect(() => {
        if (!userId) return;
        askPersistentStorage();
        const unsub = subscribe(setSt);
        const unsent = onSent((op, data) => cbRef.current?.(op, data));
        const kick = () => flush(userId);
        const onVisible = () => { if (document.visibilityState === 'visible') kick(); };
        window.addEventListener('online', kick);
        document.addEventListener('visibilitychange', onVisible);
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') kick();
        }, 30000);
        refreshCounts(userId).then(kick);
        return () => {
            unsub();
            unsent();
            window.removeEventListener('online', kick);
            document.removeEventListener('visibilitychange', onVisible);
            clearInterval(timer);
        };
    }, [userId]);

    return st;
}

export default function OfflineBanner({ userId, lang, status }) {
    const t = uiText('offline', lang);
    // «Нет связи» показывает общая полоска сверху (pwa.js); здесь — что ждёт отправки
    const { pending, failed, sending } = status;
    if (!pending && !failed) return null;
    const dir = dirOf(lang);
    const bad = failed > 0 && !sending;

    return (
        <div dir={dir} role="status" style={{
            marginTop: '10px', padding: '10px 12px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
            background: bad ? '#fdecea' : '#fef9c3', color: bad ? '#8f2a18' : '#713f12', fontSize: '15px', fontWeight: 700, lineHeight: 1.3, textAlign: 'start'
        }}>
            <Icon name={sending ? 'refresh' : bad ? 'warn' : 'clock'} />
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                {sending ? t.sending : pending > 0 ? t.pending(pending) : ''}
                {failed > 0 && <span style={{ color: '#a3301c', marginInlineStart: pending > 0 || sending ? '10px' : 0, whiteSpace: 'nowrap' }}>{t.failed(failed)}</span>}
            </span>
            {!sending && (
                <button type="button" onClick={() => (failed > 0 ? retryFailed(userId) : flush(userId))}
                    style={{ flex: 'none', minHeight: '38px', padding: '8px 12px', borderRadius: '9px', border: 0, background: '#2a5f96', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '14px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    {failed > 0 ? t.retry : t.send_now}
                </button>
            )}
        </div>
    );
}
