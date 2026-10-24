/* Лёгкие SVG-графики без внешних библиотек. */

import { fmtDate, fmtMoneyShort, fmtNum, esc } from "./utils.js";

const registry = new Set();
let resizeBound = false;
let resizeTimer = null;
let gradientSeq = 0;

function bindResize() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const el of [...registry]) {
        if (!el.isConnected) {
          registry.delete(el);
          continue;
        }
        try {
          if (el.__draw) el.__draw();
        } catch (error) {
          console.warn("chart draw failed", error);
        }
      }
    }, 120);
  });
}

function register(el, draw) {
  el.__draw = draw;
  registry.add(el);
  bindResize();
  draw();
}

/** Убирает из реестра графики, которых больше нет на странице. */
export function clearCharts() {
  for (const el of [...registry]) {
    if (!el.isConnected) registry.delete(el);
  }
}

function svgEl(tag, attrs = {}) {
  return `<${tag} ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ")}/>`;
}

function niceScale(min, max, tickCount = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.25 };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const range = max - min;
  const rough = range / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
    step,
  };
}

function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function topRoundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  if (height <= 0.5) return "";
  return [
    `M${x.toFixed(2)},${(y + height).toFixed(2)}`,
    `V${(y + r).toFixed(2)}`,
    `Q${x.toFixed(2)},${y.toFixed(2)} ${(x + r).toFixed(2)},${y.toFixed(2)}`,
    `H${(x + width - r).toFixed(2)}`,
    `Q${(x + width).toFixed(2)},${y.toFixed(2)} ${(x + width).toFixed(2)},${(y + r).toFixed(2)}`,
    `V${(y + height).toFixed(2)}`,
    "Z",
  ].join(" ");
}

function emptyChart(message) {
  return `<div class="chart-empty">
    <svg class="icon"><use href="#i-chart"></use></svg>
    <span>${esc(message)}</span>
  </div>`;
}

/**
 * Линейный график.
 * points: [{ label: '2026-10-24', value: 7.2 }]
 */
export function lineChart(el, points, options = {}) {
  const opts = {
    height: 210,
    sparkline: false,
    color: null,
    fillTop: null,
    fillBottom: null,
    emptyText: "Пока нет данных для графика",
    valueSuffix: "",
    ...options,
  };

  const draw = () => {
    const width = Math.max(260, el.clientWidth || 480);
    const height = opts.height;
    if (!points || points.length === 0) {
      el.innerHTML = emptyChart(opts.emptyText);
      return;
    }

    const padding = opts.sparkline
      ? { top: 14, right: 8, bottom: 8, left: 8 }
      : { top: 14, right: 12, bottom: 24, left: 36 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const values = points.map((p) => Number(p.value) || 0);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const domain = opts.sparkline
      ? { min: rawMin - (rawMax - rawMin || 1) * 0.35, max: rawMax + (rawMax - rawMin || 1) * 0.2 }
      : niceScale(
          rawMin - (rawMax - rawMin || 1) * 0.1,
          rawMax + (rawMax - rawMin || 1) * 0.1,
          4
        );

    const xAt = (index) =>
      padding.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
    const yAt = (value) =>
      padding.top + innerH - ((value - domain.min) / (domain.max - domain.min || 1)) * innerH;

    const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(Number(p.value) || 0), ...p }));
    const color = opts.color || "var(--chart-line)";
    const gradientId = `chart-grad-${++gradientSeq}`;
    const fillTop = opts.fillTop || (opts.color ? color : "var(--chart-line)");
    const fillBottom = opts.fillBottom || "transparent";

    let content = "";

    if (!opts.sparkline) {
      const ticks = Math.round((domain.max - domain.min) / domain.step) || 4;
      for (let i = 0; i <= ticks; i++) {
        const value = domain.min + i * domain.step;
        const y = yAt(value);
        content += svgEl("line", {
          class: "chart-grid-line",
          x1: padding.left,
          x2: width - padding.right,
          y1: y.toFixed(2),
          y2: y.toFixed(2),
        });
        content += `<text x="${padding.left - 8}" y="${(y + 3.5).toFixed(2)}" text-anchor="end">${fmtNum(value, domain.step < 1 ? 1 : 0)}${esc(opts.valueSuffix)}</text>`;
      }
    }

    const linePath = smoothPath(coords);
    const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(2)},${(padding.top + innerH).toFixed(2)} L${coords[0].x.toFixed(2)},${(padding.top + innerH).toFixed(2)} Z`;

    content += `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${fillTop}" stop-opacity="${opts.sparkline ? 0.32 : 0.22}"/>
      <stop offset="100%" stop-color="${fillBottom}" stop-opacity="0"/>
    </linearGradient></defs>`;
    content += `<path d="${areaPath}" fill="url(#${gradientId})" stroke="none"/>`;
    content += `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="${opts.sparkline ? 2.4 : 2.2}" stroke-linecap="round" stroke-linejoin="round"/>`;

    if (!opts.sparkline) {
      const maxLabels = width < 420 ? 4 : 6;
      const stepX = Math.max(1, Math.ceil(points.length / maxLabels));
      points.forEach((p, i) => {
        const isLast = i === points.length - 1;
        if (i % stepX !== 0 && !isLast) return;
        if (isLast && i % stepX !== 0 && i - Math.floor(i / stepX) * stepX < stepX * 0.5) {
          // избегаем наложения последней подписи
        }
        const x = xAt(i);
        const date = p.label ? new Date(`${String(p.label).slice(0, 10)}T12:00:00`) : null;
        const label = date
          ? `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`
          : String(p.label ?? i + 1);
        content += `<text x="${x.toFixed(2)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : isLast ? "end" : "middle"}">${esc(label)}</text>`;
      });

      const showDots = points.length <= 12;
      if (showDots) {
        coords.forEach((p, i) => {
          const isLast = i === coords.length - 1;
          content += `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${isLast ? 4 : 2.6}"
            fill="${isLast ? color : "var(--surface)"}" stroke="${color}" stroke-width="2"/>`;
        });
      } else {
        const last = coords[coords.length - 1];
        content += `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3.6" fill="${color}"/>`;
      }
    } else if (coords.length > 1) {
      const last = coords[coords.length - 1];
      content += `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3" fill="${color}" stroke="rgba(255,255,255,.6)" stroke-width="2"/>`;
    }

    el.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="График расхода топлива">${content}</svg>`;
  };

  register(el, draw);
}

/**
 * Столбчатый график с двумя сегментами (топливо / прочее).
 * data: [{ label: 'окт', fuel: 12000, other: 3000 }]
 */
export function barChart(el, data, options = {}) {
  const opts = { height: 240, emptyText: "Пока нет расходов", ...options };

  const draw = () => {
    const width = Math.max(300, el.clientWidth || 520);
    const height = opts.height;
    if (!data || !data.length) {
      el.innerHTML = emptyChart(opts.emptyText);
      return;
    }

    const padding = { top: 16, right: 10, bottom: 26, left: 46 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const totals = data.map((d) => (Number(d.fuel) || 0) + (Number(d.other) || 0));
    const maxValue = Math.max(...totals, 1);
    const domain = niceScale(0, maxValue, 4);

    const yAt = (value) => padding.top + innerH - (value / (domain.max || 1)) * innerH;
    const slot = innerW / data.length;
    const barWidth = Math.min(40, Math.max(14, slot * 0.5));

    let content = "";
    const ticks = Math.round(domain.max / domain.step) || 4;
    for (let i = 0; i <= ticks; i++) {
      const value = i * domain.step;
      const y = yAt(value);
      content += svgEl("line", {
        class: "chart-grid-line",
        x1: padding.left,
        x2: width - padding.right,
        y1: y.toFixed(2),
        y2: y.toFixed(2),
      });
      content += `<text x="${padding.left - 8}" y="${(y + 3.5).toFixed(2)}" text-anchor="end">${fmtMoneyShort(value)}</text>`;
    }

    data.forEach((item, index) => {
      const fuel = Number(item.fuel) || 0;
      const other = Number(item.other) || 0;
      const total = fuel + other;
      const center = padding.left + slot * index + slot / 2;
      const x = center - barWidth / 2;
      const baseY = padding.top + innerH;
      const totalHeight = total > 0 ? Math.max(3, (total / (domain.max || 1)) * innerH) : 0;
      const topY = baseY - totalHeight;
      const fuelHeight = total > 0 ? (fuel / total) * totalHeight : 0;
      const otherHeight = totalHeight - fuelHeight;

      if (total > 0) {
        if (other > 0) {
          content += `<path d="${topRoundedRect(x, topY, barWidth, otherHeight, 6)}" fill="var(--chart-other)"/>`;
          content += `<rect x="${x.toFixed(2)}" y="${(baseY - fuelHeight).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(0, fuelHeight).toFixed(2)}" fill="var(--chart-bar)"/>`;
        } else {
          content += `<path d="${topRoundedRect(x, topY, barWidth, totalHeight, 6)}" fill="var(--chart-bar)"/>`;
        }
      } else {
        content += `<rect x="${x.toFixed(2)}" y="${(baseY - 2).toFixed(2)}" width="${barWidth.toFixed(2)}" height="2" rx="1" fill="var(--border-strong)"/>`;
      }

      content += `<text x="${center.toFixed(2)}" y="${height - 8}" text-anchor="middle">${esc(item.label)}</text>`;
    });

    el.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="График расходов по месяцам">${content}</svg>`;
  };

  register(el, draw);
}

/**
 * Кольцевая диаграмма.
 * segments: [{ label, value, color }]
 */
export function donutChart(el, segments, options = {}) {
  const opts = { totalLabel: "Всего", emptyText: "Пока нет расходов", ...options };

  const draw = () => {
    const items = (segments || []).filter((s) => Number(s.value) > 0);
    const total = items.reduce((sum, s) => sum + Number(s.value), 0);
    if (!items.length || !total) {
      el.innerHTML = emptyChart(opts.emptyText);
      return;
    }

    const size = 200;
    const radius = 76;
    const thickness = 20;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    let content = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--surface-2)" stroke-width="${thickness}"/>`;
    for (const item of items) {
      const length = (Number(item.value) / total) * circumference;
      const visible = Math.max(0, length - 3);
      content += `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none"
        stroke="${item.color}" stroke-width="${thickness}"
        stroke-dasharray="${visible.toFixed(2)} ${(circumference - visible).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"
        stroke-linecap="butt"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      offset += length;
    }

    content += `<text x="${size / 2}" y="${size / 2 - 4}" text-anchor="middle" style="font-size:10px;fill:var(--muted);font-weight:600">${esc(opts.totalLabel)}</text>`;
    content += `<text x="${size / 2}" y="${size / 2 + 16}" text-anchor="middle" style="font-size:17px;fill:var(--text);font-weight:700">${esc(fmtMoneyShort(total))}</text>`;

    el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Структура расходов">${content}</svg>`;
  };

  register(el, draw);
}
