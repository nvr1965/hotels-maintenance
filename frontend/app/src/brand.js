// Текущий отель: название, цвета, логотип и список отелей, куда можно переключиться.
// Приходит с сервера (me.php, login.php, до входа — branding.php) и хранится здесь,
// чтобы любой экран мог взять его через useHotel() без передачи через все компоненты.
// Цвета отеля раскладываются в CSS-переменные --brand-*, их используют стили всех экранов.
import { useEffect, useState } from 'react';

const CACHE_KEY = 'hotelapp_brand';
const listeners = new Set();
let state = readCache();

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : { hotel: null, hotels: [], orgs: [] };
    } catch {
        return { hotel: null, hotels: [], orgs: [] };
    }
}

function applyCss(hotel) {
    const b = hotel?.brand;
    if (!b) return;
    const root = document.documentElement.style;
    root.setProperty('--brand-primary', b.color_primary);
    root.setProperty('--brand-accent', b.color_accent);
    root.setProperty('--brand-text', b.color_text);
    root.setProperty('--brand-button', b.color_button || b.color_primary);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', b.color_primary);
    document.title = hotel.name;
    // Установка на телефон: имя и цвета приложения — этого отеля
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest && hotel.slug) manifest.setAttribute('href', `/backend/api/manifest.php?hotel=${encodeURIComponent(hotel.slug)}`);
}

applyCss(state.hotel);

// data: ответ me.php / login.php / select_hotel.php ({hotel, hotels, orgs}) или {hotel} из branding.php
export function setBrand(data) {
    state = {
        hotel: data.hotel || null,
        hotels: data.hotels ?? state.hotels ?? [],
        orgs: data.orgs ?? state.orgs ?? [],
    };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* не страшно */ }
    applyCss(state.hotel);
    listeners.forEach((fn) => fn(state));
}

export function getBrand() {
    return state;
}

export function useBrand() {
    const [s, setS] = useState(state);
    useEffect(() => {
        listeners.add(setS);
        setS(state);
        return () => listeners.delete(setS);
    }, []);
    return s;
}

export const useHotel = () => useBrand().hotel;

// Заголовок отеля на языке: brand.title[lang], иначе название
export function hotelTitle(hotel, lang) {
    return hotel?.brand?.title?.[lang] || hotel?.name || '';
}

// Брендинг до входа: ?hotel=<slug> в адресе, иначе последний отель на этом устройстве, иначе первый на сервере
export async function loadPublicBrand() {
    const slug = new URLSearchParams(window.location.search).get('hotel') || state.hotel?.slug || '';
    try {
        const res = await fetch(`/backend/api/branding.php${slug ? `?hotel=${encodeURIComponent(slug)}` : ''}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.success) setBrand({ hotel: data.hotel, hotels: state.hotels, orgs: state.orgs });
    } catch { /* без сети остаётся сохранённый */ }
    return state.hotel;
}

// Переключить отель и перезапустить приложение уже в нём
export async function switchHotel(hotelId) {
    const res = await fetch('/backend/api/select_hotel.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotel_id: hotelId }),
    });
    const data = await res.json();
    if (!data.success) return false;
    setBrand(data);
    const url = new URL(window.location.href);
    url.searchParams.delete('hotel');
    window.location.replace(url.pathname + url.search);
    return true;
}

export function isOrgAdmin() {
    return (state.orgs || []).some((o) => o.role === 'org_admin');
}
