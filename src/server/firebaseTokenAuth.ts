import crypto from 'crypto';

export interface VerifiedFirebaseIdToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  expiresAt: number;
}

let cachedGoogleCerts: { certs: Record<string, string>; fetchedAtMs: number } | null =
  null;

async function getGoogleSecureTokenCerts(
  forceRefresh = false
): Promise<Record<string, string>> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedGoogleCerts &&
    now - cachedGoogleCerts.fetchedAtMs < 50 * 60 * 1000
  ) {
    return cachedGoogleCerts.certs;
  }
  const response = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!response.ok) {
    throw new Error('Kunde inte hämta Googles certifikat för tokenverifiering.');
  }
  const certs = (await response.json()) as Record<string, string>;
  cachedGoogleCerts = { certs, fetchedAtMs: now };
  return certs;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string
): Promise<VerifiedFirebaseIdToken> {
  const parts = idToken.trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Ogiltigt Firebase ID-tokenformat.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(
    Buffer.from(headerB64, 'base64url').toString('utf-8')
  ) as { alg?: string; kid?: string };
  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf-8')
  ) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Ogiltig tokensignaturalgoritm.');
  }
  if (
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}`
  ) {
    throw new Error('Token tillhör inte detta Firebase-projekt.');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSec - 30) {
    throw new Error('Inloggningssessionen har löpt ut. Logga in igen.');
  }
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw new Error('Google-kontot saknar verifierad e-postadress.');
  }

  let certs = await getGoogleSecureTokenCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await getGoogleSecureTokenCerts(true);
    certPem = certs[header.kid];
  }
  if (!certPem) {
    throw new Error('Kunde inte hitta matchande Google-certifikat.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(certPem, Buffer.from(sigB64, 'base64url'))) {
    throw new Error('Kryptografisk verifiering av Google-token misslyckades.');
  }

  return {
    uid: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    name: (payload.name || payload.email.split('@')[0]).trim(),
    expiresAt: payload.exp,
  };
}

export async function readFirestoreRole(
  token: string,
  collectionName: 'admins' | 'roleAssignments',
  uid: string,
  projectId: string,
  databaseId: string
): Promise<string | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(
    databaseId
  )}/documents/${collectionName}/${encodeURIComponent(uid)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Kunde inte läsa Firebase-roll (${response.status}): ${body.slice(0, 300)}`
    );
  }
  const document = (await response.json()) as {
    fields?: Record<string, { stringValue?: string }>;
  };
  return document.fields?.role?.stringValue || null;
}
