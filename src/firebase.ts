import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase/firestore';
import { applyEmergencyTimeOffsets, validateCompetitorReadout } from './utils/readoutValidation';
import {
  calculateSeriesStandings,
  normalizeSeriesScoringSettings,
} from './services/seriesStandings';
import { getChangedSnapshotFields } from './utils/competitorSnapshotGuard';
import firebaseConfig from '../firebase-applet-config.json';
import type {
  CardPunch,
  ClassCompetitionFormat,
  CloudCompetitionRecord,
  CloudEventExportItem,
  CloudSeasonSnapshot,
  ClubAdminTier,
  ClubSettings,
  CompClass,
  CompetitionMeta,
  CompetitionSummary,
  Competitor,
  Course,
  EmergencySettings,
  EventLifecycleStatus,
  FullCardReadoutPayload,
  OfficialRole,
  OfficialRoleAssignment,
  OfficialRoleInvite,
  PublicRacePayload,
  RunnerDbEntry,
  RunnerStatus,
  SICardSeries,
  SIStation,
  SICardAssignment,
  SICardAssignmentAuditEvent,
  SICardAssignmentValidationReport,
  StationFunction,
} from './types/sportident';
import { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from './types/sportident';
import {
  buildSICardAssignmentValidationReport,
  parseSICardAssignmentDocument,
} from './utils/siCardAssignments';
import {
  buildSIAssignmentInventory,
  planMissingSIAssignments,
  SIAssignmentInventoryQueryError,
  type MissingSIAssignmentDuplicate,
  type MissingSIAssignmentSkip,
  type SIAssignmentInventoryReport,
} from './utils/siAssignmentInventory';
import {
  accumulateSIAssignmentPreviewMetrics,
  buildSIAssignmentPreviewPlan,
  createSIAssignmentPreviewMetrics,
  type AtomicSIAssignmentMutationIntent,
  type SIAssignmentPreviewMetrics,
  type SIAssignmentPreviewPlan,
} from './utils/siAssignmentPreview';
import {
  planCreateSIAssignmentWrite,
  planReassignSIAssignmentWrite,
  planRetireSIAssignmentWrite,
} from './utils/siAssignmentWrites';
import {
  inspectSIAssignmentRuleMutations,
  logSIAssignmentRuleDiagnostics,
} from './utils/siAssignmentRuleDiagnostics';
import {
  declareCompetitorMutation,
  runAssignmentAwareCompetitorMutation,
  runCompetitorMutation,
  runCompetitorMutations,
  type CompetitorMutationDeclaration,
  type CompetitorMutationOperation,
} from './utils/siAssignmentDiagnostics';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Blueprint validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'instagram.okosteraker@gmail.com';
export const BOOTSTRAP_SUPER_ADMIN_EMAILS = [
  'instagram.okosteraker@gmail.com',
  'marcus.o.ahlen@gmail.com',
];
const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const SAFE_EMAIL_REGEX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_DATA_URL_LEN = 500_000;
const BATCH_CHUNK_LIMIT = 350;

function sanitizeCloudHexColor(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed.toLowerCase() : '';
}

function sanitizeCloudLogoDataUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOGO_DATA_URL_LEN) return '';
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  return '';
}

export function getStockholmTodayIso(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeControlTimeOffsets(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const offsets: Record<string, number> = {};
  for (const [code, rawOffset] of Object.entries(raw)) {
    const stationCode = Number(code);
    const offset = Number(rawOffset);
    if (
      Number.isInteger(stationCode) &&
      stationCode >= 1 &&
      stationCode <= 999 &&
      Number.isFinite(offset) &&
      offset >= -7200 &&
      offset <= 7200
    ) {
      const rounded = Math.round(offset);
      if (rounded !== 0) offsets[String(stationCode)] = rounded;
    }
  }
  return offsets;
}

function encodeNullableSec(val: number | null | undefined): number {
  if (val === null || val === undefined || !Number.isFinite(val)) return -1;
  return clampInt(val, 0, 86400, -1);
}

function decodeNullableSec(val: unknown): number | null {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.min(86400, Math.round(num));
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const TOKEN_SERVICE_STORAGE_KEY = 'passersi_token_service_disabled_v1';
const TOKEN_SERVICE_PROJECT_REF = firebaseConfig.messagingSenderId || firebaseConfig.projectId;
export const TOKEN_SERVICE_ACTIVATION_URL = `https://console.developers.google.com/apis/api/securetoken.googleapis.com/overview?project=${TOKEN_SERVICE_PROJECT_REF}`;

let tokenServiceDisabledFlag = (() => {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(TOKEN_SERVICE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
})();
const tokenServiceListeners = new Set<(disabled: boolean) => void>();

export function isTokenServiceApiDisabled(): boolean {
  return tokenServiceDisabledFlag;
}

export function subscribeTokenServiceStatus(cb: (disabled: boolean) => void): () => void {
  tokenServiceListeners.add(cb);
  cb(tokenServiceDisabledFlag);
  return () => {
    tokenServiceListeners.delete(cb);
  };
}

function setTokenServiceDisabled(disabled: boolean): void {
  if (typeof window !== 'undefined') {
    try {
      if (disabled) {
        sessionStorage.setItem(TOKEN_SERVICE_STORAGE_KEY, '1');
      } else {
        sessionStorage.removeItem(TOKEN_SERVICE_STORAGE_KEY);
      }
    } catch {
      // ignore storage restrictions
    }
  }
  if (tokenServiceDisabledFlag !== disabled) {
    tokenServiceDisabledFlag = disabled;
    tokenServiceListeners.forEach((fn) => fn(disabled));
  }
}

export function isTokenServiceError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    code.includes('token-service-api') ||
    msg.includes('token-service-api') ||
    msg.includes('securetoken.googleapis.com')
  );
}

function isTransientOfflineFirestoreError(error: unknown): boolean {
  if (isTokenServiceError(error)) return true;
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    code === 'unavailable' ||
    code.includes('network-request-failed') ||
    msg.includes('the client is offline') ||
    msg.includes('fetching auth token failed') ||
    msg.includes('could not reach cloud firestore backend')
  );
}

function isPermissionDeniedFirestoreError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  return (
    code.includes('permission-denied') ||
    message.includes('permission-denied') ||
    message.includes('missing or insufficient permissions')
  );
}

let pendingAuthValidation: Promise<User | null> | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearProactiveRefreshTimer(): void {
  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

function getStsExpirationMs(user: User): number | null {
  const exp = (
    user as unknown as { stsTokenManager?: { expirationTime?: number } }
  ).stsTokenManager?.expirationTime;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

function scheduleProactiveTokenRefresh(user: User): void {
  clearProactiveRefreshTimer();
  const expMs = getStsExpirationMs(user);
  if (!expMs) return;
  const delayMs = Math.max(5_000, expMs - Date.now() - 3 * 60_000);
  proactiveRefreshTimer = setTimeout(() => {
    void ensureValidFirestoreUser(true);
  }, delayMs);
}

/**
 * Verifies that any cached Firebase Auth user has a valid, refreshable ID token BEFORE
 * Firestore opens a backend stream. If `securetoken.googleapis.com` is disabled in GCP,
 * signs out the stale Firebase Auth cache cleanly (leaving PasserSI's Secretariat session intact)
 * so `@firebase/firestore` never fails with `Fetching auth token failed`.
 */
export async function ensureValidFirestoreUser(forceRefresh = false): Promise<User | null> {
  if (pendingAuthValidation && !forceRefresh) {
    return pendingAuthValidation;
  }

  const run = (async (): Promise<User | null> => {
    try {
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
    } catch {
      // ignore
    }

    const current = auth.currentUser;
    if (!current) {
      clearProactiveRefreshTimer();
      return null;
    }

    const expMs = getStsExpirationMs(current);
    const nearExpiry = expMs !== null && expMs - Date.now() < 3 * 60_000;
    const shouldForce = forceRefresh || nearExpiry;

    try {
      const token = await current.getIdToken(shouldForce);
      if (!token) {
        clearProactiveRefreshTimer();
        await signOut(auth).catch(() => {});
        return null;
      }
      if (shouldForce) {
        setTokenServiceDisabled(false);
      }
      scheduleProactiveTokenRefresh(current);
      return current;
    } catch (err) {
      clearProactiveRefreshTimer();
      if (isTokenServiceError(err)) {
        setTokenServiceDisabled(true);
        await signOut(auth).catch(() => {});
        return null;
      }
      const code = String((err as { code?: string })?.code || '').toLowerCase();
      if (
        code.includes('user-token-expired') ||
        code.includes('invalid-user-token') ||
        code.includes('user-disabled') ||
        code.includes('user-not-found')
      ) {
        await signOut(auth).catch(() => {});
        return null;
      }
      if (expMs !== null && expMs <= Date.now()) {
        return null;
      }
      return current;
    }
  })();

  pendingAuthValidation = run;
  try {
    return await run;
  } finally {
    if (pendingAuthValidation === run) {
      pendingAuthValidation = null;
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && auth.currentUser) {
      void ensureValidFirestoreUser(false);
    }
  });
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isTokenServiceError(error)) {
    setTokenServiceDisabled(true);
    void signOut(auth).catch(() => {});
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function handleWriteOrOfflineError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isTokenServiceError(error)) {
    setTokenServiceDisabled(true);
    void signOut(auth).catch(() => {});
    throw new Error(
      'Token Service API (securetoken.googleapis.com) är inaktiverat i Google Cloud-projektet.'
    );
  }
  if (isTransientOfflineFirestoreError(error)) {
    throw new Error('Kunde inte nå Firestore i offlineläge.');
  }
  return handleFirestoreError(error, operationType, path);
}

// Validate connection to Firestore on boot (after ensuring cached auth token is healthy)
async function testConnection(): Promise<void> {
  try {
    await ensureValidFirestoreUser();
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline') &&
      !isTokenServiceApiDisabled() &&
      (typeof navigator === 'undefined' || navigator.onLine !== false)
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function sanitizeFirestoreId(raw: string, fallbackPrefix = 'id'): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 128);
  if (!cleaned || !SAFE_ID_REGEX.test(cleaned)) {
    return `${fallbackPrefix}_${Date.now()}`;
  }
  return cleaned;
}

export { SI_CARD_ASSIGNMENT_SCHEMA_VERSION } from './types/sportident';

export function getCompetitionSICardAssignmentRef(
  competitionId: string,
  siNumber: number
): DocumentReference {
  const safeCompetitionId = sanitizeFirestoreId(competitionId, 'evt');
  return doc(db, 'competitions', safeCompetitionId, 'siCardAssignments', String(siNumber));
}

export function getCompetitionSICardAssignmentsCollection(
  competitionId: string
): ReturnType<typeof collection> {
  const safeCompetitionId = sanitizeFirestoreId(competitionId, 'evt');
  return collection(db, 'competitions', safeCompetitionId, 'siCardAssignments');
}

function logSICardAssignmentAudit(
  action: SICardAssignmentAuditEvent['action'],
  competitionId: string,
  siNumber: number,
  competitorId: string | null
): void {
  const event: SICardAssignmentAuditEvent = {
    action,
    competitionId,
    siNumber,
    competitorId,
    timestamp: new Date().toISOString(),
    ...(auth.currentUser?.uid ? { actorUid: auth.currentUser.uid } : {}),
  };
  const message = `[si-assignment] ${JSON.stringify(event)}`;
  if (action === 'RETIRED_ASSIGNMENT' || action === 'DUPLICATE_ASSIGNMENT') {
    console.warn(message);
  } else {
    console.info(message);
  }
}

function validateSICardLookupInput(competitionId: string, siNumber: number): {
  competitionId: string;
  siNumber: number;
} {
  if (
    !competitionId.trim() ||
    !Number.isInteger(siNumber) ||
    siNumber < 1 ||
    siNumber > 99999999
  ) {
    throw new Error('Ogiltigt tävlings-ID eller SI-bricknummer för uppslag.');
  }
  return {
    competitionId: sanitizeFirestoreId(competitionId, 'evt'),
    siNumber,
  };
}

export async function lookupCompetitionSICardAssignment(
  competitionId: string,
  siNumber: number
): Promise<SICardAssignment | null> {
  const input = validateSICardLookupInput(competitionId, siNumber);
  const ref = getCompetitionSICardAssignmentRef(input.competitionId, input.siNumber);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    logSICardAssignmentAudit('LOOKUP_MISS', input.competitionId, input.siNumber, null);
    return null;
  }
  const assignment = parseSICardAssignmentDocument(
    snap.id,
    input.competitionId,
    snap.data() as Record<string, unknown>
  );
  if (!assignment) {
    console.error(
      `[si-assignment] Invalid assignment document at ${ref.path}; expected document ID ${input.siNumber}.`
    );
    throw new Error(`SI-tilldelningen för ${input.siNumber} har ett ogiltigt format.`);
  }
  logSICardAssignmentAudit(
    'LOOKUP_HIT',
    input.competitionId,
    input.siNumber,
    assignment.competitorId
  );
  if (assignment.state === 'RETIRED') {
    logSICardAssignmentAudit(
      'RETIRED_ASSIGNMENT',
      input.competitionId,
      input.siNumber,
      assignment.competitorId
    );
  } else if (assignment.state === 'DUPLICATE_CONFIRMED') {
    logSICardAssignmentAudit(
      'DUPLICATE_ASSIGNMENT',
      input.competitionId,
      input.siNumber,
      assignment.competitorId
    );
  }
  return assignment;
}

export const readCompetitionSICardAssignment = lookupCompetitionSICardAssignment;

export type SICardAssignmentResolution =
  | { status: 'MISSING'; assignment: null; competitorId: null }
  | {
      status: 'ACTIVE';
      assignment: SICardAssignment;
      competitorId: string;
      competitorSiNumber: number;
    }
  | {
      status: 'RETIRED' | 'DUPLICATE' | 'UNKNOWN';
      assignment: SICardAssignment;
      competitorId: string | null;
    }
  | {
      status: 'ORPHANED';
      assignment: SICardAssignment;
      competitorId: string;
    }
  | {
      status: 'SI_MISMATCH';
      assignment: SICardAssignment;
      competitorId: string;
      competitorSiNumber: number;
    };

export async function resolveCompetitionSICardAssignmentReadOnly(
  competitionId: string,
  siNumber: number
): Promise<SICardAssignmentResolution> {
  const assignment = await lookupCompetitionSICardAssignment(competitionId, siNumber);
  if (!assignment) {
    return { status: 'MISSING', assignment: null, competitorId: null };
  }
  if (assignment.state !== 'ACTIVE' || !assignment.competitorId) {
    const status: 'RETIRED' | 'DUPLICATE' | 'UNKNOWN' =
      assignment.state === 'DUPLICATE_CONFIRMED'
        ? 'DUPLICATE'
        : assignment.state === 'ACTIVE'
          ? 'UNKNOWN'
          : assignment.state;
    return {
      status,
      assignment,
      competitorId: assignment.competitorId,
    };
  }

  const input = validateSICardLookupInput(competitionId, siNumber);
  const competitorRef = doc(
    db,
    'competitions',
    input.competitionId,
    'competitors',
    sanitizeFirestoreId(assignment.competitorId, 'cmp')
  );
  const competitorSnap = await getDoc(competitorRef);
  if (!competitorSnap.exists()) {
    console.warn(
      `[si-assignment] Active assignment ${input.siNumber} references missing competitor ${assignment.competitorId} in ${input.competitionId}.`
    );
    return {
      status: 'ORPHANED',
      assignment,
      competitorId: assignment.competitorId,
    };
  }
  const competitorSiNumber = Number(competitorSnap.data().siNumber);
  if (competitorSiNumber !== assignment.siNumber) {
    console.warn(
      `[si-assignment] Assignment SI ${assignment.siNumber} does not match competitor ${assignment.competitorId} SI ${competitorSiNumber} in ${input.competitionId}.`
    );
    return {
      status: 'SI_MISMATCH',
      assignment,
      competitorId: assignment.competitorId,
      competitorSiNumber,
    };
  }
  return {
    status: 'ACTIVE',
    assignment,
    competitorId: assignment.competitorId,
    competitorSiNumber,
  };
}

export async function validateCompetitionSICardAssignments(
  competitionId: string
): Promise<SICardAssignmentValidationReport> {
  const authorization = await getCurrentFirebaseRoles();
  if (!authorization.adminTier) {
    throw new Error('Endast tävlings- eller klubbadministratörer får granska SI-tilldelningar.');
  }

  const safeCompetitionId = sanitizeFirestoreId(competitionId, 'evt');
  const [assignmentSnapshot, competitorSnapshot] = await Promise.all([
    getDocs(getCompetitionSICardAssignmentsCollection(safeCompetitionId)),
    getDocs(collection(db, 'competitions', safeCompetitionId, 'competitors')),
  ]);
  const competitorSiNumbers = new Map<string, number>();
  competitorSnapshot.docs.forEach((competitorDoc) => {
    const siNumber = Number(competitorDoc.data().siNumber);
    if (Number.isInteger(siNumber) && siNumber > 0) {
      competitorSiNumbers.set(competitorDoc.id, siNumber);
    }
  });
  const report = buildSICardAssignmentValidationReport({
    competitionId: safeCompetitionId,
    records: assignmentSnapshot.docs.map((assignmentDoc) => ({
      documentId: assignmentDoc.id,
      data: assignmentDoc.data() as Record<string, unknown>,
    })),
    competitorSiNumbers,
  });

  assignmentSnapshot.docs.forEach((assignmentDoc) => {
    const assignment = parseSICardAssignmentDocument(
      assignmentDoc.id,
      safeCompetitionId,
      assignmentDoc.data() as Record<string, unknown>
    );
    if (assignment?.state === 'RETIRED') {
      logSICardAssignmentAudit(
        'RETIRED_ASSIGNMENT',
        safeCompetitionId,
        assignment.siNumber,
        assignment.competitorId
      );
    }
  });

  report.issues
    .filter(
      (issue) =>
        issue.code === 'DUPLICATE_SI_NUMBER' ||
        issue.code === 'DUPLICATE_COMPETITOR_ASSIGNMENT' ||
        issue.code === 'DUPLICATE_CONFIRMED'
    )
    .forEach((issue) => {
      issue.siNumbers.forEach((duplicateSiNumber) =>
        logSICardAssignmentAudit(
          'DUPLICATE_ASSIGNMENT',
          safeCompetitionId,
          duplicateSiNumber,
          issue.competitorIds[0] ?? null
        )
      );
    });

  return report;
}

export async function scanSIAssignmentInventoryFromFirestore(): Promise<SIAssignmentInventoryReport> {
  const readInventoryCollection = async <T>(
    path: string,
    competitionId: string | null,
    operation: 'get' | 'list',
    requiredRole: string,
    read: () => Promise<T>
  ): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      const errorCode =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : 'unknown';
      const message =
        error instanceof Error ? error.message : 'Okänt Firestore-fel.';
      throw new SIAssignmentInventoryQueryError({
        path,
        competitionId,
        operation,
        errorCode,
        userRole: actualRole,
        adminTier,
        requiredRole,
        message,
      });
    }
  };

  const currentUser = await ensureValidFirestoreUser();
  if (
    !currentUser ||
    !currentUser.emailVerified ||
    !currentUser.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('SI-inventeringen kräver ett verifierat Google-konto.');
  }

  const normalizedEmail = (currentUser.email ?? '').trim().toLowerCase();
  let actualRole = 'UNKNOWN';
  let adminTier = 'UNKNOWN';
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(normalizedEmail);
  if (isBootstrapAdmin) {
    actualRole = 'ADMIN';
    adminTier = 'SUPER_ADMIN';
  } else {
    const uid = sanitizeFirestoreId(currentUser.uid, 'usr');
    const adminPath = `admins/${uid}`;
    const adminSnapshot = await readInventoryCollection(
      adminPath,
      null,
      'get',
      'Verifierad användare får läsa sin egen adminroll',
      () => getDoc(doc(db, 'admins', uid))
    );
    if (adminSnapshot.exists()) {
      const role = adminSnapshot.data().role;
      if (role === 'SUPER_ADMIN' || role === 'RACE_ADMIN') {
        actualRole = 'ADMIN';
        adminTier = role;
      }
    } else {
      const roleAssignmentPath = `roleAssignments/${uid}`;
      const roleAssignmentSnapshot = await readInventoryCollection(
        roleAssignmentPath,
        null,
        'get',
        'Verifierad användare får läsa sin egen rolltilldelning',
        () => getDoc(doc(db, 'roleAssignments', uid))
      );
      if (roleAssignmentSnapshot.exists()) {
        const role = roleAssignmentSnapshot.data().role;
        if (typeof role === 'string') actualRole = role;
      }
    }
  }

  if (adminTier !== 'SUPER_ADMIN' && adminTier !== 'RACE_ADMIN') {
    throw new Error(
      `Endast SUPER_ADMIN och RACE_ADMIN får skapa SI-inventeringen. Faktisk roll: ${actualRole}; adminTier: ${adminTier}.`
    );
  }

  const competitionPath = 'competitions';
  const competitionSnapshot = await readInventoryCollection(
    competitionPath,
    null,
    'list',
    'Verifierad användare enligt Firestore-regeln; inventeringsfunktionen kräver SUPER_ADMIN eller RACE_ADMIN',
    () => getDocs(collection(db, 'competitions'))
  );
  const competitions: SIAssignmentInventoryReport['competitions'] = [];
  let competitorCount = 0;
  let assignmentCount = 0;

  for (const competitionDoc of competitionSnapshot.docs) {
    const [competitorSnapshot, assignmentSnapshot] = await Promise.all([
      readInventoryCollection(
        `competitions/${competitionDoc.id}/competitors`,
        competitionDoc.id,
        'list',
        'Inget rollkrav i regeln; giltigt competitionId och befintlig tävling krävs',
        () =>
          getDocs(
            collection(db, 'competitions', competitionDoc.id, 'competitors')
          )
      ),
      readInventoryCollection(
        `competitions/${competitionDoc.id}/siCardAssignments`,
        competitionDoc.id,
        'list',
        'SUPER_ADMIN, RACE_ADMIN eller officiell roll READOUT',
        () =>
          getDocs(
            getCompetitionSICardAssignmentsCollection(competitionDoc.id)
          )
      ),
    ]);
    const competitionData = competitionDoc.data();
    const inventory = buildSIAssignmentInventory({
      competitionId: competitionDoc.id,
      competitionName:
        typeof competitionData.name === 'string' && competitionData.name.trim()
          ? competitionData.name.trim()
          : competitionDoc.id,
      competitors: competitorSnapshot.docs.map((competitorDoc) => ({
        documentId: competitorDoc.id,
        data: competitorDoc.data() as Record<string, unknown>,
      })),
      assignments: assignmentSnapshot.docs.map((assignmentDoc) => ({
        documentId: assignmentDoc.id,
        data: assignmentDoc.data() as Record<string, unknown>,
      })),
    });
    competitions.push(inventory);
    competitorCount += inventory.competitorCount;
    assignmentCount += inventory.assignmentCount;
  }

  return {
    generatedAtIso: new Date().toISOString(),
    competitionCount: competitions.length,
    competitorCount,
    assignmentCount,
    competitions,
  };
}

export async function generateMissingSIAssignmentsFromFirestore(): Promise<{
  before: SIAssignmentInventoryReport;
  after: SIAssignmentInventoryReport;
  createdCount: number;
  skipped: Array<MissingSIAssignmentSkip & { competitionId: string }>;
  duplicates: Array<MissingSIAssignmentDuplicate & { competitionId: string }>;
  failures: Array<{
    competitionId: string;
    competitorId: string;
    siNumber: number;
    message: string;
  }>;
}> {
  const before = await scanSIAssignmentInventoryFromFirestore();
  const authorization = await getCurrentFirebaseRoles();
  if (!authorization.adminTier) {
    throw new Error('Endast SUPER_ADMIN och RACE_ADMIN får skapa SI-kopplingar.');
  }

  const competitionsSnapshot = await getDocs(collection(db, 'competitions'));
  const skipped: Array<MissingSIAssignmentSkip & { competitionId: string }> = [];
  const duplicates: Array<MissingSIAssignmentDuplicate & { competitionId: string }> = [];
  const failures: Array<{
    competitionId: string;
    competitorId: string;
    siNumber: number;
    message: string;
  }> = [];
  let createdCount = 0;

  for (const competitionDoc of competitionsSnapshot.docs) {
    const [competitorsSnapshot, assignmentsSnapshot] = await Promise.all([
      getDocs(collection(db, 'competitions', competitionDoc.id, 'competitors')),
      getDocs(getCompetitionSICardAssignmentsCollection(competitionDoc.id)),
    ]);
    const competitorRecords = competitorsSnapshot.docs.map((competitorDoc) => ({
      documentId: competitorDoc.id,
      data: competitorDoc.data() as Record<string, unknown>,
    }));
    const plan = planMissingSIAssignments({
      competitors: competitorRecords,
      existingAssignmentDocumentIds: new Set(
        assignmentsSnapshot.docs.map((assignmentDoc) => assignmentDoc.id)
      ),
    });

    skipped.push(
      ...plan.skipped.map((item) => ({
        ...item,
        competitionId: competitionDoc.id,
      }))
    );
    for (const duplicate of plan.duplicates) {
      duplicates.push({ ...duplicate, competitionId: competitionDoc.id });
      console.warn('[si-assignment-bootstrap] duplicate detected', {
        competitionId: competitionDoc.id,
        siNumber: duplicate.siNumber,
        competitorIds: duplicate.competitorIds,
      });
    }

    for (const skippedItem of plan.skipped) {
      console.info('[si-assignment-bootstrap] assignment skipped', {
        competitionId: competitionDoc.id,
        ...skippedItem,
      });
    }

    for (const candidate of plan.candidates) {
      const assignmentRef = getCompetitionSICardAssignmentRef(
        competitionDoc.id,
        candidate.siNumber
      );
      try {
        const wasCreated = await runTransaction(db, async (transaction) => {
          const existingAssignment = await transaction.get(assignmentRef);
          if (existingAssignment.exists()) return false;

          const now = Timestamp.now();
          transaction.set(assignmentRef, {
            competitionId: competitionDoc.id,
            siNumber: candidate.siNumber,
            cardSeries: candidate.cardSeries,
            competitorId: candidate.competitorId,
            competitorDocumentId: candidate.competitorId,
            state: 'ACTIVE',
            assignmentVersion: 1,
            source: 'SYSTEM',
            ownerUid: authorization.user.uid,
            schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
            createdAt: now,
            updatedAt: now,
          });
          return true;
        });

        if (wasCreated) {
          createdCount += 1;
          console.info('[si-assignment-bootstrap] assignment created', {
            competitionId: competitionDoc.id,
            siNumber: candidate.siNumber,
            competitorId: candidate.competitorId,
          });
        } else {
          skipped.push({
            competitorId: candidate.competitorId,
            siNumber: String(candidate.siNumber),
            reason: 'ALREADY_EXISTS',
            competitionId: competitionDoc.id,
          });
          console.info('[si-assignment-bootstrap] assignment skipped', {
            competitionId: competitionDoc.id,
            competitorId: candidate.competitorId,
            siNumber: candidate.siNumber,
            reason: 'ALREADY_EXISTS',
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Okänt fel vid skapande av SI-koppling.';
        failures.push({
          competitionId: competitionDoc.id,
          competitorId: candidate.competitorId,
          siNumber: candidate.siNumber,
          message,
        });
        console.error('[si-assignment-bootstrap] assignment creation failed', {
          competitionId: competitionDoc.id,
          competitorId: candidate.competitorId,
          siNumber: candidate.siNumber,
          error,
        });
      }
    }
  }

  const after = await scanSIAssignmentInventoryFromFirestore();
  console.info('[si-assignment-bootstrap] completed', {
    createdCount,
    skippedCount: skipped.length,
    duplicateGroupCount: duplicates.length,
    failureCount: failures.length,
  });
  return { before, after, createdCount, skipped, duplicates, failures };
}

export async function createCompetitionSICardAssignment(params: {
  competitionId: string;
  siNumber: number;
  cardSeries: string;
  competitorId: string | null;
  state?: 'ACTIVE' | 'RETIRED' | 'DUPLICATE_CONFIRMED' | 'UNKNOWN';
  assignmentVersion?: number;
  source?: 'DIRECT_ENTRY' | 'IMPORT' | 'EVENTOR' | 'MANUAL' | 'READOUT' | 'SYSTEM';
  ownerUid?: string;
  previousCompetitorId?: string | null;
  retiredAt?: Timestamp | null;
  retirementReason?: string | null;
  conflictReason?: string | null;
  lastValidatedAt?: Timestamp | null;
}): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (!current || !current.emailVerified) {
    throw new Error('Ditt Google-konto saknar giltig Firestore-session för SI-kortstilldelning.');
  }
  const ref = getCompetitionSICardAssignmentRef(params.competitionId, params.siNumber);
  const now = Timestamp.now();
  const competitorId = params.competitorId;
  logSIAssignmentRuleDiagnostics(
    inspectSIAssignmentRuleMutations([
      {
        collection: 'siCardAssignments',
        operation: 'create',
        after: {
          competitionId: sanitizeFirestoreId(params.competitionId, 'evt'),
          siNumber: Number(params.siNumber),
          competitorId,
          state: params.state ?? 'ACTIVE',
        },
      },
    ])
  );
  await setDoc(ref, {
    competitionId: sanitizeFirestoreId(params.competitionId, 'evt'),
    siNumber: Number(params.siNumber),
    cardSeries: params.cardSeries,
    competitorId,
    competitorDocumentId: competitorId,
    state: params.state ?? 'ACTIVE',
    assignmentVersion: Number(params.assignmentVersion ?? 1),
    source: params.source ?? 'MANUAL',
    ownerUid: params.ownerUid ?? sanitizeFirestoreId(current.uid, 'usr'),
    schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    ...(params.previousCompetitorId !== undefined
      ? { previousCompetitorId: params.previousCompetitorId }
      : {}),
    ...(params.retiredAt !== undefined ? { retiredAt: params.retiredAt } : {}),
    ...(params.retirementReason !== undefined
      ? { retirementReason: params.retirementReason }
      : {}),
    ...(params.conflictReason !== undefined
      ? { conflictReason: params.conflictReason }
      : {}),
    ...(params.lastValidatedAt !== undefined
      ? { lastValidatedAt: params.lastValidatedAt }
      : {}),
  });
}

export async function retireCompetitionSICardAssignment(params: {
  competitionId: string;
  siNumber: number;
  cardSeries: string;
  competitorId: string | null;
  retirementReason?: string | null;
  ownerUid?: string | null;
}): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (!current || !current.emailVerified) {
    throw new Error('Ditt Google-konto saknar giltig Firestore-session för SI-kortstilldelning.');
  }
  const ref = getCompetitionSICardAssignmentRef(params.competitionId, params.siNumber);
  const now = Timestamp.now();
  const competitorId = params.competitorId;
  const existingSnapshot = await getDoc(ref);
  if (existingSnapshot.exists()) {
    const existing = parseSICardAssignmentDocument(
      existingSnapshot.id,
      sanitizeFirestoreId(params.competitionId, 'evt'),
      existingSnapshot.data() as Record<string, unknown>
    );
    if (!existing) {
      throw new Error(`SI-tilldelningen för ${params.siNumber} har ett ogiltigt format.`);
    }
    logSIAssignmentRuleDiagnostics(
      inspectSIAssignmentRuleMutations([
        {
          collection: 'siCardAssignments',
          operation: 'update',
          before: {
            competitionId: existing.competitionId,
            siNumber: existing.siNumber,
            competitorId: existing.competitorId,
            state: existing.state,
          },
          after: {
            competitionId: existing.competitionId,
            siNumber: existing.siNumber,
            competitorId: existing.competitorId,
            state: 'RETIRED',
          },
        },
      ])
    );
    await updateDoc(ref, {
      state: 'RETIRED',
      assignmentVersion: existing.assignmentVersion + 1,
      updatedAt: now,
      retiredAt: now,
      retirementReason: params.retirementReason ?? 'retired',
    });
    return;
  }
  logSIAssignmentRuleDiagnostics(
    inspectSIAssignmentRuleMutations([
      {
        collection: 'siCardAssignments',
        operation: 'create',
        after: {
          competitionId: sanitizeFirestoreId(params.competitionId, 'evt'),
          siNumber: Number(params.siNumber),
          competitorId,
          state: 'RETIRED',
        },
      },
    ])
  );
  await setDoc(
    ref,
    {
      competitionId: sanitizeFirestoreId(params.competitionId, 'evt'),
      siNumber: Number(params.siNumber),
      cardSeries: params.cardSeries,
      competitorId,
      competitorDocumentId: competitorId,
      state: 'RETIRED',
      assignmentVersion: 1,
      source: 'MANUAL',
      ownerUid: params.ownerUid ?? sanitizeFirestoreId(current.uid, 'usr'),
      schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      retiredAt: now,
      retirementReason: params.retirementReason ?? 'retired',
    }
  );
}

export async function ensureCompetitionSICardAssignmentSchema(
  competitionId: string
): Promise<void> {
  const safeCompetitionId = sanitizeFirestoreId(competitionId, 'evt');
  const schemaDocRef = doc(db, 'competitions', safeCompetitionId, '_schema', 'siCardAssignments');
  await setDoc(
    schemaDocRef,
    {
      competitionId: safeCompetitionId,
      collectionName: 'siCardAssignments',
      schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      authoritativeSource: 'firestore',
      runtimeUsage: 'phase-a-schema-only',
    },
    { merge: true }
  );
}

/**
 * Deterministic, collision-safe invite document ID derived from normalized lowercase email.
 * Matches ^[a-zA-Z0-9_\-]+$ and stays <= 128 characters.
 */
export function emailToInviteId(email: string): string {
  const norm = email.trim().toLowerCase();
  let hex = '';
  for (let i = 0; i < norm.length; i++) {
    hex += norm.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return `inv_${hex}`.slice(0, 128);
}

export function subscribeFirebaseAuth(cb: (user: User | null) => void): () => void {
  let cancelled = false;
  const unsub = onAuthStateChanged(auth, (u) => {
    if (!u) {
      if (!cancelled) cb(null);
      return;
    }
    void ensureValidFirestoreUser().then((validUser) => {
      if (!cancelled) {
        cb(validUser);
      }
    });
  });
  return () => {
    cancelled = true;
    unsub();
  };
}

/**
 * Pre-warms Firebase Auth's BrowserPopupRedirectResolver iframe (`gapi.iframes`) on desktop
 * browsers so clicking "Logga in med Google" opens the OAuth window synchronously within the
 * browser's transient user-activation window instead of timing out with `auth/popup-blocked`.
 */
export function prewarmGooglePopupAuth(): void {
  if (typeof window === 'undefined') return;
  try {
    const internalAuth = auth as unknown as {
      _popupRedirectResolver?: {
        _initialize?: (authInstance: unknown) => Promise<unknown>;
      };
    };
    if (typeof internalAuth._popupRedirectResolver?._initialize === 'function') {
      void internalAuth._popupRedirectResolver._initialize(auth).catch(() => {
        // Ignore background pre-warm errors (e.g., when offline in the forest)
      });
    }
  } catch {
    // Ignore
  }
}

export async function signInWithGooglePopup(): Promise<{ user: User | null; idToken: string }> {
  const credential = await signInWithPopup(auth, googleProvider);
  let idToken = '';
  try {
    idToken = await credential.user.getIdToken(false);
  } catch (err) {
    const fallbackToken = (
      credential.user as unknown as { stsTokenManager?: { accessToken?: string } }
    ).stsTokenManager?.accessToken;
    if (fallbackToken) {
      idToken = fallbackToken;
    } else {
      throw err;
    }
  }

  // Proactively verify whether Token Service API (`securetoken.googleapis.com`) is enabled in GCP.
  // If disabled, keep `idToken` so Secretariat login succeeds, and clear Firebase Auth's local cache
  // so Firestore never fails later when the 1h token expires.
  try {
    const refreshedToken = await credential.user.getIdToken(true);
    if (refreshedToken) {
      idToken = refreshedToken;
    }
    setTokenServiceDisabled(false);
    scheduleProactiveTokenRefresh(credential.user);
    return { user: credential.user, idToken };
  } catch (refreshErr) {
    clearProactiveRefreshTimer();
    if (isTokenServiceError(refreshErr)) {
      setTokenServiceDisabled(true);
      await signOut(auth).catch(() => {});
      return { user: null, idToken };
    }
    scheduleProactiveTokenRefresh(credential.user);
    return { user: credential.user, idToken };
  }
}

export async function signOutFirebase(): Promise<void> {
  clearProactiveRefreshTimer();
  if (auth.currentUser) {
    await signOut(auth);
  }
}

/**
 * Claims or refreshes the verified Google user's non-PII `/admins/{uid}` role document in Firestore.
 */
export async function ensureAdminRoleInFirestore(
  user: User
): Promise<{ claimed: boolean; role: ClubAdminTier | null }> {
  const validUser = await ensureValidFirestoreUser();
  if (!validUser || validUser.uid !== user.uid || !user.email || !user.emailVerified) {
    return { claimed: false, role: null };
  }
  const normalizedEmail = user.email.trim().toLowerCase();
  const uid = sanitizeFirestoreId(user.uid, 'usr');
  const displayName = (user.displayName || normalizedEmail.split('@')[0] || 'Tävlingsledare')
    .trim()
    .slice(0, 100);

  const adminPath = `admins/${uid}`;
  let existingRole: ClubAdminTier | null = null;
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(normalizedEmail);

  const consumeInvite = async () => {
    const inviteId = emailToInviteId(normalizedEmail);
    const inviteRef = doc(db, 'adminInvites', inviteId);
    let inviteSnap: DocumentSnapshot | null = null;
    try {
      inviteSnap = await getDoc(inviteRef);
    } catch (err) {
      if (isTransientOfflineFirestoreError(err)) return;
      handleFirestoreError(err, OperationType.GET, `adminInvites/${inviteId}`);
    }
    if (!inviteSnap?.exists()) return;
    const invite = inviteSnap.data();
    if (invite.email !== normalizedEmail || invite.active !== true) return;
    try {
      await updateDoc(inviteRef, {
        active: false,
        claimedUid: uid,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.UPDATE, `adminInvites/${inviteId}`);
    }
  };

  let existingAdminSnap: DocumentSnapshot | null = null;
  try {
    existingAdminSnap = await getDoc(doc(db, 'admins', uid));
  } catch (err) {
    if (isTransientOfflineFirestoreError(err)) {
      return { claimed: false, role: null };
    }
    handleFirestoreError(err, OperationType.GET, adminPath);
  }
  if (existingAdminSnap?.exists()) {
    const data = existingAdminSnap.data() as { role?: ClubAdminTier; displayName?: string };
    existingRole =
      isBootstrapAdmin || data.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'RACE_ADMIN';
    if (data.displayName !== displayName || data.role !== existingRole) {
      try {
        await updateDoc(doc(db, 'admins', uid), {
          displayName,
          role: existingRole,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleWriteOrOfflineError(err, OperationType.UPDATE, adminPath);
      }
    }
    await consumeInvite();
    return { claimed: true, role: existingRole };
  }

  // Bootstrapped primary owner
  if (isBootstrapAdmin) {
    try {
      const defaultName =
        normalizedEmail === 'instagram.okosteraker@gmail.com'
          ? 'OK Österåker (Huvudadmin)'
          : 'Marcus Åhlén (Huvudadmin)';
      await setDoc(doc(db, 'admins', uid), {
        uid,
        displayName: displayName || defaultName,
        role: 'SUPER_ADMIN',
        inviteId: 'bootstrap_super_admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.CREATE, adminPath);
    }
    await consumeInvite();
    return { claimed: true, role: 'SUPER_ADMIN' };
  }

  // Otherwise check if an active invite exists for this verified email
  const inviteId = emailToInviteId(normalizedEmail);
  let invSnap: DocumentSnapshot | null = null;
  try {
    invSnap = await getDoc(doc(db, 'adminInvites', inviteId));
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const code = String((err as { code?: string })?.code || '').toLowerCase();
    if (
      code.includes('permission-denied') ||
      message.includes('permission-denied') ||
      message.includes('missing or insufficient permissions')
    ) {
      // Non-invited users cannot read invitations because they contain personal data.
      return { claimed: false, role: null };
    }
    if (isTransientOfflineFirestoreError(err)) {
      return { claimed: false, role: null };
    }
    handleFirestoreError(err, OperationType.GET, `adminInvites/${inviteId}`);
  }
  if (!invSnap?.exists()) {
    return { claimed: false, role: null };
  }
  const invData = invSnap.data() as { active?: boolean; role?: ClubAdminTier };
  if (!invData.active) return { claimed: false, role: null };
  const grantedRole: ClubAdminTier =
    invData.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'RACE_ADMIN';

  try {
    await setDoc(doc(db, 'admins', uid), {
      uid,
      displayName,
      role: grantedRole,
      inviteId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (createErr) {
    handleWriteOrOfflineError(createErr, OperationType.CREATE, adminPath);
  }
  await consumeInvite();
  return { claimed: true, role: grantedRole };
}

export interface FirestoreAdminInviteItem {
  inviteId: string;
  email: string;
  displayName: string;
  role: ClubAdminTier;
  active: boolean;
  claimedUid?: string;
}

export async function listMyAdminInvitesFromFirestore(): Promise<FirestoreAdminInviteItem[]> {
  const current = await ensureValidFirestoreUser();
  if (!current) return [];
  const path = 'adminInvites';
  try {
    const q = query(collection(db, 'adminInvites'), where('createdByUid', '==', current.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as {
        inviteId: string;
        email: string;
        displayName: string;
        role: ClubAdminTier;
        active: boolean;
        claimedUid?: string;
      };
      return {
        inviteId: data.inviteId,
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        active: data.active,
        claimedUid: data.claimedUid,
      };
    });
  } catch (err) {
    if (isTransientOfflineFirestoreError(err)) {
      return [];
    }
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function upsertAdminInviteInFirestore(params: {
  email: string;
  displayName: string;
  role?: ClubAdminTier;
  isSuperAdmin?: boolean;
}): Promise<string | null> {
  const current = await ensureValidFirestoreUser();
  if (!current) return null;

  const normEmail = params.email.trim().toLowerCase().slice(0, 120);
  if (!SAFE_EMAIL_REGEX.test(normEmail)) {
    throw new Error('Ange en giltig e-postadress med små bokstäver.');
  }
  const cleanName = (params.displayName.trim() || normEmail.split('@')[0]).slice(0, 100);
  const inviteId = emailToInviteId(normEmail);
  const role: ClubAdminTier = params.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'RACE_ADMIN';
  const path = `adminInvites/${inviteId}`;

  let existingInvite: FirestoreAdminInviteItem | null = null;
  try {
    const existing = await getDoc(doc(db, 'adminInvites', inviteId));
    if (existing.exists()) {
      existingInvite = existing.data() as FirestoreAdminInviteItem;
    }
  } catch (err) {
    handleWriteOrOfflineError(err, OperationType.GET, path);
  }

  if (existingInvite) {
    try {
      if (params.isSuperAdmin) {
        await updateDoc(doc(db, 'adminInvites', inviteId), {
          displayName: cleanName,
          role,
          active: true,
          updatedAt: serverTimestamp(),
        });
        if (existingInvite.claimedUid) {
          const claimedAdminRef = doc(db, 'admins', existingInvite.claimedUid);
          const claimedAdminSnap = await getDoc(claimedAdminRef);
          if (claimedAdminSnap.exists()) {
            await updateDoc(claimedAdminRef, {
              role,
              updatedAt: serverTimestamp(),
            });
          }
        }
      } else {
        await updateDoc(doc(db, 'adminInvites', inviteId), {
          displayName: cleanName,
          active: true,
          updatedAt: serverTimestamp(),
        });
      }
      return inviteId;
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(doc(db, 'adminInvites', inviteId), {
        inviteId,
        email: normEmail,
        displayName: cleanName,
        role: params.isSuperAdmin ? role : 'RACE_ADMIN',
        active: true,
        createdByUid: sanitizeFirestoreId(current.uid, 'usr'),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return inviteId;
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.CREATE, path);
    }
  }
}

export async function removeAdminInviteFromFirestore(email: string): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (!current) return;
  const normEmail = email.trim().toLowerCase();
  const inviteId = emailToInviteId(normEmail);
  const path = `adminInvites/${inviteId}`;

  let inviteData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(doc(db, 'adminInvites', inviteId));
    inviteData = snap.exists() ? snap.data() : null;
  } catch (err) {
    handleWriteOrOfflineError(err, OperationType.GET, path);
  }
  if (!inviteData) return;

  try {
    const claimedUid =
      typeof inviteData.claimedUid === 'string' ? inviteData.claimedUid : null;
    if (claimedUid) {
      const adminRef = doc(db, 'admins', claimedUid);
      const adminSnap = await getDoc(adminRef);
      if (adminSnap.exists()) {
        await deleteDoc(adminRef);
      }
    }
    await deleteDoc(doc(db, 'adminInvites', inviteId));
  } catch (err) {
    handleWriteOrOfflineError(err, OperationType.DELETE, path);
  }
}

function isOfficialRole(value: unknown): value is OfficialRole {
  return value === 'START' || value === 'READOUT' || value === 'FOREST' || value === 'SPEAKER';
}

export async function claimOfficialRoleInvite(
  user: User
): Promise<OfficialRoleAssignment | null> {
  const current = await ensureValidFirestoreUser();
  if (!current || current.uid !== user.uid || !current.emailVerified || !current.email) {
    return null;
  }
  const normalizedEmail = current.email.trim().toLowerCase();
  const inviteId = emailToInviteId(normalizedEmail);
  const inviteRef = doc(db, 'roleInvites', inviteId);
  const assignmentRef = doc(db, 'roleAssignments', sanitizeFirestoreId(current.uid, 'usr'));

  const assignmentSnap = await getDoc(assignmentRef);
  if (assignmentSnap.exists()) {
    const data = assignmentSnap.data();
    if (data.uid === current.uid && data.email === normalizedEmail && isOfficialRole(data.role)) {
      return data as OfficialRoleAssignment;
    }
    throw new Error('Firestore-rolltilldelningen för kontot är ogiltig.');
  }

  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) return null;
  const invite = inviteSnap.data();
  if (
    invite.email !== normalizedEmail ||
    invite.active !== true ||
    !isOfficialRole(invite.role)
  ) {
    return null;
  }

  const batch = writeBatch(db);
  batch.set(assignmentRef, {
    uid: current.uid,
    inviteId,
    email: normalizedEmail,
    displayName: current.displayName || invite.displayName || normalizedEmail,
    role: invite.role,
    createdByUid: invite.createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(inviteRef, {
    active: false,
    claimedUid: current.uid,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    const concurrentClaim = await getDoc(assignmentRef);
    if (concurrentClaim.exists()) {
      const data = concurrentClaim.data();
      if (data.uid === current.uid && data.email === normalizedEmail && isOfficialRole(data.role)) {
        return data as OfficialRoleAssignment;
      }
    }
    throw error;
  }
  const claimed = await getDoc(assignmentRef);
  return claimed.exists() ? (claimed.data() as OfficialRoleAssignment) : null;
}

export async function resolveFirebaseUserRole(
  user: User
): Promise<
  | { kind: 'ADMIN'; adminTier: ClubAdminTier; officialRole: null }
  | { kind: 'OFFICIAL'; adminTier: null; officialRole: OfficialRole }
  | null
> {
  const admin = await ensureAdminRoleInFirestore(user);
  if (admin.claimed && admin.role) {
    return { kind: 'ADMIN', adminTier: admin.role, officialRole: null };
  }
  const assignment = await claimOfficialRoleInvite(user);
  if (assignment && isOfficialRole(assignment.role)) {
    return { kind: 'OFFICIAL', adminTier: null, officialRole: assignment.role };
  }
  return null;
}

export async function listOfficialRoleAssignmentsFromFirestore(): Promise<OfficialRoleAssignment[]> {
  const current = await ensureValidFirestoreUser();
  if (!current) return [];
  const snap = await getDocs(collection(db, 'roleAssignments'));
  return snap.docs.map((item) => item.data() as OfficialRoleAssignment);
}

export async function listOfficialRoleInvitesFromFirestore(): Promise<OfficialRoleInvite[]> {
  const current = await ensureValidFirestoreUser();
  if (!current) return [];
  const snap = await getDocs(collection(db, 'roleInvites'));
  return snap.docs.map((item) => {
    const data = item.data();
    return {
      inviteId: item.id,
      email: String(data.email || ''),
      displayName: String(data.displayName || ''),
      role: data.role as OfficialRole,
      active: data.active === true,
      createdByUid: String(data.createdByUid || ''),
      claimedUid: typeof data.claimedUid === 'string' ? data.claimedUid : undefined,
      addedAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : new Date().toISOString(),
    };
  });
}

export async function upsertOfficialRoleInviteInFirestore(params: {
  email: string;
  displayName: string;
  role: OfficialRole;
}): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (!current || !current.emailVerified) {
    throw new Error('En verifierad Google-administratör måste vara inloggad.');
  }
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!SAFE_EMAIL_REGEX.test(normalizedEmail) || !isOfficialRole(params.role)) {
    throw new Error('Ange en giltig e-postadress och funktionärsroll.');
  }
  const inviteId = emailToInviteId(normalizedEmail);
  const inviteRef = doc(db, 'roleInvites', inviteId);
  const existing = await getDoc(inviteRef);
  const displayName = (params.displayName.trim() || normalizedEmail.split('@')[0]).slice(0, 100);
  const now = serverTimestamp();

  if (existing.exists()) {
    const prior = existing.data();
    if (prior.email !== normalizedEmail) {
      throw new Error('Rollinbjudans e-postadress stämmer inte med dokumentet.');
    }
    const batch = writeBatch(db);
    batch.set(
      inviteRef,
      {
        inviteId,
        email: normalizedEmail,
        displayName,
        role: params.role,
        active: !prior.claimedUid,
        createdByUid: prior.createdByUid,
        ...(typeof prior.claimedUid === 'string' ? { claimedUid: prior.claimedUid } : {}),
        createdAt: prior.createdAt,
        updatedAt: now,
      },
      { merge: false }
    );
    if (typeof prior.claimedUid === 'string') {
      batch.update(doc(db, 'roleAssignments', sanitizeFirestoreId(prior.claimedUid, 'usr')), {
        role: params.role,
        displayName,
        updatedAt: now,
      });
    }
    await batch.commit();
    return;
  }

  await setDoc(inviteRef, {
    inviteId,
    email: normalizedEmail,
    displayName,
    role: params.role,
    active: true,
    createdByUid: current.uid,
    createdAt: now,
    updatedAt: now,
  });
}

export async function removeOfficialRoleFromFirestore(email: string): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (!current || !current.emailVerified) {
    throw new Error('En verifierad Google-administratör måste vara inloggad.');
  }
  const inviteRef = doc(db, 'roleInvites', emailToInviteId(email));
  const invite = await getDoc(inviteRef);
  if (!invite.exists()) return;
  const data = invite.data();
  const batch = writeBatch(db);
  if (typeof data.claimedUid === 'string') {
    batch.delete(doc(db, 'roleAssignments', sanitizeFirestoreId(data.claimedUid, 'usr')));
  }
  batch.delete(inviteRef);
  await batch.commit();
}

type QueuedBatchOp =
  | { kind: 'set'; ref: DocumentReference; data: Record<string, unknown>; path: string }
  | { kind: 'update'; ref: DocumentReference; data: Record<string, unknown>; path: string }
  | { kind: 'delete'; ref: DocumentReference; path: string };

async function commitQueuedBatchOps(ops: QueuedBatchOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_CHUNK_LIMIT) {
    const slice = ops.slice(i, i + BATCH_CHUNK_LIMIT);
    const batch = writeBatch(db);
    for (const op of slice) {
      if (op.kind === 'set') {
        batch.set(op.ref, op.data);
      } else if (op.kind === 'update') {
        batch.update(op.ref, op.data);
      } else {
        batch.delete(op.ref);
      }
    }
    try {
      await batch.commit();
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.WRITE, slice[0]?.path || 'batch');
    }
  }
}

/**
 * Deletes all competition child documents before deleting the parent document.
 */
export async function deleteCompetitionFromFirestore(rawCompetitionId: string): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (
    !current ||
    !current.emailVerified ||
    !current.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Radering kräver ett inloggat, verifierat Google-administratörskonto.');
  }

  const competitionId = sanitizeFirestoreId(rawCompetitionId, 'evt');
  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const compPath = `competitions/${competitionId}`;

  let competitionData: { ownerUid?: string; status?: string } | null = null;
  try {
    const snap = await getDoc(doc(db, 'competitions', competitionId));
    competitionData = snap.exists()
      ? (snap.data() as { ownerUid?: string; status?: string })
      : null;
  } catch (err) {
    handleWriteOrOfflineError(err, OperationType.GET, compPath);
  }
  if (!competitionData) return;

  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', ownerUid));
  const role = adminSnap?.exists() ? adminSnap.data().role : null;
  const isSuperAdmin = isBootstrapAdmin || role === 'SUPER_ADMIN';
  if (!isSuperAdmin && role !== 'RACE_ADMIN') {
    throw new Error('Ditt Google-konto saknar administratörsbehörighet för att radera tävlingar.');
  }
  if (competitionData.ownerUid !== current.uid && !isSuperAdmin) {
    throw new Error('Du kan bara radera tävlingar du själv äger. Be en huvudadministratör om hjälp.');
  }
  if (competitionData.status === 'COMPLETED' && !isSuperAdmin) {
    throw new Error('Endast en huvudadministratör kan radera avslutade tävlingar.');
  }

  const deleteOps: QueuedBatchOp[] = [];
  const competitorDeletes: CompetitorMutationDeclaration[] = [];
  for (const subName of [
    'courses',
    'classes',
    'competitors',
    'stations',
    'stationPunches',
    'readoutReceipts',
  ] as const) {
    const subPath = `competitions/${competitionId}/${subName}`;
    try {
      const subCollection = collection(db, 'competitions', competitionId, subName);
      const q = isSuperAdmin
        ? query(subCollection)
        : query(subCollection, where('ownerUid', '==', ownerUid));
      const subSnap = await getDocs(q);
      for (const d of subSnap.docs) {
        deleteOps.push({
          kind: 'delete',
          ref: doc(db, 'competitions', competitionId, subName, d.id),
          path: `${subPath}/${d.id}`,
        });
        if (subName === 'competitors') {
          competitorDeletes.push({
            source: 'deleteCompetitionFromFirestore',
            operation: 'DELETE',
            competitionId,
            competitorId: d.id,
            siNumber: Number(d.data().siNumber),
            assignmentHandling: {
              mode: 'LEGACY',
              reason: 'Competition deletion removes competitor documents without retiring their SI assignments.',
            },
            identityAffecting: true,
          });
        }
      }
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.LIST, subPath);
    }
  }

  const deleteCompetition = async () => {
    if (deleteOps.length > 0) {
      await commitQueuedBatchOps(deleteOps);
    }

    try {
      await deleteDoc(doc(db, 'competitions', competitionId));
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.DELETE, compPath);
    }
  };
  if (competitorDeletes.length > 0) {
    await runCompetitorMutations(competitorDeletes, deleteCompetition);
  } else {
    await deleteCompetition();
  }

  const clubRef = doc(db, 'clubSettings', 'default');
  const clubSnap = await getDoc(clubRef);
  if (clubSnap.exists()) {
    const clubData = clubSnap.data() as {
      activeEventId?: unknown;
      competitionIds?: unknown;
    };
    const remainingIds = Array.isArray(clubData.competitionIds)
      ? clubData.competitionIds.filter(
          (id): id is string => typeof id === 'string' && id !== competitionId
        )
      : [];
    await updateDoc(clubRef, {
      activeEventId:
        clubData.activeEventId === competitionId
          ? remainingIds[0] ?? ''
          : typeof clubData.activeEventId === 'string'
            ? clubData.activeEventId
            : '',
      competitionIds: remainingIds,
      swishNumber: deleteField(),
      swishRecipientName: deleteField(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateCompetitionMetadataInFirestore(
  competitionId: string,
  patch: {
    name?: string;
    organizer?: string;
    date?: string;
    status?: EventLifecycleStatus;
    zeroTimeStr?: string;
    zeroTimeSec?: number;
    arenaInfo?: string;
    seriesName?: string;
    allowSelfRegistration?: boolean;
    feeTrackingEnabled?: boolean;
  }
): Promise<void> {
  const statusOnlyUpdate =
    Object.keys(patch).length === 1 && patch.status !== undefined;
  const context = await getCompetitionMutationContext(
    competitionId,
    statusOnlyUpdate ? patch.status : undefined
  );
  const mutable: Record<string, unknown> = {};
  if ('name' in patch) mutable.name = (patch.name || '').trim().slice(0, 140);
  if ('organizer' in patch) mutable.organizer = (patch.organizer || '').trim().slice(0, 100);
  if ('date' in patch) {
    if (!patch.date || !ISO_DATE_REGEX.test(patch.date)) {
      throw new Error('Tävlingens datum måste anges som ÅÅÅÅ-MM-DD.');
    }
    mutable.date = patch.date;
  }
  if ('status' in patch) {
    if (
      patch.status !== 'LIVE' &&
      patch.status !== 'UPCOMING' &&
      patch.status !== 'COMPLETED'
    ) {
      throw new Error('Ogiltig tävlingsstatus.');
    }
    mutable.status = patch.status;
    mutable.statusOverride = true;
  }
  if ('zeroTimeStr' in patch) {
    if (!patch.zeroTimeStr || !CLOCK_REGEX.test(patch.zeroTimeStr)) {
      throw new Error('Ogiltig nolltid.');
    }
    mutable.zeroTimeStr = patch.zeroTimeStr;
    const [hours, minutes, seconds = '0'] = patch.zeroTimeStr.split(':');
    mutable.zeroTimeSec =
      Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
  if ('zeroTimeSec' in patch && !('zeroTimeStr' in patch)) {
    mutable.zeroTimeSec = clampInt(patch.zeroTimeSec, 0, 86400, 36000);
  }
  if ('arenaInfo' in patch) mutable.arenaInfo = (patch.arenaInfo || '').trim().slice(0, 500);
  if ('seriesName' in patch) mutable.seriesName = (patch.seriesName || '').trim().slice(0, 80);
  if ('allowSelfRegistration' in patch) {
    mutable.allowSelfRegistration = Boolean(patch.allowSelfRegistration);
  }
  if ('feeTrackingEnabled' in patch) {
    mutable.feeTrackingEnabled = Boolean(patch.feeTrackingEnabled);
  }
  if (Object.keys(mutable).length === 0) return;
  await updateDoc(doc(db, 'competitions', context.competitionId), {
    ...mutable,
    updatedAt: serverTimestamp(),
  });
}

export async function activateCompetitionInFirestore(
  rawCompetitionId: string
): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (
    !current ||
    !current.emailVerified ||
    !current.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Aktivering kräver ett inloggat, verifierat Google-administratörskonto.');
  }
  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', ownerUid));
  const role = adminSnap?.exists() ? adminSnap.data().role : null;
  const isSuperAdmin = isBootstrapAdmin || role === 'SUPER_ADMIN';
  if (!isSuperAdmin && role !== 'RACE_ADMIN') {
    throw new Error('Ditt Google-konto saknar administratörsbehörighet.');
  }
  const competitionId = sanitizeFirestoreId(rawCompetitionId, 'evt');
  const competitionSnap = await getDoc(doc(db, 'competitions', competitionId));
  if (!competitionSnap.exists()) throw new Error('Tävlingen hittades inte i Firestore.');
  if (competitionSnap.data().ownerUid !== current.uid && !isSuperAdmin) {
    throw new Error('Du saknar behörighet att aktivera den här tävlingen.');
  }

  const clubRef = doc(db, 'clubSettings', 'default');
  const clubSnap = await getDoc(clubRef);
  if (!clubSnap.exists()) throw new Error('Klubbinställningarna saknas i Firestore.');
  const clubData = clubSnap.data();
  if (clubData.ownerUid !== current.uid && !isSuperAdmin) {
    throw new Error('Du saknar behörighet att ändra klubbens aktiva tävling.');
  }
  const competitionIds = Array.isArray(clubData.competitionIds)
    ? clubData.competitionIds.filter(
        (id: unknown): id is string => typeof id === 'string' && SAFE_ID_REGEX.test(id)
      )
    : [];
  await updateDoc(clubRef, {
    activeEventId: competitionId,
    competitionIds: Array.from(new Set([...competitionIds, competitionId])),
    swishNumber: deleteField(),
    swishRecipientName: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

const FIRESTORE_OWNED_COMPETITOR_FIELDS = new Set(['feePaid', 'rentalReturned']);

function warnOnLegacyCompetitorFieldWrite(
  source: string,
  competitorId: string,
  fields: Array<string>
): void {
  if (fields.length === 0) {
    return;
  }
  console.warn(
    `[single-writer] Ignoring legacy ${source} write to Firestore-owned competitor fields for ${competitorId}: ${fields.join(', ')}`
  );
}

async function writeImportedCompetitorWithAssignment(params: {
  competitionId: string;
  competitorId: string;
  ownerUid: string;
  isSuperAdmin: boolean;
  siNumber: number;
  cardSeries: string;
  assignmentSource: 'IMPORT' | 'SYSTEM';
  mutable: Record<string, unknown>;
  createOnly?: boolean;
}): Promise<boolean> {
  const competitionId = sanitizeFirestoreId(params.competitionId, 'evt');
  const competitorId = sanitizeFirestoreId(params.competitorId, 'cmp');
  if (
    !Number.isInteger(params.siNumber) ||
    params.siNumber < 1 ||
    params.siNumber > 99999999
  ) {
    throw new Error(`Deltagare ${competitorId} har ett ogiltigt SI-nummer.`);
  }
  if (!params.cardSeries || params.cardSeries.length > 24) {
    throw new Error(`Deltagare ${competitorId} har en ogiltig kortserie.`);
  }

  const competitorRef = doc(
    db,
    'competitions',
    competitionId,
    'competitors',
    competitorId
  );
  const existingCompetitor = await getDoc(competitorRef);
  if (params.createOnly && existingCompetitor.exists()) return false;
  const intent: AtomicSIAssignmentMutationIntent = existingCompetitor.exists()
    ? 'UPDATE_COMPETITOR_IDENTITY'
    : 'CREATE_COMPETITOR';

  const mutation = await runAtomicSIAssignmentMutation(
    {
      intent,
      competitor: { competitionId, competitorId },
      assignment: { requestedSiNumber: params.siNumber },
    },
    ({
      transaction,
      competitorData,
      assignmentSnapshots,
      result,
    }) => {
      if (result.duplicateCandidateDetected || result.duplicateCandidateQueryError) {
        throw new Error(
          result.duplicateCandidateDetected
            ? `SI-bricka ${params.siNumber} används redan av en annan deltagare.`
            : 'SI-brickans unika ägare kunde inte verifieras. Försök igen.'
        );
      }

      const assignmentSnapshot = assignmentSnapshots.get(params.siNumber);
      const assignment = assignmentSnapshot?.exists()
        ? parseSICardAssignmentDocument(
            assignmentSnapshot.id,
            competitionId,
            assignmentSnapshot.data()
          )
        : null;

      if (intent === 'CREATE_COMPETITOR') {
        if (competitorData) {
          throw new Error(
            `Deltagare ${competitorId} tillkom under importen. Läs in tävlingen igen och försök på nytt.`
          );
        }
        if (
          assignmentSnapshot?.exists() &&
          (!assignment ||
            assignment.state !== 'ACTIVE' ||
            assignment.siNumber !== params.siNumber ||
            assignment.competitorId !== competitorId ||
            assignment.competitorDocumentId !== competitorId ||
            assignment.ownerUid !== params.ownerUid ||
            assignment.cardSeries !== params.cardSeries)
        ) {
          throw new Error(
            `SI-bricka ${params.siNumber} har en befintlig, oförenlig ägartilldelning.`
          );
        }

        if (!assignmentSnapshot?.exists()) {
          transaction.set(
            getCompetitionSICardAssignmentRef(competitionId, params.siNumber),
            {
              competitionId,
              siNumber: params.siNumber,
              cardSeries: params.cardSeries,
              competitorId,
              competitorDocumentId: competitorId,
              state: 'ACTIVE',
              assignmentVersion: 1,
              source: params.assignmentSource,
              ownerUid: params.ownerUid,
              schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }
          );
        }
        transaction.set(competitorRef, {
          ...params.mutable,
          competitorId,
          competitionId,
          ownerUid: params.ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return assignment ? 'ALREADY_MATCHED' : 'CREATED';
      }

      if (!competitorData) {
        throw new Error(`Deltagaren ${competitorId} hittades inte vid importen.`);
      }
      const competitorOwnerUid =
        typeof competitorData.ownerUid === 'string' ? competitorData.ownerUid : '';
      if (
        competitorData.competitorId !== competitorId ||
        competitorData.competitionId !== competitionId ||
        !competitorOwnerUid ||
        (!params.isSuperAdmin && competitorOwnerUid !== params.ownerUid)
      ) {
        throw new Error(`Deltagaren ${competitorId} tillhör inte den här importen.`);
      }
      if (
        Number(competitorData.siNumber) !== params.siNumber ||
        competitorData.cardSeries !== params.cardSeries
      ) {
        throw new Error(
          `SI-nummer eller kortserie för ${competitorId} kan inte ändras via import. Använd SI-tilldelningsflödet.`
        );
      }
      if (
        !assignment ||
        assignment.state !== 'ACTIVE' ||
        assignment.siNumber !== params.siNumber ||
        assignment.competitorId !== competitorId ||
        assignment.competitorDocumentId !== competitorId ||
        assignment.ownerUid !== competitorOwnerUid ||
        assignment.cardSeries !== params.cardSeries
      ) {
        throw new Error(
          `Deltagarens aktiva SI-tilldelning kunde inte verifieras för ${competitorId}.`
        );
      }

      transaction.update(competitorRef, {
        ...params.mutable,
        updatedAt: serverTimestamp(),
      });
      return 'NOT_APPLICABLE';
    }
  );

  if (mutation.status !== 'COMMITTED') {
    throw new Error(`Tävlingen för deltagare ${competitorId} hittades inte i Firestore.`);
  }
  return true;
}

/**
 * Syncs legacy season data (clubSettings, competitions, competitors, SI punches,
 * and empty/demoCleared states) to Firestore under Zero-Trust rules.
 */
export async function syncFullSeasonToFirestore(
  snapshot: CloudSeasonSnapshot,
  isSuperAdmin: boolean
): Promise<{ syncedEvents: number }> {
  const current = await ensureValidFirestoreUser();
  if (!current || !current.emailVerified) {
    return { syncedEvents: 0 };
  }

  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const competitionIds = snapshot.events
    .slice(0, 100)
    .map((ev) => sanitizeFirestoreId(ev.competition.id, 'evt'));

  // 1. Upsert /clubSettings/default
  const clubPath = 'clubSettings/default';
  const clubMutable = {
    demoCleared: Boolean(snapshot.demoCleared),
    competitionIds,
  };
  const legacyBranding = {
    portalTitle: (snapshot.clubSettings.portalTitle || '').trim().slice(0, 80),
    logoDataUrl: sanitizeCloudLogoDataUrl(snapshot.clubSettings.logoDataUrl),
    customBgColor: sanitizeCloudHexColor(snapshot.clubSettings.customBgColor),
    customTextColor: sanitizeCloudHexColor(snapshot.clubSettings.customTextColor),
    customAccentColor: sanitizeCloudHexColor(snapshot.clubSettings.customAccentColor),
  };

  let existingClubOwner: string | null = null;
  let existingClubDoc: Record<string, unknown> | null = null;
  try {
    const clubSnap = await getDoc(doc(db, 'clubSettings', 'default'));
    if (clubSnap.exists()) {
      existingClubDoc = clubSnap.data() as Record<string, unknown>;
      existingClubOwner = (existingClubDoc.ownerUid as string) || null;
    }
  } catch (err) {
    handleWriteOrOfflineError(err, OperationType.GET, clubPath);
  }

  // Preserve Firestore-owned settings while retaining the legacy initial seed behavior.
  if (existingClubDoc) {
    const existingCompetitionIds = Array.isArray(existingClubDoc.competitionIds)
      ? existingClubDoc.competitionIds.filter(
          (id): id is string => typeof id === 'string' && SAFE_ID_REGEX.test(id)
        )
      : [];
    clubMutable.competitionIds = Array.from(
      new Set([...existingCompetitionIds, ...clubMutable.competitionIds])
    ).slice(0, 100);
  }

  if (!existingClubDoc) {
    try {
      await setDoc(doc(db, 'clubSettings', 'default'), {
        settingId: 'default',
        ...clubMutable,
        clubName:
          (snapshot.clubSettings.clubName || 'OK Österåker').trim().slice(0, 100) ||
          'OK Österåker',
        defaultDirectEntryFeeSek: clampInt(
          snapshot.clubSettings.defaultDirectEntryFeeSek,
          0,
          10000,
          100
        ),
        rentalCardFeeSek: clampInt(snapshot.clubSettings.rentalCardFeeSek, 0, 5000, 30),
        missingRentalFeeSek: clampInt(
          snapshot.clubSettings.missingRentalFeeSek,
          0,
          20000,
          650
        ),
        eventorOrgId: (snapshot.clubSettings.eventorOrgId || '').trim().slice(0, 32),
        ...legacyBranding,
        seriesScoringSettings: normalizeSeriesScoringSettings(
          snapshot.clubSettings.seriesScoringSettings
        ),
        activeEventId: snapshot.activeEventId
          ? sanitizeFirestoreId(snapshot.activeEventId, 'evt')
          : '',
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.CREATE, clubPath);
    }
  } else if (existingClubOwner === ownerUid || isSuperAdmin) {
    try {
      const activeEventId =
        typeof existingClubDoc?.activeEventId === 'string'
          ? existingClubDoc.activeEventId
          : snapshot.activeEventId
            ? sanitizeFirestoreId(snapshot.activeEventId, 'evt')
            : '';
      await updateDoc(doc(db, 'clubSettings', 'default'), {
        ...clubMutable,
        swishNumber: deleteField(),
        swishRecipientName: deleteField(),
        ...(existingClubDoc?.activeEventId === undefined ? { activeEventId } : {}),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.UPDATE, clubPath);
    }
  }

  // 2. Sync legacy competition metadata and seed missing competitor documents.
  let syncedEvents = 0;
  for (const ev of snapshot.events.slice(0, 100)) {
    const competitionId = sanitizeFirestoreId(ev.competition.id, 'evt');
    const rawShort = sanitizeFirestoreId(ev.competition.shortCode || 'oko26', 'sc').slice(0, 32);
    const shortCode = rawShort.length >= 2 ? rawShort : 'ev26';
    const targetStatus: EventLifecycleStatus =
      ev.competition.status === 'LIVE' ||
      ev.competition.status === 'UPCOMING' ||
      ev.competition.status === 'COMPLETED'
        ? ev.competition.status
        : 'LIVE';
    const competitorCount = clampInt(ev.competitors.length, 0, 50000, 0);
    const rawFinished = ev.competitors.filter(
      (c) => c.status === 'OK' || c.status === 'MP' || c.status === 'PRELIMINARY_FIN'
    ).length;
    const finishedCount = Math.min(competitorCount, clampInt(rawFinished, 0, 50000, 0));

    const compMutableBase = {
      shortCode,
      name: (ev.competition.name || 'Tävling').trim().slice(0, 140) || 'Tävling',
      organizer: (ev.competition.organizer || 'Klubb').trim().slice(0, 100) || 'Klubb',
      date: ISO_DATE_REGEX.test(ev.competition.date)
        ? ev.competition.date
        : getStockholmTodayIso(),
      zeroTimeStr: CLOCK_REGEX.test(ev.competition.zeroTimeStr)
        ? ev.competition.zeroTimeStr
        : '10:00:00',
      zeroTimeSec: clampInt(ev.competition.zeroTimeSec, 0, 86400, 36000),
      statusOverride: Boolean(ev.competition.statusOverride),
      arenaInfo: (ev.competition.arenaInfo || '').trim().slice(0, 500),
      seriesName: (ev.competition.seriesName || '').trim().slice(0, 80),
      allowSelfRegistration: Boolean(ev.competition.allowSelfRegistration),
      feeTrackingEnabled: Boolean(ev.competition.feeTrackingEnabled),
      competitorCount,
      finishedCount,
      brokenControls: (ev.brokenControls || [])
        .slice(0, 64)
        .map((n) => clampInt(n, 1, 999, 31)),
      ...(ev.emergency
        ? { controlTimeOffsets: normalizeControlTimeOffsets(ev.emergency.controlTimeOffsets) }
        : {}),
    };

    const compPath = `competitions/${competitionId}`;
    let existingComp: {
      status?: string;
      statusOverride?: boolean;
      date?: string;
      zeroTimeStr?: string;
      ownerUid?: string;
    } | null = null;
    try {
      const snap = await getDoc(doc(db, 'competitions', competitionId));
      if (snap.exists()) {
        existingComp = snap.data() as { status?: string; ownerUid?: string };
      }
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.GET, compPath);
    }

    const canMirrorDerivedStatus = Boolean(
      existingComp &&
        existingComp.statusOverride !== true &&
        existingComp.date === compMutableBase.date &&
        existingComp.zeroTimeStr === compMutableBase.zeroTimeStr
    );
    if (existingComp) {
      const isOwner = existingComp.ownerUid === ownerUid;
      const isManualReopen =
        ev.competition.statusOverride === true && targetStatus !== 'COMPLETED';
      const lockedTerminal =
        existingComp.status === 'COMPLETED' && !isSuperAdmin && !isManualReopen;
      if ((!isOwner && !isSuperAdmin) || lockedTerminal) {
        continue;
      }
    }

    // Create parent competition first if missing so subcollection Master Gate exists() passes
    if (!existingComp) {
      try {
        const competitionRef = doc(db, 'competitions', competitionId);
        await runTransaction(db, async (transaction) => {
          const current = await transaction.get(competitionRef);
          if (current.exists()) return;
          transaction.set(competitionRef, {
            competitionId,
            ...compMutableBase,
            status: targetStatus,
            ownerUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      } catch (err) {
        handleWriteOrOfflineError(err, OperationType.CREATE, compPath);
      }
    }

    const childOps: QueuedBatchOp[] = [];
    const competitorSeeds: Array<{
      competitorId: string;
      siNumber: number;
      cardSeries: string;
      mutable: Record<string, unknown>;
    }> = [];

    // Courses and classes are Firestore-owned and excluded from legacy snapshots.

    // Existing competitor documents are protected from legacy snapshot writes.
    const existingCompIds = new Set<string>();
    const existingCompetitors = new Map<string, Record<string, unknown>>();
    try {
      const cmpSnap = await getDocs(
        collection(db, 'competitions', competitionId, 'competitors')
      );
      cmpSnap.docs.forEach((d) => {
        existingCompIds.add(d.id);
        existingCompetitors.set(d.id, d.data());
      });
    } catch (err) {
      handleWriteOrOfflineError(err, OperationType.LIST, `competitions/${competitionId}/competitors`);
    }

    const nextCompIds = new Set<string>();
    for (const cmp of ev.competitors) {
      const competitorId = sanitizeFirestoreId(cmp.id, 'cmp');
      nextCompIds.add(competitorId);
      const rawPunches = (cmp.rawReadout?.punches ?? cmp.cardPunches ?? []).slice(0, 192);
      const punchCodes = rawPunches.map((p) => clampInt(p.code, 1, 999, 31));
      const punchTimes = rawPunches.map((p) => clampInt(p.timeSec, 0, 86400, 0));
      const status: RunnerStatus =
        cmp.status === 'REGISTERED' ||
        cmp.status === 'CHECKED' ||
        cmp.status === 'IN_FOREST' ||
        cmp.status === 'PRELIMINARY_FIN' ||
        cmp.status === 'OK' ||
        cmp.status === 'MP' ||
        cmp.status === 'DNF' ||
        cmp.status === 'DNS'
          ? cmp.status
          : 'REGISTERED';

      const legacyBillingFields = Object.keys(cmp).filter((key) =>
        FIRESTORE_OWNED_COMPETITOR_FIELDS.has(key)
      );
      if (legacyBillingFields.length > 0) {
        warnOnLegacyCompetitorFieldWrite(
          'snapshot sync',
          competitorId,
          legacyBillingFields
        );
      }

      const cmpMutable = {
        bib: clampInt(cmp.bib, 1, 99999, 1),
        fullName: (cmp.fullName || 'Deltagare').trim().slice(0, 120) || 'Deltagare',
        club: (cmp.club || 'Klubblös').trim().slice(0, 100) || 'Klubblös',
        classId: sanitizeFirestoreId(cmp.classId || 'cls_open', 'cls'),
        siNumber: Number(cmp.siNumber),
        cardSeries: (cmp.cardSeries || 'SI-Card 10').trim().slice(0, 24) || 'SI-Card 10',
        isRentalCard: Boolean(cmp.isRentalCard),
        status,
        allocatedStartSec: encodeNullableSec(cmp.allocatedStartSec),
        checkTimeSec: encodeNullableSec(cmp.rawReadout?.checkTimeSec ?? cmp.checkTimeSec),
        startTimeSec: encodeNullableSec(cmp.rawReadout?.startTimeSec ?? cmp.startTimeSec),
        finishTimeSec: encodeNullableSec(cmp.rawReadout?.finishTimeSec ?? cmp.finishTimeSec),
        manualFinishTimeSec: encodeNullableSec(cmp.manualFinishTimeSec),
        runningTimeSec: encodeNullableSec(cmp.runningTimeSec),
        readoutAtIso: (cmp.readoutAt || '').trim().slice(0, 40),
        punchCodes,
        punchTimes,
      };

      if (existingCompIds.has(competitorId)) {
        const existingData = existingCompetitors.get(competitorId) ?? {};
        const proposedFields: Record<string, unknown> = { ...cmpMutable };
        if (typeof cmp.feePaid === 'boolean') proposedFields.feePaid = cmp.feePaid;
        if (typeof cmp.rentalReturned === 'boolean') {
          proposedFields.rentalReturned = cmp.rentalReturned;
        }
        const changedFields = getChangedSnapshotFields(existingData, proposedFields);
        if (changedFields.length > 0) {
          console.warn(
            `[single-writer] Blocked legacy snapshot overwrite of Firestore competitor ${competitorId} in ${competitionId}; changed fields: ${changedFields.join(', ')}`
          );
        }
        continue;
      }

      competitorSeeds.push({
        competitorId,
        siNumber: cmpMutable.siNumber,
        cardSeries: cmpMutable.cardSeries,
        mutable: cmpMutable,
      });
    }
    for (const oldId of existingCompIds) {
      if (!nextCompIds.has(oldId)) {
        console.warn(
          `[single-writer] Blocked legacy snapshot omission from deleting Firestore competitor ${oldId} in ${competitionId}.`
        );
      }
    }

    if (ev.stations) {
      const existingStationIds = new Set<string>();
      try {
        const stationSnap = await getDocs(
          query(
            collection(db, 'competitions', competitionId, 'stations'),
            where('ownerUid', '==', ownerUid)
          )
        );
        stationSnap.docs.forEach((station) => existingStationIds.add(station.id));
      } catch (err) {
        handleWriteOrOfflineError(err, OperationType.LIST, `competitions/${competitionId}/stations`);
      }

      const nextStationIds = new Set<string>();
      for (const station of ev.stations) {
        const stationId = sanitizeFirestoreId(station.id, 'st');
        nextStationIds.add(stationId);
        const stationRef = doc(db, 'competitions', competitionId, 'stations', stationId);
        const stationMutable = {
          stationCode: clampInt(station.stationCode, 1, 999, 42),
          name: (station.name || 'SI-station').trim().slice(0, 120) || 'SI-station',
          hardwareModel: station.hardwareModel,
          stationFunction: station.stationFunction,
          baudRate: station.baudRate === 4800 ? 4800 : 38400,
          extendedProtocol: Boolean(station.extendedProtocol),
          batteryMv: clampInt(station.batteryMv, 0, 6000, 0),
          firmware: (station.firmware || '').trim().slice(0, 80),
          lastSeenAt: station.lastSeenAt || '',
          active: station.active !== false,
        };
        if (existingStationIds.has(stationId)) {
          childOps.push({
            kind: 'update',
            ref: stationRef,
            path: `competitions/${competitionId}/stations/${stationId}`,
            data: { ...stationMutable, updatedAt: serverTimestamp() },
          });
        } else {
          childOps.push({
            kind: 'set',
            ref: stationRef,
            path: `competitions/${competitionId}/stations/${stationId}`,
            data: {
              stationId,
              competitionId,
              ownerUid,
              ...stationMutable,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
          });
        }
      }
      for (const oldId of existingStationIds) {
        if (!nextStationIds.has(oldId)) {
          childOps.push({
            kind: 'delete',
            ref: doc(db, 'competitions', competitionId, 'stations', oldId),
            path: `competitions/${competitionId}/stations/${oldId}`,
          });
        }
      }
    }

    if (childOps.length > 0) {
      await commitQueuedBatchOps(childOps);
    }
    for (const seed of competitorSeeds) {
      const created = await writeImportedCompetitorWithAssignment({
        competitionId,
        competitorId: seed.competitorId,
        ownerUid,
        isSuperAdmin,
        siNumber: seed.siNumber,
        cardSeries: seed.cardSeries,
        assignmentSource: 'SYSTEM',
        mutable: seed.mutable,
        createOnly: true,
      });
      if (!created) {
        console.warn(
          `[single-writer] Skipped snapshot seed because Firestore competitor ${seed.competitorId} appeared during synchronization.`
        );
      }
    }

    // Keep derived counts and emergency settings mirrored without changing canonical metadata.
    if (existingComp) {
      try {
        await updateDoc(doc(db, 'competitions', competitionId), {
          competitorCount,
          finishedCount,
          ...(canMirrorDerivedStatus ? { status: targetStatus } : {}),
          brokenControls: compMutableBase.brokenControls,
          ...(ev.emergency
            ? {
                controlTimeOffsets: normalizeControlTimeOffsets(
                  ev.emergency.controlTimeOffsets
                ),
              }
            : {}),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleWriteOrOfflineError(err, OperationType.UPDATE, compPath);
      }
    }

    syncedEvents += 1;
  }

  return { syncedEvents };
}

/**
 * Loads the complete season or a single competition from Firestore.
 * Returns null if `clubSettings/default` has not been created yet so fresh apps sync upward first.
 */
export async function loadFullSeasonFromFirestore(options?: {
  competitionId?: string;
  includeRunnerDb?: boolean;
}): Promise<CloudSeasonSnapshot | null> {
  const clubPath = 'clubSettings/default';

  interface CloudClubDocData {
    clubName?: string;
    eventorOrgId?: string;
    defaultDirectEntryFeeSek?: number;
    rentalCardFeeSek?: number;
    missingRentalFeeSek?: number;
    portalTitle?: string;
    logoDataUrl?: string;
    customBgColor?: string;
    customTextColor?: string;
    customAccentColor?: string;
    seriesScoringSettings?: unknown;
    activeEventId?: string;
    demoCleared?: boolean;
    competitionIds?: string[];
  }

  let clubData: CloudClubDocData | null = null;

  try {
    const clubSnap = await getDoc(doc(db, 'clubSettings', 'default'));
    if (clubSnap.exists()) {
      clubData = clubSnap.data() as CloudClubDocData;
    }
  } catch (err) {
    if (isTransientOfflineFirestoreError(err)) {
      if (isTokenServiceError(err)) {
        setTokenServiceDisabled(true);
        void signOut(auth).catch(() => {});
      }
      return null;
    }
    handleFirestoreError(err, OperationType.GET, clubPath);
  }

  const clubSettings: ClubSettings = {
    clubName: (clubData?.clubName || 'OK Österåker').trim().slice(0, 100) || 'OK Österåker',
    eventorOrgId: clubData?.eventorOrgId || '',
    defaultDirectEntryFeeSek: Number(clubData?.defaultDirectEntryFeeSek ?? 0),
    rentalCardFeeSek: Number(clubData?.rentalCardFeeSek ?? 0),
    missingRentalFeeSek: Number(clubData?.missingRentalFeeSek ?? 0),
    portalTitle: (clubData?.portalTitle || '').trim().slice(0, 80),
    logoDataUrl: sanitizeCloudLogoDataUrl(clubData?.logoDataUrl),
    customBgColor: sanitizeCloudHexColor(clubData?.customBgColor),
    customTextColor: sanitizeCloudHexColor(clubData?.customTextColor),
    customAccentColor: sanitizeCloudHexColor(clubData?.customAccentColor),
    seriesScoringSettings: normalizeSeriesScoringSettings(clubData?.seriesScoringSettings),
  };

  let targetIds = options?.competitionId
    ? [sanitizeFirestoreId(options.competitionId, 'evt')]
    : Array.isArray(clubData?.competitionIds)
      ? clubData.competitionIds
      : [];
  
  // Merge targetIds with all reachable competitions from /competitions directly
  try {
    const compCol = collection(db, 'competitions');
    const compListSnap = await getDocs(compCol).catch(async () => {
      const current = auth.currentUser;
      return current ? await getDocs(query(compCol, where('ownerUid', '==', current.uid))) : null;
    });
    if (compListSnap) {
      const colIds = compListSnap.docs.map((d) => d.id);
      targetIds = Array.from(new Set([...targetIds, ...colIds]));
    }
  } catch {
    // If collection listing is restricted, keep existing targetIds
  }

  if (targetIds.length === 0) {
    return {
      activeEventId: '',
      demoCleared: Boolean(clubData?.demoCleared),
      clubSettings,
      events: [],
      runnerDb: options?.includeRunnerDb === false ? [] : await loadRunnerDbFromFirestore(),
    };
  }

  const events: CloudEventExportItem[] = [];
  for (const rawCompId of targetIds) {
    const competitionId = sanitizeFirestoreId(rawCompId, 'evt');
    const compPath = `competitions/${competitionId}`;
    let compDocData: Record<string, unknown> | null = null;
    try {
      const cSnap = await getDoc(doc(db, 'competitions', competitionId));
      if (cSnap.exists()) {
        compDocData = cSnap.data() as Record<string, unknown>;
      }
    } catch (err) {
      if (isTransientOfflineFirestoreError(err)) {
        return null;
      }
      handleFirestoreError(err, OperationType.GET, compPath);
    }
    if (!compDocData) continue;

    const courses: Course[] = [];
    const classes: CompClass[] = [];
    const competitors: Competitor[] = [];
    const brokenControls = Array.isArray(compDocData.brokenControls)
      ? (compDocData.brokenControls as unknown[]).map(Number)
      : [];
    const controlTimeOffsets = normalizeControlTimeOffsets(compDocData.controlTimeOffsets);
    const emergency: EmergencySettings = { brokenControls, controlTimeOffsets };

    try {
      const crsSnap = await getDocs(
        collection(db, 'competitions', competitionId, 'courses')
      );
      for (const d of crsSnap.docs) {
        const cd = d.data() as {
          courseId: string;
          name: string;
          lengthMeters: number;
          climbMeters: number;
          controls: number[];
        };
        courses.push({
          id: cd.courseId || d.id,
          name: cd.name || 'Bana',
          lengthMeters: Number(cd.lengthMeters || 0),
          climbMeters: Number(cd.climbMeters || 0),
          controls: Array.isArray(cd.controls) ? cd.controls.map(Number) : [],
        });
      }
    } catch (err) {
      if (isTransientOfflineFirestoreError(err)) {
        return null;
      }
      handleFirestoreError(err, OperationType.LIST, `competitions/${competitionId}/courses`);
    }

    try {
      const clsSnap = await getDocs(
        collection(db, 'competitions', competitionId, 'classes')
      );
      for (const d of clsSnap.docs) {
        const cld = d.data() as {
          classId: string;
          name: string;
          courseId: string;
          classFormat: ClassCompetitionFormat;
          forkCourseIds: string[];
          rogainingMaxTimeSec: number;
          rogainingPenaltyPerMin: number;
          allowDirectEntry: boolean;
          freeStart: boolean;
          autoMatchCourse: boolean;
          feeSek: number;
        };
        classes.push({
          id: cld.classId || d.id,
          name: cld.name || 'Klass',
          courseId: cld.courseId ? cld.courseId : null,
          classFormat: cld.classFormat || 'STANDARD',
          forkCourseIds: Array.isArray(cld.forkCourseIds) ? cld.forkCourseIds : [],
          rogainingMaxTimeSec: decodeNullableSec(cld.rogainingMaxTimeSec),
          rogainingPenaltyPerMin:
            Number(cld.rogainingPenaltyPerMin) >= 0 ? Number(cld.rogainingPenaltyPerMin) : null,
          allowDirectEntry: Boolean(cld.allowDirectEntry),
          freeStart: Boolean(cld.freeStart),
          autoMatchCourse: Boolean(cld.autoMatchCourse),
          feeSek: Number(cld.feeSek ?? 100),
        });
      }
    } catch (err) {
      if (isTransientOfflineFirestoreError(err)) {
        return null;
      }
      handleFirestoreError(err, OperationType.LIST, `competitions/${competitionId}/classes`);
    }

    let stationDocs: DocumentSnapshot[] = [];
    try {
      const stationSnapshots = await getDocs(
        collection(db, 'competitions', competitionId, 'stations')
      );
      stationDocs = stationSnapshots.docs;
    } catch (err) {
      if (isTransientOfflineFirestoreError(err)) {
        return null;
      }
      if (isPermissionDeniedFirestoreError(err)) {
        console.error(
          `Behörighet saknas för stationsinställningar i competitions/${competitionId}/stations:`,
          err
        );
      } else {
        handleFirestoreError(err, OperationType.LIST, `competitions/${competitionId}/stations`);
      }
    }
    const stationFunctions = new Map<number, StationFunction>();
    for (const stationDoc of stationDocs) {
      const station = stationDoc.data();
      if (!station) continue;
      const code = Number(station.stationCode);
      const stationFunction = station.stationFunction as StationFunction;
      if (Number.isInteger(code) && code >= 1 && code <= 999) {
        stationFunctions.set(code, stationFunction);
      }
    }

    try {
      const cmpSnap = await getDocs(
        collection(db, 'competitions', competitionId, 'competitors')
      );
      for (const d of cmpSnap.docs) {
        const cmd = d.data() as {
          competitorId: string;
          bib: number;
          fullName: string;
          club: string;
          classId: string;
          siNumber: number;
          cardSeries: SICardSeries;
          isRentalCard: boolean;
          rentalReturned: boolean;
          feePaid: boolean;
          status: RunnerStatus;
          allocatedStartSec: number;
          checkTimeSec: number;
          startTimeSec: number;
          finishTimeSec: number;
          manualFinishTimeSec: number;
          runningTimeSec: number;
          readoutAtIso: string;
          punchCodes: number[];
          punchTimes: number[];
        };
        const codes = Array.isArray(cmd.punchCodes) ? cmd.punchCodes.map(Number) : [];
        const times = Array.isArray(cmd.punchTimes) ? cmd.punchTimes.map(Number) : [];
        const len = Math.min(codes.length, times.length);
        const punches = [];
        for (let idx = 0; idx < len; idx++) {
          punches.push({ code: codes[idx], timeSec: times[idx] });
        }
        const checkSec = decodeNullableSec(cmd.checkTimeSec);
        const startSec = decodeNullableSec(cmd.startTimeSec);
        const finishSec = decodeNullableSec(cmd.finishTimeSec);
        const manualFinishSec = decodeNullableSec(cmd.manualFinishTimeSec);
        const allocatedStartSec = decodeNullableSec(cmd.allocatedStartSec);
        const hasReadout = Boolean(cmd.readoutAtIso) || punches.length > 0;
        const effectiveFinish = manualFinishSec ?? finishSec;
        const validation =
          hasReadout && effectiveFinish !== null
            ? validateCompetitorReadout(
                classes.find((candidate) => candidate.id === cmd.classId),
                courses,
                startSec ??
                  allocatedStartSec ??
                  Number(compDocData.zeroTimeSec ?? 36000),
                effectiveFinish,
                punches,
                  emergency
              )
            : null;

        competitors.push({
          id: cmd.competitorId || d.id,
          bib: Number(cmd.bib || 1),
          fullName: cmd.fullName || 'Deltagare',
          club: cmd.club || 'Klubblös',
          classId: cmd.classId || classes[0]?.id || 'cls_open',
          siNumber: Number(cmd.siNumber || 1000),
          cardSeries: cmd.cardSeries || 'SI-Card 10',
          isRentalCard: Boolean(cmd.isRentalCard),
          rentalReturned: Boolean(cmd.rentalReturned),
          feePaid: Boolean(cmd.feePaid),
          status: cmd.status || 'REGISTERED',
          allocatedStartSec,
          checkTimeSec: checkSec,
          startTimeSec: startSec,
          finishTimeSec: finishSec,
          manualFinishTimeSec: manualFinishSec,
          runningTimeSec: decodeNullableSec(cmd.runningTimeSec),
          lastSeenControl: punches.length > 0 ? 1 : null,
          lastSeenTimeSec: finishSec ?? startSec ?? checkSec,
          readoutAt: cmd.readoutAtIso ? cmd.readoutAtIso : null,
          radioSplits: [],
          cardPunches: punches,
          rawReadout: hasReadout
            ? {
                checkTimeSec: checkSec,
                startTimeSec: startSec,
                finishTimeSec: finishSec,
                punches,
                receivedAt: cmd.readoutAtIso || new Date().toISOString(),
              }
            : null,
          validation,
        });
      }
      let stationPunchDocs: DocumentSnapshot[] = [];
      try {
        const stationPunchSnap = await getDocs(
          collection(db, 'competitions', competitionId, 'stationPunches')
        );
        stationPunchDocs = stationPunchSnap.docs;
      } catch (err) {
        if (isTransientOfflineFirestoreError(err)) {
          return null;
        }
        if (isPermissionDeniedFirestoreError(err)) {
          console.error(
            `Behörighet saknas för radiostämplingar i competitions/${competitionId}/stationPunches:`,
            err
          );
        } else {
          handleFirestoreError(
            err,
            OperationType.LIST,
            `competitions/${competitionId}/stationPunches`
          );
        }
      }
      for (const punchDoc of stationPunchDocs) {
        const punch = punchDoc.data();
        if (!punch) continue;
        const stationFunction =
          stationFunctions.get(Number(punch.stationCode)) ?? 'RADIO';
        if (
          stationFunction !== 'RADIO' &&
          stationFunction !== 'PREWARNING'
        ) {
          continue;
        }
        const competitor = competitors.find(
          (candidate) =>
            candidate.id === punch.competitorId &&
            candidate.siNumber === Number(punch.siNumber)
        );
        if (!competitor) continue;
        const split = {
          controlCode: Number(punch.stationCode),
          stationName: String(punch.stationName || `(${punch.stationCode})`),
          punchTimeSec: Number(punch.punchTimeSec),
          runningTimeSec: decodeNullableSec(punch.runningTimeSec),
          isPrewarning: stationFunction === 'PREWARNING',
        };
        competitor.radioSplits = [
          ...competitor.radioSplits.filter(
            (existing) => existing.controlCode !== split.controlCode
          ),
          split,
        ].sort((a, b) => a.punchTimeSec - b.punchTimeSec);
      }
      competitors.sort((a, b) => a.bib - b.bib);
    } catch (err) {
      if (isTransientOfflineFirestoreError(err)) {
        return null;
      }
      handleFirestoreError(err, OperationType.LIST, `competitions/${competitionId}/competitors`);
    }

    const statusRaw = String(compDocData.status || 'LIVE');
    const status: EventLifecycleStatus =
      statusRaw === 'LIVE' || statusRaw === 'UPCOMING' || statusRaw === 'COMPLETED'
        ? statusRaw
        : 'LIVE';
    const stations: SIStation[] = stationDocs.flatMap((stationDoc) => {
      const station = stationDoc.data();
      if (!station) return [];
      const hardwareModels: SIStation['hardwareModel'][] = [
        'BSM8-USB',
        'BSM7-USB',
        'SRR-USB (Air+)',
        'BSF9 Master',
        'BSF8 Master',
      ];
      const stationFunctions: StationFunction[] = [
        'CLEAR',
        'CHECK',
        'START',
        'RADIO',
        'PREWARNING',
        'FINISH',
        'READOUT',
      ];
      return [{
        id: station.stationId || stationDoc.id,
        stationCode: Number(station.stationCode || 42),
        name: String(station.name || `Station ${station.stationCode || 42}`),
        hardwareModel: hardwareModels.includes(station.hardwareModel)
          ? station.hardwareModel
          : 'SRR-USB (Air+)',
        stationFunction: stationFunctions.includes(station.stationFunction)
          ? station.stationFunction
          : 'RADIO',
        baudRate: station.baudRate === 4800 ? 4800 : 38400,
        extendedProtocol: Boolean(station.extendedProtocol),
        batteryMv: Number(station.batteryMv || 0),
        firmware: String(station.firmware || ''),
        lastSeenAt: typeof station.lastSeenAt === 'string' && station.lastSeenAt
          ? station.lastSeenAt
          : null,
        active: station.active !== false,
      }];
    });

    events.push({
      competition: {
        id: competitionId,
        shortCode: String(compDocData.shortCode || 'oko26'),
        status,
        statusOverride: Boolean(compDocData.statusOverride),
        name: String(compDocData.name || 'Tävling'),
        organizer: String(compDocData.organizer || clubSettings.clubName),
        date: String(compDocData.date || getStockholmTodayIso()),
        zeroTimeStr: String(compDocData.zeroTimeStr || '10:00:00'),
        zeroTimeSec: Number(compDocData.zeroTimeSec ?? 36000),
        arenaInfo: String(compDocData.arenaInfo || ''),
        seriesName: String(compDocData.seriesName || ''),
        allowSelfRegistration: Boolean(compDocData.allowSelfRegistration),
        feeTrackingEnabled: Boolean(
          compDocData.feeTrackingEnabled ?? compDocData.enableFeesAndSwish
        ),
      },
      courses,
      classes,
      competitors,
      stations,
      brokenControls,
      emergency,
    });
  }

  return {
    activeEventId: clubData?.activeEventId || events[0]?.competition.id || '',
    demoCleared: Boolean(clubData?.demoCleared),
    clubSettings,
    events,
    seriesStandings: calculateSeriesStandings(
      events.map((event) => ({
        competition: event.competition,
        classes: event.classes,
        competitors: event.competitors,
      })),
      clubSettings.seriesScoringSettings
    ),
    runnerDb: options?.includeRunnerDb === false ? [] : await loadRunnerDbFromFirestore(),
  };
}

function parseRunnerDbDocument(id: string, data: Record<string, unknown>): RunnerDbEntry | null {
    const siNumber = Number(data.siNumber);
    if (!Number.isInteger(siNumber) || siNumber < 1 || siNumber > 99999999) return null;
    const cardSeries = [
      'SI-Card 5',
      'SI-Card 6',
      'SI-Card 8',
      'SI-Card 9',
      'SI-Card 10',
      'SI-Card 11',
      'SIAC Air+',
    ].includes(String(data.cardSeries))
      ? (data.cardSeries as SICardSeries)
      : 'SI-Card 10';
    const source =
      data.source === 'EVENTOR_API' ||
      data.source === 'EVENTOR_XML' ||
      data.source === 'MEOS_CSV'
        ? data.source
        : 'LEARNED_ENTRY';
    return {
      id,
      siNumber,
      cardSeries,
      fullName: String(data.fullName || ''),
      club: String(data.club || ''),
      birthYear:
        typeof data.birthYear === 'number' && Number.isInteger(data.birthYear)
          ? data.birthYear
          : null,
      defaultClassName:
        typeof data.defaultClassName === 'string' ? data.defaultClassName : null,
      eventorPersonId: typeof data.eventorPersonId === 'string' ? data.eventorPersonId : null,
      eventorOrgId: typeof data.eventorOrgId === 'string' ? data.eventorOrgId : null,
      source,
      updatedAt:
        typeof data.updatedAtIso === 'string' ? data.updatedAtIso : new Date(0).toISOString(),
    };
}

export function subscribeCompetitorBillingFieldsFromFirestore(
  competitionId: string,
  onFields: (
    fields: Array<{
      competitorId: string;
      feePaid: boolean;
      rentalReturned: boolean;
    }>
  ) => void,
  onError: (error: Error) => void
): () => void {
  const competitionPath = sanitizeFirestoreId(competitionId, 'evt');
  return onSnapshot(
    collection(db, 'competitions', competitionPath, 'competitors'),
    (snapshot) => {
      onFields(
        snapshot.docs.map((competitorDoc) => ({
          competitorId: competitorDoc.id,
          feePaid: Boolean(competitorDoc.data().feePaid),
          rentalReturned: Boolean(competitorDoc.data().rentalReturned),
        }))
      );
    },
    (error) => onError(error)
  );
}

async function loadRunnerDbFromFirestore(): Promise<RunnerDbEntry[]> {
  const authorization = await getCurrentFirebaseRoles();
  if (
    !authorization.adminTier &&
    !['START', 'READOUT', 'FOREST', 'SPEAKER'].includes(
      authorization.officialRole || ''
    )
  ) {
    return [];
  }

  const runnerSnap = await getDocs(collection(db, 'runnerDb'));
  return runnerSnap.docs.flatMap((runnerDoc) => {
    const runner = parseRunnerDbDocument(
      runnerDoc.id,
      runnerDoc.data() as Record<string, unknown>
    );
    return runner ? [runner] : [];
  });
}

export async function loadRunnerDbEntriesFromFirestore(): Promise<RunnerDbEntry[]> {
  return loadRunnerDbFromFirestore();
}

export function subscribeRunnerDbFromFirestore(
  onEntries: (entries: RunnerDbEntry[]) => void,
  onError: (error: Error) => void
): () => void {
  let active = true;
  let unsubscribe = () => {};
  void getCurrentFirebaseRoles()
    .then((authorization) => {
      if (
        !authorization.adminTier &&
        !['START', 'READOUT', 'FOREST', 'SPEAKER'].includes(
          authorization.officialRole || ''
        )
      ) {
        throw new Error('Ditt Google-konto saknar roll för löpardatabasen.');
      }
      if (!active) return;
      unsubscribe = onSnapshot(
        collection(db, 'runnerDb'),
        (snapshot) => {
          if (!active) return;
          onEntries(
            snapshot.docs.flatMap((runnerDoc) => {
              const runner = parseRunnerDbDocument(
                runnerDoc.id,
                runnerDoc.data() as Record<string, unknown>
              );
              return runner ? [runner] : [];
            })
          );
        },
        (error) => {
          if (active) onError(error);
        }
      );
    })
    .catch((error: unknown) => {
      if (active) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  return () => {
    active = false;
    unsubscribe();
  };
}

export async function saveCompetitionImportToFirestore(params: {
  competitionId: string;
  courses: Course[];
  classes: CompClass[];
  competitors: Competitor[];
  runnerDbEntries: RunnerDbEntry[];
  competitorCount: number;
  replaceCoursesAndClasses?: boolean;
}): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (
    !current ||
    !current.emailVerified ||
    !current.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Importen kräver ett inloggat, verifierat Google-administratörskonto.');
  }
  const adminSnap = await getDoc(doc(db, 'admins', sanitizeFirestoreId(current.uid, 'usr')));
  const role = adminSnap.exists() ? adminSnap.data().role : null;
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  if (!isBootstrapAdmin && role !== 'RACE_ADMIN' && role !== 'SUPER_ADMIN') {
    throw new Error('Ditt Google-konto saknar administratörsbehörighet för Firestore-import.');
  }

  const competitionId = sanitizeFirestoreId(params.competitionId, 'evt');
  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const competitionRef = doc(db, 'competitions', competitionId);
  const competitionSnap = await getDoc(competitionRef);
  if (!competitionSnap.exists()) {
    throw new Error('Tävlingen hittades inte i Firestore.');
  }
  const competitionData = competitionSnap.data();
  const isSuperAdmin = isBootstrapAdmin || role === 'SUPER_ADMIN';
  if (competitionData.ownerUid !== current.uid && !isSuperAdmin) {
    throw new Error('Du saknar behörighet att importera data till den här tävlingen.');
  }
  if (competitionData.status === 'COMPLETED' && !isSuperAdmin) {
    throw new Error('Import kan inte göras till en avslutad tävling.');
  }

  if (params.replaceCoursesAndClasses) {
    const retainedClassIds = new Set(
      params.classes.map((cls) => sanitizeFirestoreId(cls.id, 'cls'))
    );
    const existingClasses = await getDocs(
      collection(db, 'competitions', competitionId, 'classes')
    );
    const staleClassIds = existingClasses.docs
      .filter(
        (classDoc) =>
          !retainedClassIds.has(classDoc.id) &&
          (classDoc.data().ownerUid === ownerUid || isSuperAdmin)
      )
      .map((classDoc) => classDoc.id);
    for (let offset = 0; offset < staleClassIds.length; offset += 30) {
      const staleIds = staleClassIds.slice(offset, offset + 30);
      const referencedCompetitors = await getDocs(
        query(
          collection(db, 'competitions', competitionId, 'competitors'),
          where('classId', 'in', staleIds)
        )
      );
      if (!referencedCompetitors.empty) {
        const classNames = new Map(
          existingClasses.docs.map((classDoc) => [
            classDoc.id,
            typeof classDoc.data().name === 'string' ? classDoc.data().name : classDoc.id,
          ])
        );
        const referencedNames = Array.from(
          new Set(
            referencedCompetitors.docs.map(
              (competitorDoc) =>
                classNames.get(String(competitorDoc.data().classId)) ||
                String(competitorDoc.data().classId)
            )
          )
        );
        throw new Error(
          `Importen kan inte ta bort klasser som används av deltagare: ${referencedNames.join(', ')}.`
        );
      }
    }
  }

  const operations: Array<{
    ref: DocumentReference;
    existing: boolean;
    mutable: Record<string, unknown>;
    createData: Record<string, unknown>;
  }> = [];
  const competitorWrites: Array<{
    competitorId: string;
    siNumber: number;
    cardSeries: string;
    mutable: Record<string, unknown>;
  }> = [];
  const nowFields = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };

  const addOperation = async (
    collectionName: 'courses' | 'classes',
    id: string,
    mutable: Record<string, unknown>,
    createData: Record<string, unknown>
  ): Promise<{ existing: boolean; existingData?: Record<string, unknown> }> => {
    const ref = doc(db, 'competitions', competitionId, collectionName, id);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().ownerUid !== ownerUid && !isSuperAdmin) {
      throw new Error('Importerad data tillhör ett annat konto.');
    }
    const existingData = snap.exists() ? snap.data() : undefined;
    operations.push({ ref, existing: snap.exists(), mutable, createData });
    return { existing: snap.exists(), existingData };
  };

  for (const course of params.courses) {
    const id = sanitizeFirestoreId(course.id, 'crs');
    const mutable = {
      name: (course.name || 'Bana').trim().slice(0, 120) || 'Bana',
      lengthMeters: clampInt(course.lengthMeters, 0, 200000, 0),
      climbMeters: clampInt(course.climbMeters, 0, 20000, 0),
      controls: (course.controls || []).slice(0, 128).map((code) => clampInt(code, 1, 999, 31)),
    };
    await addOperation('courses', id, mutable, {
      courseId: id,
      competitionId,
      ...mutable,
      ownerUid,
      ...nowFields,
    });
  }

  for (const cls of params.classes) {
    const id = sanitizeFirestoreId(cls.id, 'cls');
    const classFormat: ClassCompetitionFormat =
      cls.classFormat === 'FORKED' || cls.classFormat === 'ROGAINING'
        ? cls.classFormat
        : 'STANDARD';
    const mutable = {
      name: (cls.name || 'Klass').trim().slice(0, 80) || 'Klass',
      courseId: cls.courseId ? sanitizeFirestoreId(cls.courseId, 'crs') : '',
      classFormat,
      forkCourseIds: (cls.forkCourseIds || [])
        .slice(0, 32)
        .map((courseId) => sanitizeFirestoreId(courseId, 'crs')),
      rogainingMaxTimeSec:
        cls.rogainingMaxTimeSec !== null && cls.rogainingMaxTimeSec !== undefined
          ? clampInt(cls.rogainingMaxTimeSec, 0, 86400, -1)
          : -1,
      rogainingPenaltyPerMin:
        cls.rogainingPenaltyPerMin !== null && cls.rogainingPenaltyPerMin !== undefined
          ? clampInt(cls.rogainingPenaltyPerMin, 0, 1000, -1)
          : -1,
      allowDirectEntry: Boolean(cls.allowDirectEntry),
      freeStart: Boolean(cls.freeStart),
      autoMatchCourse: Boolean(cls.autoMatchCourse),
      feeSek: clampInt(cls.feeSek, 0, 10000, 100),
    };
    await addOperation('classes', id, mutable, {
      classId: id,
      competitionId,
      ...mutable,
      ownerUid,
      ...nowFields,
    });
  }

  for (const competitor of params.competitors) {
    const id = sanitizeFirestoreId(competitor.id, 'cmp');
    const legacyBillingFields: string[] = [];
    if ('feePaid' in competitor && competitor.feePaid !== undefined) {
      legacyBillingFields.push('feePaid');
    }
    if ('rentalReturned' in competitor && competitor.rentalReturned !== undefined) {
      legacyBillingFields.push('rentalReturned');
    }
    if (legacyBillingFields.length > 0) {
      warnOnLegacyCompetitorFieldWrite(
        'import',
        id,
        legacyBillingFields
      );
    }
    const punches = (competitor.rawReadout?.punches ?? competitor.cardPunches ?? []).slice(0, 192);
    const siNumber = Number(competitor.siNumber);
    if (!Number.isInteger(siNumber) || siNumber < 1 || siNumber > 99999999) {
      throw new Error(`Deltagare ${id} har ett ogiltigt SI-nummer.`);
    }
    const mutable = {
      bib: clampInt(competitor.bib, 1, 99999, 1),
      fullName: (competitor.fullName || 'Deltagare').trim().slice(0, 120) || 'Deltagare',
      club: (competitor.club || 'Klubblös').trim().slice(0, 100) || 'Klubblös',
      classId: sanitizeFirestoreId(competitor.classId || 'cls_open', 'cls'),
      siNumber,
      cardSeries: competitor.cardSeries || 'SI-Card 10',
      isRentalCard: Boolean(competitor.isRentalCard),
      status: competitor.status || 'REGISTERED',
      allocatedStartSec: encodeNullableSec(competitor.allocatedStartSec),
      checkTimeSec: encodeNullableSec(competitor.checkTimeSec),
      startTimeSec: encodeNullableSec(competitor.startTimeSec),
      finishTimeSec: encodeNullableSec(competitor.finishTimeSec),
      manualFinishTimeSec: encodeNullableSec(competitor.manualFinishTimeSec),
      runningTimeSec: encodeNullableSec(competitor.runningTimeSec),
      readoutAtIso: (competitor.readoutAt || '').slice(0, 40),
      punchCodes: punches.map((punch) => clampInt(punch.code, 1, 999, 31)),
      punchTimes: punches.map((punch) => clampInt(punch.timeSec, 0, 86400, 0)),
    };
    competitorWrites.push({
      competitorId: id,
      siNumber,
      cardSeries: mutable.cardSeries,
      mutable,
    });
  }

  for (const runner of params.runnerDbEntries) {
    if (!Number.isInteger(runner.siNumber) || runner.siNumber < 1 || runner.siNumber > 99999999) {
      continue;
    }
    const id = String(runner.siNumber);
    const ref = doc(db, 'runnerDb', id);
    const snap = await getDoc(ref);
    const existingData = snap.exists() ? snap.data() : {};
    const mutable = {
      siNumber: runner.siNumber,
      cardSeries: runner.cardSeries,
      fullName: (runner.fullName || '').trim().slice(0, 120),
      club: (runner.club || '').trim().slice(0, 100),
      birthYear:
        runner.birthYear !== null &&
        runner.birthYear !== undefined &&
        Number.isInteger(runner.birthYear)
          ? runner.birthYear
          : typeof existingData.birthYear === 'number'
            ? existingData.birthYear
            : null,
      defaultClassName:
        (runner.defaultClassName || '').trim().slice(0, 80) ||
        (typeof existingData.defaultClassName === 'string' ? existingData.defaultClassName : ''),
      eventorPersonId:
        (runner.eventorPersonId || '').trim().slice(0, 128) ||
        (typeof existingData.eventorPersonId === 'string' ? existingData.eventorPersonId : ''),
      eventorOrgId:
        (runner.eventorOrgId || '').trim().slice(0, 32) ||
        (typeof existingData.eventorOrgId === 'string' ? existingData.eventorOrgId : ''),
      source: runner.source,
      updatedAtIso: runner.updatedAt,
    };
    if (snap.exists()) {
      operations.push({ ref, existing: true, mutable, createData: {} });
    } else {
      operations.push({
        ref,
        existing: false,
        mutable,
        createData: {
          runnerId: id,
          ...mutable,
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  }

  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(offset, offset + 400)) {
      if (operation.existing) {
        batch.update(operation.ref, {
          ...operation.mutable,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(operation.ref, operation.createData);
      }
    }
    await batch.commit();
  }
  for (const competitor of competitorWrites) {
    await writeImportedCompetitorWithAssignment({
      competitionId,
      competitorId: competitor.competitorId,
      ownerUid,
      isSuperAdmin,
      siNumber: competitor.siNumber,
      cardSeries: competitor.cardSeries,
      assignmentSource: 'IMPORT',
      mutable: competitor.mutable,
    });
  }

  if (params.replaceCoursesAndClasses) {
    const retainedIds = {
      courses: new Set(params.courses.map((course) => sanitizeFirestoreId(course.id, 'crs'))),
      classes: new Set(params.classes.map((cls) => sanitizeFirestoreId(cls.id, 'cls'))),
    };
    const staleRefs: DocumentReference[] = [];
    const staleCourseIds = new Set<string>();
    const staleClassIds = new Set<string>();
    for (const collectionName of ['courses', 'classes'] as const) {
      const snapshots = await getDocs(
        collection(db, 'competitions', competitionId, collectionName)
      );
      for (const snapshot of snapshots.docs) {
        if (
          !retainedIds[collectionName].has(snapshot.id) &&
          (snapshot.data().ownerUid === ownerUid || isSuperAdmin)
        ) {
          if (collectionName === 'courses') {
            staleCourseIds.add(snapshot.id);
          } else {
            staleClassIds.add(snapshot.id);
          }
          staleRefs.push(snapshot.ref);
        }
      }
    }
    if (staleCourseIds.size > 0) {
      const classSnapshots = await getDocs(
        collection(db, 'competitions', competitionId, 'classes')
      );
      const remainingReferences = classSnapshots.docs.flatMap((classDoc) => {
        if (staleClassIds.has(classDoc.id)) return [];
        const data = classDoc.data();
        const referencedCourse = Array.from(staleCourseIds).some(
          (courseId) =>
            data.courseId === courseId ||
            (Array.isArray(data.forkCourseIds) && data.forkCourseIds.includes(courseId))
        );
        return referencedCourse
          ? [typeof data.name === 'string' ? data.name : classDoc.id]
          : [];
      });
      if (remainingReferences.length > 0) {
        throw new Error(
          `Importen kan inte ta bort banor som fortfarande används av ${remainingReferences.join(', ')}.`
        );
      }
    }
    for (let offset = 0; offset < staleRefs.length; offset += 400) {
      const batch = writeBatch(db);
      for (const ref of staleRefs.slice(offset, offset + 400)) batch.delete(ref);
      await batch.commit();
    }
  }

  await updateDoc(competitionRef, {
    competitorCount: clampInt(params.competitorCount, 0, 50000, 0),
    finishedCount: Math.min(
      clampInt(params.competitorCount, 0, 50000, 0),
      params.competitors.filter((competitor) =>
        ['OK', 'MP', 'PRELIMINARY_FIN'].includes(competitor.status)
      ).length
    ),
    updatedAt: serverTimestamp(),
  });
}

interface CompetitionMutationContext {
  competitionId: string;
  ownerUid: string;
  isSuperAdmin: boolean;
}

export type { AtomicSIAssignmentMutationIntent } from './utils/siAssignmentPreview';

interface AtomicSIAssignmentMutationDiagnostics {
  assignmentExists: boolean;
  assignmentMissing: boolean;
  assignmentMismatch: boolean;
  duplicateCandidateDetected: boolean;
  duplicateCandidateCompetitorIds: string[];
  duplicateCandidateQueryError: string | null;
  reassignmentConflict: boolean;
}

export interface AtomicSIAssignmentMutationResult extends AtomicSIAssignmentMutationDiagnostics {
  status: 'COMMITTED' | 'MISSING_COMPETITION' | 'MISSING_COMPETITOR';
  intent: AtomicSIAssignmentMutationIntent;
  competitionId: string;
  competitorId: string;
  competitionExists: boolean;
  competitorExists: boolean;
  competitionStatus: string | null;
  competitorStatus: string | null;
  currentSiNumber: number | null;
  requestedSiNumber: number | null;
  duplicateCandidate: boolean;
  reassignmentRequired: boolean;
  retirementRequired: boolean;
  assignmentWriteOutcome: AtomicSIAssignmentWriteOutcome;
  assignmentDocuments: Array<{
    siNumber: number;
    exists: boolean;
    state: unknown;
    competitorId: unknown;
  }>;
  previewPlan: SIAssignmentPreviewPlan;
  metrics: SIAssignmentPreviewMetrics;
}

export type AtomicSIAssignmentWriteOutcome =
  | 'NOT_APPLICABLE'
  | 'REASSIGNED'
  | 'REASSIGNMENT_CONFLICT'
  | 'REASSIGNMENT_PARTIAL'
  | 'CREATED'
  | 'ALREADY_MATCHED'
  | 'RETIRED'
  | 'ALREADY_RETIRED'
  | 'SKIPPED_CONFLICT'
  | 'SKIPPED_INVALID_DATA'
  | 'SKIPPED_VERSION_LIMIT';

type AtomicSIAssignmentMutationTransactionResult = Omit<
  AtomicSIAssignmentMutationResult,
  'metrics'
>;

export interface AtomicSIAssignmentMutationRequest {
  intent: AtomicSIAssignmentMutationIntent;
  competitor: {
    competitionId: string;
    competitorId: string;
  };
  assignment: {
    requestedSiNumber?: number;
  };
}

export interface AtomicSIAssignmentMutationContext {
  transaction: Transaction;
  competitionData: Record<string, unknown>;
  competitorData: Record<string, unknown> | null;
  competitorExists: boolean;
  assignmentSnapshots: ReadonlyMap<number, DocumentSnapshot>;
  result: AtomicSIAssignmentMutationTransactionResult;
}

let atomicSIAssignmentPreviewMetrics = createSIAssignmentPreviewMetrics();

export function getAtomicSIAssignmentPreviewMetrics(): SIAssignmentPreviewMetrics {
  return { ...atomicSIAssignmentPreviewMetrics };
}

export async function runAtomicSIAssignmentMutation(
  params: AtomicSIAssignmentMutationRequest,
  write: (
    context: AtomicSIAssignmentMutationContext
  ) => void | AtomicSIAssignmentWriteOutcome | Promise<void | AtomicSIAssignmentWriteOutcome>
): Promise<AtomicSIAssignmentMutationResult> {
  const competitionId = sanitizeFirestoreId(params.competitor.competitionId, 'evt');
  const competitorId = sanitizeFirestoreId(params.competitor.competitorId, 'cmp');
  const requestedAssignmentSiNumber = params.assignment.requestedSiNumber;
  const competitionRef = doc(db, 'competitions', competitionId);
  const competitorRef = doc(db, 'competitions', competitionId, 'competitors', competitorId);
  const shouldCheckDuplicateCandidates =
    Number.isInteger(requestedAssignmentSiNumber) &&
    Number(requestedAssignmentSiNumber) > 0 &&
    (params.intent === 'CREATE_COMPETITOR' || params.intent === 'CHANGE_SI_NUMBER');
  let duplicateCandidateCompetitorIds: string[] = [];
  let duplicateCandidateQueryError: string | null = null;
  if (shouldCheckDuplicateCandidates) {
    try {
      duplicateCandidateCompetitorIds = (
        await getDocs(
          query(
            collection(db, 'competitions', competitionId, 'competitors'),
            where('siNumber', '==', Number(requestedAssignmentSiNumber))
          )
        )
      ).docs
        .filter((snapshot) => snapshot.id !== competitorId)
        .map((snapshot) => snapshot.id);
    } catch (error) {
      duplicateCandidateQueryError =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[atomic-si-mutation] ${JSON.stringify({
          intent: params.intent,
          competitionId,
          competitorId,
          requestedSiNumber: requestedAssignmentSiNumber,
          diagnostic: 'DUPLICATE_CANDIDATE_QUERY_FAILED',
          error: duplicateCandidateQueryError,
          enforcementActive: false,
        })}`
      );
    }
  }

  const transactionResult = await runTransaction(db, async (transaction) => {
    const [competitionSnap, competitorSnap] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(competitorRef),
    ]);
    const competitorData = competitorSnap.exists() ? competitorSnap.data() : null;
    const currentSiNumber =
      typeof competitorData?.siNumber === 'number' ? competitorData.siNumber : null;
    const requestedSiNumber =
      Number.isInteger(requestedAssignmentSiNumber) && Number(requestedAssignmentSiNumber) > 0
        ? Number(requestedAssignmentSiNumber)
        : currentSiNumber;
    const effectiveIntent: AtomicSIAssignmentMutationIntent =
      params.intent === 'CHANGE_SI_NUMBER' && requestedSiNumber === currentSiNumber
        ? 'UPDATE_COMPETITOR_IDENTITY'
        : params.intent;
    const siNumbers = Array.from(
      new Set([currentSiNumber, requestedSiNumber].filter((value): value is number =>
        Number.isInteger(value) && Number(value) > 0
      ))
    );
    const assignmentSnapshots = new Map<number, DocumentSnapshot>();
    for (const siNumber of siNumbers) {
      assignmentSnapshots.set(
        siNumber,
        await transaction.get(getCompetitionSICardAssignmentRef(competitionId, siNumber))
      );
    }

    let assignmentMismatch = false;
    let reassignmentConflict = false;
    for (const [siNumber, assignmentSnap] of assignmentSnapshots) {
      if (!assignmentSnap.exists()) continue;
      const assignment = parseSICardAssignmentDocument(
        assignmentSnap.id,
        competitionId,
        assignmentSnap.data()
      );
      const isReassignmentTarget =
        effectiveIntent === 'CHANGE_SI_NUMBER' &&
        siNumber === requestedSiNumber &&
        requestedSiNumber !== currentSiNumber;
      const assignmentIsValid =
        assignment !== null && assignment.siNumber === siNumber;
      const targetIsOccupied =
        isReassignmentTarget &&
        assignmentIsValid &&
        assignment?.state === 'ACTIVE' &&
        assignment.competitorId !== competitorId;
      if (isReassignmentTarget && (!assignmentIsValid || targetIsOccupied)) {
        reassignmentConflict = true;
      }
      const isExpectedOwner = assignment?.competitorId === competitorId;
      const acceptableTarget =
        isReassignmentTarget &&
        assignmentIsValid &&
        (assignment?.state === 'RETIRED' ||
          (assignment?.state === 'ACTIVE' && isExpectedOwner));
      const acceptableRetiredCurrent =
        siNumber === currentSiNumber &&
        assignment?.state === 'RETIRED' &&
        isExpectedOwner;
      if (
        !assignmentIsValid ||
        (!isExpectedOwner && !acceptableTarget) ||
        (assignment?.state !== 'ACTIVE' &&
          !acceptableTarget &&
          !acceptableRetiredCurrent)
      ) {
        assignmentMismatch = true;
      }
    }
    if (
      effectiveIntent === 'CHANGE_SI_NUMBER' &&
      requestedSiNumber !== currentSiNumber &&
      duplicateCandidateCompetitorIds.length > 0
    ) {
      reassignmentConflict = true;
    }
    const assignmentExists = Array.from(assignmentSnapshots.values()).some((snap) =>
      snap.exists()
    );
    const assignmentMissing =
      siNumbers.length > 0 &&
      Array.from(assignmentSnapshots.values()).some((snap) => !snap.exists());
    const currentAssignmentMissing =
      currentSiNumber !== null &&
      !assignmentSnapshots.get(currentSiNumber)?.exists();
    const duplicateCheckApplies =
      effectiveIntent === 'CREATE_COMPETITOR' || effectiveIntent === 'CHANGE_SI_NUMBER';
    const duplicateCandidateDetected =
      duplicateCheckApplies && duplicateCandidateCompetitorIds.length > 0;
    const status: AtomicSIAssignmentMutationResult['status'] = !competitionSnap.exists()
      ? 'MISSING_COMPETITION'
      : !competitorSnap.exists() && effectiveIntent !== 'CREATE_COMPETITOR'
        ? 'MISSING_COMPETITOR'
        : 'COMMITTED';
    const resultBase = {
      status,
      intent: effectiveIntent,
      competitionId,
      competitorId,
      competitionExists: competitionSnap.exists(),
      competitorExists: competitorSnap.exists(),
      competitionStatus:
        typeof competitionSnap.data()?.status === 'string'
          ? competitionSnap.data()?.status
          : null,
      competitorStatus:
        typeof competitorData?.status === 'string' ? competitorData.status : null,
      currentSiNumber,
      requestedSiNumber,
      assignmentExists,
      assignmentMissing,
      currentAssignmentMissing,
      assignmentMismatch,
      duplicateCandidateDetected,
      duplicateCandidateCompetitorIds,
      duplicateCandidateQueryError,
      reassignmentConflict,
    };
    const previewPlan = buildSIAssignmentPreviewPlan({
      intent: effectiveIntent,
      competitionExists: competitionSnap.exists(),
      competitorExists: competitorSnap.exists(),
      currentSiNumber,
      requestedSiNumber,
      assignmentExists,
      assignmentMissing,
      currentAssignmentMissing,
      assignmentMismatch,
      duplicateCandidate: duplicateCandidateDetected,
      reassignmentConflict,
      duplicateCandidateQueryFailed:
        duplicateCheckApplies && duplicateCandidateQueryError !== null,
    });
    const result: AtomicSIAssignmentMutationTransactionResult = {
      ...resultBase,
      duplicateCandidate: duplicateCandidateDetected,
      reassignmentRequired: previewPlan.reassignmentRequired,
      retirementRequired: previewPlan.retirementRequired,
      assignmentWriteOutcome:
        effectiveIntent === 'CHANGE_SI_NUMBER'
          ? 'REASSIGNMENT_PARTIAL'
          : 'NOT_APPLICABLE',
      reassignmentConflict,
      assignmentDocuments: Array.from(assignmentSnapshots.entries()).map(
        ([siNumber, snapshot]) => ({
          siNumber,
          exists: snapshot.exists(),
          state: snapshot.exists() ? snapshot.data().state ?? null : null,
          competitorId: snapshot.exists() ? snapshot.data().competitorId ?? null : null,
        })
      ),
      previewPlan,
    };

    if (result.status === 'COMMITTED') {
      const mutationOperation: CompetitorMutationOperation =
        effectiveIntent === 'CREATE_COMPETITOR'
          ? 'CREATE'
          : effectiveIntent === 'DELETE_COMPETITOR' ||
              effectiveIntent === 'RETIRE_COMPETITOR'
            ? 'DELETE'
            : 'UPDATE';
      const mutationSiNumber = requestedSiNumber ?? currentSiNumber;
      const assignmentSnapshot =
        requestedSiNumber === null
          ? undefined
          : assignmentSnapshots.get(requestedSiNumber);
      const assignmentWriteOutcome = await runAssignmentAwareCompetitorMutation(
        {
          declaration: {
            source: 'runAtomicSIAssignmentMutation',
            operation: mutationOperation,
            competitionId,
            competitorId,
            ...(mutationSiNumber !== null && mutationSiNumber !== undefined
              ? { siNumber: mutationSiNumber }
              : {}),
            ...(currentSiNumber !== null ? { previousSiNumber: currentSiNumber } : {}),
            assignmentHandling:
              mutationSiNumber !== null && mutationSiNumber !== undefined
                ? {
                    mode: 'VALIDATED',
                    validatedSiNumber: mutationSiNumber,
                    assignmentVersion: Number(
                      assignmentSnapshot?.data()?.assignmentVersion ?? 1
                    ),
                  }
                : {
                    mode: 'LEGACY',
                    reason: 'No valid SI number was available for assignment-aware validation.',
                  },
            identityAffecting: true,
          },
          intent: effectiveIntent,
          assignment: {
            mode: 'ASSIGNMENT_AWARE',
            ...(currentSiNumber !== null ? { currentSiNumber } : {}),
            ...(requestedSiNumber !== null ? { requestedSiNumber } : {}),
            ...(assignmentSnapshot?.exists()
              ? {
                  assignmentId: assignmentSnapshot.id,
                  assignmentState:
                    typeof assignmentSnapshot.data().state === 'string'
                      ? assignmentSnapshot.data().state
                      : undefined,
                }
              : {}),
            validationState: 'READ_ONLY',
          },
          competitor: {
            competitionId,
            competitorId,
            ...(currentSiNumber !== null ? { currentSiNumber } : {}),
            ...(requestedSiNumber !== null ? { proposedSiNumber: requestedSiNumber } : {}),
          },
          validationHooks: [
            {
              name: 'assignment-consistency-observation',
              validate: () => ({
                passed: !result.assignmentMismatch,
                detail: result.assignmentMismatch
                  ? 'Observed assignment documents do not match the competitor identity.'
                  : 'Assignment documents were observed; no mismatch was detected.',
              }),
            },
          ],
        },
        () =>
          write({
            transaction,
            competitionData: competitionSnap.data() ?? {},
            competitorData,
            competitorExists: competitorSnap.exists(),
            assignmentSnapshots,
            result,
          })
      );
      if (assignmentWriteOutcome) {
        result.assignmentWriteOutcome = assignmentWriteOutcome;
      }
      const assignmentWriteDiagnostic = {
        intent: effectiveIntent,
        competitionId,
        competitorId,
        assignmentWriteOutcome: result.assignmentWriteOutcome,
        enforcementActive: false,
        writesContinue: true,
      };
      if (
        result.assignmentWriteOutcome === 'SKIPPED_CONFLICT' ||
        result.assignmentWriteOutcome === 'SKIPPED_INVALID_DATA' ||
        result.assignmentWriteOutcome === 'SKIPPED_VERSION_LIMIT' ||
        result.assignmentWriteOutcome === 'REASSIGNMENT_CONFLICT' ||
        result.assignmentWriteOutcome === 'REASSIGNMENT_PARTIAL'
      ) {
        const diagnostic =
          effectiveIntent === 'CREATE_COMPETITOR'
            ? 'COMPETITOR_CREATED_WITHOUT_ASSIGNMENT'
            : effectiveIntent === 'CHANGE_SI_NUMBER'
              ? 'SI_REASSIGNMENT_ASSIGNMENT_UPDATE_INCOMPLETE'
            : effectiveIntent === 'DELETE_COMPETITOR'
              ? 'COMPETITOR_DELETED_WITHOUT_ASSIGNMENT_RETIREMENT'
              : 'COMPETITOR_RETIREMENT_WITHOUT_ASSIGNMENT_UPDATE';
        console.warn(
          `[si-assignment-write] ${JSON.stringify({
            ...assignmentWriteDiagnostic,
            diagnostic,
          })}`
        );
      } else {
        console.info(`[si-assignment-write] ${JSON.stringify(assignmentWriteDiagnostic)}`);
      }
    }
    return result;
  });

  atomicSIAssignmentPreviewMetrics = accumulateSIAssignmentPreviewMetrics(
    atomicSIAssignmentPreviewMetrics,
    transactionResult.previewPlan
  );
  const result: AtomicSIAssignmentMutationResult = {
    ...transactionResult,
    metrics: getAtomicSIAssignmentPreviewMetrics(),
  };
  const previewDiagnostic = {
    ...result,
    enforcementActive: false,
    assignmentWritesEnabled:
      result.intent === 'CREATE_COMPETITOR' ||
      result.intent === 'CHANGE_SI_NUMBER' ||
      result.intent === 'RETIRE_COMPETITOR' ||
      result.intent === 'DELETE_COMPETITOR',
    assignmentWritesApplied:
      result.assignmentWriteOutcome === 'CREATED' ||
      result.assignmentWriteOutcome === 'RETIRED' ||
      result.assignmentWriteOutcome === 'REASSIGNED',
    writesContinue: true,
  };
  const log = result.previewPlan.wouldBeBlocked ? console.warn : console.info;
  log(`[atomic-si-preview] ${JSON.stringify(previewDiagnostic)}`);
  console.info(
    `[atomic-si-preview-metrics] ${JSON.stringify(result.metrics)}`
  );
  return result;
}

async function getCurrentFirebaseRoles(): Promise<{
  user: User;
  adminTier: ClubAdminTier | null;
  officialRole: OfficialRole | null;
}> {
  const user = await ensureValidFirestoreUser();
  if (
    !user ||
    !user.emailVerified ||
    !user.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Åtgärden kräver ett verifierat Google-konto.');
  }
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (user.email || '').trim().toLowerCase()
  );
  const [adminSnap, officialSnap] = await Promise.all([
    isBootstrapAdmin ? Promise.resolve(null) : getDoc(doc(db, 'admins', user.uid)),
    getDoc(doc(db, 'roleAssignments', sanitizeFirestoreId(user.uid, 'usr'))),
  ]);
  const adminRole = isBootstrapAdmin
    ? 'SUPER_ADMIN'
    : adminSnap?.exists()
      ? adminSnap.data().role
      : null;
  const officialRole = officialSnap?.exists() ? officialSnap.data().role : null;
  return {
    user,
    adminTier:
      adminRole === 'SUPER_ADMIN' || adminRole === 'RACE_ADMIN' ? adminRole : null,
    officialRole: isOfficialRole(officialRole) ? officialRole : null,
  };
}

async function getCompetitionMutationContext(
  rawCompetitionId: string,
  statusOnlyUpdate?: EventLifecycleStatus
): Promise<CompetitionMutationContext> {
  const current = await ensureValidFirestoreUser();
  if (
    !current ||
    !current.emailVerified ||
    !current.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Ändringen kräver ett inloggat, verifierat Google-administratörskonto.');
  }

  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', ownerUid));
  const role = adminSnap?.exists() ? adminSnap.data().role : null;
  const isSuperAdmin = isBootstrapAdmin || role === 'SUPER_ADMIN';
  if (!isSuperAdmin && role !== 'RACE_ADMIN') {
    throw new Error('Ditt Google-konto saknar administratörsbehörighet för Firestore.');
  }

  const competitionId = sanitizeFirestoreId(rawCompetitionId, 'evt');
  const competitionSnap = await getDoc(doc(db, 'competitions', competitionId));
  if (!competitionSnap.exists()) {
    throw new Error('Tävlingen hittades inte i Firestore.');
  }
  const competition = competitionSnap.data();
  if (
    competition.ownerUid !== current.uid &&
    !isSuperAdmin &&
    statusOnlyUpdate === undefined
  ) {
    throw new Error('Ditt konto saknar behörighet att ändra den här tävlingen.');
  }
  if (
    competition.status === 'COMPLETED' &&
    !isSuperAdmin &&
    statusOnlyUpdate !== 'LIVE' &&
    statusOnlyUpdate !== 'UPCOMING'
  ) {
    throw new Error('Det går inte att ändra en avslutad tävling.');
  }

  return { competitionId, ownerUid, isSuperAdmin };
}

export async function saveCourseToFirestore(
  competitionId: string,
  payload: Partial<Course>,
  existingId?: string
): Promise<Course> {
  const context = await getCompetitionMutationContext(competitionId);
  const id = existingId
    ? sanitizeFirestoreId(existingId, 'crs')
    : doc(collection(db, 'competitions', context.competitionId, 'courses')).id;
  const ref = doc(db, 'competitions', context.competitionId, 'courses', id);
  const mutable = {
    name: (payload.name || '').trim().slice(0, 120),
    lengthMeters: clampInt(payload.lengthMeters, 0, 200000, 0),
    climbMeters: clampInt(payload.climbMeters, 0, 20000, 0),
    controls: (payload.controls || []).slice(0, 128).map((code) => clampInt(code, 1, 999, 31)),
  };
  if (!mutable.name || mutable.controls.length === 0) {
    throw new Error('Banan måste ha ett namn och minst en kontroll.');
  }

  const existing = await getDoc(ref);
  if (existing.exists()) {
    if (existing.data().ownerUid !== context.ownerUid && !context.isSuperAdmin) {
      throw new Error('Banan tillhör ett annat administratörskonto.');
    }
    await updateDoc(ref, { ...mutable, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, {
      courseId: id,
      competitionId: context.competitionId,
      ...mutable,
      ownerUid: context.ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return { id, ...mutable };
}

export async function deleteCourseFromFirestore(
  competitionId: string,
  courseId: string
): Promise<void> {
  const context = await getCompetitionMutationContext(competitionId);
  const id = sanitizeFirestoreId(courseId, 'crs');
  const classes = await getDocs(
    collection(db, 'competitions', context.competitionId, 'classes')
  );
  const references = classes.docs.flatMap((classDoc) => {
    const data = classDoc.data();
    const directReference = data.courseId === id;
    const forkReference =
      Array.isArray(data.forkCourseIds) && data.forkCourseIds.includes(id);
    return directReference || forkReference
      ? [typeof data.name === 'string' ? data.name : classDoc.id]
      : [];
  });
  if (references.length > 0) {
    throw new Error(
      `Banan används av ${references.join(', ')}. Ta bort eller ändra klassernas banreferenser innan banan tas bort.`
    );
  }
  await deleteDoc(doc(db, 'competitions', context.competitionId, 'courses', id));
}

export function subscribeCoursesFromFirestore(
  competitionId: string,
  onCourses: (courses: Course[]) => void,
  onError: (error: Error) => void,
  onChanged?: () => void
): () => void {
  const id = sanitizeFirestoreId(competitionId, 'evt');
  let initialized = false;
  const unsubscribe = onSnapshot(
    collection(db, 'competitions', id, 'courses'),
    (snapshot) => {
      onCourses(
        snapshot.docs.map((courseDoc) => {
          const data = courseDoc.data();
          return {
            id: typeof data.courseId === 'string' ? data.courseId : courseDoc.id,
            name: typeof data.name === 'string' ? data.name : 'Bana',
            lengthMeters: Number(data.lengthMeters ?? 0),
            climbMeters: Number(data.climbMeters ?? 0),
            controls: Array.isArray(data.controls) ? data.controls.map(Number) : [],
          };
        })
      );
      if (initialized && snapshot.docChanges().length > 0) {
        onChanged?.();
      }
      initialized = true;
    },
    (error) => onError(error)
  );
  return unsubscribe;
}

export async function saveClassToFirestore(
  competitionId: string,
  payload: Partial<CompClass>,
  existingId?: string
): Promise<CompClass> {
  const context = await getCompetitionMutationContext(competitionId);
  const id = existingId
    ? sanitizeFirestoreId(existingId, 'cls')
    : doc(collection(db, 'competitions', context.competitionId, 'classes')).id;
  const ref = doc(db, 'competitions', context.competitionId, 'classes', id);
  const existing = await getDoc(ref);
  const previous = existing.exists() ? existing.data() : {};
  const classFormat: ClassCompetitionFormat =
    payload.classFormat === 'FORKED' || payload.classFormat === 'ROGAINING'
      ? payload.classFormat
      : previous.classFormat === 'FORKED' || previous.classFormat === 'ROGAINING'
        ? previous.classFormat
        : 'STANDARD';
  const courseId =
    payload.courseId !== undefined
      ? payload.courseId
      : typeof previous.courseId === 'string'
        ? previous.courseId || null
        : null;
  const forkCourseIds =
    payload.forkCourseIds !== undefined
      ? payload.forkCourseIds
      : Array.isArray(previous.forkCourseIds)
        ? (previous.forkCourseIds as string[])
        : [];
  const mutable: {
    name: string;
    courseId: string;
    classFormat: ClassCompetitionFormat;
    forkCourseIds: string[];
    rogainingMaxTimeSec: number;
    rogainingPenaltyPerMin: number;
    allowDirectEntry: boolean;
    freeStart: boolean;
    autoMatchCourse: boolean;
    feeSek: number;
  } = {
    name: (payload.name ?? (typeof previous.name === 'string' ? previous.name : '')).trim().slice(0, 80),
    courseId: courseId ? sanitizeFirestoreId(courseId, 'crs') : '',
    classFormat,
    forkCourseIds: (forkCourseIds || [])
      .slice(0, 32)
      .map((courseId) => sanitizeFirestoreId(courseId, 'crs')),
    rogainingMaxTimeSec:
      payload.rogainingMaxTimeSec !== undefined
        ? payload.rogainingMaxTimeSec !== null
          ? clampInt(payload.rogainingMaxTimeSec, 60, 86400, 2700)
          : -1
        : Number(previous.rogainingMaxTimeSec) >= 0
          ? clampInt(previous.rogainingMaxTimeSec, 60, 86400, 2700)
          : -1,
    rogainingPenaltyPerMin:
      payload.rogainingPenaltyPerMin !== undefined
        ? payload.rogainingPenaltyPerMin !== null
          ? clampInt(payload.rogainingPenaltyPerMin, 0, 1000, 10)
          : -1
        : Number(previous.rogainingPenaltyPerMin) >= 0
          ? clampInt(previous.rogainingPenaltyPerMin, 0, 1000, 10)
          : -1,
    allowDirectEntry:
      payload.allowDirectEntry !== undefined
        ? payload.allowDirectEntry
        : previous.allowDirectEntry !== false,
    freeStart:
      payload.freeStart !== undefined ? payload.freeStart : previous.freeStart !== false,
    autoMatchCourse:
      payload.autoMatchCourse !== undefined
        ? payload.autoMatchCourse
        : Boolean(previous.autoMatchCourse),
    feeSek:
      payload.feeSek !== undefined
        ? clampInt(payload.feeSek, 0, 10000, 100)
        : clampInt(previous.feeSek, 0, 10000, 100),
  };
  if (!mutable.name) {
    throw new Error('Klassen måste ha ett namn.');
  }

  const referencedCourseIds = [
    ...(mutable.courseId ? [mutable.courseId] : []),
    ...mutable.forkCourseIds,
  ];
  if (referencedCourseIds.length > 0) {
    const courseSnapshots = await getDocs(
      collection(db, 'competitions', context.competitionId, 'courses')
    );
    const existingCourseIds = new Set(courseSnapshots.docs.map((courseDoc) => courseDoc.id));
    const missingCourseIds = Array.from(new Set(referencedCourseIds)).filter(
      (courseId) => !existingCourseIds.has(courseId)
    );
    if (missingCourseIds.length > 0) {
      throw new Error(
        `Klassen refererar till banor som saknas i Firestore: ${missingCourseIds.join(', ')}.`
      );
    }
  }

  if (existing.exists()) {
    if (existing.data().ownerUid !== context.ownerUid && !context.isSuperAdmin) {
      throw new Error('Klassen tillhör ett annat administratörskonto.');
    }
    await updateDoc(ref, { ...mutable, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, {
      classId: id,
      competitionId: context.competitionId,
      ...mutable,
      ownerUid: context.ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return {
    id,
    ...mutable,
    courseId: mutable.courseId || null,
    rogainingMaxTimeSec: mutable.rogainingMaxTimeSec < 0 ? null : mutable.rogainingMaxTimeSec,
    rogainingPenaltyPerMin:
      mutable.rogainingPenaltyPerMin < 0 ? null : mutable.rogainingPenaltyPerMin,
  };
}

export async function deleteClassFromFirestore(
  competitionId: string,
  classId: string
): Promise<void> {
  const context = await getCompetitionMutationContext(competitionId);
  const id = sanitizeFirestoreId(classId, 'cls');
  const competitors = await getDocs(
    query(
      collection(db, 'competitions', context.competitionId, 'competitors'),
      where('classId', '==', id)
    )
  );
  if (!competitors.empty) {
    const names = Array.from(
      new Set(
        competitors.docs.map((competitorDoc) => {
          const fullName = competitorDoc.data().fullName;
          return typeof fullName === 'string' ? fullName : competitorDoc.id;
        })
      )
    );
    throw new Error(
      `Klassen kan inte tas bort eftersom ${names.length} deltagare använder den: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}.`
    );
  }
  await deleteDoc(doc(db, 'competitions', context.competitionId, 'classes', id));
}

export function subscribeClassesFromFirestore(
  competitionId: string,
  onClasses: (classes: CompClass[]) => void,
  onError: (error: Error) => void,
  onChanged?: () => void
): () => void {
  const id = sanitizeFirestoreId(competitionId, 'evt');
  let initialized = false;
  const unsubscribe = onSnapshot(
    collection(db, 'competitions', id, 'classes'),
    (snapshot) => {
      onClasses(
        snapshot.docs.map((classDoc) => {
          const data = classDoc.data();
          return {
            id: typeof data.classId === 'string' ? data.classId : classDoc.id,
            name: typeof data.name === 'string' ? data.name : 'Klass',
            courseId: typeof data.courseId === 'string' && data.courseId ? data.courseId : null,
            classFormat:
              data.classFormat === 'FORKED' || data.classFormat === 'ROGAINING'
                ? data.classFormat
                : 'STANDARD',
            forkCourseIds: Array.isArray(data.forkCourseIds)
              ? data.forkCourseIds.filter((courseId): courseId is string => typeof courseId === 'string')
              : [],
            rogainingMaxTimeSec: decodeNullableSec(data.rogainingMaxTimeSec),
            rogainingPenaltyPerMin:
              Number(data.rogainingPenaltyPerMin) >= 0
                ? Number(data.rogainingPenaltyPerMin)
                : null,
            allowDirectEntry: Boolean(data.allowDirectEntry),
            freeStart: Boolean(data.freeStart),
            autoMatchCourse: Boolean(data.autoMatchCourse),
            feeSek: Number(data.feeSek ?? 100),
          };
        })
      );
      if (initialized && snapshot.docChanges().length > 0) {
        onChanged?.();
      }
      initialized = true;
    },
    (error) => onError(error)
  );
  return unsubscribe;
}

export async function saveStationToFirestore(
  competitionId: string,
  payload: Partial<SIStation>
): Promise<SIStation> {
  const context = await getCompetitionMutationContext(competitionId);
  const id = payload.id
    ? sanitizeFirestoreId(payload.id, 'st')
    : doc(collection(db, 'competitions', context.competitionId, 'stations')).id;
  const ref = doc(db, 'competitions', context.competitionId, 'stations', id);
  const hardwareModels: SIStation['hardwareModel'][] = [
    'BSM8-USB',
    'BSM7-USB',
    'SRR-USB (Air+)',
    'BSF9 Master',
    'BSF8 Master',
  ];
  const stationFunctions: StationFunction[] = [
    'CLEAR',
    'CHECK',
    'START',
    'RADIO',
    'PREWARNING',
    'FINISH',
    'READOUT',
  ];
  const station: SIStation = {
    id,
    stationCode: clampInt(payload.stationCode, 1, 999, 42),
    name: (payload.name || '').trim().slice(0, 120),
    hardwareModel: hardwareModels.includes(payload.hardwareModel as SIStation['hardwareModel'])
      ? (payload.hardwareModel as SIStation['hardwareModel'])
      : 'SRR-USB (Air+)',
    stationFunction: stationFunctions.includes(payload.stationFunction as StationFunction)
      ? (payload.stationFunction as StationFunction)
      : 'RADIO',
    baudRate: payload.baudRate === 4800 ? 4800 : 38400,
    extendedProtocol: Boolean(payload.extendedProtocol),
    batteryMv: clampInt(payload.batteryMv, 0, 6000, 0),
    firmware: (payload.firmware || '').trim().slice(0, 80),
    lastSeenAt: payload.lastSeenAt || null,
    active: payload.active !== false,
  };
  if (!station.name) throw new Error('Stationen måste ha ett namn.');

  const duplicateStations = await getDocs(
    query(
      collection(db, 'competitions', context.competitionId, 'stations'),
      where('stationCode', '==', station.stationCode)
    )
  );
  if (duplicateStations.docs.some((stationDoc) => stationDoc.id !== id)) {
    throw new Error(`Stationskod CN ${station.stationCode} är redan konfigurerad.`);
  }

  const existing = await getDoc(ref);
  if (existing.exists()) {
    if (existing.data().ownerUid !== context.ownerUid && !context.isSuperAdmin) {
      throw new Error('Stationen tillhör ett annat administratörskonto.');
    }
    await updateDoc(ref, {
      stationCode: station.stationCode,
      name: station.name,
      hardwareModel: station.hardwareModel,
      stationFunction: station.stationFunction,
      baudRate: station.baudRate,
      extendedProtocol: station.extendedProtocol,
      batteryMv: station.batteryMv,
      firmware: station.firmware,
      lastSeenAt: station.lastSeenAt || '',
      active: station.active,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      stationId: id,
      competitionId: context.competitionId,
      ownerUid: context.ownerUid,
      stationCode: station.stationCode,
      name: station.name,
      hardwareModel: station.hardwareModel,
      stationFunction: station.stationFunction,
      baudRate: station.baudRate,
      extendedProtocol: station.extendedProtocol,
      batteryMv: station.batteryMv,
      firmware: station.firmware,
      lastSeenAt: station.lastSeenAt || '',
      active: station.active,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return station;
}

export async function deleteStationFromFirestore(
  competitionId: string,
  stationId: string
): Promise<void> {
  const context = await getCompetitionMutationContext(competitionId);
  await deleteDoc(
    doc(
      db,
      'competitions',
      context.competitionId,
      'stations',
      sanitizeFirestoreId(stationId, 'st')
    )
  );
}

export async function updateCompetitorInFirestore(
  competitionId: string,
  competitorId: string,
  patch: Partial<Competitor>
): Promise<void> {
  const mutable: Record<string, unknown> = {};
  const fields: Array<keyof Competitor> = [
    'bib',
    'fullName',
    'club',
    'classId',
    'siNumber',
    'cardSeries',
    'isRentalCard',
    'rentalReturned',
    'feePaid',
    'status',
    'allocatedStartSec',
    'checkTimeSec',
    'startTimeSec',
    'finishTimeSec',
    'manualFinishTimeSec',
    'runningTimeSec',
  ];
  for (const field of fields) {
    if (field in patch) {
      const value = patch[field];
      if (value === undefined) continue;
      mutable[field] =
        field === 'allocatedStartSec' ||
        field === 'checkTimeSec' ||
        field === 'startTimeSec' ||
        field === 'finishTimeSec' ||
        field === 'manualFinishTimeSec' ||
        field === 'runningTimeSec'
          ? encodeNullableSec(value as number | null | undefined)
          : value;
    }
  }
  if ('readoutAt' in patch) {
    mutable.readoutAtIso = (patch.readoutAt || '').slice(0, 40);
  }
  if ('cardPunches' in patch) {
    const punches = (patch.cardPunches || []).slice(0, 192);
    mutable.punchCodes = punches.map((punch) => clampInt(punch.code, 1, 999, 31));
    mutable.punchTimes = punches.map((punch) => clampInt(punch.timeSec, 0, 86400, 0));
  }
  if (Object.keys(mutable).length === 0) return;

  const authorization = await getCurrentFirebaseRoles();
  const officialRoleFields: Record<OfficialRole, string[]> = {
    READOUT: [
      'status',
      'checkTimeSec',
      'startTimeSec',
      'finishTimeSec',
      'runningTimeSec',
      'readoutAtIso',
      'punchCodes',
      'punchTimes',
    ],
    SPEAKER: [
      'status',
      'checkTimeSec',
      'startTimeSec',
      'finishTimeSec',
      'runningTimeSec',
      'readoutAtIso',
      'punchCodes',
      'punchTimes',
    ],
    FOREST: [
      'status',
      'checkTimeSec',
      'startTimeSec',
      'finishTimeSec',
      'runningTimeSec',
      'readoutAtIso',
      'punchCodes',
      'punchTimes',
    ],
    START: ['status', 'checkTimeSec', 'startTimeSec'],
  };
  const mutableFields = Object.keys(mutable);
  if (!authorization.adminTier) {
    const allowedFields = authorization.officialRole
      ? officialRoleFields[authorization.officialRole]
      : [];
    if (
      allowedFields.length === 0 ||
      mutableFields.some((field) => !allowedFields.includes(field))
    ) {
      throw new Error('Ditt konto saknar behörighet att uppdatera deltagaren.');
    }

    const safeCompetitionId = sanitizeFirestoreId(competitionId, 'evt');
    const safeCompetitorId = sanitizeFirestoreId(competitorId, 'cmp');
    const competitionRef = doc(db, 'competitions', safeCompetitionId);
    const competitorRef = doc(
      db,
      'competitions',
      safeCompetitionId,
      'competitors',
      safeCompetitorId
    );
    await runTransaction(db, async (transaction) => {
      const [competitionSnap, competitorSnap] = await Promise.all([
        transaction.get(competitionRef),
        transaction.get(competitorRef),
      ]);
      if (!competitionSnap.exists() || !competitorSnap.exists()) {
        throw new Error('Tävlingen eller deltagaren hittades inte i Firestore.');
      }
      const competition = competitionSnap.data();
      const competitor = competitorSnap.data();
      if (competition.status === 'COMPLETED') {
        throw new Error('Deltagaren kan inte uppdateras i en avslutad tävling.');
      }
      if (typeof mutable.status === 'string') {
        const finishedStatuses = new Set(['OK', 'MP', 'PRELIMINARY_FIN']);
        const previouslyFinished = finishedStatuses.has(String(competitor.status));
        const willBeFinished = finishedStatuses.has(mutable.status);
        if (previouslyFinished && !willBeFinished) {
          throw new Error(
            'En administratör måste återställa statusen för en färdig deltagare.'
          );
        }
        if (!previouslyFinished && willBeFinished) {
          if (authorization.officialRole === 'START') {
            throw new Error('Din roll har inte behörighet att markera deltagaren som färdig.');
          }
          transaction.update(competitionRef, {
            finishedCount: clampInt(
              Number(competition.finishedCount || 0) + 1,
              0,
              Number(competition.competitorCount || 0),
              0
            ),
            updatedAt: serverTimestamp(),
          });
        }
      }
      transaction.update(competitorRef, { ...mutable, updatedAt: serverTimestamp() });
    });
    return;
  }

  const context = await getCompetitionMutationContext(competitionId);
  const id = sanitizeFirestoreId(competitorId, 'cmp');
  const competitionRef = doc(db, 'competitions', context.competitionId);
  const competitorRef = doc(
    db,
    'competitions',
    context.competitionId,
    'competitors',
    id
  );
  const mutationResult = await runAtomicSIAssignmentMutation(
    {
      intent:
        typeof mutable.siNumber === 'number'
          ? 'CHANGE_SI_NUMBER'
          : 'UPDATE_COMPETITOR_IDENTITY',
      competitor: { competitionId: context.competitionId, competitorId: id },
      assignment: {
        ...(typeof mutable.siNumber === 'number'
          ? { requestedSiNumber: mutable.siNumber }
          : {}),
      },
    },
    ({
      transaction,
      competitionData,
      competitorData,
      assignmentSnapshots,
      result: transactionResult,
    }) => {
      if (!competitorData) return;
      const competition = competitionData;
      const existing = competitorData;
      if (competition.ownerUid !== context.ownerUid && !context.isSuperAdmin) {
        throw new Error('Ditt konto saknar behörighet att uppdatera deltagaren.');
      }
      const nextSiNumber =
        typeof mutable.siNumber === 'number' ? mutable.siNumber : Number(existing.siNumber);
      let assignmentWriteOutcome: AtomicSIAssignmentWriteOutcome | undefined;
      const currentSiNumber =
        Number.isInteger(existing.siNumber) && Number(existing.siNumber) > 0
          ? Number(existing.siNumber)
          : null;
      if (
        typeof mutable.siNumber === 'number' &&
        (!Number.isInteger(nextSiNumber) ||
          nextSiNumber < 1 ||
          nextSiNumber > 99999999)
      ) {
        assignmentWriteOutcome = 'SKIPPED_INVALID_DATA';
      }
      if (
        typeof mutable.siNumber === 'number' &&
        currentSiNumber !== nextSiNumber &&
        Number.isInteger(nextSiNumber) &&
        nextSiNumber >= 1 &&
        nextSiNumber <= 99999999
      ) {
        const currentAssignmentSnapshot =
          currentSiNumber === null ? undefined : assignmentSnapshots.get(currentSiNumber);
        const targetAssignmentSnapshot = assignmentSnapshots.get(nextSiNumber);
        const currentAssignment = currentAssignmentSnapshot?.exists()
          ? parseSICardAssignmentDocument(
              currentAssignmentSnapshot.id,
              context.competitionId,
              currentAssignmentSnapshot.data()
            )
          : null;
        const targetAssignment = targetAssignmentSnapshot?.exists()
          ? parseSICardAssignmentDocument(
              targetAssignmentSnapshot.id,
              context.competitionId,
              targetAssignmentSnapshot.data()
            )
          : null;
        const plan = planReassignSIAssignmentWrite(currentAssignment, targetAssignment, id);
        const currentMalformed =
          currentAssignmentSnapshot?.exists() && currentAssignment === null;
        const targetMalformed =
          targetAssignmentSnapshot?.exists() && targetAssignment === null;
        if (
          currentMalformed ||
          targetMalformed ||
          plan.conflict ||
          transactionResult.duplicateCandidateDetected ||
          transactionResult.duplicateCandidateQueryError
        ) {
          throw new Error(
            transactionResult.duplicateCandidateDetected
              ? `SI-bricka ${nextSiNumber} används redan av en annan deltagare.`
              : transactionResult.duplicateCandidateQueryError
                ? 'SI-brickans unika ägare kunde inte verifieras. Försök igen.'
                : 'SI-brickans befintliga ägarskap är oförenligt med omfördelningen.'
          );
        }
        const oldAction = plan.oldAssignment;
        const targetAction = plan.targetAssignment;
        const now = Timestamp.now();

        if (oldAction === 'RETIRE' && currentAssignment) {
          if (currentSiNumber !== null) {
            transaction.update(
              getCompetitionSICardAssignmentRef(context.competitionId, currentSiNumber),
              {
                state: 'RETIRED',
                assignmentVersion: currentAssignment.assignmentVersion + 1,
                updatedAt: now,
                retiredAt: now,
                retirementReason: 'si_reassigned',
                previousCompetitorId: id,
              }
            );
          }
        } else if (oldAction === 'MISSING' && currentSiNumber !== null) {
          const retirementOutcome = retireSIAssignmentInTransaction({
            transaction,
            competitionId: context.competitionId,
            competitorId: id,
            competitorData: existing,
            assignmentSnapshot: currentAssignmentSnapshot,
            ownerUid: context.ownerUid,
            retirementReason: 'si_reassigned',
          });
          if (retirementOutcome !== 'RETIRED') {
            throw new Error('Deltagarens nuvarande SI-ägarskap kunde inte avslutas.');
          }
        }

        if (targetAction === 'CREATE') {
          const cardSeries =
            typeof mutable.cardSeries === 'string' &&
            mutable.cardSeries.length > 0 &&
            mutable.cardSeries.length <= 24
              ? mutable.cardSeries
              : typeof existing.cardSeries === 'string'
                ? existing.cardSeries
                : '';
          if (cardSeries.length === 0 || cardSeries.length > 24) {
            throw new Error('Deltagarens kortserie är ogiltig.');
          }
          transaction.set(
            getCompetitionSICardAssignmentRef(context.competitionId, nextSiNumber),
            {
              competitionId: context.competitionId,
              siNumber: nextSiNumber,
              cardSeries,
              competitorId: id,
              competitorDocumentId: id,
              state: 'ACTIVE',
              assignmentVersion: 1,
              source: 'MANUAL',
              ownerUid: context.ownerUid,
              schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
              createdAt: now,
              updatedAt: now,
            }
          );
        } else if (targetAction === 'ACTIVATE' && targetAssignment) {
          const cardSeries =
            typeof mutable.cardSeries === 'string' &&
            mutable.cardSeries.length > 0 &&
            mutable.cardSeries.length <= 24
              ? mutable.cardSeries
              : targetAssignment.cardSeries;
          transaction.update(
            getCompetitionSICardAssignmentRef(context.competitionId, nextSiNumber),
            {
              cardSeries,
              competitorId: id,
              competitorDocumentId: id,
              state: 'ACTIVE',
              assignmentVersion: targetAssignment.assignmentVersion + 1,
              updatedAt: now,
              retiredAt: null,
              retirementReason: null,
              previousCompetitorId:
                targetAssignment.competitorId ?? targetAssignment.previousCompetitorId ?? null,
            }
          );
        }

        assignmentWriteOutcome = 'REASSIGNED';
        console.info(
          `[si-assignment-reassignment] ${JSON.stringify({
            competitionId: context.competitionId,
            competitorId: id,
            fromSiNumber: currentSiNumber,
            toSiNumber: nextSiNumber,
            oldAssignmentAction: oldAction,
            targetAssignmentAction: targetAction,
            conflict: false,
            assignmentWriteOutcome,
            coveredPathEnforcement: true,
            writesContinue: true,
          })}`
        );
      }
      console.info(
        `[atomic-si-mutation-would-enforce] ${JSON.stringify({
          intent:
            typeof mutable.siNumber === 'number'
              ? 'CHANGE_SI_NUMBER'
              : 'UPDATE_COMPETITOR_IDENTITY',
          competitionId: context.competitionId,
          competitorId: id,
          currentSiNumber: Number(existing.siNumber),
          requestedSiNumber: nextSiNumber,
          action: 'validate_assignment_and_update_competitor_atomically',
          coveredPathEnforcement: true,
        })}`
      );
      transaction.update(competitorRef, { ...mutable, updatedAt: serverTimestamp() });
      if (typeof mutable.status === 'string') {
        const finishedStatuses = new Set(['OK', 'MP', 'PRELIMINARY_FIN']);
        const previouslyFinished = finishedStatuses.has(String(existing.status));
        const willBeFinished = finishedStatuses.has(mutable.status);
        if (previouslyFinished !== willBeFinished) {
          transaction.update(competitionRef, {
            finishedCount: clampInt(
              Number(competition.finishedCount || 0) + (willBeFinished ? 1 : -1),
              0,
              Number(competition.competitorCount || 0),
              0
            ),
            updatedAt: serverTimestamp(),
          });
        }
      }
      return assignmentWriteOutcome;
    }
  );
  if (mutationResult.status !== 'COMMITTED') {
    throw new Error('Tävlingen eller deltagaren hittades inte i Firestore.');
  }
}

export async function updateCompetitorBillingFieldsInFirestore(
  competitionId: string,
  competitorId: string,
  patch: Partial<Pick<Competitor, 'feePaid' | 'rentalReturned'>>
): Promise<void> {
  const authorization = await getCurrentFirebaseRoles();
  const hasFeeUpdate = typeof patch.feePaid === 'boolean';
  const hasRentalUpdate = typeof patch.rentalReturned === 'boolean';
  const isRentalOfficial = authorization.officialRole === 'READOUT' && !hasFeeUpdate;
  if ((!authorization.adminTier && !isRentalOfficial) || (!hasFeeUpdate && !hasRentalUpdate)) {
    throw new Error('Ditt Google-konto saknar behörighet att ändra betalnings- eller hyrstatus.');
  }

  const safeCompetitionId = sanitizeFirestoreId(competitionId, 'evt');
  const safeCompetitorId = sanitizeFirestoreId(competitorId, 'cmp');
  const competitionRef = doc(db, 'competitions', safeCompetitionId);
  const competitorRef = doc(
    db,
    'competitions',
    safeCompetitionId,
    'competitors',
    safeCompetitorId
  );
  await runTransaction(db, async (transaction) => {
    const [competitionSnap, competitorSnap] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(competitorRef),
    ]);
    if (!competitionSnap.exists() || !competitorSnap.exists()) {
      throw new Error('Tävlingen eller deltagaren hittades inte i Firestore.');
    }
    if (
      competitionSnap.data().status === 'COMPLETED' &&
      authorization.adminTier !== 'SUPER_ADMIN'
    ) {
      throw new Error('Ekonomi- och hyrstatus kan inte ändras i en avslutad tävling.');
    }

    declareCompetitorMutation({
      source: 'updateCompetitorBillingFieldsInFirestore',
      operation: 'UPDATE',
      competitionId: safeCompetitionId,
      competitorId: safeCompetitorId,
      siNumber: Number(competitorSnap.data().siNumber),
      assignmentHandling: {
        mode: 'LEGACY',
        reason: 'Billing/rental mutation does not validate SI assignment because it does not change competitor identity.',
      },
      identityAffecting: false,
    });
    transaction.update(competitorRef, {
      ...(hasFeeUpdate ? { feePaid: patch.feePaid } : {}),
      ...(hasRentalUpdate ? { rentalReturned: patch.rentalReturned } : {}),
      billingFieldsUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function deleteCompetitorFromFirestore(
  competitionId: string,
  competitorId: string
): Promise<void> {
  const context = await getCompetitionMutationContext(competitionId);
  const competitionRef = doc(db, 'competitions', context.competitionId);
  const competitorRef = doc(
    db,
    'competitions',
    context.competitionId,
    'competitors',
    sanitizeFirestoreId(competitorId, 'cmp')
  );

  const safeCompetitorId = sanitizeFirestoreId(competitorId, 'cmp');
  const mutationResult = await runAtomicSIAssignmentMutation(
    {
      intent: 'DELETE_COMPETITOR',
      competitor: {
        competitionId: context.competitionId,
        competitorId: safeCompetitorId,
      },
      assignment: {},
    },
    ({ transaction, competitionData, competitorData, assignmentSnapshots }) => {
      if (!competitorData) return;
      const competition = competitionData;
      const competitor = competitorData;
      if (competition.ownerUid !== context.ownerUid && !context.isSuperAdmin) {
        throw new Error('Ditt konto saknar behörighet att ta bort deltagaren.');
      }
      if (competition.status === 'COMPLETED' && !context.isSuperAdmin) {
        throw new Error('Deltagare kan inte tas bort från en avslutad tävling.');
      }
      const finished = ['OK', 'MP', 'PRELIMINARY_FIN'].includes(String(competitor.status));
      const currentSiNumber =
        typeof competitor.siNumber === 'number' ? competitor.siNumber : null;
      const assignmentWriteOutcome = retireSIAssignmentInTransaction({
        transaction,
        competitionId: context.competitionId,
        competitorId: safeCompetitorId,
        competitorData: competitor,
        assignmentSnapshot:
          currentSiNumber === null ? undefined : assignmentSnapshots.get(currentSiNumber),
        ownerUid: context.ownerUid,
        retirementReason: 'competitor_deleted',
      });
      console.info(
        `[atomic-si-mutation-would-enforce] ${JSON.stringify({
          intent: 'DELETE_COMPETITOR',
          competitionId: context.competitionId,
          competitorId: safeCompetitorId,
          currentSiNumber: Number(competitor.siNumber),
          action: 'retire_assignment_and_delete_competitor_atomically',
          enforcementActive: false,
        })}`
      );
      transaction.delete(competitorRef);
      transaction.update(competitionRef, {
        competitorCount: Math.max(0, Number(competition.competitorCount || 0) - 1),
        ...(finished
          ? { finishedCount: Math.max(0, Number(competition.finishedCount || 0) - 1) }
          : {}),
        updatedAt: serverTimestamp(),
      });
      return assignmentWriteOutcome;
    }
  );
  if (mutationResult.status !== 'COMMITTED') {
    throw new Error('Tävlingen eller deltagaren hittades inte i Firestore.');
  }
}

export async function retireCompetitorInFirestore(
  competitionId: string,
  competitorId: string,
  retirementReason = 'competitor_retired'
): Promise<void> {
  const context = await getCompetitionMutationContext(competitionId);
  const safeCompetitorId = sanitizeFirestoreId(competitorId, 'cmp');
  const competitionRef = doc(db, 'competitions', context.competitionId);
  const competitorRef = doc(
    db,
    'competitions',
    context.competitionId,
    'competitors',
    safeCompetitorId
  );
  const mutationResult = await runAtomicSIAssignmentMutation(
    {
      intent: 'RETIRE_COMPETITOR',
      competitor: {
        competitionId: context.competitionId,
        competitorId: safeCompetitorId,
      },
      assignment: {},
    },
    ({ transaction, competitionData, competitorData, assignmentSnapshots }) => {
      if (!competitorData) return;
      if (competitionData.ownerUid !== context.ownerUid && !context.isSuperAdmin) {
        throw new Error('Ditt konto saknar behörighet att avanmäla deltagaren.');
      }
      if (competitionData.status === 'COMPLETED' && !context.isSuperAdmin) {
        throw new Error('Deltagare kan inte avanmäls från en avslutad tävling.');
      }

      const siNumber =
        typeof competitorData.siNumber === 'number' ? competitorData.siNumber : null;
      const assignmentWriteOutcome = retireSIAssignmentInTransaction({
        transaction,
        competitionId: context.competitionId,
        competitorId: safeCompetitorId,
        competitorData,
        assignmentSnapshot:
          siNumber === null ? undefined : assignmentSnapshots.get(siNumber),
        ownerUid: context.ownerUid,
        retirementReason,
      });
      const currentStatus = String(competitorData.status);
      let nextStatus: RunnerStatus;
      switch (currentStatus) {
        case 'IN_FOREST':
        case 'PRELIMINARY_FIN':
          nextStatus = 'DNF';
          break;
        case 'OK':
        case 'MP':
        case 'DNF':
          nextStatus = currentStatus;
          break;
        default:
          nextStatus = 'DNS';
      }
      const wasCountedAsFinished = ['OK', 'MP', 'PRELIMINARY_FIN'].includes(currentStatus);
      const willBeCountedAsFinished = ['OK', 'MP', 'PRELIMINARY_FIN'].includes(nextStatus);
      transaction.update(competitorRef, {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      if (wasCountedAsFinished !== willBeCountedAsFinished) {
        transaction.update(competitionRef, {
          finishedCount: Math.max(
            0,
            Number(competitionData.finishedCount || 0) +
              (willBeCountedAsFinished ? 1 : -1)
          ),
          updatedAt: serverTimestamp(),
        });
      }
      return assignmentWriteOutcome;
    }
  );
  if (mutationResult.status !== 'COMMITTED') {
    throw new Error('Tävlingen eller deltagaren hittades inte i Firestore.');
  }
}

function retireSIAssignmentInTransaction(params: {
  transaction: Transaction;
  competitionId: string;
  competitorId: string;
  competitorData: Record<string, unknown>;
  assignmentSnapshot?: DocumentSnapshot;
  ownerUid: string;
  retirementReason: string;
}): AtomicSIAssignmentWriteOutcome {
  const siNumber =
    typeof params.competitorData.siNumber === 'number'
      ? params.competitorData.siNumber
      : Number.NaN;
  const cardSeries = params.competitorData.cardSeries;
  if (
    !Number.isInteger(siNumber) ||
    siNumber < 1 ||
    siNumber > 99999999 ||
    typeof cardSeries !== 'string' ||
    cardSeries.length < 1 ||
    cardSeries.length > 24 ||
    !params.ownerUid
  ) {
    return 'SKIPPED_INVALID_DATA';
  }

  const existingAssignment =
    params.assignmentSnapshot?.exists()
      ? parseSICardAssignmentDocument(
          params.assignmentSnapshot.id,
          params.competitionId,
          params.assignmentSnapshot.data()
        )
      : null;
  if (params.assignmentSnapshot?.exists() && !existingAssignment) {
    return 'SKIPPED_CONFLICT';
  }
  const action = planRetireSIAssignmentWrite(existingAssignment, params.competitorId);
  const assignmentRef = getCompetitionSICardAssignmentRef(
    params.competitionId,
    siNumber
  );
  if (action === 'CREATE_RETIRED') {
    params.transaction.set(assignmentRef, {
      competitionId: params.competitionId,
      siNumber,
      cardSeries,
      competitorId: params.competitorId,
      competitorDocumentId: params.competitorId,
      state: 'RETIRED',
      assignmentVersion: 1,
      source: 'SYSTEM',
      ownerUid: params.ownerUid,
      schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      retiredAt: serverTimestamp(),
      retirementReason: params.retirementReason.slice(0, 200),
    });
    return 'RETIRED';
  }
  if (action === 'RETIRE' && existingAssignment) {
    params.transaction.update(assignmentRef, {
      state: 'RETIRED',
      assignmentVersion: existingAssignment.assignmentVersion + 1,
      updatedAt: serverTimestamp(),
      retiredAt: serverTimestamp(),
      retirementReason: params.retirementReason.slice(0, 200),
    });
    return 'RETIRED';
  }
  if (action === 'ALREADY_RETIRED') return 'ALREADY_RETIRED';
  if (action === 'SKIP_VERSION_LIMIT') return 'SKIPPED_VERSION_LIMIT';
  return 'SKIPPED_CONFLICT';
}

export async function deleteRunnerDbEntryFromFirestore(siNumber: number): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (
    !current ||
    !current.emailVerified ||
    !current.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Raderingen kräver ett inloggat, verifierat Google-administratörskonto.');
  }
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', sanitizeFirestoreId(current.uid, 'usr')));
  const role = adminSnap?.exists() ? adminSnap.data().role : null;
  if (!isBootstrapAdmin && role !== 'RACE_ADMIN' && role !== 'SUPER_ADMIN') {
    throw new Error('Ditt Google-konto saknar administratörsbehörighet.');
  }
  if (!Number.isInteger(siNumber) || siNumber < 1 || siNumber > 99999999) {
    throw new Error('Ogiltigt SI-nummer.');
  }
  await deleteDoc(doc(db, 'runnerDb', String(siNumber)));
}

async function ensureRunnerDbAdmin(): Promise<User> {
  const current = await ensureValidFirestoreUser();
  if (
    !current ||
    !current.emailVerified ||
    !current.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Löpardatabasen kräver ett inloggat, verifierat Google-administratörskonto.');
  }
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', sanitizeFirestoreId(current.uid, 'usr')));
  const role = adminSnap?.exists() ? adminSnap.data().role : null;
  if (!isBootstrapAdmin && role !== 'RACE_ADMIN' && role !== 'SUPER_ADMIN') {
    throw new Error('Ditt Google-konto saknar administratörsbehörighet för löpardatabasen.');
  }
  return current;
}

function runnerDbFirestoreFields(runner: RunnerDbEntry) {
  return {
    siNumber: runner.siNumber,
    cardSeries: runner.cardSeries,
    fullName: runner.fullName.trim().slice(0, 120),
    club: runner.club.trim().slice(0, 100),
    birthYear: runner.birthYear,
    defaultClassName: (runner.defaultClassName || '').trim().slice(0, 80),
    eventorPersonId: (runner.eventorPersonId || '').trim().slice(0, 128),
    eventorOrgId: (runner.eventorOrgId || '').trim().slice(0, 32),
    source: runner.source,
    updatedAtIso: runner.updatedAt,
  };
}

export async function saveRunnerDbEntriesToFirestore(
  runners: RunnerDbEntry[]
): Promise<void> {
  const current = await ensureRunnerDbAdmin();
  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', ownerUid));
  const isSuperAdmin = isBootstrapAdmin || adminSnap?.data()?.role === 'SUPER_ADMIN';
  for (let offset = 0; offset < runners.length; offset += 400) {
    const batch = writeBatch(db);
    for (const runner of runners.slice(offset, offset + 400)) {
      if (
        !Number.isInteger(runner.siNumber) ||
        runner.siNumber < 1 ||
        runner.siNumber > 99999999 ||
        !runner.fullName.trim()
      ) {
        continue;
      }
      const id = String(runner.siNumber);
      const runnerRef = doc(db, 'runnerDb', id);
      const existing = await getDoc(runnerRef);
      if (
        existing.exists() &&
        existing.data().ownerUid !== ownerUid &&
        !isSuperAdmin
      ) {
        throw new Error('Importerad löpare tillhör ett annat konto.');
      }
      const existingData = existing.exists() ? existing.data() : {};
      batch.set(
        runnerRef,
        {
          runnerId: id,
          ...runnerDbFirestoreFields({
            ...runner,
            birthYear:
              runner.birthYear ??
              (typeof existingData.birthYear === 'number' ? existingData.birthYear : null),
            defaultClassName:
              runner.defaultClassName ??
              (typeof existingData.defaultClassName === 'string'
                ? existingData.defaultClassName
                : null),
            eventorPersonId:
              runner.eventorPersonId ??
              (typeof existingData.eventorPersonId === 'string'
                ? existingData.eventorPersonId
                : null),
            eventorOrgId:
              runner.eventorOrgId ??
              (typeof existingData.eventorOrgId === 'string'
                ? existingData.eventorOrgId
                : null),
          }),
          ownerUid: existing.exists() ? existingData.ownerUid : ownerUid,
          ...(!existing.exists() ? { createdAt: serverTimestamp() } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

export async function saveLearnedRunnerDbEntryToFirestore(
  runner: RunnerDbEntry
): Promise<RunnerDbEntry | null> {
  const current = await ensureRunnerDbAdmin();
  if (
    !Number.isInteger(runner.siNumber) ||
    runner.siNumber < 1 ||
    runner.siNumber > 99999999 ||
    !runner.fullName.trim()
  ) {
    throw new Error('Ange ett giltigt namn och SI-bricknummer.');
  }
  const id = String(runner.siNumber);
  const ref = doc(db, 'runnerDb', id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const currentEntry = parseRunnerDbDocument(
      existing.id,
      existing.data() as Record<string, unknown>
    );
    if (!currentEntry) {
      throw new Error('Löparposten i Firestore har ett ogiltigt SI-bricknummer.');
    }
    if (
      currentEntry.fullName.trim().toLocaleLowerCase() !==
      runner.fullName.trim().toLocaleLowerCase()
    ) {
      return currentEntry;
    }
    const mutable = {
      ...runnerDbFirestoreFields(runner),
      birthYear: runner.birthYear ?? currentEntry.birthYear,
      defaultClassName: runner.defaultClassName || currentEntry.defaultClassName || '',
      eventorPersonId: runner.eventorPersonId || currentEntry.eventorPersonId || '',
      eventorOrgId: runner.eventorOrgId || currentEntry.eventorOrgId || '',
      source: runner.source === 'LEARNED_ENTRY' ? currentEntry.source : runner.source,
    };
    await updateDoc(ref, { ...mutable, updatedAt: serverTimestamp() });
    return { ...currentEntry, ...runner, ...mutable, id };
  }

  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  await setDoc(ref, {
    runnerId: id,
    ...runnerDbFirestoreFields(runner),
    ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { ...runner, id };
}

export async function updateRunnerDbEntryInFirestore(
  previousSiNumber: number,
  runner: RunnerDbEntry
): Promise<void> {
  const current = await ensureRunnerDbAdmin();
  if (
    !Number.isInteger(previousSiNumber) ||
    previousSiNumber < 1 ||
    previousSiNumber > 99999999 ||
    !Number.isInteger(runner.siNumber) ||
    runner.siNumber < 1 ||
    runner.siNumber > 99999999 ||
    !runner.fullName.trim()
  ) {
    throw new Error('Ange ett giltigt namn och SI-bricknummer.');
  }

  const previousRef = doc(db, 'runnerDb', String(previousSiNumber));
  const nextRef = doc(db, 'runnerDb', String(runner.siNumber));
  const [previousSnap, nextSnap] = await Promise.all([getDoc(previousRef), getDoc(nextRef)]);
  if (!previousSnap.exists()) {
    throw new Error('Löparen hittades inte i Firestore.');
  }
  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', ownerUid));
  const isSuperAdmin = isBootstrapAdmin || adminSnap?.data()?.role === 'SUPER_ADMIN';
  if (previousSnap.data().ownerUid !== ownerUid && !isSuperAdmin) {
    throw new Error('Du saknar behörighet att ändra den här löparen.');
  }
  if (previousSiNumber !== runner.siNumber && nextSnap.exists()) {
    throw new Error('SI-bricknumret finns redan i löpardatabasen.');
  }

  const batch = writeBatch(db);
  batch.set(
    nextRef,
    {
      runnerId: String(runner.siNumber),
      ...runnerDbFirestoreFields(runner),
      ownerUid:
        previousSiNumber === runner.siNumber
          ? previousSnap.data().ownerUid
          : ownerUid,
      ...(previousSiNumber !== runner.siNumber
        ? { createdAt: serverTimestamp() }
        : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  if (previousSiNumber !== runner.siNumber) batch.delete(previousRef);
  await batch.commit();
}

export async function recalculateCompetitionFromFirestore(
  competitionId: string,
  patch?: Partial<EmergencySettings>
): Promise<{
  recalculatedCount: number;
  emergency: EmergencySettings;
  competitors: Competitor[];
}> {
  const context = await getCompetitionMutationContext(competitionId);
  const season = await loadFullSeasonFromFirestore({
    competitionId: context.competitionId,
    includeRunnerDb: false,
  });
  const event = season?.events.find(
    (candidate) => candidate.competition.id === context.competitionId
  );
  if (!event) throw new Error('Tävlingen hittades inte i Firestore.');

  const emergency: EmergencySettings = {
    brokenControls: Array.from(
      new Set(
        (patch?.brokenControls ?? event.brokenControls)
          .map((code) => clampInt(code, 1, 999, 31))
      )
    ).slice(0, 64),
    controlTimeOffsets: normalizeControlTimeOffsets(
      patch?.controlTimeOffsets ?? event.emergency?.controlTimeOffsets
    ),
  };
  const competitors = event.competitors.map((runner) => ({ ...runner }));
  const updates: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];
  let recalculatedCount = 0;
  for (const runner of competitors) {
    const raw = runner.rawReadout;
    const sourcePunches = raw ? raw.punches : runner.cardPunches;
    const hasReadoutData = Boolean(raw || runner.readoutAt || sourcePunches.length > 0);
    if (!hasReadoutData) continue;

    const effectiveStart =
      runner.startTimeSec ??
      raw?.startTimeSec ??
      runner.allocatedStartSec ??
      event.competition.zeroTimeSec;
    const effectiveFinish =
      runner.manualFinishTimeSec ?? raw?.finishTimeSec ?? runner.finishTimeSec;
    const validation = validateCompetitorReadout(
      event.classes.find((candidate) => candidate.id === runner.classId),
      event.courses,
      effectiveStart,
      effectiveFinish,
      sourcePunches,
      emergency
    );
    runner.cardPunches = applyEmergencyTimeOffsets(
      sourcePunches,
      emergency.controlTimeOffsets
    );
    runner.finishTimeSec = effectiveFinish;
    runner.runningTimeSec =
      effectiveFinish !== null && effectiveFinish >= effectiveStart
        ? effectiveFinish - effectiveStart
        : null;
    runner.validation = validation;
    if (runner.status !== 'DNF' && runner.status !== 'DNS') {
      runner.status = validation.ok ? 'OK' : 'MP';
    }

    updates.push({
      ref: doc(
        db,
        'competitions',
        context.competitionId,
        'competitors',
        sanitizeFirestoreId(runner.id, 'cmp')
      ),
      data: {
        status: runner.status,
        finishTimeSec: encodeNullableSec(runner.finishTimeSec),
        runningTimeSec: encodeNullableSec(runner.runningTimeSec),
        punchCodes: runner.cardPunches.map((punch) => clampInt(punch.code, 1, 999, 31)),
        punchTimes: runner.cardPunches.map((punch) => clampInt(punch.timeSec, 0, 86400, 0)),
        updatedAt: serverTimestamp(),
      },
    });
    declareCompetitorMutation({
      source: 'recalculateCompetitionFromFirestore',
      operation: 'UPDATE',
      competitionId: context.competitionId,
      competitorId: runner.id,
      siNumber: runner.siNumber,
      assignmentHandling: {
        mode: 'LEGACY',
        reason: 'Result recalculation does not validate SI assignment ownership.',
      },
      identityAffecting: false,
    });
    recalculatedCount += 1;
  }

  const finishedCount = competitors.filter((runner) =>
    ['OK', 'MP', 'PRELIMINARY_FIN'].includes(runner.status)
  ).length;
  for (let offset = 0; offset < updates.length; offset += 400) {
    const batch = writeBatch(db);
    for (const update of updates.slice(offset, offset + 400)) {
      batch.update(update.ref, update.data);
    }
    await batch.commit();
  }
  await updateDoc(doc(db, 'competitions', context.competitionId), {
    brokenControls: emergency.brokenControls,
    controlTimeOffsets: emergency.controlTimeOffsets,
    finishedCount,
    updatedAt: serverTimestamp(),
  });

  return { recalculatedCount, emergency, competitors };
}

export async function submitOnlinePunchToFirestore(
  competitionId: string,
  punch: {
    clientPunchId: string;
    siNumber: number;
    stationCode: number;
    punchTimeSec?: number;
    rawHex?: string;
    stationName?: string;
    stationFunction?: StationFunction;
    timeOffsetSec?: number;
  }
): Promise<{ deduplicated: boolean }> {
  const authorization = await getCurrentFirebaseRoles();
  if (
    !authorization.adminTier &&
    !['START', 'READOUT', 'FOREST'].includes(authorization.officialRole || '')
  ) {
    throw new Error('Ditt Google-konto saknar roll för radiokontroller och online-stämplingar.');
  }
  const context = {
    competitionId: sanitizeFirestoreId(competitionId, 'evt'),
    ownerUid: authorization.user.uid,
  };
  if (!Number.isInteger(punch.siNumber) || punch.siNumber < 1 || punch.siNumber > 99999999) {
    throw new Error('Ogiltigt SI-nummer vid online-stämpling.');
  }
  if (!Number.isInteger(punch.stationCode) || punch.stationCode < 1 || punch.stationCode > 999) {
    throw new Error('Ogiltig kontrollkod vid online-stämpling.');
  }
  const rawTimeSec = punch.punchTimeSec ?? Number.NaN;
  if (punch.punchTimeSec !== undefined && (!Number.isInteger(rawTimeSec) || rawTimeSec < 0 || rawTimeSec > 86400)) {
    throw new Error('Ogiltig tid vid online-stämpling.');
  }
  const clientPunchId = sanitizeFirestoreId(punch.clientPunchId, 'op');
  const season = await loadFullSeasonFromFirestore({
    competitionId: context.competitionId,
    includeRunnerDb: false,
  });
  const event = season?.events.find((candidate) => candidate.competition.id === context.competitionId);
  if (!event) throw new Error('Tävlingen hittades inte i Firestore för online-stämplingen.');
  const configuredStation = (event.stations || []).find(
    (station) => station.active && station.stationCode === punch.stationCode
  );
  const stationFunction: StationFunction = configuredStation?.stationFunction ?? 'RADIO';
  const stationName = (
    configuredStation?.name ||
    punch.stationName ||
    `Radiokontroll (${punch.stationCode})`
  )
    .trim()
    .slice(0, 120);
  const now = new Date();
  const rawSec =
    punch.punchTimeSec ??
    Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Stockholm',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .format(now)
        .split(':')
        .reduce((acc, part) => acc * 60 + Number(part), 0)
    );
  const offsetSec = Number.isFinite(punch.timeOffsetSec)
    ? Math.round(Number(punch.timeOffsetSec))
    : 0;
  const punchTimeSec = (((rawSec + offsetSec) % 86400) + 86400) % 86400;
  const matchingRunners = event.competitors.filter(
    (competitor) =>
      competitor.siNumber === punch.siNumber && competitor.status !== 'DNS'
  );
  const runner =
    matchingRunners.find((competitor) =>
      ['IN_FOREST', 'CHECKED', 'REGISTERED', 'PRELIMINARY_FIN'].includes(competitor.status)
    ) ??
    matchingRunners[0] ??
    null;
  const competitorId = runner ? sanitizeFirestoreId(runner.id, 'cmp') : '';
  const competitorRef = runner
    ? doc(db, 'competitions', context.competitionId, 'competitors', competitorId)
    : null;
  const competitionRef = doc(db, 'competitions', context.competitionId);
  const punchRef = doc(
    db,
    'competitions',
    context.competitionId,
    'stationPunches',
    clientPunchId
  );
  const startRef =
    runner?.startTimeSec ?? runner?.allocatedStartSec ?? event.competition.zeroTimeSec;
  const runningTimeSec = runner && punchTimeSec >= startRef ? punchTimeSec - startRef : -1;
  const isPrewarning = stationFunction === 'PREWARNING';

  return runTransaction(db, async (transaction) => {
    const [existingPunch, competitionSnap] = await Promise.all([
      transaction.get(punchRef),
      transaction.get(competitionRef),
    ]);
    if (existingPunch.exists()) return { deduplicated: true };
    if (!competitionSnap.exists()) throw new Error('Tävlingen hittades inte i Firestore.');

    const competitorSnap = competitorRef ? await transaction.get(competitorRef) : null;
    const competition = competitionSnap.data();
    const createdAt = serverTimestamp();
    transaction.set(punchRef, {
      punchId: clientPunchId,
      competitionId: context.competitionId,
      ownerUid: context.ownerUid,
      clientPunchId,
      siNumber: punch.siNumber,
      stationCode: punch.stationCode,
      punchTimeSec,
      rawHex: (punch.rawHex || '').slice(0, 2000),
      stationName,
      stationFunction,
      competitorId: competitorSnap?.exists() ? competitorId : '',
      runningTimeSec,
      isPrewarning,
      createdAt,
    });

    if (!competitorSnap?.exists() || !competitorRef) {
      return { deduplicated: false };
    }
    declareCompetitorMutation({
      source: 'submitOnlinePunchToFirestore',
      operation: 'UPDATE',
      competitionId: context.competitionId,
      competitorId,
      siNumber: punch.siNumber,
      assignmentHandling: {
        mode: 'LEGACY',
        reason: 'Online punch status/time update does not validate SI assignment ownership.',
      },
      identityAffecting: false,
    });
    const competitor = competitorSnap.data();
    const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (stationFunction === 'CHECK') {
      update.checkTimeSec = punchTimeSec;
      if (competitor.status === 'REGISTERED' || competitor.status === 'DNS') {
        update.status = 'CHECKED';
      }
    } else if (stationFunction === 'START') {
      update.startTimeSec = punchTimeSec;
      if (
        competitor.status === 'REGISTERED' ||
        competitor.status === 'CHECKED' ||
        competitor.status === 'DNS'
      ) {
        update.status = 'IN_FOREST';
      }
    } else if (stationFunction === 'FINISH') {
      update.finishTimeSec = punchTimeSec;
      update.runningTimeSec = runningTimeSec;
      if (competitor.status !== 'OK' && competitor.status !== 'MP') {
        update.status = 'PRELIMINARY_FIN';
      }
      if (
        !['OK', 'MP', 'DNF', 'PRELIMINARY_FIN'].includes(String(competitor.status))
      ) {
        transaction.update(competitionRef, {
          finishedCount: Math.min(
            Number(competition.competitorCount || 0),
            Number(competition.finishedCount || 0) + 1
          ),
          updatedAt: serverTimestamp(),
        });
      }
    } else if (
      (stationFunction === 'RADIO' || stationFunction === 'PREWARNING') &&
      (competitor.status === 'REGISTERED' || competitor.status === 'CHECKED')
    ) {
      update.status = 'IN_FOREST';
    }
    transaction.update(competitorRef, update);
    return { deduplicated: false };
  });
}

function buildReadoutAutoCreateCompetitorId(clientReadoutId: string): string {
  let firstHash = 2166136261;
  let secondHash = 5381;
  for (let index = 0; index < clientReadoutId.length; index += 1) {
    const code = clientReadoutId.charCodeAt(index);
    firstHash = Math.imul(firstHash ^ code, 16777619) >>> 0;
    secondHash = (Math.imul(secondHash, 33) ^ code) >>> 0;
  }
  return `cmp_ro_${firstHash.toString(36)}_${secondHash.toString(36)}`;
}

export async function submitReadoutToFirestore(
  eventId: string | undefined,
  readout: FullCardReadoutPayload
): Promise<{
  competitor?: Competitor | null;
  unknownCardReadout?: {
    siNumber: number;
    checkTimeSec?: number | null;
    startTimeSec?: number | null;
    finishTimeSec?: number | null;
    punches?: FullCardReadoutPayload['punches'];
  };
}> {
  const authorization = await getCurrentFirebaseRoles();
  if (
    !authorization.adminTier &&
    !['READOUT', 'FOREST', 'SPEAKER'].includes(authorization.officialRole || '')
  ) {
    throw new Error('Ditt Google-konto saknar funktionärsroll för avläsningssynkning.');
  }
  const current = authorization.user;
  if (!eventId) {
    throw new Error('Tävlingen för den köade avläsningen saknas.');
  }

  const siNumber = Number(readout.siNumber);
  if (!Number.isInteger(siNumber) || siNumber < 1 || siNumber > 99999999) {
    throw new Error('Ogiltigt SI-nummer vid utläsning.');
  }
  if (!Array.isArray(readout.punches) || readout.punches.length > 192) {
    throw new Error('Avläsningen innehåller ett ogiltigt antal stämplingar.');
  }
  const normalizeReadoutTime = (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    if (!Number.isInteger(value) || value < 0 || value > 86400) {
      throw new Error('Avläsningen innehåller en ogiltig tid.');
    }
    return value;
  };
  const checkTimeSec = normalizeReadoutTime(readout.checkTimeSec);
  const cardStartTimeSec = normalizeReadoutTime(readout.startTimeSec);
  const cardFinishTimeSec = normalizeReadoutTime(readout.finishTimeSec);
  if (
    typeof readout.cardSeries !== 'string' ||
    readout.cardSeries.length === 0 ||
    readout.cardSeries.length > 24
  ) {
    throw new Error('Avläsningen innehåller en ogiltig SI-bricktyp.');
  }
  const punches = readout.punches.map((punch) => {
    const code = Number(punch.code);
    const timeSec = Number(punch.timeSec);
    if (
      !Number.isInteger(code) ||
      code < 1 ||
      code > 999 ||
      !Number.isInteger(timeSec) ||
      timeSec < 0 ||
      timeSec > 86400
    ) {
      throw new Error('Avläsningen innehåller en ogiltig stämpling.');
    }
    return { code, timeSec };
  });

  const season = await loadFullSeasonFromFirestore({ competitionId: eventId });
  if (!season) {
    throw new Error('Tävlingen kunde inte läsas från Firestore för den köade avläsningen.');
  }
  const event = season.events.find(
    (candidate) =>
      candidate.competition.id === eventId ||
      candidate.competition.shortCode.toLowerCase() === eventId.toLowerCase()
  );
  if (!event) {
    throw new Error('Tävlingen hittades inte i Firestore för den köade avläsningen.');
  }

  const competitionId = sanitizeFirestoreId(event.competition.id, 'evt');
  const eligibleRunners = event.competitors.filter(
    (runner) => runner.siNumber === siNumber && runner.status !== 'DNS'
  );
  let runner =
    eligibleRunners.find(
      (candidate) =>
        candidate.status === 'IN_FOREST' ||
        candidate.status === 'CHECKED' ||
        candidate.status === 'REGISTERED' ||
        candidate.status === 'PRELIMINARY_FIN'
    ) ??
    eligibleRunners[0] ??
    null;

  const clientReadoutId = sanitizeFirestoreId(
    readout.clientReadoutId || `ro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    'ro'
  );
  const now = new Date();
  const nowIso = now.toISOString();
  const nowSec = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .format(now)
      .split(':')
      .reduce((acc, part) => acc * 60 + Number(part), 0)
  );
  const runnerDbMatch = runner
    ? null
    : (season.runnerDb ?? []).find((candidate) => candidate.siNumber === siNumber) ?? null;
  let autoCreatedFromRunnerDb = false;
  if (!runner && runnerDbMatch && readout.autoCreateFromRunnerDb === true) {
    const defaultClassName = runnerDbMatch.defaultClassName?.trim();
    const namedClass = defaultClassName
      ? event.classes.find(
          (candidate) =>
            candidate.name.toLowerCase() === defaultClassName.toLowerCase()
        )
      : null;
    const openAutoClass = event.classes.find((candidate) => candidate.autoMatchCourse) ?? null;
    let selectedClass = namedClass ?? openAutoClass ?? event.classes[0] ?? null;
    if (namedClass && openAutoClass && punches.length > 0) {
      const classCheck = validateCompetitorReadout(
        namedClass,
        event.courses,
        cardStartTimeSec ?? event.competition.zeroTimeSec,
        cardFinishTimeSec ?? nowSec,
        punches,
        event.emergency ?? { brokenControls: event.brokenControls, controlTimeOffsets: {} }
      );
      if (!classCheck.ok) selectedClass = openAutoClass;
    }
    runner = {
      id: buildReadoutAutoCreateCompetitorId(clientReadoutId),
      bib:
        Math.max(400, ...event.competitors.map((candidate) => Number(candidate.bib) || 0)) +
        1,
      fullName: runnerDbMatch.fullName.slice(0, 120),
      club: runnerDbMatch.club.slice(0, 100) || 'Klubblös',
      classId: selectedClass?.id ?? 'cls_open',
      siNumber,
      cardSeries: runnerDbMatch.cardSeries,
      isRentalCard: false,
      rentalReturned: false,
      feePaid: false,
      status: 'REGISTERED',
      allocatedStartSec: null,
      checkTimeSec: null,
      startTimeSec: null,
      finishTimeSec: null,
      manualFinishTimeSec: null,
      runningTimeSec: null,
      lastSeenControl: null,
      lastSeenTimeSec: null,
      readoutAt: null,
      radioSplits: [],
      cardPunches: [],
      rawReadout: null,
      validation: null,
    };
    autoCreatedFromRunnerDb = true;
  }
  const cardStartIsStale =
    cardStartTimeSec !== null &&
    punches.length > 0 &&
    cardStartTimeSec > punches[0].timeSec &&
    runner?.startTimeSec !== null &&
    runner?.startTimeSec !== undefined &&
    runner.startTimeSec <= punches[0].timeSec;
  const usableCardStart = cardStartIsStale ? null : cardStartTimeSec;
  const effectiveStart =
    usableCardStart ??
    runner?.startTimeSec ??
    runner?.allocatedStartSec ??
    event.competition.zeroTimeSec;
  const effectiveFinish =
    runner?.manualFinishTimeSec ??
    cardFinishTimeSec ??
    runner?.finishTimeSec ??
    nowSec;
  const validation = runner
    ? validateCompetitorReadout(
        event.classes.find((candidate) => candidate.id === runner.classId),
        event.courses,
        effectiveStart,
        effectiveFinish,
        punches,
        event.emergency ?? { brokenControls: event.brokenControls, controlTimeOffsets: {} }
      )
    : null;
  const updatedCompetitor: Competitor | null =
    runner && validation
      ? {
          ...runner,
          checkTimeSec: checkTimeSec ?? runner.checkTimeSec,
          startTimeSec: usableCardStart ?? runner.startTimeSec,
          finishTimeSec: effectiveFinish,
          runningTimeSec:
            effectiveFinish >= effectiveStart ? effectiveFinish - effectiveStart : null,
          lastSeenControl: 1,
          lastSeenTimeSec: effectiveFinish,
          readoutAt: nowIso,
          cardPunches: applyEmergencyTimeOffsets(
            punches,
            event.emergency?.controlTimeOffsets ?? {}
          ),
          rawReadout: {
            checkTimeSec,
            startTimeSec: usableCardStart ?? null,
            finishTimeSec: cardFinishTimeSec ?? effectiveFinish,
            punches,
            rawHex: readout.rawHex?.slice(0, 2000),
            receivedAt: nowIso,
            clientReadoutId,
          },
          status: validation.ok ? 'OK' : 'MP',
          validation,
        }
      : null;

  const competitionRef = doc(db, 'competitions', competitionId);
  const receiptRef = doc(
    db,
    'competitions',
    competitionId,
    'readoutReceipts',
    clientReadoutId
  );
  const ownerUid = current.uid;
  const commonReceipt = {
    receiptId: clientReadoutId,
    competitionId,
    ownerUid,
    clientReadoutId,
    siNumber,
    cardSeries: readout.cardSeries,
    stationCode:
      Number.isInteger(readout.stationCode) &&
      readout.stationCode >= 1 &&
      readout.stationCode <= 999
        ? readout.stationCode
        : 1,
    checkTimeSec: encodeNullableSec(checkTimeSec),
    startTimeSec: encodeNullableSec(cardStartTimeSec),
    finishTimeSec: encodeNullableSec(cardFinishTimeSec),
    punchCodes: punches.map((punch) => punch.code),
    punchTimes: punches.map((punch) => punch.timeSec),
    rawHex: (readout.rawHex || '').slice(0, 2000),
    createdAt: serverTimestamp(),
  };
  const receiptMatchesPayload = (receipt: Record<string, unknown>): boolean =>
    receipt.siNumber === siNumber &&
    receipt.cardSeries === readout.cardSeries &&
    receipt.stationCode === commonReceipt.stationCode &&
    receipt.checkTimeSec === commonReceipt.checkTimeSec &&
    receipt.startTimeSec === commonReceipt.startTimeSec &&
    receipt.finishTimeSec === commonReceipt.finishTimeSec &&
    JSON.stringify(receipt.punchCodes) === JSON.stringify(commonReceipt.punchCodes) &&
    JSON.stringify(receipt.punchTimes) === JSON.stringify(commonReceipt.punchTimes) &&
    receipt.rawHex === commonReceipt.rawHex;

  if (autoCreatedFromRunnerDb && runner && updatedCompetitor && validation) {
    const competitorId = sanitizeFirestoreId(runner.id, 'cmp');
    const competitorRef = doc(
      db,
      'competitions',
      competitionId,
      'competitors',
      competitorId
    );
    let assignmentResult = 'PENDING';
    let createdCompetitor = updatedCompetitor;
    let receiptStatus: 'UNKNOWN' | 'PROCESSED' | null = null;
    try {
      const mutationResult = await runAtomicSIAssignmentMutation(
        {
          intent: 'CREATE_COMPETITOR',
          competitor: { competitionId, competitorId },
          assignment: { requestedSiNumber: siNumber },
        },
        async ({
          transaction,
          competitionData,
          assignmentSnapshots,
          result: transactionContext,
        }) => {
          const existingReceipt = await transaction.get(receiptRef);
          if (existingReceipt.exists()) {
            const existing = existingReceipt.data();
            if (!receiptMatchesPayload(existing)) {
              throw new Error('Readout-ID:t används för en annan avläsning.');
            }
            assignmentResult = 'IDEMPOTENT_REPLAY';
            receiptStatus = existing.status === 'UNKNOWN' ? 'UNKNOWN' : 'PROCESSED';
            return 'NOT_APPLICABLE';
          }

          if (competitionData.status === 'COMPLETED') {
            throw new Error('Tävlingen är avslutad och tar inte emot fler avläsningar.');
          }

          const assignmentSnapshot = assignmentSnapshots.get(siNumber);
          const runnerRef = doc(db, 'runnerDb', String(siNumber));
          const runnerSnapshot = await transaction.get(runnerRef);
          const runnerData = runnerSnapshot.exists() ? runnerSnapshot.data() : null;
          const assignmentConflict = Boolean(assignmentSnapshot?.exists());
          const duplicateCompetitor = transactionContext.duplicateCandidateDetected;
          const duplicateCheckFailed =
            transactionContext.duplicateCandidateQueryError !== null;
          const identitySourceMatches =
            runnerData !== null &&
            Number(runnerData.siNumber) === siNumber &&
            runnerData.fullName === runnerDbMatch?.fullName &&
            runnerData.club === runnerDbMatch?.club &&
            runnerData.cardSeries === runnerDbMatch?.cardSeries;

          if (
            !runnerSnapshot.exists() ||
            !identitySourceMatches ||
            assignmentConflict ||
            duplicateCompetitor ||
            duplicateCheckFailed ||
            transactionContext.competitorExists
          ) {
            assignmentResult = assignmentConflict
              ? 'CONFLICT_EXISTING_ASSIGNMENT'
              : duplicateCompetitor
                ? 'CONFLICT_DUPLICATE_COMPETITOR'
                : duplicateCheckFailed
                  ? 'CONFLICT_DUPLICATE_CHECK_FAILED'
                  : !identitySourceMatches
                  ? 'CONFLICT_RUNNER_DB_CHANGED'
                  : 'CONFLICT_COMPETITOR_ID_EXISTS';
            transaction.set(receiptRef, {
              ...commonReceipt,
              status: 'UNKNOWN',
              competitorId: '',
            });
            receiptStatus = 'UNKNOWN';
            return 'NOT_APPLICABLE';
          }

          const observedMaxBib = Math.max(
            400,
            ...event.competitors.map((candidate) => Number(candidate.bib) || 0)
          );
          const competitorCount = Math.max(
            0,
            Number(competitionData.competitorCount) || 0
          );
          const bib =
            Math.max(observedMaxBib, 400) +
            Math.max(0, competitorCount - event.competitors.length) +
            1;
          if (bib > 99999) {
            throw new Error('Tävlingens startnummer har nått den tillåtna maxgränsen.');
          }
          createdCompetitor = { ...updatedCompetitor, bib };
          transaction.set(competitorRef, {
            competitorId,
            competitionId,
            bib,
            fullName: createdCompetitor.fullName.slice(0, 120),
            club: createdCompetitor.club.slice(0, 100) || 'Klubblös',
            classId: createdCompetitor.classId,
            siNumber,
            cardSeries: createdCompetitor.cardSeries,
            isRentalCard: false,
            rentalReturned: false,
            feePaid: false,
            status: createdCompetitor.status,
            allocatedStartSec: encodeNullableSec(createdCompetitor.allocatedStartSec),
            checkTimeSec: encodeNullableSec(createdCompetitor.checkTimeSec),
            startTimeSec: encodeNullableSec(createdCompetitor.startTimeSec),
            finishTimeSec: encodeNullableSec(createdCompetitor.finishTimeSec),
            manualFinishTimeSec: encodeNullableSec(createdCompetitor.manualFinishTimeSec),
            runningTimeSec: encodeNullableSec(createdCompetitor.runningTimeSec),
            readoutAtIso: createdCompetitor.readoutAt || '',
            punchCodes: punches.map((punch) => punch.code),
            punchTimes: punches.map((punch) => punch.timeSec),
            ownerUid,
            readoutReceiptId: clientReadoutId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          transaction.set(getCompetitionSICardAssignmentRef(competitionId, siNumber), {
            competitionId,
            siNumber,
            cardSeries: createdCompetitor.cardSeries,
            competitorId,
            competitorDocumentId: competitorId,
            state: 'ACTIVE',
            assignmentVersion: 1,
            source: 'READOUT',
            ownerUid,
            schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          const nextCompetitorCount = competitorCount + 1;
          transaction.update(competitionRef, {
            competitorCount: nextCompetitorCount,
            finishedCount: Math.min(
              nextCompetitorCount,
              (Number(competitionData.finishedCount) || 0) + 1
            ),
            updatedAt: serverTimestamp(),
          });
          transaction.set(receiptRef, {
            ...commonReceipt,
            status: 'PROCESSED',
            competitorId,
          });
          assignmentResult = 'CREATED';
          receiptStatus = 'PROCESSED';
          return 'CREATED';
        }
      );
      if (mutationResult.status !== 'COMMITTED') {
        throw new Error('Tävlingen hittades inte i Firestore för automatisk anmälan.');
      }
      if (receiptStatus === null) {
        const committedReceipt = await getDoc(receiptRef);
        if (!committedReceipt.exists()) {
          throw new Error('Avläsningen saknar en bekräftad Firestore-kvittens.');
        }
        receiptStatus =
          committedReceipt.data().status === 'UNKNOWN' ? 'UNKNOWN' : 'PROCESSED';
      }
      const log =
        assignmentResult.startsWith('CONFLICT') ? console.warn : console.info;
      log(
        `[READOUT_AUTOCREATE_MIGRATION] ${JSON.stringify({
          competitorId,
          siNumber,
          assignmentResult,
          transactionResult: mutationResult.status,
          receiptResult: receiptStatus,
        })}`
      );
      if (receiptStatus === 'UNKNOWN') {
        return {
          unknownCardReadout: {
            siNumber,
            checkTimeSec: readout.checkTimeSec,
            startTimeSec: readout.startTimeSec,
            finishTimeSec: readout.finishTimeSec,
            punches,
          },
        };
      }
      return { competitor: createdCompetitor };
    } catch (error) {
      console.error(
        `[READOUT_AUTOCREATE_MIGRATION] ${JSON.stringify({
          competitorId,
          siNumber,
          assignmentResult,
          transactionResult: 'ABORTED',
          error: error instanceof Error ? error.message : String(error),
        })}`
      );
      throw error;
    }
  }

  const result = await runTransaction(db, async (transaction) => {
    const [competitionSnap, receiptSnap] = await Promise.all([
      transaction.get(competitionRef),
      transaction.get(receiptRef),
    ]);
    if (!competitionSnap.exists()) {
      throw new Error('Tävlingen finns inte längre i Firestore.');
    }
    const competitionData = competitionSnap.data();
    if (receiptSnap.exists()) {
      const receipt = receiptSnap.data();
      if (!receiptMatchesPayload(receipt)) {
        throw new Error('Readout-ID:t används för en annan avläsning.');
      }
      return {
        status: receipt.status === 'UNKNOWN' ? ('UNKNOWN' as const) : ('PROCESSED' as const),
        competitorId:
          typeof receipt.competitorId === 'string' ? receipt.competitorId : null,
      };
    }
    if (competitionData.status === 'COMPLETED') {
      throw new Error('Tävlingen är avslutad och tar inte emot fler avläsningar.');
    }

    if (!runner || !updatedCompetitor || !validation) {
      transaction.set(receiptRef, {
        ...commonReceipt,
        status: 'UNKNOWN',
        competitorId: '',
      });
      return { status: 'UNKNOWN' as const, competitorId: null };
    }

    const competitorId = sanitizeFirestoreId(runner.id, 'cmp');
    const competitorRef = doc(
      db,
      'competitions',
      competitionId,
      'competitors',
      competitorId
    );
    const competitorSnap = await transaction.get(competitorRef);
    if (!competitorSnap.exists()) {
      throw new Error('Deltagaren hittades inte längre i Firestore.');
    }

    const previousStatus = String(competitorSnap.data().status || 'REGISTERED');
    declareCompetitorMutation({
      source: 'submitReadoutToFirestore',
      operation: 'UPDATE',
      competitionId,
      competitorId,
      siNumber,
      assignmentHandling: {
        mode: 'LEGACY',
        reason: 'Readout result update does not validate SI assignment ownership.',
      },
      identityAffecting: false,
    });
    const wasFinished =
      previousStatus === 'OK' ||
      previousStatus === 'MP' ||
      previousStatus === 'DNF' ||
      previousStatus === 'PRELIMINARY_FIN';
    const finishedCount = Math.max(0, Number(competitionData.finishedCount) || 0);

    transaction.update(competitorRef, {
      status: updatedCompetitor.status,
      checkTimeSec: encodeNullableSec(updatedCompetitor.checkTimeSec),
      startTimeSec: encodeNullableSec(updatedCompetitor.startTimeSec),
      finishTimeSec: encodeNullableSec(updatedCompetitor.finishTimeSec),
      runningTimeSec: encodeNullableSec(updatedCompetitor.runningTimeSec),
      readoutAtIso: nowIso,
      punchCodes: punches.map((punch) => punch.code),
      punchTimes: punches.map((punch) => punch.timeSec),
      updatedAt: serverTimestamp(),
    });
    transaction.update(competitionRef, {
      finishedCount: Math.min(
        Number(competitionData.competitorCount) || 0,
        finishedCount + (wasFinished ? 0 : 1)
      ),
      updatedAt: serverTimestamp(),
    });
    transaction.set(receiptRef, {
      ...commonReceipt,
      status: 'PROCESSED',
      competitorId,
    });
    return { status: 'PROCESSED' as const, competitorId };
  });

  if (result.status === 'UNKNOWN') {
    return {
      unknownCardReadout: {
        siNumber,
        checkTimeSec: readout.checkTimeSec,
        startTimeSec: readout.startTimeSec,
        finishTimeSec: readout.finishTimeSec,
        punches,
      },
    };
  }
  return {
    competitor:
      result.competitorId ===
      (runner ? sanitizeFirestoreId(runner.id, 'cmp') : null)
        ? updatedCompetitor
        : event.competitors.find(
            (candidate) =>
              sanitizeFirestoreId(candidate.id, 'cmp') === result.competitorId
          ) ?? runner,
  };
}

export async function saveDirectCompetitionEntryToFirestore(params: {
  competitionId: string;
  payload: Partial<Competitor> & {
    pendingReadout?: {
      checkTimeSec?: number | null;
      startTimeSec?: number | null;
      finishTimeSec?: number | null;
      punches?: CardPunch[];
    };
  };
  competitors: Competitor[];
  classes: CompClass[];
  courses: Course[];
  emergency: EmergencySettings;
}): Promise<{ competitor: Competitor; runnerDbEntry: RunnerDbEntry | null }> {
  const current = await ensureValidFirestoreUser();
  if (
    !current ||
    !current.emailVerified ||
    !current.providerData.some((provider) => provider.providerId === 'google.com')
  ) {
    throw new Error('Direktanmäla kräver ett inloggat, verifierat Google-administratörskonto.');
  }

  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const isBootstrapAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(
    (current.email || '').toLowerCase()
  );
  const adminSnap = isBootstrapAdmin
    ? null
    : await getDoc(doc(db, 'admins', ownerUid));
  const role = adminSnap?.exists() ? adminSnap.data().role : null;
  const isSuperAdmin = isBootstrapAdmin || role === 'SUPER_ADMIN';
  if (!isSuperAdmin && role !== 'RACE_ADMIN') {
    throw new Error('Ditt Google-konto saknar administratörsbehörighet för direktanmälan.');
  }

  const competitionId = sanitizeFirestoreId(params.competitionId, 'evt');
  const competitionRef = doc(db, 'competitions', competitionId);
  const competitionSnap = await getDoc(competitionRef);
  if (!competitionSnap.exists()) {
    throw new Error('Tävlingen hittades inte i Firestore.');
  }
  const competitionData = competitionSnap.data();
  if (competitionData.status === 'COMPLETED' && !isSuperAdmin) {
    throw new Error('Det går inte att direktanmäla till en avslutad tävling.');
  }

  const siNumber = Number(params.payload.siNumber);
  const fullName = (params.payload.fullName || '').trim();
  if (!Number.isInteger(siNumber) || siNumber < 1 || siNumber > 99999999 || !fullName) {
    throw new Error('Ange ett giltigt SI-bricknummer och löparens namn.');
  }

  const competitorSnapshots = await getDocs(
    collection(db, 'competitions', competitionId, 'competitors')
  );
  const existingCompetitors = competitorSnapshots.docs.map((snapshot) => snapshot.data());

  const classId = sanitizeFirestoreId(
    params.payload.classId || params.classes[0]?.id || 'cls_open',
    'cls'
  );
  const targetClass = params.classes.find((candidate) => candidate.id === classId) ?? null;
  const bib = Math.max(
    400,
    ...params.competitors.map((competitor) => competitor.bib),
    ...existingCompetitors.map((competitor) => Number(competitor.bib) || 0)
  ) + 1;
  const nowIso = new Date().toISOString();
  const pendingReadout = params.payload.pendingReadout;
  const rawPunches = Array.isArray(pendingReadout?.punches)
    ? pendingReadout.punches.slice(0, 192).map((punch) => ({ ...punch }))
    : [];
  const allocatedStartSec = params.payload.allocatedStartSec ?? null;
  const effectiveStart =
    pendingReadout?.startTimeSec ?? allocatedStartSec ?? Number(competitionData.zeroTimeSec ?? 36000);
  const finishTimeSec = pendingReadout?.finishTimeSec ?? null;
  const hasPendingReadout = Boolean(pendingReadout && Array.isArray(pendingReadout.punches));
  const validation =
    hasPendingReadout && finishTimeSec !== null
      ? validateCompetitorReadout(
          targetClass ?? undefined,
          params.courses,
          effectiveStart,
          finishTimeSec,
          rawPunches,
          params.emergency
        )
      : null;
  const cardPunches = hasPendingReadout
    ? applyEmergencyTimeOffsets(rawPunches, params.emergency.controlTimeOffsets)
    : [];
  const status = validation
    ? validation.ok
      ? 'OK'
      : 'MP'
    : params.payload.status || 'REGISTERED';
  const competitorId = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const competitor: Competitor = {
    id: competitorId,
    bib,
    fullName,
    club: (params.payload.club || 'Klubblös').trim() || 'Klubblös',
    classId,
    siNumber,
    cardSeries: params.payload.cardSeries || 'SI-Card 10',
    isRentalCard: Boolean(params.payload.isRentalCard),
    isBorrowedCard: Boolean(params.payload.isBorrowedCard),
    rentalReturned: false,
    feePaid: Boolean(params.payload.feePaid),
    status,
    allocatedStartSec,
    checkTimeSec: hasPendingReadout ? pendingReadout?.checkTimeSec ?? null : null,
    startTimeSec: hasPendingReadout ? pendingReadout?.startTimeSec ?? null : null,
    finishTimeSec,
    manualFinishTimeSec: null,
    runningTimeSec:
      finishTimeSec !== null && finishTimeSec >= effectiveStart
        ? finishTimeSec - effectiveStart
        : null,
    lastSeenControl: cardPunches.length > 0 ? 1 : null,
    lastSeenTimeSec: finishTimeSec ?? pendingReadout?.startTimeSec ?? null,
    readoutAt: hasPendingReadout ? nowIso : null,
    radioSplits: [],
    cardPunches,
    rawReadout: hasPendingReadout
      ? {
          checkTimeSec: pendingReadout?.checkTimeSec ?? null,
          startTimeSec: pendingReadout?.startTimeSec ?? null,
          finishTimeSec,
          punches: rawPunches,
          receivedAt: nowIso,
        }
      : null,
    validation,
  };

  const mutableCompetitor = {
    bib,
    fullName: competitor.fullName.slice(0, 120),
    club: competitor.club.slice(0, 100) || 'Klubblös',
    classId,
    siNumber,
    cardSeries: competitor.cardSeries,
    isRentalCard: competitor.isRentalCard,
    rentalReturned: false,
    feePaid: competitor.feePaid ?? false,
    billingFieldsUpdatedAt: serverTimestamp(),
    status: competitor.status,
    allocatedStartSec: encodeNullableSec(allocatedStartSec),
    checkTimeSec: encodeNullableSec(competitor.checkTimeSec),
    startTimeSec: encodeNullableSec(competitor.startTimeSec),
    finishTimeSec: encodeNullableSec(finishTimeSec),
    manualFinishTimeSec: -1,
    runningTimeSec: encodeNullableSec(competitor.runningTimeSec),
    readoutAtIso: competitor.readoutAt || '',
    punchCodes: rawPunches.map((punch) => clampInt(punch.code, 1, 999, 31)),
    punchTimes: rawPunches.map((punch) => clampInt(punch.timeSec, 0, 86400, 0)),
  };
  let runnerDbEntry: RunnerDbEntry | null = null;
  try {
    const mutationResult = await runAtomicSIAssignmentMutation(
      {
        intent: 'CREATE_COMPETITOR',
        competitor: { competitionId, competitorId },
        assignment: { requestedSiNumber: siNumber },
      },
      async ({
        transaction,
        competitionData: currentCompetition,
        assignmentSnapshots,
        result,
      }) => {
        if (result.duplicateCandidateDetected || result.duplicateCandidateQueryError) {
          throw new Error(
            result.duplicateCandidateDetected
              ? `SI-bricka ${siNumber} används redan av en deltagare i tävlingen.`
              : 'SI-brickans unika ägare kunde inte verifieras. Försök igen.'
          );
        }
        const runnerId = String(siNumber);
        const runnerRef = doc(db, 'runnerDb', runnerId);
        const runnerSnap =
          !competitor.isRentalCard && !competitor.isBorrowedCard
            ? await transaction.get(runnerRef)
            : null;
        const existingRunner = runnerSnap?.exists() ? runnerSnap.data() : null;
        const sameRunner =
          existingRunner?.fullName?.trim().toLowerCase() === fullName.toLowerCase();
        let nextRunnerData: Record<string, unknown> | null = null;
        if (
          !competitor.isRentalCard &&
          !competitor.isBorrowedCard &&
          (!existingRunner || sameRunner)
        ) {
          nextRunnerData = {
            cardSeries: competitor.cardSeries,
            fullName: fullName.slice(0, 120),
            club: competitor.club.slice(0, 100) || 'Klubblös',
            birthYear:
              typeof existingRunner?.birthYear === 'number' ? existingRunner.birthYear : null,
            defaultClassName: targetClass?.name || '',
            eventorPersonId:
              typeof existingRunner?.eventorPersonId === 'string'
                ? existingRunner.eventorPersonId
                : '',
            eventorOrgId:
              typeof existingRunner?.eventorOrgId === 'string'
                ? existingRunner.eventorOrgId
                : '',
            source: existingRunner?.source || 'LEARNED_ENTRY',
            updatedAtIso: nowIso,
          };
        }

        const nextCompetitorCount =
          Number(currentCompetition.competitorCount || 0) + 1;
        console.info(`[atomic-si-mutation-would-enforce] ${JSON.stringify({
          intent: 'CREATE_COMPETITOR',
          competitionId,
          competitorId,
          requestedSiNumber: siNumber,
          action: 'validate_assignment_and_create_competitor_atomically',
          coveredPathEnforcement: true,
        })}`);
        const assignmentSnapshot = assignmentSnapshots.get(siNumber);
        const existingAssignment =
          assignmentSnapshot?.exists()
            ? parseSICardAssignmentDocument(
                assignmentSnapshot.id,
                competitionId,
                assignmentSnapshot.data()
              )
            : null;
        const assignmentAction =
          !Number.isInteger(siNumber) ||
          siNumber < 1 ||
          siNumber > 99999999 ||
          typeof competitor.cardSeries !== 'string' ||
          competitor.cardSeries.length < 1 ||
          competitor.cardSeries.length > 24 ||
          !ownerUid
            ? 'SKIPPED_INVALID_DATA'
            : assignmentSnapshot?.exists() && !existingAssignment
              ? 'SKIPPED_CONFLICT'
              : planCreateSIAssignmentWrite(existingAssignment, competitorId);
        if (assignmentAction !== 'CREATE') {
          throw new Error(
              assignmentAction === 'SKIP_CONFLICT' ||
                assignmentAction === 'SKIPPED_CONFLICT'
                ? `SI-bricka ${siNumber} ägs redan av en annan deltagare.`
                : assignmentAction === 'SKIPPED_INVALID_DATA'
                  ? 'Deltagarens SI-bricka eller kortserie är ogiltig.'
                  : 'SI-brickan är redan kopplad till deltagaren.'
          );
        }
        if (assignmentAction === 'CREATE') {
          transaction.set(getCompetitionSICardAssignmentRef(competitionId, siNumber), {
            competitionId,
            siNumber,
            cardSeries: competitor.cardSeries,
            competitorId,
            competitorDocumentId: competitorId,
            state: 'ACTIVE',
            assignmentVersion: 1,
            source: 'DIRECT_ENTRY',
            ownerUid,
            schemaVersion: SI_CARD_ASSIGNMENT_SCHEMA_VERSION,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        transaction.set(doc(db, 'competitions', competitionId, 'competitors', competitorId), {
          competitorId,
          competitionId,
          ...mutableCompetitor,
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.update(competitionRef, {
          competitorCount: nextCompetitorCount,
          finishedCount: Math.min(
            nextCompetitorCount,
            Number(currentCompetition.finishedCount || 0) +
              (status === 'OK' || status === 'MP' ? 1 : 0)
          ),
          updatedAt: serverTimestamp(),
        });

        if (nextRunnerData) {
          if (existingRunner) {
            transaction.update(runnerRef, {
              ...nextRunnerData,
              updatedAt: serverTimestamp(),
            });
          } else {
            transaction.set(runnerRef, {
              runnerId,
              siNumber,
              ...nextRunnerData,
              source: 'LEARNED_ENTRY',
              ownerUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          runnerDbEntry = {
            id: runnerId,
            siNumber,
            ...(nextRunnerData as Omit<RunnerDbEntry, 'id' | 'siNumber' | 'updatedAt'>),
            source: String(nextRunnerData.source) as RunnerDbEntry['source'],
            updatedAt: nowIso,
          };
        }
        return 'CREATED' as const;
      }
    );
    if (mutationResult.status !== 'COMMITTED') {
      throw new Error('Tävlingen hittades inte i Firestore.');
    }
  } catch (err) {
    handleWriteOrOfflineError(
      err,
      OperationType.CREATE,
      `competitions/${competitionId}/competitors/${competitorId}`
    );
  }

  return { competitor, runnerDbEntry };
}

export async function loadPublicRaceFromFirestore(
  shortCode: string
): Promise<PublicRacePayload | null> {
  const season = await loadFullSeasonFromFirestore();
  if (!season) return null;

  const target = season.events.find(
    (event) => event.competition.shortCode.toLowerCase() === shortCode.toLowerCase()
  );
  if (!target) return null;

  const competitionsList: CompetitionSummary[] = season.events
    .map((event) => ({
      id: event.competition.id,
      competitionId: event.competition.id,
      shortCode: event.competition.shortCode,
      status: event.competition.status,
      name: event.competition.name,
      organizer: event.competition.organizer,
      date: event.competition.date,
      zeroTimeStr: event.competition.zeroTimeStr,
      arenaInfo: event.competition.arenaInfo,
      seriesName: event.competition.seriesName,
      feeTrackingEnabled: Boolean(event.competition.feeTrackingEnabled),
      competitorCount: event.competitors.length,
      finishedCount: event.competitors.filter(
        (competitor) => competitor.status === 'OK' || competitor.status === 'MP'
      ).length,
      classCount: event.classes.length,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const feesEnabled = Boolean(target.competition.feeTrackingEnabled);
  const clubSettings = feesEnabled
    ? season.clubSettings
    : {
        ...season.clubSettings,
        defaultDirectEntryFeeSek: 0,
        rentalCardFeeSek: 0,
        missingRentalFeeSek: 0,
      };

  return {
    competition: target.competition,
    courses: target.courses,
    classes: feesEnabled
      ? target.classes
      : target.classes.map((compClass) => ({ ...compClass, feeSek: 0 })),
    competitors: target.competitors,
    radioControls: (target.stations ?? [])
      .filter(
        (station) =>
          station.active &&
          (station.stationFunction === 'RADIO' || station.stationFunction === 'PREWARNING')
      )
      .map(({ stationCode, name, stationFunction, active }) => ({
        stationCode,
        name,
        stationFunction,
        active,
      })),
    events: [],
    emergency: {
      brokenControls: target.brokenControls,
      controlTimeOffsets: {},
    },
    competitionsList,
    clubSettings,
    seriesStandings: season.seriesStandings ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export async function listClubCloudCompetitionsFromFirestore(): Promise<
  CloudCompetitionRecord[]
> {
  const current = await ensureValidFirestoreUser();
  if (!current) return [];
  const path = 'clubSettings/default';
  try {
    const clubSnap = await getDoc(doc(db, 'clubSettings', 'default'));
    const clubData = clubSnap.exists()
      ? (clubSnap.data() as { competitionIds?: unknown })
      : null;
    const competitionIds = Array.isArray(clubData?.competitionIds)
      ? Array.from(
          new Set(
            clubData.competitionIds.filter(
              (id): id is string => typeof id === 'string' && SAFE_ID_REGEX.test(id)
            )
          )
        )
      : [];

    const toRecord = (
      id: string,
      data: {
        competitionId: string;
        shortCode: string;
        name: string;
        organizer: string;
        date: string;
        status: EventLifecycleStatus;
        seriesName?: string;
        feeTrackingEnabled?: boolean;
        enableFeesAndSwish?: boolean;
        competitorCount: number;
        finishedCount: number;
        ownerUid: string;
        updatedAt?: Timestamp;
      }
    ): CloudCompetitionRecord => ({
      competitionId: data.competitionId || id,
      shortCode: data.shortCode,
      name: data.name,
      organizer: data.organizer,
      date: data.date,
      status: data.status,
      seriesName: data.seriesName || '',
      feeTrackingEnabled: Boolean(data.feeTrackingEnabled ?? data.enableFeesAndSwish),
      competitorCount: data.competitorCount,
      finishedCount: data.finishedCount,
      ownerUid: data.ownerUid,
      updatedAtIso:
        data.updatedAt && typeof data.updatedAt.toDate === 'function'
          ? data.updatedAt.toDate().toISOString()
          : null,
    });

    if (competitionIds.length > 0) {
      const competitionSnapshots = await Promise.all(
        competitionIds.map((competitionId) =>
          getDoc(doc(db, 'competitions', competitionId))
        )
      );
      return competitionSnapshots
        .filter((snapshot) => snapshot.exists())
        .map((snapshot) =>
          toRecord(
            snapshot.id,
            snapshot.data() as {
              competitionId: string;
              shortCode: string;
              name: string;
              organizer: string;
              date: string;
              status: EventLifecycleStatus;
              seriesName?: string;
              feeTrackingEnabled?: boolean;
              enableFeesAndSwish?: boolean;
              competitorCount: number;
              finishedCount: number;
              ownerUid: string;
              updatedAt?: Timestamp;
            }
          )
        )
        .sort((a, b) => b.date.localeCompare(a.date));
    }

    const ownCompetitions = await getDocs(
      query(collection(db, 'competitions'), where('ownerUid', '==', current.uid))
    );
    return ownCompetitions.docs
      .map((snapshot) =>
        toRecord(
          snapshot.id,
          snapshot.data() as {
            competitionId: string;
            shortCode: string;
            name: string;
            organizer: string;
            date: string;
            status: EventLifecycleStatus;
            seriesName?: string;
            feeTrackingEnabled?: boolean;
            enableFeesAndSwish?: boolean;
            competitorCount: number;
            finishedCount: number;
            ownerUid: string;
            updatedAt?: Timestamp;
          }
        )
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    if (isTransientOfflineFirestoreError(err)) {
      if (isTokenServiceError(err)) {
        setTokenServiceDisabled(true);
        void signOut(auth).catch(() => {});
      }
      return [];
    }
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribePublicCompetitionSummaries(
  onUpdate: (competitions: CompetitionSummary[]) => void,
  onError: (error: Error) => void
): () => void {
  const competitionUnsubscribers = new Map<string, () => void>();
  const competitionsById = new Map<string, CompetitionSummary>();

  const publish = () => {
    onUpdate(
      Array.from(competitionsById.values()).sort((a, b) =>
        b.date.localeCompare(a.date)
      )
    );
  };

  const parseCompDoc = (docId: string, data: Partial<CompetitionSummary>): CompetitionSummary => {
    const status =
      data.status === 'LIVE' ||
      data.status === 'UPCOMING' ||
      data.status === 'COMPLETED'
        ? data.status
        : 'UPCOMING';
    return {
      id: docId,
      competitionId: docId,
      shortCode: data.shortCode ?? '',
      status,
      name: data.name ?? '',
      organizer: data.organizer ?? '',
      date: data.date ?? '',
      zeroTimeStr: data.zeroTimeStr ?? '18:00:00',
      arenaInfo: data.arenaInfo ?? '',
      seriesName: data.seriesName,
      allowSelfRegistration: Boolean((data as { allowSelfRegistration?: boolean }).allowSelfRegistration),
      feeTrackingEnabled: Boolean(
        data.feeTrackingEnabled ??
          (data as { enableFeesAndSwish?: boolean }).enableFeesAndSwish
      ),
      competitorCount: data.competitorCount ?? 0,
      finishedCount: data.finishedCount ?? 0,
      classCount: data.classCount ?? 0,
    };
  };

  // 1. Direct collection listener for all competitions
  let unsubscribeCol: (() => void) | null = null;
  try {
    const compCol = collection(db, 'competitions');
    unsubscribeCol = onSnapshot(
      compCol,
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const docId = change.doc.id;
          if (change.type === 'removed') {
            competitionsById.delete(docId);
          } else {
            competitionsById.set(docId, parseCompDoc(docId, change.doc.data() as Partial<CompetitionSummary>));
          }
        }
        publish();
      },
      () => {
        // Fallback gracefully if collection listing is restricted for current auth state
      }
    );
  } catch {
    // Ignore fallback
  }

  // 2. ClubSettings default listener to discover and listen to individually indexed competition IDs
  const unsubscribeClub = onSnapshot(
    doc(db, 'clubSettings', 'default'),
    (clubSnapshot) => {
      const clubData = clubSnapshot.exists()
        ? (clubSnapshot.data() as { competitionIds?: unknown })
        : null;
      const competitionIds = Array.isArray(clubData?.competitionIds)
        ? Array.from(
            new Set(
              clubData.competitionIds.filter(
                (id): id is string => typeof id === 'string' && SAFE_ID_REGEX.test(id)
              )
            )
          )
        : [];
      const desiredIds = new Set(competitionIds);

      for (const [competitionId, unsubscribe] of competitionUnsubscribers) {
        if (!desiredIds.has(competitionId)) {
          unsubscribe();
          competitionUnsubscribers.delete(competitionId);
        }
      }

      for (const competitionId of competitionIds) {
        if (competitionUnsubscribers.has(competitionId)) continue;
        const unsubscribe = onSnapshot(
          doc(db, 'competitions', competitionId),
          (competitionSnapshot) => {
            if (!competitionSnapshot.exists()) {
              publish();
              return;
            }
            competitionsById.set(
              competitionId,
              parseCompDoc(competitionId, competitionSnapshot.data() as Partial<CompetitionSummary>)
            );
            publish();
          },
          (error) => {
            onError(error);
          }
        );
        competitionUnsubscribers.set(competitionId, unsubscribe);
      }

      publish();
    },
    (error) => {
      onError(error);
    }
  );

  return () => {
    if (unsubscribeCol) unsubscribeCol();
    unsubscribeClub();
    for (const unsubscribe of competitionUnsubscribers.values()) {
      unsubscribe();
    }
    competitionUnsubscribers.clear();
    competitionsById.clear();
  };
}

export function subscribeCompetitionMetadataFromFirestore(
  competitionId: string,
  onUpdate: (competition: CompetitionMeta | null) => void,
  onError: (error: Error) => void
): () => void {
  const id = sanitizeFirestoreId(competitionId, 'evt');
  return onSnapshot(
    doc(db, 'competitions', id),
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null);
        return;
      }
      const data = snapshot.data();
      const status =
        data.status === 'LIVE' ||
        data.status === 'UPCOMING' ||
        data.status === 'COMPLETED'
          ? data.status
          : 'UPCOMING';
      onUpdate({
        id,
        shortCode: typeof data.shortCode === 'string' ? data.shortCode : '',
        status,
        statusOverride: Boolean(data.statusOverride),
        name: typeof data.name === 'string' ? data.name : 'Tävling',
        organizer: typeof data.organizer === 'string' ? data.organizer : '',
        date:
          typeof data.date === 'string' && ISO_DATE_REGEX.test(data.date)
            ? data.date
            : getStockholmTodayIso(),
        zeroTimeStr:
          typeof data.zeroTimeStr === 'string' && CLOCK_REGEX.test(data.zeroTimeStr)
            ? data.zeroTimeStr
            : '18:00:00',
        zeroTimeSec: clampInt(data.zeroTimeSec, 0, 86400, 64800),
        arenaInfo: typeof data.arenaInfo === 'string' ? data.arenaInfo : '',
        seriesName: typeof data.seriesName === 'string' ? data.seriesName : '',
        allowSelfRegistration: Boolean(data.allowSelfRegistration),
        feeTrackingEnabled: Boolean(
          data.feeTrackingEnabled ?? data.enableFeesAndSwish
        ),
      });
    },
    onError
  );
}

export const DEFAULT_CLUB_SETTINGS: ClubSettings = {
  clubName: 'OK Österåker',
  eventorOrgId: '',
  defaultDirectEntryFeeSek: 0,
  rentalCardFeeSek: 0,
  missingRentalFeeSek: 0,
  portalTitle: '',
  logoDataUrl: '',
  customBgColor: '',
  customTextColor: '',
  customAccentColor: '',
  seriesScoringSettings: {},
};

/**
 * Loads club settings from Firestore via a single document read:
 * `getDoc(doc(db, 'clubSettings', 'default'))`
 * NEVER uses `getDocs()` on the whole collection because collection listing is forbidden in firestore.rules (`allow list: if false;`).
 * - If the document does not exist yet, returns default settings cleanly without throwing an error.
 * The document allows public single-document reads, so branding can load before login.
 * - On permission-denied, throws a clear error rather than silently hiding a rules issue.
 */
export async function loadClubSettingsFromFirestore(): Promise<ClubSettings> {
  try {
    const clubSnap = await getDoc(doc(db, 'clubSettings', 'default'));
    if (!clubSnap.exists()) {
      return { ...DEFAULT_CLUB_SETTINGS };
    }
    const data = clubSnap.data() as Partial<ClubSettings>;
    return {
      clubName: (data.clubName || DEFAULT_CLUB_SETTINGS.clubName).trim().slice(0, 100) || DEFAULT_CLUB_SETTINGS.clubName,
      eventorOrgId: (data.eventorOrgId || '').trim().slice(0, 32),
      defaultDirectEntryFeeSek: clampInt(data.defaultDirectEntryFeeSek, 0, 10000, DEFAULT_CLUB_SETTINGS.defaultDirectEntryFeeSek),
      rentalCardFeeSek: clampInt(data.rentalCardFeeSek, 0, 5000, DEFAULT_CLUB_SETTINGS.rentalCardFeeSek),
      missingRentalFeeSek: clampInt(data.missingRentalFeeSek, 0, 20000, DEFAULT_CLUB_SETTINGS.missingRentalFeeSek),
      portalTitle: (data.portalTitle || '').trim().slice(0, 80),
      logoDataUrl: sanitizeCloudLogoDataUrl(data.logoDataUrl),
      customBgColor: sanitizeCloudHexColor(data.customBgColor),
      customTextColor: sanitizeCloudHexColor(data.customTextColor),
      customAccentColor: sanitizeCloudHexColor(data.customAccentColor),
      seriesScoringSettings: normalizeSeriesScoringSettings(data.seriesScoringSettings),
    };
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
    const code = String((err as { code?: string })?.code || '').toLowerCase();
    if (
      code.includes('permission-denied') ||
      msg.includes('permission-denied') ||
      msg.includes('missing or insufficient permissions')
    ) {
      throw new Error(
        'Behörighet saknas när klubbinställningarna hämtas från Firestore.'
      );
    }
    if (isTransientOfflineFirestoreError(err)) {
      return { ...DEFAULT_CLUB_SETTINGS };
    }
    throw err;
  }
}

/**
 * Subscribes to /clubSettings/default so club settings and branding update across views and tabs.
 */
export function subscribeClubSettingsFromFirestore(
  onUpdate: (settings: ClubSettings) => void
): () => void {
  const clubRef = doc(db, 'clubSettings', 'default');
  const unsubscribe = onSnapshot(
    clubRef,
    (snap) => {
      if (!snap.exists()) {
        onUpdate({ ...DEFAULT_CLUB_SETTINGS });
        return;
      }
      const data = snap.data() as Partial<ClubSettings>;
      onUpdate({
        clubName: (data.clubName || DEFAULT_CLUB_SETTINGS.clubName).trim().slice(0, 100) || DEFAULT_CLUB_SETTINGS.clubName,
        eventorOrgId: (data.eventorOrgId || '').trim().slice(0, 32),
        defaultDirectEntryFeeSek: clampInt(data.defaultDirectEntryFeeSek, 0, 10000, DEFAULT_CLUB_SETTINGS.defaultDirectEntryFeeSek),
        rentalCardFeeSek: clampInt(data.rentalCardFeeSek, 0, 5000, DEFAULT_CLUB_SETTINGS.rentalCardFeeSek),
        missingRentalFeeSek: clampInt(data.missingRentalFeeSek, 0, 20000, DEFAULT_CLUB_SETTINGS.missingRentalFeeSek),
        portalTitle: (data.portalTitle || '').trim().slice(0, 80),
        logoDataUrl: sanitizeCloudLogoDataUrl(data.logoDataUrl),
        customBgColor: sanitizeCloudHexColor(data.customBgColor),
        customTextColor: sanitizeCloudHexColor(data.customTextColor),
        customAccentColor: sanitizeCloudHexColor(data.customAccentColor),
        seriesScoringSettings: normalizeSeriesScoringSettings(data.seriesScoringSettings),
      });
    },
    (err) => {
      console.warn('Realtime-lyssnare på clubSettings misslyckades:', err);
    }
  );
  return unsubscribe;
}

export function subscribeActiveEventIdFromFirestore(
  onUpdate: (activeEventId: string | null) => void
): () => void {
  const unsubscribe = onSnapshot(
    doc(db, 'clubSettings', 'default'),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const activeEventId = snap.data().activeEventId;
      onUpdate(typeof activeEventId === 'string' ? activeEventId : null);
    },
    (err) => {
      console.warn('Realtime-lyssnare på aktiv tävling misslyckades:', err);
    }
  );
  return unsubscribe;
}

export interface CreateCompetitionInFirestoreParams {
  competitionId: string;
  shortCode?: string;
  name: string;
  organizer?: string;
  date?: string;
  status?: EventLifecycleStatus;
  zeroTimeStr?: string;
  zeroTimeSec?: number;
  arenaInfo?: string;
  seriesName?: string;
  allowSelfRegistration?: boolean;
  feeTrackingEnabled?: boolean;
  courses?: Course[];
  classes?: CompClass[];
}

/**
 * Atomically writes a new competition to Firestore under Zero-Trust schema rules:
 * - Guarantees all required fields are present with NO undefined values.
 * - Empty string fallback for optional strings and safe defaults for booleans/numbers.
 * - Writes child courses and classes to subcollections.
 * - Updates /clubSettings/default activeEventId and competitionIds.
 */
export async function createCompetitionInFirestore(
  params: CreateCompetitionInFirestoreParams
): Promise<string> {
  const current = await ensureValidFirestoreUser();
  if (!current || !current.emailVerified) {
    throw new Error('Du måste vara inloggad med ett verifierat Google-konto för att skapa och spara en tävling i Firestore.');
  }

  // Ensure /admins/{uid} exists so isAdmin() passes in Firestore security rules
  await ensureAdminRoleInFirestore(current).catch(() => {});

  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const competitionId = sanitizeFirestoreId(params.competitionId, 'evt');
  const rawShort = sanitizeFirestoreId(params.shortCode || 'oko26', 'sc').slice(0, 32);
  const shortCode = rawShort.length >= 2 ? rawShort : 'ev26';

  const name = (params.name || '').trim().slice(0, 140) || 'Tävling';
  const organizer = (params.organizer || 'OK Österåker').trim().slice(0, 100) || 'OK Österåker';
  const date = params.date && ISO_DATE_REGEX.test(params.date.trim())
    ? params.date.trim()
    : getStockholmTodayIso();

  const rawStatus = (params.status || 'UPCOMING').toUpperCase();
  const status: EventLifecycleStatus =
    rawStatus === 'LIVE' || rawStatus === 'UPCOMING' || rawStatus === 'COMPLETED'
      ? (rawStatus as EventLifecycleStatus)
      : 'UPCOMING';

  const zeroTimeStr = params.zeroTimeStr && CLOCK_REGEX.test(params.zeroTimeStr.trim())
    ? params.zeroTimeStr.trim()
    : '18:00:00';
  const zeroTimeSec = Number.isFinite(params.zeroTimeSec)
    ? clampInt(params.zeroTimeSec, 0, 86400, 18 * 3600)
    : 18 * 3600;

  const arenaInfo = (params.arenaInfo ?? '').trim().slice(0, 500);
  const seriesName = (params.seriesName ?? '').trim().slice(0, 80);
  const allowSelfRegistration = Boolean(params.allowSelfRegistration);
  const feeTrackingEnabled = Boolean(params.feeTrackingEnabled);

  // Required keys per firestore.rules isValidCloudCompetition.
  const compDocData = {
    competitionId,
    shortCode,
    name,
    organizer,
    date,
    status,
    zeroTimeStr,
    zeroTimeSec,
    arenaInfo,
    seriesName,
    allowSelfRegistration,
    feeTrackingEnabled,
    competitorCount: 0,
    finishedCount: 0,
    brokenControls: [] as number[],
    controlTimeOffsets: {},
    ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const compRef = doc(db, 'competitions', competitionId);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(compRef);
    if (existing.exists()) {
      throw new Error('Tävlings-ID:t finns redan i Firestore.');
    }
    transaction.set(compRef, compDocData);
  });

  // Child subcollections: courses and classes
  const childBatchOps: QueuedBatchOp[] = [];
  if (Array.isArray(params.courses) && params.courses.length > 0) {
    for (const crs of params.courses) {
      const courseId = sanitizeFirestoreId(crs.id, 'crs');
      const crsRef = doc(db, 'competitions', competitionId, 'courses', courseId);
      childBatchOps.push({
        kind: 'set',
        ref: crsRef,
        path: `competitions/${competitionId}/courses/${courseId}`,
        data: {
          courseId,
          competitionId,
          name: (crs.name || 'Bana').trim().slice(0, 120) || 'Bana',
          lengthMeters: clampInt(crs.lengthMeters, 0, 200000, 3000),
          climbMeters: clampInt(crs.climbMeters, 0, 20000, 0),
          controls: (crs.controls || []).slice(0, 128).map((c) => clampInt(c, 1, 999, 31)),
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  }

  if (Array.isArray(params.classes) && params.classes.length > 0) {
    for (const cls of params.classes) {
      const classId = sanitizeFirestoreId(cls.id, 'cls');
      const clsRef = doc(db, 'competitions', competitionId, 'classes', classId);
      const classFormat: ClassCompetitionFormat =
        cls.classFormat === 'FORKED' || cls.classFormat === 'ROGAINING'
          ? cls.classFormat
          : 'STANDARD';
      childBatchOps.push({
        kind: 'set',
        ref: clsRef,
        path: `competitions/${competitionId}/classes/${classId}`,
        data: {
          classId,
          competitionId,
          name: (cls.name || 'Klass').trim().slice(0, 80) || 'Klass',
          courseId: cls.courseId ? sanitizeFirestoreId(cls.courseId, 'crs') : '',
          classFormat,
          forkCourseIds: (cls.forkCourseIds || [])
            .slice(0, 32)
            .map((id) => sanitizeFirestoreId(id, 'crs')),
          rogainingMaxTimeSec:
            cls.rogainingMaxTimeSec !== null && cls.rogainingMaxTimeSec !== undefined
              ? clampInt(cls.rogainingMaxTimeSec, 0, 86400, -1)
              : -1,
          rogainingPenaltyPerMin:
            cls.rogainingPenaltyPerMin !== null && cls.rogainingPenaltyPerMin !== undefined
              ? clampInt(cls.rogainingPenaltyPerMin, 0, 1000, -1)
              : -1,
          allowDirectEntry: Boolean(cls.allowDirectEntry),
          freeStart: Boolean(cls.freeStart),
          autoMatchCourse: Boolean(cls.autoMatchCourse),
          feeSek: clampInt(cls.feeSek, 0, 10000, 100),
          ownerUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    }
  }

  if (childBatchOps.length > 0) {
    await commitQueuedBatchOps(childBatchOps);
  }

  // Update /clubSettings/default
  try {
    const clubRef = doc(db, 'clubSettings', 'default');
    const clubSnap = await getDoc(clubRef);
    if (clubSnap.exists()) {
      const existingClub = clubSnap.data() as { competitionIds?: string[] };
      const currentIds = Array.isArray(existingClub.competitionIds) ? existingClub.competitionIds : [];
      const updatedIds = Array.from(new Set([competitionId, ...currentIds])).slice(0, 100);
      await updateDoc(clubRef, {
        activeEventId: competitionId,
        competitionIds: updatedIds,
        demoCleared: false,
        swishNumber: deleteField(),
        swishRecipientName: deleteField(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(clubRef, {
        settingId: 'default',
        clubName: organizer,
        eventorOrgId: '',
        defaultDirectEntryFeeSek: 0,
        rentalCardFeeSek: 0,
        missingRentalFeeSek: 0,
        activeEventId: competitionId,
        demoCleared: true,
        competitionIds: [competitionId],
        ownerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (clubErr) {
    console.error('Kunde inte uppdatera aktiv tävling i Firestore:', clubErr);
    throw clubErr;
  }

  return competitionId;
}

/**
 * Saves club profile, branding, and fee settings directly to Firestore (/clubSettings/default)
 * ensuring all keys conform strictly to isValidClubSettings rules.
 */
export async function saveClubSettingsToFirestore(
  settings: Partial<ClubSettings>,
  isSuperAdmin = false
): Promise<void> {
  const current = await ensureValidFirestoreUser();
  if (!current) {
    throw new Error('Du måste vara inloggad med Google för att spara klubbinställningar.');
  }

  const ownerUid = sanitizeFirestoreId(current.uid, 'usr');
  const clubRef = doc(db, 'clubSettings', 'default');
  const clubSnap = await getDoc(clubRef);

  const existingData = clubSnap.exists() ? (clubSnap.data() as Record<string, unknown>) : null;

  const clubName =
    settings.clubName !== undefined
      ? (settings.clubName.trim().slice(0, 100) || DEFAULT_CLUB_SETTINGS.clubName)
      : (typeof existingData?.clubName === 'string' ? existingData.clubName : DEFAULT_CLUB_SETTINGS.clubName);
  const eventorOrgId =
    settings.eventorOrgId !== undefined
      ? settings.eventorOrgId.trim().slice(0, 32)
      : (typeof existingData?.eventorOrgId === 'string' ? existingData.eventorOrgId : '');
  const defaultDirectEntryFeeSek =
    settings.defaultDirectEntryFeeSek !== undefined
      ? clampInt(settings.defaultDirectEntryFeeSek, 0, 10000, 100)
      : (typeof existingData?.defaultDirectEntryFeeSek === 'number' ? existingData.defaultDirectEntryFeeSek : 100);
  const rentalCardFeeSek =
    settings.rentalCardFeeSek !== undefined
      ? clampInt(settings.rentalCardFeeSek, 0, 5000, 30)
      : (typeof existingData?.rentalCardFeeSek === 'number' ? existingData.rentalCardFeeSek : 30);
  const missingRentalFeeSek =
    settings.missingRentalFeeSek !== undefined
      ? clampInt(settings.missingRentalFeeSek, 0, 20000, 650)
      : (typeof existingData?.missingRentalFeeSek === 'number' ? existingData.missingRentalFeeSek : 650);
  const portalTitle =
    settings.portalTitle !== undefined
      ? settings.portalTitle.trim().slice(0, 80)
      : (typeof existingData?.portalTitle === 'string' ? existingData.portalTitle : '');
  const logoDataUrl =
    settings.logoDataUrl !== undefined
      ? sanitizeCloudLogoDataUrl(settings.logoDataUrl)
      : (typeof existingData?.logoDataUrl === 'string' ? existingData.logoDataUrl : '');
  const customBgColor =
    settings.customBgColor !== undefined
      ? sanitizeCloudHexColor(settings.customBgColor)
      : (typeof existingData?.customBgColor === 'string' ? existingData.customBgColor : '');
  const customTextColor =
    settings.customTextColor !== undefined
      ? sanitizeCloudHexColor(settings.customTextColor)
      : (typeof existingData?.customTextColor === 'string' ? existingData.customTextColor : '');
  const customAccentColor =
    settings.customAccentColor !== undefined
      ? sanitizeCloudHexColor(settings.customAccentColor)
      : (typeof existingData?.customAccentColor === 'string' ? existingData.customAccentColor : '');
  const brandingPatch = {
    ...(settings.portalTitle === undefined
      ? {}
      : { portalTitle: settings.portalTitle.trim().slice(0, 80) }),
    ...(settings.logoDataUrl === undefined
      ? {}
      : { logoDataUrl: sanitizeCloudLogoDataUrl(settings.logoDataUrl) }),
    ...(settings.customBgColor === undefined ? {} : { customBgColor }),
    ...(settings.customTextColor === undefined ? {} : { customTextColor }),
    ...(settings.customAccentColor === undefined ? {} : { customAccentColor }),
  };
  const seriesScoringSettings =
    settings.seriesScoringSettings === undefined
      ? undefined
      : normalizeSeriesScoringSettings(settings.seriesScoringSettings);

  if (clubSnap.exists()) {
    await updateDoc(clubRef, {
      clubName,
      eventorOrgId,
      defaultDirectEntryFeeSek,
      rentalCardFeeSek,
      missingRentalFeeSek,
      swishNumber: deleteField(),
      swishRecipientName: deleteField(),
      ...brandingPatch,
      ...(seriesScoringSettings === undefined ? {} : { seriesScoringSettings }),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(clubRef, {
      settingId: 'default',
      clubName,
      eventorOrgId,
      defaultDirectEntryFeeSek,
      rentalCardFeeSek,
      missingRentalFeeSek,
      portalTitle,
      logoDataUrl,
      customBgColor,
      customTextColor,
      customAccentColor,
      seriesScoringSettings: seriesScoringSettings ?? {},
      activeEventId: '',
      demoCleared: false,
      competitionIds: [] as string[],
      ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Clears demo competitions directly in Firestore when the season is reset.
 */
export async function seedDemoSeasonToFirestore(_ownerUidParam?: string): Promise<CloudSeasonSnapshot> {
  await ensureValidFirestoreUser();

  const clubRef = doc(db, 'clubSettings', 'default');
  const clubSnap = await getDoc(clubRef);
  if (clubSnap.exists()) {
    await updateDoc(clubRef, {
      activeEventId: '',
      competitionIds: [],
      demoCleared: true,
      swishNumber: deleteField(),
      swishRecipientName: deleteField(),
      updatedAt: serverTimestamp(),
    });
  }

  return {
    activeEventId: '',
    demoCleared: true,
    clubSettings: DEFAULT_CLUB_SETTINGS,
    events: [],
  };
}
