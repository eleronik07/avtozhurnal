/* Утилиты: форматирование, даты, числа. */

export const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];
export const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtNum(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (digits === 1) return nf1.format(n);
  if (digits === 2) return nf2.format(n);
  return nf0.format(n);
}

export function fmtMoney(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const num = digits === 2 ? nf2.format(n) : digits === 1 ? nf1.format(n) : nf0.format(n);
  return `${num} \u20BD`;
}

/** Компактные деньги для осей графика: 12 500 → «12,5 тыс.» */
export function fmtMoneyShort(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: k >= 100 ? 0 : 1 }).format(k)} тыс.`;
  }
  return fmtNum(n);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").replace(/\s|\u00A0/g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function isoToDate(iso) {
  if (iso instanceof Date) return iso;
  const parts = String(iso || "").slice(0, 10).split("-").map(Number);
  const [y, m, d] = parts;
  return new Date(y || 2000, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 2026-10-24 → «24 окт 2026» (или «24 окт»). */
export function fmtDate(iso, { year = true, short = false } = {}) {
  const d = isoToDate(iso);
  const month = short ? MONTHS_SHORT[d.getMonth()] : MONTHS_GEN[d.getMonth()];
  return `${d.getDate()} ${month}${year ? ` ${d.getFullYear()}` : ""}`;
}

export function fmtDateLong(iso) {
  const d = isoToDate(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtWeekday(iso, short = false) {
  const d = isoToDate(iso);
  const name = (short ? WEEKDAYS_SHORT : WEEKDAYS)[d.getDay()];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

export function monthLabel(key, { short = false } = {}) {
  const [y, m] = String(key || "").split("-").map(Number);
  if (!y || !m) return "—";
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS_NOM[m - 1]} ${y}`;
}

export function addMonths(key, delta) {
  const [y, m] = String(key).split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isSameMonth(iso, key) {
  return monthKey(iso) === key;
}

/** «Сегодня» / «Вчера» / «24 октября» */
export function relativeDay(iso) {
  const today = todayISO();
  if (iso === today) return "Сегодня";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (iso === todayISO(yesterday)) return "Вчера";
  return fmtDate(iso, { year: isoToDate(iso).getFullYear() !== new Date().getFullYear() });
}

export function fmtTime(ts) {
  if (!ts) return "…";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${fmtDate(todayISO(d), { year: true })}, ${fmtTime(ts)}`;
}

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plural(n, forms) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return "?";
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < String(text).length; i++) {
    hash = (hash * 31 + String(text).charCodeAt(i)) % 360;
  }
  return hash;
}

export function avatarStyle(seed) {
  const hue = hashHue(seed || "user");
  return `background: linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${(hue + 32) % 360} 50% 32%));`;
}

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "друг";
}

export function daysBetween(isoA, isoB) {
  return Math.round((isoToDate(isoB) - isoToDate(isoA)) / 86400000);
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
