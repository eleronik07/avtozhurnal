/* Выбор бэкенда: Firebase или локальное демо (без загрузки SDK). */

import { isFirebaseConfigured, firebaseConfig } from "./firebase-config.js";

export async function createApi(mode = "firebase") {
  if (mode === "demo") {
    const { createDemoApi } = await import("./api-demo.js");
    return createDemoApi();
  }
  if (!isFirebaseConfigured) {
    throw new Error("Firebase не настроен: заполните js/firebase-config.js");
  }
  const { createFirebaseApi } = await import("./api-firebase.js");
  return createFirebaseApi(firebaseConfig);
}

export { isFirebaseConfigured };
