import { useState } from 'react';
import MeterUpload from './MeterUpload';
import MeterEdit from './MeterEdit';
import { Pills } from './admin/adminUi';
import { meterText } from './admin/meterText';

// Вкладка «Счётчики» в админке: загрузка фото или правка показаний задним числом
export default function MetersAdmin({ lang = 'en' }) {
    const m = meterText(lang);
    const [view, setView] = useState('upload');
    return (
        <>
            <div className="ad-pad"><Pills value={view} onChange={setView} items={[['upload', m.tab_upload], ['edit', m.tab_edit]]} /></div>
            {view === 'upload' ? <MeterUpload lang={lang} /> : <MeterEdit lang={lang} />}
        </>
    );
}
