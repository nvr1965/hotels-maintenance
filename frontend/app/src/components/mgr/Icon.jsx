// Одноцветные значки (цвет берётся из текста), без эмодзи.
const PATHS = {
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
    warn: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></>,
    back: <path d="M19 12H5M11 6l-6 6 6 6" />,
    cam: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
    play: <path d="M8 5l11 7-11 7z" fill="currentColor" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
};

const BASE = { width: '1.1em', height: '1.1em', flex: 'none', verticalAlign: '-0.18em' };

export default function Icon({ name, className = '', style }) {
    return (
        <svg className={'mgr-ic ' + (name === 'back' ? 'flip ' : '') + className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style ? { ...BASE, ...style } : BASE}>
            {PATHS[name]}
        </svg>
    );
}
