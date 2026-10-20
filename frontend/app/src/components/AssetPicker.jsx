import { useEffect, useMemo, useState } from 'react';
import { uiText } from '../i18n';
import './mgr/mgr.css';

// Пошаговый выбор объекта кнопками: здание → этаж → объекты/номера → сам объект.
// locations приходят из get_assets.php: { id, name, short, building, floor, is_room }


// Естественная сортировка: «2» < «10», «-1» < «0», буквы по алфавиту
const naturalCompare = (a, b) => {
    const na = Number(a), nb = Number(b);
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    if (a === '') return 1;
    if (b === '') return -1;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
};

const uniqueSorted = (arr) => [...new Set(arr)].sort(naturalCompare);

function Chip({ on, disabled, onClick, children }) {
    return (
        <button type="button" className={'mgr-chp' + (on ? ' on' : '')} aria-pressed={!!on} disabled={disabled} onClick={onClick}>
            <bdi>{children}</bdi>
        </button>
    );
}

export default function AssetPicker({ locations, value, onChange, lang }) {
    const t = uiText('asset_picker', lang);
    const [building, setBuilding] = useState(null);
    const [floor, setFloor] = useState(null);
    const [kind, setKind] = useState(null); // 'room' | 'object'

    const norm = (v) => (v === null || v === undefined ? '' : String(v));
    const isRoom = (l) => Number(l.is_room) === 1;

    const buildings = useMemo(() => uniqueSorted(locations.map(l => norm(l.building))), [locations]);
    const inBuilding = useMemo(() => locations.filter(l => norm(l.building) === building), [locations, building]);
    const floors = useMemo(() => uniqueSorted(inBuilding.map(l => norm(l.floor))), [inBuilding]);
    const onFloor = useMemo(() => inBuilding.filter(l => norm(l.floor) === floor), [inBuilding, floor]);
    const roomCount = onFloor.filter(isRoom).length;
    const objectCount = onFloor.length - roomCount;

    const options = useMemo(() => {
        if (!kind) return [];
        return onFloor
            .filter(l => (kind === 'room') === isRoom(l))
            .sort((a, b) => kind === 'room'
                ? naturalCompare(norm(a.short), norm(b.short))
                : String(a.short || a.name).localeCompare(String(b.short || b.name), undefined, { numeric: true }));
    }, [onFloor, kind]);

    // Если что-то выбрано снаружи (или список перезагрузился на другом языке), подставляем фильтры под выбранный объект
    useEffect(() => {
        if (!value) return;
        const loc = locations.find(l => String(l.id) === String(value));
        if (!loc) return;
        setBuilding(norm(loc.building));
        setFloor(norm(loc.floor));
        setKind(isRoom(loc) ? 'room' : 'object');
    }, [value, locations]);

    // Единственный вариант на шаге выбираем сразу, чтобы не нажимать лишний раз
    useEffect(() => { if (building === null && buildings.length === 1) setBuilding(buildings[0]); }, [buildings, building]);
    useEffect(() => { if (building !== null && floor === null && floors.length === 1) setFloor(floors[0]); }, [floors, floor, building]);
    useEffect(() => {
        if (floor === null || kind !== null) return;
        if (roomCount > 0 && objectCount === 0) setKind('room');
        if (objectCount > 0 && roomCount === 0) setKind('object');
    }, [floor, kind, roomCount, objectCount]);

    const pickBuilding = (b) => { setBuilding(b); setFloor(null); setKind(null); onChange(''); };
    const pickFloor = (f) => { setFloor(f); setKind(null); onChange(''); };
    const pickKind = (k) => { setKind(k); onChange(''); };

    const show = (v) => (v === '' ? t.none : v);
    const chipLabel = (l) => isRoom(l) ? l.short : (l.short || l.name);
    const placeLabel = (l) => isRoom(l) ? `${t.room} ${l.short}` : (l.short || l.name);
    const picked = value ? locations.find(l => String(l.id) === String(value)) : null;

    return (
        <div className="mgr-pick">
            <div className="mgr-lab">{t.building}
                <div className="mgr-chips">
                    {buildings.map(b => <Chip key={b || '_'} on={building === b} onClick={() => pickBuilding(b)}>{show(b)}</Chip>)}
                </div>
            </div>

            {building !== null && (
                <div className="mgr-lab">{t.floor}
                    <div className="mgr-chips">
                        {floors.map(f => <Chip key={f || '_'} on={floor === f} onClick={() => pickFloor(f)}>{show(f)}</Chip>)}
                    </div>
                </div>
            )}

            {floor !== null && (
                <div className="mgr-lab">{t.kind}
                    <div className="mgr-chips">
                        <Chip on={kind === 'object'} disabled={objectCount === 0} onClick={() => pickKind('object')}>{t.objects}</Chip>
                        <Chip on={kind === 'room'} disabled={roomCount === 0} onClick={() => pickKind('room')}>{t.rooms}</Chip>
                    </div>
                </div>
            )}

            {kind !== null && (
                options.length === 0
                    ? <div className="mgr-hint">{t.empty}</div>
                    : (
                        <div className="mgr-chips" role="group" aria-label={kind === 'room' ? t.rooms : t.objects}>
                            {options.map(loc => (
                                <Chip key={loc.id} on={String(value) === String(loc.id)}
                                    onClick={() => onChange(String(value) === String(loc.id) ? '' : String(loc.id))}>{chipLabel(loc)}</Chip>
                            ))}
                        </div>
                    )
            )}

            {picked && (
                <div className="mgr-picked">
                    <div className="mgr-place">{placeLabel(picked)}</div>
                    <small>{t.building} <bdi>{show(norm(picked.building))}</bdi> · {t.floor} <bdi>{show(norm(picked.floor))}</bdi></small>
                </div>
            )}
        </div>
    );
}
