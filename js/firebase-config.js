/**
 * Конфигурация Firebase.
 *
 * 1. Создайте проект на https://console.firebase.google.com
 * 2. Добавьте веб-приложение (иконка </>) и скопируйте объект firebaseConfig.
 * 3. Замените значения ниже своими.
 *
 * В консоли Firebase будет выбор «npm» или «<script>» — выбирайте любой,
 * конфигурация в них одинаковая. В этот проект ничего из этих инструкций
 * добавлять не нужно: Firebase SDK уже лежит в vendor/, а импорты настроены
 * в js/api-firebase.js. Не выполняйте npm install firebase и не вставляйте
 * CDN-теги <script src="...firebase...">.
 *
 * Эти ключи НЕ являются секретными: они публичны по задумке Firebase.
 * Доступ к данным защищают правила Firestore (файл firestore.rules).
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAyzamkqWncfNay787-hxKylT_Mmw0UNAc",
  authDomain: "avtozhurnal-2e5f1.firebaseapp.com",
  projectId: "avtozhurnal-2e5f1",
  storageBucket: "avtozhurnal-2e5f1.firebasestorage.app",
  messagingSenderId: "437521585785",
  appId: "1:437521585785:web:2f311415b99e8040e326a8",
  measurementId: "G-D19M5GW807"
};

/** true, когда конфигурация заполнена реальными значениями. */
export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0 && !value.includes("PASTE_")
);
