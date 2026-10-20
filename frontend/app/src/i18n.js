// Тексты интерфейса на любом языке.
// Английские — основа, лежат в lang/en.json и входят в сборку. Остальные языки приходят с сервера
// (backend/api/ui_texts.php: переводы из таблицы ui_translations, недостающие сервер переводит сам)
// и запоминаются в браузере, чтобы интерфейс открывался сразу и без сети.
//
//   uiText('worker', lang)  — словарь раздела: { title: '…', … }; тексты с {1}, {2} — функции t.key(a, b)
//   loadUi(lang)            — подгрузить язык (вызывает App перед сменой языка)
//   useUi()                 — перерисовать компонент, когда тексты обновились
//   isRtl(lang), langName(code), languageList(), localeOf(lang)
import { useEffect, useState } from 'react';
import EN from '../../../lang/en.json';

const STORE = 'hotelapp_ui_';
const RTL_FALLBACK = ['he', 'ar', 'fa', 'ur', 'yi', 'ps', 'dv', 'ku'];
const texts = {};        // lang → { key: text }
const dicts = {};        // `${lang}:${ns}` → готовый словарь раздела
let languages = readStore('languages') || [];
const listeners = new Set();

function readStore(name) {
    try {
        const raw = localStorage.getItem(STORE + name);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeStore(name, value) {
    try { localStorage.setItem(STORE + name, JSON.stringify(value)); } catch { /* не страшно */ }
}

function textsOf(lang) {
    if (lang === 'en') return {};
    if (!texts[lang]) texts[lang] = readStore('texts_' + lang)?.texts || {};
    return texts[lang];
}

const withArgs = (s) => (...a) => s.replace(/\{(\d)\}/g, (_, i) => (a[i - 1] ?? ''));

export function uiText(ns, lang) {
    const id = `${lang}:${ns}`;
    if (dicts[id]) return dicts[id];
    const tr = textsOf(lang);
    const prefix = ns + '.';
    const out = {};
    for (const key of Object.keys(EN)) {
        if (!key.startsWith(prefix)) continue;
        const s = tr[key] || EN[key];
        out[key.slice(prefix.length)] = /\{1\}/.test(EN[key]) ? withArgs(s) : s;
    }
    dicts[id] = out;
    return out;
}

// Подгружает тексты языка с сервера. Пока ждём, интерфейс уже работает на сохранённых (или английских).
export async function loadUi(lang) {
    if (!lang) return;
    const saved = readStore('texts_' + lang);
    try {
        const res = await fetch(`/backend/api/ui_texts.php?lang=${encodeURIComponent(lang)}${saved?.version ? `&have=${encodeURIComponent(saved.version)}` : ''}`, { cache: 'no-store' });
        const data = await res.json();
        if (!data.success) return;
        if (data.languages) {
            languages = data.languages;
            writeStore('languages', languages);
        }
        if (data.texts && lang !== 'en') {
            texts[lang] = data.texts;
            writeStore('texts_' + lang, { version: data.version, texts: data.texts });
        }
        for (const id of Object.keys(dicts)) if (id.startsWith(lang + ':')) delete dicts[id];
        listeners.forEach((fn) => fn());
    } catch { /* без сети — сохранённые тексты */ }
}

// Компонент перерисуется, когда придут тексты или список языков
export function useUi() {
    const [, setN] = useState(0);
    useEffect(() => {
        const fn = () => setN((n) => n + 1);
        listeners.add(fn);
        return () => listeners.delete(fn);
    }, []);
}

export function languageList() {
    return languages.length ? languages : [{ code: 'en', name: 'English', rtl: false }];
}

export function isRtl(lang) {
    const l = languages.find((x) => x.code === lang);
    return l ? !!l.rtl : RTL_FALLBACK.includes(String(lang).split('-')[0]);
}

export const dirOf = (lang) => (isRtl(lang) ? 'rtl' : 'ltr');

export function langName(code) {
    return languages.find((x) => x.code === code)?.name || String(code).toUpperCase();
}

// Для toLocaleString: русский — ru-RU (иначе формат даты другой), остальные — как есть
export function localeOf(lang) {
    return { ru: 'ru-RU', he: 'he-IL', ar: 'ar-SA', en: 'en-US' }[lang] || lang;
}
