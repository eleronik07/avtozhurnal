/* Автожурнал — клиентское приложение. */

import { createApi, isFirebaseConfigured } from "./api.js";
import * as U from "./utils.js";
import * as S from "./stats.js";
import { lineChart, barChart, donutChart, clearCharts } from "./charts.js";

const APP_VERSION = "1.0.0";
const THEME_KEY = "az.theme";

const CATEGORIES = [
  { id: "to", label: "ТО", icon: "sliders", color: "#0f8a5f" },
  { id: "repair", label: "Ремонт", icon: "car", color: "#2f7fd1" },
  { id: "insurance", label: "Страховка", icon: "lock", color: "#8b5cf6" },
  { id: "tax", label: "Налог", icon: "wallet", color: "#d97706" },
  { id: "fine", label: "Штраф", icon: "info", color: "#d64545" },
  { id: "wash", label: "Мойка", icon: "drop", color: "#06b6d4" },
  { id: "tires", label: "Шины", icon: "gauge", color: "#64748b" },
  { id: "parking", label: "Парковка", icon: "car", color: "#a16207" },
  { id: "other", label: "Прочее", icon: "more", color: "#94a3b8" },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const FUEL_TYPES = ["АИ-92", "АИ-95", "АИ-98", "АИ-100", "ДТ", "Газ (СУГ)", "Электро"];

const PAGE_META = {
  home: ["Главная", "Сводка по автомобилю"],
  journal: ["Журнал", "Заправки и расходы"],
  stats: ["Статистика", "Расходы и расход топлива"],
  chat: ["Общий чат", "Общайтесь с другими водителями"],
  profile: ["Профиль", "Аккаунт и автомобили"],
};

const state = {
  mode: null,
  api: null,
  user: null,
  profile: null,
  cars: [],
  carId: null,
  refuels: [],
  expenses: [],
  chat: [],
  view: "home",
  journalTab: "refuels",
  month: U.monthKey(U.todayISO()),
  statsRange: 6,
  enter: false,
  booted: false,
  sendingChat: false,
  unsubs: [],
  authUnsub: null,
};

const media = window.matchMedia("(prefers-color-scheme: dark)");
let themePref = "auto";

/* ── Мини-хелперы ─────────────────────────────────────────────────────── */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ic = (name, cls = "icon") => `<svg class="${cls}"><use href="#i-${name}"></use></svg>`;

function carRefuels() {
  return state.refuels
    .filter((row) => row.carId === state.carId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));
}

function carExpenses() {
  return state.expenses
    .filter((row) => row.carId === state.carId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));
}

function currentCar() {
  return state.cars.find((car) => car.id === state.carId) || state.cars[0] || null;
}

function recordsCount() {
  return state.refuels.length + state.expenses.length;
}

/* ── Тема ─────────────────────────────────────────────────────────────── */

function resolveTheme(pref) {
  return pref === "auto" ? (media.matches ? "dark" : "light") : pref;
}

function applyTheme(pref, persist = false) {
  themePref = pref;
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#090d0a" : "#f4f6f2");
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* ignore */
    }
  }
}

media.addEventListener("change", () => {
  if (themePref === "auto") applyTheme("auto");
});

/* ── Загрузка ─────────────────────────────────────────────────────────── */

async function start() {
  try {
    themePref = localStorage.getItem(THEME_KEY) || "auto";
  } catch {
    themePref = "auto";
  }
  applyTheme(themePref);

  bindAuth();
  bindDelegates();
  registerServiceWorker();

  window.addEventListener("hashchange", route);
  window.addEventListener("online", updateNetwork);
  window.addEventListener("offline", updateNetwork);

  const params = new URLSearchParams(location.search);
  const demo = params.get("demo") === "1";

  try {
    if (demo) {
      state.mode = "demo";
      state.api = await createApi("demo");
      await state.api.signInDemo();
      state.authUnsub = state.api.onAuthChange(handleAuth);
    } else if (isFirebaseConfigured) {
      state.mode = "firebase";
      state.api = await createApi("firebase");
      state.authUnsub = state.api.onAuthChange(handleAuth);
    } else {
      showSetup();
    }
  } catch (error) {
    console.error("Не удалось запустить приложение:", error);
    showSetup(error?.message);
  }

  setTimeout(hideBoot, 4000);
}

function handleAuth(user) {
  if (!user) {
    state.user = null;
    state.profile = null;
    state.booted = false;
    teardownData();
    showAuth();
    hideBoot();
    return;
  }

  const sameUser = state.user && state.user.uid === user.uid;
  state.user = user;
  state.profile = { name: user.name || state.profile?.name || "Водитель", email: user.email || "" };

  if (sameUser && state.booted) {
    renderChrome();
    if (state.view === "profile") render();
    return;
  }

  state.booted = true;
  showApp();
  hideBoot();
  subscribeData();
  render();
}

function subscribeData() {
  teardownData();
  const onError = (error) => {
    if (error?.code === "permission-denied") {
      toast("Нет доступа к данным. Проверьте правила Firestore.", "error");
    }
  };

  state.unsubs.push(
    state.api.subscribeCars((items) => {
      state.cars = items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      ensureCar();
      render();
    }, onError),
    state.api.subscribeRefuels((items) => {
      state.refuels = items;
      render();
    }, onError),
    state.api.subscribeExpenses((items) => {
      state.expenses = items;
      render();
    }, onError),
    state.api.subscribeChat((items) => {
      state.chat = items;
      onChatUpdate();
    }, onError)
  );
}

function teardownData() {
  state.unsubs.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn(error);
    }
  });
  state.unsubs = [];
  state.cars = [];
  state.refuels = [];
  state.expenses = [];
  state.chat = [];
  state.carId = null;
}

function ensureCar() {
  if (!state.cars.length) {
    state.carId = null;
    return;
  }
  if (state.cars.some((car) => car.id === state.carId)) return;
  let stored = null;
  try {
    stored = localStorage.getItem(`az.car.${state.user?.uid}`);
  } catch {
    stored = null;
  }
  state.carId = state.cars.find((car) => car.id === stored)?.id || state.cars[0].id;
  try {
    localStorage.setItem(`az.car.${state.user?.uid}`, state.carId);
  } catch {
    /* ignore */
  }
}

function selectCar(id) {
  state.carId = id;
  try {
    localStorage.setItem(`az.car.${state.user?.uid}`, id);
  } catch {
    /* ignore */
  }
  closeCarPicker();
  render();
}

/* ── Экраны ───────────────────────────────────────────────────────────── */

function hideBoot() {
  const boot = $("#boot");
  if (!boot) return;
  boot.classList.add("is-done");
  setTimeout(() => boot.remove(), 340);
}

function showAuth() {
  $("#auth-screen").hidden = false;
  $("#setup-screen").hidden = true;
  $("#shell").hidden = true;
  document.body.classList.remove("app-mode");
}

function showSetup(message) {
  $("#auth-screen").hidden = true;
  $("#shell").hidden = true;
  $("#setup-screen").hidden = false;
  if (message) console.warn(message);
  hideBoot();
}

function showApp() {
  $("#auth-screen").hidden = true;
  $("#setup-screen").hidden = true;
  $("#shell").hidden = false;
  document.body.classList.add("app-mode");

  updateNetwork();
  const valid = /^#\/(home|journal|stats|chat|profile)/.test(location.hash || "");
  if (!valid) history.replaceState(null, "", "#/home");
  state.view = parseView();
  state.enter = true;
}

function parseView() {
  const raw = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return PAGE_META[raw] ? raw : "home";
}

function route() {
  if (!state.user) return;
  const view = parseView();
  if (view !== state.view) {
    state.view = view;
    state.enter = true;
    window.scrollTo(0, 0);
  }
  render();
}

/* ── Отрисовка ────────────────────────────────────────────────────────── */

function render() {
  if (!state.user) return;
  renderChrome();

  if (state.view === "chat") {
    if (!$("#chat-list")) renderChatPage();
    else renderChatMessages();
    return;
  }

  clearCharts();
  $("#view").innerHTML =
    state.view === "home" ? viewHome() :
    state.view === "journal" ? viewJournal() :
    state.view === "stats" ? viewStats() :
    viewProfile();
  mountCharts();
}

function pageWrap(inner, extra = "") {
  const cls = `page${state.enter ? " page--enter" : ""}${extra ? ` ${extra}` : ""}`;
  state.enter = false;
  return `<div class="${cls}">${inner}</div>`;
}

function renderChrome() {
  const meta = PAGE_META[state.view] || PAGE_META.home;
  const car = currentCar();
  const tabLabels = { refuels: "заправки", expenses: "расходы", all: "все записи" };

  let subtitle = meta[1];
  if (car && state.view === "journal") subtitle = `${car.name} · ${tabLabels[state.journalTab]}`;
  if (car && state.view === "stats") subtitle = `${car.name} · последние ${state.statsRange} мес.`;

  $("#page-title").textContent = meta[0];
  $("#page-sub").textContent = subtitle;

  $$("[data-nav]").forEach((el) => {
    const active = el.dataset.nav === state.view;
    el.classList.toggle("is-active", active);
    if (active) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });

  $("#car-picker-name").textContent = car ? car.name : "Нет автомобиля";

  const name = state.profile?.name || "Пользователь";
  const email = state.profile?.email || "";
  $("#sidebar-name").textContent = name;
  $("#sidebar-email").textContent = email || "—";
  const avatar = $("#sidebar-avatar");
  avatar.textContent = U.initials(name);
  avatar.style.cssText = U.avatarStyle(email || state.user?.uid);

  $("#mode-pill").hidden = state.mode !== "demo";
  renderCarList();
  updateNetwork();
}

function renderCarList() {
  const list = $("#car-picker-list");
  if (!list) return;
  if (!state.cars.length) {
    list.innerHTML = `<div class="car-picker__empty">Пока нет автомобилей</div>`;
    return;
  }
  list.innerHTML = state.cars
    .map((car) => {
      const active = car.id === state.carId;
      const sub = [car.make, car.plate].filter(Boolean).join(" · ");
      return `<button type="button" class="car-picker__item${active ? " is-active" : ""}" data-car-id="${U.esc(car.id)}" role="option" aria-selected="${active}">
        ${ic("car")}
        <span>${U.esc(car.name)}</span>
        ${sub ? `<small>${U.esc(car.plate || "")}</small>` : ""}
        ${active ? ic("check") : ""}
      </button>`;
    })
    .join("");
}

function updateNetwork() {
  const pill = $("#offline-pill");
  if (!pill) return;
  pill.hidden = navigator.onLine !== false;
}

/* ── Главная ──────────────────────────────────────────────────────────── */

function viewHome() {
  const car = currentCar();
  if (!car) return pageWrap(noCarsTemplate());

  const refuels = carRefuels();
  const expenses = carExpenses();
  const monthKey = U.monthKey(U.todayISO());
  const month = S.monthStats(refuels, expenses, monthKey);
  const average = S.averageConsumption(refuels);
  const series = S.consumptionSeries(refuels, 10);
  const last = S.latestRefuel(refuels);
  const consumptionById = S.consumptionMap(refuels);

  const currentConsumption = S.monthConsumption(refuels, monthKey);
  const previousConsumption = S.monthConsumption(refuels, U.addMonths(monthKey, -1));
  const trend = currentConsumption != null && previousConsumption != null
    ? U.round(currentConsumption - previousConsumption, 1)
    : null;

  const trendIcon = trend === 0 ? "" : ic(trend < 0 ? "trend-down" : "trend-up");
  const trendHtml = trend == null
    ? `<span class="hero__trend">за всё время</span>`
    : `<span class="hero__trend">${trendIcon}${trend === 0 ? "как в прошлом месяце" : `${trend > 0 ? "+" : ""}${U.fmtNum(trend, 1)} л к прошлому месяцу`}</span>`;

  const recent = [
    ...refuels.map((row) => ({ ...row, kind: "refuel" })),
    ...expenses.map((row) => ({ ...row, kind: "expense" })),
  ]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5);

  const empty = !refuels.length && !expenses.length;
  const today = U.todayISO();

  const quickStats = empty
    ? onboardingTemplate()
    : `<div class="quick-stats">
        <div class="card stat-card">
          <span class="stat-card__icon">${ic("fuel")}</span>
          <div class="stat-card__body">
            <div class="stat-card__label">Последняя заправка</div>
            <div class="stat-card__value">${last ? U.fmtMoney(last.total) : "—"}</div>
            <div class="stat-card__sub">${last ? `${U.fmtDate(last.date, { short: true })} · ${U.fmtNum(last.liters, 1)} л` : "Нет заправок"}</div>
          </div>
        </div>
        <div class="card stat-card">
          <span class="stat-card__icon stat-card__icon--neutral">${ic("wallet")}</span>
          <div class="stat-card__body">
            <div class="stat-card__label">Средняя цена</div>
            <div class="stat-card__value">${month.pricePerLiter ? `${U.fmtNum(month.pricePerLiter, 2)} ₽/л` : "—"}</div>
            <div class="stat-card__sub">${last?.fuelType || "за текущий месяц"}</div>
          </div>
        </div>
        <div class="card stat-card">
          <span class="stat-card__icon stat-card__icon--neutral">${ic("sliders")}</span>
          <div class="stat-card__body">
            <div class="stat-card__label">Расходы за месяц</div>
            <div class="stat-card__value">${U.fmtMoney(month.otherCost)}</div>
            <div class="stat-card__sub">${month.expenseCount ? `${month.expenseCount} ${U.plural(month.expenseCount, ["запись", "записи", "записей"])}` : "кроме топлива"}</div>
          </div>
        </div>
      </div>`;

  return pageWrap(`
    <div class="hello">
      <div>
        <p class="hello__date">${U.fmtWeekday(today)} · ${U.fmtDate(today, { year: false })}</p>
        <h1 class="hello__title">${U.greeting()}, <span>${U.esc(U.firstName(state.profile?.name))}</span></h1>
      </div>
    </div>

    <section class="hero">
      <div class="hero__main">
        <span class="hero__eyebrow">${ic("gauge")} Средний расход</span>
        <div class="hero__value">${average ? U.fmtNum(average, 1) : "—"}<span>л / 100 км</span></div>
        ${trendHtml}
      </div>
      <div class="hero__chart" data-chart="hero"></div>
      <div class="hero__stats">
        <div class="hero__stat"><b>${U.fmtNum(month.distance)} км</b><span>пробег за месяц</span></div>
        <div class="hero__stat"><b>${U.fmtMoney(month.totalCost)}</b><span>потрачено за месяц</span></div>
        <div class="hero__stat"><b>${U.fmtNum(month.liters, 1)} л</b><span>заправлено за месяц</span></div>
      </div>
    </section>

    ${quickStats}

    <div class="home-grid">
      <section class="card chart-card">
        <div class="card-head">
          <div><h2>Расход топлива</h2><p>по заправкам до полного бака</p></div>
          <button type="button" class="card-head__link" data-action="stats">Подробнее</button>
        </div>
        <div class="chart" data-chart="consumption"></div>
      </section>

      <section class="card recent-card">
        <div class="card-head">
          <div><h2>Последние записи</h2><p>${recent.length ? `${recent.length} из ${refuels.length + expenses.length}` : "пока пусто"}</p></div>
          <a class="card-head__link" href="#/journal">Все</a>
        </div>
        ${recent.length
          ? `<div class="recent-list">${recent.map((item) => recordItem(item, consumptionById)).join("")}</div>`
          : `<div class="empty empty--compact">
              <span class="empty__icon">${ic("journal")}</span>
              <h3>Здесь появятся записи</h3>
              <p>Добавьте первую заправку или расход.</p>
            </div>`}
      </section>
    </div>
  `);
}

function onboardingTemplate() {
  return `<div class="card onboarding">
    <span class="onboarding__icon">${ic("sparkles")}</span>
    <div class="onboarding__body">
      <h3>Начните с первой заправки</h3>
      <p>Внесите одометр, литры и сумму. Расход посчитается автоматически после второй заправки «до полного бака».</p>
    </div>
    <button type="button" class="btn btn--primary" data-action="add">${ic("plus")} Добавить заправку</button>
  </div>`;
}

function noCarsTemplate() {
  return `<div class="card"><div class="empty">
    <span class="empty__icon">${ic("car")}</span>
    <h3>Добавьте автомобиль</h3>
    <p>Он нужен, чтобы вести журнал заправок и считать расход топлива.</p>
    <button type="button" class="btn btn--primary" data-action="add-car">${ic("plus")} Добавить автомобиль</button>
  </div></div>`;
}

/* ── Запись ───────────────────────────────────────────────────────────── */

function recordItem(item, consumptionById, { showDate = false } = {}) {
  const isRefuel = item.kind === "refuel";
  const category = !isRefuel ? CAT[item.category] || CAT.other : null;
  const title = isRefuel ? item.station || "Заправка" : category.label;

  const parts = [];
  if (showDate) parts.push(U.fmtDate(item.date, { year: false }));
  if (isRefuel) {
    parts.push(`${U.fmtNum(item.liters, 1)} л`);
    if (item.pricePerLiter) parts.push(`${U.fmtNum(item.pricePerLiter, 2)} ₽/л`);
    if (item.fuelType) parts.push(item.fuelType);
  } else {
    parts.push(item.note || U.fmtDate(item.date, { year: false }));
  }

  const computed = isRefuel ? consumptionById.get(item.id) : null;
  const badge = computed
    ? `${U.fmtNum(computed.consumption, 1)} л/100`
    : isRefuel
      ? item.fullTank ? "полный бак" : "долив"
      : "";

  return `<button type="button" class="record" data-kind="${item.kind}" data-id="${U.esc(item.id)}">
    <span class="record__icon ${isRefuel ? "" : "record__icon--expense"}">${ic(isRefuel ? "fuel" : category.icon)}</span>
    <span class="record__body">
      <span class="record__title">${U.esc(title)}</span>
      <span class="record__sub">${parts.map((part) => U.esc(part)).join(" · ")}</span>
    </span>
    <span class="record__right">
      <span class="record__amount">${U.fmtMoney(isRefuel ? item.total : item.amount)}</span>
      <span class="record__badge ${computed ? "" : "record__badge--muted"}">${badge}</span>
    </span>
  </button>`;
}

/* ── Журнал ───────────────────────────────────────────────────────────── */

function viewJournal() {
  const car = currentCar();
  if (!car) return pageWrap(noCarsTemplate());

  const allRefuels = carRefuels();
  const allExpenses = carExpenses();
  const month = S.monthStats(allRefuels, allExpenses, state.month);

  const refuels = allRefuels.filter((row) => U.monthKey(row.date) === state.month);
  const expenses = allExpenses.filter((row) => U.monthKey(row.date) === state.month);

  let items = [];
  if (state.journalTab !== "expenses") items.push(...refuels.map((row) => ({ ...row, kind: "refuel" })));
  if (state.journalTab !== "refuels") items.push(...expenses.map((row) => ({ ...row, kind: "expense" })));
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));

  const consumptionById = S.consumptionMap(allRefuels);
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date).push(item);
  }

  const currentMonth = U.monthKey(U.todayISO());
  const nextDisabled = state.month >= currentMonth;

  const groupsHtml = [...groups.entries()]
    .map(([date, dayItems]) => {
      const dayTotal = dayItems.reduce((sum, item) => sum + U.parseNum(item.kind === "refuel" ? item.total : item.amount), 0);
      return `<div class="day-group">
        <div class="day-head"><span>${U.relativeDay(date)} · ${U.fmtWeekday(date, true)}</span><span>${U.fmtMoney(dayTotal)}</span></div>
        ${dayItems.map((item) => recordItem(item, consumptionById)).join("")}
      </div>`;
    })
    .join("");

  return pageWrap(`
    <div class="toolbar">
      <div class="segmented" role="tablist" aria-label="Тип записей">
        <button type="button" class="segmented__btn ${state.journalTab === "refuels" ? "is-active" : ""}" data-journal-tab="refuels" role="tab" aria-selected="${state.journalTab === "refuels"}">Заправки</button>
        <button type="button" class="segmented__btn ${state.journalTab === "expenses" ? "is-active" : ""}" data-journal-tab="expenses" role="tab" aria-selected="${state.journalTab === "expenses"}">Расходы</button>
        <button type="button" class="segmented__btn ${state.journalTab === "all" ? "is-active" : ""}" data-journal-tab="all" role="tab" aria-selected="${state.journalTab === "all"}">Всё</button>
      </div>

      <div class="month-nav">
        <button type="button" data-month-step="-1" aria-label="Предыдущий месяц">${ic("chevron-left")}</button>
        <span class="month-nav__label">${U.monthLabel(state.month)}</span>
        <button type="button" data-month-step="1" aria-label="Следующий месяц" ${nextDisabled ? "disabled" : ""}>${ic("chevron-right")}</button>
      </div>
    </div>

    <div class="journal-summary">
      <span>Записей: <b>${month.refuelCount + month.expenseCount}</b></span>
      <span>Топливо: <b>${U.fmtMoney(month.fuelCost)}</b></span>
      <span>Прочее: <b>${U.fmtMoney(month.otherCost)}</b></span>
      <span>Пробег: <b>${U.fmtNum(month.distance)} км</b></span>
    </div>

    ${items.length
      ? `<section class="card journal-card">${groupsHtml}</section>`
      : `<section class="card"><div class="empty">
          <span class="empty__icon">${ic("journal")}</span>
          <h3>${state.journalTab === "all" ? "За этот месяц записей нет" : "В этой категории пока пусто"}</h3>
          <p>Добавьте запись или переключите вкладку — журнал заполнится сам.</p>
          <button type="button" class="btn btn--primary" data-action="add">${ic("plus")} Добавить запись</button>
        </div></section>`}
  `);
}

/* ── Статистика ───────────────────────────────────────────────────────── */

function viewStats() {
  const car = currentCar();
  if (!car) return pageWrap(noCarsTemplate());

  const refuels = carRefuels();
  const expenses = carExpenses();
  const endKey = U.monthKey(U.todayISO());
  const months = S.monthlySeries(refuels, expenses, endKey, state.statsRange);
  const fromKey = months[0].key;
  const totals = S.rangeStats(refuels, expenses, fromKey, endKey);
  const consumption = S.consumptionSeries(refuels, 60).filter((point) => U.monthKey(point.label) >= fromKey);

  if (!refuels.length && !expenses.length) {
    return pageWrap(`
      <div class="page-head"><div><h1>Статистика</h1><p>${U.esc(car.name)}</p></div></div>
      <section class="card"><div class="empty">
        <span class="empty__icon">${ic("chart")}</span>
        <h3>Статистики пока нет</h3>
        <p>Добавьте несколько заправок — и здесь появятся графики расходов и расхода топлива.</p>
        <button type="button" class="btn btn--primary" data-action="add">${ic("plus")} Добавить запись</button>
      </div></section>
    `);
  }

  const categories = S.categoryTotals(totals.expenses);
  const segments = [
    { label: "Топливо", value: totals.fuelCost, color: "var(--chart-bar)" },
    ...categories.map((item) => ({
      label: CAT[item.category]?.label || "Прочее",
      value: item.value,
      color: CAT[item.category]?.color || "#94a3b8",
    })),
  ].filter((segment) => segment.value > 0);

  const legendHtml = segments
    .map((segment) => {
      const percent = totals.totalCost ? Math.round((segment.value / totals.totalCost) * 100) : 0;
      return `<div class="legend__item">
        <span class="legend__dot" style="background:${segment.color}"></span>
        <span class="legend__name">${U.esc(segment.label)}</span>
        <span class="legend__value">${U.fmtMoney(segment.value)}</span>
        <span class="legend__pct">${percent}%</span>
      </div>`;
    })
    .join("");

  const tableHtml = months
    .slice()
    .reverse()
    .filter((month) => month.refuelCount || month.expenseCount)
    .map((month) => `<tr>
      <td>${U.monthLabel(month.key, { short: true })}</td>
      <td>${month.distance ? `${U.fmtNum(month.distance)} км` : "—"}</td>
      <td>${U.fmtMoney(month.fuelCost)}</td>
      <td>${U.fmtMoney(month.otherCost)}</td>
      <td><b>${U.fmtMoney(month.totalCost)}</b></td>
    </tr>`)
    .join("");

  return pageWrap(`
    <div class="toolbar">
      <span class="toolbar__label">Период</span>
      <div class="segmented" role="tablist" aria-label="Период">
        ${[3, 6, 12].map((value) => `<button type="button" class="segmented__btn ${state.statsRange === value ? "is-active" : ""}" data-range="${value}" role="tab" aria-selected="${state.statsRange === value}">${value} мес.</button>`).join("")}
      </div>
    </div>

    <div class="kpi-grid">
      <div class="card kpi">
        <div class="kpi__label">${ic("wallet")} Всего расходов</div>
        <div class="kpi__value">${U.fmtMoney(totals.totalCost)}</div>
        <div class="kpi__sub">${totals.refuelCount + totals.expenseCount} ${U.plural(totals.refuelCount + totals.expenseCount, ["запись", "записи", "записей"])}</div>
      </div>
      <div class="card kpi">
        <div class="kpi__label">${ic("fuel")} Топливо</div>
        <div class="kpi__value">${U.fmtMoney(totals.fuelCost)}</div>
        <div class="kpi__sub">${U.fmtNum(totals.liters, 1)} л · ${totals.avgPrice ? `${U.fmtNum(totals.avgPrice, 2)} ₽/л` : "—"}</div>
      </div>
      <div class="card kpi">
        <div class="kpi__label">${ic("sliders")} Другое</div>
        <div class="kpi__value">${U.fmtMoney(totals.otherCost)}</div>
        <div class="kpi__sub">${totals.expenseCount} ${U.plural(totals.expenseCount, ["расход", "расхода", "расходов"])}</div>
      </div>
      <div class="card kpi">
        <div class="kpi__label">${ic("gauge")} Средний расход</div>
        <div class="kpi__value">${totals.avgConsumption ? U.fmtNum(totals.avgConsumption, 1) : "—"}<small> л/100</small></div>
        <div class="kpi__sub">${U.fmtNum(totals.liters, 1)} л за период</div>
      </div>
    </div>

    <div class="stats-grid">
      <section class="card stats-card">
        <div class="card-head"><div><h2>Расходы по месяцам</h2><p>топливо и остальное</p></div></div>
        <div class="chart" data-chart="bars"></div>
      </section>

      <section class="card stats-card">
        <div class="card-head"><div><h2>Структура расходов</h2><p>за ${state.statsRange} мес.</p></div></div>
        <div class="donut-wrap">
          <div class="donut" data-chart="donut"></div>
          <div class="legend">${legendHtml}</div>
        </div>
      </section>
    </div>

    <section class="card stats-card">
      <div class="card-head"><div><h2>Расход топлива</h2><p>л / 100 км по заправкам</p></div></div>
      <div class="chart" data-chart="consumption"></div>
    </section>

    <section class="card stats-card">
      <div class="card-head"><div><h2>По месяцам</h2><p>пробег и суммы</p></div></div>
      <div class="table-wrap">
        <table class="stats-table">
          <thead><tr><th>Месяц</th><th>Пробег</th><th>Топливо</th><th>Прочее</th><th>Итого</th></tr></thead>
          <tbody>${tableHtml || `<tr><td colspan="5">Нет данных</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `);
}

/* ── Профиль ──────────────────────────────────────────────────────────── */

function viewProfile() {
  const name = state.profile?.name || "Пользователь";
  const email = state.profile?.email || "";
  const activeCar = currentCar();

  const carRows = state.cars
    .map((car) => `<div class="row">
      <span class="row__icon">${ic("car")}</span>
      <span class="row__body">
        <span class="row__title">${U.esc(car.name)} ${car.id === state.carId ? `<span class="badge badge--accent">активный</span>` : ""}</span>
        <span class="row__sub">${U.esc([car.make, car.plate].filter(Boolean).join(" · ") || "без деталей")}</span>
      </span>
      <span class="row__trailing">
        ${car.id === state.carId ? "" : `<button type="button" class="row__action" data-action="select-car" data-car-id="${U.esc(car.id)}" aria-label="Сделать активным">${ic("chevron-right")}</button>`}
        <button type="button" class="row__action" data-action="edit-car" data-car-id="${U.esc(car.id)}" aria-label="Изменить автомобиль">${ic("edit")}</button>
      </span>
    </div>`)
    .join("");

  return pageWrap(`
    <div class="card profile-hero">
      <span class="avatar avatar--lg" style="${U.avatarStyle(email || state.user?.uid)}">${U.esc(U.initials(name))}</span>
      <div class="profile-hero__info">
        <div class="profile-hero__name">${U.esc(name)} ${state.mode === "demo" ? `<span class="badge badge--warning">Демо</span>` : ""}</div>
        <div class="profile-hero__email">${U.esc(email || "без email")}</div>
        <div class="profile-hero__meta">${state.cars.length} ${U.plural(state.cars.length, ["автомобиль", "автомобиля", "автомобилей"])} · ${recordsCount()} ${U.plural(recordsCount(), ["запись", "записи", "записей"])}</div>
      </div>
      <button type="button" class="btn btn--soft btn--sm" data-action="edit-name">${ic("edit")} Изменить имя</button>
    </div>

    ${state.mode === "demo" ? `<div class="demo-banner">${ic("sparkles")}<div><b>Демо-режим</b><span>Данные хранятся только в этом браузере. Чтобы пользоваться с телефона и общаться с другими — подключите Firebase.</span></div></div>` : ""}

    <section class="card panel">
      <h2 class="panel__title">Автомобили</h2>
      ${carRows || `<p class="profile-note">Пока нет ни одного автомобиля.</p>`}
      <div class="panel__action">
        <button type="button" class="btn btn--soft btn--block" data-action="add-car">${ic("plus")} Добавить автомобиль</button>
      </div>
    </section>

    <section class="card panel">
      <h2 class="panel__title">Оформление</h2>
      <div class="row">
        <span class="row__icon">${ic(themePref === "dark" ? "moon" : themePref === "light" ? "sun" : "sliders")}</span>
        <span class="row__body">
          <span class="row__title">Тема интерфейса</span>
          <span class="row__sub">${themePref === "auto" ? "как в системе" : themePref === "dark" ? "тёмная" : "светлая"}</span>
        </span>
        <span class="row__trailing">
          <div class="segmented segmented--compact">
            <button type="button" class="segmented__btn ${themePref === "light" ? "is-active" : ""}" data-theme-set="light">Светлая</button>
            <button type="button" class="segmented__btn ${themePref === "dark" ? "is-active" : ""}" data-theme-set="dark">Тёмная</button>
            <button type="button" class="segmented__btn ${themePref === "auto" ? "is-active" : ""}" data-theme-set="auto">Авто</button>
          </div>
        </span>
      </div>
    </section>

    <section class="card panel">
      <h2 class="panel__title">Данные</h2>
      <div class="row">
        <span class="row__icon">${ic("download")}</span>
        <span class="row__body">
          <span class="row__title">Экспорт журнала</span>
          <span class="row__sub">Все заправки и расходы в JSON</span>
        </span>
        <span class="row__trailing">
          <button type="button" class="btn btn--soft btn--sm" data-action="export">Скачать</button>
        </span>
      </div>
      <p class="profile-note">Активный автомобиль: <b>${U.esc(activeCar?.name || "—")}</b>. Данные видны только вам.</p>
    </section>

    <section class="card panel">
      <h2 class="panel__title">О приложении</h2>
      <div class="row">
        <span class="row__icon">${ic("info")}</span>
        <span class="row__body"><span class="row__title">Автожурнал</span><span class="row__sub">Версия ${APP_VERSION} · PWA</span></span>
      </div>
      <div class="row">
        <span class="row__icon">${ic("chat")}</span>
        <span class="row__body"><span class="row__title">Общий чат</span><span class="row__sub">Советы и опыт других водителей</span></span>
        <span class="row__trailing"><a class="btn btn--soft btn--sm" href="#/chat">Открыть</a></span>
      </div>
    </section>

    <section class="card panel">
      <div class="row row--danger">
        <span class="row__icon">${ic("logout")}</span>
        <span class="row__body"><span class="row__title">Выйти из аккаунта</span><span class="row__sub">${state.mode === "demo" ? "выйти из демо-режима" : "на этом устройстве"}</span></span>
        <span class="row__trailing"><button type="button" class="btn btn--danger btn--sm" data-action="signout">Выйти</button></span>
      </div>
    </section>
  `);
}

/* ── Чат ──────────────────────────────────────────────────────────────── */

function renderChatPage() {
  const enter = state.enter;
  state.enter = false;
  $("#view").innerHTML = `<div class="page${enter ? " page--enter" : ""}">
    <div class="card chat">
      <div class="chat__head">
        <span class="chat__head-icon">${ic("chat")}</span>
        <div class="chat__head-text">
          <h2>Общий чат</h2>
          <p>Все пользователи приложения</p>
        </div>
        <span class="badge badge--accent chat__head-badge" id="chat-count">${state.chat.length} ${U.plural(state.chat.length, ["сообщение", "сообщения", "сообщений"])}</span>
      </div>
      <div class="chat__list" id="chat-list"></div>
      <form class="chat__composer" id="chat-form">
        <textarea class="chat__input" id="chat-input" rows="1" maxlength="500" placeholder="Напишите сообщение…" aria-label="Сообщение"></textarea>
        <button type="submit" class="chat__send" id="chat-send" aria-label="Отправить сообщение" disabled>${ic("send")}</button>
      </form>
    </div>
  </div>`;

  renderChatMessages(true);
  bindChatForm();
}

function renderChatMessages(initial = false) {
  const list = $("#chat-list");
  if (!list) return;

  if (!state.chat.length) {
    const count = $("#chat-count");
    if (count) count.textContent = "0 сообщений";
    list.innerHTML = `<div class="empty">
      <span class="empty__icon">${ic("chat")}</span>
      <h3>Сообщений пока нет</h3>
      <p>Напишите первым — расскажите о своём опыте или спросите совет.</p>
    </div>`;
    return;
  }

  const nearBottom = initial || list.scrollHeight - list.scrollTop - list.clientHeight < 90;

  let html = "";
  let lastDay = null;
  for (const message of state.chat) {
    const timestamp = message.createdAt || Date.now();
    const iso = U.todayISO(new Date(timestamp));
    if (iso !== lastDay) {
      html += `<div class="chat__day">${U.relativeDay(iso)}</div>`;
      lastDay = iso;
    }
    const own = message.uid === state.user?.uid;
    html += `<div class="msg ${own ? "msg--own" : ""}">
      ${own ? "" : `<span class="avatar msg__avatar" style="${U.avatarStyle(message.uid || message.name)}">${U.esc(U.initials(message.name))}</span>`}
      <div class="msg__content">
        <div class="msg__meta"><b>${U.esc(own ? "Вы" : message.name || "Водитель")}</b><span>${U.fmtTime(timestamp)}</span></div>
        <div class="msg__bubble">${U.esc(message.text)}</div>
      </div>
    </div>`;
  }

  list.innerHTML = html;
  const count = $("#chat-count");
  if (count) count.textContent = `${state.chat.length} ${U.plural(state.chat.length, ["сообщение", "сообщения", "сообщений"])}`;

  if (nearBottom) list.scrollTop = list.scrollHeight;
}

function onChatUpdate() {
  if (state.view !== "chat") return;
  if (!$("#chat-list")) renderChatPage();
  else renderChatMessages();
}

function bindChatForm() {
  const form = $("#chat-form");
  if (!form) return;
  const input = $("#chat-input");
  const send = $("#chat-send");

  const refresh = () => {
    send.disabled = !input.value.trim() || state.sendingChat;
  };

  const autoGrow = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };

  input.addEventListener("input", () => {
    autoGrow();
    refresh();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || state.sendingChat) return;
    state.sendingChat = true;
    refresh();
    try {
      await state.api.sendMessage(text, state.profile?.name || "Водитель");
      input.value = "";
      autoGrow();
      input.focus();
    } catch (error) {
      console.error(error);
      toast("Не удалось отправить сообщение", "error");
    } finally {
      state.sendingChat = false;
      refresh();
    }
  });

  refresh();
}

/* ── Графики ──────────────────────────────────────────────────────────── */

function mountCharts() {
  if (state.view === "home") {
    const refuels = carRefuels();
    const series = S.consumptionSeries(refuels, 10);

    const hero = $('[data-chart="hero"]');
    if (hero) {
      lineChart(hero, series, {
        height: 134,
        sparkline: true,
        color: "#8ff0c6",
        emptyText: "Добавьте две заправки — покажем динамику",
      });
    }

    const chart = $('[data-chart="consumption"]');
    if (chart) {
      lineChart(chart, series, {
        height: 232,
        emptyText: "Нужно минимум две заправки до полного бака",
      });
    }
  }

  if (state.view === "stats") {
    const refuels = carRefuels();
    const expenses = carExpenses();
    const endKey = U.monthKey(U.todayISO());
    const months = S.monthlySeries(refuels, expenses, endKey, state.statsRange);
    const fromKey = months[0].key;
    const totals = S.rangeStats(refuels, expenses, fromKey, endKey);
    const consumption = S.consumptionSeries(refuels, 60).filter((point) => U.monthKey(point.label) >= fromKey);

    const bars = $('[data-chart="bars"]');
    if (bars) {
      barChart(
        bars,
        months.map((month) => ({
          label: U.monthLabel(month.key, { short: true }).split(" ")[0],
          fuel: month.fuelCost,
          other: month.otherCost,
        })),
        { height: 246, emptyText: "За этот период расходов нет" }
      );
    }

    const donut = $('[data-chart="donut"]');
    if (donut) {
      const categories = S.categoryTotals(totals.expenses);
      const segments = [
        { label: "Топливо", value: totals.fuelCost, color: "var(--chart-bar)" },
        ...categories.map((item) => ({ label: CAT[item.category]?.label, value: item.value, color: CAT[item.category]?.color })),
      ];
      donutChart(donut, segments, { totalLabel: "Всего за период" });
    }

    const chart = $('[data-chart="consumption"]');
    if (chart) {
      lineChart(chart, consumption, {
        height: 230,
        emptyText: "Пока нет заправок до полного бака",
      });
    }
  }
}

/* ── Модальные окна ───────────────────────────────────────────────────── */

const modalStack = [];

function openModal(html, { size = "", focus = true, onClose } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "modal";
  if (modalStack.length) wrapper.classList.add("modal--stacked");
  wrapper.innerHTML = `<div class="modal__backdrop" data-modal-close></div>
    <div class="modal__panel ${size}">${html}</div>`;
  $("#modal-root").append(wrapper);
  modalStack.push(wrapper);
  document.body.classList.add("no-scroll");

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrapper.remove();
    const index = modalStack.indexOf(wrapper);
    if (index >= 0) modalStack.splice(index, 1);
    if (!modalStack.length) document.body.classList.remove("no-scroll");
    if (onClose) onClose();
  };
  wrapper.__close = close;

  wrapper.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) close();
  });

  if (focus) {
    requestAnimationFrame(() => {
      const target = wrapper.querySelector("input:not([type=hidden]), select, textarea, button.btn--primary");
      target?.focus({ preventScroll: true });
    });
  }

  return { close, wrapper, panel: wrapper.querySelector(".modal__panel") };
}

function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top?.__close) top.__close();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalStack.length) {
    event.preventDefault();
    closeTopModal();
  }
});

function confirmDialog({ title, text, confirmText = "Удалить", cancelText = "Отмена", danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const { close, panel } = openModal(
      `<div class="modal__head">
        <div><h2 class="modal__title">${U.esc(title)}</h2></div>
        <button type="button" class="modal__close" data-modal-close aria-label="Закрыть">${ic("x")}</button>
      </div>
      <div class="modal__body"><p class="confirm-text">${U.esc(text)}</p></div>
      <div class="modal__foot">
        <button type="button" class="btn btn--soft" data-cancel>${U.esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? "btn--danger" : "btn--primary"}" data-confirm>${U.esc(confirmText)}</button>
      </div>`,
      {
        size: "modal__panel--sm",
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      }
    );

    panel.querySelector("[data-cancel]").addEventListener("click", () => {
      settled = true;
      close();
      resolve(false);
    });
    panel.querySelector("[data-confirm]").addEventListener("click", () => {
      settled = true;
      close();
      resolve(true);
    });
  });
}

function toast(message, type = "success") {
  const root = $("#toast-root");
  const element = document.createElement("div");
  element.className = `toast toast--${type}`;
  element.innerHTML = `${ic(type === "error" ? "info" : "check")}<span>${U.esc(message)}</span>`;
  root.append(element);
  setTimeout(() => {
    element.classList.add("is-hiding");
    setTimeout(() => element.remove(), 220);
  }, 3200);
}

/* ── Форма записи ─────────────────────────────────────────────────────── */

function openRecordModal({ kind = "refuel", record = null } = {}) {
  const car = currentCar();
  if (!car) {
    openCarModal();
    return;
  }

  const isEdit = Boolean(record);
  let type = record?.kind || kind;

  const carRefuelList = state.refuels.filter((row) => row.carId === state.carId);
  const previous = S.latestRefuel(carRefuelList);
  const lastOdometer = S.maxOdometer(carRefuelList);
  const stations = [...new Set(state.refuels.map((row) => row.station).filter(Boolean))];

  const refuel = type === "refuel" ? record : null;
  const expense = type === "expense" ? record : null;

  const value = (input) => (input == null ? "" : U.esc(String(input)));
  const today = U.todayISO();

  const refuelPanel = `
    <div class="form-grid" data-panel="refuel" ${type !== "refuel" ? "hidden" : ""}>
      <div class="field">
        <label class="field__label" for="rf-date">Дата</label>
        <input class="input" type="date" id="rf-date" value="${value(refuel?.date || today)}" max="${today}" required>
      </div>
      <div class="field">
        <label class="field__label" for="rf-odometer">Одометр, км</label>
        <input class="input" type="number" inputmode="numeric" min="0" step="1" id="rf-odometer" value="${value(refuel?.odometer)}" placeholder="${lastOdometer ? U.fmtNum(lastOdometer) : "например, 52 400"}" required>
      </div>
      <div class="field">
        <label class="field__label" for="rf-liters">Литры</label>
        <input class="input" type="number" inputmode="decimal" min="0" step="0.01" id="rf-liters" value="${value(refuel?.liters)}" placeholder="42,5" required>
      </div>
      <div class="field">
        <label class="field__label" for="rf-price">Цена за литр, ₽</label>
        <input class="input" type="number" inputmode="decimal" min="0" step="0.01" id="rf-price" value="${value(refuel?.pricePerLiter || previous?.pricePerLiter)}" placeholder="59,90" required>
      </div>
      <div class="field field--full">
        <label class="field__label" for="rf-total">Сумма, ₽</label>
        <input class="input" type="number" inputmode="decimal" min="0" step="0.01" id="rf-total" value="${value(refuel?.total)}" placeholder="2 546" required>
        <span class="field__hint">Посчитается автоматически из литров и цены</span>
      </div>
      <div class="field">
        <label class="field__label" for="rf-station">АЗС</label>
        <input class="input" type="text" id="rf-station" value="${value(refuel?.station)}" placeholder="Лукойл" maxlength="40" list="stations-list">
        <datalist id="stations-list">${stations.map((station) => `<option value="${U.esc(station)}"></option>`).join("")}</datalist>
      </div>
      <div class="field">
        <label class="field__label" for="rf-fuel">Топливо</label>
        <select class="select" id="rf-fuel">
          ${FUEL_TYPES.map((fuel) => `<option value="${fuel}" ${((refuel?.fuelType || previous?.fuelType) === fuel) ? "selected" : ""}>${fuel}</option>`).join("")}
        </select>
      </div>
      <div class="field field--full">
        <label class="switch">
          <input type="checkbox" id="rf-full" ${refuel ? (refuel.fullTank ? "checked" : "") : "checked"}>
          <span class="switch__text">Заправка до полного бака<small>Нужна для точного расчёта расхода</small></span>
          <span class="switch__track"></span>
        </label>
      </div>
      <div class="field field--full">
        <label class="field__label" for="rf-note">Заметка</label>
        <textarea class="textarea" id="rf-note" rows="2" maxlength="200" placeholder="Например, заправка перед поездкой">${value(refuel?.note)}</textarea>
      </div>
      <div class="field field--full">
        <div class="calc-preview calc-preview--muted" id="rf-preview" hidden></div>
      </div>
    </div>`;

  const expensePanel = `
    <div class="form-stack" data-panel="expense" ${type !== "expense" ? "hidden" : ""}>
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="ex-date">Дата</label>
          <input class="input" type="date" id="ex-date" value="${value(expense?.date || today)}" max="${today}" required>
        </div>
        <div class="field">
          <label class="field__label" for="ex-category">Категория</label>
          <select class="select" id="ex-category">
            ${CATEGORIES.map((item) => `<option value="${item.id}" ${((expense?.category || "to") === item.id) ? "selected" : ""}>${item.label}</option>`).join("")}
          </select>
        </div>
        <div class="field field--full">
          <label class="field__label" for="ex-amount">Сумма, ₽</label>
          <input class="input" type="number" inputmode="decimal" min="0" step="0.01" id="ex-amount" value="${value(expense?.amount)}" placeholder="3 200" required>
        </div>
        <div class="field field--full">
          <label class="field__label" for="ex-note">Комментарий</label>
          <textarea class="textarea" id="ex-note" rows="2" maxlength="200" placeholder="Например, замена масла">${value(expense?.note)}</textarea>
        </div>
      </div>
    </div>`;

  const title = isEdit
    ? type === "refuel" ? "Изменить заправку" : "Изменить расход"
    : "Новая запись";

  const html = `
    <form id="record-form" novalidate>
      <div class="modal__head">
        <div>
          <h2 class="modal__title">${title}</h2>
          <p class="modal__sub">${U.esc(car.name)}</p>
        </div>
        <button type="button" class="modal__close" data-modal-close aria-label="Закрыть">${ic("x")}</button>
      </div>
      <div class="modal__body">
        ${isEdit ? "" : `<div class="segmented segmented--full type-toggle">
          <button type="button" class="segmented__btn ${type === "refuel" ? "is-active" : ""}" data-record-type="refuel">${ic("fuel")} Заправка</button>
          <button type="button" class="segmented__btn ${type === "expense" ? "is-active" : ""}" data-record-type="expense">${ic("wallet")} Расход</button>
        </div>`}
        ${refuelPanel}
        ${expensePanel}
      </div>
      <div class="modal__foot">
        ${isEdit ? `<button type="button" class="btn btn--danger" data-delete-record>Удалить</button>` : ""}
        <button type="button" class="btn btn--soft" data-modal-close>Отмена</button>
        <button type="submit" class="btn btn--primary" id="record-submit">Сохранить</button>
      </div>
    </form>`;

  const { panel, close } = openModal(html, { focus: false });
  const form = panel.querySelector("#record-form");
  const preview = panel.querySelector("#rf-preview");

  const litersInput = panel.querySelector("#rf-liters");
  const priceInput = panel.querySelector("#rf-price");
  const totalInput = panel.querySelector("#rf-total");
  const odometerInput = panel.querySelector("#rf-odometer");
  const dateInput = panel.querySelector("#rf-date");
  const fullInput = panel.querySelector("#rf-full");

  function updatePreview() {
    if (!preview) return;
    const liters = U.parseNum(litersInput.value);
    const odometer = U.parseNum(odometerInput.value);
    if (!liters || !odometer) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    if (!fullInput.checked) {
      preview.className = "calc-preview calc-preview--muted";
      preview.innerHTML = `${ic("info")} Отметьте «полный бак», чтобы рассчитать расход.`;
      return;
    }
    const result = S.previewConsumption(carRefuelList, {
      id: record?.id,
      carId: state.carId,
      date: dateInput.value,
      odometer,
      liters,
      fullTank: true,
    });
    if (result?.consumption) {
      preview.className = "calc-preview";
      preview.innerHTML = `${ic("gauge")} Расход: <b>${U.fmtNum(result.consumption, 1)} л/100 км</b><span>· ${U.fmtNum(result.distance)} км</span>`;
    } else {
      preview.className = "calc-preview calc-preview--muted";
      preview.innerHTML = `${ic("info")} Расход появится после второй заправки до полного бака.`;
    }
  }

  function syncTotal(source) {
    const liters = U.parseNum(litersInput.value);
    const price = U.parseNum(priceInput.value);
    if (source === "total") {
      const total = U.parseNum(totalInput.value);
      if (liters > 0 && total > 0) priceInput.value = String(U.round(total / liters, 2));
    } else if (liters > 0 && price > 0) {
      totalInput.value = String(U.round(liters * price, 2));
    }
    updatePreview();
  }

  ["input", "change"].forEach((eventName) => {
    litersInput.addEventListener(eventName, () => syncTotal("liters"));
    priceInput.addEventListener(eventName, () => syncTotal("price"));
    totalInput.addEventListener(eventName, () => syncTotal("total"));
    odometerInput.addEventListener(eventName, updatePreview);
    dateInput.addEventListener(eventName, updatePreview);
    fullInput.addEventListener("change", updatePreview);
  });

  panel.querySelectorAll("[data-record-type]").forEach((button) => {
    button.addEventListener("click", () => {
      type = button.dataset.recordType;
      panel.querySelectorAll("[data-record-type]").forEach((item) => item.classList.toggle("is-active", item === button));
      panel.querySelectorAll("[data-panel]").forEach((item) => {
        item.hidden = item.dataset.panel !== type;
      });
      updatePreview();
    });
  });

  const clearErrors = () => {
    form.querySelectorAll(".field--error").forEach((field) => field.classList.remove("field--error"));
    form.querySelectorAll(".field__error").forEach((element) => element.remove());
  };

  const setError = (input, message) => {
    const field = input.closest(".field");
    if (!field) return;
    field.classList.add("field--error");
    const error = document.createElement("span");
    error.className = "field__error";
    error.textContent = message;
    field.append(error);
    input.focus({ preventScroll: false });
  };

  form.addEventListener("input", (event) => {
    const field = event.target.closest(".field");
    if (field?.classList.contains("field--error")) {
      field.classList.remove("field--error");
      field.querySelector(".field__error")?.remove();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();
    const submit = panel.querySelector("#record-submit");

    if (type === "refuel") {
      const date = dateInput.value;
      const odometer = U.parseNum(odometerInput.value);
      const liters = U.parseNum(litersInput.value);
      const price = U.parseNum(priceInput.value);
      const total = U.parseNum(totalInput.value);

      if (!date) return setError(dateInput, "Укажите дату");
      if (!odometer) return setError(odometerInput, "Укажите показания одометра");
      if (!liters) return setError(litersInput, "Укажите количество литров");
      if (!price) return setError(priceInput, "Укажите цену за литр");
      if (!total) return setError(totalInput, "Укажите сумму");

      const payload = {
        carId: state.carId,
        date,
        odometer: Math.round(odometer),
        liters: U.round(liters, 2),
        pricePerLiter: U.round(price, 2),
        total: U.round(total, 2),
        station: panel.querySelector("#rf-station").value.trim(),
        fuelType: panel.querySelector("#rf-fuel").value,
        fullTank: fullInput.checked,
        note: panel.querySelector("#rf-note").value.trim(),
      };

      submit.disabled = true;
      try {
        if (isEdit) await state.api.updateRefuel(record.id, payload);
        else await state.api.addRefuel(payload);
        close();
        toast(isEdit ? "Заправка обновлена" : "Заправка добавлена");
      } catch (error) {
        console.error(error);
        toast("Не удалось сохранить заправку", "error");
        submit.disabled = false;
      }
      return;
    }

    const dateInputExpense = panel.querySelector("#ex-date");
    const amountInput = panel.querySelector("#ex-amount");
    const date = dateInputExpense.value;
    const amount = U.parseNum(amountInput.value);

    if (!date) return setError(dateInputExpense, "Укажите дату");
    if (!amount) return setError(amountInput, "Укажите сумму");

    const payload = {
      carId: state.carId,
      date,
      category: panel.querySelector("#ex-category").value,
      amount: U.round(amount, 2),
      note: panel.querySelector("#ex-note").value.trim(),
    };

    submit.disabled = true;
    try {
      if (isEdit) await state.api.updateExpense(record.id, payload);
      else await state.api.addExpense(payload);
      close();
      toast(isEdit ? "Расход обновлён" : "Расход добавлен");
    } catch (error) {
      console.error(error);
      toast("Не удалось сохранить расход", "error");
      submit.disabled = false;
    }
  });

  const deleteButton = panel.querySelector("[data-delete-record]");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: type === "refuel" ? "Удалить заправку?" : "Удалить расход?",
        text: "Запись будет удалена без возможности восстановления.",
        confirmText: "Удалить",
      });
      if (!confirmed) return;
      try {
        if (type === "refuel") await state.api.deleteRefuel(record.id);
        else await state.api.deleteExpense(record.id);
        close();
        toast("Запись удалена");
      } catch (error) {
        console.error(error);
        toast("Не удалось удалить запись", "error");
      }
    });
  }

  if (previous?.pricePerLiter && !isEdit) {
    syncTotal("liters");
  }
  updatePreview();
}

/* ── Автомобили и профиль ─────────────────────────────────────────────── */

function openCarModal({ car = null } = {}) {
  const isEdit = Boolean(car);
  const html = `
    <form id="car-form" novalidate>
      <div class="modal__head">
        <div><h2 class="modal__title">${isEdit ? "Автомобиль" : "Новый автомобиль"}</h2><p class="modal__sub">Название видно только вам</p></div>
        <button type="button" class="modal__close" data-modal-close aria-label="Закрыть">${ic("x")}</button>
      </div>
      <div class="modal__body">
        <div class="form-stack">
          <div class="field">
            <label class="field__label" for="car-name">Название</label>
            <input class="input" id="car-name" value="${U.esc(car?.name || "")}" placeholder="Моя машина" maxlength="40" required>
          </div>
          <div class="field">
            <label class="field__label" for="car-make">Марка и модель</label>
            <input class="input" id="car-make" value="${U.esc(car?.make || "")}" placeholder="Skoda Octavia 1.4 TSI" maxlength="60">
          </div>
          <div class="field">
            <label class="field__label" for="car-plate">Госномер</label>
            <input class="input" id="car-plate" value="${U.esc(car?.plate || "")}" placeholder="А 123 ВС 54" maxlength="20">
          </div>
        </div>
      </div>
      <div class="modal__foot">
        ${isEdit && state.cars.length > 1 ? `<button type="button" class="btn btn--danger" data-delete-car>Удалить</button>` : ""}
        <button type="button" class="btn btn--soft" data-modal-close>Отмена</button>
        <button type="submit" class="btn btn--primary">${isEdit ? "Сохранить" : "Добавить"}</button>
      </div>
    </form>`;

  const { panel, close } = openModal(html);
  const form = panel.querySelector("#car-form");
  const nameInput = panel.querySelector("#car-name");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.closest(".field").classList.add("field--error");
      nameInput.focus();
      return;
    }
    const payload = {
      name,
      make: panel.querySelector("#car-make").value.trim(),
      plate: panel.querySelector("#car-plate").value.trim(),
    };
    try {
      if (isEdit) {
        await state.api.updateCar(car.id, payload);
        close();
        toast("Автомобиль обновлён");
      } else {
        const id = await state.api.addCar(payload);
        close();
        toast("Автомобиль добавлен");
        if (id) selectCar(id);
      }
    } catch (error) {
      console.error(error);
      toast("Не удалось сохранить автомобиль", "error");
    }
  });

  const deleteButton = panel.querySelector("[data-delete-car]");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Удалить автомобиль?",
        text: "Вместе с ним удалятся все его заправки и расходы.",
        confirmText: "Удалить",
      });
      if (!confirmed) return;
      try {
        await state.api.deleteCar(car.id);
        close();
        toast("Автомобиль удалён");
      } catch (error) {
        console.error(error);
        toast("Не удалось удалить автомобиль", "error");
      }
    });
  }
}

function openNameModal() {
  const html = `
    <form id="name-form">
      <div class="modal__head">
        <div><h2 class="modal__title">Как вас зовут?</h2></div>
        <button type="button" class="modal__close" data-modal-close aria-label="Закрыть">${ic("x")}</button>
      </div>
      <div class="modal__body">
        <div class="field">
          <label class="field__label" for="profile-name">Имя</label>
          <input class="input" id="profile-name" value="${U.esc(state.profile?.name || "")}" maxlength="40" placeholder="Иван" required>
        </div>
        <p class="profile-note">Имя подставляется в приветствие и в общий чат.</p>
      </div>
      <div class="modal__foot">
        <button type="button" class="btn btn--soft" data-modal-close>Отмена</button>
        <button type="submit" class="btn btn--primary">Сохранить</button>
      </div>
    </form>`;

  const { panel, close } = openModal(html);
  panel.querySelector("#name-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = panel.querySelector("#profile-name");
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    try {
      await state.api.updateProfile({ name });
      state.profile = { ...state.profile, name };
      close();
      toast("Имя обновлено");
      render();
    } catch (error) {
      console.error(error);
      toast("Не удалось обновить имя", "error");
    }
  });
}

function openForgotPassword() {
  const email = $("#login-email")?.value.trim() || "";
  const html = `
    <form id="forgot-form">
      <div class="modal__head">
        <div><h2 class="modal__title">Восстановление пароля</h2><p class="modal__sub">Пришлём ссылку на email</p></div>
        <button type="button" class="modal__close" data-modal-close aria-label="Закрыть">${ic("x")}</button>
      </div>
      <div class="modal__body">
        <div class="field">
          <label class="field__label" for="forgot-email">Email</label>
          <div class="input-icon">${ic("mail")}<input class="input" id="forgot-email" type="email" value="${U.esc(email)}" placeholder="you@example.com" required></div>
        </div>
      </div>
      <div class="modal__foot">
        <button type="button" class="btn btn--soft" data-modal-close>Отмена</button>
        <button type="submit" class="btn btn--primary">Отправить ссылку</button>
      </div>
    </form>`;

  const { panel, close } = openModal(html);
  panel.querySelector("#forgot-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = panel.querySelector("#forgot-email");
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    const button = panel.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await state.api.resetPassword(value);
      close();
      toast("Письмо отправлено. Проверьте почту.");
    } catch (error) {
      console.error(error);
      button.disabled = false;
      toast("Не удалось отправить письмо", "error");
    }
  });
}

/* ── Экспорт ──────────────────────────────────────────────────────────── */

function exportData() {
  const payload = {
    app: "Автожурнал",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    cars: state.cars,
    refuels: state.refuels,
    expenses: state.expenses,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `avtozhurnal-${U.todayISO()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Файл с данными скачан");
}

/* ── Выход ────────────────────────────────────────────────────────────── */

async function doSignOut() {
  const confirmed = await confirmDialog({
    title: "Выйти из аккаунта?",
    text: state.mode === "demo"
      ? "Вы выйдете из демо-режима. Данные останутся в этом браузере."
      : "Данные сохранятся — войти можно будет снова с тем же email.",
    confirmText: "Выйти",
  });
  if (!confirmed) return;

  if (state.mode === "demo") {
    try {
      await state.api.signOut();
    } catch (error) {
      console.error(error);
    }
    const url = new URL(location.href);
    url.searchParams.delete("demo");
    url.hash = "";
    location.href = url.toString();
    return;
  }

  try {
    await state.api.signOut();
  } catch (error) {
    console.error(error);
    toast("Не удалось выйти", "error");
  }
}

/* ── Авторизация ──────────────────────────────────────────────────────── */

function bindAuth() {
  $$("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => switchAuthTab(button.dataset.authTab));
  });

  $("#login-form").addEventListener("submit", onLogin);
  $("#signup-form").addEventListener("submit", onSignup);

  $$("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.setAttribute("aria-label", visible ? "Показать пароль" : "Скрыть пароль");
      button.innerHTML = ic(visible ? "eye" : "eye-off");
    });
  });

  $("#demo-btn").addEventListener("click", enterDemo);
  $("#setup-demo-btn").addEventListener("click", enterDemo);
  $("#forgot-btn").addEventListener("click", openForgotPassword);

  $$("#login-form input, #signup-form input").forEach((input) => {
    input.addEventListener("input", hideAuthError);
  });
}

function switchAuthTab(tab) {
  $$("[data-auth-tab]").forEach((button) => {
    const active = button.dataset.authTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  $("#login-form").hidden = tab !== "login";
  $("#signup-form").hidden = tab !== "signup";
  $("#auth-title").textContent = tab === "login" ? "С возвращением" : "Создайте аккаунт";
  $("#auth-sub").textContent = tab === "login"
    ? "Войдите, чтобы продолжить вести журнал."
    : "Пара минут — и журнал готов.";
  hideAuthError();
}

function showAuthError(message) {
  const box = $("#auth-error");
  box.textContent = message;
  box.hidden = false;
}

function hideAuthError() {
  const box = $("#auth-error");
  box.hidden = true;
}

function setAuthBusy(button, busy) {
  button.disabled = busy;
  const spinner = button.querySelector(".btn__spinner");
  if (spinner) spinner.hidden = !busy;
}

function authErrorMessage(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/invalid-login-credentials": "Неверный email или пароль.",
    "auth/user-not-found": "Аккаунт с таким email не найден.",
    "auth/wrong-password": "Неверный пароль.",
    "auth/email-already-in-use": "Этот email уже зарегистрирован — попробуйте войти.",
    "auth/weak-password": "Слишком простой пароль: минимум 6 символов.",
    "auth/invalid-email": "Проверьте формат email.",
    "auth/too-many-requests": "Слишком много попыток. Подождите пару минут.",
    "auth/network-request-failed": "Нет связи с сервером. Проверьте интернет.",
    "auth/operation-not-allowed": "В Firebase не включён вход по email и паролю.",
    "auth/unauthorized-domain": "Домен сайта не добавлен в Authorized domains Firebase.",
    "auth/user-disabled": "Этот аккаунт отключён.",
  };
  return messages[code] || "Не удалось выполнить вход. Проверьте данные и попробуйте ещё раз.";
}

async function onLogin(event) {
  event.preventDefault();
  if (!state.api) return;
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  if (!email || !password) {
    showAuthError("Введите email и пароль.");
    return;
  }
  const button = $("#login-submit");
  hideAuthError();
  setAuthBusy(button, true);
  try {
    await state.api.signIn({ email, password });
  } catch (error) {
    console.error(error);
    showAuthError(authErrorMessage(error));
  } finally {
    setAuthBusy(button, false);
  }
}

async function onSignup(event) {
  event.preventDefault();
  if (!state.api) return;
  const name = $("#signup-name").value.trim();
  const email = $("#signup-email").value.trim();
  const password = $("#signup-password").value;

  if (!name) return showAuthError("Укажите имя.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAuthError("Проверьте формат email.");
  if (password.length < 6) return showAuthError("Пароль должен быть не короче 6 символов.");

  const button = $("#signup-submit");
  hideAuthError();
  setAuthBusy(button, true);
  try {
    await state.api.signUp({ name, email, password });
  } catch (error) {
    console.error(error);
    showAuthError(authErrorMessage(error));
  } finally {
    setAuthBusy(button, false);
  }
}

function enterDemo() {
  const url = new URL(location.href);
  url.searchParams.set("demo", "1");
  url.hash = "";
  location.href = url.toString();
}

/* ── Делегирование событий ────────────────────────────────────────────── */

function bindDelegates() {
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#car-picker")) closeCarPicker();

    const actionElement = event.target.closest("[data-action]");
    if (actionElement) {
      event.preventDefault();
      handleAction(actionElement.dataset.action, actionElement);
      return;
    }

    const themeButton = event.target.closest("[data-theme-set]");
    if (themeButton) {
      applyTheme(themeButton.dataset.themeSet, true);
      render();
      return;
    }

    const journalTab = event.target.closest("[data-journal-tab]");
    if (journalTab) {
      state.journalTab = journalTab.dataset.journalTab;
      render();
      return;
    }

    const monthStep = event.target.closest("[data-month-step]");
    if (monthStep) {
      const step = Number(monthStep.dataset.monthStep);
      const next = U.addMonths(state.month, step);
      if (step > 0 && next > U.monthKey(U.todayISO())) return;
      state.month = next;
      render();
      return;
    }

    const rangeButton = event.target.closest("[data-range]");
    if (rangeButton) {
      state.statsRange = Number(rangeButton.dataset.range);
      render();
      return;
    }

    const carButton = event.target.closest("[data-car-id]");
    if (carButton) {
      selectCar(carButton.dataset.carId);
      return;
    }

    const recordButton = event.target.closest("[data-kind][data-id]");
    if (recordButton) {
      const kind = recordButton.dataset.kind;
      const source = kind === "refuel" ? state.refuels : state.expenses;
      const record = source.find((row) => row.id === recordButton.dataset.id);
      if (record) openRecordModal({ kind, record: { ...record, kind } });
      return;
    }
  });

  $("#car-picker-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCarPicker();
  });
}

function handleAction(action, element) {
  switch (action) {
    case "add":
      openRecordModal({ kind: "refuel" });
      break;
    case "add-car":
      closeCarPicker();
      openCarModal();
      break;
    case "edit-car": {
      const car = state.cars.find((row) => row.id === element.dataset.carId);
      if (car) openCarModal({ car });
      break;
    }
    case "select-car":
      selectCar(element.dataset.carId);
      break;
    case "edit-name":
      openNameModal();
      break;
    case "export":
      exportData();
      break;
    case "signout":
      doSignOut();
      break;
    case "stats":
      location.hash = "#/stats";
      break;
    case "profile":
      location.hash = "#/profile";
      break;
    default:
      break;
  }
}

function toggleCarPicker() {
  const pop = $("#car-picker-pop");
  const button = $("#car-picker-btn");
  const willOpen = pop.hidden;
  pop.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function closeCarPicker() {
  const pop = $("#car-picker-pop");
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  $("#car-picker-btn")?.setAttribute("aria-expanded", "false");
}

/* ── Service worker ───────────────────────────────────────────────────── */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const local = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!local) return;

  const register = () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker не зарегистрирован:", error);
    });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/* ── Поехали ──────────────────────────────────────────────────────────── */

start().catch((error) => {
  console.error(error);
  showSetup(error?.message);
});
