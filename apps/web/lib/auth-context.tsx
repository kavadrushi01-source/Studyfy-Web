"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiBase, isFailure } from "./api";

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

// Impersonation overlay (§13.9): the OWNER session stays intact underneath
// (it is needed for the END call and the return trip); this overlay carries
// the read-only target session. Separate storage key so clearing one never
// touches the other. No refresh is ever attempted for it — the token is
// 30-minute, refresh would silently swap identity back to the owner.
export interface ImpersonationState {
  token: string;
  sessionId: string;
  expiresAt: string;
  target: { id: string; name: string; role: string; schoolId: string };
}

interface AuthContextValue {
  // Null until login (or a restored session finishes loading).
  // While impersonating these describe the TARGET, not the owner — every
  // page gates and fetches as the target, exactly like their own login.
  token: string | null;
  schoolId: string | null;
  schoolSlug: string;
  user: SessionUser | null;
  ready: boolean;
  login: (input: { email: string; password: string; schoolSlug?: string }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  // Authenticated fetch: attaches the token, silently refreshes once on
  // 401 via the httpOnly cookie, then retries. Throws on final failure.
  // While impersonating it uses the overlay token and NEVER refreshes: a
  // 401 means the 30 minutes are up — the overlay is discarded and the
  // owner session underneath survives.
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  // Owner-token fetch for the END call (and only it): same refresh
  // behavior as apiFetch, always the owner's identity.
  apiFetchAsOwner: (path: string, init?: RequestInit) => Promise<Response>;
  impersonation: ImpersonationState | null;
  startImpersonation: (input: { targetUserId: string; reason: string }) => Promise<void>;
  // Writes the END audit event with the owner token, then discards the
  // overlay either way (the token is client-side — discarding ends the
  // session even if the END call itself failed). Resolves with an error
  // message when the END write failed, null when it landed.
  stopImpersonation: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "studyfy-session";
const IMPERSONATION_KEY = "studyfy-impersonation";
// Refresh proactively before the 15-minute access token can expire.
const REFRESH_AFTER_MS = 14 * 60 * 1000;


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

function loadImpersonation(): ImpersonationState | null {
  try {
    const raw = window.localStorage.getItem(IMPERSONATION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ImpersonationState;
    if (!parsed.token || !parsed.sessionId || !parsed.target) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Fresh identity (user) for a token. Null on any failure —
// callers keep the last known session instead. Module scope (not a hook)
// so the mount effect can use it without dependency churn.
async function fetchIdentity(
  token: string,
): Promise<{ user: SessionUser | null; rejected: boolean } | null> {
  try {
    const res = await fetch(`${apiBase()}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { user: null, rejected: true };
    }
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      data?: { user?: SessionUser };
      error?: { message: string };
    };
    if (isFailure(res, body) || !body.data?.user) {
      return null;
    }
    return { user: body.data.user, rejected: false };
  } catch {
    return null;
  }
}

function storeSession(next: PersistedSession | null): void {
  try {
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private browsing etc: session simply doesn't survive reloads.
  }
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<PersistedSession | null>(null);
  const [impersonation, setImpersonation] = useState<ImpersonationState | null>(null);
  const [ready, setReady] = useState(false);
  const refreshing = useRef<Promise<string> | null>(null);
  const authGeneration = useRef(0);

  // Restore persisted session on mount; drop it only when the server
  // definitively rejects the identity (401/403). Transient failures -
  // network blips, 5xx, and aborts when the page navigates away while
  // this probe is still in flight - must NOT destroy a valid session;
  // apiFetch validates lazily and refreshes on the first real 401.
  // The impersonation overlay restores alongside (same mount): a live one
  // resumes the banner, an expired one is closed with an END write first.
  useEffect(() => {
    let active = true;
    const generation = authGeneration.current;
    const saved = loadPersisted();
    const overlay = loadImpersonation();
    if (overlay && saved) {
      if (Date.parse(overlay.expiresAt) > Date.now()) {
        setImpersonation(overlay);
      } else {
        // Reload past expiry: the token is dead, but the books still need
        // their END row — close it with the owner token, then discard.
        // Fire-and-forget by design (mount effect); failures only log.
        void fetch(`${apiBase()}/api/v1/platform/impersonate/end`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${saved.token}` },
          body: JSON.stringify({ sessionId: overlay.sessionId }),
        }).catch(() => undefined);
        try {
          window.localStorage.removeItem(IMPERSONATION_KEY);
        } catch {
          // Ignore — the dead overlay simply never resumes.
        }
      }
    }
    if (!saved) {
      setReady(true);
      return;
    }
    setSession(saved);
    setReady(true);
    void fetchIdentity(saved.token).then((identity) => {
      if (!active || generation !== authGeneration.current) {
        return;
      }
      if (identity?.rejected) {
        window.localStorage.removeItem(STORAGE_KEY);
        setSession(null);
        setImpersonation(null);
        window.localStorage.removeItem(IMPERSONATION_KEY);
        return;
      }
      if (identity?.user) {
        const merged = { ...saved, user: identity.user };
        setSession(merged);
        storeSession(merged);
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: PersistedSession | null) => {
    authGeneration.current += 1;
    setSession(next);
    storeSession(next);
  }, []);

  const persistImpersonation = useCallback((next: ImpersonationState | null) => {
    setImpersonation(next);
    try {
      if (next) {
        window.localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(next));
      } else {
        window.localStorage.removeItem(IMPERSONATION_KEY);
      }
    } catch {
      // Same as sessions: without storage the overlay lasts the tab only.
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
      // A new identity ends any impersonation overlay (it belonged to the
      // previous session's owner).
      persistImpersonation(null);
      return body.data.user;
    },
    [persist, persistImpersonation],
  );

  const logout = useCallback(async () => {
    persist(null);
    persistImpersonation(null);
    try {
      await fetch(`${apiBase()}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Local logout succeeds even when the API is unavailable.
    }
  }, [persist, persistImpersonation]);

  // Shared authenticated fetch over an explicit token. refreshSession
  // non-null enables the refresh flows (owner sessions only); null means
  // fire once and return whatever comes back (impersonation — a 401 there
  // is handled by the caller, never refreshed).
  const doFetchWith = useCallback(
    async (
      token: string,
      refreshSession: PersistedSession | null,
      path: string,
      init: RequestInit,
    ): Promise<Response> => {
      const withAuth = (t: string): RequestInit => ({
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
      });
      let current = token;
      if (refreshSession && Date.now() - refreshSession.issuedAt > REFRESH_AFTER_MS) {
        try {
          current = await doRefresh();
          persist({ ...refreshSession, token: current, issuedAt: Date.now() });
        } catch {
          persist(null);
          throw new Error("Session expired — please sign in again.");
        }
      }
      let res = await fetch(`${apiBase()}${path}`, withAuth(current));
      if (res.status === 401 && refreshSession) {
        try {
          current = await doRefresh();
        } catch {
          persist(null);
          throw new Error("Session expired — please sign in again.");
        }
        persist({ ...refreshSession, token: current, issuedAt: Date.now() });
        res = await fetch(`${apiBase()}${path}`, withAuth(current));
      }
      return res;
    },
    [doRefresh, persist],
  );

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      // Impersonating: the overlay token rides every call, refresh is
      // SKIPPED (there is no refresh row — attempting one would silently
      // swap identity back to the owner via the cookie). A 401 is the
      // 30 minutes running out: discard the overlay, keep the owner, say so.
      if (impersonation) {
        const res = await doFetchWith(impersonation.token, null, path, init);
        if (res.status === 401) {
          persistImpersonation(null);
          throw new Error("Impersonation session expired — exit and start again if still needed.");
        }
        return res;
      }
      const current = session;
      if (!current) {
        throw new Error("Not signed in.");
      }
      return doFetchWith(current.token, current, path, init);
    },
    [session, impersonation, doFetchWith, persistImpersonation],
  );

  const apiFetchAsOwner = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const current = session;
      if (!current) {
        throw new Error("Not signed in.");
      }
      return doFetchWith(current.token, current, path, init);
    },
    [session, doFetchWith],
  );

  const stopImpersonation = useCallback(async (): Promise<string | null> => {
    const overlay = impersonation;
    const current = session;
    persistImpersonation(null);
    if (!overlay) {
      return null;
    }
    if (!current) {
      return "Owner session ended — the impersonation token was discarded locally.";
    }
    try {
      const res = await fetch(`${apiBase()}/api/v1/platform/impersonate/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${current.token}` },
        body: JSON.stringify({ sessionId: overlay.sessionId }),
      });
      const body = (await res.json()) as { error?: { message: string } };
      if (isFailure(res, body)) {
        return body.error?.message ?? "Could not write the END event — the token was discarded locally.";
      }
      return null;
    } catch {
      return "Network error writing the END event — the token was discarded locally.";
    }
  }, [impersonation, session, persistImpersonation]);

  const startImpersonation = useCallback(
    async (input: { targetUserId: string; reason: string }) => {
      const current = session;
      if (!current) {
        throw new Error("Not signed in.");
      }
      // Close any live overlay first (writes its END) so sessions never
      // overlap without closing the books.
      if (impersonation) {
        await stopImpersonation();
      }
      // Explicit owner token — never the overlay (no nested sessions, ever).
      const res = await fetch(`${apiBase()}/api/v1/platform/impersonate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${current.token}` },
        body: JSON.stringify(input),
      });
      const body = (await res.json()) as
        | {
            data: {
              accessToken: string;
              expiresAt: string;
              sessionId: string;
              target: { id: string; name: string; role: string; schoolId: string };
            };
          }
        | { error: { message: string } };
      if (isFailure(res, body)) {
        throw new Error(body.error?.message ?? "Could not start impersonation.");
      }
      persistImpersonation({
        token: body.data.accessToken,
        sessionId: body.data.sessionId,
        expiresAt: body.data.expiresAt,
        target: body.data.target,
      });
    },
    [session, impersonation, stopImpersonation, persistImpersonation],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      token: impersonation?.token ?? session?.token ?? null,
      schoolId: impersonation ? impersonation.target.schoolId : (session?.user.schoolId ?? null),
      schoolSlug: session?.schoolSlug ?? "",
      // Target identity while impersonating (email unknown to the overlay
      // response — blank, never the owner's).
      user: impersonation
        ? {
            id: impersonation.target.id,
            name: impersonation.target.name,
            email: "",
            schoolId: impersonation.target.schoolId,
            role: impersonation.target.role,
          }
        : (session?.user ?? null),
      ready,
      login,
      logout,
      apiFetch,
      apiFetchAsOwner,
      impersonation,
      startImpersonation,
      stopImpersonation,
    }),
    [session, impersonation, ready, login, logout, apiFetch, apiFetchAsOwner, startImpersonation, stopImpersonation],
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
