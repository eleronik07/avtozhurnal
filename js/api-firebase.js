/* Firebase-бэкенд: Auth (email/пароль) + Firestore. */

import { initializeApp } from "../vendor/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile as firebaseUpdateProfile,
} from "../vendor/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  onSnapshot,
  serverTimestamp,
} from "../vendor/firebase-firestore.js";

function toMillis(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return null;
}

function normalize(snapshot) {
  const data = snapshot.data();
  return { id: snapshot.id, ...data, createdAt: toMillis(data.createdAt) };
}

export function createFirebaseApi(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);

  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    console.warn("Не удалось включить офлайн-кэш, работаем без него:", error);
    db = getFirestore(app);
  }

  function uid() {
    const current = auth.currentUser;
    if (!current) throw new Error("Требуется вход в аккаунт");
    return current.uid;
  }

  function userRef() {
    return doc(db, "users", uid());
  }

  function userCollection(name) {
    return collection(db, "users", uid(), name);
  }

  function watchCollection(name, callback, onError) {
    if (!auth.currentUser) return () => {};
    const ref = collection(db, "users", auth.currentUser.uid, name);
    return onSnapshot(
      ref,
      (snapshot) => callback(snapshot.docs.map(normalize)),
      (error) => {
        console.error(`Не удалось загрузить ${name}:`, error);
        if (onError) onError(error);
      }
    );
  }

  return {
    mode: "firebase",

    onAuthChange(callback) {
      return onAuthStateChanged(auth, async (user) => {
        if (!user) {
          callback(null);
          return;
        }
        let name = user.displayName || (user.email || "").split("@")[0] || "Водитель";
        try {
          const snapshot = await getDoc(doc(db, "users", user.uid));
          if (snapshot.exists()) {
            const data = snapshot.data();
            if (data.name) name = data.name;
          } else {
            await setDoc(doc(db, "users", user.uid), {
              name,
              email: user.email || "",
              createdAt: serverTimestamp(),
            });
          }
        } catch (error) {
          console.warn("Профиль недоступен:", error);
        }
        callback({ uid: user.uid, email: user.email || "", name });
      });
    },

    async signUp({ name, email, password }) {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      try {
        await firebaseUpdateProfile(credential.user, { displayName: name });
      } catch (error) {
        console.warn("displayName:", error);
      }
      try {
        await setDoc(doc(db, "users", credential.user.uid), {
          name,
          email,
          createdAt: serverTimestamp(),
        });
        await addDoc(collection(db, "users", credential.user.uid, "cars"), {
          name: "Мой автомобиль",
          make: "",
          plate: "",
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn("Не удалось создать профиль и автомобиль:", error);
      }
      return { uid: credential.user.uid, email, name };
    },

    async signIn({ email, password }) {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      return { uid: credential.user.uid, email: credential.user.email, name: credential.user.displayName || "" };
    },

    async signOut() {
      await firebaseSignOut(auth);
    },

    async resetPassword(email) {
      await sendPasswordResetEmail(auth, email);
    },

    async updateProfile({ name }) {
      if (!auth.currentUser) return;
      await firebaseUpdateProfile(auth.currentUser, { displayName: name });
      await setDoc(userRef(), { name }, { merge: true });
    },

    subscribeCars(callback, onError) {
      return watchCollection("cars", callback, onError);
    },

    subscribeRefuels(callback, onError) {
      return watchCollection("refuels", callback, onError);
    },

    subscribeExpenses(callback, onError) {
      return watchCollection("expenses", callback, onError);
    },

    subscribeChat(callback, onError) {
      const chatQuery = query(collection(db, "chat"), orderBy("createdAt", "desc"), limit(80));
      return onSnapshot(
        chatQuery,
        (snapshot) => callback(snapshot.docs.map(normalize).reverse()),
        (error) => {
          console.error("Чат недоступен:", error);
          if (onError) onError(error);
        }
      );
    },

    async addCar({ name, make = "", plate = "" }) {
      const ref = await addDoc(userCollection("cars"), {
        name: name || "Мой автомобиль",
        make,
        plate,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },

    async updateCar(id, patch) {
      await updateDoc(doc(db, "users", uid(), "cars", id), {
        name: patch.name,
        make: patch.make || "",
        plate: patch.plate || "",
      });
    },

    async deleteCar(id) {
      const owner = uid();
      const [refuels, expenses] = await Promise.all([
        getDocs(query(collection(db, "users", owner, "refuels"), where("carId", "==", id))),
        getDocs(query(collection(db, "users", owner, "expenses"), where("carId", "==", id))),
      ]);
      const batch = writeBatch(db);
      refuels.docs.forEach((item) => batch.delete(item.ref));
      expenses.docs.forEach((item) => batch.delete(item.ref));
      batch.delete(doc(db, "users", owner, "cars", id));
      await batch.commit();
    },

    async addRefuel(payload) {
      await addDoc(userCollection("refuels"), { ...payload, createdAt: serverTimestamp() });
    },

    async updateRefuel(id, payload) {
      await updateDoc(doc(db, "users", uid(), "refuels", id), payload);
    },

    async deleteRefuel(id) {
      await deleteDoc(doc(db, "users", uid(), "refuels", id));
    },

    async addExpense(payload) {
      await addDoc(userCollection("expenses"), { ...payload, createdAt: serverTimestamp() });
    },

    async updateExpense(id, payload) {
      await updateDoc(doc(db, "users", uid(), "expenses", id), payload);
    },

    async deleteExpense(id) {
      await deleteDoc(doc(db, "users", uid(), "expenses", id));
    },

    async sendMessage(text, name) {
      const owner = uid();
      await addDoc(collection(db, "chat"), {
        uid: owner,
        name: (name || "Водитель").slice(0, 60),
        text: String(text).slice(0, 500),
        createdAt: serverTimestamp(),
      });
    },
  };
}
