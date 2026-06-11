import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { auth, demoMode } from "@/lib/firebase";

type Session = {
  uid: string;
  email: string | null;
  getIdToken: () => Promise<string>;
};

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  homeId: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  setHomeId: (homeId: string | null) => Promise<void>;
  getToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const HOME_KEY = "home-alarm:selected-home";

const fromFirebaseUser = (user: User): Session => ({
  uid: user.uid,
  email: user.email,
  getIdToken: () => user.getIdToken(),
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(
    demoMode
      ? {
          uid: "demo-user",
          email: "demo@alarme.local",
          getIdToken: async () => "demo-token",
        }
      : null,
  );
  const [homeId, setStoredHomeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!demoMode);

  useEffect(() => {
    void AsyncStorage.getItem(HOME_KEY).then(setStoredHomeId);
    if (demoMode) {
      return;
    }
    return onAuthStateChanged(auth, (user) => {
      setSession(user ? fromFirebaseUser(user) : null);
      setLoading(false);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (demoMode) {
      setSession({
        uid: "demo-user",
        email,
        getIdToken: async () => "demo-token",
      });
      return;
    }
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const logout = useCallback(async () => {
    if (!demoMode) await signOut(auth);
    setSession(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (!demoMode) await sendPasswordResetEmail(auth, email);
  }, []);

  const setHomeId = useCallback(async (value: string | null) => {
    setStoredHomeId(value);
    if (value) await AsyncStorage.setItem(HOME_KEY, value);
    else await AsyncStorage.removeItem(HOME_KEY);
  }, []);

  const getToken = useCallback(async () => {
    if (!session) throw new Error("Sessão expirada.");
    return session.getIdToken();
  }, [session]);

  const value = useMemo(
    () => ({ session, loading, homeId, login, logout, resetPassword, setHomeId, getToken }),
    [session, loading, homeId, login, logout, resetPassword, setHomeId, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return value;
}
