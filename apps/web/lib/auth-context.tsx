"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isFailure } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

interface PersistedSession {
  token: string;
  schoolSlug: string;
  issuedAt: number;
  user: SessionUser;
}

interface AuthContextValue {
  // Null until login (or a restored session finishes loading).
  token: string | null;
  schoolId: string | null;
  user: SessionUser | null;
  ready: boolean;
  login: (input: { email: string; password: string; schoolSlug?: string }) => Promise<void>;
  logout: () => Promise<void>;
  // Authenticated fetch: attaches the token, silently refreshes once on
  // 401 via the httpOnly cookie, then retries. Throws on final failure.
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "studyfy-session";
// Refresh proactively before the 15-minute access token can expire.
const REFRESH_AFTER_MS = 14 * 60 * 1000;

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

function loadPersisted(): PersistedSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed.token || !parsed.user) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<PersistedSession | null>(null);
  const [ready, setReady] = useState(false);
  const refreshing = useRef<Promise<string> | null>(null);

  // Restore persisted session on mount; drop it if the refresh chain is
  // already dead (thief/revoked/expired) instead of showing stale identity.
  useEffect(() => {
    const saved = loadPersisted();
    if (!saved) {
      setReady(true);
      return;
    }
    fetch(`${apiBase()}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${saved.token}` } })
      .then((res) => {
        if (res.ok) {
          setSession(saved);
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => window.localStorage.removeItem(STORAGE_KEY))
      .finally(() => setReady(true));
  }, []);

  const persist = useCallback((next: PersistedSession | null) => {
    setSession(next);
    try {
      if (next) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Private browsing etc: session simply doesn't survive reloads.
    }
  }, []);

  const doRefresh = useCallback(async (): Promise<string> => {
    if (!refreshing.current) {
      refreshing.current = (async () => {
        const res = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        const body = (await res.json()) as
          | { data: { accessToken: string; user: SessionUser } }
          | { error: { message: string } };
        if (isFailure(res, body)) {
          throw new Error(body.error?.message ?? "Session expired.");
        }
        return body.data.accessToken;
      })().finally(() => {
        refreshing.current = null;
      });
    }
    return refreshing.current;
  }, []);

  const login = useCallback(
    async (input: { email: string; password: string; schoolSlug?: string }) => {
      const res = await fetch(`${apiBase()}/api/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          ...(input.schoolSlug ? { schoolSlug: input.schoolSlug } : {}),
        }),
      });
      const body = (await res.json()) as
        | { data: { accessToken: string; user: SessionUser; school: { id: string } } }
        | { error: { message: string } };
      if (isFailure(res, body)) {
        throw new Error(body.error?.message ?? "Sign-in failed.");
      }
      persist({
        token: body.data.accessToken,
        schoolSlug: input.schoolSlug ?? "",
        issuedAt: Date.now(),
        user: body.data.user,
      });
    },
    [persist],
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${apiBase()}/api/v1/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // Logout is best-effort client-side; the server call is idempotent.
    }
    persist(null);
  }, [persist]);

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const current = session;
      if (!current) {
        throw new Error("Not signed in.");
      }
      const withAuth = (token: string): RequestInit => ({
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      });
      // Proactive: never send a token older than the refresh window.
      let token = current.token;
      if (Date.now() - current.issuedAt > REFRESH_AFTER_MS) {
        try {
          token = await doRefresh();
          persist({ ...current, token, issuedAt: Date.now() });
        } catch {
          persist(null);
          throw new Error("Session expired — please sign in again.");
        }
      }
      let res = await fetch(`${apiBase()}${path}`, withAuth(token));
      if (res.status === 401) {
        try {
          token = await doRefresh();
        } catch {
          persist(null);
          throw new Error("Session expired — please sign in again.");
        }
        persist({ ...current, token, issuedAt: Date.now() });
        res = await fetch(`${apiBase()}${path}`, withAuth(token));
      }
      return res;
    },
    [session, doRefresh, persist],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      token: session?.token ?? null,
      schoolId: session?.user.schoolId ?? null,
      user: session?.user ?? null,
      ready,
      login,
      logout,
      apiFetch,
    }),
    [session, ready, login, logout, apiFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return ctx;
}
