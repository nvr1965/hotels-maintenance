import { useEffect, useMemo, useState } from 'react';

// Пошаговый выбор объекта: здание → этаж → объекты/номера → выпадающий список.
// locations приходят из get_assets.php: { id, name, short, building, floor, is_room }

const ui = {
    ru: { building: 'Здание', floor: 'Этаж', kind: 'Что выбираем', objects: '🛠 Объекты', rooms: '🛏 Номера',
          room: 'Номер', none: 'не указано', pick_object: '-- Выберите объект --', pick_room: '-- Выберите номер --', empty: 'Здесь ничего нет' },
    en: { building: 'Building', floor: 'Floor', kind: 'What', objects: '🛠 Objects', rooms: '🛏 Rooms',
          room: 'Room', none: 'not set', pick_object: '-- Select object --', pick_room: '-- Select room --', empty: 'Nothing here' },
    he: { building: 'בניין', floor: 'קומה', kind: 'מה לבחור', objects: '🛠 מתקנים', rooms: '🛏 חדרים',
          room: 'חדר', none: 'לא צוין', pick_object: '-- בחר מתקן --', pick_room: '-- בחר חדר --', empty: 'אין כאן כלום' },
    ar: { building: 'مبنى', floor: 'طابق', kind: 'ماذا تختار', objects: '🛠 المرافق', rooms: '🛏 الغرف',
          room: 'غرفة', none: 'غير محدد', pick_object: '-- اختر المرفق --', pick_room: '-- اختر الغرفة --', empty: 'لا يوجد شيء هنا' }
};

// Естественная сортировка: «2» < «10», «-1» < «0», буквы по алфавиту
const naturalCompare = (a, b) => {
    const na = Number(a), nb = Number(b);
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    if (a === '') return 1;
    if (b === '') return -1;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
};

const uniqueSorted = (arr) => [...new Set(arr)].sort(naturalCompare);

const chipStyle = (active, disabled) => ({
    padding: '10px 16px', minWidth: '52px', borderRadius: '10px', fontSize: '18px', fontWeight: 'bold',
    cursor: disabled ? 'default' : 'pointer',
    border: active ? '2px solid var(--brand-button, #844128)' : '1px solid #d6cbc1',
    background: active ? 'var(--brand-button, #844128)' : '#fff',
    color: active ? '#fff' : '#3f3530',
    opacity: disabled ? 0.4 : 1
});

const stepLabel = { display: 'block', margin: '0 0 8px', fontWeight: 'bold', color: '#5a4f48', fontSize: '16px' };

export default function AssetPicker({ locations, value, onChange, lang }) {
    const t = ui[lang] || ui.ru;
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
    const optionLabel = (l) => isRoom(l) ? `${t.room} ${l.short}` : (l.short || l.name);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'start' }}>
            <div>
                <span style={stepLabel}>1. {t.building}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {buildings.map(b => (
                        <button key={b || '_'} type="button" onClick={() => pickBuilding(b)} style={chipStyle(building === b)}>{show(b)}</button>
                    ))}
                </div>
            </div>

            {building !== null && (
                <div>
                    <span style={stepLabel}>2. {t.floor}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {floors.map(f => (
                            <button key={f || '_'} type="button" onClick={() => pickFloor(f)} style={chipStyle(floor === f)}>{show(f)}</button>
                        ))}
                    </div>
                </div>
            )}

            {floor !== null && (
                <div>
                    <span style={stepLabel}>3. {t.kind}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" disabled={objectCount === 0} onClick={() => pickKind('object')}
                            style={{ ...chipStyle(kind === 'object', objectCount === 0), flex: 1 }}>
                            {t.objects} ({objectCount})
                        </button>
                        <button type="button" disabled={roomCount === 0} onClick={() => pickKind('room')}
                            style={{ ...chipStyle(kind === 'room', roomCount === 0), flex: 1 }}>
                            {t.rooms} ({roomCount})
                        </button>
                    </div>
                </div>
            )}

            {kind !== null && (
                <div>
                    <span style={stepLabel}>4. {kind === 'room' ? t.rooms : t.objects}</span>
                    {options.length === 0 ? (
                        <div style={{ color: '#6e635b', fontStyle: 'italic' }}>{t.empty}</div>
                    ) : (
                        <select
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: value ? '2px solid var(--brand-button, #844128)' : '1px solid #cfc4ba', fontSize: '18px', background: '#fff' }}
                        >
                            <option value="">{kind === 'room' ? t.pick_room : t.pick_object}</option>
                            {options.map(loc => (
                                <option key={loc.id} value={loc.id}>{optionLabel(loc)}</option>
                            ))}
                        </select>
                    )}
                </div>
            )}
        </div>
    );
}
