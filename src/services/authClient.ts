import type { AuthPublicInfoPayload, AuthSessionUser } from '../types/sportident';
import { signOutFirebase } from '../firebase';

export interface StoredAuthSession {
  token: string;
  user: AuthSessionUser;
}

const SESSION_STORAGE_KEY = 'passersi_auth_session_v1';

type AuthListener = (session: StoredAuthSession | null) => void;
const listeners = new Set<AuthListener>();

export function getStoredAuthSession(): StoredAuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthSession;
    if (!parsed?.token || !parsed?.user) return null;
    if (parsed.user.expiresAt && Date.parse(parsed.user.expiresAt) < Date.now()) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredAuthSession(session: StoredAuthSession | null): void {
  if (typeof window === 'undefined') return;
  if (session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
  listeners.forEach((cb) => cb(session));
}

export function subscribeAuthSession(cb: AuthListener): () => void {
  listeners.add(cb);
  cb(getStoredAuthSession());
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Wrapper around fetch for Secretariat `/api/*` endpoints that automatically
 * attaches the active session token (`x-passersi-token`).
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const session = getStoredAuthSession();
  const headers = new Headers(init.headers || {});
  if (session?.token) {
    headers.set('x-passersi-token', session.token);
  }
  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401 && session) {
    // Token invalidated by server (and we actually reached the server, not offline)
    setStoredAuthSession(null);
  }
  return response;
}

export async function fetchAuthPublicInfo(): Promise<AuthPublicInfoPayload | null> {
  try {
    const res = await fetch('/api/auth/public-info');
    if (!res.ok) return null;
    return (await res.json()) as AuthPublicInfoPayload;
  } catch {
    return null;
  }
}

/**
 * Verifies the stored session against `/api/auth/me` when online.
 * If the tablet/laptop is offline in the forest, keeps the non-expired cached session active!
 */
export async function verifyStoredSessionOnline(): Promise<StoredAuthSession | null> {
  const existing = getStoredAuthSession();
  if (!existing) return null;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'x-passersi-token': existing.token },
    });
    if (res.status === 401) {
      setStoredAuthSession(null);
      return null;
    }
    if (res.ok) {
      const data = (await res.json()) as { user: AuthSessionUser };
      const updated: StoredAuthSession = {
        token: existing.token,
        user: data.user,
      };
      setStoredAuthSession(updated);
      return updated;
    }
    return existing;
  } catch {
    // Offline in the forest — preserve local official/admin session
    return existing;
  }
}

export async function loginWithGoogleTokenOnServer(params: {
  idToken: string;
  firestoreClaimedRole?: 'SUPER_ADMIN' | 'RACE_ADMIN' | null;
}): Promise<{ ok: true; session: StoredAuthSession } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/login-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      user?: AuthSessionUser;
      error?: string;
    };
    if (!res.ok || !data.token || !data.user) {
      return {
        ok: false,
        error: data.error || 'Kunde inte verifiera Google-inloggningen.',
      };
    }
    const session: StoredAuthSession = { token: data.token, user: data.user };
    setStoredAuthSession(session);
    return { ok: true, session };
  } catch {
    return {
      ok: false,
      error:
        'Ingen internetanslutning kunde nås för Google-verifiering. Använd Offline reservkod om du är ute i skogen.',
    };
  }
}

export async function loginWithPinOnServer(params: {
  eventId: string;
  pin: string;
}): Promise<{ ok: true; session: StoredAuthSession } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/login-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      user?: AuthSessionUser;
      error?: string;
    };
    if (!res.ok || !data.token || !data.user) {
      return {
        ok: false,
        error: data.error || 'Felaktig funktionärs-PIN för den valda tävlingen.',
      };
    }
    const session: StoredAuthSession = { token: data.token, user: data.user };
    setStoredAuthSession(session);
    return { ok: true, session };
  } catch {
    return {
      ok: false,
      error: 'Kunde inte nå tävlingsservern. Kontrollera uppkopplingen.',
    };
  }
}

export async function loginWithOfflineCodeOnServer(
  code: string
): Promise<{ ok: true; session: StoredAuthSession } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth/login-offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      user?: AuthSessionUser;
      error?: string;
    };
    if (!res.ok || !data.token || !data.user) {
      return {
        ok: false,
        error: data.error || 'Felaktig offline reservkod.',
      };
    }
    const session: StoredAuthSession = { token: data.token, user: data.user };
    setStoredAuthSession(session);
    return { ok: true, session };
  } catch {
    return {
      ok: false,
      error: 'Kunde inte nå den lokala tävlingsservern.',
    };
  }
}

export async function logoutSecretariatSession(): Promise<void> {
  setStoredAuthSession(null);
  try {
    await signOutFirebase();
  } catch {
    // ignore offline signOut errors
  }
}
