/* Демо-бэкенд: всё хранится в localStorage браузера, без сервера. */

import { round, uid } from "./utils.js";

const DATA_KEY = "az.demo.data.v1";
const SESSION_KEY = "az.demo.session.v1";

const listeners = {
  auth: new Set(),
  cars: new Set(),
  refuels: new Set(),
  expenses: new Set(),
  chat: new Set(),
};

let memory = null;
let session = readSession();
let channel = null;

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим — работаем в памяти */
  }
}

function readSession() {
  const raw = safeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSession(value) {
  if (value) safeSet(SESSION_KEY, JSON.stringify(value));
  else {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function jitter(amount) {
  return (Math.random() * 2 - 1) * amount;
}

function makeRefuel({ id, carId, date, odometer, liters, price, station, fuelType, fullTank, note = "" }) {
  return {
    id,
    carId,
    date,
    odometer: Math.round(odometer),
    liters: round(liters, 1),
    pricePerLiter: round(price, 2),
    total: round(liters * price, 2),
    station,
    fuelType,
    fullTank: Boolean(fullTank),
    note,
    createdAt: new Date(`${date}T12:00:00`).getTime(),
  };
}

function seed() {
  const stations = ["Лукойл", "Газпромнефть", "Роснефть", "Татнефть", "Shell"];
  const refuels = [];
  let seq = 0;

  // Автомобиль 1 — Skoda Octavia, ~7,2 л/100 км
  let odo1 = 48120;
  for (let i = 0; i < 21; i++) {
    const day = 151 - i * 7;
    if (day < 3) break;
    const consumption = 7.15 + Math.sin(i / 2.4) * 0.35 + jitter(0.12);
    const distance = 480 + jitter(70);
    const liters = round((distance * consumption) / 100 + jitter(1.6), 1);
    const price = round(62.3 - day * 0.028 + jitter(0.45), 2);
    odo1 += distance;
    refuels.push(
      makeRefuel({
        id: `rf-${++seq}`,
        carId: "car-octavia",
        date: isoDaysAgo(day),
        odometer: odo1,
        liters,
        price,
        station: stations[i % stations.length],
        fuelType: "АИ-95",
        fullTank: true,
      })
    );

    if (i % 6 === 2 && day - 3 > 2) {
      const partialDistance = 165 + jitter(35);
      const partialLiters = round((partialDistance * consumption) / 100, 1);
      odo1 += partialDistance;
      refuels.push(
        makeRefuel({
          id: `rf-${++seq}`,
          carId: "car-octavia",
          date: isoDaysAgo(day - 3),
          odometer: odo1,
          liters: partialLiters,
          price: round(price + 0.1, 2),
          station: stations[(i + 2) % stations.length],
          fuelType: "АИ-95",
          fullTank: false,
          note: "Долил до поездки",
        })
      );
    }
  }

  // Автомобиль 2 — Lada Vesta, ~8,4 л/100 км
  let odo2 = 21450;
  for (let i = 0; i < 12; i++) {
    const day = 146 - i * 13;
    if (day < 4) break;
    const consumption = 8.35 + Math.cos(i / 2) * 0.3 + jitter(0.15);
    const distance = 520 + jitter(80);
    const liters = round((distance * consumption) / 100 + jitter(1.4), 1);
    const price = round(61.9 - day * 0.025 + jitter(0.4), 2);
    odo2 += distance;
    refuels.push(
      makeRefuel({
        id: `rf-${++seq}`,
        carId: "car-vesta",
        date: isoDaysAgo(day),
        odometer: odo2,
        liters,
        price,
        station: stations[(i + 1) % stations.length],
        fuelType: "АИ-92",
        fullTank: true,
      })
    );
  }

  const expenses = [
    { id: "ex-1", carId: "car-octavia", date: isoDaysAgo(138), category: "to", amount: 8400, note: "Замена масла и фильтров" },
    { id: "ex-2", carId: "car-octavia", date: isoDaysAgo(119), category: "wash", amount: 650, note: "Комплексная мойка" },
    { id: "ex-3", carId: "car-octavia", date: isoDaysAgo(94), category: "insurance", amount: 7200, note: "ОСАГО на год" },
    { id: "ex-4", carId: "car-vesta", date: isoDaysAgo(71), category: "to", amount: 5300, note: "ТО-2 у дилера" },
    { id: "ex-5", carId: "car-octavia", date: isoDaysAgo(47), category: "tires", amount: 14500, note: "Комплект зимних шин" },
    { id: "ex-6", carId: "car-vesta", date: isoDaysAgo(34), category: "fine", amount: 500, note: "Превышение скорости" },
    { id: "ex-7", carId: "car-octavia", date: isoDaysAgo(18), category: "parking", amount: 300, note: "Парковка в центре" },
    { id: "ex-8", carId: "car-vesta", date: isoDaysAgo(9), category: "wash", amount: 550, note: "Мойка кузова" },
    { id: "ex-9", carId: "car-octavia", date: isoDaysAgo(4), category: "repair", amount: 3200, note: "Замена передних колодок" },
  ].map((item) => ({ ...item, createdAt: new Date(`${item.date}T12:00:00`).getTime() }));

  const now = Date.now();
  const chat = [
    {
      id: "msg-1",
      uid: "user-anna",
      name: "Анна",
      text: "Всем привет! Кто уже заправлялся на новой АЗС у объездной?",
      createdAt: now - 5 * 3600 * 1000,
    },
    {
      id: "msg-2",
      uid: "user-dmitry",
      name: "Дмитрий",
      text: "Я вчера. Цена 59,90, колонки быстрые 👌",
      createdAt: now - 4.4 * 3600 * 1000,
    },
    {
      id: "msg-3",
      uid: "demo-user",
      name: "Гость",
      text: "А расход не вырос?",
      createdAt: now - 3.7 * 3600 * 1000,
    },
    {
      id: "msg-4",
      uid: "user-anna",
      name: "Анна",
      text: "У меня +0,3 л на сотню, но это скорее из-за пробок.",
      createdAt: now - 3.2 * 3600 * 1000,
    },
    {
      id: "msg-5",
      uid: "user-dmitry",
      name: "Дмитрий",
      text: "Кстати, кто как считает: заправка до полного или по литрам? Мне удобнее «до полного» — тогда расход честный.",
      createdAt: now - 1.6 * 3600 * 1000,
    },
  ];

  return {
    cars: [
      { id: "car-octavia", name: "Skoda Octavia", make: "Skoda Octavia 1.4 TSI", plate: "А 123 ВС 54", createdAt: now - 160 * 86400000 },
      { id: "car-vesta", name: "Lada Vesta", make: "Lada Vesta SW Cross", plate: "В 456 КМ 54", createdAt: now - 130 * 86400000 },
    ],
    refuels,
    expenses,
    chat,
  };
}

function getData() {
  if (memory) return memory;
  const raw = safeGet(DATA_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.cars) && Array.isArray(parsed.refuels)) {
        memory = parsed;
        return memory;
      }
    } catch {
      /* повреждённые данные — пересеем */
    }
  }
  memory = seed();
  persist();
  return memory;
}

function persist() {
  if (!memory) return;
  safeSet(DATA_KEY, JSON.stringify(memory));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function read(kind) {
  const data = getData();
  return clone(data[kind] || []);
}

function emit(kind) {
  const payload = read(kind);
  for (const callback of listeners[kind]) {
    try {
      callback(payload);
    } catch (error) {
      console.error("demo listener failed", error);
    }
  }
}

function emitAll() {
  emit("cars");
  emit("refuels");
  emit("expenses");
  emit("chat");
}

function externalChange() {
  memory = null;
  emitAll();
}

function subscribe(kind, callback) {
  listeners[kind].add(callback);
  queueMicrotask(() => {
    if (!listeners[kind].has(callback)) return;
    try {
      callback(read(kind));
    } catch (error) {
      console.error(error);
    }
  });
  return () => listeners[kind].delete(callback);
}

function notifyAuth() {
  for (const callback of listeners.auth) {
    try {
      callback(session);
    } catch (error) {
      console.error(error);
    }
  }
}

function broadcast(type = "data") {
  try {
    channel?.postMessage({ type });
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  try {
    channel = "BroadcastChannel" in window ? new BroadcastChannel("az-demo-sync") : null;
  } catch {
    channel = null;
  }
  if (channel) {
    channel.onmessage = (event) => {
      if (event.data && event.data.type === "chat") {
        memory = null;
        emit("chat");
      } else {
        externalChange();
      }
    };
  }
  window.addEventListener("storage", (event) => {
    if (event.key === DATA_KEY) externalChange();
  });
}

function signInDemo(name = "Гость") {
  if (session) {
    notifyAuth();
    return Promise.resolve(session);
  }
  session = {
    uid: "demo-user",
    name,
    email: "demo@avtozhurnal.app",
  };
  writeSession(session);
  notifyAuth();
  return Promise.resolve(session);
}

function signOut() {
  session = null;
  writeSession(null);
  notifyAuth();
  return Promise.resolve();
}

export function createDemoApi() {
  return {
    mode: "demo",

    onAuthChange(callback) {
      listeners.auth.add(callback);
      queueMicrotask(() => callback(session));
      return () => listeners.auth.delete(callback);
    },

    signInDemo: () => signInDemo(),
    signIn: () => signInDemo(),
    signUp: ({ name }) => signInDemo(name || "Гость"),

    async signOut() {
      await signOut();
    },

    async resetPassword() {
      return true;
    },

    async updateProfile({ name }) {
      if (!session) return;
      session = { ...session, name: name || session.name };
      writeSession(session);
      const data = getData();
      data.chat = data.chat.map((message) =>
        message.uid === session.uid ? { ...message, name: session.name } : message
      );
      persist();
      notifyAuth();
      emit("chat");
    },

    subscribeCars: (callback) => subscribe("cars", callback),
    subscribeRefuels: (callback) => subscribe("refuels", callback),
    subscribeExpenses: (callback) => subscribe("expenses", callback),
    subscribeChat: (callback) => subscribe("chat", callback),

    async addCar({ name, make = "", plate = "" }) {
      const data = getData();
      const car = {
        id: uid(),
        name: name || "Мой автомобиль",
        make,
        plate,
        createdAt: Date.now(),
      };
      data.cars.push(car);
      persist();
      emit("cars");
      return car.id;
    },

    async updateCar(id, patch) {
      const data = getData();
      data.cars = data.cars.map((car) => (car.id === id ? { ...car, ...patch, id } : car));
      persist();
      emit("cars");
    },

    async deleteCar(id) {
      const data = getData();
      data.cars = data.cars.filter((car) => car.id !== id);
      data.refuels = data.refuels.filter((row) => row.carId !== id);
      data.expenses = data.expenses.filter((row) => row.carId !== id);
      persist();
      emit("cars");
      emit("refuels");
      emit("expenses");
    },

    async addRefuel(payload) {
      const data = getData();
      data.refuels.push({ ...payload, id: uid(), createdAt: Date.now() });
      persist();
      emit("refuels");
    },

    async updateRefuel(id, patch) {
      const data = getData();
      data.refuels = data.refuels.map((row) => (row.id === id ? { ...row, ...patch, id } : row));
      persist();
      emit("refuels");
    },

    async deleteRefuel(id) {
      const data = getData();
      data.refuels = data.refuels.filter((row) => row.id !== id);
      persist();
      emit("refuels");
    },

    async addExpense(payload) {
      const data = getData();
      data.expenses.push({ ...payload, id: uid(), createdAt: Date.now() });
      persist();
      emit("expenses");
    },

    async updateExpense(id, patch) {
      const data = getData();
      data.expenses = data.expenses.map((row) => (row.id === id ? { ...row, ...patch, id } : row));
      persist();
      emit("expenses");
    },

    async deleteExpense(id) {
      const data = getData();
      data.expenses = data.expenses.filter((row) => row.id !== id);
      persist();
      emit("expenses");
    },

    async sendMessage(text, name) {
      if (!session) throw new Error("Нужно войти в аккаунт");
      const data = getData();
      data.chat.push({
        id: uid(),
        uid: session.uid,
        name: name || session.name || "Гость",
        text: String(text).slice(0, 500),
        createdAt: Date.now(),
      });
      persist();
      emit("chat");
      broadcast("chat");
    },

    async loadExport() {
      const data = getData();
      return {
        profile: session ? { name: session.name, email: session.email } : null,
        cars: data.cars,
        refuels: data.refuels,
        expenses: data.expenses,
      };
    },
  };
}
