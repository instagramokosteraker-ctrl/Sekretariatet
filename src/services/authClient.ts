import {
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  auth,
  googleProvider,
  BOOTSTRAP_SUPER_ADMIN_EMAILS,
} from '../firebase';
import type {
  AuthPublicInfoPayload,
  AuthSessionUser,
  OfficialRoleMode,
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
    const emailLower = (user.email ?? '').toLowerCase();
    const isSuper = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(emailLower);

    const session: StoredAuthSession = {
      token,
      user: {
        sessionKind: 'ADMIN',
        uid: user.uid,
        displayName: user.displayName || user.email || 'Administratör',
        email: user.email,
        adminTier: isSuper ? 'SUPER_ADMIN' : 'RACE_ADMIN',
        officialRole: 'ALL',
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

/**
 * Client-side PIN verification against competition role pins.
 * Zero requests to /api/auth/...
 */
export function loginWithPinClient(params: {
  eventId: string;
  eventName?: string;
  pin: string;
  rolePins?: Record<string, string>;
}): { ok: true; session: StoredAuthSession } | { ok: false; error: string } {
  const {
    eventId,
    eventName = 'Tävling',
    pin,
    rolePins = {
      START: '1100',
      READOUT: '2200',
      FOREST: '3300',
      SPEAKER: '4400',
    },
  } = params;

  let matchedRole: OfficialRoleMode | null = null;
  let roleLabel = '';

  if (pin === (rolePins.START || '1100')) {
    matchedRole = 'START';
    roleLabel = 'Startpersonal & Startfålla';
  } else if (pin === (rolePins.READOUT || '2200')) {
    matchedRole = 'READOUT';
    roleLabel = 'Mål & Avläsning';
  } else if (pin === (rolePins.FOREST || '3300')) {
    matchedRole = 'FOREST';
    roleLabel = 'Skogssäkerhet & Sök';
  } else if (pin === (rolePins.SPEAKER || '4400')) {
    matchedRole = 'SPEAKER';
    roleLabel = 'Speaker & Resultat';
  }

  if (!matchedRole) {
    return {
      ok: false,
      error: 'Felaktig funktionärs-PIN. Kontrollera din 4-siffriga kod.',
    };
  }

  const session: StoredAuthSession = {
    token: `pin_token_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    user: {
      sessionKind: 'PIN_OFFICIAL',
      uid: `pin_${matchedRole.toLowerCase()}_${eventId}`,
      displayName: `${roleLabel} (PIN-inloggad)`,
      email: null,
      adminTier: null,
      officialRole: matchedRole,
      lockedEventId: eventId,
      lockedEventName: eventName,
      authMethod: 'PIN',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    },
  };
  setStoredAuthSession(session);
  return { ok: true, session };
}

/**
 * Client-side offline admin code verification.
 * Zero requests to /api/auth/...
 */
export function loginWithOfflineCodeClient(
  code: string
): { ok: true; session: StoredAuthSession } | { ok: false; error: string } {
  const clean = code.trim().toLowerCase();
  if (clean !== 'okosteraker2026' && clean !== 'oklinne2026') {
    return {
      ok: false,
      error: 'Felaktig offline reservkod.',
    };
  }

  const session: StoredAuthSession = {
    token: `offline_token_${Date.now()}`,
    user: {
      sessionKind: 'ADMIN',
      uid: 'offline_emergency_admin',
      displayName: 'Tävlingsledare (Offline reservläge)',
      email: null,
      adminTier: 'RACE_ADMIN',
      officialRole: 'ALL',
      lockedEventId: null,
      lockedEventName: null,
      authMethod: 'OFFLINE_CODE',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    },
  };
  setStoredAuthSession(session);
  return { ok: true, session };
}

export async function logoutSecretariatSession(): Promise<void> {
  setStoredAuthSession(null);
  try {
    await signOut(auth);
  } catch {
    // Ignore offline signOut errors
  }
}
