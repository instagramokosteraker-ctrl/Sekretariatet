import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CloudOff,
  Compass,
  Cpu,
  Radio,
  RefreshCw,
  Search,
  Send,
  Star,
  UserPlus,
  Wifi,
} from 'lucide-react';
import type {
  CardPunch,
  CompClass,
  Competitor,
  Course,
  LiveEventItem,
  SIStation,
} from '../types/sportident';
import type { OfflineQueueSnapshot } from '../services/offlineReadoutQueue';
import type {
  SerialConnectionStatus,
  UsbStationMode,
} from '../services/sportidentWebSerial';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
  formatSiNumber,
} from '../services/sportidentProtocol';
import { RunnerStatusIndicator, formatStationFunctionLabel } from './StatusLabels';
import { RunnerSplitCardModal } from './RunnerSplitCardModal';
import { UsbStationBar, UsbStationErrorBanner } from './UsbStationBar';

interface ReadoutDashboardProps {
  courses: Course[];
  classes: CompClass[];
  stations: SIStation[];
  competitors: Competitor[];
  runnerDbCount: number;
  events: LiveEventItem[];
  offlineSnap: OfflineQueueSnapshot;
  serialStatus: SerialConnectionStatus;
  onConnectUsb: () => Promise<void>;
  onConnectWebUsb: () => Promise<void>;
  onDisconnectUsb: () => Promise<void>;
  onSetUsbMode: (mode: UsbStationMode) => void;
  onTriggerStationBeep: () => Promise<void>;
  onClearUsbError: () => void;
  onOpenHardwareSettings?: () => void;
  onSetSimulatedOffline: (offline: boolean) => void;
  onFlushOfflineQueue: () => Promise<void>;
  selectedRunnerId: string | null;
  onSelectRunner: (id: string) => void;
  onMarkRentalReturned: (competitorId: string) => Promise<void>;
  onSimulateFullReadout: (params: {
    protocolKind?: 'SI10_EF' | 'SI6_E1' | 'SI5_B1';
    siNumber: number;
    checkTimeSec: number | null;
    startTimeSec: number | null;
    finishTimeSec: number | null;
    punches: CardPunch[];
  }) => Promise<void>;
  onSimulateOnlinePunch: (params: {
    stationCode: number;
    siNumber: number;
    punchTimeSec?: number;
  }) => Promise<void>;
  onLinkUnknownCardToEntry: (siNumber: number) => void;
  onInspectHex: (hex: string) => void;
  onNavigateForest: () => void;
}

export function ReadoutDashboard({
  courses,
  classes,
  stations,
  competitors,
  runnerDbCount,
  events,
  offlineSnap,
  serialStatus,
  onConnectUsb,
  onConnectWebUsb,
  onDisconnectUsb,
  onSetUsbMode,
  onTriggerStationBeep,
  onClearUsbError,
  onOpenHardwareSettings,
  onSetSimulatedOffline,
  onFlushOfflineQueue,
  selectedRunnerId,
  onSelectRunner,
  onMarkRentalReturned,
  onSimulateFullReadout,
  onSimulateOnlinePunch,
  onLinkUnknownCardToEntry,
  onInspectHex,
  onNavigateForest,
}: ReadoutDashboardProps) {
  const [eventSearch, setEventSearch] = useState('');
  const [radioStationCode, setRadioStationCode] = useState<number>(100);
  const [radioSiInput, setRadioSiInput] = useState<string>('8339104');
  const [busy, setBusy] = useState(false);
  const [modalRunner, setModalRunner] = useState<Competitor | null>(null);

  const inForestCount = useMemo(
    () =>
      competitors.filter(
        (c) =>
          c.status === 'CHECKED' ||
          c.status === 'IN_FOREST' ||
          c.status === 'PRELIMINARY_FIN'
      ).length,
    [competitors]
  );

  const finishedOkCount = useMemo(
    () => competitors.filter((c) => c.status === 'OK').length,
    [competitors]
  );

  const prelCount = useMemo(
    () => competitors.filter((c) => c.status === 'PRELIMINARY_FIN').length,
    [competitors]
  );

  const mpCount = useMemo(
    () => competitors.filter((c) => c.status === 'MP').length,
    [competitors]
  );

  const unreturnedRentals = useMemo(
    () => competitors.filter((c) => c.isRentalCard && !c.rentalReturned).length,
    [competitors]
  );

  // MeOS Control Status (Kontrollintagning)
  const controlStatusList = useMemo(() => {
    const allCodes = Array.from(
      new Set(courses.flatMap((c) => c.controls))
    ).sort((a, b) => a - b);

    return allCodes.map((code) => {
      const matchingCourseIds = new Set(
        courses.filter((crs) => crs.controls.includes(code)).map((c) => c.id)
      );
      const matchingClassIds = new Set(
        classes.filter((cls) => cls.courseId && matchingCourseIds.has(cls.courseId)).map((c) => c.id)
      );
      const activeRunnersRemaining = competitors.filter((cmp) => {
        if (
          cmp.status !== 'REGISTERED' &&
          cmp.status !== 'CHECKED' &&
          cmp.status !== 'IN_FOREST'
        ) {
          return false;
        }
        if (!matchingClassIds.has(cmp.classId)) return false;
        const punched = cmp.cardPunches.some((p) => p.code === code);
        return !punched;
      }).length;

      return {
        code,
        courseCount: matchingCourseIds.size,
        activeRunnersRemaining,
      };
    });
  }, [courses, classes, competitors]);

  const rentalList = useMemo(
    () => competitors.filter((c) => c.isRentalCard),
    [competitors]
  );

  // Pick inspected runner (either explicitly selected, or most recently read out)
  const inspectedRunner = useMemo(() => {
    if (selectedRunnerId) {
      const found = competitors.find((c) => c.id === selectedRunnerId);
      if (found) return found;
    }
    const readOut = competitors
      .filter((c) => c.readoutAt !== null)
      .sort((a, b) => (b.readoutAt ?? '').localeCompare(a.readoutAt ?? ''));
    return readOut[0] ?? competitors[0] ?? null;
  }, [competitors, selectedRunnerId]);

  const inspectedClass = useMemo(
    () => classes.find((c) => c.id === inspectedRunner?.classId) ?? null,
    [classes, inspectedRunner]
  );

  const inspectedPlacement = useMemo(() => {
    if (!inspectedRunner || inspectedRunner.status !== 'OK' || !inspectedClass) return null;
    const okInClass = competitors
      .filter(
        (c) =>
          c.classId === inspectedClass.id &&
          c.status === 'OK' &&
          c.runningTimeSec !== null
      )
      .sort((a, b) => (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999));
    const idx = okInClass.findIndex((c) => c.id === inspectedRunner.id);
    return idx !== -1
      ? {
          pos: idx + 1,
          total: okInClass.length,
          diffSec:
            (inspectedRunner.runningTimeSec ?? 0) - (okInClass[0]?.runningTimeSec ?? 0),
        }
      : null;
  }, [competitors, inspectedRunner, inspectedClass]);

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (ev) =>
        String(ev.siNumber).includes(q) ||
        (ev.competitorName?.toLowerCase().includes(q) ?? false) ||
        (ev.club?.toLowerCase().includes(q) ?? false) ||
        (ev.className?.toLowerCase().includes(q) ?? false) ||
        ev.message.toLowerCase().includes(q)
    );
  }, [events, eventSearch]);

  // Preset 1: Read out Henrik Sjöberg (H21, 0xEF SIAC -> OK!)
  const runScenarioHenrikReadout = async () => {
    const henrik = competitors.find((c) => c.siNumber === 8190442);
    const st = henrik?.startTimeSec ?? 36300;
    const fin = henrik?.finishTimeSec ?? st + 1598;
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI10_EF',
        siNumber: 8190442,
        checkTimeSec: st - 190,
        startTimeSec: st,
        finishTimeSec: fin,
        punches: [
          { code: 31, timeSec: st + 178 },
          { code: 38, timeSec: st + 429 },
          { code: 42, timeSec: st + 679 },
          { code: 55, timeSec: st + 1058 },
          { code: 61, timeSec: st + 1354 },
          { code: 100, timeSec: st + 1559 },
        ],
      });
      if (henrik) onSelectRunner(henrik.id);
    } finally {
      setBusy(false);
    }
  };

  // Preset 2: Read out Frida Åkesson (D21, 0xEF -> New leader 29:18!)
  const runScenarioFridaFinishAndReadout = async () => {
    const frida = competitors.find((c) => c.siNumber === 8339104);
    const st = frida?.startTimeSec ?? 36360;
    const fin = st + 1758;
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI10_EF',
        siNumber: 8339104,
        checkTimeSec: st - 180,
        startTimeSec: st,
        finishTimeSec: fin,
        punches: [
          { code: 31, timeSec: st + 205 },
          { code: 38, timeSec: st + 482 },
          { code: 42, timeSec: st + 748 },
          { code: 55, timeSec: st + 1168 },
          { code: 61, timeSec: st + 1485 },
          { code: 100, timeSec: st + 1715 },
        ],
      });
      if (frida) onSelectRunner(frida.id);
    } finally {
      setBusy(false);
    }
  };

  // Preset 3: Legacy SI-Card 5 (0xB1 128-byte sheet) — Anders Forsberg (SI 342819, Bana 2!)
  const runScenarioSiCard5Readout = async () => {
    const anders = competitors.find((c) => c.siNumber === 342819);
    const st = 37020; // 10:17:00
    const fin = st + 1580; // 26:20
    const b2 = courses.find((c) => c.id === 'crs-2') ?? courses[1] ?? courses[0];
    const ctrls = b2 ? b2.controls : [31, 42, 52, 61, 100];
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI5_B1',
        siNumber: 342819,
        checkTimeSec: st - 70,
        startTimeSec: st,
        finishTimeSec: fin,
        punches: ctrls.map((code, idx) => ({
          code,
          timeSec: st + (idx + 1) * 295,
        })),
      });
      if (anders) onSelectRunner(anders.id);
    } finally {
      setBusy(false);
    }
  };

  // Preset 4: Legacy SI-Card 6 (0xE1 Block 0+6+7) — Helena Karlsson (SI 612480, Bana 2!)
  const runScenarioSiCard6Readout = async () => {
    const helena = competitors.find((c) => c.siNumber === 612480);
    const st = helena?.startTimeSec ?? 36660;
    const fin = st + 1635; // 27:15
    const b2 = courses.find((c) => c.id === 'crs-2') ?? courses[1] ?? courses[0];
    const ctrls = b2 ? b2.controls : [31, 42, 52, 61, 100];
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI6_E1',
        siNumber: 612480,
        checkTimeSec: st - 50,
        startTimeSec: st,
        finishTimeSec: fin,
        punches: ctrls.map((code, idx) => ({
          code,
          timeSec: st + (idx + 1) * 304 + (idx === 2 ? 42 : 0),
        })),
      });
      if (helena) onSelectRunner(helena.id);
    } finally {
      setBusy(false);
    }
  };

  // Preset 5: Read out Johan Wallin (Öppen Motion, Rental Card, auto-matches Bana 2!)
  const runScenarioJohanAutoCourseRental = async () => {
    const johan = competitors.find((c) => c.siNumber === 541209);
    const st = johan?.startTimeSec ?? 36540;
    const fin = st + 1645;
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI6_E1',
        siNumber: 541209,
        checkTimeSec: st - 40,
        startTimeSec: st,
        finishTimeSec: fin,
        punches: [
          { code: 31, timeSec: st + 240 },
          { code: 42, timeSec: st + 610 },
          { code: 52, timeSec: st + 980 },
          { code: 61, timeSec: st + 1350 },
          { code: 100, timeSec: st + 1595 },
        ],
      });
      if (johan) onSelectRunner(johan.id);
    } finally {
      setBusy(false);
    }
  };

  // Preset 6: Unentered club member found in Eventor / Löpardatabas (SI 8812405 — Anton Lindholm!)
  const runScenarioEventorDbMemberReadout = async () => {
    const st = 36600;
    const coursesRef = courses[2] ?? courses[0];
    const ctrls = coursesRef ? coursesRef.controls : [32, 42, 58, 100];
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI10_EF',
        siNumber: 8812405,
        checkTimeSec: st - 120,
        startTimeSec: st,
        finishTimeSec: st + 1420,
        punches: ctrls.map((code, idx) => ({
          code,
          timeSec: st + (idx + 1) * 310,
        })),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCustomOnlinePunch = async (e: React.FormEvent) => {
    e.preventDefault();
    const si = Number(radioSiInput.replace(/\D/g, ''));
    if (!Number.isFinite(si) || si <= 0) return;
    setBusy(true);
    try {
      await onSimulateOnlinePunch({
        stationCode: radioStationCode,
        siNumber: si,
      });
    } finally {
      setBusy(false);
    }
  };

  const isOfflineActive = offlineSnap.simulatedOffline || !offlineSnap.browserOnline;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Målavläsning & Tävlingsöversikt
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Läser ut SI-brickor (SI5–SIAC) via ansluten SI-station och validerar banor direkt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <UsbStationBar
            serialStatus={serialStatus}
            roleLabel="Målutläsning"
            expectedMode="READOUT"
            onConnectUsb={onConnectUsb}
            onConnectWebUsb={onConnectWebUsb}
            onDisconnectUsb={onDisconnectUsb}
            onSetUsbMode={onSetUsbMode}
            onTriggerBeep={onTriggerStationBeep}
            onClearError={onClearUsbError}
            onOpenHardwareSettings={onOpenHardwareSettings}
          />
        </div>
      </div>

      <UsbStationErrorBanner
        serialStatus={serialStatus}
        onConnectWebUsb={onConnectWebUsb}
        onClearError={onClearUsbError}
        onOpenHardwareSettings={onOpenHardwareSettings}
      />

      {/* Forest Offline-Queue Resilience Bar (IndexedDB + localStorage) */}
      <section
        className={`rounded-xl border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${
          isOfflineActive || offlineSnap.pendingItems.length > 0
            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isOfflineActive ? (
            <CloudOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : (
            <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          )}
          <div className="min-w-0">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {isOfflineActive
                ? 'Skogsläge utan 4G aktivt — sparas lokalt'
                : 'Lokal Offline-kö redo'}
            </span>
            <span className="ml-2 font-mono tabular-nums text-[11px]">
              Kö: <strong>{offlineSnap.pendingItems.length}</strong> · Synkade:{' '}
              {offlineSnap.totalSyncedSession}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {offlineSnap.pendingItems.length > 0 && !isOfflineActive && (
            <button
              type="button"
              disabled={offlineSnap.flushing}
              onClick={() => void onFlushOfflineQueue()}
              className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3 h-3 ${offlineSnap.flushing ? 'animate-spin' : ''}`}
              />
              <span>
                {offlineSnap.flushing
                  ? 'Synkar...'
                  : `Synka (${offlineSnap.pendingItems.length})`}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onSetSimulatedOffline(!offlineSnap.simulatedOffline)}
            className={`px-2.5 py-1 font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              offlineSnap.simulatedOffline
                ? 'bg-amber-700 text-white border-amber-700 hover:bg-amber-800'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {offlineSnap.simulatedOffline ? 'Återanslut 4G' : 'Testa offline'}
          </button>
        </div>
        {offlineSnap.lastError && (
          <div
            role="alert"
            className="w-full flex items-start gap-1.5 pt-1 text-[11px] text-red-700 dark:text-red-300"
          >
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{offlineSnap.lastError}</span>
          </div>
        )}
      </section>

      {/* Compact 4-Column Competition KPI Strip */}
      <section
        aria-label="Tävlingsstatus"
        className="grid grid-cols-2 xl:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y sm:divide-y-0 divide-x divide-slate-200 dark:divide-slate-800"
      >
        <div className="px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Anmälda deltagare
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {competitors.length}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
              {classes.length} kl · {runnerDbCount} i DB
            </span>
          </div>
        </div>

        <div className="px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Kvar i skogen
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span
              className={`text-xl font-semibold font-mono tabular-nums ${
                inForestCount > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {inForestCount}
            </span>
            <button
              type="button"
              onClick={onNavigateForest}
              className="text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:underline whitespace-nowrap shrink-0"
            >
              Säkerhetslista
            </button>
          </div>
        </div>

        <div className="px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            I mål (Godkända)
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {finishedOkCount}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
              +{prelCount} prel.
            </span>
          </div>
        </div>

        <div className="px-3.5 py-2.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Felstämplade & Hyr
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {mpCount}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
              {unreturnedRentals} hyr ute
            </span>
          </div>
        </div>
      </section>

      {/* Main 12-Column MeOS Readout & Live Timing Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* Left 7 Columns: Digital SI-Card Readout Verification + Live Stream */}
        <div className="lg:col-span-7 space-y-3.5 min-w-0">
          {inspectedRunner && (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {inspectedRunner.fullName}
                    </h2>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {inspectedRunner.club} ({inspectedClass?.name ?? '-'})
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    #{inspectedRunner.bib} · SI {formatSiNumber(inspectedRunner.siNumber)} ·{' '}
                    {inspectedRunner.cardSeries}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {inspectedRunner.runningTimeSec !== null && (
                    <span className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatDurationMmSs(inspectedRunner.runningTimeSec)}
                      {inspectedPlacement && (
                        <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 ml-1">
                          ({inspectedPlacement.pos}/{inspectedPlacement.total})
                        </span>
                      )}
                    </span>
                  )}
                  <RunnerStatusIndicator status={inspectedRunner.status} compact />
                  <button
                    type="button"
                    onClick={() =>
                      setModalRunner((prev) =>
                        prev?.id === inspectedRunner.id ? null : inspectedRunner
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Compass className="w-3 h-3" />
                    <span>
                      {modalRunner?.id === inspectedRunner.id ? 'Dölj karta' : 'Bankarta'}
                    </span>
                  </button>
                </div>
              </div>

              {modalRunner?.id === inspectedRunner.id && (
                <div className="p-3 bg-slate-50/70 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800">
                  <RunnerSplitCardModal
                    runner={modalRunner}
                    compClass={classes.find((c) => c.id === modalRunner.classId) ?? null}
                    course={
                      courses.find(
                        (crs) =>
                          crs.id ===
                          (modalRunner.validation?.matchedCourseId ??
                            classes.find((c) => c.id === modalRunner.classId)?.courseId)
                      ) ?? null
                    }
                    classCompetitors={competitors.filter((c) => c.classId === modalRunner.classId)}
                    onClose={() => setModalRunner(null)}
                  />
                </div>
              )}

              {/* Rental Card Alert Bar */}
              {inspectedRunner.isRentalCard && !inspectedRunner.rentalReturned && (
                <div className="px-3.5 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      HYRBRICKA ({formatSiNumber(inspectedRunner.siNumber)}) — Ta emot vid avläsning!
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onMarkRentalReturned(inspectedRunner.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Återlämnad</span>
                  </button>
                </div>
              )}

              {/* Missing Punch Explanation Bar */}
              {inspectedRunner.status === 'MP' && inspectedRunner.validation && (
                <div className="px-3.5 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900/60 text-xs text-red-800 dark:text-red-300">
                  <strong>Felstämplat (MP):</strong> Saknar{' '}
                  <span className="font-mono font-semibold">
                    {inspectedRunner.validation.missingControls.map((c) => `(${c})`).join(', ')}
                  </span>
                  {inspectedRunner.validation.extraControls.length > 0 && (
                    <span>
                      {' '}
                      (Extra:{' '}
                      <span className="font-mono">
                        {inspectedRunner.validation.extraControls
                          .map((x) => `(${x.code})`)
                          .join(', ')}
                      </span>
                      )
                    </span>
                  )}
                </div>
              )}

              {/* Compact Zero-Scroll Split Table */}
              {inspectedRunner.validation && inspectedRunner.validation.splits.length > 0 ? (
                <div>
                  <div className="px-3.5 py-1.5 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                    <span>
                      Klass:{' '}
                      <strong className="text-slate-800 dark:text-slate-200 font-medium">
                        {inspectedClass?.name ?? 'Klass'}
                      </strong>
                      {inspectedRunner.validation.rogainingPoints !== undefined &&
                        inspectedRunner.validation.rogainingPoints !== null && (
                          <span className="ml-1.5 font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                            · {inspectedRunner.validation.rogainingPoints} p
                          </span>
                        )}
                      {inspectedRunner.validation.totalTimeLossSec !== undefined &&
                        inspectedRunner.validation.totalTimeLossSec !== null &&
                        inspectedRunner.validation.totalTimeLossSec > 0 && (
                          <span className="ml-1.5 font-mono text-amber-700 dark:text-amber-400">
                            · Bom +{formatDurationMmSs(inspectedRunner.validation.totalTimeLossSec)}
                          </span>
                        )}
                    </span>
                    <span className="font-mono tabular-nums">
                      Start{' '}
                      {formatSecondsAsClock(
                        inspectedRunner.startTimeSec ?? inspectedRunner.allocatedStartSec
                      )}{' '}
                      · Mål {formatSecondsAsClock(inspectedRunner.finishTimeSec)}
                    </span>
                  </div>

                  <div>
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          <th className="py-1.5 pl-3.5 pr-1.5 w-8">#</th>
                          <th className="py-1.5 px-2">Kontroll</th>
                          <th className="py-1.5 px-2 text-right">Sträcka</th>
                          <th className="hidden sm:table-cell py-1.5 px-2 text-right">Plac</th>
                          <th className="hidden sm:table-cell py-1.5 px-2 text-right">Bom</th>
                          <th className="py-1.5 px-2 sm:pr-2 pr-3.5 text-right">Total</th>
                          <th className="hidden md:table-cell py-1.5 pl-2 pr-3.5 text-right">
                            Klocka
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 font-mono tabular-nums">
                        {inspectedRunner.validation.splits.map((s) => {
                          const hasBom = (s.timeLossSec ?? 0) >= 12;
                          return (
                            <tr
                              key={`${s.order}-${s.controlCode}`}
                              className={
                                s.status === 'MISSING'
                                  ? 'bg-red-50/60 dark:bg-red-950/25 text-red-700 dark:text-red-400'
                                  : hasBom
                                  ? 'bg-amber-50/40 dark:bg-amber-950/20'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                              }
                            >
                              <td className="py-1 pl-3.5 pr-1.5 text-slate-400">
                                {s.controlCode === 999 ? 'M' : s.order}
                              </td>
                              <td className="py-1 px-2 font-sans font-medium text-slate-900 dark:text-slate-100 truncate max-w-[110px] sm:max-w-none">
                                {s.controlCode === 999 ? s.label : `(${s.controlCode})`}
                                {s.status === 'MISSING' && (
                                  <span className="ml-1.5 text-red-600 dark:text-red-400 font-semibold">
                                    Saknas!
                                  </span>
                                )}
                                {s.status === 'BROKEN_CTRL' && (
                                  <span className="ml-1.5 text-slate-500">Ur funk.</span>
                                )}
                              </td>
                              <td className="py-1 px-2 text-right text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                <span>
                                  {s.legRank === 1 ? '★ ' : ''}
                                  {formatDurationMmSs(s.legSec)}
                                </span>
                                {hasBom && (
                                  <span className="sm:hidden ml-1 text-[10px] text-amber-700 dark:text-amber-400">
                                    +{formatDurationMmSs(s.timeLossSec ?? 0)}
                                  </span>
                                )}
                              </td>
                              <td className="hidden sm:table-cell py-1 px-2 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {s.legRank ? (
                                  <span
                                    className={
                                      s.legRank === 1
                                        ? 'font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center justify-end gap-1'
                                        : ''
                                    }
                                  >
                                    {s.legRank === 1 && <Star className="w-3 h-3 fill-current" />}
                                    <span>#{s.legRank}</span>
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="hidden sm:table-cell py-1 px-2 text-right whitespace-nowrap">
                                {hasBom ? (
                                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                                    +{formatDurationMmSs(s.timeLossSec ?? 0)}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 dark:text-slate-700">—</span>
                                )}
                              </td>
                              <td className="py-1 px-2 sm:pr-2 pr-3.5 text-right font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {formatDurationMmSs(s.cumulativeSec)}
                              </td>
                              <td className="hidden md:table-cell py-1 pl-2 pr-3.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {formatSecondsAsClock(s.punchTimeSec)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="px-3.5 py-3 text-xs text-slate-500 dark:text-slate-400">
                  SI-brickan är ännu inte utläst vid målavläsningen.{' '}
                  {inspectedRunner.radioSplits.length > 0 && (
                    <span>
                      Radio:{' '}
                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                        {inspectedRunner.radioSplits
                          .map(
                            (r) =>
                              `(${r.controlCode}) ${formatDurationMmSs(r.runningTimeSec)}`
                          )
                          .join(' · ')}
                      </strong>
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Real-Time Competition Event Stream */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Tävlingshändelser i realtid
                </h2>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                  placeholder="Filtrera löpare, klass, SI..."
                  className="w-full pl-8 pr-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-600/25"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-1.5 pl-3.5 pr-2 w-16">Tid</th>
                    <th className="py-1.5 px-2">Deltagare</th>
                    <th className="hidden sm:table-cell py-1.5 px-2">Händelse</th>
                    <th className="py-1.5 pl-2 pr-3.5 text-right">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                  {filteredEvents.slice(0, 16).map((ev) => (
                    <tr
                      key={ev.id}
                      onClick={() => {
                        if (ev.competitorId) onSelectRunner(ev.competitorId);
                      }}
                      className={`transition-colors ${
                        ev.competitorId
                          ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          : ''
                      }`}
                    >
                      <td className="py-1.5 pl-3.5 pr-2 font-mono tabular-nums whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {ev.clock24h}
                      </td>
                      <td className="py-1.5 px-2 max-w-[180px] sm:max-w-none">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 truncate">
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {ev.competitorName ?? (
                              <span className="text-amber-700 dark:text-amber-400">
                                Okänd SI ({formatSiNumber(ev.siNumber)})
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {ev.className
                              ? `· ${ev.className}`
                              : ev.siNumber > 0
                              ? `· SI ${formatSiNumber(ev.siNumber)}`
                              : `· ${ev.stationName}`}
                          </span>
                        </div>
                        <div className="sm:hidden text-[11px] text-slate-600 dark:text-slate-400 truncate">
                          {ev.message}
                        </div>
                      </td>
                      <td className="hidden sm:table-cell py-1.5 px-2 text-slate-700 dark:text-slate-300">
                        {ev.message}
                      </td>
                      <td
                        className="py-1.5 pl-2 pr-3.5 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {ev.eventType === 'UNKNOWN_CARD' && (
                            <button
                              type="button"
                              onClick={() => onLinkUnknownCardToEntry(ev.siNumber)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                            >
                              <UserPlus className="w-3 h-3" />
                              <span>Anmäl</span>
                            </button>
                          )}
                          {ev.rawHex && (
                            <button
                              type="button"
                              onClick={() => onInspectHex(ev.rawHex!)}
                              className="inline-flex items-center gap-0.5 text-[11px] font-mono text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:underline"
                            >
                              <Cpu className="w-3 h-3" />
                              <span>Hex</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right 5 Columns: Hardware Testbench (0xEF SIAC/10/11 + 0xE1 SI6 + 0xB1 SI5 + 0xD3 Radio) */}
        <div className="lg:col-span-5 space-y-3.5">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                SPORTident Hårdvarutestbänk
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Binära <span className="font-mono">0xEF</span>, <span className="font-mono">0xE1</span> &{' '}
                <span className="font-mono">0xB1</span> ramar med CRC16 via offline-kön.
              </p>
            </div>

            <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runScenarioHenrikReadout()}
                title="Verifierar alla 6 kontroller på Bana 1 och bekräftar ledartiden 26:38 i H21."
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  1. Henrik Sjöberg · H21 (Prel → OK)
                </span>
                <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 shrink-0">
                  0xEF SIAC
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void runScenarioFridaFinishAndReadout()}
                title="Avför Frida från Kvar i skogen och uppdaterar Idealtid & Bomtid i D21."
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  2. Frida Åkesson · D21 (I skog → Ledare)
                </span>
                <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 shrink-0">
                  0xEF SIAC
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void runScenarioSiCard5Readout()}
                title="Avkodar SI-Card 5 med CNS-multiplikator och 12h-till-24h tidsupplösning i D/H45."
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  3. Anders Forsberg · SI-Card 5 (342 819)
                </span>
                <span className="text-[11px] font-mono text-purple-700 dark:text-purple-400 shrink-0">
                  0xB1
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void runScenarioSiCard6Readout()}
                title="Avkodar SI-Card 6 minnesblock 0, 6 och 7 och beräknar bomtid i D/H45."
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  4. Helena Karlsson · SI-Card 6 (612 480)
                </span>
                <span className="text-[11px] font-mono text-purple-700 dark:text-purple-400 shrink-0">
                  0xE1
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void runScenarioJohanAutoCourseRental()}
                title="Matchar automatiskt stämplingarna mot Bana 2 (Mellan) och flaggar hyrbricka."
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  5. Johan Wallin · Hyrbricka + Autobana
                </span>
                <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400 shrink-0">
                  Hyrbricka
                </span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void runScenarioEventorDbMemberReadout()}
                title="Hämtar oanmäld löpare automatiskt ur Löpardatabasen/Eventor vid målavläsning."
                className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  6. Oanmäld medlem · SI 8 812 405
                </span>
                <span className="text-[11px] font-mono text-sky-700 dark:text-sky-400 shrink-0">
                  Eventor
                </span>
              </button>
            </div>
          </section>

          {/* 0xD3 Online / Radio Control Sender */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Online- & Radiostämpling (0xD3)
              </h2>
            </div>

            <form onSubmit={handleCustomOnlinePunch} className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Kontroll / SI-station
                </label>
                <select
                  value={radioStationCode}
                  onChange={(e) => setRadioStationCode(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  {stations
                    .filter((s) => s.stationFunction !== 'READOUT')
                    .map((s) => (
                      <option key={s.id} value={s.stationCode}>
                        CN {s.stationCode} — {s.name} ({formatStationFunctionLabel(s.stationFunction)})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Löpare / SI-bricknummer
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={radioSiInput}
                    onChange={(e) => setRadioSiInput(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {competitors.map((c) => (
                      <option key={c.id} value={String(c.siNumber)}>
                        #{c.bib} {c.fullName} (SI {c.siNumber})
                      </option>
                    ))}
                  </select>

                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Stämpla</span>
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>

      {/* Bottom Grid: 3. Kontrollstatus i skogen & 4. Hyrbrickor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 pt-1">
        {/* Kontrollstatus i skogen (Kontrollintagning) */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Kontrollstatus i skogen (Kontrollintagning)
            </h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Antal löpare i terrängen med kontrollen kvar
            </span>
          </div>

          <div className="p-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-56 overflow-y-auto">
            {controlStatusList.length === 0 ? (
              <div className="col-span-full py-4 text-center text-xs text-slate-400">
                Inga kontroller registrerade på banorna.
              </div>
            ) : (
              controlStatusList.map((item) => (
                <div
                  key={item.code}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40"
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
                      ({item.code})
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{item.courseCount}b</span>
                  </div>
                  <div
                    className={`mt-0.5 text-[11px] font-mono tabular-nums font-medium truncate ${
                      item.activeRunnersRemaining === 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {item.activeRunnersRemaining === 0 ? 'Klart' : `${item.activeRunnersRemaining} kvar`}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Utlånade SI-hyrbrickor */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Utlånade SI-hyrbrickor ({unreturnedRentals} ej återlämnade)
              </h2>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Totalt {rentalList.length} hyrbrickor
              </span>
            </div>

            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {rentalList.length === 0 ? (
                <div className="py-6 text-center text-slate-400">
                  Inga hyrbrickor utlånade i tävlingen.
                </div>
              ) : (
                rentalList.map((r) => {
                  const isReturned = r.rentalReturned;
                  return (
                    <div
                      key={r.id}
                      className="px-3.5 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {r.fullName} ({r.club})
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          SI {r.siNumber} · Status: {r.status}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {isReturned ? (
                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                            Återlämnad
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onMarkRentalReturned(r.id)}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
                          >
                            Markera återlämnad
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
