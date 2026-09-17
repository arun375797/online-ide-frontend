import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, clearSession, readSession, saveSession } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [{ token, expiresAt }, setSession] = useState(() => readSession());
  const [checking, setChecking] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return undefined;
    }
    let cancelled = false;
    api("/api/auth/me", { token })
      .then(() => {
        if (!cancelled) setChecking(false);
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
          setSession({ token: null, expiresAt: 0 });
          setChecking(false);
        }
      });

    const wait = Math.max(expiresAt - Date.now(), 0);
    const timer = setTimeout(() => {
      clearSession();
      setSession({ token: null, expiresAt: 0 });
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, expiresAt]);

  const value = useMemo(
    () => ({
      token,
      expiresAt,
      login: async (pin) => {
        const data = await api("/api/auth/login", { method: "POST", body: { pin } });
        saveSession(data.token, data.expiresAt);
        setSession({ token: data.token, expiresAt: data.expiresAt });
      },
      logout: () => {
        clearSession();
        setSession({ token: null, expiresAt: 0 });
      },
    }),
    [token, expiresAt]
  );

  if (checking) {
    return (
      <div className="grid h-full place-items-center bg-deep text-muted">
        Checking session…
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
