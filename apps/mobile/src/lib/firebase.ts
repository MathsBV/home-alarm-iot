import { getApp, getApps, initializeApp } from "firebase/app";
import { initializeAuth, getAuth, type Auth, type Persistence } from "firebase/auth";
import * as firebaseAuth from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

// getReactNativePersistence só existe no bundle React Native do Firebase
// (dist/rn). O Metro resolve esse bundle em runtime, mas os tipos do
// entrypoint padrão (que o tsc usa) não o expõem — daí o acesso via cast.
const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence: (storage: unknown) => Persistence;
  }
).getReactNativePersistence;

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const demoMode =
  process.env.EXPO_PUBLIC_DEMO_MODE !== "false" || !firebaseConfig.apiKey;

function buildAuth(): Auth {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // initializeAuth já foi chamado nesta instância (ex.: fast refresh).
    return getAuth(app);
  }
}

export const auth = (demoMode ? null : buildAuth()) as Auth;
