/* Расчёты: расход топлива, месячные итоги, серии для графиков. */

import { addMonths, monthKey, parseNum, round } from "./utils.js";

function litersOf(row) {
  return parseNum(row.liters);
}

function moneyOf(row) {
  return parseNum(row.total);
}

export function sortRefuels(list) {
  return [...list].sort(
    (a, b) => parseNum(a.odometer) - parseNum(b.odometer) || String(a.date).localeCompare(String(b.date))
  );
}

export function sortByDateDesc(list) {
  return [...list].sort(
    (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.createdAt || 0) - (a.createdAt || 0)
  );
}

/**
 * Считает расход между заправками «до полного бака».
 * Возвращает копии записей (по возрастанию одометра) с полями:
 *   consumption — л/100 км, distance — км, litersSince — литров с прошлого полного бака.
 */
export function withConsumption(refuels) {
  const rows = sortRefuels(refuels).map((r) => ({
    ...r,
    consumption: null,
    distance: null,
    litersSince: null,
  }));
  let lastFull = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (lastFull >= 0 && row.fullTank) {
      const distance = parseNum(row.odometer) - parseNum(rows[lastFull].odometer);
      if (distance > 0) {
        let liters = 0;
        for (let j = lastFull + 1; j <= i; j++) liters += litersOf(rows[j]);
        if (liters > 0) {
          rows[i].consumption = round((liters / distance) * 100, 2);
          rows[i].distance = distance;
          rows[i].litersSince = round(liters, 2);
        }
      }
    }
    if (row.fullTank) lastFull = i;
  }
  return rows;
}

export function consumptionMap(refuels) {
  const map = new Map();
  for (const row of withConsumption(refuels)) {
    if (row.consumption != null) map.set(row.id, row);
  }
  return map;
}

/** Средневзвешенный расход: все литры / весь пробег между полными баками. */
export function averageConsumption(refuels) {
  const rows = withConsumption(refuels).filter((r) => r.consumption != null);
  if (!rows.length) return null;
  const liters = rows.reduce((sum, r) => sum + (r.litersSince || 0), 0);
  const distance = rows.reduce((sum, r) => sum + (r.distance || 0), 0);
  if (!distance) return null;
  return round((liters / distance) * 100, 2);
}

export function consumptionSeries(refuels, limit = 12) {
  const rows = withConsumption(refuels).filter((r) => r.consumption != null);
  return rows.slice(-limit).map((r) => ({
    label: r.date,
    value: r.consumption,
    id: r.id,
  }));
}

/** Средневзвешенный расход по заправкам, попавшим в указанный месяц. */
export function monthConsumption(refuels, key) {
  const rows = withConsumption(refuels).filter(
    (r) => r.consumption != null && monthKey(r.date) === key
  );
  if (!rows.length) return null;
  const distance = rows.reduce((sum, r) => sum + (r.distance || 0), 0);
  const liters = rows.reduce((sum, r) => sum + (r.litersSince || 0), 0);
  return distance ? round((liters / distance) * 100, 2) : null;
}

export function latestRefuel(refuels) {
  return sortByDateDesc(refuels)[0] || null;
}

export function maxOdometer(refuels) {
  return refuels.reduce((max, r) => Math.max(max, parseNum(r.odometer)), 0);
}

export function monthStats(refuels, expenses, key) {
  const monthRefuels = refuels.filter((r) => monthKey(r.date) === key);
  const monthExpenses = expenses.filter((e) => monthKey(e.date) === key);

  const liters = round(monthRefuels.reduce((sum, r) => sum + litersOf(r), 0), 2);
  const fuelCost = round(monthRefuels.reduce((sum, r) => sum + moneyOf(r), 0), 2);
  const otherCost = round(monthExpenses.reduce((sum, e) => sum + parseNum(e.amount), 0), 2);

  const odometers = monthRefuels.map((r) => parseNum(r.odometer)).filter((n) => n > 0);
  const distance = odometers.length >= 2 ? Math.max(...odometers) - Math.min(...odometers) : 0;
  const consumption = distance > 0 && liters > 0 ? round((liters / distance) * 100, 2) : null;

  return {
    key,
    refuelCount: monthRefuels.length,
    expenseCount: monthExpenses.length,
    liters,
    fuelCost,
    otherCost,
    totalCost: round(fuelCost + otherCost, 2),
    distance,
    consumption,
    pricePerLiter: liters > 0 ? round(fuelCost / liters, 2) : null,
    refuels: monthRefuels,
    expenses: monthExpenses,
  };
}

export function monthlySeries(refuels, expenses, endKey, count = 6) {
  const result = [];
  for (let i = count - 1; i >= 0; i--) {
    result.push(monthStats(refuels, expenses, addMonths(endKey, -i)));
  }
  return result;
}

export function rangeStats(refuels, expenses, fromKey, toKey) {
  const rows = refuels.filter((r) => {
    const k = monthKey(r.date);
    return k >= fromKey && k <= toKey;
  });
  const other = expenses.filter((e) => {
    const k = monthKey(e.date);
    return k >= fromKey && k <= toKey;
  });
  const fuelCost = rows.reduce((s, r) => s + moneyOf(r), 0);
  const otherCost = other.reduce((s, e) => s + parseNum(e.amount), 0);
  const liters = rows.reduce((s, r) => s + litersOf(r), 0);
  return {
    fuelCost: round(fuelCost, 2),
    otherCost: round(otherCost, 2),
    totalCost: round(fuelCost + otherCost, 2),
    liters: round(liters, 2),
    refuelCount: rows.length,
    expenseCount: other.length,
    avgConsumption: averageConsumption(rows),
    avgPrice: liters > 0 ? round(fuelCost / liters, 2) : null,
    refuels: rows,
    expenses: other,
  };
}

export function categoryTotals(expenses) {
  const map = new Map();
  for (const e of expenses) {
    const key = e.category || "other";
    map.set(key, (map.get(key) || 0) + parseNum(e.amount));
  }
  return [...map.entries()]
    .map(([category, value]) => ({ category, value: round(value, 2) }))
    .sort((a, b) => b.value - a.value);
}

/** Предпросмотр расхода для ещё не сохранённой заправки. */
export function previewConsumption(refuels, candidate) {
  const temp = {
    ...candidate,
    id: "__preview__",
    date: candidate.date || "2000-01-01",
    liters: parseNum(candidate.liters),
    odometer: parseNum(candidate.odometer),
    fullTank: Boolean(candidate.fullTank),
    total: 0,
    carId: candidate.carId || "",
  };
  const withoutSame = refuels.filter((r) => r.id !== candidate.id && r.id !== "__preview__");
  const rows = withConsumption([...withoutSame, temp]);
  return rows.find((r) => r.id === "__preview__" && r.consumption != null) || null;
}
