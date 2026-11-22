"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, setCsrfToken } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n/messages";
import type { User } from "@/lib/types";

type Counts = { notifications: number; messages: number };
type AuthValue = {
  user: User | null;
  loading: boolean;
  counts: Counts;
  refresh: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  setSession: (user: User, csrfToken: string) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Counts>({ notifications: 0, messages: 0 });

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ loggedIn: boolean; user?: User; csrfToken: string }>("/auth/me");
      setCsrfToken(me.csrfToken);
      setUser(me.loggedIn && me.user ? me.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await api<Counts>("/notifications/unread-count"));
    } catch {
      /* not signed in or offline */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    refreshCounts();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshCounts();
    }, 30000);
    return () => clearInterval(timer);
  }, [user, refreshCounts]);

  const setSession = useCallback((next: User, csrfToken: string) => {
    setCsrfToken(csrfToken);
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    await refresh();
    window.location.assign("/");
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, counts, refresh, refreshCounts, setSession, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

// Maps API errors to user-facing translation keys (falls back to the
// server's own message for validation-type errors).
export function errorMessage(error: unknown, t: (key: MessageKey) => string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return t("common.network");
    if (error.code === "csrf_invalid") return t("common.sessionExpired");
    if (error.status === 429) return t("common.rateLimited");
    if (error.status === 401) return t("common.signInRequired");
    if (error.status >= 500) return t("common.error");
    return error.message;
  }
  return t("common.error");
}
