"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  authMode,
  continueAsGuest,
  ensureSeededAccount,
  listLocalAccounts,
  localSignIn,
  localSignUp,
  restoreSession,
  supabaseSignIn,
  supabaseSignUp,
  signOut,
  type WorkspaceUser,
} from "@/lib/authBackend";
import { getSupabase } from "@/lib/supabase";
import { requestPersistentStorage } from "@/lib/storageHealth";

interface AuthContextValue {
  /** "restoring" until the session pointer has been resolved on first paint. */
  status: "restoring" | "ready";
  /** The signed-in identity, or null while the login screen should show. */
  user: WorkspaceUser | null;
  mode: "local" | "supabase";
  accounts: { email: string; name: string }[];

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInAsGuest: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"restoring" | "ready">("restoring");
  const [user, setUser] = useState<WorkspaceUser | null>(null);
  const [accounts, setAccounts] = useState<{ email: string; name: string }[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Ask for durable storage early — without it the browser may evict site
    // data under pressure (and some setups clear it on close entirely).
    void requestPersistentStorage();
    (async () => {
      await ensureSeededAccount();
      const restored = await restoreSession();
      if (!mountedRef.current) return;
      setUser(restored);
      setAccounts(listLocalAccounts());
      setStatus("ready");
    })();

    // Keep multiple tabs in agreement when Supabase auth is in use.
    if (authMode === "supabase") {
      const client = getSupabase();
      const subscription = client?.auth.onAuthStateChange((_event, session) => {
        if (!session) {
          setUser((current) => (current?.kind === "supabase" ? null : current));
        }
      });
      return () => {
        mountedRef.current = false;
        subscription?.data.subscription.unsubscribe();
      };
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next =
        authMode === "supabase"
          ? await supabaseSignIn(email, password)
          : await localSignIn(email, password);
      if (!mountedRef.current) return;
      setUser(next);
      setAccounts(listLocalAccounts());
    },
    [],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const next =
        authMode === "supabase"
          ? await supabaseSignUp({ name, email, password })
          : await localSignUp({ name, email, password });
      if (!mountedRef.current) return;
      setUser(next);
      setAccounts(listLocalAccounts());
    },
    [],
  );

  const signInAsGuest = useCallback(async () => {
    const guest = await continueAsGuest();
    if (!mountedRef.current) return;
    setUser(guest);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut();
    if (!mountedRef.current) return;
    setUser(null);
    setAccounts(listLocalAccounts());
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        mode: authMode,
        accounts,
        signIn,
        signUp,
        signInAsGuest,
        signOutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return context;
}
