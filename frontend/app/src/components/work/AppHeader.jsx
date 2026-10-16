import { useState } from 'react';
import { BrandEmblem } from '../BrandLogo';
import './work.css';

// Общая шапка нового вида: имя и кнопки спрятаны, открываются язычком сверху.
// right — кнопки справа (администратор, колокольчик, меню); onBack — стрелка «назад» слева.
export default function AppHeader({ name, subtitle, right, onBack, backLabel = '←', showLabel = '▾', emblem }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="wk-hdrwrap">
            <div className={'wk-hdr' + (open ? ' open' : '')} aria-hidden={!open}>
                <div className="wk-hdr-in">
                    {onBack && (
                        <button type="button" className="wk-back" aria-label={backLabel} onClick={onBack}>
                            <span aria-hidden="true">‹</span>
                        </button>
                    )}
                    {emblem || <BrandEmblem size={40} />}
                    <div className="wk-who">
                        <b>{name}</b>
                        {subtitle && <span>{subtitle}</span>}
                    </div>
                    {right && <div className="wk-hdr-btns">{right}</div>}
                </div>
            </div>
            <div className="wk-tongue">
                <button type="button" aria-expanded={open} aria-label={showLabel} onClick={() => setOpen(o => !o)}>{open ? '▴' : '▾'}</button>
            </div>
        </div>
    );
}
