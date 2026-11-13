import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type Credential,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  calculateSeriesStandings,
  normalizeSeriesScoringSettings,
} from './src/services/seriesStandings';
import {
  retireCompetitorWithAssignment,
  SIAssignmentRetirementError,
} from './src/server/siAssignmentRetirement';
import {
  createCompetitorWithAssignment,
  CompetitorCreationError,
} from './src/server/competitorCreation';
import {
  createReadoutCompetitorFromRunnerDb,
  ReadoutAutoCreateError,
} from './src/server/readoutAutocreate';
import {
  deleteCompetitionWithAssignments,
  CompetitionDeletionError,
} from './src/server/competitionDeletion';
import {
  declareCompetitorMutation,
  runCompetitorMutation,
  runCompetitorMutations,
  type CompetitorMutationDeclaration,
} from './src/utils/siAssignmentDiagnostics';
import { hasSameCompetitorIdentitySnapshot } from './src/utils/competitorIdentitySnapshot';
import { protectCloudHydratedCompetitors } from './src/utils/cloudHydrateCompetitorFence';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type SICardSeries =
  | 'SI-Card 5'
  | 'SI-Card 6'
  | 'SI-Card 8'
  | 'SI-Card 9'
  | 'SI-Card 10'
  | 'SI-Card 11'
  | 'SIAC Air+';

type StationFunction =
  | 'CLEAR'
  | 'CHECK'
  | 'START'
  | 'RADIO'
  | 'PREWARNING'
  | 'FINISH'
  | 'READOUT';

type HardwareModel =
  | 'BSM8-USB'
  | 'BSM7-USB'
  | 'SRR-USB (Air+)'
  | 'BSF9 Master'
  | 'BSF8 Master';

type RunnerStatus =
  | 'REGISTERED'
  | 'CHECKED'
  | 'IN_FOREST'
  | 'PRELIMINARY_FIN'
  | 'OK'
  | 'MP'
  | 'DNF'
  | 'DNS';

type EventLifecycleStatus = 'LIVE' | 'UPCOMING' | 'COMPLETED';

interface ClubSettings {
  clubName: string;
  eventorOrgId: string;
  defaultDirectEntryFeeSek: number;
  rentalCardFeeSek: number;
  missingRentalFeeSek: number;
  portalTitle?: string;
  logoDataUrl?: string;
  customBgColor?: string;
  customTextColor?: string;
  customAccentColor?: string;
  seriesScoringSettings?: Record<
    string,
    {
      model: 'PLACEMENT' | 'PARTICIPATION';
      placementPoints: number[];
      participationPoints: number;
    }
  >;
}

interface CompetitionMeta {
  id: string;
  shortCode: string;
  status: EventLifecycleStatus;
  statusOverride?: boolean;
  name: string;
  organizer: string;
  date: string;
  zeroTimeStr: string;
  zeroTimeSec: number;
  arenaInfo: string;
  seriesName?: string;
  allowSelfRegistration?: boolean;
  feeTrackingEnabled?: boolean;
}

interface CompetitionSummary {
  id: string;
  shortCode: string;
  status: EventLifecycleStatus;
  name: string;
  organizer: string;
  date: string;
  zeroTimeStr: string;
  arenaInfo: string;
  seriesName?: string;
  competitorCount: number;
  finishedCount: number;
  classCount: number;
}

interface Course {
  id: string;
  name: string;
  lengthMeters: number;
  climbMeters: number;
  controls: number[];
}

type ClassCompetitionFormat = 'STANDARD' | 'FORKED' | 'ROGAINING';

interface CompClass {
  id: string;
  name: string;
  courseId: string | null;
  classFormat?: ClassCompetitionFormat;
  forkCourseIds?: string[];
  rogainingMaxTimeSec?: number | null;
  rogainingPenaltyPerMin?: number | null;
  allowDirectEntry: boolean;
  freeStart: boolean;
  autoMatchCourse: boolean;
  feeSek: number;
}

interface SIStation {
  id: string;
  stationCode: number;
  name: string;
  hardwareModel: HardwareModel;
  stationFunction: StationFunction;
  baudRate: 38400 | 4800;
  extendedProtocol: boolean;
  batteryMv: number;
  firmware: string;
  lastSeenAt: string | null;
  active: boolean;
}

interface CardPunch {
  code: number;
  timeSec: number;
}

interface RadioSplit {
  controlCode: number;
  stationName: string;
  punchTimeSec: number;
  runningTimeSec: number | null;
  isPrewarning: boolean;
}

interface SplitLegResult {
  order: number;
  controlCode: number;
  label: string;
  status: 'OK' | 'MISSING' | 'BROKEN_CTRL';
  punchTimeSec: number | null;
  cumulativeSec: number | null;
  legSec: number | null;
  pointsAwarded?: number | null;
  legRank?: number | null;
  legBehindSec?: number | null;
  bestLegSec?: number | null;
  timeLossSec?: number | null;
  cumulativeRank?: number | null;
  cumulativeBehindSec?: number | null;
}

interface ReadoutValidation {
  ok: boolean;
  matchedCourseId: string | null;
  matchedCourseName: string | null;
  missingControls: number[];
  extraControls: CardPunch[];
  splits: SplitLegResult[];
  idealTimeSec?: number | null;
  totalTimeLossSec?: number | null;
  mistakeFreeTimeSec?: number | null;
  rogainingPoints?: number | null;
  rogainingGrossPoints?: number | null;
  rogainingOvertimePenalty?: number | null;
  rogainingOvertimeSec?: number | null;
}

interface RawCardReadoutArchive {
  checkTimeSec: number | null;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  punches: CardPunch[];
  rawHex?: string;
  receivedAt: string;
  clientReadoutId?: string;
}

interface Competitor {
  id: string;
  bib: number;
  fullName: string;
  club: string;
  classId: string;
  siNumber: number;
  cardSeries: SICardSeries;
  isRentalCard: boolean;
  isBorrowedCard?: boolean;
  rentalReturned: boolean;
  feePaid?: boolean;
  status: RunnerStatus;
  allocatedStartSec: number | null;
  checkTimeSec: number | null;
  startTimeSec: number | null;
  finishTimeSec: number | null;
  manualFinishTimeSec?: number | null;
  runningTimeSec: number | null;
  lastSeenControl: number | null;
  lastSeenTimeSec: number | null;
  readoutAt: string | null;
  radioSplits: RadioSplit[];
  cardPunches: CardPunch[];
  rawReadout?: RawCardReadoutArchive | null;
  validation: ReadoutValidation | null;
}

interface RentalCardOverviewItem {
  eventId: string;
  eventName: string;
  eventDate: string;
  shortCode: string;
  competitorId: string;
  bib: number;
  fullName: string;
  club: string;
  className: string;
  siNumber: number;
  cardSeries: SICardSeries;
  rentalReturned: boolean;
  feePaid: boolean;
  feeTrackingEnabled: boolean;
  status: RunnerStatus;
}

interface SeriesStandingRow {
  runnerKey: string;
  fullName: string;
  club: string;
  totalPoints: number;
  participations: number;
  wins: number;
  stagePoints: Record<string, number>;
}

interface SeriesStandingClassGroup {
  className: string;
  rows: SeriesStandingRow[];
}

interface SeriesStandingsBundle {
  seriesName: string;
  stages: {
    eventId: string;
    shortCode: string;
    name: string;
    date: string;
    status: EventLifecycleStatus;
  }[];
  classes: SeriesStandingClassGroup[];
}

interface LiveEventItem {
  id: string;
  timestamp: string;
  clock24h: string;
  eventType:
    | 'CHECK'
    | 'START'
    | 'RADIO'
    | 'PREWARNING'
    | 'FINISH'
    | 'READOUT_OK'
    | 'READOUT_MP'
    | 'UNKNOWN_CARD'
    | 'DIRECT_ENTRY'
    | 'EMERGENCY';
  siNumber: number;
  competitorId: string | null;
  competitorName: string | null;
  club: string | null;
  className: string | null;
  stationCode: number;
  stationName: string;
  runningTimeSec: number | null;
  message: string;
  rawHex?: string;
}

type RunnerDbSource =
  | 'EVENTOR_API'
  | 'EVENTOR_XML'
  | 'MEOS_CSV'
  | 'LEARNED_ENTRY';

interface RunnerDbEntry {
  id: string;
  siNumber: number;
  cardSeries: SICardSeries;
  fullName: string;
  club: string;
  birthYear: number | null;
  defaultClassName: string | null;
  eventorPersonId: string | null;
  eventorOrgId: string | null;
  source: RunnerDbSource;
  updatedAt: string;
}

interface EventorIntegrationStatus {
  apiKeyConfigured: boolean;
  baseUrl: string;
  connectedOrgId: string | null;
  connectedOrgName: string | null;
  connectedEventId: string | null;
  lastSyncedAt: string | null;
  autoCreateFromRunnerDbOnReadout: boolean;
}

interface EmergencySettings {
  brokenControls: number[];
  controlTimeOffsets: Record<string, number>;
}

interface RocIntegrationStatus {
  enabled: boolean;
  unitId: string;
  baseUrl: string;
  pollIntervalSec: number;
  lastPunchId: number;
  lastPolledAt: string | null;
  totalReceived: number;
  lastError: string | null;
}

type OfficialRole = 'START' | 'READOUT' | 'FOREST' | 'SPEAKER';
type OfficialRoleMode = 'ALL' | OfficialRole;
type AuthSessionKind = 'ADMIN' | 'OFFICIAL';
type ClubAdminTier = 'SUPER_ADMIN' | 'RACE_ADMIN';

interface ClubAdminAccount {
  email: string;
  displayName: string;
  role: ClubAdminTier;
  isBootstrapOwner?: boolean;
  addedAt: string;
}

interface SeasonAuthConfig {
  admins: ClubAdminAccount[];
}

interface AuthSessionUser {
  sessionKind: AuthSessionKind;
  uid: string;
  displayName: string;
  email: string | null;
  adminTier: ClubAdminTier | null;
  officialRole: OfficialRoleMode;
  lockedEventId: string | null;
  lockedEventName: string | null;
  authMethod: 'GOOGLE';
  issuedAt: string;
  expiresAt: string;
}

interface SingleEventRecord {
  competition: CompetitionMeta;
  courses: Course[];
  classes: CompClass[];
  stations: SIStation[];
  competitors: Competitor[];
  emergency: EmergencySettings;
  roc: RocIntegrationStatus;
  events: LiveEventItem[];
  processedClientIds: string[];
}

interface CloudEventExportItem {
  competition: {
    id: string;
    shortCode: string;
    status: EventLifecycleStatus;
    statusOverride?: boolean;
    name: string;
    organizer: string;
    date: string;
    zeroTimeStr: string;
    zeroTimeSec: number;
    arenaInfo: string;
    seriesName: string;
    allowSelfRegistration?: boolean;
    feeTrackingEnabled: boolean;
  };
  courses: Course[];
  classes: CompClass[];
  competitors: Competitor[];
  stations?: SIStation[];
  brokenControls: number[];
  emergency?: EmergencySettings;
}

interface CloudSeasonSnapshot {
  activeEventId: string;
  demoCleared: boolean;
  clubSettings: ClubSettings;
  events: CloudEventExportItem[];
}

interface SeasonDatabase {
  version: 3;
  activeEventId: string;
  demoCleared?: boolean;
  clubSettings?: ClubSettings;
  eventsMap: Record<string, SingleEventRecord>;
  runnerDb: RunnerDbEntry[];
  eventor: EventorIntegrationStatus;
  authConfig?: SeasonAuthConfig;
}

const BOOTSTRAP_ADMIN_EMAIL = 'instagram.okosteraker@gmail.com';
const BOOTSTRAP_ADMIN_EMAILS = [
  'instagram.okosteraker@gmail.com',
  'marcus.o.ahlen@gmail.com',
];

function isBootstrapAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return BOOTSTRAP_ADMIN_EMAILS.includes(clean);
}

function loadFirebaseConfigIds(): { projectId: string; firestoreDatabaseId: string } {
  try {
    const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };
      return {
        projectId: parsed.projectId || 'ai-studio-applet-webapp-72c01',
        firestoreDatabaseId:
          parsed.firestoreDatabaseId ||
          'ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df',
      };
    }
  } catch {
    // ignore
  }
  return {
    projectId: 'ai-studio-applet-webapp-72c01',
    firestoreDatabaseId:
      'ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df',
  };
}

const { projectId: FIREBASE_PROJECT_ID, firestoreDatabaseId: FIRESTORE_DATABASE_ID } =
  loadFirebaseConfigIds();

const FIREBASE_ADMIN_APP_NAME = 'passersi-retirement-writer';
const hasAdminCredentials = Boolean(
  process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIRESTORE_EMULATOR_HOST
);

if (!getApps().length) {
  try {
    let credential: Credential | undefined;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT
      ) as ServiceAccount & { private_key?: string };
      if (typeof serviceAccount.private_key === 'string') {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      credential = cert(serviceAccount);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = applicationDefault();
    } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
      console.warn('Firebase Admin SDK not initialized: missing credentials');
    }

    if (hasAdminCredentials) {
      initializeApp(
        {
          projectId: FIREBASE_PROJECT_ID,
          ...(credential ? { credential } : {}),
        },
        FIREBASE_ADMIN_APP_NAME
      );
    }
  } catch (err) {
    console.error('Firebase Admin initialization error:', err);
  }
}

const isAdminInitialized = getApps().length > 0;

function getTrustedFirestore() {
  const app = getApps().find(
    (candidate) => candidate.name === FIREBASE_ADMIN_APP_NAME
  );
  if (!app) {
    throw new Error(
      'Firebase Admin SDK saknar miljövariabler i Vercel (FIREBASE_SERVICE_ACCOUNT).'
    );
  }
  return getFirestore(app, FIRESTORE_DATABASE_ID);
}

async function verifyFirestoreAdminRoleRest(
  uid: string,
  idToken: string
): Promise<ClubAdminTier | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      FIREBASE_PROJECT_ID
    )}/databases/${encodeURIComponent(
      FIRESTORE_DATABASE_ID
    )}/documents/admins/${encodeURIComponent(uid)}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!resp.ok) return null;
    const docJson = (await resp.json()) as {
      fields?: {
        role?: { stringValue?: string };
      };
    };
    const roleVal = docJson.fields?.role?.stringValue;
    if (roleVal === 'SUPER_ADMIN' || roleVal === 'RACE_ADMIN') {
      return roleVal;
    }
    return null;
  } catch {
    return null;
  }
}

function buildDefaultSeasonAuthConfig(nowIso: string): SeasonAuthConfig {
  return {
    admins: [
      {
        email: BOOTSTRAP_ADMIN_EMAIL,
        displayName: 'OK Österåker (Huvudadmin)',
        role: 'SUPER_ADMIN',
        isBootstrapOwner: true,
        addedAt: nowIso,
      },
    ],
  };
}

function ensureSeasonAuthConfig(seasonDb: SeasonDatabase): SeasonAuthConfig {
  const nowIso = new Date().toISOString();
  const admins = Array.isArray(seasonDb.authConfig?.admins)
    ? seasonDb.authConfig.admins.filter(
        (admin) =>
          admin &&
          typeof admin.email === 'string' &&
          (admin.role === 'SUPER_ADMIN' || admin.role === 'RACE_ADMIN')
      )
    : [];
  if (!admins.some((admin) => admin.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL)) {
    admins.unshift({
      email: BOOTSTRAP_ADMIN_EMAIL,
      displayName: 'OK Österåker (Huvudadmin)',
      role: 'SUPER_ADMIN',
      isBootstrapOwner: true,
      addedAt: nowIso,
    });
  }
  seasonDb.authConfig = { admins };
  return seasonDb.authConfig;
}

let cachedGoogleCerts: { certs: Record<string, string>; fetchedAtMs: number } | null = null;

async function getGoogleSecureTokenCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedGoogleCerts &&
    now - cachedGoogleCerts.fetchedAtMs < 50 * 60 * 1000
  ) {
    return cachedGoogleCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Kunde inte hämta Googles certifikat för tokenverifiering.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  cachedGoogleCerts = { certs, fetchedAtMs: now };
  return certs;
}

async function verifyFirebaseIdToken(idToken: string): Promise<{
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  expiresAt: number;
}> {
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
    payload.aud !== FIREBASE_PROJECT_ID ||
    payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`
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
  const validSig = verifier.verify(certPem, Buffer.from(sigB64, 'base64url'));
  if (!validSig) {
    throw new Error('Kryptografisk verifiering av Google-token misslyckades.');
  }

  return {
    uid: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    name: (payload.name || payload.email.split('@')[0]).trim(),
    expiresAt: payload.exp!,
  };
}

async function readFirestoreRole(
  token: string,
  collectionName: 'admins' | 'roleAssignments',
  uid: string
): Promise<string | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
  )}/documents/${collectionName}/${encodeURIComponent(uid)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kunde inte läsa Firebase-roll (${response.status}): ${body.slice(0, 300)}`);
  }
  const document = (await response.json()) as {
    fields?: Record<string, { stringValue?: string }>;
  };
  return document.fields?.role?.stringValue || null;
}

function inferSeries(siNumber: number): SICardSeries {
  if (siNumber >= 8_000_000 && siNumber <= 8_999_999) return 'SIAC Air+';
  if (siNumber >= 9_000_000 && siNumber <= 9_999_999) return 'SI-Card 11';
  if (siNumber >= 7_000_000 && siNumber <= 7_999_999) return 'SI-Card 10';
  if (siNumber >= 2_000_000 && siNumber <= 2_999_999) return 'SI-Card 8';
  if (siNumber >= 1_000_000 && siNumber <= 1_999_999) return 'SI-Card 9';
  if (siNumber >= 500_000 && siNumber <= 999_999) return 'SI-Card 6';
  return 'SI-Card 5';
}

function getStockholmDateIso(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getStockholmClockSec(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  let hh = 0;
  let mm = 0;
  let ss = 0;
  for (const p of parts) {
    if (p.type === 'hour') hh = Number(p.value) % 24;
    else if (p.type === 'minute') mm = Number(p.value);
    else if (p.type === 'second') ss = Number(p.value);
  }
  return hh * 3600 + mm * 60 + ss;
}

function secToClock(sec: number): string {
  const norm = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const hh = Math.floor(norm / 3600)
    .toString()
    .padStart(2, '0');
  const mm = Math.floor((norm % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const ss = (norm % 60).toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function parseClockStrToSec(clock: string): number | null {
  const m = clock.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

function durToMmSs(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${hh}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  }
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function applyEmergencyTimeOffsets(
  punches: CardPunch[],
  offsets: Record<string, number>
): CardPunch[] {
  if (!offsets || Object.keys(offsets).length === 0) {
    return punches.map((p) => ({ ...p }));
  }
  return punches.map((p) => {
    const delta = Number(offsets[String(p.code)] || 0);
    if (!Number.isFinite(delta) || delta === 0) return { ...p };
    return {
      code: p.code,
      timeSec: (((p.timeSec + Math.round(delta)) % 86400) + 86400) % 86400,
    };
  });
}

/**
 * MeOS / O-Tid Sequential Punch Verification Algorithm with Emergency Support:
 * - Greedily matches ordered course controls against chronological SI-card punches
 * - Applies per-control clock offsets (controlTimeOffsets)
 * - Excuses controls marked out-of-order in the forest (brokenControls) so runners are approved (OK)
 */
function evaluateCardAgainstSingleCourse(
  course: Course,
  effectiveStartSec: number,
  finishTimeSec: number | null,
  rawPunches: CardPunch[],
  emergency: EmergencySettings
): ReadoutValidation {
  const punches = applyEmergencyTimeOffsets(rawPunches, emergency.controlTimeOffsets);
  const brokenSet = new Set<number>(emergency.brokenControls || []);

  const splits: SplitLegResult[] = [];
  const missingControls: number[] = [];
  const matchedPunchIndices = new Set<number>();

  let searchCursor = 0;
  let prevPunchSec = effectiveStartSec;
  let previousValid = true;

  course.controls.forEach((reqCode, idx) => {
    let foundIdx = -1;
    for (let i = searchCursor; i < punches.length; i++) {
      if (punches[i].code === reqCode) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx !== -1) {
      matchedPunchIndices.add(foundIdx);
      const pTime = punches[foundIdx].timeSec;
      const cum = pTime >= effectiveStartSec ? pTime - effectiveStartSec : null;
      const leg = previousValid && pTime >= prevPunchSec ? pTime - prevPunchSec : null;

      splits.push({
        order: idx + 1,
        controlCode: reqCode,
        label: `(${reqCode})`,
        status: 'OK',
        punchTimeSec: pTime,
        cumulativeSec: cum,
        legSec: leg,
      });

      prevPunchSec = pTime;
      previousValid = true;
      searchCursor = foundIdx + 1;
    } else if (brokenSet.has(reqCode)) {
      // Excused broken control in the forest! Runner is not disqualified (MP).
      splits.push({
        order: idx + 1,
        controlCode: reqCode,
        label: `(${reqCode})`,
        status: 'BROKEN_CTRL',
        punchTimeSec: null,
        cumulativeSec: null,
        legSec: null,
      });
      previousValid = false;
    } else {
      missingControls.push(reqCode);
      splits.push({
        order: idx + 1,
        controlCode: reqCode,
        label: `(${reqCode})`,
        status: 'MISSING',
        punchTimeSec: null,
        cumulativeSec: null,
        legSec: null,
      });
      previousValid = false;
    }
  });

  // Final sprint leg to Finish (Mål)
  if (finishTimeSec !== null && finishTimeSec >= effectiveStartSec) {
    splits.push({
      order: course.controls.length + 1,
      controlCode: 999,
      label: 'Mål',
      status: 'OK',
      punchTimeSec: finishTimeSec,
      cumulativeSec: finishTimeSec - effectiveStartSec,
      legSec: previousValid && finishTimeSec >= prevPunchSec ? finishTimeSec - prevPunchSec : null,
    });
  }

  const extraControls = punches.filter((_, i) => !matchedPunchIndices.has(i));

  return {
    ok: missingControls.length === 0 && finishTimeSec !== null,
    matchedCourseId: course.id,
    matchedCourseName: course.name,
    missingControls,
    extraControls,
    splits,
  };
}

function getRogainingControlPoints(code: number): number {
  return Math.max(10, Math.floor(code / 10) * 10);
}

function evaluateRogainingReadout(
  compClass: CompClass,
  assignedCourse: Course | null,
  courses: Course[],
  effectiveStartSec: number,
  finishTimeSec: number | null,
  rawPunches: CardPunch[],
  emergency: EmergencySettings
): ReadoutValidation {
  const punches = applyEmergencyTimeOffsets(rawPunches, emergency.controlTimeOffsets);
  const brokenSet = new Set<number>(emergency.brokenControls || []);
  const allowedPool = assignedCourse
    ? new Set<number>(assignedCourse.controls)
    : new Set<number>(courses.flatMap((c) => c.controls));

  const visitedCodes = new Set<number>();
  const splits: SplitLegResult[] = [];
  const extraControls: CardPunch[] = [];

  let prevPunchSec = effectiveStartSec;
  let grossPoints = 0;

  for (const p of punches) {
    if (brokenSet.has(p.code)) {
      extraControls.push(p);
      continue;
    }
    const inPool = allowedPool.size === 0 || allowedPool.has(p.code);
    if (!inPool || visitedCodes.has(p.code)) {
      extraControls.push(p);
      continue;
    }

    visitedCodes.add(p.code);
    const pts = getRogainingControlPoints(p.code);
    grossPoints += pts;

    const cum = p.timeSec >= effectiveStartSec ? p.timeSec - effectiveStartSec : null;
    const leg = p.timeSec >= prevPunchSec ? p.timeSec - prevPunchSec : null;
    splits.push({
      order: splits.length + 1,
      controlCode: p.code,
      label: `(${p.code})`,
      status: 'OK',
      punchTimeSec: p.timeSec,
      cumulativeSec: cum,
      legSec: leg,
      pointsAwarded: pts,
    });
    prevPunchSec = p.timeSec;
  }

  if (finishTimeSec !== null && finishTimeSec >= effectiveStartSec) {
    splits.push({
      order: splits.length + 1,
      controlCode: 999,
      label: 'Mål',
      status: 'OK',
      punchTimeSec: finishTimeSec,
      cumulativeSec: finishTimeSec - effectiveStartSec,
      legSec: finishTimeSec >= prevPunchSec ? finishTimeSec - prevPunchSec : null,
      pointsAwarded: 0,
    });
  }

  const runSec =
    finishTimeSec !== null && finishTimeSec >= effectiveStartSec
      ? finishTimeSec - effectiveStartSec
      : 0;
  const maxTimeSec = compClass.rogainingMaxTimeSec ?? 2700;
  const penaltyPerMin = compClass.rogainingPenaltyPerMin ?? 10;
  const overtimeSec = maxTimeSec > 0 && runSec > maxTimeSec ? runSec - maxTimeSec : 0;
  const overtimeMin = overtimeSec > 0 ? Math.ceil(overtimeSec / 60) : 0;
  const penalty = overtimeMin * penaltyPerMin;
  const netPoints = Math.max(0, grossPoints - penalty);

  return {
    ok: finishTimeSec !== null,
    matchedCourseId: assignedCourse?.id ?? null,
    matchedCourseName: assignedCourse ? `${assignedCourse.name} (Poängpool)` : 'Poäng-OL',
    missingControls: [],
    extraControls,
    splits,
    rogainingPoints: netPoints,
    rogainingGrossPoints: grossPoints,
    rogainingOvertimePenalty: penalty,
    rogainingOvertimeSec: overtimeSec,
  };
}

function validateCompetitorReadout(
  compClass: CompClass | undefined,
  courses: Course[],
  effectiveStartSec: number,
  finishTimeSec: number | null,
  punches: CardPunch[],
  emergency: EmergencySettings
): ReadoutValidation {
  const assignedCourse =
    courses.find((c) => c.id === compClass?.courseId) ?? courses[0] ?? null;

  if (compClass?.classFormat === 'ROGAINING') {
    return evaluateRogainingReadout(
      compClass,
      assignedCourse,
      courses,
      effectiveStartSec,
      finishTimeSec,
      punches,
      emergency
    );
  }

  if (compClass?.classFormat === 'FORKED') {
    const forkPool =
      compClass.forkCourseIds && compClass.forkCourseIds.length > 0
        ? courses.filter((c) => compClass.forkCourseIds!.includes(c.id))
        : courses;
    const candidates = forkPool.length > 0 ? forkPool : courses;
    const sortedByLen = [...candidates].sort((a, b) => b.controls.length - a.controls.length);

    let closestFallback: ReadoutValidation | null = null;
    for (const candidate of sortedByLen) {
      const res = evaluateCardAgainstSingleCourse(
        candidate,
        effectiveStartSec,
        finishTimeSec,
        punches,
        emergency
      );
      if (res.missingControls.length === 0) {
        return res;
      }
      if (
        !closestFallback ||
        res.missingControls.length < closestFallback.missingControls.length
      ) {
        closestFallback = res;
      }
    }
    if (closestFallback) return closestFallback;
  }

  if (compClass?.autoMatchCourse) {
    const sortedByLen = [...courses].sort((a, b) => b.controls.length - a.controls.length);
    for (const candidate of sortedByLen) {
      const res = evaluateCardAgainstSingleCourse(
        candidate,
        effectiveStartSec,
        finishTimeSec,
        punches,
        emergency
      );
      if (res.missingControls.length === 0) {
        return res;
      }
    }
  }

  if (!assignedCourse) {
    return {
      ok: finishTimeSec !== null,
      matchedCourseId: null,
      matchedCourseName: null,
      missingControls: [],
      extraControls: punches,
      splits: [],
    };
  }

  return evaluateCardAgainstSingleCourse(
    assignedCourse,
    effectiveStartSec,
    finishTimeSec,
    punches,
    emergency
  );
}

/**
 * Recomputes WinSplits / O-Tid Split Analysis for every class & course cohort:
 * - Leg rankings (legRank, legBehindSec, bestLegSec)
 * - Cumulative standings at each control (cumulativeRank, cumulativeBehindSec)
 * - Class Idealtid (sum of best leg times)
 * - Estimated Time Loss / Bomtid (timeLossSec, totalTimeLossSec, mistakeFreeTimeSec)
 */
function recomputeAllSplitRanks(ev: SingleEventRecord): void {
  for (const cls of ev.classes) {
    if (cls.classFormat === 'ROGAINING') {
      continue;
    }
    const okRunners = ev.competitors.filter(
      (c) => c.classId === cls.id && c.status === 'OK' && c.validation
    );
    if (okRunners.length === 0) continue;

    // Group by matchedCourseId so open classes with multiple courses compare like-for-like
    const byCourse = new Map<string, Competitor[]>();
    for (const r of okRunners) {
      const key = r.validation!.matchedCourseId ?? '__none__';
      const arr = byCourse.get(key) ?? [];
      arr.push(r);
      byCourse.set(key, arr);
    }

    for (const [, cohort] of byCourse.entries()) {
      const maxOrder = Math.max(
        0,
        ...cohort.flatMap((r) => r.validation!.splits.map((s) => s.order))
      );
      if (maxOrder === 0) continue;

      const bestLegByOrder = new Map<number, number>();
      const refLegByOrder = new Map<number, number>();

      for (let ord = 1; ord <= maxOrder; ord++) {
        // Leg rankings
        const legSplits = cohort
          .map((r) => r.validation!.splits.find((s) => s.order === ord))
          .filter((s): s is SplitLegResult => Boolean(s && s.legSec !== null && s.legSec >= 0));

        if (legSplits.length > 0) {
          const sortedLegVals = [...legSplits.map((s) => s.legSec!)].sort((a, b) => a - b);
          const bestLeg = sortedLegVals[0];
          bestLegByOrder.set(ord, bestLeg);

          const topCount = Math.min(2, sortedLegVals.length);
          const refAvg =
            sortedLegVals.slice(0, topCount).reduce((sum, v) => sum + v, 0) / topCount;
          refLegByOrder.set(ord, Math.max(8, refAvg));

          for (const sp of legSplits) {
            sp.bestLegSec = bestLeg;
            sp.legRank = sortedLegVals.indexOf(sp.legSec!) + 1;
            sp.legBehindSec = sp.legSec! - bestLeg;
          }
        }

        // Cumulative rankings
        const cumSplits = cohort
          .map((r) => r.validation!.splits.find((s) => s.order === ord))
          .filter(
            (s): s is SplitLegResult =>
              Boolean(s && s.cumulativeSec !== null && s.cumulativeSec >= 0)
          );

        if (cumSplits.length > 0) {
          const sortedCumVals = [...cumSplits.map((s) => s.cumulativeSec!)].sort(
            (a, b) => a - b
          );
          const bestCum = sortedCumVals[0];
          for (const sp of cumSplits) {
            sp.cumulativeRank = sortedCumVals.indexOf(sp.cumulativeSec!) + 1;
            sp.cumulativeBehindSec = sp.cumulativeSec! - bestCum;
          }
        }
      }

      // Compute Idealtid (sum of bestLegSec across all non-broken legs)
      let idealSum = 0;
      let hasAllActiveLegs = true;
      for (let ord = 1; ord <= maxOrder; ord++) {
        const sample = cohort[0]?.validation?.splits.find((s) => s.order === ord);
        if (sample?.status === 'BROKEN_CTRL') continue;
        const b = bestLegByOrder.get(ord);
        if (b === undefined) {
          hasAllActiveLegs = false;
          break;
        }
        idealSum += b;
      }
      const idealTimeSec = hasAllActiveLegs && idealSum > 0 ? idealSum : null;

      // Compute Bomtid (Estimated Time Loss) per runner
      for (const r of cohort) {
        const val = r.validation!;
        val.idealTimeSec = idealTimeSec;

        if (cohort.length < 2) {
          for (const sp of val.splits) {
            sp.timeLossSec = 0;
          }
          val.totalTimeLossSec = 0;
          val.mistakeFreeTimeSec = r.runningTimeSec;
          continue;
        }

        // Collect clean speed ratios against refLegByOrder
        const ratios: number[] = [];
        for (const sp of val.splits) {
          const ref = refLegByOrder.get(sp.order);
          if (sp.legSec !== null && sp.legSec > 0 && ref) {
            ratios.push(sp.legSec / ref);
          }
        }

        if (ratios.length === 0) {
          val.totalTimeLossSec = 0;
          val.mistakeFreeTimeSec = r.runningTimeSec;
          continue;
        }

        const sortedRatios = [...ratios].sort((a, b) => a - b);
        const pctIdx = Math.max(0, Math.floor((sortedRatios.length - 1) * 0.35));
        const baseRatio = sortedRatios[pctIdx];

        let totalBom = 0;
        for (const sp of val.splits) {
          const ref = refLegByOrder.get(sp.order);
          if (sp.legSec !== null && ref) {
            const expectedSec = Math.round(ref * baseRatio);
            const rawLoss = sp.legSec - expectedSec;
            // Flag bom when runner was not leg winner and lost >= 12 seconds vs their clean pace
            if ((sp.legRank ?? 99) > 1 && rawLoss >= 12) {
              sp.timeLossSec = rawLoss;
              totalBom += rawLoss;
            } else {
              sp.timeLossSec = 0;
            }
          } else {
            sp.timeLossSec = null;
          }
        }

        val.totalTimeLossSec = totalBom;
        val.mistakeFreeTimeSec =
          r.runningTimeSec !== null
            ? Math.max(idealTimeSec ?? 0, r.runningTimeSec - totalBom)
            : null;
      }
    }
  }
}

/**
 * Re-evaluates all competitors in an event from their archived raw readout (`rawReadout`)
 * using current courses, classes, manual finish times, and emergency settings!
 */
function recalculateEventFromRawReadouts(ev: SingleEventRecord): number {
  let recalculatedCount = 0;
  if (ev.competitors.some((runner) => runner.rawReadout || runner.readoutAt)) {
    declareCompetitorMutation({
      source: 'recalculateEventFromRawReadouts',
      operation: 'UPDATE',
      competitionId: ev.competition.id,
      assignmentHandling: {
        mode: 'LEGACY',
        reason: 'Result recalculation updates derived competitor state without changing SI identity.',
      },
      identityAffecting: false,
    });
  }
  for (const runner of ev.competitors) {
    const raw = runner.rawReadout;
    const sourcePunches = raw ? raw.punches : runner.cardPunches;
    const hasReadoutData = Boolean(raw || runner.readoutAt || sourcePunches.length > 0);
    if (!hasReadoutData) continue;

    const cls = ev.classes.find((c) => c.id === runner.classId);
    const effectiveStart =
      runner.startTimeSec ??
      raw?.startTimeSec ??
      runner.allocatedStartSec ??
      ev.competition.zeroTimeSec;
    const effectiveFinish =
      runner.manualFinishTimeSec ?? raw?.finishTimeSec ?? runner.finishTimeSec;

    runner.cardPunches = applyEmergencyTimeOffsets(
      sourcePunches,
      ev.emergency.controlTimeOffsets
    );
    runner.finishTimeSec = effectiveFinish;
    runner.runningTimeSec =
      effectiveFinish !== null && effectiveFinish >= effectiveStart
        ? effectiveFinish - effectiveStart
        : null;

    if (sourcePunches.length > 0 || runner.readoutAt) {
      runner.validation = validateCompetitorReadout(
        cls,
        ev.courses,
        effectiveStart,
        effectiveFinish,
        sourcePunches,
        ev.emergency
      );
      if (runner.status !== 'DNF' && runner.status !== 'DNS') {
        runner.status = runner.validation.ok ? 'OK' : 'MP';
      }
      recalculatedCount++;
    }
  }
  recomputeAllSplitRanks(ev);
  return recalculatedCount;
}

const DEFAULT_EVENTOR_BASE_URL = 'https://eventor.orientering.se/api';

interface EventorConfig {
  apiKey: string;
  orgId: string;
  baseUrl: string;
}

type EventorApiConfig = Pick<EventorConfig, 'apiKey' | 'baseUrl'>;

class EventorApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'EventorApiError';
  }
}

const EVENTOR_REQUEST_TIMEOUT_MS = 10_000;
const EVENTOR_TIMEOUT_MESSAGE =
  'Eventor svarade inte inom 10 sekunder. Försök igen om en stund.';

function normalizeEventorBaseUrl(value: string): string {
  const rawBase = value.trim().replace(/\/+$/, '');
  const baseUrl = rawBase ? (rawBase.endsWith('/api') ? rawBase : `${rawBase}/api`) : DEFAULT_EVENTOR_BASE_URL;
  const parsed = new URL(baseUrl);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'eventor.orientering.se' ||
    parsed.port ||
    parsed.pathname !== '/api' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'Eventor Base URL måste vara https://eventor.orientering.se/api.'
    );
  }
  return parsed.toString().replace(/\/+$/, '');
}

function getEventorApiConfigFromRequest(body: unknown): EventorApiConfig {
  const values =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const apiKey = typeof values.apiKey === 'string' ? values.apiKey.trim() : '';
  if (!apiKey) throw new Error('Eventor API-nyckel saknas.');
  if (apiKey.length > 512) throw new Error('API-nyckeln är för lång.');
  const baseUrl =
    typeof values.baseUrl === 'string' ? values.baseUrl : DEFAULT_EVENTOR_BASE_URL;
  return {
    apiKey,
    baseUrl: normalizeEventorBaseUrl(baseUrl),
  };
}

function getEventorConfigFromRequest(body: unknown): EventorConfig {
  const values =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const apiConfig = getEventorApiConfigFromRequest(body);
  const orgId = typeof values.orgId === 'string' ? values.orgId.trim() : '';
  if (!orgId) throw new Error('Eventor Organisations-ID saknas.');
  if (!/^\d{1,32}$/.test(orgId)) {
    throw new Error('Organisations-ID måste bestå av 1–32 siffror.');
  }
  return {
    ...apiConfig,
    orgId,
  };
}

function getRocDefaultBaseUrl(): string {
  return (process.env.ROC_BASE_URL || 'https://roc.olresultat.se/getpunches.asp').trim();
}

function buildDefaultEventorMeta(): EventorIntegrationStatus {
  return {
    apiKeyConfigured: false,
    baseUrl: DEFAULT_EVENTOR_BASE_URL,
    connectedOrgId: null,
    connectedOrgName: 'OK Österåker (Lokalt synkad klubbdatabas)',
    connectedEventId: null,
    lastSyncedAt: null,
    autoCreateFromRunnerDbOnReadout: true,
  };
}

function buildDefaultStations(nowIso: string): SIStation[] {
  return [
    {
      id: 'st-check',
      stationCode: 10,
      name: 'Check — Startfålla Inpassering',
      hardwareModel: 'BSM8-USB',
      stationFunction: 'CHECK',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 4980,
      firmware: 'FW 6.56',
      lastSeenAt: nowIso,
      active: true,
    },
    {
      id: 'st-start',
      stationCode: 20,
      name: 'Startpunkt S1',
      hardwareModel: 'BSF9 Master',
      stationFunction: 'START',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 3510,
      firmware: 'FW 6.58',
      lastSeenAt: nowIso,
      active: true,
    },
    {
      id: 'st-r42',
      stationCode: 42,
      name: 'Radiokontroll (42) — Publikpassering',
      hardwareModel: 'SRR-USB (Air+)',
      stationFunction: 'RADIO',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 3490,
      firmware: 'FW 6.60 Air+',
      lastSeenAt: nowIso,
      active: true,
    },
    {
      id: 'st-r55',
      stationCode: 55,
      name: 'Radiokontroll (55) — Högplatån',
      hardwareModel: 'SRR-USB (Air+)',
      stationFunction: 'RADIO',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 3460,
      firmware: 'FW 6.60 Air+',
      lastSeenAt: nowIso,
      active: true,
    },
    {
      id: 'st-pre100',
      stationCode: 100,
      name: 'Förvarning (100) — Sista kontrollen',
      hardwareModel: 'SRR-USB (Air+)',
      stationFunction: 'PREWARNING',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 3530,
      firmware: 'FW 6.60 Air+',
      lastSeenAt: nowIso,
      active: true,
    },
    {
      id: 'st-fin',
      stationCode: 90,
      name: 'Målstämpling Arena',
      hardwareModel: 'BSF9 Master',
      stationFunction: 'FINISH',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 3480,
      firmware: 'FW 6.58',
      lastSeenAt: nowIso,
      active: true,
    },
    {
      id: 'st-readout',
      stationCode: 1,
      name: 'Målavläsning Sekretariat (USB)',
      hardwareModel: 'BSM8-USB',
      stationFunction: 'READOUT',
      baudRate: 38400,
      extendedProtocol: true,
      batteryMv: 4990,
      firmware: 'FW 6.56',
      lastSeenAt: nowIso,
      active: true,
    },
  ];
}

function buildDefaultRocStatus(unitId = '1042'): RocIntegrationStatus {
  return {
    enabled: false,
    unitId,
    baseUrl: getRocDefaultBaseUrl(),
    pollIntervalSec: 5,
    lastPunchId: 0,
    lastPolledAt: null,
    totalReceived: 0,
    lastError: null,
  };
}

function offsetDateIso(daysOffset: number): string {
  const todayStockholm = getStockholmDateIso();
  const [y, m, d] = todayStockholm.split('-').map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d + daysOffset, 12, 0, 0));
  return utcNoon.toISOString().slice(0, 10);
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_DATA_URL_CHARS = 500_000;

function sanitizeServerHexColor(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : '';
}

function sanitizeServerLogoDataUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LOGO_DATA_URL_CHARS) return '';
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  return '';
}

function buildDefaultClubSettings(): ClubSettings {
  return {
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
}

function ensureClubSettings(seasonDb: SeasonDatabase): ClubSettings {
  if (!seasonDb.clubSettings || typeof seasonDb.clubSettings !== 'object') {
    seasonDb.clubSettings = buildDefaultClubSettings();
    return seasonDb.clubSettings;
  }
  const c = seasonDb.clubSettings;
  seasonDb.clubSettings = {
    clubName: (c.clubName || 'OK Österåker').trim() || 'OK Österåker',
    eventorOrgId: (c.eventorOrgId || '').trim(),
    defaultDirectEntryFeeSek: Number.isFinite(Number(c.defaultDirectEntryFeeSek))
      ? Math.max(0, Math.round(Number(c.defaultDirectEntryFeeSek)))
      : 0,
    rentalCardFeeSek: Number.isFinite(Number(c.rentalCardFeeSek))
      ? Math.max(0, Math.round(Number(c.rentalCardFeeSek)))
      : 0,
    missingRentalFeeSek: Number.isFinite(Number(c.missingRentalFeeSek))
      ? Math.max(0, Math.round(Number(c.missingRentalFeeSek)))
      : 0,
    portalTitle: (c.portalTitle || '').trim().slice(0, 80),
    logoDataUrl: sanitizeServerLogoDataUrl(c.logoDataUrl),
    customBgColor: sanitizeServerHexColor(c.customBgColor),
    customTextColor: sanitizeServerHexColor(c.customTextColor),
    customAccentColor: sanitizeServerHexColor(c.customAccentColor),
    seriesScoringSettings: normalizeSeriesScoringSettings(c.seriesScoringSettings),
  };
  return seasonDb.clubSettings;
}

function buildSeasonSeed(): SeasonDatabase {
  const nowIso = new Date().toISOString();
  const authConfig = buildDefaultSeasonAuthConfig(nowIso);
  const clubSettings = buildDefaultClubSettings();

  return {
    version: 3,
    activeEventId: "",
    demoCleared: true,
    clubSettings,
    eventsMap: {},
    runnerDb: [],
    eventor: buildDefaultEventorMeta(),
    authConfig,
  };
}

function upsertRunnerInSeasonDb(
  seasonDb: SeasonDatabase,
  input: {
    siNumber: number;
    fullName: string;
    club: string;
    birthYear?: number | null;
    defaultClassName?: string | null;
    eventorPersonId?: string | null;
    eventorOrgId?: string | null;
    source: RunnerDbSource;
  }
): RunnerDbEntry | null {
  if (!Number.isFinite(input.siNumber) || input.siNumber <= 0 || !input.fullName.trim()) {
    return null;
  }
  const nowIso = new Date().toISOString();
  const existing = seasonDb.runnerDb.find((r) => r.siNumber === input.siNumber);
  if (existing) {
    const incomingName = input.fullName.trim();
    const samePerson =
      existing.fullName.trim().toLowerCase() === incomingName.toLowerCase();
    // Never overwrite an existing card owner in runnerDb from a single race entry (e.g. borrowed stick!)
    if (input.source === 'LEARNED_ENTRY' && !samePerson) {
      return existing;
    }
    existing.fullName = incomingName;
    existing.club = input.club.trim() || existing.club;
    existing.cardSeries = inferSeries(input.siNumber);
    if (input.birthYear !== undefined && input.birthYear !== null) {
      existing.birthYear = input.birthYear;
    }
    if (input.defaultClassName) {
      existing.defaultClassName = input.defaultClassName;
    }
    if (input.eventorPersonId) {
      existing.eventorPersonId = input.eventorPersonId;
    }
    if (input.eventorOrgId) {
      existing.eventorOrgId = input.eventorOrgId;
    }
    if (input.source !== 'LEARNED_ENTRY') {
      existing.source = input.source;
    }
    existing.updatedAt = nowIso;
    return existing;
  }

  const created: RunnerDbEntry = {
    id: `rdb-${input.siNumber}-${Math.random().toString(36).slice(2, 6)}`,
    siNumber: input.siNumber,
    cardSeries: inferSeries(input.siNumber),
    fullName: input.fullName.trim(),
    club: input.club.trim() || 'Klubblös',
    birthYear: input.birthYear ?? null,
    defaultClassName: input.defaultClassName ?? null,
    eventorPersonId: input.eventorPersonId ?? null,
    eventorOrgId: input.eventorOrgId ?? null,
    source: input.source,
    updatedAt: nowIso,
  };
  seasonDb.runnerDb.unshift(created);
  return created;
}

/**
 * XML helpers for Eventor REST API & Server-Side IOF XML 3.0 ResultList feed (Livelox / WinSplits)
 */
function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function extractFirstTag(xml: string, localTagName: string): string | null {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${localTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>`,
    'i'
  );
  const m = xml.match(re);
  return m ? decodeXmlEntities(m[1]) : null;
}

function extractAllBlocks(xml: string, localTagName: string): string[] {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${localTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>`,
    'gi'
  );
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function parseEventorOrgXml(xml: string): { orgId: string; orgName: string } | null {
  const orgBlock = extractFirstTag(xml, 'Organisation') ?? xml;
  const orgId =
    extractFirstTag(orgBlock, 'OrganisationId') ??
    extractFirstTag(orgBlock, 'Id') ??
    null;
  const orgName =
    extractFirstTag(orgBlock, 'Name') ??
    extractFirstTag(orgBlock, 'ShortName') ??
    null;
  if (!orgId || !orgName) return null;
  return { orgId, orgName };
}

function parseEventorEventXml(
  xml: string,
  requestedEventId: string
): { eventId: string; name: string; organizer: string | null; date: string | null } | null {
  const eventBlock = extractFirstTag(xml, 'Event') ?? xml;
  const name = extractFirstTag(eventBlock, 'Name') ?? extractFirstTag(eventBlock, 'EventName');
  if (!name?.trim()) return null;

  const organizerBlock =
    extractFirstTag(eventBlock, 'Organiser') ??
    extractFirstTag(eventBlock, 'Organizer') ??
    extractFirstTag(eventBlock, 'Organisation');
  const organizer =
    (organizerBlock
      ? extractFirstTag(organizerBlock, 'Name') ?? extractFirstTag(organizerBlock, 'ShortName')
      : null) ??
    extractFirstTag(eventBlock, 'OrganiserName') ??
    extractFirstTag(eventBlock, 'OrganizerName') ??
    null;
  const dateValue =
    extractFirstTag(eventBlock, 'StartDate') ??
    extractFirstTag(eventBlock, 'EventDate') ??
    extractFirstTag(eventBlock, 'Date') ??
    '';
  const dateMatch = dateValue.match(/^(\d{4}-\d{2}-\d{2})/);

  return {
    eventId: requestedEventId,
    name: name.trim().slice(0, 140),
    organizer: organizer?.trim().slice(0, 100) || null,
    date: dateMatch?.[1] ?? null,
  };
}

function parseEventorCompetitorsXml(
  xml: string,
  fallbackClubName: string,
  fallbackOrgId: string
): {
  siNumber: number;
  fullName: string;
  club: string;
  birthYear: number | null;
  eventorPersonId: string | null;
  eventorOrgId: string | null;
}[] {
  const blocks = [
    ...extractAllBlocks(xml, 'Competitor'),
    ...extractAllBlocks(xml, 'PersonEntry'),
  ];
  const parsed: {
    siNumber: number;
    fullName: string;
    club: string;
    birthYear: number | null;
    eventorPersonId: string | null;
    eventorOrgId: string | null;
  }[] = [];

  for (const b of blocks) {
    const personBlock = extractFirstTag(b, 'Person') ?? b;
    const nameBlock = extractFirstTag(personBlock, 'Name') ?? personBlock;
    const given = extractFirstTag(nameBlock, 'Given') ?? '';
    const family = extractFirstTag(nameBlock, 'Family') ?? '';
    const fullName = `${given} ${family}`.trim();
    if (!fullName) continue;

    const personId =
      extractFirstTag(personBlock, 'PersonId') ??
      extractFirstTag(personBlock, 'Id') ??
      null;
    const birthRaw = extractFirstTag(personBlock, 'BirthDate') ?? '';
    const yearMatch = birthRaw.match(/\b(19\d{2}|20\d{2})\b/);
    const birthYear = yearMatch ? Number(yearMatch[1]) : null;

    const orgBlock = extractFirstTag(b, 'Organisation');
    const club = (orgBlock ? extractFirstTag(orgBlock, 'Name') : null) || fallbackClubName;
    const orgId =
      (orgBlock
        ? extractFirstTag(orgBlock, 'OrganisationId') ?? extractFirstTag(orgBlock, 'Id')
        : null) || fallbackOrgId;

    const cardTexts = [
      ...extractAllBlocks(b, 'CCardId'),
      ...extractAllBlocks(b, 'ControlCard'),
      ...extractAllBlocks(b, 'PunchingUnitId'),
    ];
    for (const ct of cardTexts) {
      const si = Number(decodeXmlEntities(ct).replace(/\D/g, ''));
      if (Number.isFinite(si) && si > 0) {
        parsed.push({
          siNumber: si,
          fullName,
          club,
          birthYear,
          eventorPersonId: personId,
          eventorOrgId: orgId,
        });
      }
    }
  }
  return parsed;
}

function parseEventorClassesXml(xml: string): Map<string, string> {
  const classMap = new Map<string, string>();
  const blocks = [
    ...extractAllBlocks(xml, 'EventClass'),
    ...extractAllBlocks(xml, 'Class'),
  ];
  for (const b of blocks) {
    const id = extractFirstTag(b, 'EventClassId') ?? extractFirstTag(b, 'Id');
    const name = extractFirstTag(b, 'Name') ?? extractFirstTag(b, 'ClassShortName');
    if (id?.trim() && name?.trim()) {
      classMap.set(id.trim().slice(0, 128), name.trim().slice(0, 80));
    }
  }
  return classMap;
}

function parseEventorEntriesXml(
  xml: string,
  classIdToName: Map<string, string>
): { fullName: string; club: string; className: string; siNumber: number; personId: string | null }[] {
  const blocks = [
    ...extractAllBlocks(xml, 'Entry'),
    ...extractAllBlocks(xml, 'PersonEntry'),
  ];
  const entries: {
    fullName: string;
    club: string;
    className: string;
    siNumber: number;
    personId: string | null;
  }[] = [];

  for (const b of blocks) {
    const personBlock = extractFirstTag(b, 'Competitor') ?? extractFirstTag(b, 'Person') ?? b;
    const nameBlock = extractFirstTag(personBlock, 'Name') ?? personBlock;
    const given = extractFirstTag(nameBlock, 'Given') ?? '';
    const family = extractFirstTag(nameBlock, 'Family') ?? '';
    const fullName = `${given} ${family}`.trim().slice(0, 120);
    if (!fullName) continue;

    const personId =
      extractFirstTag(personBlock, 'PersonId') ??
      extractFirstTag(personBlock, 'Id') ??
      null;

    const orgBlock =
      extractFirstTag(b, 'Organisation') ?? extractFirstTag(personBlock, 'Organisation');
    const club = ((orgBlock ? extractFirstTag(orgBlock, 'Name') : null) || 'Klubblös').slice(
      0,
      100
    );

    const entryClassBlock = extractFirstTag(b, 'EntryClass') ?? extractFirstTag(b, 'Class') ?? b;
    const evClsId =
      extractFirstTag(entryClassBlock, 'EventClassId') ??
      extractFirstTag(b, 'EventClassId') ??
      extractFirstTag(entryClassBlock, 'Id') ??
      '';
    const directClsName = extractFirstTag(entryClassBlock, 'Name');
    const className = (
      (evClsId && classIdToName.get(evClsId)) ||
      directClsName ||
      'Öppen Motion'
    ).slice(0, 80);

    const cardTexts = [
      ...extractAllBlocks(b, 'CCardId'),
      ...extractAllBlocks(b, 'ControlCard'),
      ...extractAllBlocks(b, 'PunchingUnitId'),
    ];
    let siNumber = 0;
    for (const ct of cardTexts) {
      const candidate = Number(decodeXmlEntities(ct).replace(/\D/g, ''));
      if (Number.isInteger(candidate) && candidate > 0 && candidate <= 99999999) {
        siNumber = candidate;
        break;
      }
    }

    entries.push({
      fullName,
      club,
      className,
      siNumber,
      personId: personId?.slice(0, 128) ?? null,
    });
  }
  return entries;
}

function getEventorErrorDetail(body: string, statusText: string, apiKey: string): string {
  let detail: string;
  try {
    const payload = JSON.parse(body) as {
      error?: unknown;
      message?: unknown;
      detail?: unknown;
    };
    for (const value of [payload.error, payload.message, payload.detail]) {
      if (typeof value === 'string' && value.trim()) {
        detail = value.trim();
        return detail.split(apiKey).join('[redacted]').slice(0, 500);
      }
    }
  } catch {
    // Eventor commonly returns XML or plain text errors.
  }
  const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  detail = text || statusText || 'Okänt fel från Eventor.';
  return detail.split(apiKey).join('[redacted]').slice(0, 500);
}

async function fetchFromEventorApi(
  endpointPath: string,
  config: EventorApiConfig,
  requireStatus200 = false
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Eventor API-nyckel saknas. Konfigurera integrationen under Klubbadmin & Behörighet.');
  }
  const url = `${config.baseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    EVENTOR_REQUEST_TIMEOUT_MS
  );
  try {
    const resp = await fetch(url, {
      headers: {
        ApiKey: config.apiKey,
        Accept: 'application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    const body = await resp.text();
    const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
    const isHtml =
      contentType.includes('text/html') ||
      /^\s*(?:<!doctype\s+html|<(?:html|head|body|title|meta|script)\b)/i.test(body);

    if (!resp.ok || (requireStatus200 && resp.status !== 200)) {
      const detail = isHtml
        ? ''
        : getEventorErrorDetail(body, resp.statusText, config.apiKey);
      throw new EventorApiError(
        resp.ok ? 502 : resp.status,
        `Eventor svarade inte korrekt (HTTP ${resp.status})${detail ? `: ${detail}` : ''}`
      );
    }

    const isXml =
      (body.trim().length > 0 && contentType.includes('xml')) ||
      (!contentType.includes('html') &&
        !contentType.includes('json') &&
        body.trim().length > 0 &&
        /^\s*(?:<\?xml\b|<[A-Za-z_][\w:.-]*(?:\s|>))/i.test(body) &&
        !isHtml);
    if (!isXml) {
      throw new EventorApiError(
        502,
        `Eventor svarade inte korrekt (HTTP ${resp.status})`
      );
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new EventorApiError(504, EVENTOR_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sendEventorError(
  res: express.Response,
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 500
): void {
  if (error instanceof EventorApiError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  if (error instanceof TypeError) {
    res.status(502).json({
      success: false,
      error: `Eventor svarade inte korrekt (HTTP 502): ${error.message}`,
    });
    return;
  }
  res.status(fallbackStatus).json({
    success: false,
    error: error instanceof Error ? error.message : fallbackMessage,
  });
}

function buildServerIofResultListXml(ev: SingleEventRecord): string {
  const { competition, classes, courses, competitors } = ev;
  const createTime = new Date().toISOString();

  const secIso = (sec: number | null) =>
    sec !== null && Number.isFinite(sec) ? `${competition.date}T${secToClock(sec)}` : null;

  const classBlocks = classes
    .map((cls) => {
      const course = courses.find((c) => c.id === cls.courseId) ?? null;
      const inClass = competitors.filter(
        (c) =>
          c.classId === cls.id &&
          (c.status === 'OK' ||
            c.status === 'MP' ||
            c.status === 'DNF' ||
            c.status === 'DNS' ||
            c.status === 'PRELIMINARY_FIN')
      );

      const okRunners = inClass
        .filter((c) => c.status === 'OK' && c.runningTimeSec !== null)
        .sort((a, b) => (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999));

      const others = inClass.filter((c) => c.status !== 'OK');
      const ordered = [...okRunners, ...others];

      const personResults = ordered
        .map((runner, idx) => {
          const nameParts = runner.fullName.trim().split(/\s+/);
          const given = nameParts[0] || runner.fullName;
          const family = nameParts.slice(1).join(' ') || '-';

          let iofStatus = 'OK';
          if (runner.status === 'MP') iofStatus = 'MissingPunch';
          else if (runner.status === 'DNF') iofStatus = 'DidNotFinish';
          else if (runner.status === 'DNS') iofStatus = 'DidNotStart';
          else if (runner.status === 'PRELIMINARY_FIN') iofStatus = 'Active';

          const startIso = secIso(runner.startTimeSec ?? runner.allocatedStartSec);
          const finishIso = secIso(runner.finishTimeSec);

          const splitElements = (runner.validation?.splits ?? [])
            .filter((s) => s.controlCode !== 999)
            .map((s) =>
              s.status === 'OK' && s.cumulativeSec !== null
                ? `        <SplitTime>\n          <ControlCode>${s.controlCode}</ControlCode>\n          <Time>${s.cumulativeSec}</Time>\n        </SplitTime>`
                : `        <SplitTime status="Missing">\n          <ControlCode>${s.controlCode}</ControlCode>\n        </SplitTime>`
            )
            .join('\n');

          return `    <PersonResult>
      <Person>
        <Name>
          <Given>${escapeXml(given)}</Given>
          <Family>${escapeXml(family)}</Family>
        </Name>
      </Person>
      <Organisation>
        <Name>${escapeXml(runner.club)}</Name>
      </Organisation>
      <Result>
        <BibNumber>${runner.bib}</BibNumber>
${startIso ? `        <StartTime>${startIso}</StartTime>\n` : ''}${
            finishIso ? `        <FinishTime>${finishIso}</FinishTime>\n` : ''
          }${
            runner.runningTimeSec !== null && runner.status === 'OK'
              ? `        <Time>${runner.runningTimeSec}</Time>\n        <Position>${
                  idx + 1
                }</Position>\n`
              : ''
          }        <Status>${iofStatus}</Status>
        <ControlCard>${runner.siNumber}</ControlCard>
${splitElements ? splitElements + '\n' : ''}      </Result>
    </PersonResult>`;
        })
        .join('\n');

      return `  <ClassResult>
    <Class>
      <Id>${escapeXml(cls.id)}</Id>
      <Name>${escapeXml(cls.name)}</Name>
    </Class>
${
  course
    ? `    <Course>\n      <Name>${escapeXml(course.name)}</Name>\n      <Length>${
        course.lengthMeters
      }</Length>\n      <Climb>${course.climbMeters}</Climb>\n    </Course>\n`
    : ''
}${personResults}
  </ClassResult>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="${createTime}" creator="PasserSI">
  <Event>
    <Id>${escapeXml(competition.shortCode)}</Id>
    <Name>${escapeXml(competition.name)}</Name>
    <StartTime>
      <Date>${escapeXml(competition.date)}</Date>
      <Time>${escapeXml(competition.zeroTimeStr)}</Time>
    </StartTime>
  </Event>
${classBlocks}
</ResultList>`;
}

function buildServerIofStartListXml(ev: SingleEventRecord): string {
  const { competition, classes, courses, competitors } = ev;
  const createTime = new Date().toISOString();
  const secIso = (sec: number | null) =>
    sec !== null && Number.isFinite(sec) ? `${competition.date}T${secToClock(sec)}` : null;

  const classStarts = classes
    .map((cls) => {
      const course = courses.find((c) => c.id === cls.courseId) ?? null;
      const inClass = competitors
        .filter((c) => c.classId === cls.id)
        .sort((a, b) => (a.allocatedStartSec ?? 999999) - (b.allocatedStartSec ?? 999999));

      const personStarts = inClass
        .map((r) => {
          const nameParts = r.fullName.trim().split(/\s+/);
          const given = nameParts[0] || r.fullName;
          const family = nameParts.slice(1).join(' ') || '-';
          const startIso = secIso(r.allocatedStartSec ?? r.startTimeSec);

          return `    <PersonStart>
      <Person>
        <Name>
          <Given>${escapeXml(given)}</Given>
          <Family>${escapeXml(family)}</Family>
        </Name>
      </Person>
      <Organisation>
        <Name>${escapeXml(r.club)}</Name>
      </Organisation>
      <Start>
        <BibNumber>${r.bib}</BibNumber>
${startIso ? `        <StartTime>${startIso}</StartTime>\n` : ''}        <ControlCard>${r.siNumber}</ControlCard>
      </Start>
    </PersonStart>`;
        })
        .join('\n');

      return `  <ClassStart>
    <Class>
      <Id>${escapeXml(cls.id)}</Id>
      <Name>${escapeXml(cls.name)}</Name>
    </Class>
${
  course
    ? `    <Course>\n      <Name>${escapeXml(course.name)}</Name>\n      <Length>${course.lengthMeters}</Length>\n      <Climb>${course.climbMeters}</Climb>\n    </Course>\n`
    : ''
}${personStarts}
  </ClassStart>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="${createTime}" creator="PasserSI">
  <Event>
    <Id>${escapeXml(competition.shortCode)}</Id>
    <Name>${escapeXml(competition.name)}</Name>
    <StartTime>
      <Date>${escapeXml(competition.date)}</Date>
      <Time>${escapeXml(competition.zeroTimeStr)}</Time>
    </StartTime>
  </Event>
${classStarts}
</StartList>`;
}

const DATA_DIR = path.join(__dirname, 'data');
const SEASON_DB_FILE = path.join(DATA_DIR, 'passersi-season-db.json');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'meos-db.json');

function saveSeasonDatabase(seasonDb: SeasonDatabase): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${SEASON_DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(seasonDb, null, 2), 'utf-8');
    fs.renameSync(tmpFile, SEASON_DB_FILE);
  } catch (err) {
    console.error('Could not persist PasserSI season DB:', err);
  }
}

function loadSeasonDatabase(): SeasonDatabase {
  try {
    if (fs.existsSync(LEGACY_DB_FILE)) {
      try {
        fs.unlinkSync(LEGACY_DB_FILE);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(SEASON_DB_FILE)) {
      const parsed = JSON.parse(
        fs.readFileSync(SEASON_DB_FILE, 'utf-8')
      ) as Partial<SeasonDatabase>;
      if (
        parsed.version === 3 &&
        parsed.eventsMap &&
        typeof parsed.eventsMap === 'object'
      ) {
        const full = parsed as SeasonDatabase;
        const keys = Object.keys(full.eventsMap);
        if (keys.length === 0) {
          full.activeEventId = '';
        } else if (!full.activeEventId || !full.eventsMap[full.activeEventId]) {
          full.activeEventId = keys[0];
        }
        if (!Array.isArray(full.runnerDb)) full.runnerDb = [];
        if (!full.eventor) full.eventor = buildDefaultEventorMeta();
        ensureClubSettings(full);
        const hadAuthConfig = Boolean(full.authConfig);
        const hadLegacyAuthConfig = Boolean(
          full.authConfig &&
          Object.keys(full.authConfig).some((key) => key !== 'admins')
        );
        ensureSeasonAuthConfig(full);
        let normalizedAnyEventMeta = false;
        for (const ev of Object.values(full.eventsMap)) {
          const legacyPinFields = ev as SingleEventRecord & {
            rolePins?: unknown;
            pinsCustomized?: unknown;
          };
          if ('rolePins' in legacyPinFields || 'pinsCustomized' in legacyPinFields) {
            delete legacyPinFields.rolePins;
            delete legacyPinFields.pinsCustomized;
            normalizedAnyEventMeta = true;
          }
          const legacyCompetition = ev.competition as typeof ev.competition & {
            enableFeesAndSwish?: boolean;
          };
          if (
            ev.competition.feeTrackingEnabled === undefined ||
            legacyCompetition.enableFeesAndSwish !== undefined
          ) {
            normalizedAnyEventMeta = true;
          }
          ev.competition.feeTrackingEnabled = Boolean(
            ev.competition.feeTrackingEnabled ?? legacyCompetition.enableFeesAndSwish
          );
          delete legacyCompetition.enableFeesAndSwish;
          if (!ev.emergency) ev.emergency = { brokenControls: [], controlTimeOffsets: {} };
          if (!ev.roc) ev.roc = buildDefaultRocStatus('1042');
          if (!Array.isArray(ev.processedClientIds)) ev.processedClientIds = [];
          recomputeAllSplitRanks(ev);
        }
        if (!hadAuthConfig || hadLegacyAuthConfig || normalizedAnyEventMeta) {
          saveSeasonDatabase(full);
        }
        return full;
      }
    }
  } catch (err) {
    console.error('Could not read season DB, initializing fresh seed:', err);
  }
  const fresh = buildSeasonSeed();
  saveSeasonDatabase(fresh);
  return fresh;
}

function computeSeasonSeriesStandings(seasonDb: SeasonDatabase): SeriesStandingsBundle[] {
  const settings = ensureClubSettings(seasonDb);
  return calculateSeriesStandings(
    Object.values(seasonDb.eventsMap).map((event) => ({
      competition: {
        ...event.competition,
        status: resolveEffectiveCompetitionStatus(event),
      },
      classes: event.classes,
      competitors: event.competitors,
    })),
    settings.seriesScoringSettings
  );
}

function listAllRentalCards(seasonDb: SeasonDatabase): RentalCardOverviewItem[] {
  const items: RentalCardOverviewItem[] = [];
  for (const ev of Object.values(seasonDb.eventsMap)) {
    for (const cmp of ev.competitors) {
      if (!cmp.isRentalCard) continue;
      const clsName = ev.classes.find((c) => c.id === cmp.classId)?.name ?? '—';
      items.push({
        eventId: ev.competition.id,
        eventName: ev.competition.name,
        eventDate: ev.competition.date,
        shortCode: ev.competition.shortCode,
        competitorId: cmp.id,
        bib: cmp.bib,
        fullName: cmp.fullName,
        club: cmp.club,
        className: clsName,
        siNumber: cmp.siNumber,
        cardSeries: cmp.cardSeries,
        rentalReturned: Boolean(cmp.rentalReturned),
        feePaid: Boolean(cmp.feePaid),
        feeTrackingEnabled: Boolean(ev.competition.feeTrackingEnabled),
        status: cmp.status,
      });
    }
  }
  return items.sort((a, b) => {
    if (a.rentalReturned !== b.rentalReturned) {
      return a.rentalReturned ? 1 : -1;
    }
    return b.eventDate.localeCompare(a.eventDate);
  });
}

function resolveEffectiveCompetitionStatus(
  ev: SingleEventRecord,
  now = new Date()
): EventLifecycleStatus {
  if (
    ev.competition.statusOverride &&
    (ev.competition.status === 'LIVE' ||
      ev.competition.status === 'UPCOMING' ||
      ev.competition.status === 'COMPLETED')
  ) {
    return ev.competition.status;
  }

  const todayIso = getStockholmDateIso(now);
  const nowSec = getStockholmClockSec(now);
  const eventDate = (ev.competition.date || todayIso).trim();

  const hasActiveInForest = ev.competitors.some(
    (c) =>
      c.status === 'CHECKED' ||
      c.status === 'IN_FOREST' ||
      c.status === 'PRELIMINARY_FIN'
  );
  const hasAnyStartedOrFinished = ev.competitors.some(
    (c) =>
      c.status === 'CHECKED' ||
      c.status === 'IN_FOREST' ||
      c.status === 'PRELIMINARY_FIN' ||
      c.status === 'OK' ||
      c.status === 'MP' ||
      c.status === 'DNF'
  );

  // Future date -> always UPCOMING (Kommande)
  if (eventDate > todayIso) {
    return 'UPCOMING';
  }

  // Past date -> COMPLETED (except Natt-OL right after midnight while runners are still in forest)
  if (eventDate < todayIso) {
    if (eventDate === offsetDateIso(-1) && nowSec < 4 * 3600 && hasActiveInForest) {
      return 'LIVE';
    }
    return 'COMPLETED';
  }

  // Today (eventDate === todayIso):
  // Respect explicit early close ("Avsluta tävling") if no runners remain in forest
  if (ev.competition.status === 'COMPLETED' && !hasActiveInForest) {
    return 'COMPLETED';
  }

  const zeroSec = Number.isFinite(ev.competition.zeroTimeSec)
    ? ev.competition.zeroTimeSec
    : parseClockStrToSec(ev.competition.zeroTimeStr) ?? 36000;

  // Before Nolltid (and before anyone has checked in / started) -> UPCOMING (Kommande)
  if (nowSec < zeroSec && !hasAnyStartedOrFinished) {
    return 'UPCOMING';
  }

  // Auto-complete 6 hours after Nolltid once race has had runners and nobody is left in forest
  if (hasAnyStartedOrFinished && !hasActiveInForest && nowSec >= zeroSec + 6 * 3600) {
    return 'COMPLETED';
  }

  return 'LIVE';
}

function buildCompetitionsSummaryList(seasonDb: SeasonDatabase): CompetitionSummary[] {
  const statusRank: Record<EventLifecycleStatus, number> = {
    LIVE: 0,
    UPCOMING: 1,
    COMPLETED: 2,
  };
  const now = new Date();
  return Object.values(seasonDb.eventsMap)
    .map((ev) => ({
      id: ev.competition.id,
      shortCode: ev.competition.shortCode,
      status: resolveEffectiveCompetitionStatus(ev, now),
      name: ev.competition.name,
      organizer: ev.competition.organizer,
      date: ev.competition.date,
      zeroTimeStr: ev.competition.zeroTimeStr,
      arenaInfo: ev.competition.arenaInfo || '',
      seriesName: ev.competition.seriesName || '',
      allowSelfRegistration: Boolean(ev.competition.allowSelfRegistration),
      competitorCount: ev.competitors.length,
      finishedCount: ev.competitors.filter(
        (c) => c.status === 'OK' || c.status === 'MP' || c.status === 'PRELIMINARY_FIN'
      ).length,
      classCount: ev.classes.length,
    }))
    .sort((a, b) => {
      if (statusRank[a.status] !== statusRank[b.status]) {
        return statusRank[a.status] - statusRank[b.status];
      }
      return b.date.localeCompare(a.date);
    });
}

function generateShortCode(existingCodes: Set<string>): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
  return `ev${Date.now().toString(36).slice(-4)}`;
}

/**
 * Greedy club-separation interleaver for Orienteering Start List Draws (Minutstart):
 * Avoids consecutive runners from the same club whenever mathematically possible.
 */
function shuffleWithClubSeparation(runners: Competitor[]): Competitor[] {
  const pool = [...runners];
  // Fisher-Yates shuffle first
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const result: Competitor[] = [];
  while (pool.length > 0) {
    const prevClub =
      result.length > 0 ? result[result.length - 1].club.trim().toLowerCase() : null;

    // Count remaining runners per club so largest clubs are placed proactively
    const clubCounts = new Map<string, number>();
    for (const r of pool) {
      const k = r.club.trim().toLowerCase();
      clubCounts.set(k, (clubCounts.get(k) ?? 0) + 1);
    }

    // Pick candidate from a different club than prevClub, preferring clubs with highest remaining count
    let bestIdx = -1;
    let bestCount = -1;
    for (let i = 0; i < pool.length; i++) {
      const cKey = pool[i].club.trim().toLowerCase();
      if (cKey !== prevClub) {
        const cnt = clubCounts.get(cKey) ?? 0;
        if (cnt > bestCount) {
          bestCount = cnt;
          bestIdx = i;
        }
      }
    }

    if (bestIdx === -1) bestIdx = 0;
    result.push(pool.splice(bestIdx, 1)[0]);
  }
  return result;
}

export const app = express();

async function startServer() {
  app.use(express.json({ limit: '5mb' }));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const disableHmr = process.env.DISABLE_HMR === 'true';
  const isVercel = Boolean(process.env.VERCEL);

  server.on('upgrade', (req, socket, head) => {
    const rawUrl = req.url || '';
    const qIndex = rawUrl.indexOf('?');
    const pathname = qIndex !== -1 ? rawUrl.slice(0, qIndex) : rawUrl;
    if (pathname === '/api/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (disableHmr || process.env.NODE_ENV === 'production') {
      socket.destroy();
    }
  });

  const serverBootedWithoutDbFile = !fs.existsSync(SEASON_DB_FILE);
  let isFreshColdStart = serverBootedWithoutDbFile;
  let seasonDb = loadSeasonDatabase();
  const authenticatedWsClients = new WeakSet<WebSocket>();

  function persistUserMutation(): void {
    isFreshColdStart = false;
    saveSeasonDatabase(seasonDb);
  }

  function buildEmptyPlaceholderEvent(): SingleEventRecord {
    const club = ensureClubSettings(seasonDb);
    return {
      competition: {
        id: '',
        shortCode: '',
        status: 'UPCOMING',
        name: 'Ingen tävling skapad ännu',
        organizer: club.clubName,
        date: getStockholmDateIso(),
        zeroTimeStr: '10:00:00',
        zeroTimeSec: 36000,
        arenaInfo: '',
        seriesName: '',

        feeTrackingEnabled: false,
      },
      courses: [],
      classes: [],
      stations: [],
      competitors: [],
      emergency: { brokenControls: [], controlTimeOffsets: {} },
      roc: buildDefaultRocStatus(''),
      events: [],
      processedClientIds: [],
    };
  }

  function getActiveEvent(): SingleEventRecord {
    const fromId = seasonDb.activeEventId
      ? seasonDb.eventsMap[seasonDb.activeEventId]
      : undefined;
    return fromId ?? Object.values(seasonDb.eventsMap)[0] ?? buildEmptyPlaceholderEvent();
  }

  function findEventByIdOrShortCode(key?: string): SingleEventRecord | null {
    if (Object.keys(seasonDb.eventsMap).length === 0) return null;
    if (!key) return getActiveEvent();
    if (seasonDb.eventsMap[key]) return seasonDb.eventsMap[key];
    const clean = key.trim().toLowerCase();
    return (
      Object.values(seasonDb.eventsMap).find(
        (e) =>
          e.competition.shortCode.toLowerCase() === clean ||
          e.competition.id.toLowerCase() === clean
      ) ?? null
    );
  }

  function getConnectedClientCount(): number {
    let count = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN && authenticatedWsClients.has(c)) count++;
    });
    return count;
  }

  function buildLiveEventorStatus(): EventorIntegrationStatus {
    return {
      ...seasonDb.eventor,
      baseUrl: seasonDb.eventor.baseUrl || DEFAULT_EVENTOR_BASE_URL,
    };
  }

  function buildFullStatePayload() {
    const isEmptySeason = Object.keys(seasonDb.eventsMap).length === 0;
    const ev = getActiveEvent();
    const effectiveCompetition: CompetitionMeta = isEmptySeason
      ? ev.competition
      : {
          ...ev.competition,
          status: resolveEffectiveCompetitionStatus(ev),
        };
    return {
      activeEventId: isEmptySeason ? '' : ev.competition.id,
      isEmptySeason,
      isFreshColdStart,
      demoCleared: Boolean(seasonDb.demoCleared),
      clubSettings: ensureClubSettings(seasonDb),
      seriesStandings: computeSeasonSeriesStandings(seasonDb),
      competitionsList: buildCompetitionsSummaryList(seasonDb),
      competition: effectiveCompetition,
      courses: ev.courses,
      classes: ev.classes,
      stations: ev.stations,
      competitors: ev.competitors,
      runnerDb: seasonDb.runnerDb,
      eventor: buildLiveEventorStatus(),
      emergency: ev.emergency,
      roc: {
        ...ev.roc,
        baseUrl: ev.roc.baseUrl || getRocDefaultBaseUrl(),
      },
      events: ev.events,
      connectedMonitors: getConnectedClientCount(),
    };
  }

  function buildPublicRacePayload(ev: SingleEventRecord) {
    const rawClub = ensureClubSettings(seasonDb);
    const feesEnabled = Boolean(ev.competition.feeTrackingEnabled);
    const publicClub: ClubSettings = feesEnabled
      ? rawClub
      : {
          ...rawClub,
          defaultDirectEntryFeeSek: 0,
          rentalCardFeeSek: 0,
          missingRentalFeeSek: 0,
        };
    return {
      competition: {
        ...ev.competition,
        status: resolveEffectiveCompetitionStatus(ev),
        feeTrackingEnabled: feesEnabled,
      },
      courses: ev.courses,
      classes: feesEnabled ? ev.classes : ev.classes.map((cls) => ({ ...cls, feeSek: 0 })),
      competitors: ev.competitors,
      radioControls: ev.stations
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
      events: ev.events.slice(0, 60),
      emergency: ev.emergency,
      competitionsList: buildCompetitionsSummaryList(seasonDb),
      clubSettings: publicClub,
      seriesStandings: computeSeasonSeriesStandings(seasonDb),
      updatedAt: new Date().toISOString(),
    };
  }

  function broadcastFullState(changedShortCode?: string) {
    const activePayload = buildFullStatePayload();
    const effectiveShortCode = changedShortCode ?? activePayload.competition.shortCode;
    const secretariatMsg = JSON.stringify({
      type: 'state:sync',
      payload: activePayload,
      changedShortCode: effectiveShortCode,
    });
    const publicMsg = JSON.stringify({
      type: 'public:ping',
      changedShortCode: effectiveShortCode,
    });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        if (authenticatedWsClients.has(client)) {
          client.send(secretariatMsg);
        } else {
          client.send(publicMsg);
        }
      }
    });
  }

  /**
   * Core Online/Radio Punch Processor (used by WebSerial 0xD3, Offline Queue Sync, AND ROC Poller!)
   */
  function processOnlinePunchForEvent(
    ev: SingleEventRecord,
    params: {
      clientPunchId?: string;
      siNumber: number;
      stationCode: number;
      punchTimeSec?: number;
      rawHex?: string;
      sourcePrefix?: string;
    }
  ): { deduplicated: boolean; eventItem: LiveEventItem | null; competitor: Competitor | null } {
    if (params.clientPunchId && ev.processedClientIds.includes(params.clientPunchId)) {
      const existingRunner =
        ev.competitors.find((c) => c.siNumber === params.siNumber) ?? null;
      return {
        deduplicated: true,
        eventItem: ev.events[0] ?? null,
        competitor: existingRunner,
      };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const rawSec =
      params.punchTimeSec !== undefined && Number.isFinite(params.punchTimeSec)
        ? params.punchTimeSec
        : getStockholmClockSec(now);

    const offsetDelta = Number(
      ev.emergency.controlTimeOffsets[String(params.stationCode)] || 0
    );
    const effectiveSec = (((rawSec + Math.round(offsetDelta)) % 86400) + 86400) % 86400;

    let station = ev.stations.find((s) => s.stationCode === params.stationCode);
    if (!station) {
      station = {
        id: `st-${params.stationCode}-${Date.now()}`,
        stationCode: params.stationCode,
        name:
          params.stationCode === 100
            ? 'Förvarning (100)'
            : `Radiokontroll (${params.stationCode})${
                params.sourcePrefix ? ` (${params.sourcePrefix})` : ''
              }`,
        hardwareModel: 'SRR-USB (Air+)',
        stationFunction: params.stationCode === 100 ? 'PREWARNING' : 'RADIO',
        baudRate: 38400,
        extendedProtocol: true,
        batteryMv: 3500,
        firmware: params.sourcePrefix || 'Auto',
        lastSeenAt: nowIso,
        active: true,
      };
      ev.stations.push(station);
    } else {
      station.lastSeenAt = nowIso;
    }

    const runner =
      ev.competitors.find(
        (c) =>
          c.siNumber === params.siNumber &&
          (c.status === 'IN_FOREST' ||
            c.status === 'CHECKED' ||
            c.status === 'REGISTERED' ||
            c.status === 'PRELIMINARY_FIN')
      ) ??
      ev.competitors.find((c) => c.siNumber === params.siNumber && c.status !== 'DNS') ??
      null;
    const dbMatch = !runner
      ? seasonDb.runnerDb.find((r) => r.siNumber === params.siNumber) ?? null
      : null;
    if (!runner && dbMatch && seasonDb.eventor.autoCreateFromRunnerDbOnReadout) {
      console.warn(
        `[READOUT_AUTOCREATE_MIGRATION] ${JSON.stringify({
          competitorId: null,
          siNumber: params.siNumber,
          assignmentResult: 'NOT_ATTEMPTED_ONLINE_PUNCH',
          transactionResult: 'NOT_APPLICABLE',
          source: params.sourcePrefix || 'ONLINE_PUNCH',
        })}`
      );
    }

    const clsName = runner
      ? ev.classes.find((c) => c.id === runner.classId)?.name ?? null
      : null;

    const srcBadge = params.sourcePrefix ? `[${params.sourcePrefix}] ` : '';
    let eventItem: LiveEventItem;

    if (!runner) {
      eventItem = {
        id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowIso,
        clock24h: secToClock(effectiveSec),
        eventType: 'UNKNOWN_CARD',
        siNumber: params.siNumber,
        competitorId: null,
        competitorName: dbMatch ? `${dbMatch.fullName} (Ej anmäld)` : null,
        club: dbMatch?.club ?? null,
        className: dbMatch?.defaultClassName ?? null,
        stationCode: station.stationCode,
        stationName: station.name,
        runningTimeSec: null,
        message: dbMatch
          ? `${srcBadge}Oanmäld bricka ${params.siNumber} vid ${station.name} — identifierad i Löpardatabas som ${dbMatch.fullName}`
          : `${srcBadge}Okänd SI-bricka ${params.siNumber} vid ${station.name}`,
        rawHex: params.rawHex,
      };
    } else {
      logCompetitorAssignmentBypass(
        'legacy station processing',
        'UPDATE',
        ev.competition.id,
        runner,
        'Station processing updates competitor state without validating SI assignment ownership.'
      );
      runner.lastSeenControl = station.stationCode;
      runner.lastSeenTimeSec = effectiveSec;

      if (station.stationFunction === 'CHECK') {
        runner.checkTimeSec = effectiveSec;
        if (runner.status === 'REGISTERED' || runner.status === 'DNS') {
          runner.status = 'CHECKED';
        }
        eventItem = {
          id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: nowIso,
          clock24h: secToClock(effectiveSec),
          eventType: 'CHECK',
          siNumber: params.siNumber,
          competitorId: runner.id,
          competitorName: runner.fullName,
          club: runner.club,
          className: clsName,
          stationCode: station.stationCode,
          stationName: station.name,
          runningTimeSec: null,
          message: `${srcBadge}Checkad i startfålla (${secToClock(effectiveSec)})`,
          rawHex: params.rawHex,
        };
      } else if (station.stationFunction === 'START') {
        runner.startTimeSec = effectiveSec;
        if (
          runner.status === 'REGISTERED' ||
          runner.status === 'CHECKED' ||
          runner.status === 'DNS'
        ) {
          runner.status = 'IN_FOREST';
        }
        eventItem = {
          id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: nowIso,
          clock24h: secToClock(effectiveSec),
          eventType: 'START',
          siNumber: params.siNumber,
          competitorId: runner.id,
          competitorName: runner.fullName,
          club: runner.club,
          className: clsName,
          stationCode: station.stationCode,
          stationName: station.name,
          runningTimeSec: 0,
          message: `${srcBadge}Startstämpling registrerad kl. ${secToClock(effectiveSec)} — ute i skogen`,
          rawHex: params.rawHex,
        };
      } else if (station.stationFunction === 'FINISH') {
        const startRef =
          runner.startTimeSec ?? runner.allocatedStartSec ?? ev.competition.zeroTimeSec;
        const runSec = effectiveSec >= startRef ? effectiveSec - startRef : null;
        runner.finishTimeSec = effectiveSec;
        runner.runningTimeSec = runSec;
        if (runner.status !== 'OK' && runner.status !== 'MP') {
          runner.status = 'PRELIMINARY_FIN';
        }
        eventItem = {
          id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: nowIso,
          clock24h: secToClock(effectiveSec),
          eventType: 'FINISH',
          siNumber: params.siNumber,
          competitorId: runner.id,
          competitorName: runner.fullName,
          club: runner.club,
          className: clsName,
          stationCode: station.stationCode,
          stationName: station.name,
          runningTimeSec: runSec,
          message: `${srcBadge}Preliminär målgång i ${clsName ?? '-'} på ${
            runSec !== null ? durToMmSs(runSec) : secToClock(effectiveSec)
          } (inväntar brickavläsning)`,
          rawHex: params.rawHex,
        };
      } else {
        if (runner.status === 'REGISTERED' || runner.status === 'CHECKED') {
          runner.status = 'IN_FOREST';
        }
        const startRef =
          runner.startTimeSec ?? runner.allocatedStartSec ?? ev.competition.zeroTimeSec;
        const runSec = effectiveSec >= startRef ? effectiveSec - startRef : null;
        const isPre =
          station.stationFunction === 'PREWARNING' || station.stationCode === 100;

        const splitEntry: RadioSplit = {
          controlCode: station.stationCode,
          stationName: station.name,
          punchTimeSec: effectiveSec,
          runningTimeSec: runSec,
          isPrewarning: isPre,
        };
        runner.radioSplits = [
          ...runner.radioSplits.filter((r) => r.controlCode !== station!.stationCode),
          splitEntry,
        ].sort((a, b) => a.punchTimeSec - b.punchTimeSec);

        eventItem = {
          id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: nowIso,
          clock24h: secToClock(effectiveSec),
          eventType: isPre ? 'PREWARNING' : 'RADIO',
          siNumber: params.siNumber,
          competitorId: runner.id,
          competitorName: runner.fullName,
          club: runner.club,
          className: clsName,
          stationCode: station.stationCode,
          stationName: station.name,
          runningTimeSec: runSec,
          message: isPre
            ? `${srcBadge}Förvarning (${station.stationCode}) på ${
                runSec !== null ? durToMmSs(runSec) : secToClock(effectiveSec)
              } — på upploppet!`
            : `${srcBadge}Mellantid (${station.stationCode}): ${
                runSec !== null ? durToMmSs(runSec) : secToClock(effectiveSec)
              }`,
          rawHex: params.rawHex,
        };
      }
    }

    if (params.clientPunchId) {
      ev.processedClientIds.unshift(params.clientPunchId);
      ev.processedClientIds = ev.processedClientIds.slice(0, 1000);
    }

    ev.events.unshift(eventItem);
    ev.events = ev.events.slice(0, 250);

    return { deduplicated: false, eventItem, competitor: runner };
  }

  /**
   * Parses semicolon ROC lines (`punchId;controlCode;siNumber;YYYY-MM-DD HH:MM:SS` or `HH:MM:SS`)
   */
  function ingestRocTextPayload(ev: SingleEventRecord, rawText: string): number {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('<'));

    let ingested = 0;
    for (const line of lines) {
      const parts = line.split(';').map((s) => s.trim());
      if (parts.length < 4) continue;
      const punchId = Number(parts[0]);
      const controlCode = Number(parts[1]);
      const siNumber = Number(parts[2].replace(/\D/g, ''));
      const timePart = parts[3].split(/\s+/).pop() || '';
      const timeSec = parseClockStrToSec(timePart);

      if (!Number.isFinite(controlCode) || !Number.isFinite(siNumber) || siNumber <= 0) {
        continue;
      }
      if (Number.isFinite(punchId) && punchId > 0 && punchId <= ev.roc.lastPunchId) {
        continue;
      }

      processOnlinePunchForEvent(ev, {
        clientPunchId: Number.isFinite(punchId) && punchId > 0 ? `roc-${ev.roc.unitId}-${punchId}` : undefined,
        siNumber,
        stationCode: controlCode,
        punchTimeSec: timeSec ?? undefined,
        sourcePrefix: 'ROC',
      });

      if (Number.isFinite(punchId) && punchId > ev.roc.lastPunchId) {
        ev.roc.lastPunchId = punchId;
      }
      ev.roc.totalReceived += 1;
      ingested += 1;
    }
    return ingested;
  }

  async function pollRocOnce(ev: SingleEventRecord): Promise<{ ingested: number; error: string | null }> {
    const unitId = ev.roc.unitId.trim();
    if (!unitId) {
      return { ingested: 0, error: 'Ange ROC Enhets-ID först.' };
    }
    const base = (ev.roc.baseUrl || getRocDefaultBaseUrl()).trim();
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}unitId=${encodeURIComponent(unitId)}&lastId=${ev.roc.lastPunchId}`;

    try {
      const resp = await fetch(url, {
        headers: { Accept: 'text/plain, */*' },
      });
      ev.roc.lastPolledAt = new Date().toISOString();
      if (!resp.ok) {
        const errMsg = `ROC svarade med HTTP ${resp.status}.`;
        ev.roc.lastError = errMsg;
        return { ingested: 0, error: errMsg };
      }
      const bodyText = await resp.text();
      const ingested = ingestRocTextPayload(ev, bodyText);
      ev.roc.lastError = null;
      if (ingested > 0) {
        saveSeasonDatabase(seasonDb);
        broadcastFullState(ev.competition.shortCode);
      }
      return { ingested, error: null };
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : 'Kunde inte nå ROC-tjänsten.';
      ev.roc.lastPolledAt = new Date().toISOString();
      ev.roc.lastError = errMsg;
      return { ingested: 0, error: errMsg };
    }
  }

  // Background ROC Poller + Automatic Nolltid Status Transition Broadcaster
  let lastRocTickMs = 0;
  let lastLifecycleSig = '';
  setInterval(() => {
    const now = new Date();
    const nextSig = Object.values(seasonDb.eventsMap)
      .map((e) => `${e.competition.id}:${resolveEffectiveCompetitionStatus(e, now)}`)
      .join('|');
    if (lastLifecycleSig && nextSig !== lastLifecycleSig) {
      lastLifecycleSig = nextSig;
      broadcastFullState();
    } else if (!lastLifecycleSig) {
      lastLifecycleSig = nextSig;
    }

    const ev = getActiveEvent();
    if (!ev.roc.enabled || !ev.roc.unitId.trim()) return;
    const intervalMs = Math.max(3, ev.roc.pollIntervalSec || 5) * 1000;
    const nowMs = Date.now();
    if (nowMs - lastRocTickMs < intervalMs) return;
    lastRocTickMs = nowMs;
    void pollRocOnce(ev);
  }, 1500);

  // ==========================================================================
  // PUBLIC SPECTATOR, QR SELF-REGISTRATION & LIVELOX IOF XML 3.0 ROUTES
  // ==========================================================================
  app.get('/api/public/competitions', (_req, res) => {
    res.json(buildCompetitionsSummaryList(seasonDb));
  });

  app.get('/api/public/season', (_req, res) => {
    res.json({
      competitions: buildCompetitionsSummaryList(seasonDb),
      clubSettings: ensureClubSettings(seasonDb),
      seriesStandings: computeSeasonSeriesStandings(seasonDb),
    });
  });

  app.get('/api/public/events/:shortCode', (req, res) => {
    const ev = findEventByIdOrShortCode(req.params.shortCode);
    if (!ev) {
      res.status(404).json({ error: 'Tävlingen hittades inte.' });
      return;
    }
    res.json(buildPublicRacePayload(ev));
  });

  app.get('/api/public/events/:shortCode/iof-results', (req, res) => {
    const ev = findEventByIdOrShortCode(req.params.shortCode);
    if (!ev) {
      res.status(404).send('Event not found');
      return;
    }
    const xml = buildServerIofResultListXml(ev);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  });

  app.get('/api/public/events/:shortCode/iof-startlist', (req, res) => {
    const ev = findEventByIdOrShortCode(req.params.shortCode);
    if (!ev) {
      res.status(404).send('Event not found');
      return;
    }
    const xml = buildServerIofStartListXml(ev);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  });

  // ==========================================================================
  // AUTHENTICATION, ROLE-BASED ACCESS CONTROL
  // ==========================================================================
  app.get('/api/auth/public-info', (_req, res) => {
    const summaries = buildCompetitionsSummaryList(seasonDb);
    const competitions = summaries.map((s) => {
      return {
        id: s.id,
        shortCode: s.shortCode,
        name: s.name,
        organizer: s.organizer,
        date: s.date,
        status: s.status,
      };
    });

    const clubCfg = ensureClubSettings(seasonDb);
    res.json({
      competitions,
      activeEventId: seasonDb.activeEventId,
      firebaseProjectId: FIREBASE_PROJECT_ID,
      clubSettings: {
        clubName: clubCfg.clubName,
        portalTitle: clubCfg.portalTitle || '',
        logoDataUrl: clubCfg.logoDataUrl || '',
        customBgColor: clubCfg.customBgColor || '',
        customTextColor: clubCfg.customTextColor || '',
        customAccentColor: clubCfg.customAccentColor || '',
      },
    });
  });

  app.post('/api/auth/login-google', (_req, res) => {
    res.status(410).json({
      error: 'Google-inloggning hanteras direkt av Firebase Auth-klienten.',
    });
  });

  async function resolveSessionUserFromToken(
    rawToken: string | undefined | null
  ): Promise<AuthSessionUser | null> {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
    if (!token) return null;

    if (token.split('.').length === 3) {
      try {
        const verified = await verifyFirebaseIdToken(token);
        const [adminRole, assignedOfficialRole] = await Promise.all([
          readFirestoreRole(token, 'admins', verified.uid),
          readFirestoreRole(token, 'roleAssignments', verified.uid),
        ]);
        if (adminRole === 'SUPER_ADMIN' || adminRole === 'RACE_ADMIN') {
          return {
            sessionKind: 'ADMIN',
            uid: verified.uid,
            displayName: verified.name,
            email: verified.email,
            adminTier: adminRole,
            officialRole: 'ALL',
            lockedEventId: null,
            lockedEventName: null,
            authMethod: 'GOOGLE',
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(verified.expiresAt * 1000).toISOString(),
          };
        }
        if (
          assignedOfficialRole === 'START' ||
          assignedOfficialRole === 'READOUT' ||
          assignedOfficialRole === 'FOREST' ||
          assignedOfficialRole === 'SPEAKER'
        ) {
          return {
            sessionKind: 'OFFICIAL',
            uid: verified.uid,
            displayName: verified.name,
            email: verified.email,
            adminTier: null,
            officialRole: assignedOfficialRole,
            lockedEventId: null,
            lockedEventName: null,
            authMethod: 'GOOGLE',
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(verified.expiresAt * 1000).toISOString(),
          };
        }
      } catch (error) {
        console.warn(
          'Firebase-tokenverifiering misslyckades:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return null;
  }

  async function getRequestSessionUser(req: express.Request): Promise<AuthSessionUser | null> {
    const headerToken = req.header('x-passersi-token') || req.header('authorization');
    return resolveSessionUserFromToken(headerToken);
  }

  function isOfficialWriteAllowed(
    sessionUser: AuthSessionUser,
    method: string,
    route: string
  ): boolean {
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    if (sessionUser.sessionKind === 'ADMIN') return true;
    const role = sessionUser.officialRole;
    const permissions: Array<{ method: string; path: RegExp; roles: OfficialRole[] }> = [
      { method: 'POST', path: /^\/online-punch$/, roles: ['START', 'READOUT', 'FOREST'] },
      { method: 'POST', path: /^\/readout$/, roles: ['READOUT', 'FOREST', 'SPEAKER'] },
      {
        method: 'POST',
        path: /^\/firestore\/competitions\/[^/]+\/readouts\/[^/]+\/auto-create$/,
        roles: ['READOUT', 'FOREST', 'SPEAKER'],
      },
      { method: 'POST', path: /^\/draw\/class$/, roles: ['START'] },
      { method: 'POST', path: /^\/competitors$/, roles: ['START', 'READOUT'] },
      { method: 'PUT', path: /^\/competitors\/[^/]+$/, roles: ['START', 'READOUT', 'FOREST'] },
      { method: 'PUT', path: /^\/emergency(?:\/.*)?$/, roles: ['FOREST', 'READOUT'] },
      { method: 'POST', path: /^\/emergency\/(?:recalculate-all|manual-finish)$/, roles: ['FOREST', 'READOUT'] },
      { method: 'PUT', path: /^\/club\/rentals\/[^/]+\/[^/]+\/return$/, roles: ['READOUT'] },
    ];
    return permissions.some(
      (permission) =>
        permission.method === method &&
        permission.path.test(route) &&
        permission.roles.includes(role as OfficialRole)
    );
  }

  // Gate all non-public `/api/*` Secretariat endpoints
  app.use('/api', (req, res, next) => {
    if (
      req.path.startsWith('/public/') ||
      req.path === '/auth/public-info' ||
      req.path === '/auth/login-google'
    ) {
      next();
      return;
    }
    void getRequestSessionUser(req)
      .then((sessionUser) => {
        if (!sessionUser) {
          res.status(401).json({ error: 'Inloggning krävs för sekretariatet.' });
          return;
        }
        if (!isOfficialWriteAllowed(sessionUser, req.method, req.path)) {
          res.status(403).json({
            error: 'Din tilldelade funktionärsroll saknar behörighet för den här åtgärden.',
          });
          return;
        }
        (req as express.Request & { authUser?: AuthSessionUser }).authUser = sessionUser;
        next();
      })
      .catch((error: unknown) => {
        console.error('Kunde inte kontrollera API-behörighet:', error);
        res.status(503).json({ error: 'Kunde inte verifiera inloggningen just nu.' });
      });
  });

  wss.on('connection', (ws, req) => {
    const rawUrl = req.url || '';
    const qIndex = rawUrl.indexOf('?');
    const search = qIndex !== -1 ? rawUrl.slice(qIndex) : '';
    const params = new URLSearchParams(search);
    const token = params.get('token');
    void resolveSessionUserFromToken(token)
      .then((sessionUser) => {

        if (sessionUser) {
          authenticatedWsClients.add(ws);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'state:sync', payload: buildFullStatePayload() }));
          }
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'public:ping',
            changedShortCode: getActiveEvent().competition.shortCode,
          }));
        }
      })
      .catch((error: unknown) => {
        console.error('Kunde inte verifiera WebSocket-inloggning:', error);
        if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Authentication failed');
      });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as { type?: string };
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore
      }
    });
  });

  function requireAdminRequest(req: express.Request, res: express.Response): AuthSessionUser | null {
    const sessionUser = (req as express.Request & { authUser?: AuthSessionUser }).authUser;
    if (
      !sessionUser ||
      sessionUser.sessionKind !== 'ADMIN' ||
      (sessionUser.adminTier !== 'SUPER_ADMIN' && sessionUser.adminTier !== 'RACE_ADMIN')
    ) {
      res.status(403).json({
        error: 'Denna åtgärd kräver inloggning som Tävlingsledare / Klubbadmin.',
      });
      return null;
    }
    return sessionUser;
  }

  const firestoreOwnedCompetitorFields = new Set([
    'bib',
    'fullName',
    'club',
    'classId',
    'siNumber',
    'cardSeries',
    'isRentalCard',
    'isBorrowedCard',
    'rentalReturned',
    'feePaid',
    'status',
    'allocatedStartSec',
    'checkTimeSec',
    'startTimeSec',
    'finishTimeSec',
    'manualFinishTimeSec',
    'runningTimeSec',
    'lastSeenControl',
    'lastSeenTimeSec',
    'readoutAt',
    'radioSplits',
    'cardPunches',
    'rawReadout',
    'validation',
  ]);

  function logLegacyCompetitorFieldWrite(
    source: string,
    competitorId: string,
    fields: string[]
  ): void {
    if (fields.length === 0) return;
    console.warn(
      `[single-writer] Legacy Express ${source} wrote Firestore-owned competitor fields for ${competitorId}: ${fields.join(', ')}`
    );
  }

  function logCompetitorAssignmentBypass(
    source: string,
    operation: Parameters<typeof declareCompetitorMutation>[0]['operation'],
    competitionId: string,
    competitor: Competitor,
    detail: string,
    previousSiNumber?: number
  ): void {
    declareCompetitorMutation({
      source,
      operation,
      competitionId,
      competitorId: competitor.id,
      siNumber: Number(competitor.siNumber),
      ...(previousSiNumber !== undefined ? { previousSiNumber } : {}),
      assignmentHandling: { mode: 'LEGACY', reason: detail },
      identityAffecting:
        operation === 'CREATE' ||
        operation === 'DELETE' ||
        operation === 'IMPORT' ||
        operation === 'RESTORE' ||
        operation === 'SNAPSHOT_HYDRATE' ||
        operation === 'SNAPSHOT_SEED' ||
        (operation === 'UPDATE' &&
          previousSiNumber !== undefined &&
          previousSiNumber !== Number(competitor.siNumber)),
    });
  }

  function requireEventorAdminRequest(
    req: express.Request,
    res: express.Response
  ): AuthSessionUser | null {
    const user = requireAdminRequest(req, res);
    if (!user) return null;
    if (user.adminTier !== 'SUPER_ADMIN' && user.adminTier !== 'RACE_ADMIN') {
      res.status(403).json({ error: 'Endast SUPER_ADMIN och RACE_ADMIN får hantera Eventor.' });
      return null;
    }
    return user;
  }

  app.get('/api/auth/me', (req, res) => {
    const sessionUser = (req as express.Request & { authUser?: AuthSessionUser }).authUser;
    res.json({ user: sessionUser });
  });

  app.get('/api/auth/manage', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const authCfg = ensureSeasonAuthConfig(seasonDb);

    res.json({
      admins: authCfg.admins,
      clubSettings: ensureClubSettings(seasonDb),
      demoCleared: Boolean(seasonDb.demoCleared),
    });
  });

  app.post('/api/auth/admins', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const body = req.body as {
      email?: string;
      displayName?: string;
      role?: ClubAdminTier;
    };
    const normEmail = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(normEmail)) {
      res.status(400).json({ error: 'Ange en giltig Google e-postadress.' });
      return;
    }

    const authCfg = ensureSeasonAuthConfig(seasonDb);
    const existing = authCfg.admins.find((a) => a.email.toLowerCase() === normEmail);
    const cleanName = (body.displayName || '').trim() || normEmail.split('@')[0];

    if (existing) {
      if (!existing.isBootstrapOwner) {
        existing.displayName = cleanName;
        if (body.role === 'SUPER_ADMIN' || body.role === 'RACE_ADMIN') {
          existing.role = body.role;
        }
      }
    } else {
      authCfg.admins.push({
        email: normEmail,
        displayName: cleanName,
        role: body.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'RACE_ADMIN',
        addedAt: new Date().toISOString(),
      });
    }

    persistUserMutation();
    res.status(201).json({ admins: authCfg.admins });
  });

  app.put('/api/auth/admins/:email', (req, res) => {
    const requester = requireAdminRequest(req, res);
    if (!requester) return;
    const targetEmail = decodeURIComponent(req.params.email || '')
      .trim()
      .toLowerCase();
    const authCfg = ensureSeasonAuthConfig(seasonDb);
    const existing = authCfg.admins.find((a) => a.email.toLowerCase() === targetEmail);
    if (!existing) {
      res.status(404).json({ error: 'Administratörskontot hittades inte.' });
      return;
    }
    if (existing.isBootstrapOwner || isBootstrapAdminEmail(targetEmail)) {
      res.status(400).json({ error: 'Grundkontots behörighetsnivå är permanent låst till Huvudadministratör.' });
      return;
    }

    const body = req.body as { displayName?: string; role?: ClubAdminTier };
    if (body.displayName !== undefined && body.displayName.trim()) {
      existing.displayName = body.displayName.trim().slice(0, 100);
    }
    if (body.role === 'SUPER_ADMIN' || body.role === 'RACE_ADMIN') {
      if (body.role === 'SUPER_ADMIN' && requester.adminTier !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'Endast Huvudadministratör kan utse nya Huvudadministratörer.',
        });
        return;
      }
      existing.role = body.role;
    }

    persistUserMutation();
    res.json({ admins: authCfg.admins });
  });

  app.delete('/api/auth/admins/:email', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const targetEmail = decodeURIComponent(req.params.email || '')
      .trim()
      .toLowerCase();
    if (isBootstrapAdminEmail(targetEmail)) {
      res.status(400).json({
        error: 'Huvudadministratören kan inte tas bort.',
      });
      return;
    }

    const authCfg = ensureSeasonAuthConfig(seasonDb);
    authCfg.admins = authCfg.admins.filter(
      (a) => a.email.toLowerCase() !== targetEmail || a.isBootstrapOwner
    );
    persistUserMutation();
    res.json({ admins: authCfg.admins });
  });

  // ==========================================================================
  // CLUB SETTINGS, SWISH, RENTAL CARDS & CLOUD PERSISTENCE ROUTES
  // ==========================================================================
  app.get('/api/club-settings', (_req, res) => {
    res.json(ensureClubSettings(seasonDb));
  });

  app.put('/api/club-settings', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const current = ensureClubSettings(seasonDb);
    const body = req.body as Partial<ClubSettings>;

    if (body.logoDataUrl !== undefined && body.logoDataUrl.trim().length > 0) {
      const cleanedLogo = sanitizeServerLogoDataUrl(body.logoDataUrl);
      if (!cleanedLogo) {
        res.status(400).json({
          error:
            'Klubbloggan måste vara en giltig JPG- eller PNG-bild och får inte vara för stor.',
        });
        return;
      }
    }

    seasonDb.clubSettings = {
      clubName:
        body.clubName !== undefined
          ? body.clubName.trim().slice(0, 100) || current.clubName
          : current.clubName,
      eventorOrgId:
        body.eventorOrgId !== undefined
          ? body.eventorOrgId.trim().slice(0, 32)
          : current.eventorOrgId,
      defaultDirectEntryFeeSek:
        body.defaultDirectEntryFeeSek !== undefined
          ? Math.max(0, Math.min(10000, Math.round(Number(body.defaultDirectEntryFeeSek) || 0)))
          : current.defaultDirectEntryFeeSek,
      rentalCardFeeSek:
        body.rentalCardFeeSek !== undefined
          ? Math.max(0, Math.min(5000, Math.round(Number(body.rentalCardFeeSek) || 0)))
          : current.rentalCardFeeSek,
      missingRentalFeeSek:
        body.missingRentalFeeSek !== undefined
          ? Math.max(0, Math.min(20000, Math.round(Number(body.missingRentalFeeSek) || 0)))
          : current.missingRentalFeeSek,
      portalTitle:
        body.portalTitle !== undefined
          ? body.portalTitle.trim().slice(0, 80)
          : current.portalTitle || '',
      logoDataUrl:
        body.logoDataUrl !== undefined
          ? sanitizeServerLogoDataUrl(body.logoDataUrl)
          : current.logoDataUrl || '',
      customBgColor:
        body.customBgColor !== undefined
          ? sanitizeServerHexColor(body.customBgColor)
          : current.customBgColor || '',
      customTextColor:
        body.customTextColor !== undefined
          ? sanitizeServerHexColor(body.customTextColor)
          : current.customTextColor || '',
      customAccentColor:
        body.customAccentColor !== undefined
          ? sanitizeServerHexColor(body.customAccentColor)
          : current.customAccentColor || '',
      seriesScoringSettings:
        body.seriesScoringSettings !== undefined
          ? normalizeSeriesScoringSettings(body.seriesScoringSettings)
          : current.seriesScoringSettings || {},
    };
    persistUserMutation();
    broadcastFullState();
    res.json(seasonDb.clubSettings);
  });

  app.get('/api/club/rentals', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    res.json({ rentals: listAllRentalCards(seasonDb) });
  });

  app.post('/api/club/rentals/:eventId/:competitorId/return', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const ev = seasonDb.eventsMap[req.params.eventId];
    if (!ev) {
      res.status(404).json({ error: 'Tävlingen hittades inte.' });
      return;
    }
    const cmp = ev.competitors.find((c) => c.id === req.params.competitorId);
    if (!cmp) {
      res.status(404).json({ error: 'Deltagaren hittades inte.' });
      return;
    }
    const body = req.body as { rentalReturned?: boolean; feePaid?: boolean };
    logLegacyCompetitorFieldWrite('rental return mirror', cmp.id, [
      'rentalReturned',
      ...(body.feePaid !== undefined ? ['feePaid'] : []),
    ]);
    cmp.rentalReturned = body.rentalReturned !== undefined ? Boolean(body.rentalReturned) : true;
    if (body.feePaid !== undefined) {
      cmp.feePaid = Boolean(body.feePaid);
    }
    persistUserMutation();
    broadcastFullState(ev.competition.shortCode);
    res.json({ rentals: listAllRentalCards(seasonDb) });
  });

  app.get('/api/system/cloud-export', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const clubSettings = ensureClubSettings(seasonDb);
    for (const event of Object.values(seasonDb.eventsMap)) {
      if (event.competitors.length > 0) {
        declareCompetitorMutation({
          source: '/api/system/cloud-export',
          operation: 'SNAPSHOT_EXPORT',
          competitionId: event.competition.id,
          assignmentHandling: {
            mode: 'LEGACY',
            reason: 'Exported competitors do not carry SI assignment records or validation.',
          },
          identityAffecting: false,
        });
      }
    }
    const events: CloudEventExportItem[] = Object.values(seasonDb.eventsMap).map((ev) => ({
      competition: {
        id: ev.competition.id,
        shortCode: ev.competition.shortCode,
        status: resolveEffectiveCompetitionStatus(ev),
        statusOverride: Boolean(ev.competition.statusOverride),
        name: ev.competition.name,
        organizer: ev.competition.organizer,
        date: ev.competition.date,
        zeroTimeStr: ev.competition.zeroTimeStr,
        zeroTimeSec: ev.competition.zeroTimeSec,
        arenaInfo: ev.competition.arenaInfo || '',
        seriesName: ev.competition.seriesName || '',
        feeTrackingEnabled: Boolean(ev.competition.feeTrackingEnabled),
      },
      courses: ev.courses,
      classes: ev.classes,
      competitors: ev.competitors,
      stations: ev.stations,
      brokenControls: ev.emergency?.brokenControls ?? [],
      emergency: ev.emergency,
    }));

    const snapshot: CloudSeasonSnapshot = {
      activeEventId: seasonDb.activeEventId || '',
      demoCleared: Boolean(seasonDb.demoCleared),
      clubSettings,
      events,
    };
    res.json(snapshot);
  });

  app.post('/api/system/cloud-hydrate', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const snap = req.body as Partial<CloudSeasonSnapshot> | null;
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.events)) {
      res.status(400).json({ error: 'Ogiltig molnsnapshot från Firestore.' });
      return;
    }

    const nowIso = new Date().toISOString();
    if (snap.clubSettings && typeof snap.clubSettings === 'object') {
      seasonDb.clubSettings = snap.clubSettings;
      ensureClubSettings(seasonDb);
    }
    seasonDb.demoCleared = Boolean(snap.demoCleared);

    const nextMap: Record<string, SingleEventRecord> = {};
    const hydrationMutations: CompetitorMutationDeclaration[] = [];
    for (const item of snap.events) {
      if (!item?.competition?.id) continue;
      const existingLocal = seasonDb.eventsMap[item.competition.id];
      const zeroStr = item.competition.zeroTimeStr || '10:00:00';
      const zeroSec =
        Number.isFinite(Number(item.competition.zeroTimeSec))
          ? Number(item.competition.zeroTimeSec)
          : parseClockStrToSec(zeroStr) ?? 36000;

      const evRec: SingleEventRecord = {
        competition: {
          id: item.competition.id,
          shortCode: item.competition.shortCode || 'oko26',
          status: item.competition.status || 'LIVE',
          statusOverride: Boolean(item.competition.statusOverride),
          name: item.competition.name || 'Tävling',
          organizer:
            item.competition.organizer ??
            existingLocal?.competition.organizer ??
            ensureClubSettings(seasonDb).clubName,
          date: item.competition.date || getStockholmDateIso(),
          zeroTimeStr: zeroStr,
          zeroTimeSec: zeroSec,
          arenaInfo: item.competition.arenaInfo || '',
          seriesName: item.competition.seriesName || '',
          allowSelfRegistration: Boolean(item.competition.allowSelfRegistration),
          feeTrackingEnabled: Boolean(
            item.competition.feeTrackingEnabled ??
              (item.competition as typeof item.competition & {
                enableFeesAndSwish?: boolean;
              }).enableFeesAndSwish
          ),
        },
        courses: Array.isArray(item.courses) ? item.courses : [],
        classes: Array.isArray(item.classes) ? item.classes : [],
        stations: Array.isArray(item.stations)
          ? item.stations
          : existingLocal?.stations ?? buildDefaultStations(nowIso),
        competitors: [],
        emergency: {
          brokenControls: Array.isArray(item.emergency?.brokenControls)
            ? item.emergency.brokenControls
                .map(Number)
                .filter((n) => Number.isFinite(n) && n > 0)
            : Array.isArray(item.brokenControls)
              ? item.brokenControls.map(Number).filter((n) => Number.isFinite(n) && n > 0)
              : [],
          controlTimeOffsets:
            item.emergency?.controlTimeOffsets ??
            existingLocal?.emergency?.controlTimeOffsets ??
            {},
        },
        roc: existingLocal?.roc ?? buildDefaultRocStatus('1042'),
        events: existingLocal?.events ?? [],
        processedClientIds: existingLocal?.processedClientIds ?? [],
      };
      const protectedHydration = protectCloudHydratedCompetitors(
        existingLocal?.competitors ?? [],
        Array.isArray(item.competitors) ? item.competitors : []
      );
      evRec.competitors = protectedHydration.competitors;
      if (protectedHydration.blockedChanges.length > 0) {
        console.warn(
          `[single-writer] Blocked cloud-hydrate competitor identity changes: ${JSON.stringify({
            competitionId: evRec.competition.id,
            blockedChanges: protectedHydration.blockedChanges,
            assignmentStatePreserved: true,
          })}`
        );
        for (const change of protectedHydration.blockedChanges) {
          const current = existingLocal?.competitors.find(
            (competitor) => competitor.id === change.competitorId
          );
          const incoming = item.competitors?.find(
            (competitor) => competitor.id === change.competitorId
          );
          hydrationMutations.push({
            source: '/api/system/cloud-hydrate',
            operation:
              change.operation === 'REMOVE'
                ? 'DELETE'
                : change.operation === 'ADD'
                  ? 'SNAPSHOT_HYDRATE'
                  : 'UPDATE',
            competitionId: evRec.competition.id,
            competitorId: change.competitorId,
            siNumber: current?.siNumber ?? incoming?.siNumber,
            ...(current ? { previousSiNumber: current.siNumber } : {}),
            assignmentHandling: {
              mode: 'LEGACY',
              reason: `Cloud hydrate attempted blocked ${change.operation.toLowerCase()} of Firestore-owned competitor identity fields: ${change.fields.join(', ')}.`,
            },
            identityAffecting: true,
          });
        }
      }
      const preservedStatuses = new Map(
        evRec.competitors.map((competitor) => [competitor.id, competitor.status])
      );
      recalculateEventFromRawReadouts(evRec);
      for (const competitor of evRec.competitors) {
        const preservedStatus = preservedStatuses.get(competitor.id);
        if (preservedStatus !== undefined) competitor.status = preservedStatus;
      }
      recomputeAllSplitRanks(evRec);
      nextMap[evRec.competition.id] = evRec;
    }

    for (const existingEvent of Object.values(seasonDb.eventsMap)) {
      const hydratedEvent = nextMap[existingEvent.competition.id];
      if (!hydratedEvent) {
        nextMap[existingEvent.competition.id] = existingEvent;
        console.warn(
          `[single-writer] Blocked cloud-hydrate competition omission: ${JSON.stringify({
            competitionId: existingEvent.competition.id,
            preservedCompetitorCount: existingEvent.competitors.length,
            assignmentStatePreserved: true,
          })}`
        );
        for (const competitor of existingEvent.competitors) {
          hydrationMutations.push({
            source: '/api/system/cloud-hydrate',
            operation: 'DELETE',
            competitionId: existingEvent.competition.id,
            competitorId: competitor.id,
            siNumber: competitor.siNumber,
            assignmentHandling: {
              mode: 'LEGACY',
              reason: 'Cloud hydrate attempted to remove a competition containing Firestore-owned competitor identities.',
            },
            identityAffecting: true,
          });
        }
      }
    }

    runCompetitorMutations(hydrationMutations, () => {
      seasonDb.eventsMap = nextMap;
    });
    const keys = Object.keys(nextMap);
    if (keys.length === 0) {
      seasonDb.activeEventId = '';
    } else if (snap.activeEventId && nextMap[snap.activeEventId]) {
      seasonDb.activeEventId = snap.activeEventId;
    } else {
      seasonDb.activeEventId = keys[0];
    }

    persistUserMutation();
    broadcastFullState();
    res.json(buildFullStatePayload());
  });

  app.post('/api/system/clear-demo', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    res.status(410).json({
      error:
        'Rensning av tävlingar är tillfälligt avstängd tills SI-tilldelningar kan hanteras atomiskt.',
    });
  });

  // ==========================================================================
  // MULTI-EVENT SEASON MANAGEMENT ROUTES
  // ==========================================================================
  app.get('/api/competitions', (_req, res) => {
    res.json({
      activeEventId: seasonDb.activeEventId,
      competitions: buildCompetitionsSummaryList(seasonDb),
    });
  });

  app.post('/api/competitions', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const body = req.body as {
      name?: string;
      organizer?: string;
      date?: string;
      zeroTimeStr?: string;
      status?: EventLifecycleStatus;
      arenaInfo?: string;
      seriesName?: string;
      feeTrackingEnabled?: boolean;
      copyCoursesFromActive?: boolean;
      importedCourses?: {
        name: string;
        lengthMeters: number;
        climbMeters: number;
        controls: number[];
      }[];
      importedClasses?: {
        name: string;
        courseName?: string;
        classFormat?: ClassCompetitionFormat;
        forkCourseNames?: string[];
        freeStart?: boolean;
        autoMatchCourse?: boolean;
      }[];
    };

    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Ange namn på tävlingen eller träningen.' });
      return;
    }

    const clubCfg = ensureClubSettings(seasonDb);
    const existingCodes = new Set(
      Object.values(seasonDb.eventsMap).map((e) => e.competition.shortCode)
    );
    const shortCode = generateShortCode(existingCodes);
    const newId = `evt-${Date.now()}`;
    const rawZeroStr = body.zeroTimeStr?.trim() || '18:00:00';
    const zeroSec = parseClockStrToSec(rawZeroStr) ?? 18 * 3600;
    const zeroStr = secToClock(zeroSec);
    const nowIso = new Date().toISOString();

    const sanitizedImportedCourses: Course[] = Array.isArray(body.importedCourses)
      ? body.importedCourses
          .map((c, idx) => {
            const controls = (Array.isArray(c.controls) ? c.controls : [])
              .map((n) => Math.round(Number(n)))
              .filter((n) => Number.isFinite(n) && n >= 1 && n <= 511)
              .slice(0, 128);
            return {
              id: `crs-${Date.now()}-${idx + 1}`,
              name: String(c.name || '').trim().slice(0, 120) || `Bana ${idx + 1}`,
              lengthMeters: Math.max(0, Math.min(200000, Math.round(Number(c.lengthMeters) || 0))),
              climbMeters: Math.max(0, Math.min(20000, Math.round(Number(c.climbMeters) || 0))),
              controls,
            };
          })
          .filter((c) => c.controls.length > 0)
      : [];

    const activeRef = getActiveEvent();
    const canCopyFromActive =
      sanitizedImportedCourses.length === 0 &&
      body.copyCoursesFromActive &&
      activeRef.courses.length > 0;
    const courseIdMap = new Map<string, string>();

    const courses: Course[] =
      sanitizedImportedCourses.length > 0
        ? sanitizedImportedCourses
        : canCopyFromActive
        ? activeRef.courses.map((c, idx) => {
            const clonedId = `crs-${Date.now()}-${idx + 1}`;
            courseIdMap.set(c.id, clonedId);
            return {
              ...c,
              id: clonedId,
              controls: [...c.controls],
            };
          })
        : [
            {
              id: `crs-${Date.now()}-1`,
              name: 'Bana A — Lång (5,0 km)',
              lengthMeters: 5000,
              climbMeters: 120,
              controls: [31, 42, 55, 100],
            },
            {
              id: `crs-${Date.now()}-2`,
              name: 'Bana B — Kort / Öppen (2,8 km)',
              lengthMeters: 2800,
              climbMeters: 60,
              controls: [32, 42, 100],
            },
          ];

    let classes: CompClass[];
    if (sanitizedImportedCourses.length > 0) {
      const rawImpClasses = Array.isArray(body.importedClasses)
        ? body.importedClasses.filter((cl) => String(cl.name || '').trim().length > 0)
        : [];
      if (rawImpClasses.length > 0) {
        classes = rawImpClasses.map((cl, idx) => {
          const forkCourseIds = (Array.isArray(cl.forkCourseNames) ? cl.forkCourseNames : [])
            .map((fn) => courses.find((cr) => cr.name.toLowerCase() === fn.toLowerCase())?.id)
            .filter((id): id is string => Boolean(id))
            .slice(0, 32);
          const linkedCourse = cl.courseName
            ? courses.find((cr) => cr.name.toLowerCase() === cl.courseName!.toLowerCase())
            : undefined;
          const isForked = cl.classFormat === 'FORKED' && forkCourseIds.length > 0;
          const freeStart = cl.freeStart ?? true;
          return {
            id: `cls-${Date.now()}-${idx + 1}`,
            name: String(cl.name).trim().slice(0, 80),
            courseId: isForked
              ? forkCourseIds[0] ?? linkedCourse?.id ?? courses[0]?.id ?? null
              : linkedCourse?.id ?? courses[0]?.id ?? null,
            classFormat: isForked ? 'FORKED' : 'STANDARD',
            forkCourseIds: isForked ? forkCourseIds : [],
            allowDirectEntry: true,
            freeStart,
            autoMatchCourse: isForked ? true : Boolean(cl.autoMatchCourse ?? freeStart),
            feeSek: clubCfg.defaultDirectEntryFeeSek,
          };
        });
      } else {
        classes = courses.map((cr, idx) => ({
          id: `cls-${Date.now()}-${idx + 1}`,
          name: cr.name.slice(0, 80),
          courseId: cr.id,
          classFormat: 'STANDARD',
          forkCourseIds: [],
          allowDirectEntry: true,
          freeStart: true,
          autoMatchCourse: true,
          feeSek: clubCfg.defaultDirectEntryFeeSek,
        }));
      }
    } else if (canCopyFromActive && activeRef.classes.length > 0) {
      classes = activeRef.classes.map((cls, idx) => ({
        ...cls,
        id: `cls-${Date.now()}-${idx + 1}`,
        courseId: cls.courseId ? courseIdMap.get(cls.courseId) ?? courses[0]?.id ?? null : null,
        forkCourseIds: cls.forkCourseIds
          ? cls.forkCourseIds
              .map((fid) => courseIdMap.get(fid))
              .filter((fid): fid is string => Boolean(fid))
          : undefined,
      }));
    } else {
      classes = [
        {
          id: `cls-${Date.now()}-1`,
          name: 'Långa',
          courseId: courses[0]?.id ?? null,
          allowDirectEntry: true,
          freeStart: false,
          autoMatchCourse: false,
          feeSek: clubCfg.defaultDirectEntryFeeSek,
        },
        {
          id: `cls-${Date.now()}-2`,
          name: 'Öppen Motion',
          courseId: courses[1]?.id ?? courses[0]?.id ?? null,
          allowDirectEntry: true,
          freeStart: true,
          autoMatchCourse: true,
          feeSek: clubCfg.defaultDirectEntryFeeSek,
        },
      ];
    }

    const createdRecord: SingleEventRecord = {
      competition: {
        id: newId,
        shortCode,
        status: 'LIVE',
        name: body.name.trim(),
        organizer: body.organizer?.trim() || clubCfg.clubName || 'OK Österåker',
        date: body.date?.trim() || getStockholmDateIso(),
        zeroTimeStr: zeroStr,
        zeroTimeSec: zeroSec,
        arenaInfo: body.arenaInfo?.trim() || '',
        seriesName: body.seriesName?.trim() || '',
        feeTrackingEnabled: Boolean(body.feeTrackingEnabled),
      },
      courses,
      classes,
      stations: buildDefaultStations(nowIso),
      competitors: [],
      emergency: { brokenControls: [], controlTimeOffsets: {} },
      roc: buildDefaultRocStatus('1045'),
      events: [],
      processedClientIds: [],
    };
    createdRecord.competition.status = resolveEffectiveCompetitionStatus(createdRecord);

    seasonDb.eventsMap[newId] = createdRecord;
    seasonDb.activeEventId = newId;
    seasonDb.demoCleared = false;
    persistUserMutation();
    broadcastFullState(shortCode);
    res.status(201).json(buildFullStatePayload());
  });

  app.post('/api/competitions/:id/mirror', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const body = req.body as {
      competition?: CompetitionMeta;
      courses?: Course[];
      classes?: CompClass[];
    };
    const competitionId = req.params.id;
    const competition = body.competition;
    if (
      !competition ||
      competition.id !== competitionId ||
      !competition.name?.trim() ||
      !competition.organizer?.trim() ||
      !competition.date?.trim() ||
      !competition.shortCode?.trim() ||
      !Array.isArray(body.courses) ||
      !Array.isArray(body.classes)
    ) {
      res.status(400).json({ error: 'Ogiltiga tävlingsdata för kompatibilitetsspegling.' });
      return;
    }
    if (seasonDb.eventsMap[competitionId]) {
      res.status(409).json({ error: 'Tävlingen finns redan i Express-spegeln.' });
      return;
    }
    const status =
      competition.status === 'LIVE' ||
      competition.status === 'UPCOMING' ||
      competition.status === 'COMPLETED'
        ? competition.status
        : 'UPCOMING';
    const record: SingleEventRecord = {
      competition: {
        ...competition,
        id: competitionId,
        status,
        zeroTimeStr: competition.zeroTimeStr || '18:00:00',
        zeroTimeSec: Number.isFinite(competition.zeroTimeSec)
          ? competition.zeroTimeSec
          : parseClockStrToSec(competition.zeroTimeStr || '18:00:00') ?? 64800,
        arenaInfo: competition.arenaInfo || '',
        seriesName: competition.seriesName || '',
        feeTrackingEnabled: Boolean(competition.feeTrackingEnabled),
      },
      courses: body.courses,
      classes: body.classes,
      stations: buildDefaultStations(new Date().toISOString()),
      competitors: [],
      emergency: { brokenControls: [], controlTimeOffsets: {} },
      roc: buildDefaultRocStatus('1046'),
      events: [],
      processedClientIds: [],
    };
    seasonDb.eventsMap[competitionId] = record;
    seasonDb.activeEventId = competitionId;
    seasonDb.demoCleared = false;
    persistUserMutation();
    broadcastFullState(record.competition.shortCode);
    res.status(201).json(buildFullStatePayload());
  });

  app.put('/api/competitions/:id', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const target = seasonDb.eventsMap[req.params.id];
    if (!target) {
      res.status(404).json({ error: 'Tävlingen hittades inte.' });
      return;
    }
    const body = req.body as Partial<CompetitionMeta>;
    if (
      body.status !== undefined &&
      body.status !== 'LIVE' &&
      body.status !== 'UPCOMING' &&
      body.status !== 'COMPLETED'
    ) {
      res.status(400).json({ error: 'Ogiltig tävlingsstatus.' });
      return;
    }
    if (body.name !== undefined && body.name.trim()) {
      target.competition.name = body.name.trim();
    }
    if (body.organizer !== undefined) {
      target.competition.organizer = body.organizer.trim().slice(0, 100);
    }
    if (body.date !== undefined && body.date.trim()) {
      target.competition.date = body.date.trim();
    }
    if (body.zeroTimeStr !== undefined && body.zeroTimeStr.trim()) {
      const parsed = parseClockStrToSec(body.zeroTimeStr);
      if (parsed !== null) {
        target.competition.zeroTimeSec = parsed;
        target.competition.zeroTimeStr = secToClock(parsed);
      } else {
        target.competition.zeroTimeStr = body.zeroTimeStr.trim();
      }
    }
    if (body.status !== undefined) {
      target.competition.status = body.status;
      target.competition.statusOverride = true;
    } else if (
      !target.competition.statusOverride &&
      (body.date !== undefined || body.zeroTimeStr !== undefined)
    ) {
      target.competition.status = 'LIVE';
      target.competition.status = resolveEffectiveCompetitionStatus(target);
    }
    if (body.arenaInfo !== undefined) {
      target.competition.arenaInfo = body.arenaInfo.trim();
    }
    if (body.seriesName !== undefined) {
      target.competition.seriesName = body.seriesName.trim();
    }
    if (body.feeTrackingEnabled !== undefined) {
      target.competition.feeTrackingEnabled = Boolean(body.feeTrackingEnabled);
    }
    persistUserMutation();
    broadcastFullState(target.competition.shortCode);
    res.json(buildFullStatePayload());
  });

  app.post('/api/competitions/:id/duplicate', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const src = seasonDb.eventsMap[req.params.id];
    if (!src) {
      res.status(404).json({ error: 'Källtävlingen hittades inte.' });
      return;
    }
    const body = (req.body || {}) as {
      name?: string;
      date?: string;
      status?: EventLifecycleStatus;
    };
    const existingCodes = new Set(
      Object.values(seasonDb.eventsMap).map((e) => e.competition.shortCode)
    );
    const shortCode = generateShortCode(existingCodes);
    const newId = `evt-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const courseIdMap = new Map<string, string>();
    const clonedCourses: Course[] = src.courses.map((c, idx) => {
      const nextId = `crs-${Date.now()}-${idx + 1}`;
      courseIdMap.set(c.id, nextId);
      return {
        ...c,
        id: nextId,
        controls: [...c.controls],
      };
    });

    const clonedClasses: CompClass[] = src.classes.map((cls, idx) => ({
      ...cls,
      id: `cls-${Date.now()}-${idx + 1}`,
      courseId: cls.courseId ? courseIdMap.get(cls.courseId) ?? null : null,
      forkCourseIds: cls.forkCourseIds
        ? cls.forkCourseIds
            .map((fid) => courseIdMap.get(fid))
            .filter((fid): fid is string => Boolean(fid))
        : undefined,
    }));

    const duplicated: SingleEventRecord = {
      competition: {
        id: newId,
        shortCode,
        status: body.status ?? 'UPCOMING',
        name: body.name?.trim() || `${src.competition.name} (Kopia)`,
        organizer: src.competition.organizer,
        date: body.date?.trim() || getStockholmDateIso(),
        zeroTimeStr: src.competition.zeroTimeStr,
        zeroTimeSec: src.competition.zeroTimeSec,
        arenaInfo: src.competition.arenaInfo || '',
        seriesName: src.competition.seriesName || '',
        feeTrackingEnabled: Boolean(src.competition.feeTrackingEnabled),
      },
      courses: clonedCourses,
      classes: clonedClasses,
      stations: buildDefaultStations(nowIso),
      competitors: [],
      emergency: { brokenControls: [], controlTimeOffsets: {} },
      roc: buildDefaultRocStatus('1046'),
      events: [],
      processedClientIds: [],
    };

    seasonDb.eventsMap[newId] = duplicated;
    seasonDb.activeEventId = newId;
    seasonDb.demoCleared = false;
    persistUserMutation();
    broadcastFullState(shortCode);
    res.status(201).json(buildFullStatePayload());
  });

  app.post('/api/competitions/:id/activate', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const target = findEventByIdOrShortCode(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Tävlingen hittades inte.' });
      return;
    }
    seasonDb.activeEventId = target.competition.id;
    persistUserMutation();
    broadcastFullState(target.competition.shortCode);
    res.json(buildFullStatePayload());
  });

  app.delete('/api/competitions/:id', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    res.status(410).json({
      error:
        'Radering av tävlingar är tillfälligt avstängd tills SI-tilldelningar kan hanteras atomiskt.',
    });
  });

  // ==========================================================================
  // SECRETARIAT API ROUTES (Active Competition)
  // ==========================================================================
  app.get('/api/state', (_req, res) => {
    res.json(buildFullStatePayload());
  });

  app.get('/api/mop/xml', (_req, res) => {
    const db = getActiveEvent();
    const clsXml = db.classes
      .map((c, idx) => `  <cls id="${idx + 1}" ord="${(idx + 1) * 10}">${escapeXml(c.name)}</cls>`)
      .join('\n');

    const cmpXml = db.competitors
      .map((r) => {
        const clsIdx = Math.max(1, db.classes.findIndex((c) => c.id === r.classId) + 1);
        const stat =
          r.status === 'OK'
            ? 1
            : r.status === 'MP'
            ? 3
            : r.status === 'DNF'
            ? 4
            : r.status === 'DNS'
            ? 20
            : 0;
        const rt = r.runningTimeSec ? r.runningTimeSec * 10 : 0;
        return `  <cmp id="${r.bib}" card="${r.siNumber}"><base org="1" cls="${clsIdx}" stat="${stat}" st="${
          (r.startTimeSec ?? r.allocatedStartSec ?? 0) * 10
        }" rt="${rt}"${
          r.status === 'PRELIMINARY_FIN' ? ' prel="true"' : ''
        }>${escapeXml(r.fullName)}</base></cmp>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<MOPComplete xmlns="http://www.melin.nu/mop">\n  <competition date="${escapeXml(
      db.competition.date
    )}" organizer="${escapeXml(db.competition.organizer)}">${escapeXml(
      db.competition.name
    )}</competition>\n${clsXml}\n${cmpXml}\n</MOPComplete>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  });

  // 1. Handle 0xD3 Online Punch (with Offline Queue idempotency)
  app.post('/api/online-punch', (req, res) => {
    const {
      eventId,
      clientPunchId,
      siNumber,
      stationCode,
      punchTimeSec,
      rawHex,
    } = req.body as {
      eventId?: string;
      clientPunchId?: string;
      siNumber?: number;
      stationCode?: number;
      punchTimeSec?: number;
      rawHex?: string;
    };

    const ev = findEventByIdOrShortCode(eventId) ?? getActiveEvent();
    const parsedSi = Number(siNumber);
    const parsedCn = Number(stationCode || 42);
    if (!Number.isFinite(parsedSi) || parsedSi <= 0) {
      res.status(400).json({ error: 'Ogiltigt SI-nummer' });
      return;
    }

    const result = processOnlinePunchForEvent(ev, {
      clientPunchId,
      siNumber: parsedSi,
      stationCode: parsedCn,
      punchTimeSec,
      rawHex,
    });

    if (!result.deduplicated) {
      saveSeasonDatabase(seasonDb);
      broadcastFullState(ev.competition.shortCode);
    }

    res.status(201).json({ event: result.eventItem, competitor: result.competitor });
  });

  // 2. Handle Full SI-Card Memory Readout (0xEF / 0xE1 / 0xB1 + Offline Queue idempotency + Raw Archive)
  app.post('/api/readout', (req, res) => {
    const {
      eventId,
      clientReadoutId,
      siNumber,
      stationCode = 1,
      checkTimeSec,
      startTimeSec,
      finishTimeSec,
      punches = [],
      rawHex,
    } = req.body as {
      eventId?: string;
      clientReadoutId?: string;
      siNumber?: number;
      stationCode?: number;
      checkTimeSec?: number | null;
      startTimeSec?: number | null;
      finishTimeSec?: number | null;
      punches?: CardPunch[];
      rawHex?: string;
    };

    const db = findEventByIdOrShortCode(eventId) ?? getActiveEvent();
    const parsedSi = Number(siNumber);
    if (!Number.isFinite(parsedSi) || parsedSi <= 0) {
      res.status(400).json({ error: 'Ogiltigt SI-nummer vid utläsning.' });
      return;
    }

    // Idempotency check for offlineReadoutQueue retries
    if (clientReadoutId && db.processedClientIds.includes(clientReadoutId)) {
      const existing = db.competitors.find((c) => c.siNumber === parsedSi) ?? null;
      res.status(200).json({
        competitor: existing,
        event: db.events[0] ?? null,
        deduplicated: true,
      });
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const nowSec = getStockholmClockSec(now);

    const station = db.stations.find((s) => s.stationCode === stationCode) ?? db.stations[0];
    if (station) station.lastSeenAt = nowIso;

    // Prefer active/un-read-out competitor first (supports borrowed sticks when original owner is DNS or already finished)
    const runner =
      db.competitors.find(
        (c) =>
          c.siNumber === parsedSi &&
          (c.status === 'IN_FOREST' ||
            c.status === 'CHECKED' ||
            c.status === 'REGISTERED' ||
            c.status === 'PRELIMINARY_FIN')
      ) ??
      db.competitors.find((c) => c.siNumber === parsedSi && c.status !== 'DNS') ??
      null;
    const dbMatch = !runner
      ? seasonDb.runnerDb.find((r) => r.siNumber === parsedSi) ?? null
      : null;
    if (!runner && dbMatch && seasonDb.eventor.autoCreateFromRunnerDbOnReadout) {
      console.warn(
        `[READOUT_AUTOCREATE_MIGRATION] ${JSON.stringify({
          competitorId: null,
          siNumber: parsedSi,
          assignmentResult: 'NOT_ATTEMPTED_LEGACY_ENDPOINT',
          transactionResult: 'NOT_APPLICABLE',
          endpoint: '/api/readout',
        })}`
      );
    }

    if (clientReadoutId) {
      db.processedClientIds.unshift(clientReadoutId);
      db.processedClientIds = db.processedClientIds.slice(0, 1000);
    }

    if (!runner) {
      const unknownEv: LiveEventItem = {
        id: `ev-${Date.now()}`,
        timestamp: nowIso,
        clock24h: secToClock(finishTimeSec ?? nowSec),
        eventType: 'UNKNOWN_CARD',
        siNumber: parsedSi,
        competitorId: null,
        competitorName: dbMatch ? `${dbMatch.fullName} (Löpardatabas)` : null,
        club: dbMatch?.club ?? null,
        className: dbMatch?.defaultClassName ?? null,
        stationCode: station?.stationCode ?? 1,
        stationName: station?.name ?? 'Målavläsning',
        runningTimeSec: null,
        message: dbMatch
          ? `Utläst oanmäld SI-bricka ${parsedSi} — hittad i Löpardatabas (${dbMatch.fullName}, ${dbMatch.club}). Klicka Direktanmäl!`
          : `Utläst oregistrerad SI-bricka ${parsedSi} (${punches.length} stämplingar) — knyt till deltagare!`,
        rawHex,
      };
      db.events.unshift(unknownEv);
      saveSeasonDatabase(seasonDb);
      broadcastFullState(db.competition.shortCode);
      res.status(201).json({
        competitor: null,
        event: unknownEv,
        unknownCardReadout: req.body,
        suggestedRunner: dbMatch,
      });
      return;
    }

    const cls = db.classes.find((c) => c.id === runner.classId);
    logCompetitorAssignmentBypass(
      'legacy readout processing',
      'UPDATE',
      db.competition.id,
      runner,
      'Readout processing updates competitor results without validating SI assignment ownership.'
    );
    // If runner used BSM8 Pinnstart (runner.startTimeSec already recorded) and the card holds a stale start time > first control punch, ignore stale card start
    const cardStartIsStale =
      typeof startTimeSec === 'number' &&
      punches.length > 0 &&
      startTimeSec > punches[0].timeSec &&
      runner.startTimeSec !== null &&
      runner.startTimeSec <= punches[0].timeSec;
    const usableCardStart = cardStartIsStale ? null : (startTimeSec ?? null);

    const effectiveStart =
      usableCardStart ??
      runner.startTimeSec ??
      runner.allocatedStartSec ??
      db.competition.zeroTimeSec;
    const effectiveFinish =
      runner.manualFinishTimeSec ?? finishTimeSec ?? runner.finishTimeSec ?? nowSec;

    // Archive unmodified raw readout permanently (preserving effectiveFinish when BSM8 acts as Finish without a separate Finish box)
    runner.rawReadout = {
      checkTimeSec: checkTimeSec ?? null,
      startTimeSec: usableCardStart ?? null,
      finishTimeSec: finishTimeSec ?? effectiveFinish,
      punches: punches.map((p) => ({ ...p })),
      rawHex,
      receivedAt: nowIso,
      clientReadoutId,
    };

    runner.checkTimeSec = checkTimeSec ?? runner.checkTimeSec;
    runner.startTimeSec = usableCardStart ?? runner.startTimeSec;
    runner.finishTimeSec = effectiveFinish;
    runner.cardPunches = applyEmergencyTimeOffsets(
      punches,
      db.emergency.controlTimeOffsets
    );
    runner.readoutAt = nowIso;
    runner.lastSeenControl = 1;
    runner.lastSeenTimeSec = effectiveFinish;
    runner.runningTimeSec =
      effectiveFinish >= effectiveStart ? effectiveFinish - effectiveStart : null;

    const validation = validateCompetitorReadout(
      cls,
      db.courses,
      effectiveStart,
      effectiveFinish,
      punches,
      db.emergency
    );
    runner.validation = validation;
    runner.status = validation.ok ? 'OK' : 'MP';

    recomputeAllSplitRanks(db);

    const ev: LiveEventItem = {
      id: `ev-${Date.now()}`,
      timestamp: nowIso,
      clock24h: secToClock(nowSec),
      eventType: validation.ok ? 'READOUT_OK' : 'READOUT_MP',
      siNumber: parsedSi,
      competitorId: runner.id,
      competitorName: runner.fullName,
      club: runner.club,
      className: cls?.name ?? null,
      stationCode: station?.stationCode ?? 1,
      stationName: station?.name ?? 'Målavläsning',
      runningTimeSec: runner.runningTimeSec,
      message: validation.ok
        ? cls?.classFormat === 'ROGAINING'
          ? `Utläst & Godkänd i ${cls.name}: ${validation.rogainingPoints ?? 0} poäng på ${
              runner.runningTimeSec !== null ? durToMmSs(runner.runningTimeSec) : '—'
            }${runner.isRentalCard && !runner.rentalReturned ? ' · OBS: HYRBRICKA!' : ''}`
          : `Utläst & Godkänd (OK) i ${cls?.name ?? '-'} (${runner.cardSeries}) på ${
              runner.runningTimeSec !== null ? durToMmSs(runner.runningTimeSec) : '—'
            }${runner.isRentalCard && !runner.rentalReturned ? ' · OBS: HYRBRICKA!' : ''}`
        : `Felstämplat (MP) i ${cls?.name ?? '-'} — saknar kontroll: ${validation.missingControls
            .map((k) => `(${k})`)
            .join(', ')}`,
      rawHex,
    };

    db.events.unshift(ev);
    db.events = db.events.slice(0, 250);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);

    res.status(201).json({ competitor: runner, event: ev });
  });

  // 3. Emergency Forest Tools & Raw Readout Recalculation
  app.put('/api/emergency', (req, res) => {
    const db = getActiveEvent();
    const body = req.body as Partial<EmergencySettings>;

    if (Array.isArray(body.brokenControls)) {
      db.emergency.brokenControls = Array.from(
        new Set(body.brokenControls.map(Number).filter((n) => Number.isFinite(n) && n > 0))
      ).sort((a, b) => a - b);
    }

    if (body.controlTimeOffsets && typeof body.controlTimeOffsets === 'object') {
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(body.controlTimeOffsets)) {
        const num = Math.round(Number(v));
        if (Number.isFinite(num) && num !== 0) {
          cleaned[String(k)] = num;
        }
      }
      db.emergency.controlTimeOffsets = cleaned;
    }

    const recalculatedCount = recalculateEventFromRawReadouts(db);
    const now = new Date();
    const brokenLabel =
      db.emergency.brokenControls.length > 0
        ? `Trasiga kontroller undantagna: ${db.emergency.brokenControls
            .map((c) => `(${c})`)
            .join(', ')}`
        : 'Inga trasiga kontroller aktiva';

    db.events.unshift({
      id: `ev-${Date.now()}`,
      timestamp: now.toISOString(),
      clock24h: secToClock(getStockholmClockSec(now)),
      eventType: 'EMERGENCY',
      siNumber: 0,
      competitorId: null,
      competitorName: 'Tävlingsledning',
      club: db.competition.organizer,
      className: null,
      stationCode: 0,
      stationName: 'Nödlägen & Omräkning',
      runningTimeSec: null,
      message: `${brokenLabel} · Räknade om ${recalculatedCount} utlästa brickor från sparad rådata.`,
    });

    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json({ emergency: db.emergency, recalculatedCount });
  });

  app.post('/api/emergency/recalculate-all', (_req, res) => {
    const db = getActiveEvent();
    const recalculatedCount = recalculateEventFromRawReadouts(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json({ recalculatedCount });
  });

  app.post('/api/emergency/manual-finish', (req, res) => {
    const db = getActiveEvent();
    const { competitorId, finishClockStr } = req.body as {
      competitorId?: string;
      finishClockStr?: string;
    };

    const runner = db.competitors.find((c) => c.id === competitorId);
    if (!runner) {
      res.status(404).json({ error: 'Deltagare hittades ej.' });
      return;
    }

    const finSec = finishClockStr ? parseClockStrToSec(finishClockStr) : null;
    if (finSec === null) {
      res.status(400).json({ error: 'Ange giltigt klockslag i format HH:MM:SS.' });
      return;
    }

    logCompetitorAssignmentBypass(
      '/api/emergency/manual-finish',
      'UPDATE',
      db.competition.id,
      runner,
      'Manual-finish update does not validate SI assignment ownership.'
    );
    runner.manualFinishTimeSec = finSec;
    runner.finishTimeSec = finSec;
    const effStart =
      runner.startTimeSec ?? runner.allocatedStartSec ?? db.competition.zeroTimeSec;
    runner.runningTimeSec = finSec >= effStart ? finSec - effStart : null;

    if (runner.rawReadout || runner.cardPunches.length > 0) {
      recalculateEventFromRawReadouts(db);
    } else {
      runner.status = 'OK';
      recomputeAllSplitRanks(db);
    }

    const clsName = db.classes.find((c) => c.id === runner.classId)?.name ?? null;
    const now = new Date();
    db.events.unshift({
      id: `ev-${Date.now()}`,
      timestamp: now.toISOString(),
      clock24h: secToClock(finSec),
      eventType: 'EMERGENCY',
      siNumber: runner.siNumber,
      competitorId: runner.id,
      competitorName: runner.fullName,
      club: runner.club,
      className: clsName,
      stationCode: 90,
      stationName: 'Manuell tidtagning (Sekretariat)',
      runningTimeSec: runner.runningTimeSec,
      message: `Manuell måltid ${secToClock(finSec)} satt för ${runner.fullName} (löptid ${
        runner.runningTimeSec !== null ? durToMmSs(runner.runningTimeSec) : '—'
      })`,
    });

    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json(runner);
  });

  // 4. Start List Draw Engine (Lottning med minutstart, masstart, fri start, vakanser & klubbseparering)
  app.post('/api/draw/class', (req, res) => {
    const db = getActiveEvent();
    const {
      classId,
      mode = 'INTERVAL',
      firstStartClock = db.competition.zeroTimeStr,
      intervalSec = 120,
      vacancies = 0,
      clubSeparation = true,
      includeAlreadyStarted = false,
    } = req.body as {
      classId?: string;
      mode?: 'INTERVAL' | 'MASS' | 'FREE';
      firstStartClock?: string;
      intervalSec?: number;
      vacancies?: number;
      clubSeparation?: boolean;
      includeAlreadyStarted?: boolean;
    };

    const cls = db.classes.find((c) => c.id === classId);
    if (!cls) {
      res.status(404).json({ error: 'Klassen hittades ej.' });
      return;
    }

    const firstSec = parseClockStrToSec(firstStartClock) ?? db.competition.zeroTimeSec;
    const stepSec = Math.max(15, Number(intervalSec) || 120);
    const vacCount = Math.max(0, Math.min(20, Math.floor(Number(vacancies) || 0)));

    const eligible = db.competitors.filter((c) => {
      if (c.classId !== cls.id) return false;
      if (includeAlreadyStarted) return true;
      return c.status === 'REGISTERED' || c.status === 'DNS' || c.status === 'CHECKED';
    });

    const vacantStartTimes: string[] = [];

    if (mode === 'FREE') {
      cls.freeStart = true;
      for (const r of eligible) {
        r.allocatedStartSec = null;
      }
    } else if (mode === 'MASS') {
      cls.freeStart = false;
      for (const r of eligible) {
        r.allocatedStartSec = firstSec;
      }
    } else {
      cls.freeStart = false;
      const ordered = clubSeparation
        ? shuffleWithClubSeparation(eligible)
        : shuffleWithClubSeparation(eligible); // Note: if !clubSeparation, pure Fisher-Yates below

      let finalOrder = ordered;
      if (!clubSeparation) {
        finalOrder = [...eligible];
        for (let i = finalOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [finalOrder[i], finalOrder[j]] = [finalOrder[j], finalOrder[i]];
        }
      }

      // Reserve vacant start slots first (standard Swedish Eventor/MeOS convention for late entries)
      let cursorSec = firstSec;
      for (let v = 0; v < vacCount; v++) {
        vacantStartTimes.push(secToClock(cursorSec));
        cursorSec += stepSec;
      }

      for (const r of finalOrder) {
        r.allocatedStartSec = cursorSec;
        cursorSec += stepSec;
      }
    }

    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json({
      className: cls.name,
      drawnCount: eligible.length,
      mode,
      vacantStartTimes,
    });
  });

  // 5. ROC (roc.olresultat.se) Radio Controls Integration
  app.put('/api/roc/settings', (req, res) => {
    const db = getActiveEvent();
    const body = req.body as Partial<RocIntegrationStatus>;
    if (body.enabled !== undefined) db.roc.enabled = Boolean(body.enabled);
    if (body.unitId !== undefined) db.roc.unitId = String(body.unitId).trim();
    if (body.pollIntervalSec !== undefined) {
      db.roc.pollIntervalSec = Math.max(3, Math.min(60, Number(body.pollIntervalSec) || 5));
    }
    if (body.lastPunchId !== undefined) {
      db.roc.lastPunchId = Math.max(0, Number(body.lastPunchId) || 0);
    }
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json(db.roc);
  });

  app.post('/api/roc/poll-now', async (_req, res) => {
    const db = getActiveEvent();
    const out = await pollRocOnce(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json({
      ingested: out.ingested,
      error: out.error,
      roc: db.roc,
    });
  });

  app.post('/api/roc/simulate-batch', (_req, res) => {
    const db = getActiveEvent();
    const activeForestRunners = db.competitors.filter(
      (c) => c.status === 'IN_FOREST' || c.status === 'CHECKED'
    );
    const now = new Date();
    const nowSec = getStockholmClockSec(now);

    const sampleLines: string[] = [];
    let nextId = db.roc.lastPunchId + 1;

    if (activeForestRunners.length > 0) {
      for (const r of activeForestRunners.slice(0, 3)) {
        const refStart =
          r.startTimeSec ?? r.allocatedStartSec ?? db.competition.zeroTimeSec;
        const simCtrl = r.lastSeenControl === 42 ? 55 : r.lastSeenControl === 55 ? 100 : 42;
        const simSec = Math.max(nowSec, refStart + (simCtrl === 42 ? 730 : simCtrl === 55 ? 1140 : 1690));
        sampleLines.push(
          `${nextId++};${simCtrl};${r.siNumber};${db.competition.date} ${secToClock(simSec)}`
        );
      }
    } else {
      sampleLines.push(
        `${nextId++};42;8812405;${db.competition.date} ${secToClock(nowSec)}`
      );
    }

    const ingested = ingestRocTextPayload(db, sampleLines.join('\n'));
    db.roc.lastPolledAt = now.toISOString();
    db.roc.lastError = null;
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json({ ingested, samplePayload: sampleLines.join('\n'), roc: db.roc });
  });

  // 6. Competitors & Direct Entry CRUD
  const rejectLegacyCompetitorMutation = (
    req: express.Request,
    res: express.Response
  ) => {
    console.warn(`[legacy-competitor-route-disabled] ${req.method} ${req.path}`);
    res.status(410).json({
      code: 'LEGACY_COMPETITOR_ROUTE_DISABLED',
      error: 'Legacy competitor mutation routes are disabled. Use the Firestore-authoritative application.',
    });
  };

  app.post(
    '/api/firestore/competitions/:competitionId/readouts/:receiptId/auto-create',
    async (req, res) => {
      const sessionUser = (
        req as express.Request & { authUser?: AuthSessionUser }
      ).authUser;
      if (
        !sessionUser ||
        (sessionUser.sessionKind !== 'ADMIN' &&
          !['READOUT', 'FOREST', 'SPEAKER'].includes(sessionUser.officialRole))
      ) {
        res.status(403).json({ error: 'A readout official or club administrator is required.' });
        return;
      }
      if (!seasonDb.eventor.autoCreateFromRunnerDbOnReadout) {
        res.status(409).json({ error: 'READOUT auto-create is disabled.' });
        return;
      }

      try {
        const result = await createReadoutCompetitorFromRunnerDb(
          getTrustedFirestore(),
          { uid: sessionUser.uid },
          req.params.competitionId,
          req.params.receiptId,
          req.body
        );
        res.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        if (error instanceof ReadoutAutoCreateError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        console.error('Trusted readout auto-create failed:', error);
        res.status(500).json({ error: 'The readout competitor could not be created.' });
      }
    }
  );

  app.post(
    '/api/firestore/competitions/:competitionId/competitors/:competitorId/create',
    async (req, res) => {
      const sessionUser = (
        req as express.Request & { authUser?: AuthSessionUser }
      ).authUser;
      if (
        !sessionUser ||
        sessionUser.sessionKind !== 'ADMIN' ||
        (sessionUser.adminTier !== 'RACE_ADMIN' &&
          sessionUser.adminTier !== 'SUPER_ADMIN')
      ) {
        res.status(403).json({ error: 'A club administrator is required.' });
        return;
      }

      try {
        const result = await createCompetitorWithAssignment(
          getTrustedFirestore(),
          { uid: sessionUser.uid },
          req.params.competitionId,
          req.params.competitorId,
          req.body?.competitor,
          req.body?.runnerCandidate
        );
        res.status(201).json(result);
      } catch (error) {
        if (error instanceof CompetitorCreationError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        console.error('Trusted competitor creation failed:', error);
        res.status(500).json({ error: 'The competitor could not be created.' });
      }
    }
  );

  app.post(
    '/api/firestore/competitions/:competitionId/competitors/:competitorId/retire',
    async (req, res) => {
      const sessionUser = (
        req as express.Request & { authUser?: AuthSessionUser }
      ).authUser;
      if (
        !sessionUser ||
        sessionUser.sessionKind !== 'ADMIN' ||
        (sessionUser.adminTier !== 'RACE_ADMIN' &&
          sessionUser.adminTier !== 'SUPER_ADMIN')
      ) {
        res.status(403).json({ error: 'A club administrator is required.' });
        return;
      }

      try {
        await retireCompetitorWithAssignment(
          getTrustedFirestore(),
          { uid: sessionUser.uid },
          req.params.competitionId,
          req.params.competitorId,
          req.body?.retirementReason
        );
        res.status(204).end();
      } catch (error) {
        if (error instanceof SIAssignmentRetirementError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        console.error('Trusted SI assignment retirement failed:', error);
        res.status(500).json({ error: 'The competitor could not be retired.' });
      }
    }
  );

  app.post(
    '/api/firestore/competitions/:competitionId/delete',
    async (req, res) => {
      const sessionUser = (
        req as express.Request & { authUser?: AuthSessionUser }
      ).authUser;
      if (!sessionUser) {
        res.status(401).json({
          success: false,
          error: 'Authentication is required.',
        });
        return;
      }

      if (!isAdminInitialized) {
        res.status(500).json({
          success: false,
          error:
            'Firebase Admin SDK inte initierat. Kontrollera FIREBASE_SERVICE_ACCOUNT i Vercel.',
        });
        return;
      }

      try {
        const result = await deleteCompetitionWithAssignments(
          getTrustedFirestore(),
          { uid: sessionUser.uid },
          req.params.competitionId
        );

        let warning: string | undefined;
        if (
          seasonDb.eventsMap[req.params.competitionId] ||
          seasonDb.activeEventId === req.params.competitionId
        ) {
          delete seasonDb.eventsMap[req.params.competitionId];
          if (seasonDb.activeEventId === req.params.competitionId) {
            seasonDb.activeEventId = Object.keys(seasonDb.eventsMap)[0] ?? '';
          }
          try {
            persistUserMutation();
            broadcastFullState();
          } catch (error) {
            console.error('Competition deleted from Firestore but mirror sync failed:', error);
            warning =
              'Tävlingen raderades i Firestore, men den lokala kompatibilitetsspeglingen kunde inte uppdateras.';
          }
        }

        res.json({
          success: true,
          message: 'Tävling raderad',
          ...result,
          ...(warning ? { warning } : {}),
        });
      } catch (error) {
        if (error instanceof CompetitionDeletionError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message,
          });
          return;
        }
        console.error('Trusted competition deletion failed:', error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // Keep these terminal handlers before the legacy route bodies so they cannot fall through.
  app.post('/api/competitors', rejectLegacyCompetitorMutation);
  app.put('/api/competitors/:id', rejectLegacyCompetitorMutation);
  app.delete('/api/competitors/:id', rejectLegacyCompetitorMutation);

  app.post('/api/competitors', (req, res) => {
    const db = getActiveEvent();
    const body = req.body as Partial<Competitor> & {
      pendingReadout?: {
        checkTimeSec?: number | null;
        startTimeSec?: number | null;
        finishTimeSec?: number | null;
        punches?: CardPunch[];
      };
    };

    const siNumber = Number(body.siNumber);
    if (!Number.isFinite(siNumber) || siNumber <= 0 || !body.fullName?.trim()) {
      res.status(400).json({ error: 'Ange giltigt SI-bricknummer och löparens namn.' });
      return;
    }
    const requestedId =
      typeof body.id === 'string' && /^cmp_[A-Za-z0-9_-]{1,120}$/.test(body.id)
        ? body.id
        : null;
    if (body.id !== undefined && !requestedId) {
      res.status(400).json({ error: 'Ogiltigt deltagar-ID.' });
      return;
    }

    const existingMirror = requestedId
      ? db.competitors.find((competitor) => competitor.id === requestedId)
      : undefined;
    if (existingMirror) {
      if (
        existingMirror.siNumber !== siNumber ||
        existingMirror.fullName.trim() !== body.fullName.trim()
      ) {
        res.status(409).json({ error: 'Deltagar-ID används redan för en annan deltagare.' });
        return;
      }
      logCompetitorAssignmentBypass(
        '/api/competitors compatibility mirror',
        'UPDATE',
        db.competition.id,
        existingMirror,
        'Legacy Express mirror updates billing state without SI assignment validation.'
      );
      logLegacyCompetitorFieldWrite('direct-entry compatibility mirror', existingMirror.id, [
        'feePaid',
        'rentalReturned',
      ]);
      existingMirror.feePaid = Boolean(body.feePaid);
      existingMirror.rentalReturned = Boolean(body.rentalReturned);
      persistUserMutation();
      broadcastFullState(db.competition.shortCode);
      res.status(200).json(existingMirror);
      return;
    }

    const activeConflict = db.competitors.find(
      (c) =>
        c.siNumber === siNumber &&
        (c.status === 'REGISTERED' ||
          c.status === 'CHECKED' ||
          c.status === 'IN_FOREST' ||
          c.status === 'PRELIMINARY_FIN')
    );
    if (activeConflict) {
      res.status(409).json({
        error: `SI-bricka ${siNumber} används redan av en aktiv deltagare (#${activeConflict.bib} ${activeConflict.fullName}).`,
      });
      return;
    }

    const maxBib = db.competitors.reduce((m, c) => Math.max(m, c.bib), 400);
    const classId = body.classId || db.classes[0]?.id || 'cls-open';
    const cls = db.classes.find((c) => c.id === classId);

    const created: Competitor = {
      id: requestedId ?? `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bib: body.bib ?? maxBib + 1,
      fullName: body.fullName.trim(),
      club: body.club?.trim() || 'Klubblös',
      classId,
      siNumber,
      cardSeries: body.cardSeries ?? inferSeries(siNumber),
      isRentalCard: Boolean(body.isRentalCard),
      isBorrowedCard: Boolean(body.isBorrowedCard),
      rentalReturned: false,
      feePaid: Boolean(body.feePaid),
      status: body.status ?? 'REGISTERED',
      allocatedStartSec:
        body.allocatedStartSec !== undefined ? body.allocatedStartSec : null,
      checkTimeSec: body.checkTimeSec !== undefined ? body.checkTimeSec : null,
      startTimeSec: body.startTimeSec !== undefined ? body.startTimeSec : null,
      finishTimeSec: null,
      runningTimeSec: null,
      lastSeenControl:
        body.lastSeenControl !== undefined ? body.lastSeenControl : null,
      lastSeenTimeSec:
        body.lastSeenTimeSec !== undefined ? body.lastSeenTimeSec : null,
      readoutAt: null,
      radioSplits: [],
      cardPunches: [],
      validation: null,
    };
    if (body.pendingReadout && Array.isArray(body.pendingReadout.punches)) {
      const effStart =
        body.pendingReadout.startTimeSec ??
        created.allocatedStartSec ??
        db.competition.zeroTimeSec;
      const effFin = body.pendingReadout.finishTimeSec ?? null;
      const rawPunches = body.pendingReadout.punches;
      created.rawReadout = {
        checkTimeSec: body.pendingReadout.checkTimeSec ?? null,
        startTimeSec: body.pendingReadout.startTimeSec ?? null,
        finishTimeSec: effFin,
        punches: rawPunches.map((p) => ({ ...p })),
        receivedAt: new Date().toISOString(),
      };
      created.checkTimeSec = body.pendingReadout.checkTimeSec ?? null;
      created.startTimeSec = body.pendingReadout.startTimeSec ?? null;
      created.finishTimeSec = effFin;
      created.cardPunches = applyEmergencyTimeOffsets(
        rawPunches,
        db.emergency.controlTimeOffsets
      );
      created.readoutAt = new Date().toISOString();
      created.runningTimeSec =
        effFin !== null && effFin >= effStart ? effFin - effStart : null;
      created.validation = validateCompetitorReadout(
        cls,
        db.courses,
        effStart,
        effFin,
        rawPunches,
        db.emergency
      );
      created.status = created.validation.ok ? 'OK' : 'MP';
    }

    runCompetitorMutation(
      {
        source: '/api/competitors',
        operation: 'CREATE',
        competitionId: db.competition.id,
        competitorId: created.id,
        siNumber: created.siNumber,
        assignmentHandling: {
          mode: 'LEGACY',
          reason: 'Express competitor creation does not create an SI assignment.',
        },
        identityAffecting: true,
      },
      () => db.competitors.unshift(created)
    );
    if (!created.isRentalCard && !created.isBorrowedCard) {
      upsertRunnerInSeasonDb(seasonDb, {
        siNumber: created.siNumber,
        fullName: created.fullName,
        club: created.club,
        defaultClassName: cls?.name ?? null,
        source: 'LEARNED_ENTRY',
      });
    }
    recomputeAllSplitRanks(db);

    const now = new Date();
    const isDirectPinnstart =
      created.status === 'IN_FOREST' && created.startTimeSec !== null;
    db.events.unshift({
      id: `ev-${Date.now()}`,
      timestamp: now.toISOString(),
      clock24h: secToClock(
        isDirectPinnstart && created.startTimeSec !== null
          ? created.startTimeSec
          : getStockholmClockSec(now)
      ),
      eventType: isDirectPinnstart ? 'START' : 'DIRECT_ENTRY',
      siNumber: created.siNumber,
      competitorId: created.id,
      competitorName: created.fullName,
      club: created.club,
      className: cls?.name ?? null,
      stationCode: isDirectPinnstart ? 20 : 1,
      stationName: isDirectPinnstart
        ? 'Startfålla — Pinnstart'
        : 'Sekretariat — Direktanmälan',
      runningTimeSec: created.runningTimeSec,
      message: isDirectPinnstart
        ? `Pinnstart kl. ${secToClock(created.startTimeSec!)} i ${cls?.name ?? '-'} (direktanmäld från Löpardatabas)`
        : `Direktanmäld i ${cls?.name ?? '-'}${
            created.isRentalCard ? ' (Hyrbricka utlämnad)' : ''
          }`,
    });

    persistUserMutation();
    broadcastFullState(db.competition.shortCode);
    res.status(201).json(created);
  });

  app.put('/api/competitors/:id', (req, res) => {
    const db = getActiveEvent();
    const idx = db.competitors.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Deltagare hittades ej.' });
      return;
    }
    const existing = db.competitors[idx];
    const body = req.body as Partial<Competitor>;
    const nextSi = body.siNumber !== undefined ? Number(body.siNumber) : existing.siNumber;
    logLegacyCompetitorFieldWrite(
      'competitor update',
      existing.id,
      Object.keys(body).filter((field) => firestoreOwnedCompetitorFields.has(field))
    );

    if (nextSi !== existing.siNumber) {
      const activeConflict = db.competitors.find(
        (c) =>
          c.siNumber === nextSi &&
          c.id !== existing.id &&
          (c.status === 'REGISTERED' ||
            c.status === 'CHECKED' ||
            c.status === 'IN_FOREST' ||
            c.status === 'PRELIMINARY_FIN')
      );
      if (activeConflict) {
        res.status(409).json({
          error: `SI-bricka ${nextSi} används redan av #${activeConflict.bib} ${activeConflict.fullName}.`,
        });
        return;
      }
    }

    const updatedClassId = body.classId ?? existing.classId;
    const updated: Competitor = {
      ...existing,
      fullName: body.fullName !== undefined ? body.fullName.trim() : existing.fullName,
      club: body.club !== undefined ? body.club.trim() : existing.club,
      classId: updatedClassId,
      siNumber: nextSi,
      cardSeries: inferSeries(nextSi),
      isRentalCard:
        body.isRentalCard !== undefined ? body.isRentalCard : existing.isRentalCard,
      isBorrowedCard:
        body.isBorrowedCard !== undefined ? body.isBorrowedCard : existing.isBorrowedCard,
      rentalReturned:
        body.rentalReturned !== undefined ? body.rentalReturned : existing.rentalReturned,
      feePaid: body.feePaid !== undefined ? Boolean(body.feePaid) : existing.feePaid,
      status: body.status ?? existing.status,
      allocatedStartSec:
        body.allocatedStartSec !== undefined
          ? body.allocatedStartSec
          : existing.allocatedStartSec,
      checkTimeSec:
        body.checkTimeSec !== undefined ? body.checkTimeSec : existing.checkTimeSec,
      startTimeSec:
        body.startTimeSec !== undefined ? body.startTimeSec : existing.startTimeSec,
      lastSeenControl:
        body.lastSeenControl !== undefined
          ? body.lastSeenControl
          : existing.lastSeenControl,
      lastSeenTimeSec:
        body.lastSeenTimeSec !== undefined
          ? body.lastSeenTimeSec
          : existing.lastSeenTimeSec,
    };

    const sourcePunches = updated.rawReadout
      ? updated.rawReadout.punches
      : updated.cardPunches;

    const classOrStartChanged =
      updatedClassId !== existing.classId ||
      updated.startTimeSec !== existing.startTimeSec;

    if (
      classOrStartChanged &&
      (sourcePunches.length > 0 || updated.finishTimeSec !== null)
    ) {
      const cls = db.classes.find((c) => c.id === updatedClassId);
      const effStart =
        updated.startTimeSec ??
        updated.rawReadout?.startTimeSec ??
        updated.allocatedStartSec ??
        db.competition.zeroTimeSec;
      const effFin =
        updated.manualFinishTimeSec ??
        updated.rawReadout?.finishTimeSec ??
        updated.finishTimeSec;
      updated.runningTimeSec =
        effFin !== null && effFin >= effStart ? effFin - effStart : null;
      if (sourcePunches.length > 0 || updated.readoutAt) {
        updated.validation = validateCompetitorReadout(
          cls,
          db.courses,
          effStart,
          effFin,
          sourcePunches,
          db.emergency
        );
        if (updated.status === 'OK' || updated.status === 'MP') {
          updated.status = updated.validation.ok ? 'OK' : 'MP';
        }
      }
    }

    runCompetitorMutation(
      {
        source: '/api/competitors/:id',
        operation: 'UPDATE',
        competitionId: db.competition.id,
        competitorId: updated.id,
        siNumber: updated.siNumber,
        previousSiNumber: existing.siNumber,
        assignmentHandling: {
          mode: 'LEGACY',
          reason: 'Express competitor update does not validate or update the SI assignment.',
        },
        identityAffecting: nextSi !== existing.siNumber,
      },
      () => {
        db.competitors[idx] = updated;
      }
    );
    const updatedCls = db.classes.find((c) => c.id === updated.classId);

    if (
      updated.status === 'IN_FOREST' &&
      (existing.status !== 'IN_FOREST' ||
        updated.startTimeSec !== existing.startTimeSec)
    ) {
      const now = new Date();
      const stampSec = updated.startTimeSec ?? getStockholmClockSec(now);
      db.events.unshift({
        id: `ev-${Date.now()}`,
        timestamp: now.toISOString(),
        clock24h: secToClock(stampSec),
        eventType: 'START',
        siNumber: updated.siNumber,
        competitorId: updated.id,
        competitorName: updated.fullName,
        club: updated.club,
        className: updatedCls?.name ?? null,
        stationCode: 20,
        stationName: 'Startfålla — Start',
        runningTimeSec: null,
        message: `Startad kl. ${secToClock(stampSec)} i ${updatedCls?.name ?? '-'}`,
      });
      db.events = db.events.slice(0, 250);
    } else if (updated.status === 'CHECKED' && existing.status === 'REGISTERED') {
      const now = new Date();
      const stampSec = updated.checkTimeSec ?? getStockholmClockSec(now);
      db.events.unshift({
        id: `ev-${Date.now()}`,
        timestamp: now.toISOString(),
        clock24h: secToClock(stampSec),
        eventType: 'CHECK',
        siNumber: updated.siNumber,
        competitorId: updated.id,
        competitorName: updated.fullName,
        club: updated.club,
        className: updatedCls?.name ?? null,
        stationCode: 10,
        stationName: 'Startfålla — Check',
        runningTimeSec: null,
        message: `Checkad i startfållan kl. ${secToClock(stampSec)} (${updatedCls?.name ?? '-'})`,
      });
      db.events = db.events.slice(0, 250);
    }

    if (!updated.isRentalCard && !updated.isBorrowedCard) {
      upsertRunnerInSeasonDb(seasonDb, {
        siNumber: updated.siNumber,
        fullName: updated.fullName,
        club: updated.club,
        defaultClassName: updatedCls?.name ?? null,
        source: 'LEARNED_ENTRY',
      });
    }
    recomputeAllSplitRanks(db);
    persistUserMutation();
    broadcastFullState(db.competition.shortCode);
    res.json(updated);
  });

  app.delete('/api/competitors/:id', (req, res) => {
    const db = getActiveEvent();
    const deleted = db.competitors.find((competitor) => competitor.id === req.params.id);
    if (deleted) {
      runCompetitorMutation(
        {
          source: '/api/competitors/:id',
          operation: 'DELETE',
          competitionId: db.competition.id,
          competitorId: deleted.id,
          siNumber: deleted.siNumber,
          assignmentHandling: {
            mode: 'LEGACY',
            reason: 'Express competitor deletion does not retire or update the SI assignment.',
          },
          identityAffecting: true,
        },
        () => {
          db.competitors = db.competitors.filter((competitor) => competitor.id !== req.params.id);
        }
      );
    } else {
      db.competitors = db.competitors.filter((competitor) => competitor.id !== req.params.id);
    }
    recomputeAllSplitRanks(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.status(204).end();
  });

  // 7. Courses & Classes CRUD
  app.post('/api/courses', (req, res) => {
    const db = getActiveEvent();
    const body = req.body as Partial<Course>;
    if (!body.name?.trim() || !Array.isArray(body.controls) || body.controls.length === 0) {
      res.status(400).json({ error: 'Ange bannamn och minst en kontrollkod.' });
      return;
    }
    const course: Course = {
      id: body.id?.trim() || `crs-${Date.now()}`,
      name: body.name.trim(),
      lengthMeters: Number(body.lengthMeters) || 3500,
      climbMeters: Number(body.climbMeters) || 80,
      controls: body.controls.map(Number).filter((n) => Number.isFinite(n) && n > 0),
    };
    const existingIndex = db.courses.findIndex((existing) => existing.id === course.id);
    if (existingIndex >= 0) {
      db.courses[existingIndex] = course;
    } else {
      db.courses.push(course);
    }
    recalculateEventFromRawReadouts(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.status(201).json(course);
  });

  app.put('/api/courses/:id', (req, res) => {
    const db = getActiveEvent();
    const idx = db.courses.findIndex((c) => c.id === req.params.id);
    const body = req.body as Partial<Course>;
    const existing = idx >= 0 ? db.courses[idx] : null;
    const course: Course = {
      id: req.params.id,
      name: body.name !== undefined ? body.name.trim() : existing?.name ?? 'Bana',
      lengthMeters:
        body.lengthMeters !== undefined ? Number(body.lengthMeters) : existing?.lengthMeters ?? 3500,
      climbMeters:
        body.climbMeters !== undefined ? Number(body.climbMeters) : existing?.climbMeters ?? 80,
      controls: Array.isArray(body.controls)
        ? body.controls.map(Number).filter((n) => Number.isFinite(n) && n > 0)
        : existing?.controls ?? [],
    };
    if (idx >= 0) {
      db.courses[idx] = course;
    } else {
      db.courses.push(course);
    }

    recalculateEventFromRawReadouts(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json(course);
  });

  app.delete('/api/courses/:id', (req, res) => {
    const db = getActiveEvent();
    const referencingClasses = db.classes
      .filter(
        (compClass) =>
          compClass.courseId === req.params.id ||
          compClass.forkCourseIds?.includes(req.params.id)
      )
      .map((compClass) => compClass.name);
    if (referencingClasses.length > 0) {
      res.status(409).json({
        error: `Banan används av ${referencingClasses.join(', ')}. Ta bort eller ändra klassernas banreferenser innan banan tas bort.`,
      });
      return;
    }
    db.courses = db.courses.filter((c) => c.id !== req.params.id);
    recalculateEventFromRawReadouts(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.status(204).end();
  });

  app.post('/api/classes', (req, res) => {
    const db = getActiveEvent();
    const body = req.body as Partial<CompClass>;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Ange klassnamn.' });
      return;
    }
    const created: CompClass = {
      id: body.id?.trim() || `cls-${Date.now()}`,
      name: body.name.trim(),
      courseId:
        body.courseId !== undefined ? body.courseId : db.courses[0]?.id ?? null,
      classFormat: body.classFormat ?? 'STANDARD',
      forkCourseIds: Array.isArray(body.forkCourseIds) ? body.forkCourseIds : undefined,
      rogainingMaxTimeSec:
        body.rogainingMaxTimeSec !== undefined ? Number(body.rogainingMaxTimeSec) : null,
      rogainingPenaltyPerMin:
        body.rogainingPenaltyPerMin !== undefined ? Number(body.rogainingPenaltyPerMin) : null,
      allowDirectEntry: body.allowDirectEntry !== false,
      freeStart: Boolean(body.freeStart),
      autoMatchCourse: Boolean(body.autoMatchCourse),
      feeSek: Number(body.feeSek ?? 140),
    };
    const existingIndex = db.classes.findIndex((compClass) => compClass.id === created.id);
    if (existingIndex >= 0) {
      db.classes[existingIndex] = created;
    } else {
      db.classes.push(created);
    }
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.status(201).json(created);
  });

  app.put('/api/classes/:id', (req, res) => {
    const db = getActiveEvent();
    const idx = db.classes.findIndex((c) => c.id === req.params.id);
    const body = req.body as Partial<CompClass>;
    const existing = idx >= 0 ? db.classes[idx] : null;
    const saved: CompClass = {
      id: req.params.id,
      name: body.name !== undefined ? body.name.trim() : existing?.name ?? 'Klass',
      courseId: body.courseId !== undefined ? body.courseId : existing?.courseId ?? db.courses[0]?.id ?? null,
      classFormat:
        body.classFormat !== undefined ? body.classFormat : existing?.classFormat ?? 'STANDARD',
      forkCourseIds:
        body.forkCourseIds !== undefined ? body.forkCourseIds : existing?.forkCourseIds,
      rogainingMaxTimeSec:
        body.rogainingMaxTimeSec !== undefined
          ? body.rogainingMaxTimeSec
          : existing?.rogainingMaxTimeSec ?? null,
      rogainingPenaltyPerMin:
        body.rogainingPenaltyPerMin !== undefined
          ? body.rogainingPenaltyPerMin
          : existing?.rogainingPenaltyPerMin ?? null,
      allowDirectEntry:
        body.allowDirectEntry !== undefined
          ? body.allowDirectEntry
          : existing?.allowDirectEntry ?? true,
      freeStart: body.freeStart !== undefined ? body.freeStart : existing?.freeStart ?? false,
      autoMatchCourse:
        body.autoMatchCourse !== undefined
          ? body.autoMatchCourse
          : existing?.autoMatchCourse ?? false,
      feeSek:
        body.feeSek !== undefined
          ? Math.max(0, Math.min(10000, Math.round(Number(body.feeSek) || 0)))
          : existing?.feeSek ?? 140,
    };
    if (idx >= 0) {
      db.classes[idx] = saved;
    } else {
      db.classes.push(saved);
    }
    recalculateEventFromRawReadouts(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json(saved);
  });

  app.delete('/api/classes/:id', (req, res) => {
    const db = getActiveEvent();
    const referencingCompetitors = db.competitors
      .filter((competitor) => competitor.classId === req.params.id)
      .map((competitor) => competitor.fullName);
    if (referencingCompetitors.length > 0) {
      res.status(409).json({
        error: `Klassen används av ${referencingCompetitors.slice(0, 8).join(', ')}.`,
      });
      return;
    }
    db.classes = db.classes.filter((compClass) => compClass.id !== req.params.id);
    recalculateEventFromRawReadouts(db);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.status(204).end();
  });

  // 8. Stations CRUD
  app.post('/api/stations', (req, res) => {
    const db = getActiveEvent();
    const body = req.body as Partial<SIStation>;
    const code = Number(body.stationCode);
    if (!Number.isFinite(code) || code < 1 || code > 511 || !body.name?.trim()) {
      res.status(400).json({ error: 'Stationskod (CN 1–511) och benämning krävs.' });
      return;
    }
    if (db.stations.some((s) => s.stationCode === code)) {
      res.status(409).json({ error: `Stationskod CN ${code} är redan konfigurerad.` });
      return;
    }
    const st: SIStation = {
      id: `st-${code}-${Date.now()}`,
      stationCode: code,
      name: body.name.trim(),
      hardwareModel: body.hardwareModel ?? 'BSM8-USB',
      stationFunction: body.stationFunction ?? 'RADIO',
      baudRate: body.baudRate ?? 38400,
      extendedProtocol: true,
      batteryMv: 4950,
      firmware: 'FW 6.56',
      lastSeenAt: null,
      active: true,
    };
    db.stations.push(st);
    db.stations.sort((a, b) => a.stationCode - b.stationCode);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.status(201).json(st);
  });

  app.put('/api/stations/:id', (req, res) => {
    const db = getActiveEvent();
    const station = db.stations.find((item) => item.id === req.params.id);
    if (!station) {
      res.status(404).json({ error: 'Stationen hittades inte.' });
      return;
    }

    const body = req.body as Partial<SIStation>;
    const code = Number(body.stationCode);
    if (!Number.isInteger(code) || code < 1 || code > 511 || !body.name?.trim()) {
      res.status(400).json({ error: 'Stationskod (CN 1–511) och benämning krävs.' });
      return;
    }
    if (db.stations.some((item) => item.id !== station.id && item.stationCode === code)) {
      res.status(409).json({ error: `Stationskod CN ${code} är redan konfigurerad.` });
      return;
    }

    station.stationCode = code;
    station.name = body.name.trim();
    station.hardwareModel = body.hardwareModel ?? station.hardwareModel;
    station.stationFunction = body.stationFunction ?? station.stationFunction;
    db.stations.sort((a, b) => a.stationCode - b.stationCode);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.json(station);
  });

  app.delete('/api/stations/:id', (req, res) => {
    const db = getActiveEvent();
    db.stations = db.stations.filter((s) => s.id !== req.params.id);
    saveSeasonDatabase(seasonDb);
    broadcastFullState(db.competition.shortCode);
    res.status(204).end();
  });

  // 9. IOF XML (3.0 & 2.0.3) Batch Import
  app.post('/api/import/batch', (req, res) => {
    const {
      courses = [],
      classes = [],
      entries = [],
      runnerDbEntries = [],
      replaceExisting = false,
      defaultFreeStart = false,
    } = req.body as {
      courses?: {
        id?: string;
        name: string;
        lengthMeters: number;
        climbMeters: number;
        controls: number[];
      }[];
      classes?: {
        id?: string;
        name: string;
        courseId?: string | null;
        courseName?: string;
        classFormat?: ClassCompetitionFormat;
        forkCourseIds?: string[];
        forkCourseNames?: string[];
        freeStart?: boolean;
        autoMatchCourse?: boolean;
        allowDirectEntry?: boolean;
        feeSek?: number;
        rogainingMaxTimeSec?: number | null;
        rogainingPenaltyPerMin?: number | null;
      }[];
      entries?: { fullName: string; club: string; className: string; siNumber: number }[];
      runnerDbEntries?: {
        siNumber: number;
        fullName: string;
        club: string;
        birthYear?: number | null;
        defaultClassName?: string | null;
        eventorPersonId?: string | null;
      }[];
      replaceExisting?: boolean;
      defaultFreeStart?: boolean;
    };

    if (!Array.isArray(entries)) {
      res.status(400).json({ error: 'IOF-importens deltagarlista har ogiltigt format.' });
      return;
    }
    if (entries.length > 0) {
      res.status(410).json({
        error:
          'Import av deltagare till Express-spegeln är avstängd. Logga in med ett behörigt Google-konto och använd Firestore-importen.',
      });
      return;
    }

    const db = getActiveEvent();
    const clubCfg = ensureClubSettings(seasonDb);
    const validIncomingClasses = classes.filter(
      (cl) => String(cl.name || '').trim().length > 0
    );
    if (replaceExisting && validIncomingClasses.length > 0) {
      const retainedClassIds = new Set<string>();
      for (const cls of validIncomingClasses) {
        const existingClass =
          (cls.id ? db.classes.find((candidate) => candidate.id === cls.id) : undefined) ??
          db.classes.find(
            (candidate) =>
              candidate.name.toLowerCase() === String(cls.name).trim().toLowerCase()
          );
        const retainedId = cls.id || existingClass?.id;
        if (retainedId) retainedClassIds.add(retainedId);
      }
      const affectedCompetitors = db.competitors.filter(
        (competitor) => !retainedClassIds.has(competitor.classId)
      );
      if (affectedCompetitors.length > 0) {
        res.status(409).json({
          error:
            'Klasserna kan inte ersättas via Express-spegeln eftersom befintliga deltagare använder klasser som skulle tas bort.',
        });
        return;
      }
    }

    let addedCourses = 0;
    let addedClasses = 0;
    let addedEntries = 0;
    let syncedRunnerDb = 0;

    const sanitizedCourses = courses
      .map((c, idx) => {
        const controls = (Array.isArray(c.controls) ? c.controls : [])
          .map((n) => Math.round(Number(n)))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 511)
          .slice(0, 128);
        return {
          id: String(c.id || '').trim().slice(0, 128) || undefined,
          name: String(c.name || '').trim().slice(0, 120) || `Bana ${idx + 1}`,
          lengthMeters: Math.max(0, Math.min(200000, Math.round(Number(c.lengthMeters) || 0))),
          climbMeters: Math.max(0, Math.min(20000, Math.round(Number(c.climbMeters) || 0))),
          controls,
        };
      })
      .filter((c) => c.controls.length > 0);

    if (replaceExisting && sanitizedCourses.length > 0) {
      const oldCoursesByName = new Map(
        db.courses.map((oc) => [oc.name.toLowerCase(), oc] as const)
      );
      db.courses = sanitizedCourses.map((c, idx) => {
        const prev = oldCoursesByName.get(c.name.toLowerCase());
        return {
          id:
            c.id ??
            prev?.id ??
            `crs-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 5)}`,
          name: c.name,
          lengthMeters: c.lengthMeters,
          climbMeters: c.climbMeters,
          controls: c.controls,
        };
      });
      addedCourses = db.courses.length;
    } else {
      for (const c of sanitizedCourses) {
        const existing =
          db.courses.find((course) => Boolean(c.id) && course.id === c.id) ??
          db.courses.find((course) => course.name.toLowerCase() === c.name.toLowerCase());
        if (existing) {
          existing.controls = c.controls;
          existing.lengthMeters = c.lengthMeters;
          existing.climbMeters = c.climbMeters;
        } else {
          db.courses.push({
            id:
              c.id ||
              `crs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: c.name,
            lengthMeters: c.lengthMeters,
            climbMeters: c.climbMeters,
            controls: c.controls,
          });
          addedCourses++;
        }
      }
    }

    const resolveClassSpec = (
      cl: {
        id?: string;
        name: string;
        courseId?: string | null;
        courseName?: string;
        classFormat?: ClassCompetitionFormat;
        forkCourseIds?: string[];
        forkCourseNames?: string[];
        freeStart?: boolean;
        autoMatchCourse?: boolean;
        allowDirectEntry?: boolean;
        feeSek?: number;
        rogainingMaxTimeSec?: number | null;
        rogainingPenaltyPerMin?: number | null;
      },
      existingClass?: CompClass
    ): CompClass => {
      const forkCourseIds = Array.isArray(cl.forkCourseIds)
        ? cl.forkCourseIds.filter((id) => db.courses.some((course) => course.id === id)).slice(0, 32)
        : (Array.isArray(cl.forkCourseNames) ? cl.forkCourseNames : [])
            .map((name) =>
              db.courses.find((course) => course.name.toLowerCase() === name.toLowerCase())?.id
            )
            .filter((id): id is string => Boolean(id))
            .slice(0, 32);
      const linkedCourse =
        cl.courseId !== undefined
          ? db.courses.find((course) => course.id === cl.courseId)
          : cl.courseName
            ? db.courses.find((course) => course.name.toLowerCase() === cl.courseName!.toLowerCase())
            : undefined;
      const classFormat: ClassCompetitionFormat =
        cl.classFormat === 'FORKED' || cl.classFormat === 'ROGAINING'
          ? cl.classFormat
          : 'STANDARD';
      const isForked = classFormat === 'FORKED' && forkCourseIds.length > 0;
      const freeStart = cl.freeStart ?? (existingClass?.freeStart ?? Boolean(defaultFreeStart));
      return {
        id: cl.id || existingClass?.id || `cls-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: String(cl.name || '').trim().slice(0, 80),
        courseId:
          cl.courseId !== undefined
            ? cl.courseId
            : isForked
              ? forkCourseIds[0] ?? linkedCourse?.id ?? db.courses[0]?.id ?? null
              : linkedCourse?.id ?? existingClass?.courseId ?? db.courses[0]?.id ?? null,
        classFormat,
        forkCourseIds: classFormat === 'FORKED' ? forkCourseIds : [],
        rogainingMaxTimeSec:
          cl.rogainingMaxTimeSec !== undefined
            ? cl.rogainingMaxTimeSec
            : existingClass?.rogainingMaxTimeSec ?? null,
        rogainingPenaltyPerMin:
          cl.rogainingPenaltyPerMin !== undefined
            ? cl.rogainingPenaltyPerMin
            : existingClass?.rogainingPenaltyPerMin ?? null,
        allowDirectEntry: cl.allowDirectEntry ?? existingClass?.allowDirectEntry ?? true,
        freeStart,
        autoMatchCourse: isForked
          ? true
          : Boolean(cl.autoMatchCourse ?? existingClass?.autoMatchCourse ?? freeStart),
        feeSek: cl.feeSek ?? existingClass?.feeSek ?? clubCfg.defaultDirectEntryFeeSek,
      };
    };

    if (replaceExisting && validIncomingClasses.length > 0) {
      const oldClassesById = new Map(db.classes.map((oc) => [oc.id, oc] as const));
      const oldClassesByName = new Map(
        db.classes.map((oc) => [oc.name.toLowerCase(), oc] as const)
      );
      db.classes = validIncomingClasses.map((cl) =>
        resolveClassSpec(
          cl,
          (cl.id ? oldClassesById.get(cl.id) : undefined) ??
            oldClassesByName.get(cl.name.toLowerCase())
        )
      );
      addedClasses = db.classes.length;
    } else {
      if (replaceExisting && db.courses.length > 0) {
        const validCourseIds = new Set(db.courses.map((c) => c.id));
        const fallbackCourseId = db.courses[0]?.id ?? null;
        for (const cls of db.classes) {
          if (cls.courseId && !validCourseIds.has(cls.courseId)) {
            cls.courseId = fallbackCourseId;
          }
          if (cls.forkCourseIds) {
            cls.forkCourseIds = cls.forkCourseIds.filter((id) => validCourseIds.has(id));
          }
        }
      }
      for (const cl of validIncomingClasses) {
        const existing =
          db.classes.find((compClass) => Boolean(cl.id) && compClass.id === cl.id) ??
          db.classes.find(
            (compClass) => compClass.name.toLowerCase() === cl.name.trim().toLowerCase()
          );
        if (existing) {
          const updated = resolveClassSpec(cl, existing);
          existing.courseId = updated.courseId;
          existing.classFormat = updated.classFormat;
          existing.forkCourseIds = updated.forkCourseIds;
          if (cl.freeStart !== undefined) existing.freeStart = updated.freeStart;
          if (cl.autoMatchCourse !== undefined || updated.classFormat === 'FORKED') {
            existing.autoMatchCourse = updated.autoMatchCourse;
          }
        } else {
          db.classes.push(resolveClassSpec(cl));
          addedClasses++;
        }
      }
    }

    for (const r of runnerDbEntries) {
      if (
        upsertRunnerInSeasonDb(seasonDb, {
          siNumber: r.siNumber,
          fullName: r.fullName,
          club: r.club,
          birthYear: r.birthYear,
          defaultClassName: r.defaultClassName,
          eventorPersonId: r.eventorPersonId,
          source: 'EVENTOR_XML',
        })
      ) {
        syncedRunnerDb++;
      }
    }

    recalculateEventFromRawReadouts(db);
    persistUserMutation();
    broadcastFullState(db.competition.shortCode);
    res.json({
      addedCourses,
      addedClasses,
      addedEntries,
      syncedRunnerDb,
      replaced: Boolean(replaceExisting),
    });
  });

  // 10. Runner Database & Eventor API Routes
  app.post('/api/runner-db', (req, res) => {
    const body = req.body as {
      siNumber?: number;
      fullName?: string;
      club?: string;
      birthYear?: number | null;
      defaultClassName?: string | null;
    };
    const si = Number(body.siNumber);
    if (!Number.isFinite(si) || si <= 0 || !body.fullName?.trim()) {
      res.status(400).json({ error: 'Ange giltigt SI-bricknummer och löparens namn.' });
      return;
    }
    const entry = upsertRunnerInSeasonDb(seasonDb, {
      siNumber: si,
      fullName: body.fullName.trim(),
      club: body.club?.trim() || 'Klubblös',
      birthYear: body.birthYear ?? null,
      defaultClassName: body.defaultClassName ?? null,
      source: 'LEARNED_ENTRY',
    });
    saveSeasonDatabase(seasonDb);
    broadcastFullState();
    res.status(201).json(entry);
  });

  app.post('/api/runner-db/import', (req, res) => {
    const { runners = [], source = 'MEOS_CSV' } = req.body as {
      runners?: {
        siNumber: number;
        fullName: string;
        club: string;
        birthYear?: number | null;
        defaultClassName?: string | null;
      }[];
      source?: RunnerDbSource;
    };
    let importedCount = 0;
    const importedRunners: RunnerDbEntry[] = [];
    for (const r of runners) {
      const imported = upsertRunnerInSeasonDb(seasonDb, {
          siNumber: Number(r.siNumber),
          fullName: r.fullName,
          club: r.club,
          birthYear: r.birthYear ?? null,
          defaultClassName: r.defaultClassName ?? null,
          source,
        });
      if (imported) {
        importedCount++;
        importedRunners.push(imported);
      }
    }
    saveSeasonDatabase(seasonDb);
    broadcastFullState();
    res.json({
      importedCount,
      totalRunnerDb: seasonDb.runnerDb.length,
      importedRunners,
    });
  });

  app.put('/api/runner-db/:id', (req, res) => {
    const body = req.body as {
      siNumber?: number;
      fullName?: string;
      club?: string;
    };
    const runner = seasonDb.runnerDb.find(
      (entry) => entry.id === req.params.id || String(entry.siNumber) === req.params.id
    );
    if (!runner) {
      res.status(404).json({ error: 'Löparen hittades inte i databasen.' });
      return;
    }
    const siNumber = Number(body.siNumber);
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const club = typeof body.club === 'string' ? body.club.trim() : '';
    if (
      !Number.isInteger(siNumber) ||
      siNumber < 1 ||
      siNumber > 99999999 ||
      !fullName
    ) {
      res.status(400).json({ error: 'Ange ett giltigt namn och SI-bricknummer.' });
      return;
    }
    if (
      seasonDb.runnerDb.some(
        (entry) => entry !== runner && entry.siNumber === siNumber
      )
    ) {
      res.status(409).json({ error: 'SI-bricknumret finns redan i löpardatabasen.' });
      return;
    }
    runner.siNumber = siNumber;
    runner.cardSeries = inferSeries(siNumber);
    runner.fullName = fullName.slice(0, 120);
    runner.club = (club || 'Klubblös').slice(0, 100);
    runner.updatedAt = new Date().toISOString();
    saveSeasonDatabase(seasonDb);
    broadcastFullState();
    res.json(runner);
  });

  app.delete('/api/runner-db/:id', (req, res) => {
    seasonDb.runnerDb = seasonDb.runnerDb.filter(
      (r) => r.id !== req.params.id && String(r.siNumber) !== req.params.id
    );
    saveSeasonDatabase(seasonDb);
    broadcastFullState();
    res.status(204).end();
  });

  app.post('/api/eventor/test-connection', async (req, res) => {
    if (!requireEventorAdminRequest(req, res)) return;
    let config: EventorConfig;
    try {
      config = getEventorConfigFromRequest(req.body);
    } catch (err: unknown) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Ogiltiga Eventor-inställningar.',
      });
      return;
    }

    try {
      const orgXml = await fetchFromEventorApi('/organisation/apiKey', config, true);
      const org = parseEventorOrgXml(orgXml);
      if (org && org.orgId !== config.orgId) {
        res.status(400).json({
          success: false,
          error: `API-nyckeln hör till organisation ${org.orgId} (${org.orgName}), inte angivet organisations-ID ${config.orgId}.`,
        });
        return;
      }

      res.json({
        success: true,
        message: 'Anslutning lyckades',
        orgId: org?.orgId ?? config.orgId,
        ...(org ? { orgName: org.orgName } : {}),
      });
    } catch (err: unknown) {
      sendEventorError(res, err, 'Kunde inte testa anslutningen till Eventor.');
    }
  });

  app.get('/api/eventor/status', (req, res) => {
    if (!requireEventorAdminRequest(req, res)) return;
    res.json(buildLiveEventorStatus());
  });

  app.put('/api/eventor/settings', (req, res) => {
    if (!requireEventorAdminRequest(req, res)) return;
    const body = req.body as { autoCreateFromRunnerDbOnReadout?: boolean };
    if (body.autoCreateFromRunnerDbOnReadout !== undefined) {
      seasonDb.eventor.autoCreateFromRunnerDbOnReadout = Boolean(
        body.autoCreateFromRunnerDbOnReadout
      );
    }
    saveSeasonDatabase(seasonDb);
    broadcastFullState();
    res.json(buildLiveEventorStatus());
  });

  app.post('/api/eventor/sync-club', async (req, res) => {
    if (!requireEventorAdminRequest(req, res)) return;
    let config: EventorConfig;
    try {
      config = getEventorConfigFromRequest(req.body);
    } catch (err: unknown) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Ogiltiga Eventor-inställningar.',
      });
      return;
    }

    try {
      const orgXml = await fetchFromEventorApi('/organisation/apiKey', config);
      const org = parseEventorOrgXml(orgXml);
      if (!org) {
        res.status(502).json({
          success: false,
          error: 'Kunde inte tolka klubbens organisationsdata från Eventor API.',
        });
        return;
      }
      if (org.orgId !== config.orgId) {
        res.status(400).json({
          success: false,
          error: 'Eventor API-nyckeln och organisations-ID:t matchar inte.',
        });
        return;
      }

      const compXml = await fetchFromEventorApi(
        `/competitors?organisationId=${encodeURIComponent(org.orgId)}&includeContactDetails=false`,
        config
      );
      const parsedMembers = parseEventorCompetitorsXml(compXml, org.orgName, org.orgId);

      let syncedRunners = 0;
      const runnerDbEntries: RunnerDbEntry[] = [];
      for (const m of parsedMembers) {
        const runner = upsertRunnerInSeasonDb(seasonDb, {
            siNumber: m.siNumber,
            fullName: m.fullName,
            club: m.club,
            birthYear: m.birthYear,
            eventorPersonId: m.eventorPersonId,
            eventorOrgId: m.eventorOrgId,
            source: 'EVENTOR_API',
          });
        if (runner) {
          syncedRunners++;
          runnerDbEntries.push(runner);
        }
      }

      seasonDb.eventor.connectedOrgId = org.orgId;
      seasonDb.eventor.connectedOrgName = org.orgName;
      seasonDb.eventor.lastSyncedAt = new Date().toISOString();
      saveSeasonDatabase(seasonDb);
      broadcastFullState();

      res.json({
        orgId: org.orgId,
        orgName: org.orgName,
        syncedRunners,
        totalRunnerDb: seasonDb.runnerDb.length,
        runnerDbEntries,
      });
    } catch (err: unknown) {
      sendEventorError(res, err, 'Kunde inte synka mot Eventor API.');
    }
  });

  app.post('/api/eventor/import-event', async (req, res) => {
    if (!requireEventorAdminRequest(req, res)) return;
    const body =
      typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const eventId =
      typeof body.eventId === 'string' || typeof body.eventId === 'number'
        ? String(body.eventId).trim()
        : '';
    if (!/^\d{1,32}$/.test(eventId)) {
      res.status(400).json({
        success: false,
        error: 'Ange ett giltigt Eventor-tävlings-ID.',
      });
      return;
    }

    let config: EventorApiConfig;
    try {
      config = getEventorApiConfigFromRequest(body);
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Ogiltiga Eventor-inställningar.',
      });
      return;
    }

    try {
      const encodedEventId = encodeURIComponent(eventId);
      const [eventXml, classesXml, entriesXml] = await Promise.all([
        fetchFromEventorApi(`/event/${encodedEventId}`, config),
        fetchFromEventorApi(`/eventclasses?eventId=${encodedEventId}`, config),
        fetchFromEventorApi(`/entries?eventId=${encodedEventId}`, config),
      ]);
      const event = parseEventorEventXml(eventXml, eventId);
      if (!event) {
        res.status(502).json({
          success: false,
          error: 'Eventor returnerade inte läsbara tävlingsuppgifter.',
        });
        return;
      }
      const classIdToName = parseEventorClassesXml(classesXml);
      const entries = parseEventorEntriesXml(entriesXml, classIdToName);
      res.json({
        success: true,
        event,
        classes: Array.from(classIdToName, ([id, name]) => ({ id, name })),
        entries,
      });
    } catch (error: unknown) {
      sendEventorError(res, error, 'Kunde inte hämta tävlingen från Eventor.');
    }
  });

  app.put('/api/competition', (req, res) => {
    const db = getActiveEvent();
    if (!db.competition.id) {
      res.status(404).json({ error: 'Skapa en tävling först.' });
      return;
    }
    const body = req.body as Partial<CompetitionMeta>;
    if (
      body.status !== undefined &&
      body.status !== 'LIVE' &&
      body.status !== 'UPCOMING' &&
      body.status !== 'COMPLETED'
    ) {
      res.status(400).json({ error: 'Ogiltig tävlingsstatus.' });
      return;
    }
    if (body.name?.trim()) db.competition.name = body.name.trim();
    if (body.organizer !== undefined) {
      db.competition.organizer = body.organizer.trim().slice(0, 100);
    }
    if (body.date?.trim()) db.competition.date = body.date.trim();
    if (body.zeroTimeStr?.trim()) {
      const parsed = parseClockStrToSec(body.zeroTimeStr);
      if (parsed !== null) {
        db.competition.zeroTimeSec = parsed;
        db.competition.zeroTimeStr = secToClock(parsed);
      } else {
        db.competition.zeroTimeStr = body.zeroTimeStr.trim();
      }
    }
    if (body.status !== undefined) {
      db.competition.status = body.status;
      db.competition.statusOverride = true;
    } else if (
      !db.competition.statusOverride &&
      (body.date !== undefined || body.zeroTimeStr !== undefined)
    ) {
      db.competition.status = 'LIVE';
      db.competition.status = resolveEffectiveCompetitionStatus(db);
    }
    if (body.arenaInfo !== undefined) db.competition.arenaInfo = body.arenaInfo.trim();
    if (body.seriesName !== undefined) db.competition.seriesName = body.seriesName.trim();
    if (body.feeTrackingEnabled !== undefined) {
      db.competition.feeTrackingEnabled = Boolean(body.feeTrackingEnabled);
    }
    persistUserMutation();
    broadcastFullState(db.competition.shortCode);
    res.json({
      ...db.competition,
      status: resolveEffectiveCompetitionStatus(db),
    });
  });

  app.post('/api/system/reset-seed', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    res.status(410).json({
      error:
        'Återställning av demotävlingar är tillfälligt avstängd tills SI-tilldelningar kan hanteras atomiskt.',
    });
  });

  app.get('/api/system/backup', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const dateStamp = getStockholmDateIso();
    const sanitizedBackup: SeasonDatabase = {
      version: seasonDb.version,
      activeEventId: seasonDb.activeEventId,
      demoCleared: Boolean(seasonDb.demoCleared),
      clubSettings: ensureClubSettings(seasonDb),
      eventsMap: seasonDb.eventsMap,
      runnerDb: seasonDb.runnerDb,
      eventor: seasonDb.eventor,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="passersi-season-db-${dateStamp}.json"`
    );
    res.send(JSON.stringify(sanitizedBackup, null, 2));
  });

  app.post('/api/system/restore', (req, res) => {
    if (!requireAdminRequest(req, res)) return;
    const candidate = req.body as Partial<SeasonDatabase> | null;
    const restoredRunnerDb = candidate?.runnerDb;
    const hasValidEventsObj =
      candidate && candidate.eventsMap && typeof candidate.eventsMap === 'object';
    const eventKeys = hasValidEventsObj ? Object.keys(candidate.eventsMap!) : [];
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !hasValidEventsObj ||
      (eventKeys.length === 0 && !candidate.demoCleared) ||
      !Array.isArray(restoredRunnerDb)
    ) {
      res.status(400).json({
        error: 'Ogiltig säkerhetskopia. Filen måste vara en giltig PasserSI säsongsdatabas (.json).',
      });
      return;
    }

    const eventsMap = candidate.eventsMap as Record<string, SingleEventRecord>;
    const currentCompetitionIds = Object.keys(seasonDb.eventsMap).sort();
    const restoredCompetitionIds = Object.keys(eventsMap).sort();
    if (
      currentCompetitionIds.length !== restoredCompetitionIds.length ||
      currentCompetitionIds.some((id, index) => id !== restoredCompetitionIds[index])
    ) {
      res.status(409).json({
        error:
          'Säkerhetskopian lägger till eller tar bort tävlingar. Återställning av tävlingslivscykeln är tillfälligt avstängd.',
      });
      return;
    }

    const identityRows = (events: Record<string, SingleEventRecord>) =>
      Object.values(events).flatMap((event) =>
        (event.competitors || []).map((competitor) => ({
          competitionId: event.competition.id,
          competitorId: competitor.id,
          siNumber: Number(competitor.siNumber),
          cardSeries: competitor.cardSeries,
          status: competitor.status,
        }))
      );
    const currentCompetitorIdentities = identityRows(seasonDb.eventsMap);
    const restoredCompetitorIdentities = identityRows(eventsMap);
    if (
      !hasSameCompetitorIdentitySnapshot(
        currentCompetitorIdentities,
        restoredCompetitorIdentities
      )
    ) {
      console.warn(
        `[single-writer] Blocked legacy backup restore with competitor identity changes: ${JSON.stringify({
          operation: 'RESTORE',
          mode: 'IDENTITY_MIRROR_ONLY',
          currentCompetitorCount: currentCompetitorIdentities.length,
          restoredCompetitorCount: restoredCompetitorIdentities.length,
          reason:
            'Competitor creation, deletion, reassignment, card-series changes, or lifecycle changes require the atomic SI assignment workflow.',
        })}`
      );
      res.status(409).json({
        error:
          'Säkerhetskopian ändrar deltagarnas SI-tilldelning eller status. Återställning med sådana ändringar är tillfälligt avstängd; gör ändringarna via SI-tilldelningsflödet.',
      });
      return;
    }

    const restoredIds = new Set(
      Object.values(eventsMap).flatMap((event) =>
        (event.competitors || []).map((competitor) => competitor.id)
      )
    );
    const restoreMutations: CompetitorMutationDeclaration[] = [];
    for (const currentEvent of Object.values(seasonDb.eventsMap)) {
      for (const competitor of currentEvent.competitors) {
        if (!restoredIds.has(competitor.id)) {
          restoreMutations.push({
            source: '/api/system/restore',
            operation: 'DELETE',
            competitionId: currentEvent.competition.id,
            competitorId: competitor.id,
            siNumber: competitor.siNumber,
            assignmentHandling: {
              mode: 'LEGACY',
              reason: 'Backup restore removes a current competitor without retiring its SI assignment.',
            },
            identityAffecting: true,
          });
        }
      }
    }
    for (const ev of Object.values(eventsMap)) {
      for (const competitor of ev.competitors || []) {
        restoreMutations.push({
          source: '/api/system/restore',
          operation: 'RESTORE',
          competitionId: ev.competition.id,
          competitorId: competitor.id,
          siNumber: competitor.siNumber,
          assignmentHandling: {
            mode: 'LEGACY',
            reason:
              'Backup restore is restricted to unchanged competitor SI identities; assignment writes are not required.',
          },
          identityAffecting: false,
        });
      }
      ev.competition.feeTrackingEnabled = Boolean(ev.competition.feeTrackingEnabled);
      if (!ev.emergency) ev.emergency = { brokenControls: [], controlTimeOffsets: {} };
      if (!ev.roc) ev.roc = buildDefaultRocStatus('1042');
      if (!Array.isArray(ev.processedClientIds)) ev.processedClientIds = [];
      recalculateEventFromRawReadouts(ev);
    }

    const validActiveId =
      eventKeys.length === 0
        ? ''
        : candidate.activeEventId && eventsMap[candidate.activeEventId]
        ? candidate.activeEventId
        : eventKeys[0];

    const preservedAuth = ensureSeasonAuthConfig(seasonDb);
    const preservedClub = candidate.clubSettings ?? ensureClubSettings(seasonDb);
    runCompetitorMutations(restoreMutations, () => {
      seasonDb = {
        version: 3,
        activeEventId: validActiveId,
        demoCleared: Boolean(candidate.demoCleared || eventKeys.length === 0),
        clubSettings: preservedClub,
        eventsMap,
        runnerDb: restoredRunnerDb,
        eventor: candidate.eventor ?? seasonDb.eventor,
        authConfig: preservedAuth,
      };
    });
    ensureClubSettings(seasonDb);
    persistUserMutation();
    broadcastFullState();
    res.json({
      ok: true,
      eventCount: Object.keys(seasonDb.eventsMap).length,
      runnerDbCount: seasonDb.runnerDb.length,
    });
  });

  // --- Vite Dev Middleware or Production Static ---
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.join(__dirname, 'dist');

  if (!isVercel && !isProd) {
    app.get(['/dev-sw.js', '/sw.js'], (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(
        `if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('install', () => { self.skipWaiting(); });
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: 'window' }))
        .then((clients) => clients.forEach((c) => c.navigate(c.url)))
    );
  });
}
`,
      );
    });

    app.get('/manifest.webmanifest', (_req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        id: '/',
        name: 'PasserSI — SPORTident Inpassering',
        short_name: 'PasserSI',
        description:
          'Tidtagning, SPORTident-avläsning, startfålla, sträcktider och publik liverapportering för orientering.',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      });
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server },
        ws: disableHmr ? false : { server },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!isVercel) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!isVercel) {
    const PORT = Number(process.env.PORT) || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`PasserSI Multi-Event server running on http://0.0.0.0:${PORT}`);
    });
  }
}

void startServer();
