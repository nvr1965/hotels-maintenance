import { useState } from 'react';
import MeterUpload from './MeterUpload';
import MeterEdit from './MeterEdit';

// Вкладка «📷 Счётчики» в админке: загрузка фото или правка показаний задним числом
export default function MetersAdmin() {
    const [view, setView] = useState('upload');
    const tab = (key, label) => (
        <button type="button" onClick={() => setView(key)}
            style={{ flex: '1 1 0', minWidth: 0, minHeight: '42px', padding: '8px 10px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px',
                background: view === key ? '#fff' : 'transparent', color: view === key ? 'var(--brand-button, #844128)' : '#5a4f48', boxShadow: view === key ? '0 1px 3px rgba(55,31,32,0.15)' : 'none' }}>
            {label}
        </button>
    );
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '4px', padding: '4px', background: '#f1e3d2', borderRadius: '12px' }}>
                {tab('upload', '📷 Загрузка фото')}
                {tab('edit', '✏️ Правка показаний')}
            </div>
            {view === 'upload' ? <MeterUpload /> : <MeterEdit />}
        </div>
    );
}
