import { createContext, useContext, useMemo, useState } from "react";
import { api, clearSession, readSession, saveSession } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [{ token, expiresAt }, setSession] = useState(() => readSession());

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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
