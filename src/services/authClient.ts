import {
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  auth,
  googleProvider,
  resolveFirebaseUserRole,
} from '../firebase';
import type {
  AuthSessionUser,
} from '../types/sportident';

export interface StoredAuthSession {
  token: string;
  user: AuthSessionUser;
}

const SESSION_STORAGE_KEY = 'passersi_auth_session_v1';

type AuthListener = (session: StoredAuthSession | null) => void;
const listeners = new Set<AuthListener>();

export function apiWebSocketUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

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
    if (parsed.user.authMethod !== 'GOOGLE') {
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
 * attaches the active session token (`x-passersi-token`) if available.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const session = getStoredAuthSession();
  const headers = new Headers(init.headers || {});
  let token = session?.token;
  if (auth.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
      if (session && session.token !== token) {
        session.token = token;
        try {
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
        } catch {
          // ignore storage error
        }
      }
    } catch {
      // Keep existing token
    }
  }
  if (token) {
    headers.set('x-passersi-token', token);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}

function logNonJsonApiResponse(response: Response, body: string): void {
  console.error('API returned a non-JSON response:', {
    url: response.url,
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
  });
}

function getJsonErrorMessage(body: string, fallbackMessage: string): string {
  try {
    const payload = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  } catch {
    // Non-JSON response bodies are logged separately.
  }
  return fallbackMessage;
}

/**
 * Reads JSON API responses consistently and prevents HTML/plain-text platform
 * error pages from surfacing as JSON.parse exceptions in the UI.
 */
export async function readApiResponseJson<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (!response.ok) {
    if (!isJson) logNonJsonApiResponse(response, body);
    throw new Error(isJson ? getJsonErrorMessage(body, fallbackMessage) : fallbackMessage);
  }

  if (!isJson) {
    logNonJsonApiResponse(response, body);
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    logNonJsonApiResponse(response, body);
    throw new Error(fallbackMessage);
  }
}

export async function ensureApiResponseOk(
  response: Response,
  fallbackMessage: string
): Promise<void> {
  if (response.ok) return;
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    logNonJsonApiResponse(response, body);
    throw new Error(fallbackMessage);
  }
  throw new Error(getJsonErrorMessage(body, fallbackMessage));
}

/**
 * Client-side session verification. Does NOT call /api/auth/...
 */
export async function verifyStoredSessionOnline(): Promise<StoredAuthSession | null> {
  return getStoredAuthSession();
}

/**
 * Client-side Firebase Google sign-in using signInWithPopup & GoogleAuthProvider.
 * Zero requests to /api/auth/...
 */
export async function loginWithGoogleClient(): Promise<
  { ok: true; session: StoredAuthSession } | { ok: false; error: string; code?: string }
> {
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    const user = credential.user;
    const token = await user.getIdToken();
    const role = await resolveFirebaseUserRole(user);
    if (!role) {
      await signOut(auth);
      return {
        ok: false,
        error: 'Kontot saknar tilldelad PasserSI-roll. Be en administratör bjuda in dig under Klubbadmin & Behörighet.',
      };
    }
    const isOfficial = role.kind === 'OFFICIAL';

    const session: StoredAuthSession = {
      token,
      user: {
        sessionKind: isOfficial ? 'OFFICIAL' : 'ADMIN',
        uid: user.uid,
        displayName: user.displayName || user.email || 'Administratör',
        email: user.email,
        adminTier: role.adminTier,
        officialRole: role.officialRole || 'ALL',
        lockedEventId: null,
        lockedEventName: null,
        authMethod: 'GOOGLE',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      },
    };
    setStoredAuthSession(session);
    return { ok: true, session };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Google-inloggning misslyckades.',
      code,
    };
  }
}

export async function logoutSecretariatSession(): Promise<void> {
  setStoredAuthSession(null);
  try {
    await signOut(auth);
  } catch {
    // Ignore offline signOut errors
  }
}
