import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Play,
  RefreshCw,
  Search,
  Timer,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  CompClass,
  CompetitionMeta,
  Competitor,
  RunnerDbEntry,
  SICardSeries,
} from '../types/sportident';
import {
  formatSecondsAsClock,
  formatSiNumber,
  inferCardSeries,
} from '../services/sportidentProtocol';
import {
  playMeosFeedbackTone,
  type SerialConnectionStatus,
  type UsbStationMode,
} from '../services/sportidentWebSerial';
import { RunnerStatusIndicator } from './StatusLabels';
import { UsbStationBar, UsbStationErrorBanner } from './UsbStationBar';

type StartUsbAction = 'PUNCH_START' | 'CHECK_ONLY';

const START_USB_ACTION_KEY = 'passersi_start_usb_action';

interface PendingStartCardResolution {
  siNumber: number;
  cardSeries: SICardSeries;
  dipClockSec: number;
  actionAtDip: StartUsbAction;
  dbOwner: RunnerDbEntry | null;
  reassignedFromCompetitor?: {
    id: string;
    bib: number;
    fullName: string;
  } | null;
}

interface StartCorralViewProps {
  competition: CompetitionMeta;
  classes: CompClass[];
  competitors: Competitor[];
  runnerDb: RunnerDbEntry[];
  serialStatus: SerialConnectionStatus;
  capturedCard: {
    siNumber: number;
    cardSeries: SICardSeries;
    capturedAt: number;
    mode: UsbStationMode;
  } | null;
  soundEnabled: boolean;
  onConnectUsb: () => Promise<void>;
  onConnectWebUsb: () => Promise<void>;
  onDisconnectUsb: () => Promise<void>;
  onSetUsbMode: (mode: UsbStationMode) => void;
  onTriggerStationBeep: () => Promise<void>;
  onClearUsbError: () => void;
  onOpenHardwareSettings?: () => void;
  onOpenEntriesWithSi: (siNumber: number, cardSeries: SICardSeries) => void;
  onCreateCompetitor: (payload: Partial<Competitor>) => Promise<string | null>;
  onUpdateCompetitor: (id: string, patch: Partial<Competitor>) => Promise<void>;
}

function getStockholmClockSecondsNow(): number {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const ss = Number(parts.find((p) => p.type === 'second')?.value ?? '0');
    return hh * 3600 + mm * 60 + ss;
  } catch {
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }
}

export function StartCorralView({
  competition,
  classes,
  competitors,
  runnerDb,
  serialStatus,
  capturedCard,
  soundEnabled,
  onConnectUsb,
  onConnectWebUsb,
  onDisconnectUsb,
  onSetUsbMode,
  onTriggerStationBeep,
  onClearUsbError,
  onOpenHardwareSettings,
  onOpenEntriesWithSi,
  onCreateCompetitor,
  onUpdateCompetitor,
}: StartCorralViewProps) {
  // Real-time 24h Swedish clock by default so BSM8 Pinnstart matches forest SI stations; Testklocka available for pre-race rehearsal
  const [clockMode, setClockMode] = useState<'REALTIME' | 'RACE_SIM'>('REALTIME');
  const [simBaseSec, setSimBaseSec] = useState<number>(() => competition.zeroTimeSec + 110);
  const [wallSec, setWallSec] = useState<number>(() => getStockholmClockSecondsNow());
  const [corralOffsetMin, setCorralOffsetMin] = useState<number>(0);
  const [startBeepEnabled, setStartBeepEnabled] = useState<boolean>(false);

  const [startUsbAction, setStartUsbAction] = useState<StartUsbAction>(() => {
    try {
      const saved = localStorage.getItem(START_USB_ACTION_KEY);
      if (saved === 'CHECK_ONLY' || saved === 'PUNCH_START') return saved;
    } catch {
      // ignore
    }
    return 'PUNCH_START';
  });

  const handleSelectUsbAction = (next: StartUsbAction) => {
    setStartUsbAction(next);
    try {
      localStorage.setItem(START_USB_ACTION_KEY, next);
    } catch {
      // ignore
    }
  };

  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'NOT_STARTED' | 'CHECKED' | 'FREE_START' | 'DNS'
  >('ALL');
  const [search, setSearch] = useState<string>('');

  // Inline SI card swap at start line
  const [swappingRunnerId, setSwappingRunnerId] = useState<string | null>(null);
  const [swapSiInput, setSwapSiInput] = useState<string>('');
  const [savingCardSwapId, setSavingCardSwapId] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<{
    tone: 'ok' | 'warn';
    text: string;
    rollbackRunner?: {
      id: string;
      bib: number;
      fullName: string;
      siNumber: number;
      cardSeries: SICardSeries;
      dipClockSec: number;
      actionAtDip: StartUsbAction;
    };
  } | null>(null);

  // Inline resolution panel when an unknown or unentered/borrowed SI-stick is dipped at Start!
  const [pendingStartCard, setPendingStartCard] =
    useState<PendingStartCardResolution | null>(null);
  const [dbOwnerClassId, setDbOwnerClassId] = useState<string>('');
  const [borrowTargetRunnerId, setBorrowTargetRunnerId] = useState<string>('');
  const [borrowSearch, setBorrowSearch] = useState<string>('');
  const [newRunnerName, setNewRunnerName] = useState<string>('');
  const [newRunnerClub, setNewRunnerClub] = useState<string>('');
  const [newRunnerClassId, setNewRunnerClassId] = useState<string>('');
  const [isBorrowedNew, setIsBorrowedNew] = useState<boolean>(false);
  const [resolvingBusy, setResolvingBusy] = useState<boolean>(false);

  const simCursorRef = useRef<number>(0);
  const lastDipBySiRef = useRef<{ si: number; atMs: number }>({ si: 0, atMs: 0 });

  const startBeepRef = useRef(startBeepEnabled);
  useEffect(() => {
    startBeepRef.current = startBeepEnabled;
  }, [startBeepEnabled]);

  useEffect(() => {
    setSimBaseSec(competition.zeroTimeSec + 110);
  }, [competition.id, competition.zeroTimeSec]);

  // Whenever a physical USB SI-station is connected, ensure REALTIME Swedish clock is active so Pinnstart matches forest control clocks
  useEffect(() => {
    if (serialStatus.connected) {
      setClockMode('REALTIME');
    }
  }, [serialStatus.connected]);

  // 1-second precision start clock ticker + optional MeOS/O-Tid start countdown beeps (-5..-1s & :00)
  useEffect(() => {
    const timer = setInterval(() => {
      const nextWall = getStockholmClockSecondsNow();
      setWallSec(nextWall);
      setSimBaseSec((prev) => (prev + 1) % 86400);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeClockSec = clockMode === 'REALTIME' ? wallSec : simBaseSec;
  const callupClockSec = (activeClockSec + corralOffsetMin * 60) % 86400;
  const secInMinute = activeClockSec % 60;

  useEffect(() => {
    if (!startBeepRef.current) return;
    if (secInMinute >= 55 && secInMinute <= 59) {
      playMeosFeedbackTone('start_tick');
    } else if (secInMinute === 0) {
      playMeosFeedbackTone('start_go');
    }
  }, [secInMinute]);

  const openPendingCardPanel = useCallback(
    (params: PendingStartCardResolution) => {
      const defaultCls =
        (params.dbOwner?.defaultClassName
          ? classes.find(
              (c) =>
                c.name.toLowerCase() === params.dbOwner!.defaultClassName!.toLowerCase()
            )
          : undefined) ??
        classes.find((c) => c.autoMatchCourse) ??
        classes[0];

      const waitingInList = competitors.filter(
        (c) =>
          (c.status === 'REGISTERED' || c.status === 'CHECKED') &&
          c.id !== params.reassignedFromCompetitor?.id
      );

      setPendingStartCard(params);
      setDbOwnerClassId(defaultCls?.id ?? '');
      setBorrowSearch('');
      setBorrowTargetRunnerId(waitingInList[0]?.id ?? '');
      setNewRunnerName('');
      setNewRunnerClub(competition.organizer || '');
      setNewRunnerClassId(defaultCls?.id ?? '');
      setIsBorrowedNew(Boolean(params.dbOwner || params.reassignedFromCompetitor));
    },
    [classes, competition.organizer, competitors]
  );

  const processCardDipAtStart = useCallback(
    async (siNumber: number, cardSeries: SICardSeries) => {
      const nowMs = Date.now();
      if (
        !swappingRunnerId &&
        lastDipBySiRef.current.si === siNumber &&
        nowMs - lastDipBySiRef.current.atMs < 2000
      ) {
        return;
      }
      lastDipBySiRef.current = { si: siNumber, atMs: nowMs };

      if (swappingRunnerId) {
        setSwapSiInput(String(siNumber));
        setFeedbackNotice({
          tone: 'ok',
          text: `SI-bricka ${formatSiNumber(siNumber)} inläst för brickbyte — klicka Spara på raden.`,
        });
        return;
      }

      const stampSec = activeClockSec;
      // Match active un-finished runner in today's start list
      const matched = competitors.find(
        (c) =>
          c.siNumber === siNumber &&
          (c.status === 'REGISTERED' ||
            c.status === 'CHECKED' ||
            c.status === 'IN_FOREST' ||
            c.status === 'PRELIMINARY_FIN')
      );

      if (matched) {
        setPendingStartCard(null);
        if (matched.status === 'PRELIMINARY_FIN') {
          if (soundEnabled) playMeosFeedbackTone('mp');
          setFeedbackNotice({
            tone: 'warn',
            text: `OBS: #${matched.bib} ${matched.fullName} (SI ${formatSiNumber(
              matched.siNumber
            )}) har redan målstämplat — starttiden ändrades inte.`,
          });
          return;
        }

        if (startUsbAction === 'PUNCH_START') {
          await onUpdateCompetitor(matched.id, {
            status: 'IN_FOREST',
            startTimeSec: stampSec,
            checkTimeSec: matched.checkTimeSec ?? stampSec,
            lastSeenControl: 20,
            lastSeenTimeSec: stampSec,
          });
          if (soundEnabled) playMeosFeedbackTone('start_go');
          setFeedbackNotice({
            tone: 'ok',
            text: `Pinnstart kl. ${formatSecondsAsClock(stampSec)} — #${matched.bib} ${
              matched.fullName
            } (SI ${formatSiNumber(matched.siNumber)}) är utstämplad i skogen.`,
            rollbackRunner: {
              id: matched.id,
              bib: matched.bib,
              fullName: matched.fullName,
              siNumber: matched.siNumber,
              cardSeries: matched.cardSeries,
              dipClockSec: stampSec,
              actionAtDip: 'PUNCH_START',
            },
          });
        } else {
          if (matched.status === 'IN_FOREST') {
            setFeedbackNotice({
              tone: 'warn',
              text: `#${matched.bib} ${matched.fullName} är redan registrerad som startad i skogen.`,
              rollbackRunner: {
                id: matched.id,
                bib: matched.bib,
                fullName: matched.fullName,
                siNumber: matched.siNumber,
                cardSeries: matched.cardSeries,
                dipClockSec: stampSec,
                actionAtDip: 'CHECK_ONLY',
              },
            });
            return;
          }
          await onUpdateCompetitor(matched.id, {
            status: 'CHECKED',
            checkTimeSec: stampSec,
          });
          if (soundEnabled) playMeosFeedbackTone('registration');
          setFeedbackNotice({
            tone: 'ok',
            text: `Checkad i startfållan kl. ${formatSecondsAsClock(stampSec)} — #${
              matched.bib
            } ${matched.fullName} (SI ${formatSiNumber(matched.siNumber)}).`,
            rollbackRunner: {
              id: matched.id,
              bib: matched.bib,
              fullName: matched.fullName,
              siNumber: matched.siNumber,
              cardSeries: matched.cardSeries,
              dipClockSec: stampSec,
              actionAtDip: 'CHECK_ONLY',
            },
          });
        }
        return;
      }

      // Not active in today's start list (either unentered club member in runnerDb, borrowed stick from finished/DNS runner, or completely unknown stick):
      // Freeze exact dip timestamp and open fast inline confirmation/borrow panel right in Startfålla!
      const dbOwner = runnerDb.find((r) => r.siNumber === siNumber) ?? null;
      const finishedOrDnsHolder =
        competitors.find((c) => c.siNumber === siNumber) ?? null;

      if (soundEnabled) {
        playMeosFeedbackTone(dbOwner ? 'registration' : 'mp');
      }
      setFeedbackNotice(null);
      openPendingCardPanel({
        siNumber,
        cardSeries,
        dipClockSec: stampSec,
        actionAtDip: startUsbAction,
        dbOwner:
          dbOwner ??
          (finishedOrDnsHolder && finishedOrDnsHolder.status !== 'DNS'
            ? {
                id: finishedOrDnsHolder.id,
                siNumber: finishedOrDnsHolder.siNumber,
                cardSeries: finishedOrDnsHolder.cardSeries,
                fullName: finishedOrDnsHolder.fullName,
                club: finishedOrDnsHolder.club,
                birthYear: null,
                defaultClassName:
                  classes.find((c) => c.id === finishedOrDnsHolder.classId)?.name ?? null,
                eventorPersonId: null,
                eventorOrgId: null,
                source: 'LEARNED_ENTRY',
                updatedAt: '',
              }
            : null),
        reassignedFromCompetitor:
          finishedOrDnsHolder &&
          (finishedOrDnsHolder.status === 'OK' ||
            finishedOrDnsHolder.status === 'MP' ||
            finishedOrDnsHolder.status === 'DNS')
            ? {
                id: finishedOrDnsHolder.id,
                bib: finishedOrDnsHolder.bib,
                fullName:
                  finishedOrDnsHolder.status === 'DNS'
                    ? `${finishedOrDnsHolder.fullName} (Ej start / DNS)`
                    : `${finishedOrDnsHolder.fullName} (redan i mål)`,
              }
            : null,
      });
    },
    [
      activeClockSec,
      classes,
      competitors,
      onUpdateCompetitor,
      openPendingCardPanel,
      runnerDb,
      soundEnabled,
      startUsbAction,
      swappingRunnerId,
    ]
  );

  // Revert a falsely matched pre-entered stick owner to DNS & open borrower panel with exact dip timestamp preserved!
  const handleWrongPersonRollback = async () => {
    if (!feedbackNotice?.rollbackRunner) return;
    const rb = feedbackNotice.rollbackRunner;
    await onUpdateCompetitor(rb.id, {
      status: 'DNS',
      checkTimeSec: null,
      startTimeSec: null,
      lastSeenControl: null,
      lastSeenTimeSec: null,
    });
    setFeedbackNotice(null);
    openPendingCardPanel({
      siNumber: rb.siNumber,
      cardSeries: rb.cardSeries,
      dipClockSec: rb.dipClockSec,
      actionAtDip: rb.actionAtDip,
      dbOwner: null,
      reassignedFromCompetitor: {
        id: rb.id,
        bib: rb.bib,
        fullName: rb.fullName,
      },
    });
  };

  // 1. Confirm it really IS the owner from Löpardatabasen
  const handleConfirmDbOwnerAtStart = async () => {
    if (!pendingStartCard?.dbOwner || classes.length === 0) return;
    setResolvingBusy(true);
    try {
      const owner = pendingStartCard.dbOwner;
      const clsId = dbOwnerClassId || classes[0].id;
      const clsName = classes.find((c) => c.id === clsId)?.name ?? '-';
      const stamp = pendingStartCard.dipClockSec;
      const isPunchStart = pendingStartCard.actionAtDip === 'PUNCH_START';

      const existingDns = competitors.find(
        (c) =>
          c.siNumber === pendingStartCard.siNumber &&
          c.status === 'DNS' &&
          c.fullName.trim().toLowerCase() === owner.fullName.trim().toLowerCase()
      );

      if (existingDns) {
        await onUpdateCompetitor(existingDns.id, {
          classId: clsId,
          status: isPunchStart ? 'IN_FOREST' : 'CHECKED',
          checkTimeSec: stamp,
          startTimeSec: isPunchStart ? stamp : null,
          lastSeenControl: isPunchStart ? 20 : null,
          lastSeenTimeSec: isPunchStart ? stamp : null,
        });
        if (soundEnabled) {
          playMeosFeedbackTone(isPunchStart ? 'start_go' : 'registration');
        }
        setPendingStartCard(null);
        setFeedbackNotice({
          tone: 'ok',
          text: isPunchStart
            ? `Pinnstart kl. ${formatSecondsAsClock(stamp)} — #${existingDns.bib} ${owner.fullName} (${clsName}) återaktiverad & utstämplad.`
            : `Checkad kl. ${formatSecondsAsClock(stamp)} — #${existingDns.bib} ${owner.fullName} (${clsName}) återaktiverad i startfållan.`,
        });
        return;
      }

      const err = await onCreateCompetitor({
        siNumber: pendingStartCard.siNumber,
        cardSeries: pendingStartCard.cardSeries,
        fullName: owner.fullName,
        club: owner.club,
        classId: clsId,
        status: isPunchStart ? 'IN_FOREST' : 'CHECKED',
        checkTimeSec: stamp,
        startTimeSec: isPunchStart ? stamp : null,
        lastSeenControl: isPunchStart ? 20 : null,
        lastSeenTimeSec: isPunchStart ? stamp : null,
      });
      if (!err) {
        if (soundEnabled) {
          playMeosFeedbackTone(isPunchStart ? 'start_go' : 'registration');
        }
        setPendingStartCard(null);
        setFeedbackNotice({
          tone: 'ok',
          text: isPunchStart
            ? `Pinnstart kl. ${formatSecondsAsClock(stamp)} — ${owner.fullName} (${owner.club}, ${clsName}) direktanmäld & utstämplad i skogen.`
            : `Checkad kl. ${formatSecondsAsClock(stamp)} — ${owner.fullName} (${owner.club}, ${clsName}) direktanmäld i startfållan.`,
        });
      } else {
        setFeedbackNotice({ tone: 'warn', text: err });
      }
    } finally {
      setResolvingBusy(false);
    }
  };

  // 2. Link unknown/borrowed stick to an ALREADY pre-entered runner in today's start list (Brickbyte + Check/Pinnstart)
  const handleAssignStickToExistingRunner = async () => {
    if (!pendingStartCard || !borrowTargetRunnerId) return;
    const target = competitors.find((c) => c.id === borrowTargetRunnerId);
    if (!target) return;

    setResolvingBusy(true);
    try {
      const stamp = pendingStartCard.dipClockSec;
      const isPunchStart = pendingStartCard.actionAtDip === 'PUNCH_START';
      await onUpdateCompetitor(target.id, {
        siNumber: pendingStartCard.siNumber,
        cardSeries: pendingStartCard.cardSeries,
        isBorrowedCard: true,
        status: isPunchStart ? 'IN_FOREST' : 'CHECKED',
        checkTimeSec: target.checkTimeSec ?? stamp,
        startTimeSec: isPunchStart ? stamp : target.startTimeSec,
        lastSeenControl: isPunchStart ? 20 : target.lastSeenControl,
        lastSeenTimeSec: isPunchStart ? stamp : target.lastSeenTimeSec,
      });
      if (soundEnabled) {
        playMeosFeedbackTone(isPunchStart ? 'start_go' : 'registration');
      }
      setPendingStartCard(null);
      setFeedbackNotice({
        tone: 'ok',
        text: isPunchStart
          ? `Brickbyte + Pinnstart kl. ${formatSecondsAsClock(stamp)} — SI ${formatSiNumber(
              pendingStartCard.siNumber
            )} kopplad till #${target.bib} ${target.fullName}.`
          : `Brickbyte + Check kl. ${formatSecondsAsClock(stamp)} — SI ${formatSiNumber(
              pendingStartCard.siNumber
            )} kopplad till #${target.bib} ${target.fullName}.`,
      });
    } finally {
      setResolvingBusy(false);
    }
  };

  // 3. Register a brand-new runner right at Start (with borrowed or new SI-stick)
  const handleCreateNewRunnerAtStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingStartCard || !newRunnerName.trim() || classes.length === 0) return;
    setResolvingBusy(true);
    try {
      const clsId = newRunnerClassId || classes[0].id;
      const clsName = classes.find((c) => c.id === clsId)?.name ?? '-';
      const stamp = pendingStartCard.dipClockSec;
      const isPunchStart = pendingStartCard.actionAtDip === 'PUNCH_START';

      const err = await onCreateCompetitor({
        siNumber: pendingStartCard.siNumber,
        cardSeries: pendingStartCard.cardSeries,
        fullName: newRunnerName.trim(),
        club: newRunnerClub.trim() || competition.organizer || 'Klubblös',
        classId: clsId,
        isBorrowedCard: isBorrowedNew,
        status: isPunchStart ? 'IN_FOREST' : 'CHECKED',
        checkTimeSec: stamp,
        startTimeSec: isPunchStart ? stamp : null,
        lastSeenControl: isPunchStart ? 20 : null,
        lastSeenTimeSec: isPunchStart ? stamp : null,
      });
      if (!err) {
        if (soundEnabled) {
          playMeosFeedbackTone(isPunchStart ? 'start_go' : 'registration');
        }
        setPendingStartCard(null);
        setFeedbackNotice({
          tone: 'ok',
          text: isPunchStart
            ? `Anmäld + Pinnstart kl. ${formatSecondsAsClock(stamp)} — ${newRunnerName.trim()} (${clsName}, SI ${formatSiNumber(
                pendingStartCard.siNumber
              )}).`
            : `Anmäld + Checkad kl. ${formatSecondsAsClock(stamp)} — ${newRunnerName.trim()} (${clsName}, SI ${formatSiNumber(
                pendingStartCard.siNumber
              )}).`,
        });
      } else {
        setFeedbackNotice({ tone: 'warn', text: err });
      }
    } finally {
      setResolvingBusy(false);
    }
  };

  // Trigger on physical USB SI-card insertion when StartCorralView is open
  const lastHandledCaptureAtRef = useRef<number>(0);
  useEffect(() => {
    if (!capturedCard || capturedCard.mode !== 'START_CORRAL') return;
    if (lastHandledCaptureAtRef.current === capturedCard.capturedAt) return;
    lastHandledCaptureAtRef.current = capturedCard.capturedAt;
    void processCardDipAtStart(capturedCard.siNumber, capturedCard.cardSeries);
  }, [capturedCard, processCardDipAtStart]);

  const handleSimulateStartDip = () => {
    const waitingRunners = competitors.filter(
      (c) => c.status === 'REGISTERED' || c.status === 'CHECKED'
    );
    if (waitingRunners.length > 0) {
      const picked = waitingRunners[simCursorRef.current % waitingRunners.length];
      simCursorRef.current += 1;
      void processCardDipAtStart(picked.siNumber, picked.cardSeries);
      return;
    }
    const unenteredDb = runnerDb.filter(
      (r) => !competitors.some((c) => c.siNumber === r.siNumber)
    );
    if (unenteredDb.length > 0) {
      const picked = unenteredDb[simCursorRef.current % unenteredDb.length];
      simCursorRef.current += 1;
      void processCardDipAtStart(picked.siNumber, picked.cardSeries);
      return;
    }
    const fallbackSi = 8540100 + Math.floor(Math.random() * 890);
    void processCardDipAtStart(fallbackSi, inferCardSeries(fallbackSi));
  };

  const currentMinuteFloor = Math.floor(callupClockSec / 60) * 60;
  const nextMinuteFloor = currentMinuteFloor + 60;

  const currentMinuteRunners = useMemo(
    () =>
      competitors
        .filter(
          (c) =>
            c.allocatedStartSec !== null &&
            Math.floor(c.allocatedStartSec / 60) * 60 === currentMinuteFloor
        )
        .sort((a, b) => (a.allocatedStartSec ?? 0) - (b.allocatedStartSec ?? 0)),
    [competitors, currentMinuteFloor]
  );

  const nextMinuteRunners = useMemo(
    () =>
      competitors
        .filter(
          (c) =>
            c.allocatedStartSec !== null &&
            Math.floor(c.allocatedStartSec / 60) * 60 === nextMinuteFloor
        )
        .sort((a, b) => (a.allocatedStartSec ?? 0) - (b.allocatedStartSec ?? 0)),
    [competitors, nextMinuteFloor]
  );

  const filteredStartList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return competitors
      .filter((r) => {
        const cls = classes.find((c) => c.id === r.classId);
        if (classFilter !== 'ALL' && r.classId !== classFilter) return false;
        if (statusFilter === 'NOT_STARTED' && r.status !== 'REGISTERED') return false;
        if (statusFilter === 'CHECKED' && r.status !== 'CHECKED') return false;
        if (statusFilter === 'FREE_START' && !cls?.freeStart && r.allocatedStartSec !== null) {
          return false;
        }
        if (statusFilter === 'DNS' && r.status !== 'DNS') return false;

        if (!q) return true;
        return (
          r.fullName.toLowerCase().includes(q) ||
          r.club.toLowerCase().includes(q) ||
          String(r.bib).includes(q) ||
          String(r.siNumber).includes(q)
        );
      })
      .sort((a, b) => {
        const sa = a.allocatedStartSec ?? 999999;
        const sb = b.allocatedStartSec ?? 999999;
        if (sa !== sb) return sa - sb;
        return a.bib - b.bib;
      });
  }, [competitors, classes, classFilter, statusFilter, search]);

  const handleSaveCardSwap = async (
    event: React.FormEvent<HTMLFormElement>,
    runner: Competitor
  ) => {
    event.preventDefault();
    const newSiNumber = Number(swapSiInput.trim());
    if (!Number.isSafeInteger(newSiNumber) || newSiNumber < 1000) {
      setFeedbackNotice({
        tone: 'warn',
        text: 'Ange ett giltigt SI-bricknummer på minst 1000.',
      });
      return;
    }

    setSavingCardSwapId(runner.id);
    try {
      await onUpdateCompetitor(runner.id, {
        siNumber: newSiNumber,
        cardSeries: inferCardSeries(newSiNumber),
      });
      setFeedbackNotice({
        tone: 'ok',
        text: `Brickbyte sparat vid startlinjen för #${runner.bib} ${runner.fullName}: ny SI ${formatSiNumber(
          newSiNumber
        )}.`,
      });
      setSwappingRunnerId(null);
      setSwapSiInput('');
    } catch (error) {
      console.error('Kunde inte spara brickbyte i Firestore:', error);
      setFeedbackNotice({
        tone: 'warn',
        text:
          error instanceof Error
            ? `Kunde inte spara det nya bricknumret: ${error.message}`
            : 'Kunde inte spara det nya bricknumret i Firestore.',
      });
    } finally {
      setSavingCardSwapId(null);
    }
  };

  const checkedCount = competitors.filter((c) => c.status === 'CHECKED').length;
  const startedCount = competitors.filter(
    (c) =>
      c.status === 'IN_FOREST' ||
      c.status === 'PRELIMINARY_FIN' ||
      c.status === 'OK' ||
      c.status === 'MP'
  ).length;
  const waitingCount = competitors.filter((c) => c.status === 'REGISTERED').length;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Startfålla, Pinnstart & E-startlista
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pinnstart eller avprickning via SI-station, minutupprop och brickbyte vid startlinjen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <UsbStationBar
            serialStatus={serialStatus}
            roleLabel={startUsbAction === 'PUNCH_START' ? 'Pinnstart' : 'Check'}
            expectedMode="START_CORRAL"
            onConnectUsb={onConnectUsb}
            onConnectWebUsb={onConnectWebUsb}
            onDisconnectUsb={onDisconnectUsb}
            onSetUsbMode={onSetUsbMode}
            onTriggerBeep={onTriggerStationBeep}
            onClearError={onClearUsbError}
            onOpenHardwareSettings={onOpenHardwareSettings}
          />

          <div
            role="group"
            aria-label="Funktion vid brickdopp i SI-station"
            className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-lg"
          >
            <button
              type="button"
              onClick={() => handleSelectUsbAction('PUNCH_START')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                startUsbAction === 'PUNCH_START'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
              title="Registrerar exakt starttid i databasen när löparen doppar sin SI-bricka"
            >
              Pinnstart (starttid)
            </button>
            <button
              type="button"
              onClick={() => handleSelectUsbAction('CHECK_ONLY')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                startUsbAction === 'CHECK_ONLY'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
              title="Prickar endast av löparen i startfållan (när separat fysisk startstämpel används)"
            >
              Endast check
            </button>
          </div>

          <button
            type="button"
            onClick={handleSimulateStartDip}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Simulera bricka
          </button>

          <button
            type="button"
            onClick={() => setStartBeepEnabled((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              startBeepEnabled
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-900 dark:border-slate-100'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {startBeepEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>Startpip: {startBeepEnabled ? 'På' : 'Av'}</span>
          </button>
        </div>
      </div>

      <UsbStationErrorBanner
        serialStatus={serialStatus}
        onConnectWebUsb={onConnectWebUsb}
        onClearError={onClearUsbError}
        onOpenHardwareSettings={onOpenHardwareSettings}
      />

      {feedbackNotice && (
        <div
          className={`px-3.5 py-2 text-xs font-medium rounded-lg border flex flex-wrap items-center justify-between gap-2 ${
            feedbackNotice.tone === 'ok'
              ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
              : 'text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60'
          }`}
        >
          <span>{feedbackNotice.text}</span>
          <div className="flex items-center gap-2.5 shrink-0">
            {feedbackNotice.rollbackRunner && (
              <button
                type="button"
                onClick={() => void handleWrongPersonRollback()}
                className="px-2.5 py-1 text-xs font-medium bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md whitespace-nowrap"
              >
                Fel person / Lånad bricka?
              </button>
            )}
            <button
              type="button"
              onClick={() => setFeedbackNotice(null)}
              className="hover:underline whitespace-nowrap"
            >
              Stäng
            </button>
          </div>
        </div>
      )}

      {pendingStartCard &&
        (() => {
          const dipTimeLabel = formatSecondsAsClock(pendingStartCard.dipClockSec);
          const isPunch = pendingStartCard.actionAtDip === 'PUNCH_START';
          const q = borrowSearch.trim().toLowerCase();
          const assignableRunners = competitors.filter((c) => {
            if (c.status !== 'REGISTERED' && c.status !== 'CHECKED') return false;
            if (c.id === pendingStartCard.reassignedFromCompetitor?.id) return false;
            if (!q) return true;
            return (
              c.fullName.toLowerCase().includes(q) ||
              c.club.toLowerCase().includes(q) ||
              String(c.bib).includes(q)
            );
          });

          const showDbOwnerConfirm =
            pendingStartCard.dbOwner && !pendingStartCard.reassignedFromCompetitor;

          return (
            <section className="bg-amber-50/70 dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-xl p-3.5 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-amber-200/80 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {pendingStartCard.reassignedFromCompetitor ? (
                      <>
                        Lånad SI-bricka{' '}
                        <span className="font-mono">
                          {formatSiNumber(pendingStartCard.siNumber)}
                        </span>{' '}
                        — #{pendingStartCard.reassignedFromCompetitor.bib}{' '}
                        {pendingStartCard.reassignedFromCompetitor.fullName} är nu satt som Ej start
                        (DNS)
                      </>
                    ) : pendingStartCard.dbOwner ? (
                      <>
                        Oanmäld bricka{' '}
                        <span className="font-mono">
                          {formatSiNumber(pendingStartCard.siNumber)}
                        </span>{' '}
                        — tillhör <strong>{pendingStartCard.dbOwner.fullName}</strong> (
                        {pendingStartCard.dbOwner.club}) i Löpardatabasen
                      </>
                    ) : (
                      <>
                        Okänd SI-bricka{' '}
                        <span className="font-mono">
                          {formatSiNumber(pendingStartCard.siNumber)}
                        </span>{' '}
                        ({pendingStartCard.cardSeries}) vid start
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    Tidpunkt sparad vid dopp:{' '}
                    <span className="font-mono font-semibold">{dipTimeLabel}</span> · Välj vem som
                    springer med brickan nedan (utan att lämna startfållan).
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const { siNumber, cardSeries } = pendingStartCard;
                      setPendingStartCard(null);
                      onOpenEntriesWithSi(siNumber, cardSeries);
                    }}
                    className="text-slate-600 dark:text-slate-300 hover:underline whitespace-nowrap"
                  >
                    Öppna full Direktanmälan
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <button
                    type="button"
                    onClick={() => setPendingStartCard(null)}
                    className="font-medium text-slate-700 dark:text-slate-200 hover:underline whitespace-nowrap"
                  >
                    Avbryt
                  </button>
                </div>
              </div>

              {/* Option 1: Confirm it really IS the owner from Löpardatabasen */}
              {showDbOwnerConfirm && pendingStartCard.dbOwner && (
                <div className="bg-white dark:bg-slate-950 border border-emerald-200 dark:border-emerald-900/60 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    1. Är det <strong>{pendingStartCard.dbOwner.fullName}</strong> (
                    {pendingStartCard.dbOwner.club}) som startar själv?
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={dbOwnerClassId}
                      onChange={(e) => setDbOwnerClassId(e.target.value)}
                      className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                    >
                      {classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={resolvingBusy}
                      onClick={() => void handleConfirmDbOwnerAtStart()}
                      className="inline-flex items-center gap-1 px-3 py-1 font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        {isPunch
                          ? `Ja, pinnstarta (${dipTimeLabel})`
                          : 'Ja, anmäl & checka in'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Option 2: Assign stick (Brickbyte) to an already pre-entered runner in today's start list */}
              {competitors.some(
                (c) =>
                  (c.status === 'REGISTERED' || c.status === 'CHECKED') &&
                  c.id !== pendingStartCard.reassignedFromCompetitor?.id
              ) && (
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-2">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {showDbOwnerConfirm ? '2. ' : '1. '}Koppla brickan till redan anmäld löpare i
                    startlistan (Brickbyte)
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                    <input
                      type="search"
                      value={borrowSearch}
                      onChange={(e) => {
                        const val = e.target.value;
                        setBorrowSearch(val);
                        const firstMatch = competitors.find((c) => {
                          if (c.status !== 'REGISTERED' && c.status !== 'CHECKED') return false;
                          if (c.id === pendingStartCard.reassignedFromCompetitor?.id) return false;
                          const ql = val.trim().toLowerCase();
                          if (!ql) return true;
                          return (
                            c.fullName.toLowerCase().includes(ql) ||
                            String(c.bib).includes(ql)
                          );
                        });
                        if (firstMatch) setBorrowTargetRunnerId(firstMatch.id);
                      }}
                      placeholder="Filtrera namn / startnr..."
                      className="sm:w-44 px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                    <select
                      value={borrowTargetRunnerId}
                      onChange={(e) => setBorrowTargetRunnerId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                    >
                      {assignableRunners.length === 0 ? (
                        <option value="">Inga matchande löpare</option>
                      ) : (
                        assignableRunners.map((r) => {
                          const cName = classes.find((c) => c.id === r.classId)?.name ?? '-';
                          const st =
                            r.allocatedStartSec !== null
                              ? formatSecondsAsClock(r.allocatedStartSec).slice(0, 5)
                              : 'Fri';
                          return (
                            <option key={r.id} value={r.id}>
                              #{r.bib} {r.fullName} · {cName} ({st})
                            </option>
                          );
                        })
                      )}
                    </select>
                    <button
                      type="button"
                      disabled={resolvingBusy || !borrowTargetRunnerId || assignableRunners.length === 0}
                      onClick={() => void handleAssignStickToExistingRunner()}
                      className="inline-flex items-center justify-center gap-1 px-3 py-1 font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>
                        {isPunch
                          ? `Byt bricka & starta (${dipTimeLabel})`
                          : 'Byt bricka & checka in'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Option 3: Brand-new direct entry right at the start corral (borrowed or new stick) */}
              <form
                onSubmit={(e) => void handleCreateNewRunnerAtStart(e)}
                className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    Ny oanmäld löpare på denna bricka (direktanmäl här vid start)
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isBorrowedNew}
                      onChange={(e) => setIsBorrowedNew(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700"
                    />
                    <span>Lånad bricka (spara ej som ägare i Löpardatabas)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-1.5">
                  <input
                    type="text"
                    required
                    value={newRunnerName}
                    onChange={(e) => setNewRunnerName(e.target.value)}
                    placeholder="För- och efternamn"
                    className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                  <input
                    type="text"
                    value={newRunnerClub}
                    onChange={(e) => setNewRunnerClub(e.target.value)}
                    placeholder="Klubb"
                    className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                  <select
                    value={newRunnerClassId}
                    onChange={(e) => setNewRunnerClassId(e.target.value)}
                    className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={resolvingBusy || !newRunnerName.trim()}
                    className="inline-flex items-center justify-center gap-1 px-3 py-1 font-medium club-accent-btn disabled:opacity-50 rounded-md whitespace-nowrap"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>
                      {isPunch ? `Anmäl & starta (${dipTimeLabel})` : 'Anmäl & checka in'}
                    </span>
                  </button>
                </div>
              </form>
            </section>
          );
        })()}

      {/* Digital Start Clock + Minute Call-up Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
        <section className="lg:col-span-5 bg-slate-900 dark:bg-slate-900 text-white border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
              <Timer className="w-3.5 h-3.5 text-red-400" />
              <span>Startklocka {corralOffsetMin > 0 ? `(+${corralOffsetMin} min)` : '(Start)'}</span>
            </span>

            <div className="inline-flex items-center gap-1 p-0.5 bg-slate-800 rounded-md">
              <button
                type="button"
                onClick={() => setClockMode('REALTIME')}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors whitespace-nowrap ${
                  clockMode === 'REALTIME'
                    ? 'bg-slate-700 text-white font-medium'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Realtid
              </button>
              <button
                type="button"
                disabled={serialStatus.connected}
                onClick={() => setClockMode('RACE_SIM')}
                title={
                  serialStatus.connected
                    ? 'Realtid är låst när fysisk SI-station är ansluten'
                    : 'Testa upprop från tävlingens nolltid'
                }
                className={`px-2 py-0.5 text-[11px] rounded transition-colors whitespace-nowrap disabled:opacity-40 ${
                  clockMode === 'RACE_SIM'
                    ? 'bg-slate-700 text-white font-medium'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Testklocka
              </button>
            </div>
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <div className="text-3xl sm:text-4xl font-mono tabular-nums font-bold tracking-tight">
              {formatSecondsAsClock(callupClockSec)}
            </div>
            <div className="text-right text-[11px] text-slate-400 font-mono tabular-nums">
              <div>Nästa: {60 - secInMinute} s</div>
              {clockMode === 'RACE_SIM' && (
                <button
                  type="button"
                  onClick={() => setSimBaseSec((prev) => (prev + 60) % 86400)}
                  className="text-red-400 hover:underline font-sans"
                >
                  +1 min
                </button>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-slate-400 text-[11px]">Fålla:</span>
              {[0, 1, 2, 3].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCorralOffsetMin(m)}
                  className={`px-2 py-0.5 text-[11px] rounded font-mono tabular-nums transition-colors whitespace-nowrap ${
                    corralOffsetMin === m
                      ? 'bg-red-600 text-white font-semibold'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {m === 0 ? '0' : `+${m}m`}
                </button>
              ))}
            </div>

            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {waitingCount} kvar · {checkedCount} check · {startedCount} ut
            </div>
          </div>
        </section>

        {/* Active & Next Minute Call-up Columns */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-1.5">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Startar nu ({formatSecondsAsClock(currentMinuteFloor).slice(0, 5)})
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {currentMinuteRunners.length} st
              </span>
            </div>
            {currentMinuteRunners.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                Inga starter denna minut.
              </p>
            ) : (
              <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {currentMinuteRunners.map((r) => {
                  const cls = classes.find((c) => c.id === r.classId)?.name ?? '-';
                  return (
                    <div
                      key={r.id}
                      className="py-1.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          #{r.bib} {r.fullName}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono"> · {cls}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateCompetitor(r.id, {
                            status: 'IN_FOREST',
                            startTimeSec: r.allocatedStartSec ?? activeClockSec,
                          })
                        }
                        className="px-2 py-0.5 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded whitespace-nowrap shrink-0"
                      >
                        Starta
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-1.5">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Nästa minut ({formatSecondsAsClock(nextMinuteFloor).slice(0, 5)})
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {nextMinuteRunners.length} st
              </span>
            </div>
            {nextMinuteRunners.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                Inga starter nästa minut.
              </p>
            ) : (
              <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {nextMinuteRunners.map((r) => {
                  const cls = classes.find((c) => c.id === r.classId)?.name ?? '-';
                  return (
                    <div
                      key={r.id}
                      className="py-1.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          #{r.bib} {r.fullName}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono"> · {cls}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdateCompetitor(r.id, {
                            status: 'CHECKED',
                            checkTimeSec: activeClockSec,
                          })
                        }
                        className="px-2 py-0.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded whitespace-nowrap shrink-0"
                      >
                        Check
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Full Digital E-Startlista with Inline SI Card Swap */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="ALL">Alla klasser ({competitors.length})</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>

            <div className="inline-flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
              {(
                [
                  ['ALL', 'Alla'],
                  ['NOT_STARTED', 'Ej check'],
                  ['CHECKED', 'Checkade'],
                  ['FREE_START', 'Fri start'],
                  ['DNS', 'DNS'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === key
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full lg:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök startnr, namn, klubb eller SI..."
              className="w-full pl-8 pr-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="py-1.5 pl-3.5 pr-2 w-14 font-mono">Nr-lapp</th>
                <th className="py-1.5 px-2 w-28 font-mono">Bricknummer</th>
                <th className="py-1.5 px-2">Namn</th>
                <th className="hidden sm:table-cell py-1.5 px-2">Klubb</th>
                <th className="py-1.5 px-2 font-mono w-20">Starttid</th>
                <th className="hidden md:table-cell py-1.5 px-2">Klass</th>
                <th className="hidden lg:table-cell py-1.5 px-2">Status</th>
                <th className="py-1.5 pl-2 pr-3.5 text-right">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
              {filteredStartList.map((r) => {
                const cls = classes.find((c) => c.id === r.classId);
                const isSwapping = swappingRunnerId === r.id;

                const startClock =
                  r.startTimeSec !== null &&
                  (r.status === 'IN_FOREST' ||
                    r.status === 'PRELIMINARY_FIN' ||
                    r.status === 'OK' ||
                    r.status === 'MP') ? (
                    <span
                      className="text-emerald-700 dark:text-emerald-400"
                      title="Registrerad starttid"
                    >
                      {formatSecondsAsClock(r.startTimeSec)}
                    </span>
                  ) : r.allocatedStartSec !== null ? (
                    formatSecondsAsClock(r.allocatedStartSec)
                  ) : (
                    <span className="text-slate-500 font-normal">Fri</span>
                  );

                return (
                  <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-1.5 pl-3.5 pr-2 font-mono tabular-nums text-slate-500">
                      #{r.bib}
                    </td>

                    <td className="py-1.5 px-2 whitespace-nowrap">
                      {isSwapping ? (
                        <form
                          onSubmit={(event) => void handleSaveCardSwap(event, r)}
                          className="inline-flex items-center gap-1"
                        >
                          <input
                            type="text"
                            inputMode="numeric"
                            value={swapSiInput}
                            onChange={(e) => setSwapSiInput(e.target.value)}
                            placeholder="Ny SI"
                            disabled={savingCardSwapId === r.id}
                            className="w-24 px-1.5 py-0.5 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                            autoFocus
                          />
                          <button
                            type="submit"
                            disabled={savingCardSwapId === r.id}
                            className="px-2 py-0.5 text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 rounded"
                          >
                            {savingCardSwapId === r.id ? 'Sparar...' : 'Spara'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSwappingRunnerId(null);
                              setSwapSiInput('');
                            }}
                            disabled={savingCardSwapId === r.id}
                            className="px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-800"
                          >
                            Avbryt
                          </button>
                        </form>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                            {formatSiNumber(r.siNumber)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSwappingRunnerId(r.id);
                              setSwapSiInput(String(r.siNumber));
                            }}
                            className="inline-flex items-center gap-0.5 text-[11px] text-red-600 dark:text-red-400 hover:underline"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Byt</span>
                          </button>
                        </div>
                      )}
                    </td>

                    <td className="py-1.5 px-2 font-medium text-slate-900 dark:text-slate-100 truncate max-w-[170px]">
                      {r.fullName}
                    </td>

                    <td className="hidden sm:table-cell py-1.5 px-2 text-slate-600 dark:text-slate-400 truncate max-w-[150px]">
                      {r.club}
                    </td>

                    <td className="py-1.5 px-2 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {startClock}
                    </td>

                    <td className="hidden md:table-cell py-1.5 px-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {cls?.name ?? '-'}
                    </td>

                    <td className="hidden lg:table-cell py-1.5 px-2 whitespace-nowrap">
                      <RunnerStatusIndicator status={r.status} compact />
                    </td>

                    <td className="py-1.5 pl-2 pr-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateCompetitor(r.id, {
                              status: 'CHECKED',
                              checkTimeSec: activeClockSec,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                          title="Markera avprickad i förfållan"
                        >
                          <Check className="w-3 h-3" />
                          <span className="hidden sm:inline">Check</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateCompetitor(r.id, {
                              status: 'IN_FOREST',
                              startTimeSec: r.allocatedStartSec ?? activeClockSec,
                              checkTimeSec: r.checkTimeSec ?? activeClockSec,
                              lastSeenControl: 20,
                              lastSeenTimeSec: r.allocatedStartSec ?? activeClockSec,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded"
                          title="Registrera start och skicka ut i skogen"
                        >
                          <Play className="w-3 h-3" />
                          <span>Start</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void onUpdateCompetitor(r.id, {
                              status: 'DNS',
                            })
                          }
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:text-red-600 dark:hover:text-red-400 rounded"
                          title="Ej start (DNS)"
                        >
                          <span>DNS</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
