/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Binary,
  ChevronDown,
  CloudOff,
  Compass,
  Eye,
  FolderPlus,
  GitBranch,
  KeyRound,
  Lock,
  LogOut,
  Menu,
  Mic,
  Moon,
  Plus,
  Radio,
  Shuffle,
  SlidersHorizontal,
  Sun,
  Timer,
  Upload,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  CardPunch,
  CloudSeasonSnapshot,
  ClubSettings,
  CompClass,
  CompetitionMeta,
  CompetitionSummary,
  Competitor,
  Course,
  EmergencySettings,
  EventLifecycleStatus,
  EventorIntegrationStatus,
  FullCardReadoutPayload,
  LiveEventItem,
  MeosAppState,
  OfficialRoleMode,
  RawSIFrameLog,
  RocIntegrationStatus,
  RunnerDbEntry,
  RunnerStatus,
  SeriesStandingsBundle,
  SICardSeries,
  SIStation,
} from './types/sportident';
import {
  buildSi5ReadoutFrame,
  buildSi6ReadoutBlockFrames,
  buildSi10ReadoutBlockFrames,
  buildTransRecFrame,
  decodeSingleFrame,
  hexToBytes,
  inferCardSeries,
  parseSi5SheetToReadout,
  parseSi6BlocksToReadout,
  parseSi9BlocksToReadout,
} from './services/sportidentProtocol';
import {
  playMeosFeedbackTone,
  sportidentSerial,
  type SerialConnectionStatus,
  type UsbStationMode,
} from './services/sportidentWebSerial';
import {
  offlineReadoutQueue,
  type OfflineQueueSnapshot,
  type ReadoutDeliveryResult,
} from './services/offlineReadoutQueue';
import {
  apiFetch,
  getStoredAuthSession,
  setStoredAuthSession,
  logoutSecretariatSession,
  subscribeAuthSession,
  verifyStoredSessionOnline,
  type StoredAuthSession,
} from './services/authClient';
import {
  getStockholmTodayIso,
  loadFullSeasonFromFirestore,
  subscribeFirebaseAuth,
  syncFullSeasonToFirestore,
  createCompetitionInFirestore,
  auth,
  db,
  googleProvider,
  BOOTSTRAP_SUPER_ADMIN_EMAILS,
} from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { ReadoutDashboard } from './components/ReadoutDashboard';
import { ForestSafetyView } from './components/ForestSafetyView';
import { SpeakerResultsView } from './components/SpeakerResultsView';
import { EntriesRegistrationView } from './components/EntriesRegistrationView';
import { DrawView } from './components/DrawView';
import { CompetitionSettingsView } from './components/CompetitionSettingsView';
import { CoursesClassesView } from './components/CoursesClassesView';
import { HardwareStationsView } from './components/HardwareStationsView';
import { ProtocolInspectorView } from './components/ProtocolInspectorView';
import { PublicPortalView } from './components/PublicPortalView';
import { StartCorralView } from './components/StartCorralView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { AuthGateView } from './components/AuthGateView';
import { AccessControlView } from './components/AccessControlView';
import { applyClubThemeToDocument } from './utils/clubTheme';
import {
  buildEffectiveCourseImportBatch,
  parseIofXmlDocument,
  type ParsedIofDocument,
} from './utils/iofXml';

type MeosTab =
  | 'competition_settings'
  | 'courses'
  | 'entries'
  | 'readout'
  | 'start_corral'
  | 'forest'
  | 'results'
  | 'draw'
  | 'hardware'
  | 'access'
  | 'protocol';

interface AppRouteState {
  mode: 'SECRETARIAT' | 'PUBLIC';
  shortCode: string | null;
}

function parsePathnameToRoute(pathname: string): AppRouteState {
  const shortMatch = pathname.match(/^\/t\/([^/?#]+)/i);
  if (shortMatch && shortMatch[1]) {
    return {
      mode: 'PUBLIC',
      shortCode: decodeURIComponent(shortMatch[1]),
    };
  }
  if (/^\/publik(\/|$)/i.test(pathname)) {
    return {
      mode: 'PUBLIC',
      shortCode: null,
    };
  }
  return {
    mode: 'SECRETARIAT',
    shortCode: null,
  };
}

const NAV_ITEMS: {
  id: MeosTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'competition_settings', label: 'Tävlingsinställningar', icon: SlidersHorizontal },
  { id: 'courses', label: 'Banor & Klasser', icon: GitBranch },
  { id: 'entries', label: 'Direktanmälan', icon: UserPlus },
  { id: 'readout', label: 'Avläsning & Översikt', icon: Activity },
  { id: 'start_corral', label: 'Startfålla och startlista', icon: Timer },
  { id: 'forest', label: 'Kvar i skogen', icon: Compass },
  { id: 'results', label: 'Speaker & Resultat', icon: Mic },
  { id: 'draw', label: 'Lottning', icon: Shuffle },
  { id: 'hardware', label: 'SportIdent, ROC & USB', icon: Radio },
  { id: 'access', label: 'Klubbadmin och behörighet', icon: KeyRound },
];

const ROLE_MODE_LABELS: Record<OfficialRoleMode, string> = {
  ALL: 'Tävlingsledare (Alla vyer)',
  READOUT: 'Mål & Avläsning',
  START: 'Startpersonal & Startfålla',
  FOREST: 'Skogssäkerhet & Sök',
  SPEAKER: 'Speaker & Resultat',
};

const ROLE_ALLOWED_TABS: Record<OfficialRoleMode, MeosTab[]> = {
  ALL: [
    'competition_settings',
    'courses',
    'entries',
    'readout',
    'start_corral',
    'forest',
    'results',
    'draw',
    'hardware',
    'access',
    'protocol',
  ],
  READOUT: ['readout', 'entries', 'forest', 'results', 'hardware'],
  START: ['start_corral', 'draw', 'entries', 'forest', 'hardware'],
  FOREST: ['forest', 'start_corral', 'readout', 'hardware'],
  SPEAKER: ['results', 'readout', 'forest', 'start_corral'],
};

function formatLifecycleLabel(status?: EventLifecycleStatus): string {
  if (status === 'LIVE') return 'Pågår';
  if (status === 'UPCOMING') return 'Kommande';
  return 'Avslutad';
}

export default function App() {
  const [route, setRoute] = useState<AppRouteState>(() =>
    typeof window !== 'undefined'
      ? parsePathnameToRoute(window.location.pathname)
      : { mode: 'SECRETARIAT', shortCode: null }
  );
  const [lastPublicShortCode, setLastPublicShortCode] = useState<
    string | null | undefined
  >(() => {
    if (typeof window === 'undefined') return undefined;
    const initial = parsePathnameToRoute(window.location.pathname);
    return initial.mode === 'PUBLIC' ? initial.shortCode : undefined;
  });

  const [authSession, setAuthSession] = useState<StoredAuthSession | null>(() =>
    getStoredAuthSession()
  );
  const [authReady, setAuthReady] = useState<boolean>(false);

  const [roleMode, setRoleMode] = useState<OfficialRoleMode>(() => {
    if (typeof window === 'undefined') return 'ALL';
    const storedSess = getStoredAuthSession();
    if (storedSess?.user.sessionKind === 'PIN_OFFICIAL') {
      return storedSess.user.officialRole as OfficialRoleMode;
    }
    const saved = localStorage.getItem('passersi_role_mode') as OfficialRoleMode | null;
    if (saved && saved in ROLE_ALLOWED_TABS) return saved;
    return 'ALL';
  });

  const [activeTab, setActiveTab] = useState<MeosTab>(() => {
    if (typeof window === 'undefined') return 'readout';
    const storedSess = getStoredAuthSession();
    if (storedSess?.user.sessionKind === 'PIN_OFFICIAL') {
      const lockedRole = storedSess.user.officialRole as OfficialRoleMode;
      return ROLE_ALLOWED_TABS[lockedRole]?.[0] ?? 'readout';
    }
    const saved = localStorage.getItem('passersi_role_mode') as OfficialRoleMode | null;
    if (saved && saved in ROLE_ALLOWED_TABS) {
      return ROLE_ALLOWED_TABS[saved][0];
    }
    return 'readout';
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [createEventModalOpen, setCreateEventModalOpen] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setFirebaseUserPresent(true);
        try {
          const token = await u.getIdToken();
          const emailLower = (u.email ?? '').toLowerCase();
          const isSuper = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(emailLower);
          const session: StoredAuthSession = {
            token,
            user: {
              sessionKind: 'ADMIN',
              uid: u.uid,
              displayName: u.displayName || u.email || 'Administratör',
              email: u.email,
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
          setAuthSession(session);
        } catch {
          // If token fetch fails, preserve existing session
        }
      } else {
        setFirebaseUserPresent(false);
        const existing = getStoredAuthSession();
        if (!existing || existing.user.authMethod === 'GOOGLE') {
          setStoredAuthSession(null);
          setAuthSession(null);
        }
      }
      setAuthReady(true);
    });

    const unsubSession = subscribeAuthSession((next) => {
      setAuthSession(next);
    });

    return () => {
      unsubAuth();
      unsubSession();
    };
  }, []);

  const handleChangeRoleMode = useCallback(
    (nextRole: OfficialRoleMode, persistPreference = true) => {
      setRoleMode(nextRole);
      if (persistPreference) {
        localStorage.setItem('passersi_role_mode', nextRole);
      }
      const allowed = ROLE_ALLOWED_TABS[nextRole];
      setActiveTab((prev) => (allowed.includes(prev) ? prev : allowed[0]));
      if (nextRole === 'START') {
        sportidentSerial.setUsbMode('START_CORRAL');
      } else if (nextRole === 'READOUT') {
        sportidentSerial.setUsbMode('READOUT');
      }
    },
    []
  );

  // Enforce role & station locking whenever a PIN_OFFICIAL session is active
  useEffect(() => {
    if (!authSession) return;
    if (authSession.user.sessionKind === 'PIN_OFFICIAL') {
      const lockedRole = authSession.user.officialRole as OfficialRoleMode;
      handleChangeRoleMode(lockedRole, false);
      setEventPickerOpen(false);
      setCreateEventModalOpen(false);
    }
  }, [authSession, handleChangeRoleMode]);

  const handleLogout = useCallback(async () => {
    setMobileNavOpen(false);
    setEventPickerOpen(false);
    setCreateEventModalOpen(false);
    await logoutSecretariatSession();
  }, []);

  // New competition modal form state
  const [newEvtName, setNewEvtName] = useState('');
  const [newEvtDate, setNewEvtDate] = useState(() => getStockholmTodayIso());
  const [newEvtZeroTime, setNewEvtZeroTime] = useState('18:00:00');
  const [newEvtArena, setNewEvtArena] = useState('');
  const [newEvtSeriesName, setNewEvtSeriesName] = useState('');
  const [newEvtSelfReg, setNewEvtSelfReg] = useState(true);
  const [newEvtFeesAndSwish, setNewEvtFeesAndSwish] = useState(false);
  const [newEvtCopyCourses, setNewEvtCopyCourses] = useState(true);
  const [newEvtCourseParsed, setNewEvtCourseParsed] = useState<ParsedIofDocument | null>(null);
  const [newEvtCourseFileName, setNewEvtCourseFileName] = useState('');
  const [newEvtAutoClasses, setNewEvtAutoClasses] = useState(true);
  const [newEvtFreeStart, setNewEvtFreeStart] = useState(true);
  const [createEvtBusy, setCreateEvtBusy] = useState(false);
  const [createEvtError, setCreateEvtError] = useState<string | null>(null);

  const handleNewEvtCourseFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCreateEvtError(null);
    try {
      const rawText = await file.text();
      const parsed = parseIofXmlDocument(rawText);
      if (parsed.type !== 'CourseData' || parsed.courses.length === 0) {
        setCreateEvtError(
          'Filen innehöll inga banor (<CourseData>). Välj en IOF XML-banfil från Purple Pen, Condes eller OCAD.'
        );
        return;
      }
      setNewEvtCourseParsed(parsed);
      setNewEvtCourseFileName(file.name);
      if (!newEvtName.trim() && parsed.eventName) {
        setNewEvtName(parsed.eventName);
      }
    } catch (err: unknown) {
      setCreateEvtError(
        err instanceof Error ? err.message : 'Kunde inte läsa XML-banfilen.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const [firebaseUserPresent, setFirebaseUserPresent] = useState<boolean>(false);
  const [firebaseUserUid, setFirebaseUserUid] = useState<string | null>(null);
  const firestoreCompetitionsRef = useRef<CompetitionSummary[] | null>(null);
  useEffect(() => {
    const unsub = subscribeFirebaseAuth((u) => {
      const verifiedUid = u?.emailVerified ? u.uid : null;
      setFirebaseUserPresent(Boolean(verifiedUid));
      setFirebaseUserUid(verifiedUid);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    firestoreCompetitionsRef.current = null;
    if (!firebaseUserUid) return;

    const competitionsQuery = query(
      collection(db, 'competitions'),
      where('ownerUid', '==', firebaseUserUid)
    );

    return onSnapshot(
      competitionsQuery,
      (snapshot) => {
        const competitions = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as Partial<CompetitionSummary>;
            return {
              id: docSnap.id,
              competitionId: docSnap.id,
              shortCode: data.shortCode ?? '',
              status: data.status ?? 'UPCOMING',
              name: data.name ?? '',
              organizer: data.organizer ?? '',
              date: data.date ?? '',
              zeroTimeStr: data.zeroTimeStr ?? '18:00:00',
              arenaInfo: data.arenaInfo ?? '',
              seriesName: data.seriesName,
              allowSelfRegistration: data.allowSelfRegistration ?? true,
              enableFeesAndSwish: Boolean(data.enableFeesAndSwish),
              competitorCount: data.competitorCount ?? 0,
              finishedCount: data.finishedCount ?? 0,
              classCount: data.classCount ?? 0,
            };
          })
          .sort((a, b) => b.date.localeCompare(a.date));
        firestoreCompetitionsRef.current = competitions;
        setCompetitionsList(competitions);
      },
      (error) => {
        console.error('Kunde inte prenumerera på tävlingar från Firestore:', error);
      }
    );
  }, [firebaseUserUid]);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('passersi_theme') === 'dark';
  });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('passersi_sound') !== 'off';
  });
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    localStorage.setItem('passersi_sound', soundEnabled ? 'on' : 'off');
  }, [soundEnabled]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('passersi_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('passersi_theme', 'light');
    }
  }, [darkMode]);

  // Browser URL history synchronization for /t/:shortCode and /publik
  useEffect(() => {
    const onPopState = () => {
      const next = parsePathnameToRoute(window.location.pathname);
      if (next.mode === 'PUBLIC') {
        setLastPublicShortCode(next.shortCode);
      }
      setRoute(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigatePublicPortal = useCallback((shortCode: string | null) => {
    const targetPath = shortCode ? `/t/${encodeURIComponent(shortCode)}` : '/publik';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setLastPublicShortCode(shortCode);
    setRoute({ mode: 'PUBLIC', shortCode });
  }, []);

  const navigateSecretariat = useCallback(() => {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
    setRoute({ mode: 'SECRETARIAT', shortCode: null });
  }, []);

  // Authoritative MeOS state synced via WebSockets
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [connectedMonitors, setConnectedMonitors] = useState(1);

  const [activeEventId, setActiveEventId] = useState<string>('');
  const activeEventIdRef = useRef<string>('');
  const [competitionsList, setCompetitionsList] = useState<CompetitionSummary[]>([]);
  const [isEmptySeason, setIsEmptySeason] = useState<boolean>(true);
  const [isFreshColdStart, setIsFreshColdStart] = useState<boolean>(false);
  const [demoCleared, setDemoCleared] = useState<boolean>(false);
  const [clubSettings, setClubSettings] = useState<ClubSettings>({
    clubName: 'OK Österåker',
    eventorOrgId: '603',
    swishNumber: '123 481 92 04',
    swishRecipientName: 'OK Österåker Tävlingskassa',
    defaultDirectEntryFeeSek: 100,
    rentalCardFeeSek: 30,
    missingRentalFeeSek: 650,
  });
  const [logoBroken, setLogoBroken] = useState<boolean>(false);

  useEffect(() => {
    setLogoBroken(false);
  }, [clubSettings.logoDataUrl]);

  useEffect(() => {
    applyClubThemeToDocument(clubSettings, darkMode);
  }, [clubSettings, darkMode]);
  const [seriesStandings, setSeriesStandings] = useState<SeriesStandingsBundle[]>([]);

  const [competition, setCompetition] = useState<CompetitionMeta>({
    id: '',
    shortCode: '',
    status: 'UPCOMING',
    name: 'Ingen aktiv tävling',
    organizer: 'OK Österåker',
    date: getStockholmTodayIso(),
    zeroTimeStr: '18:00:00',
    zeroTimeSec: 18 * 3600,
    allowSelfRegistration: false,
  });
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<CompClass[]>([]);
  const [stations, setStations] = useState<SIStation[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [runnerDb, setRunnerDb] = useState<RunnerDbEntry[]>([]);
  const [eventor, setEventor] = useState<EventorIntegrationStatus>({
    apiKeyConfigured: false,
    baseUrl: 'https://eventor.orientering.se/api',
    connectedOrgId: null,
    connectedOrgName: null,
    connectedEventId: null,
    lastSyncedAt: null,
    autoCreateFromRunnerDbOnReadout: true,
  });
  const [emergency, setEmergency] = useState<EmergencySettings>({
    brokenControls: [],
    controlTimeOffsets: {},
  });
  const [roc, setRoc] = useState<RocIntegrationStatus>({
    enabled: false,
    unitId: '1042',
    baseUrl: 'https://roc.olresultat.se/getpunches.asp',
    pollIntervalSec: 5,
    lastPunchId: 0,
    lastPolledAt: null,
    totalReceived: 0,
    lastError: null,
  });
  const [events, setEvents] = useState<LiveEventItem[]>([]);

  const [offlineSnap, setOfflineSnap] = useState<OfflineQueueSnapshot>(() =>
    offlineReadoutQueue.getSnapshot()
  );

  const [selectedRunnerId, setSelectedRunnerId] = useState<string | null>(null);
  const [serialStatus, setSerialStatus] = useState<SerialConnectionStatus>(() =>
    sportidentSerial.getStatus()
  );
  const [frameLogs, setFrameLogs] = useState<RawSIFrameLog[]>([]);
  const [inspectHexTarget, setInspectHexTarget] = useState<string | null>(null);

  // Registration & Start Corral Card Capture State (scoped by timestamp + USB mode)
  const [capturedCard, setCapturedCard] = useState<{
    siNumber: number;
    cardSeries: SICardSeries;
    capturedAt: number;
    mode: UsbStationMode;
  } | null>(null);
  const simDbCursorRef = useRef(0);

  // Automatically switch USB station role when the official changes view on the same computer!
  useEffect(() => {
    if (activeTab === 'entries') {
      sportidentSerial.setUsbMode('REGISTRATION');
    } else if (activeTab === 'start_corral') {
      sportidentSerial.setUsbMode('START_CORRAL');
    } else if (
      activeTab === 'readout' ||
      activeTab === 'results' ||
      activeTab === 'forest' ||
      activeTab === 'draw' ||
      activeTab === 'hardware' ||
      activeTab === 'courses'
    ) {
      sportidentSerial.setUsbMode('READOUT');
    }
  }, [activeTab]);

  const [pendingUnknownReadout, setPendingUnknownReadout] = useState<{
    siNumber: number;
    checkTimeSec?: number | null;
    startTimeSec?: number | null;
    finishTimeSec?: number | null;
    punches?: CardPunch[];
    suggestedRunner?: RunnerDbEntry | null;
  } | null>(null);

  useEffect(() => {
    activeEventIdRef.current = activeEventId;
  }, [activeEventId]);

  const handleReadoutResultFeedback = useCallback((res: ReadoutDeliveryResult) => {
    if (res.queuedOffline) {
      if (soundEnabledRef.current) playMeosFeedbackTone('registration');
      return;
    }
    if (res.unknownCardReadout) {
      setPendingUnknownReadout({
        ...res.unknownCardReadout,
        suggestedRunner: res.suggestedRunner ?? null,
      });
      if (soundEnabledRef.current) playMeosFeedbackTone('mp');
    } else if (res.competitor) {
      setSelectedRunnerId(res.competitor.id);
      if (soundEnabledRef.current) {
        playMeosFeedbackTone(res.competitor.status === 'OK' ? 'ok' : 'mp');
      }
    }
  }, []);

  // Subscribe to durable offline readout queue
  useEffect(() => {
    const unsubSnap = offlineReadoutQueue.subscribe(setOfflineSnap);
    const unsubSynced = offlineReadoutQueue.onItemSynced((res) => {
      handleReadoutResultFeedback(res);
    });
    return () => {
      unsubSnap();
      unsubSynced();
    };
  }, [handleReadoutResultFeedback]);

  const appendFrameLog = useCallback((frame: RawSIFrameLog) => {
    setFrameLogs((prev) => [frame, ...prev.slice(0, 149)]);
  }, []);

  const submitFullReadoutToServer = useCallback(
    async (readout: FullCardReadoutPayload) => {
      const res = await offlineReadoutQueue.submitReadoutGuaranteed(
        readout,
        activeEventIdRef.current
      );
      handleReadoutResultFeedback(res);
    },
    [handleReadoutResultFeedback]
  );

  const submitOnlinePunchToServer = useCallback(
    async (params: {
      siNumber: number;
      stationCode: number;
      punchTimeSec?: number;
      rawHex?: string;
    }) => {
      const res = await offlineReadoutQueue.submitOnlinePunchGuaranteed(
        params,
        activeEventIdRef.current
      );
      if (soundEnabledRef.current) {
        playMeosFeedbackTone(res.queuedOffline ? 'registration' : 'radio');
      }
    },
    []
  );

  // Wire physical Web Serial & WebUSB hardware callbacks
  useEffect(() => {
    const unsubStatus = sportidentSerial.onStatusChange(setSerialStatus);
    const unsubFrame = sportidentSerial.onFrame((frame) => {
      appendFrameLog(frame);
      if (
        sportidentSerial.getStatus().usbMode === 'READOUT' &&
        frame.direction === 'RX' &&
        frame.commandHex === '0xD3' &&
        frame.crcValid &&
        frame.siNumber
      ) {
        void submitOnlinePunchToServer({
          siNumber: frame.siNumber,
          stationCode: frame.stationCode ?? 42,
          punchTimeSec: frame.punchTimeSec,
          rawHex: frame.rawHex,
        });
      }
    });
    const unsubReadout = sportidentSerial.onFullCardReadout((readout) => {
      void submitFullReadoutToServer(readout);
    });
    const unsubRegCard = sportidentSerial.onRegistrationCard((siNumber, cardSeries) => {
      const currentMode = sportidentSerial.getStatus().usbMode;
      setCapturedCard({
        siNumber,
        cardSeries,
        capturedAt: Date.now(),
        mode: currentMode,
      });
      if (currentMode === 'START_CORRAL') {
        setActiveTab((prev) => (prev === 'start_corral' ? prev : 'start_corral'));
      } else {
        setActiveTab((prev) => (prev === 'entries' ? prev : 'entries'));
        if (soundEnabledRef.current) playMeosFeedbackTone('registration');
      }
    });

    // Silently reconnect previously authorized USB / WebUSB SI-stations without browser popup
    void sportidentSerial.tryAutoReconnect();

    return () => {
      unsubStatus();
      unsubFrame();
      unsubReadout();
      unsubRegCard();
    };
  }, [appendFrameLog, submitFullReadoutToServer, submitOnlinePunchToServer]);

  const applySnapshot = useCallback((snap: MeosAppState) => {
    if (snap.activeEventId !== undefined) setActiveEventId(snap.activeEventId);
    if (snap.competitionsList) {
      setCompetitionsList(firestoreCompetitionsRef.current ?? snap.competitionsList);
    }
    setIsEmptySeason(Boolean(snap.isEmptySeason));
    if (snap.isFreshColdStart !== undefined) {
      setIsFreshColdStart(Boolean(snap.isFreshColdStart));
    }
    setDemoCleared(Boolean(snap.demoCleared));
    if (snap.clubSettings) setClubSettings(snap.clubSettings);
    if (snap.seriesStandings) setSeriesStandings(snap.seriesStandings);
    setCompetition(snap.competition);
    setCourses(snap.courses);
    setClasses(snap.classes);
    setStations(snap.stations);
    setCompetitors(snap.competitors);
    setRunnerDb(snap.runnerDb ?? []);
    if (snap.eventor) setEventor(snap.eventor);
    if (snap.emergency) setEmergency(snap.emergency);
    if (snap.roc) setRoc(snap.roc);
    setEvents(snap.events);
    setConnectedMonitors(snap.connectedMonitors);
    setLoading(false);
  }, []);

  // Initial state + authenticated WebSocket synchronization for Secretariat
  const authToken = authSession?.token ?? null;
  useEffect(() => {
    if (!authToken) {
      setWsConnected(false);
      return;
    }

    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const loadInitial = async () => {
      try {
        const res = await apiFetch('/api/state');
        if (res.ok && active) {
          const snap = (await res.json()) as MeosAppState;
          applySnapshot(snap);
          return;
        }
      } catch {
        // Express backend not running (e.g. static host on Vercel)
      }

      // Direct client-side Firestore hydration fallback
      try {
        const cloudSnap = await loadFullSeasonFromFirestore();
        if (!active) return;
        if (cloudSnap && cloudSnap.events.length > 0) {
          const activeEvt =
            cloudSnap.events.find((e) => e.competition.id === cloudSnap.activeEventId) ||
            cloudSnap.events[0];
          applySnapshot({
            activeEventId: activeEvt.competition.id,
            competitionsList: cloudSnap.events.map((e) => ({
              id: e.competition.id,
              shortCode: e.competition.shortCode,
              status: e.competition.status,
              name: e.competition.name,
              organizer: e.competition.organizer,
              date: e.competition.date,
              zeroTimeStr: e.competition.zeroTimeStr || '18:00:00',
              arenaInfo: e.competition.arenaInfo || '',
              seriesName: e.competition.seriesName,
              allowSelfRegistration: e.competition.allowSelfRegistration !== false,
              enableFeesAndSwish: Boolean(e.competition.enableFeesAndSwish),
              competitorCount: e.competitors.length,
              finishedCount: e.competitors.filter((c) => c.status === 'OK' || c.status === 'MP').length,
              classCount: e.classes.length,
            })),
            isEmptySeason: false,
            isFreshColdStart: false,
            demoCleared: cloudSnap.demoCleared,
            clubSettings: cloudSnap.clubSettings,
            seriesStandings: [],
            competition: activeEvt.competition,
            courses: activeEvt.courses,
            classes: activeEvt.classes,
            stations: [],
            competitors: activeEvt.competitors,
            runnerDb: [],
            eventor: {
              apiKeyConfigured: false,
              baseUrl: '',
              connectedOrgId: null,
              connectedOrgName: null,
              connectedEventId: null,
              lastSyncedAt: null,
              autoCreateFromRunnerDbOnReadout: true,
            },
            emergency: { brokenControls: activeEvt.brokenControls, controlTimeOffsets: {} },
            roc: {
              enabled: false,
              unitId: '1042',
              baseUrl: '',
              pollIntervalSec: 5,
              lastPunchId: 0,
              lastPolledAt: null,
              totalReceived: 0,
              lastError: null,
            },
            events: [],
            connectedMonitors: 1,
          });
        } else {
          setActiveEventId('');
          setCompetitionsList([]);
          setIsEmptySeason(true);
          setCompetition({
            id: '',
            shortCode: '',
            status: 'UPCOMING',
            name: 'Ingen aktiv tävling',
            organizer: cloudSnap?.clubSettings?.clubName || 'OK Österåker',
            date: getStockholmTodayIso(),
            zeroTimeStr: '18:00:00',
            zeroTimeSec: 18 * 3600,
            allowSelfRegistration: false,
          });
          setCourses([]);
          setClasses([]);
          setCompetitors([]);
          if (cloudSnap?.clubSettings) {
            setClubSettings(cloudSnap.clubSettings);
          }
        }
      } catch (err) {
        console.warn('Kunde inte läsa in tävlingar från Firestore på klienten:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    const connectWs = () => {
      if (!active) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(
        `${proto}//${window.location.host}/api/ws?token=${encodeURIComponent(authToken)}`
      );

      ws.onopen = () => {
        if (active) setWsConnected(true);
      };

      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            payload?: MeosAppState;
          };
          if (msg.type === 'state:sync' && msg.payload) {
            applySnapshot(msg.payload);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!active) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connectWs, 2500);
      };
    };

    setLoading(true);
    void loadInitial();
    connectWs();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [applySnapshot, authToken]);

  // 1. Cold-Start Firestore Hydration: if the server booted without local disk state,
  // restore full club season from Firestore BEFORE enabling upward cloud auto-sync.
  const coldHydrationDoneRef = useRef<boolean>(false);
  const hydratingCloudRef = useRef<boolean>(false);

  useEffect(() => {
    if (
      authSession?.user.sessionKind !== 'ADMIN' ||
      !firebaseUserPresent ||
      loading ||
      !isFreshColdStart ||
      coldHydrationDoneRef.current
    ) {
      return;
    }
    coldHydrationDoneRef.current = true;
    hydratingCloudRef.current = true;

    void (async () => {
      try {
        const cloudSnap = await loadFullSeasonFromFirestore();
        if (cloudSnap && Array.isArray(cloudSnap.events) && cloudSnap.events.length > 0) {
          const res = await apiFetch('/api/system/cloud-hydrate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cloudSnap),
          });
          if (res.ok) {
            const hydrated = (await res.json()) as MeosAppState;
            applySnapshot(hydrated);
            return;
          }
        } else {
          // If Firestore is empty, export local season and populate Firestore immediately
          const expRes = await apiFetch('/api/system/cloud-export');
          if (expRes.ok) {
            const currentSnap = (await expRes.json()) as CloudSeasonSnapshot;
            await syncFullSeasonToFirestore(
              currentSnap,
              authSession.user.adminTier === 'SUPER_ADMIN'
            );
          }
        }
        setIsFreshColdStart(false);
      } catch {
        setIsFreshColdStart(false);
      } finally {
        hydratingCloudRef.current = false;
      }
    })();
  }, [applySnapshot, authSession, firebaseUserPresent, isFreshColdStart, loading]);

  // 2. Debounced Full-Season Firestore Auto-Sync when a Google Admin is signed in
  const lastCloudSyncSigRef = useRef<string>('');
  useEffect(() => {
    if (
      authSession?.user.sessionKind !== 'ADMIN' ||
      !firebaseUserPresent ||
      loading ||
      isFreshColdStart ||
      hydratingCloudRef.current
    ) {
      return;
    }

    const sig = [
      activeEventId,
      String(demoCleared),
      String(isEmptySeason),
      `${clubSettings.clubName}:${clubSettings.swishNumber}:${clubSettings.defaultDirectEntryFeeSek}:${clubSettings.rentalCardFeeSek}:${clubSettings.missingRentalFeeSek}`,
      competitionsList
        .map(
          (c) =>
            `${c.id}:${c.name}:${c.status}:${c.date}:${c.seriesName || ''}:${String(c.enableFeesAndSwish)}:${c.competitorCount}:${c.finishedCount}`
        )
        .join('|'),
      `${competition.id}:${competition.zeroTimeStr}:${competition.arenaInfo || ''}:${String(competition.allowSelfRegistration)}:${String(competition.enableFeesAndSwish)}`,
      courses
        .map((cr) => `${cr.id}:${cr.name}:${cr.lengthMeters}:${cr.climbMeters}:${cr.controls.join(',')}`)
        .join('|'),
      classes
        .map(
          (cl) =>
            `${cl.id}:${cl.name}:${cl.courseId || ''}:${cl.classFormat || 'STANDARD'}:${(cl.forkCourseIds || []).join(',')}:${String(cl.freeStart)}:${String(cl.autoMatchCourse)}:${cl.feeSek}`
        )
        .join('|'),
      competitors
        .map(
          (cp) =>
            `${cp.id}:${cp.siNumber}:${cp.classId}:${cp.status}:${cp.checkTimeSec ?? -1}:${cp.startTimeSec ?? -1}:${cp.runningTimeSec ?? -1}:${String(cp.feePaid)}:${String(cp.rentalReturned)}`
        )
        .join('|'),
    ].join('::');

    if (sig === lastCloudSyncSigRef.current) return;

    const timer = setTimeout(() => {
      if (hydratingCloudRef.current) return;
      lastCloudSyncSigRef.current = sig;
      void (async () => {
        try {
          const expRes = await apiFetch('/api/system/cloud-export');
          if (!expRes.ok) return;
          const snapshot = (await expRes.json()) as CloudSeasonSnapshot;
          await syncFullSeasonToFirestore(
            snapshot,
            authSession.user.adminTier === 'SUPER_ADMIN'
          );
        } catch {
          // Offline or Firestore unavailable — never disrupt local Secretariat work
        }
      })();
    }, 1200);

    return () => clearTimeout(timer);
  }, [
    activeEventId,
    authSession,
    classes,
    clubSettings,
    competition,
    competitionsList,
    competitors,
    courses,
    demoCleared,
    firebaseUserPresent,
    isEmptySeason,
    isFreshColdStart,
    loading,
  ]);

  function parseTimeToSec(str?: string): number {
    if (!str) return 18 * 3600;
    const parts = str.split(':').map((p) => parseInt(p, 10));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
    }
    return 18 * 3600;
  }

  const handleActivateCompetition = async (eventId: string) => {
    setEventPickerOpen(false);
    setSelectedRunnerId(null);
    setPendingUnknownReadout(null);
    try {
      const res = await apiFetch(`/api/competitions/${encodeURIComponent(eventId)}/activate`, {
        method: 'POST',
      });
      if (res.ok) {
        const snap = (await res.json()) as MeosAppState;
        applySnapshot(snap);
        return;
      }
    } catch {
      // Backend not running (Vercel)
    }

    try {
      const cloudSnap = await loadFullSeasonFromFirestore();
      if (cloudSnap) {
        const targetEvt = cloudSnap.events.find((e) => e.competition.id === eventId);
        if (targetEvt) {
          setActiveEventId(eventId);
          setCompetition(targetEvt.competition);
          setCourses(targetEvt.courses);
          setClasses(targetEvt.classes);
          setCompetitors(targetEvt.competitors);
          setCompetitionsList(
            cloudSnap.events.map((e) => ({
              id: e.competition.id,
              shortCode: e.competition.shortCode,
              status: e.competition.status,
              name: e.competition.name,
              organizer: e.competition.organizer,
              date: e.competition.date,
              zeroTimeStr: e.competition.zeroTimeStr || '18:00:00',
              arenaInfo: e.competition.arenaInfo || '',
              seriesName: e.competition.seriesName,
              allowSelfRegistration: e.competition.allowSelfRegistration !== false,
              enableFeesAndSwish: Boolean(e.competition.enableFeesAndSwish),
              competitorCount: e.competitors.length,
              finishedCount: e.competitors.filter((c) => c.status === 'OK' || c.status === 'MP').length,
              classCount: e.classes.length,
            }))
          );
        }
      }
    } catch (err) {
      console.warn('Kunde inte aktivera tävling från Firestore:', err);
    }
  };

  const handleCreateCompetition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvtName.trim()) {
      setCreateEvtError('Ange ett namn på tävlingen eller träningen.');
      return;
    }
    setCreateEvtBusy(true);
    setCreateEvtError(null);
    try {
      const effectiveCourseImport = newEvtCourseParsed
        ? buildEffectiveCourseImportBatch(newEvtCourseParsed, {
            autoCreateClassesIfMissing: newEvtAutoClasses,
            freeStart: newEvtFreeStart,
          })
        : null;

      let snap: MeosAppState | null = null;
      try {
        const res = await apiFetch('/api/competitions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newEvtName.trim(),
            date: newEvtDate,
            zeroTimeStr: newEvtZeroTime.trim() || '18:00:00',
            arenaInfo: newEvtArena.trim(),
            seriesName: newEvtSeriesName.trim(),
            allowSelfRegistration: newEvtSelfReg,
            enableFeesAndSwish: newEvtFeesAndSwish,
            copyCoursesFromActive:
              !effectiveCourseImport && !isEmptySeason && newEvtCopyCourses,
            ...(effectiveCourseImport
              ? {
                  importedCourses: effectiveCourseImport.courses,
                  importedClasses: effectiveCourseImport.classes,
                }
              : {}),
          }),
        });
        if (res.ok) {
          snap = (await res.json()) as MeosAppState;
          applySnapshot(snap);
        }
      } catch {
        // Express backend not available (e.g. running on Vercel)
      }

      const compId = snap?.competition?.id || snap?.activeEventId || `evt-${Date.now()}`;
      const sc = snap?.competition?.shortCode || `oko${Math.floor(1000 + Math.random() * 9000)}`;
      const importedCourses: Course[] = effectiveCourseImport
        ? effectiveCourseImport.courses.map((c, idx) => ({
            id: `crs-${idx + 1}`,
            name: c.name,
            lengthMeters: c.lengthMeters,
            climbMeters: c.climbMeters,
            controls: c.controls,
          }))
        : [];
      const importedClasses: CompClass[] = effectiveCourseImport
        ? effectiveCourseImport.classes.map((cls, idx) => {
            const matched = importedCourses.find((c) => c.name === cls.courseName);
            return {
              id: `cls-${idx + 1}`,
              name: cls.name,
              courseId: matched ? matched.id : null,
              classFormat: cls.classFormat || 'STANDARD',
              allowDirectEntry: true,
              freeStart: cls.freeStart ?? true,
              autoMatchCourse: cls.autoMatchCourse ?? true,
              feeSek: 100,
            };
          })
        : [];

      // ATOMIC FIRESTORE STORAGE: Guarantees all 23 schema fields without undefined
      if (auth.currentUser) {
        await createCompetitionInFirestore({
          competitionId: compId,
          shortCode: sc,
          name: newEvtName.trim(),
          organizer: clubSettings.clubName || 'OK Österåker',
          date: newEvtDate,
          status: 'UPCOMING',
          zeroTimeStr: newEvtZeroTime.trim() || '18:00:00',
          zeroTimeSec: parseTimeToSec(newEvtZeroTime),
          arenaInfo: newEvtArena.trim(),
          seriesName: newEvtSeriesName.trim(),
          allowSelfRegistration: newEvtSelfReg,
          enableFeesAndSwish: newEvtFeesAndSwish,
          courses: snap ? snap.courses : importedCourses,
          classes: snap ? snap.classes : importedClasses,
        });
      } else if (!snap) {
        throw new Error('Du måste vara inloggad med Google för att skapa tävling i Firestore.');
      }

      if (!snap) {
        const newComp: CompetitionMeta = {
          id: compId,
          shortCode: sc,
          name: newEvtName.trim(),
          organizer: clubSettings.clubName || 'OK Österåker',
          date: newEvtDate,
          status: 'UPCOMING',
          zeroTimeStr: newEvtZeroTime.trim() || '18:00:00',
          zeroTimeSec: parseTimeToSec(newEvtZeroTime),
          arenaInfo: newEvtArena.trim(),
          seriesName: newEvtSeriesName.trim(),
          allowSelfRegistration: newEvtSelfReg,
          enableFeesAndSwish: newEvtFeesAndSwish,
        };
        setCompetition(newComp);
        setActiveEventId(compId);
        setCourses(importedCourses);
        setClasses(importedClasses);
        setCompetitors([]);
        setIsEmptySeason(false);
        setCompetitionsList((prev) => [
          {
            id: compId,
            shortCode: sc,
            status: 'UPCOMING',
            name: newEvtName.trim(),
            organizer: clubSettings.clubName || 'OK Österåker',
            date: newEvtDate,
            zeroTimeStr: newEvtZeroTime.trim() || '18:00:00',
            arenaInfo: newEvtArena.trim(),
            seriesName: newEvtSeriesName.trim(),
            allowSelfRegistration: newEvtSelfReg,
            enableFeesAndSwish: newEvtFeesAndSwish,
            competitorCount: 0,
            finishedCount: 0,
            classCount: importedClasses.length,
          },
          ...prev,
        ]);
      }

      setSelectedRunnerId(null);
      setPendingUnknownReadout(null);
      setNewEvtName('');
      setNewEvtSeriesName('');
      setNewEvtFeesAndSwish(false);
      setNewEvtCourseParsed(null);
      setNewEvtCourseFileName('');
      setNewEvtAutoClasses(true);
      setNewEvtFreeStart(true);
      setCreateEventModalOpen(false);
      setEventPickerOpen(false);

      // Trigger full season sync if server is alive
      void (async () => {
        try {
          const expRes = await apiFetch('/api/system/cloud-export');
          if (expRes.ok) {
            const currentSnap = (await expRes.json()) as CloudSeasonSnapshot;
            await syncFullSeasonToFirestore(
              currentSnap,
              authSession?.user.adminTier === 'SUPER_ADMIN'
            );
          }
        } catch {
          // ignore
        }
      })();
    } catch (err: unknown) {
      console.error('Kunde inte skapa tävling:', err);
      const technicalMsg = err instanceof Error ? err.message : String(err || 'Ett tekniskt fel inträffade.');
      setCreateEvtError(technicalMsg);
    } finally {
      setCreateEvtBusy(false);
    }
  };

  // Testbench: build authentic 0xEF (SI10/SIAC), 0xE1 (SI6), or 0xB1 (SI5) binary frames, decode them, and send via offlineReadoutQueue!
  const handleSimulateFullReadout = async (params: {
    protocolKind?: 'SI10_EF' | 'SI6_E1' | 'SI5_B1';
    siNumber: number;
    checkTimeSec: number | null;
    startTimeSec: number | null;
    finishTimeSec: number | null;
    punches: CardPunch[];
  }) => {
    if (params.protocolKind === 'SI5_B1') {
      const rawSi5 = buildSi5ReadoutFrame({
        stationCode: 1,
        siNumber: params.siNumber,
        checkTimeSec: params.checkTimeSec,
        startTimeSec: params.startTimeSec,
        finishTimeSec: params.finishTimeSec,
        punches: params.punches,
      });
      const decoded = decodeSingleFrame(rawSi5, 'RX', 'PROTOCOL_TESTBENCH');
      if (decoded && decoded.blockData) {
        appendFrameLog(decoded);
        const parsedReadout = parseSi5SheetToReadout(
          1,
          decoded.blockData,
          decoded.rawHex,
          'PROTOCOL_TESTBENCH'
        );
        if (parsedReadout) {
          await submitFullReadoutToServer(parsedReadout);
        }
      }
      return;
    }

    if (params.protocolKind === 'SI6_E1') {
      const rawFrames = buildSi6ReadoutBlockFrames({
        stationCode: 1,
        siNumber: params.siNumber,
        checkTimeSec: params.checkTimeSec,
        startTimeSec: params.startTimeSec,
        finishTimeSec: params.finishTimeSec,
        punches: params.punches,
      });
      const blockMap = new Map<number, number[]>();
      let firstHex = '';
      for (const raw of rawFrames) {
        const decoded = decodeSingleFrame(raw, 'RX', 'PROTOCOL_TESTBENCH');
        if (decoded) {
          if (!firstHex) firstHex = decoded.rawHex;
          appendFrameLog(decoded);
          if (decoded.blockNumber !== undefined && decoded.blockData) {
            blockMap.set(decoded.blockNumber, decoded.blockData);
          }
        }
      }
      const parsedReadout = parseSi6BlocksToReadout(
        1,
        blockMap,
        firstHex,
        'PROTOCOL_TESTBENCH'
      );
      if (parsedReadout) {
        await submitFullReadoutToServer(parsedReadout);
      }
      return;
    }

    const rawFrames = buildSi10ReadoutBlockFrames({
      stationCode: 1,
      siNumber: params.siNumber,
      checkTimeSec: params.checkTimeSec,
      startTimeSec: params.startTimeSec,
      finishTimeSec: params.finishTimeSec,
      punches: params.punches,
    });

    const blockMap = new Map<number, number[]>();
    let firstHex = '';

    for (const raw of rawFrames) {
      const decoded = decodeSingleFrame(raw, 'RX', 'PROTOCOL_TESTBENCH');
      if (decoded) {
        if (!firstHex) firstHex = decoded.rawHex;
        appendFrameLog(decoded);
        if (decoded.blockNumber !== undefined && decoded.blockData) {
          blockMap.set(decoded.blockNumber, decoded.blockData);
        }
      }
    }

    const parsedReadout = parseSi9BlocksToReadout(
      1,
      blockMap,
      firstHex,
      'PROTOCOL_TESTBENCH'
    );
    if (parsedReadout) {
      await submitFullReadoutToServer(parsedReadout);
    }
  };

  const handleSimulateOnlinePunch = async (params: {
    stationCode: number;
    siNumber: number;
    punchTimeSec?: number;
  }) => {
    const raw = buildTransRecFrame({
      stationCode: params.stationCode,
      siNumber: params.siNumber,
      timeSec: params.punchTimeSec,
    });
    const decoded = decodeSingleFrame(raw, 'RX', 'PROTOCOL_TESTBENCH');
    if (!decoded || !decoded.siNumber) return;
    appendFrameLog(decoded);

    if (serialStatus.usbMode === 'REGISTRATION' || serialStatus.usbMode === 'START_CORRAL') {
      setCapturedCard({
        siNumber: decoded.siNumber,
        cardSeries: decoded.cardSeries ?? inferCardSeries(decoded.siNumber),
        capturedAt: Date.now(),
        mode: serialStatus.usbMode,
      });
      setActiveTab(serialStatus.usbMode === 'START_CORRAL' ? 'start_corral' : 'entries');
      if (soundEnabledRef.current && serialStatus.usbMode === 'REGISTRATION') {
        playMeosFeedbackTone('registration');
      }
      return;
    }

    await submitOnlinePunchToServer({
      siNumber: decoded.siNumber,
      stationCode: decoded.stationCode ?? params.stationCode,
      punchTimeSec: decoded.punchTimeSec,
      rawHex: decoded.rawHex,
    });
  };

  const handleInjectOnlineHex = async (rawHex: string) => {
    const bytes = hexToBytes(rawHex);
    if (!bytes) return;
    const decoded = decodeSingleFrame(bytes, 'RX', 'PROTOCOL_TESTBENCH');
    if (!decoded || !decoded.crcValid || !decoded.siNumber) return;
    appendFrameLog(decoded);
    await submitOnlinePunchToServer({
      siNumber: decoded.siNumber,
      stationCode: decoded.stationCode ?? 42,
      punchTimeSec: decoded.punchTimeSec,
      rawHex: decoded.rawHex,
    });
  };

  // 1. Public Spectator & Mobile QR Self-Registration Portal (/t/:shortCode & /publik) — Zero login required
  if (route.mode === 'PUBLIC') {
    return (
      <PublicPortalView
        shortCode={route.shortCode}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onSelectEventShortCode={(sc) => navigatePublicPortal(sc)}
        onSwitchToSecretariat={navigateSecretariat}
      />
    );
  }

  // 2. Quiet initial session verification state
  if (!authReady && !authSession) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950" aria-busy="true" />
    );
  }

  // 3. Inline Secretariat Login Gate (4-digit Role PIN + Google Admin Auth + Offline Emergency Code)
  if (!authSession) {
    return (
      <AuthGateView
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        preferredPublicShortCode={lastPublicShortCode}
        competitions={competitionsList.map((c) => ({
          id: c.id,
          shortCode: c.shortCode,
          name: c.name,
          organizer: c.organizer,
          date: c.date,
          status: c.status,
          pinsCustomized: false,
        }))}
        clubSettings={clubSettings}
        onAuthenticated={(sess) => {
          setAuthSession(sess);
          if (sess.user.sessionKind === 'PIN_OFFICIAL') {
            handleChangeRoleMode(sess.user.officialRole as OfficialRoleMode, false);
          } else {
            handleChangeRoleMode('ALL', true);
          }
        }}
        onOpenPublicPortal={navigatePublicPortal}
      />
    );
  }

  const isPinOfficial = authSession.user.sessionKind === 'PIN_OFFICIAL';
  const isAdminSession = authSession.user.sessionKind === 'ADMIN';
  const effectiveRoleMode: OfficialRoleMode = isPinOfficial
    ? (authSession.user.officialRole as OfficialRoleMode)
    : roleMode;

  // Count badge for "Kvar i skogen" in sidebar
  const forestCount = competitors.filter(
    (c) =>
      c.status === 'CHECKED' ||
      c.status === 'IN_FOREST' ||
      c.status === 'PRELIMINARY_FIN'
  ).length;

  const emergencyActiveCount =
    emergency.brokenControls.length + Object.keys(emergency.controlTimeOffsets).length;

  const visibleNavItems = NAV_ITEMS.filter((item) =>
    ROLE_ALLOWED_TABS[effectiveRoleMode].includes(item.id)
  );
  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Översikt';
  const activePublicShortCode = competition.shortCode || 'oko26a';

  return (
    <div className="min-h-screen flex club-canvas bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-clip">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 club-surface bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
        <div className="min-h-12 py-1.5 px-3.5 flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab(visibleNavItems[0]?.id ?? 'readout')}
            className="inline-flex items-center gap-2 min-w-0 text-left"
          >
            {clubSettings.logoDataUrl && !logoBroken && (
              <img
                src={clubSettings.logoDataUrl}
                alt={`${clubSettings.clubName || 'Klubb'} logotyp`}
                referrerPolicy="no-referrer"
                onError={() => setLogoBroken(true)}
                className="h-6 w-auto max-w-[84px] object-contain shrink-0"
              />
            )}
            <span className="text-sm font-display font-bold tracking-tight truncate">
              {clubSettings.portalTitle?.trim() || 'PasserSI'}
            </span>
          </button>
          {!isEmptySeason && (
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              /t/{activePublicShortCode}
            </span>
          )}
        </div>

        {/* Competition & Role Context (Admin Multi-Event Switcher vs Locked Official Station) */}
        <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 relative">
          {isPinOfficial ? (
            <div className="px-2.5 py-2 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1 font-medium">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span>Låst station</span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="font-semibold club-accent-text hover:underline whitespace-nowrap shrink-0"
                >
                  Byt roll
                </button>
              </div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {authSession.user.lockedEventName || competition.name}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                {authSession.user.displayName}
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEventPickerOpen((v) => !v)}
                className="w-full px-2.5 py-1.5 text-left bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {isEmptySeason ? 'Skapa eller hämta tävling' : competition.name}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {isEmptySeason
                    ? 'Tom säsong'
                    : `${formatLifecycleLabel(competition.status)} · ${competition.date} kl. ${competition.zeroTimeStr.slice(0, 5)}`}
                </div>
              </button>

              {eventPickerOpen && (
                <div className="mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden z-30">
                  <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Tävlingar ({competitionsList.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => navigatePublicPortal(null)}
                      className="text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
                    >
                      Säsongsvy
                    </button>
                  </div>
                  {competitionsList.length === 0 ? (
                    <div className="px-2.5 py-2 text-xs text-slate-500 dark:text-slate-400">
                      Inga tävlingar i säsongen ännu.
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {competitionsList.map((ev) => {
                        const isCurrent = ev.id === activeEventId;
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => void handleActivateCompetition(ev.id)}
                            className={`w-full px-2.5 py-1.5 text-left transition-colors ${
                              isCurrent
                                ? 'bg-slate-100 dark:bg-slate-800/90'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                                {ev.name}
                              </span>
                              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                                {ev.competitorCount} delt.
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              <span
                                className={`font-medium ${
                                  ev.status === 'LIVE'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : ev.status === 'UPCOMING'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {formatLifecycleLabel(ev.status)}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{ev.date}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">/t/{ev.shortCode}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="p-1.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setNewEvtFeesAndSwish(false);
                        setEventPickerOpen(false);
                        setCreateEventModalOpen(true);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3 h-3 shrink-0" />
                      <span>Ny tävling</span>
                    </button>
                    {isAdminSession && (
                      <button
                        type="button"
                        onClick={() => {
                          setEventPickerOpen(false);
                          setActiveTab('access');
                        }}
                        className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors whitespace-nowrap shrink-0"
                        title="Hantera & radera tävlingar"
                      >
                        <KeyRound className="w-3 h-3 shrink-0" />
                        <span>Hantera</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Funktionärsläge (Admin Workspace Preview Filter) */}
              <div className="mt-2 flex items-center gap-2">
                <label
                  htmlFor="desktop-role-select"
                  className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0"
                >
                  Roll:
                </label>
                <select
                  id="desktop-role-select"
                  value={roleMode}
                  onChange={(e) => handleChangeRoleMode(e.target.value as OfficialRoleMode)}
                  className="flex-1 min-w-0 px-2 py-1 text-xs font-medium bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200"
                >
                  {(Object.keys(ROLE_MODE_LABELS) as OfficialRoleMode[]).map((rKey) => (
                    <option key={rKey} value={rKey}>
                      {ROLE_MODE_LABELS[rKey]}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto" aria-label="Tävlingsmeny">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-[13px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'forest' && forestCount > 0 && (
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      isActive
                        ? 'text-slate-200 dark:text-slate-700'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {forestCount}
                  </span>
                )}
                {item.id === 'hardware' && emergencyActiveCount > 0 && (
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      isActive
                        ? 'text-slate-200 dark:text-slate-700'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {emergencyActiveCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
            <span>Synk · USB</span>
            <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-200 truncate">
              {offlineSnap.simulatedOffline || !offlineSnap.browserOnline
                ? `Skog (${offlineSnap.pendingItems.length})`
                : wsConnected
                ? `Live (${connectedMonitors})`
                : 'Synkar'}{' '}
              ·{' '}
              {!serialStatus.connected
                ? 'USB ej ansl.'
                : serialStatus.usbMode === 'REGISTRATION'
                ? 'USB: Anm.'
                : serialStatus.usbMode === 'START_CORRAL'
                ? 'USB: Start'
                : 'USB: Mål'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors whitespace-nowrap shrink-0"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>Ljud {soundEnabled ? 'på' : 'av'}</span>
            </button>
            <PWAInstallButton />
          </div>
          <div className="pt-1.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                {authSession.user.displayName}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {authSession.user.email ||
                  (isPinOfficial ? 'Funktionärs-PIN' : 'Offline reservkod')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors whitespace-nowrap shrink-0"
              title={
                isPinOfficial
                  ? 'Byt funktionärsroll / tillbaka till PIN-sidan'
                  : 'Logga ut från sekretariatet'
              }
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isPinOfficial ? 'Byt roll' : 'Logga ut'}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 w-68 max-w-[85vw] club-surface bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="min-h-12 py-1.5 px-4 flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                {clubSettings.logoDataUrl && !logoBroken && (
                  <img
                    src={clubSettings.logoDataUrl}
                    alt={`${clubSettings.clubName || 'Klubb'} logotyp`}
                    referrerPolicy="no-referrer"
                    onError={() => setLogoBroken(true)}
                    className="h-6 w-auto max-w-[96px] object-contain shrink-0"
                  />
                )}
                <span className="text-base font-display font-bold truncate">
                  {clubSettings.portalTitle?.trim() || 'PasserSI'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1.5 text-slate-500 rounded-lg shrink-0"
                aria-label="Stäng meny"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-1.5">
              {isPinOfficial ? (
                <div className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg space-y-0.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <span>Låst station · {competition.date}</span>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="font-semibold club-accent-text hover:underline whitespace-nowrap shrink-0"
                    >
                      Byt roll
                    </button>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {authSession.user.lockedEventName || competition.name}
                  </div>
                </div>
              ) : (
                <>
                  {competitionsList.length > 0 ? (
                    <select
                      value={activeEventId}
                      onChange={(e) => {
                        void handleActivateCompetition(e.target.value);
                        setMobileNavOpen(false);
                      }}
                      className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    >
                      {competitionsList.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name} ({ev.date})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                      Inga tävlingar ännu
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setNewEvtFeesAndSwish(false);
                        setMobileNavOpen(false);
                        setCreateEventModalOpen(true);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      <span>Ny tävling</span>
                    </button>
                    {isAdminSession && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileNavOpen(false);
                          setActiveTab('access');
                        }}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                      >
                        <KeyRound className="w-3.5 h-3.5 shrink-0" />
                        <span>Hantera</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <label
                      htmlFor="mobile-role-select"
                      className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0"
                    >
                      Roll:
                    </label>
                    <select
                      id="mobile-role-select"
                      value={roleMode}
                      onChange={(e) => handleChangeRoleMode(e.target.value as OfficialRoleMode)}
                      className="flex-1 min-w-0 px-2 py-1 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    >
                      {(Object.keys(ROLE_MODE_LABELS) as OfficialRoleMode[]).map((rKey) => (
                        <option key={rKey} value={rKey}>
                          {ROLE_MODE_LABELS[rKey]}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
            <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium rounded-lg ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {authSession.user.displayName}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {authSession.user.email ||
                      (isPinOfficial ? 'Funktionärs-PIN' : 'Offline reservkod')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{isPinOfficial ? 'Byt roll' : 'Logga ut'}</span>
                </button>
              </div>
              <PWAInstallButton />
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb Left — Actions Right */}
        <header className="h-12 px-3 sm:px-5 lg:px-6 club-surface bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 -ml-1 text-slate-600 dark:text-slate-300 rounded-lg shrink-0"
              aria-label="Öppna meny"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
              <span className="club-muted text-slate-500 dark:text-slate-400 hidden md:inline truncate max-w-[240px]">
                {isEmptySeason ? clubSettings.clubName : competition.name}
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden md:inline">/</span>
              <span className="font-semibold truncate">
                {activeNavLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {(offlineSnap.simulatedOffline ||
              !offlineSnap.browserOnline ||
              offlineSnap.pendingItems.length > 0) && (
              <button
                type="button"
                onClick={() => setActiveTab('readout')}
                className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-lg whitespace-nowrap shrink-0"
              >
                <CloudOff className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono tabular-nums">
                  Kö ({offlineSnap.pendingItems.length})
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleLogout()}
              title={
                isPinOfficial
                  ? 'Byt funktionärsroll / tillbaka till PIN-inloggning'
                  : 'Logga ut från sekretariatet'
              }
              aria-label={isPinOfficial ? 'Byt roll' : 'Logga ut'}
              className="inline-flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent sm:border-slate-200/80 sm:dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {isPinOfficial ? 'Byt roll' : 'Logga ut'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0"
              aria-label="Växla tema"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() =>
                navigatePublicPortal(isEmptySeason ? null : activePublicShortCode)
              }
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>Publik vy</span>
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-2.5 sm:p-4 lg:p-5 max-w-[1440px] w-full mx-auto">
          {createEventModalOpen && isAdminSession && (
            <section className="mb-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderPlus className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
                  <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100 truncate">
                    Skapa ny tävling eller klubbträning
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewEvtCourseParsed(null);
                    setNewEvtCourseFileName('');
                    setCreateEvtError(null);
                    setCreateEventModalOpen(false);
                  }}
                  className="p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg shrink-0"
                  aria-label="Stäng"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateCompetition} className="p-4 space-y-3">
                {createEvtError && (
                  <div className="px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg">
                    {createEvtError}
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tävlingens / träningens namn
                  </label>
                  <input
                    type="text"
                    required
                    value={newEvtName}
                    onChange={(e) => setNewEvtName(e.target.value)}
                    placeholder="t.ex. Torsdagsträning Lunsen — Medeldistans"
                    className="w-full px-2.5 py-1.5 text-xs sm:text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Datum
                    </label>
                    <input
                      type="date"
                      value={newEvtDate}
                      onChange={(e) => setNewEvtDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Nolltid (styr när den pågår)
                    </label>
                    <input
                      type="text"
                      value={newEvtZeroTime}
                      onChange={(e) => setNewEvtZeroTime(e.target.value)}
                      placeholder="18:00:00"
                      className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Klubbserie (valfritt)
                    </label>
                    <input
                      type="text"
                      value={newEvtSeriesName}
                      onChange={(e) => setNewEvtSeriesName(e.target.value)}
                      placeholder="t.ex. Höstserien 2026"
                      className="w-full px-2.5 py-1.5 text-xs sm:text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Arenainfo / PM
                    </label>
                    <input
                      type="text"
                      value={newEvtArena}
                      onChange={(e) => setNewEvtArena(e.target.value)}
                      placeholder="Samling vid klubbstugan"
                      className="w-full px-2.5 py-1.5 text-xs sm:text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* Optional Direct Course File Upload (Purple Pen / Condes / OCAD) */}
                <div className="px-3 py-2 rounded-lg bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
                  {!newEvtCourseParsed ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-slate-700 dark:text-slate-300 min-w-0">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          Banfil från Purple Pen / Condes / OCAD
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {' '}
                          · valfritt (IOF XML 3.0 eller 2.0.3)
                        </span>
                      </div>
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-md cursor-pointer transition-colors whitespace-nowrap shrink-0">
                        <Upload className="w-3.5 h-3.5 shrink-0" />
                        <span>Ladda upp banfil (.xml)</span>
                        <input
                          type="file"
                          accept=".xml,text/xml,application/xml"
                          onChange={(e) => void handleNewEvtCourseFileUpload(e)}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  ) : (
                    (() => {
                      const eff = buildEffectiveCourseImportBatch(newEvtCourseParsed, {
                        autoCreateClassesIfMissing: newEvtAutoClasses,
                        freeStart: newEvtFreeStart,
                      });
                      return (
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="font-medium text-emerald-800 dark:text-emerald-300 min-w-0 truncate">
                              {newEvtCourseFileName} · IOF XML{' '}
                              {newEvtCourseParsed.iofVersion ?? '3.0'} · {eff.courses.length} banor ·{' '}
                              {eff.classes.length} klasser
                              {eff.classesSynthesized
                                ? ' (skapas automatiskt)'
                                : newEvtCourseParsed.classes.length > 0
                                ? ' (från banfilen)'
                                : ''}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer whitespace-nowrap">
                                <span>Byt fil</span>
                                <input
                                  type="file"
                                  accept=".xml,text/xml,application/xml"
                                  onChange={(e) => void handleNewEvtCourseFileUpload(e)}
                                  className="sr-only"
                                />
                              </label>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewEvtCourseParsed(null);
                                  setNewEvtCourseFileName('');
                                }}
                                className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
                              >
                                Ta bort fil
                              </button>
                            </div>
                          </div>

                          <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 truncate">
                            {eff.courses
                              .map(
                                (cr) =>
                                  `${cr.name} (${
                                    cr.lengthMeters > 0 ? `${cr.lengthMeters} m, ` : ''
                                  }${cr.controls.length} ktr)`
                              )
                              .join(' · ')}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={newEvtFreeStart}
                                onChange={(e) => setNewEvtFreeStart(e.target.checked)}
                                className="rounded border-slate-300 dark:border-slate-700"
                              />
                              <span>Fri starttid på importerade klasser</span>
                            </label>
                            {newEvtCourseParsed.classes.length === 0 && (
                              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={newEvtAutoClasses}
                                  onChange={(e) => setNewEvtAutoClasses(e.target.checked)}
                                  className="rounded border-slate-300 dark:border-slate-700"
                                />
                                <span>Skapa klasser automatiskt (1 per bana)</span>
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newEvtSelfReg}
                        onChange={(e) => setNewEvtSelfReg(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700"
                      />
                      <span>Mobil självreg. (/t/kod)</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newEvtFeesAndSwish}
                        onChange={(e) => setNewEvtFeesAndSwish(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700"
                      />
                      <span>Avgift / Swish-QR</span>
                    </label>
                    {!isEmptySeason && !newEvtCourseParsed && (
                      <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newEvtCopyCourses}
                          onChange={(e) => setNewEvtCopyCourses(e.target.checked)}
                          className="rounded border-slate-300 dark:border-slate-700"
                        />
                        <span>Kopiera banor</span>
                      </label>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setNewEvtCourseParsed(null);
                        setNewEvtCourseFileName('');
                        setCreateEvtError(null);
                        setCreateEventModalOpen(false);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                    >
                      Avbryt
                    </button>
                    <button
                      type="submit"
                      disabled={createEvtBusy}
                      className="px-3.5 py-1.5 text-xs font-medium club-accent-btn disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      {createEvtBusy ? 'Skapar...' : 'Skapa & öppna'}
                    </button>
                  </div>
                </div>
              </form>
            </section>
          )}

          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-14 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl" />
              <div className="h-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl" />
            </div>
          ) : isEmptySeason && activeTab !== 'access' && activeTab !== 'protocol' ? (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 max-w-2xl">
              <h1 className="text-lg font-display font-bold text-slate-900 dark:text-slate-100">
                Inga aktiva tävlingar i {clubSettings.clubName}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1.5">
                Säsongen är tom och redo för klubbens egna tävlingar och träningar. Skapa en ny
                tävling direkt eller öppna Klubbadmin för att hämta data från molnet eller en
                säkerhetskopia (.json).
              </p>
              <div className="flex flex-wrap items-center gap-2.5 mt-4">
                {isAdminSession && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setNewEvtFeesAndSwish(false);
                        setCreateEventModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Skapa ny tävling / träning</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('access')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Klubbadmin & Molnsynk</span>
                    </button>
                  </>
                )}
              </div>
            </section>
          ) : (
            <>
              {activeTab === 'competition_settings' && (
                <CompetitionSettingsView
                  isAdmin={isAdminSession}
                  competition={competition}
                  eventor={eventor}
                  runnerDbCount={runnerDb.length}
                  onUpdateCompetition={async (patch) => {
                    await apiFetch('/api/competition', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(patch),
                    });
                  }}
                  onOpenPublicPortal={() => navigatePublicPortal(activePublicShortCode)}
                  onUpdateEventorSettings={async (patch) => {
                    await apiFetch('/api/eventor/settings', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(patch),
                    });
                  }}
                  onSyncEventorClub={async () => {
                    const res = await apiFetch('/api/eventor/sync-club', { method: 'POST' });
                    const data = (await res.json()) as {
                      error?: string;
                      orgName?: string;
                      syncedRunners?: number;
                      totalRunnerDb?: number;
                    };
                    if (!res.ok) {
                      return {
                        ok: false,
                        message: data.error ?? 'Kunde inte synka mot Eventor API.',
                      };
                    }
                    return {
                      ok: true,
                      message: `Synkade ${data.syncedRunners ?? 0} klubbmedlemmar med SI-brickor från ${data.orgName ?? 'Eventor'} (totalt ${data.totalRunnerDb ?? 0} i Löpardatabasen).`,
                    };
                  }}
                  onImportEventorEvent={async (eventId) => {
                    const res = await apiFetch('/api/eventor/import-event', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ eventId }),
                    });
                    const data = (await res.json()) as {
                      error?: string;
                      eventName?: string;
                      addedClasses?: number;
                      addedEntries?: number;
                    };
                    if (!res.ok) {
                      return {
                        ok: false,
                        message: data.error ?? 'Kunde inte hämta tävling från Eventor.',
                      };
                    }
                    return {
                      ok: true,
                      message: `Hämtade "${data.eventName ?? eventId}" från Eventor: +${data.addedClasses ?? 0} klasser och +${data.addedEntries ?? 0} anmälda deltagare.`,
                    };
                  }}
                  onImportIofBatch={async (batch) => {
                    const res = await apiFetch('/api/import/batch', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(batch),
                    });
                    return (await res.json()) as {
                      addedCourses: number;
                      addedClasses: number;
                      addedEntries: number;
                      syncedRunnerDb?: number;
                    };
                  }}
                />
              )}

              {activeTab === 'readout' && (
                <ReadoutDashboard
                  courses={courses}
                  classes={classes}
                  stations={stations}
                  competitors={competitors}
                  runnerDbCount={runnerDb.length}
                  events={events}
                  offlineSnap={offlineSnap}
                  serialStatus={serialStatus}
                  onConnectUsb={async () => {
                    await sportidentSerial.connect();
                  }}
                  onConnectWebUsb={async () => {
                    await sportidentSerial.connectWebUsb();
                  }}
                  onDisconnectUsb={async () => {
                    await sportidentSerial.disconnect();
                  }}
                  onSetUsbMode={(mode) => sportidentSerial.setUsbMode(mode)}
                  onTriggerStationBeep={async () => {
                    await sportidentSerial.triggerStationBeep(1);
                  }}
                  onClearUsbError={() => sportidentSerial.clearError()}
                  onOpenHardwareSettings={
                    ROLE_ALLOWED_TABS[effectiveRoleMode].includes('hardware')
                      ? () => setActiveTab('hardware')
                      : undefined
                  }
                  onSetSimulatedOffline={(offline) =>
                    offlineReadoutQueue.setSimulatedOffline(offline)
                  }
                  onFlushOfflineQueue={async () => {
                    await offlineReadoutQueue.flushQueue();
                  }}
                  selectedRunnerId={selectedRunnerId}
                  onSelectRunner={(id) => setSelectedRunnerId(id)}
                  onMarkRentalReturned={async (id) => {
                    await apiFetch(`/api/competitors/${id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ rentalReturned: true }),
                    });
                  }}
                  onSimulateFullReadout={handleSimulateFullReadout}
                  onSimulateOnlinePunch={handleSimulateOnlinePunch}
                  onLinkUnknownCardToEntry={(siNumber) => {
                    const dbSuggested =
                      runnerDb.find((r) => r.siNumber === siNumber) ?? null;
                    setPendingUnknownReadout((prev) =>
                      prev && prev.siNumber === siNumber
                        ? prev
                        : { siNumber, suggestedRunner: dbSuggested }
                    );
                    setActiveTab('entries');
                  }}
                  onInspectHex={(hex) => {
                    setInspectHexTarget(hex);
                    if (ROLE_ALLOWED_TABS[effectiveRoleMode].includes('protocol')) {
                      setActiveTab('protocol');
                    }
                  }}
                  onNavigateForest={() => setActiveTab('forest')}
                />
              )}

              {activeTab === 'start_corral' && (
                <StartCorralView
                  competition={competition}
                  classes={classes}
                  competitors={competitors}
                  runnerDb={runnerDb}
                  serialStatus={serialStatus}
                  capturedCard={capturedCard}
                  soundEnabled={soundEnabled}
                  onConnectUsb={async () => {
                    await sportidentSerial.connect();
                  }}
                  onConnectWebUsb={async () => {
                    await sportidentSerial.connectWebUsb();
                  }}
                  onDisconnectUsb={async () => {
                    await sportidentSerial.disconnect();
                  }}
                  onSetUsbMode={(mode) => sportidentSerial.setUsbMode(mode)}
                  onTriggerStationBeep={async () => {
                    await sportidentSerial.triggerStationBeep(1);
                  }}
                  onClearUsbError={() => sportidentSerial.clearError()}
                  onOpenHardwareSettings={
                    ROLE_ALLOWED_TABS[effectiveRoleMode].includes('hardware')
                      ? () => setActiveTab('hardware')
                      : undefined
                  }
                  onOpenEntriesWithSi={(siNumber, cardSeries) => {
                    setActiveTab('entries');
                    setCapturedCard({
                      siNumber,
                      cardSeries,
                      capturedAt: Date.now(),
                      mode: 'REGISTRATION',
                    });
                  }}
                  onCreateCompetitor={async (payload) => {
                    const res = await apiFetch('/api/competitors', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (!res.ok) {
                      const err = (await res.json().catch(() => ({}))) as { error?: string };
                      return err.error ?? 'Kunde inte spara deltagare.';
                    }
                    return null;
                  }}
                  onUpdateCompetitor={async (id, patch) => {
                    await apiFetch(`/api/competitors/${id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(patch),
                    });
                  }}
                />
              )}

              {activeTab === 'forest' && (
                <ForestSafetyView
                  competitors={competitors}
                  classes={classes}
                  zeroTimeSec={competition.zeroTimeSec}
                  onUpdateRunnerStatus={async (id, status: RunnerStatus) => {
                    await apiFetch(`/api/competitors/${id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status }),
                    });
                  }}
                />
              )}

              {activeTab === 'results' && (
                <SpeakerResultsView
                  competition={competition}
                  courses={courses}
                  classes={classes}
                  competitors={competitors}
                  onOpenPublicPortal={() => navigatePublicPortal(activePublicShortCode)}
                />
              )}

              {activeTab === 'entries' && (
                <EntriesRegistrationView
                  classes={classes}
                  competitors={competitors}
                  runnerDb={runnerDb}
                  clubSettings={clubSettings}
                  enableFeesAndSwish={Boolean(competition.enableFeesAndSwish)}
                  serialStatus={serialStatus}
                  onConnectUsb={async () => {
                    await sportidentSerial.connect();
                  }}
                  onConnectWebUsb={async () => {
                    await sportidentSerial.connectWebUsb();
                  }}
                  onDisconnectUsb={async () => {
                    await sportidentSerial.disconnect();
                  }}
                  onSetUsbMode={(mode) => sportidentSerial.setUsbMode(mode)}
                  onTriggerStationBeep={async () => {
                    await sportidentSerial.triggerStationBeep(1);
                  }}
                  onClearUsbError={() => sportidentSerial.clearError()}
                  onOpenHardwareSettings={
                    ROLE_ALLOWED_TABS[effectiveRoleMode].includes('hardware')
                      ? () => setActiveTab('hardware')
                      : undefined
                  }
                  capturedCard={capturedCard}
                  pendingUnknownReadout={pendingUnknownReadout}
                  onClearPendingUnknown={() => setPendingUnknownReadout(null)}
                  onSimulateCardScanForEntry={() => {
                    const enteredSet = new Set(competitors.map((c) => c.siNumber));
                    const unenteredInDb = runnerDb.filter((r) => !enteredSet.has(r.siNumber));
                    if (unenteredInDb.length > 0) {
                      const picked =
                        unenteredInDb[simDbCursorRef.current % unenteredInDb.length];
                      simDbCursorRef.current += 1;
                      setCapturedCard({
                        siNumber: picked.siNumber,
                        cardSeries: picked.cardSeries,
                        capturedAt: Date.now(),
                        mode: 'REGISTRATION',
                      });
                    } else {
                      const randomSi = 8520000 + Math.floor(Math.random() * 79000);
                      setCapturedCard({
                        siNumber: randomSi,
                        cardSeries: inferCardSeries(randomSi),
                        capturedAt: Date.now(),
                        mode: 'REGISTRATION',
                      });
                    }
                    if (soundEnabledRef.current) playMeosFeedbackTone('registration');
                  }}
                  onCreateCompetitor={async (payload) => {
                    const res = await apiFetch('/api/competitors', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (!res.ok) {
                      const err = (await res.json().catch(() => ({}))) as { error?: string };
                      return err.error ?? 'Kunde inte spara anmälan.';
                    }
                    return null;
                  }}
                  onUpdateCompetitor={async (id, patch) => {
                    await apiFetch(`/api/competitors/${id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(patch),
                    });
                  }}
                  onDeleteCompetitor={async (id) => {
                    await apiFetch(`/api/competitors/${id}`, { method: 'DELETE' });
                  }}
                  onImportRunnerDb={async (runners, source) => {
                    const res = await apiFetch('/api/runner-db/import', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ runners, source }),
                    });
                    return (await res.json()) as {
                      importedCount: number;
                      totalRunnerDb: number;
                    };
                  }}
                  onDeleteRunnerDbEntry={async (id) => {
                    await apiFetch(`/api/runner-db/${id}`, { method: 'DELETE' });
                  }}
                />
              )}

              {activeTab === 'draw' && (
                <DrawView
                  competition={competition}
                  courses={courses}
                  classes={classes}
                  competitors={competitors}
                  onDrawClass={async (params) => {
                    const res = await apiFetch('/api/draw/class', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(params),
                    });
                    return (await res.json()) as {
                      className: string;
                      drawnCount: number;
                      mode: string;
                      vacantStartTimes: string[];
                    };
                  }}
                />
              )}

              {activeTab === 'courses' && (
                <CoursesClassesView
                  courses={courses}
                  classes={classes}
                  competitors={competitors}
                  enableFeesAndSwish={Boolean(competition.enableFeesAndSwish)}
                  onSaveCourse={async (payload, existingId) => {
                    await apiFetch(
                      existingId ? `/api/courses/${existingId}` : '/api/courses',
                      {
                        method: existingId ? 'PUT' : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      }
                    );
                  }}
                  onDeleteCourse={async (id) => {
                    await apiFetch(`/api/courses/${id}`, { method: 'DELETE' });
                  }}
                  onSaveClass={async (payload, existingId) => {
                    await apiFetch(
                      existingId ? `/api/classes/${existingId}` : '/api/classes',
                      {
                        method: existingId ? 'PUT' : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      }
                    );
                  }}
                  onImportCourseBatch={async (payload) => {
                    const res = await apiFetch('/api/import/batch', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        courses: payload.courses,
                        classes: payload.classes,
                        entries: [],
                        runnerDbEntries: [],
                        replaceExisting: payload.replaceExisting,
                        defaultFreeStart: payload.defaultFreeStart,
                      }),
                    });
                    if (!res.ok) {
                      const err = (await res.json().catch(() => ({}))) as { error?: string };
                      throw new Error(err.error ?? 'Kunde inte importera banfil.');
                    }
                    return (await res.json()) as {
                      addedCourses: number;
                      addedClasses: number;
                      replaced?: boolean;
                    };
                  }}
                />
              )}

              {activeTab === 'hardware' && (
                <HardwareStationsView
                  isAdmin={isAdminSession}
                  competition={competition}
                  courses={courses}
                  classes={classes}
                  competitors={competitors}
                  emergency={emergency}
                  roc={roc}
                  stations={stations}
                  serialStatus={serialStatus}
                  onUpdateEmergency={async (patch) => {
                    const res = await apiFetch('/api/emergency', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(patch),
                    });
                    return (await res.json()) as { recalculatedCount: number };
                  }}
                  onRecalculateAll={async () => {
                    const res = await apiFetch('/api/emergency/recalculate-all', {
                      method: 'POST',
                    });
                    return (await res.json()) as { recalculatedCount: number };
                  }}
                  onAssignManualFinish={async (params) => {
                    const res = await apiFetch('/api/emergency/manual-finish', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(params),
                    });
                    if (!res.ok) {
                      const err = (await res.json().catch(() => ({}))) as { error?: string };
                      return err.error ?? 'Kunde inte spara manuell måltid.';
                    }
                    return null;
                  }}
                  onUpdateRocSettings={async (patch) => {
                    await apiFetch('/api/roc/settings', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(patch),
                    });
                  }}
                  onPollRocNow={async () => {
                    const res = await apiFetch('/api/roc/poll-now', { method: 'POST' });
                    const data = (await res.json()) as {
                      ingested?: number;
                      error?: string | null;
                    };
                    return {
                      ingested: data.ingested ?? 0,
                      error: data.error ?? null,
                    };
                  }}
                  onSimulateRocBatch={async () => {
                    const res = await apiFetch('/api/roc/simulate-batch', { method: 'POST' });
                    const data = (await res.json()) as {
                      ingested?: number;
                      samplePayload?: string;
                    };
                    if (soundEnabledRef.current && (data.ingested ?? 0) > 0) {
                      playMeosFeedbackTone('radio');
                    }
                    return {
                      ingested: data.ingested ?? 0,
                      samplePayload: data.samplePayload ?? '',
                    };
                  }}
                  onConnectUsb={async (baud) => {
                    await sportidentSerial.connect(baud);
                  }}
                  onConnectWebUsb={async (baud) => {
                    await sportidentSerial.connectWebUsb(baud);
                  }}
                  onDisconnectUsb={() => sportidentSerial.disconnect()}
                  onSetUsbMode={(mode) => sportidentSerial.setUsbMode(mode)}
                  onSetBaudRate={(baud) => sportidentSerial.setBaudRate(baud)}
                  onSendDirectMode={async () => {
                    await sportidentSerial.requestDirectMode();
                  }}
                  onRequestSysConfig={async () => {
                    await sportidentSerial.requestSystemConfig();
                  }}
                  onTriggerStationBeep={async () => {
                    await sportidentSerial.triggerStationBeep(1);
                  }}
                  onCreateStation={async (payload) => {
                    const res = await apiFetch('/api/stations', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    });
                    if (!res.ok) {
                      const err = (await res.json().catch(() => ({}))) as { error?: string };
                      return err.error ?? 'Kunde inte spara station.';
                    }
                    return null;
                  }}
                  onDeleteStation={async (id) => {
                    await apiFetch(`/api/stations/${id}`, { method: 'DELETE' });
                  }}
                  onOpenProtocolInspector={() => setActiveTab('protocol')}
                />
              )}

              {activeTab === 'access' && isAdminSession && (
                <AccessControlView
                  activeEventId={activeEventId}
                  competitionName={isEmptySeason ? 'Ingen aktiv tävling' : competition.name}
                  enableFeesAndSwish={!isEmptySeason && Boolean(competition.enableFeesAndSwish)}
                  competitionsList={competitionsList}
                  competitors={competitors}
                  classes={classes}
                  clubSettings={clubSettings}
                  seriesStandings={seriesStandings}
                  currentUser={authSession.user}
                  onApplyStateSnapshot={applySnapshot}
                  onOpenCreateCompetition={() => {
                    setNewEvtFeesAndSwish(false);
                    setCreateEventModalOpen(true);
                  }}
                  onOpenPublicEvent={(code) => navigatePublicPortal(code)}
                />
              )}

              {activeTab === 'protocol' && (
                <ProtocolInspectorView
                  frameLogs={frameLogs}
                  initialHexToInspect={inspectHexTarget}
                  onInjectOnlineHexFrame={handleInjectOnlineHex}
                  onClearFrameLogs={() => setFrameLogs([])}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
