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
  Trash2,
  UserPlus,
  Wifi,
} from 'lucide-react';
import type {
  CompClass,
  Competitor,
  Course,
  LiveEventItem,
  SIStation,
} from '../types/sportident';
import type { OfflineQueueSnapshot } from '../services/offlineReadoutQueue';
import {
  filterOutstandingReadouts,
  type ReadoutHistoryRecord,
} from '../services/readoutHistoryStore';
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
  readoutHistory: ReadoutHistoryRecord[];
  latestReadoutId: string | null;
  readoutHistoryError: string | null;
  onCreateMpReviewIssue: (clientReadoutId: string) => Promise<void>;
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
  onRetryOfflineQueueItem: (itemId: string) => Promise<void>;
  onRemoveOfflineQueueItem: (itemId: string) => void;
  onClearOfflineQueue: () => void;
  selectedRunnerId: string | null;
  onSelectRunner: (id: string) => void;
  onMarkRentalReturned: (competitorId: string) => Promise<void>;
  onSimulateOnlinePunch: (params: {
    stationCode: number;
    siNumber: number;
    punchTimeSec?: number;
  }) => Promise<void>;
  onLinkUnknownCardToEntry: (siNumber: number, clientReadoutId?: string) => void;
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
  readoutHistory,
  latestReadoutId,
  readoutHistoryError,
  onCreateMpReviewIssue,
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
  onRetryOfflineQueueItem,
  onRemoveOfflineQueueItem,
  onClearOfflineQueue,
  selectedRunnerId,
  onSelectRunner,
  onMarkRentalReturned,
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
  const [queueActionId, setQueueActionId] = useState<string | null>(null);
  const [selectedReadoutId, setSelectedReadoutId] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<'ALL' | 'OUTSTANDING'>('ALL');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPageSize, setHistoryPageSize] = useState<20 | 30 | 50>(30);
  const [historyPage, setHistoryPage] = useState(0);
  const [issueActionBusyId, setIssueActionBusyId] = useState<string | null>(null);
  const [issueActionError, setIssueActionError] = useState<{
    clientReadoutId: string;
    message: string;
  } | null>(null);

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

  const latestReadout = useMemo(
    () =>
      readoutHistory.find((record) => record.clientReadoutId === latestReadoutId) ?? null,
    [latestReadoutId, readoutHistory]
  );
  const outstandingReadouts = useMemo(
    () => filterOutstandingReadouts(readoutHistory),
    [readoutHistory]
  );
  const filteredReadouts = useMemo(() => {
    const records =
      historyView === 'OUTSTANDING' ? outstandingReadouts : readoutHistory;
    const query = historySearch.trim().toLocaleLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      [
        record.clientReadoutId,
        String(record.captureSequence),
        String(record.readout.siNumber),
        record.competitorName ?? '',
        record.originalCompetitorName ?? '',
        record.resultStatus ?? '',
        record.originalResultStatus ?? '',
        record.issueType ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(query))
    );
  }, [historySearch, historyView, outstandingReadouts, readoutHistory]);
  const historyPageCount = Math.max(
    1,
    Math.ceil(filteredReadouts.length / historyPageSize)
  );
  const visibleHistoryPage = Math.min(historyPage, historyPageCount - 1);
  const visibleReadouts = useMemo(
    () =>
      filteredReadouts.slice(
        visibleHistoryPage * historyPageSize,
        (visibleHistoryPage + 1) * historyPageSize
      ),
    [filteredReadouts, visibleHistoryPage, historyPageSize]
  );

  // This detail panel is user-selected and is separate from capture-ordered Latest Readout.
  const inspectedRunner = useMemo(() => {
    return selectedRunnerId
      ? competitors.find((competitor) => competitor.id === selectedRunnerId) ?? null
      : null;
  }, [competitors, selectedRunnerId]);

  const latestReadoutResultLabel = latestReadout?.resultStatus
    ? latestReadout.resultStatus
    : latestReadout?.readoutState === 'UNKNOWN'
      ? 'Unknown card'
      : 'Readout captured';

  const latestReadoutSyncLabel = latestReadout
    ? {
        PERSISTING: 'Saving locally',
        LOCAL_SAVED: 'Saved locally',
        QUEUED: 'Sync pending',
        SYNCED: 'Synced',
        SAVE_FAILED: 'Save failed',
      }[latestReadout.deliveryState]
    : null;

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

  const handleCreateMpReviewIssue = async (clientReadoutId: string) => {
    setIssueActionBusyId(clientReadoutId);
    setIssueActionError(null);
    try {
      await onCreateMpReviewIssue(clientReadoutId);
    } catch (error) {
      setIssueActionError({
        clientReadoutId,
        message:
          error instanceof Error
            ? error.message
            : 'MP-granskningsärendet kunde inte sparas.',
      });
    } finally {
      setIssueActionBusyId(null);
    }
  };

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

      {offlineSnap.pendingItems.length > 0 && (
        <section
          aria-label="Offline-kö"
          className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 rounded-xl overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-amber-100 dark:border-amber-900/50">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Offline-kö ({offlineSnap.pendingItems.length} {offlineSnap.pendingItems.length === 1 ? 'post' : 'poster'})
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Poster med permanent fel kräver manuell åtgärd eller borttagning.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Ta bort alla ${offlineSnap.pendingItems.length} poster från offline-kön? Åtgärden kan inte ångras.`)) {
                  onClearOfflineQueue();
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/70"
            >
              <Trash2 className="w-3 h-3" />
              Rensa hela kön
            </button>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {offlineSnap.pendingItems.map((item) => {
              const isBusy = queueActionId === item.id || offlineSnap.flushing;
              const readout = item.readoutPayload;
              const punch = item.onlinePunchPayload;
              const itemName =
                item.kind === 'READOUT'
                  ? `Avläsning · SI ${readout?.siNumber ?? 'okänt'} · ${readout?.cardSeries ?? 'okänd bricka'}`
                  : `Online-stämpling · SI ${punch?.siNumber ?? 'okänt'} · kontroll ${punch?.stationCode ?? 'okänd'}`;
              return (
                <li key={item.id} className="px-3.5 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{itemName}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Tävling: {item.eventId || 'saknas'} · Köad: {new Date(item.createdAt).toLocaleString('sv-SE')}
                    </p>
                    {readout && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Stämplingar: {readout.punches.length}
                        {readout.finishTimeSec !== null && readout.finishTimeSec !== undefined
                          ? ` · Måltid: ${formatSecondsAsClock(readout.finishTimeSec)}`
                          : ''}
                      </p>
                    )}
                    <details className="text-[11px] text-slate-600 dark:text-slate-400">
                      <summary className="cursor-pointer">Visa innehåll</summary>
                      <div className="mt-1 space-y-1 break-words">
                        <p>Post-ID: <span className="font-mono">{item.id}</span></p>
                        {readout && (
                          <>
                            <p>Bricktyp: {readout.cardSeries} · Kontrollkod: {readout.stationCode}</p>
                            <p>
                              Check: {readout.checkTimeSec == null ? '—' : formatSecondsAsClock(readout.checkTimeSec)}
                              {' · '}Start: {readout.startTimeSec == null ? '—' : formatSecondsAsClock(readout.startTimeSec)}
                              {' · '}Mål: {readout.finishTimeSec == null ? '—' : formatSecondsAsClock(readout.finishTimeSec)}
                            </p>
                            <p>Stämplingar: {readout.punches.map((entry) => `${entry.code} @ ${formatSecondsAsClock(entry.timeSec)}`).join(', ') || 'inga'}</p>
                            {readout.rawHex && <p>Rådata: <span className="font-mono">{readout.rawHex}</span></p>}
                          </>
                        )}
                        {punch && (
                          <>
                            <p>Station: {punch.stationName || '—'} ({punch.stationFunction || '—'})</p>
                            <p>Tid: {punch.punchTimeSec == null ? '—' : formatSecondsAsClock(punch.punchTimeSec)} · Tidsjustering: {punch.timeOffsetSec ?? 0} sek.</p>
                            {punch.rawHex && <p>Rådata: <span className="font-mono">{punch.rawHex}</span></p>}
                          </>
                        )}
                      </div>
                    </details>
                    {item.lastError && (
                      <p className={`text-[11px] ${item.permanentError ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        {item.permanentError ? 'Permanent fel' : `Senaste synkfel (${item.failureCount ?? 1})`}: {item.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy || isOfflineActive}
                      onClick={async () => {
                        setQueueActionId(item.id);
                        try {
                          await onRetryOfflineQueueItem(item.id);
                        } finally {
                          setQueueActionId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg"
                    >
                      <RefreshCw className={`w-3 h-3 ${queueActionId === item.id ? 'animate-spin' : ''}`} />
                      Försök igen
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onRemoveOfflineQueueItem(item.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 disabled:opacity-50 rounded-lg"
                    >
                      <Trash2 className="w-3 h-3" />
                      Ta bort
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <section
          aria-live="polite"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Senaste SI-avläsning
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Senaste fångade avläsning · sekvens{' '}
                {latestReadout?.captureSequence ?? '—'}
              </p>
            </div>
            {latestReadoutSyncLabel && (
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                {latestReadoutSyncLabel}
              </span>
            )}
          </div>
          {readoutHistoryError && (
            <div className="px-4 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30">
              Avläsningshistoriken kunde inte laddas eller sparas: {readoutHistoryError}
            </div>
          )}
          {latestReadout ? (
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {latestReadout.competitorName ?? 'SI-bricka'} · SI{' '}
                    {formatSiNumber(latestReadout.readout.siNumber)}
                  </div>
                  {latestReadout.className && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {latestReadout.className}
                    </div>
                  )}
                </div>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {latestReadoutResultLabel}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                <span>
                  Mål:{' '}
                  <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {formatSecondsAsClock(latestReadout.readout.finishTimeSec)}
                  </strong>
                </span>
                {latestReadout.competitorSnapshot?.runningTimeSec !== null &&
                  latestReadout.competitorSnapshot?.runningTimeSec !== undefined && (
                    <span>
                      Tid:{' '}
                      <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {formatDurationMmSs(
                          latestReadout.competitorSnapshot.runningTimeSec
                        )}
                      </strong>
                    </span>
                  )}
                <span>
                  Fångad:{' '}
                  <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {new Date(latestReadout.capturedAt).toLocaleTimeString('sv-SE')}
                  </strong>
                </span>
              </div>
              {latestReadout.syncError && (
                <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                  {latestReadout.syncError}
                </p>
              )}
            </div>
          ) : (
            <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
              Ingen SI-avläsning har fångats för tävlingen.
            </p>
          )}
        </section>

        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Avläsningshistorik
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Sorterad efter fångstsekvens · {readoutHistory.length} sparade avläsningar
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1" role="group" aria-label="Historikvy">
                <button
                  type="button"
                  aria-pressed={historyView === 'ALL'}
                  onClick={() => {
                    setHistoryView('ALL');
                    setHistoryPage(0);
                  }}
                  className={`px-2.5 py-1 text-xs rounded-md border ${
                    historyView === 'ALL'
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                      : 'bg-white text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
                  }`}
                >
                  Alla
                </button>
                <button
                  type="button"
                  aria-pressed={historyView === 'OUTSTANDING'}
                  onClick={() => {
                    setHistoryView('OUTSTANDING');
                    setHistoryPage(0);
                  }}
                  className={`px-2.5 py-1 text-xs rounded-md border ${
                    historyView === 'OUTSTANDING'
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
                  }`}
                >
                  Outstanding Issues ({outstandingReadouts.length})
                </button>
              </div>
              <label className="relative block w-full sm:max-w-xs">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="search"
                  value={historySearch}
                  onChange={(event) => {
                    setHistorySearch(event.target.value);
                    setHistoryPage(0);
                  }}
                  placeholder="Sök bricka, löpare, status eller ID"
                  aria-label="Sök i avläsningshistorik"
                  className="w-full pl-7 pr-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                {filteredReadouts.length === 0
                  ? 'Inga träffar'
                  : `Visar ${visibleHistoryPage * historyPageSize + 1}–${Math.min(
                      (visibleHistoryPage + 1) * historyPageSize,
                      filteredReadouts.length
                    )} av ${filteredReadouts.length}`}
              </span>
              <label className="flex items-center gap-1.5">
                Rader
                <select
                  value={historyPageSize}
                  onChange={(event) => {
                    setHistoryPageSize(Number(event.target.value) as 20 | 30 | 50);
                    setHistoryPage(0);
                  }}
                  className="px-1.5 py-1 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                  aria-label="Rader per sida"
                >
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>
          </div>
          {visibleReadouts.length > 0 ? (
            <ol className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {visibleReadouts.map((record) => {
                const resultLabel = record.resultStatus
                  ? record.resultStatus
                  : record.readoutState === 'UNKNOWN'
                    ? 'Unknown card'
                    : 'Captured';
                const syncLabel =
                  record.deliveryState === 'SYNCED'
                    ? 'Synced'
                    : record.deliveryState === 'QUEUED'
                      ? 'Sync pending'
                      : record.deliveryState === 'LOCAL_SAVED'
                        ? 'Saved locally'
                        : record.deliveryState === 'SAVE_FAILED'
                          ? 'Save failed'
                          : 'Saving';
                return (
                  <li key={record.clientReadoutId} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        aria-expanded={selectedReadoutId === record.clientReadoutId}
                        onClick={() =>
                          setSelectedReadoutId((current) =>
                            current === record.clientReadoutId
                              ? null
                              : record.clientReadoutId
                          )
                        }
                        className="flex-1 min-w-0 text-left rounded px-1 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">
                            #{record.captureSequence} ·{' '}
                            {record.competitorName ?? 'SI-bricka'} · SI{' '}
                            {formatSiNumber(record.readout.siNumber)}
                          </span>
                          <span className="shrink-0 text-slate-600 dark:text-slate-300">
                            {resultLabel} · {syncLabel}
                            {record.issueType
                              ? ` · ${record.issueType} ${record.issueState}`
                              : ''}
                          </span>
                        </span>
                      </button>
                      {record.issueType === 'UNKNOWN_CARD' &&
                        record.issueState !== 'RESOLVED' &&
                        record.issueState !== 'DISMISSED' && (
                        <button
                          type="button"
                          onClick={() =>
                            onLinkUnknownCardToEntry(
                              record.readout.siNumber,
                              record.clientReadoutId
                            )
                          }
                          className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline"
                        >
                          Anmäl
                        </button>
                      )}
                    </div>
                    {selectedReadoutId === record.clientReadoutId && (
                      <div className="mt-2 ml-1 text-[11px] text-slate-600 dark:text-slate-400">
                        <div>
                          Fångad {new Date(record.capturedAt).toLocaleString('sv-SE')}
                          {' · '}SI {formatSiNumber(record.readout.siNumber)}
                          {' · '}{record.readout.cardSeries}
                          {' · '}Mål {formatSecondsAsClock(record.readout.finishTimeSec)}
                        </div>
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                          <span>
                            Ursprunglig match:{' '}
                            {record.originalCompetitorName ?? 'Ingen match vid avläsning'}
                            {record.originalCompetitorId
                              ? ` (${record.originalCompetitorId})`
                              : ''}
                            {record.originalClassName ? ` · ${record.originalClassName}` : ''}
                          </span>
                          <span>
                            Nuvarande match:{' '}
                            {record.competitorName ?? 'Ingen aktuell match'}
                            {record.competitorId ? ` (${record.competitorId})` : ''}
                            {record.className ? ` · ${record.className}` : ''}
                          </span>
                          <span>
                            Ursprungligt resultat: {record.originalResultStatus ?? 'Ej tilldelat'}
                            {record.originalCompetitorSnapshot?.runningTimeSec != null
                              ? ` · tid ${formatDurationMmSs(
                                  record.originalCompetitorSnapshot.runningTimeSec
                                )}`
                              : ''}
                            {record.originalCompetitorSnapshot?.validation?.totalTimeLossSec != null
                              ? ` · Bom ${formatDurationMmSs(
                                  record.originalCompetitorSnapshot.validation.totalTimeLossSec
                                )}`
                              : ''}
                          </span>
                          <span>
                            Aktuellt resultat: {record.resultStatus ?? 'Ej tilldelat'}
                            {record.competitorSnapshot?.runningTimeSec != null
                              ? ` · tid ${formatDurationMmSs(
                                  record.competitorSnapshot.runningTimeSec
                                )}`
                              : ''}
                            {record.competitorSnapshot?.validation?.totalTimeLossSec != null
                              ? ` · Bom ${formatDurationMmSs(
                                  record.competitorSnapshot.validation.totalTimeLossSec
                                )}`
                              : ''}
                          </span>
                          <span>
                            Issue: {record.issueType ?? 'Ingen'} · {record.issueState}
                          </span>
                          <span>Leverans: {syncLabel}</span>
                        </div>
                        {record.suggestedRunner && (
                          <div className="mt-1">
                            Föreslagen löpare: {record.suggestedRunner.fullName}
                          </div>
                        )}
                        {record.syncError && (
                          <div className="mt-1 text-red-700 dark:text-red-300">
                            {record.syncError}
                          </div>
                        )}
                        {record.resultStatus === 'MP' && record.issueState === 'NONE' && (
                          <button
                            type="button"
                            disabled={issueActionBusyId === record.clientReadoutId}
                            onClick={() => void handleCreateMpReviewIssue(record.clientReadoutId)}
                            className="mt-2 rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                          >
                            {issueActionBusyId === record.clientReadoutId
                              ? 'Sparar…'
                              : 'Skapa MP-granskningsärende'}
                          </button>
                        )}
                        {issueActionError?.clientReadoutId === record.clientReadoutId &&
                          issueActionBusyId === null && (
                          <div role="alert" className="mt-1 text-red-700 dark:text-red-300">
                            {issueActionError.message}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {record.readout.punches.map((punch, index) => (
                            <span
                              key={`${record.clientReadoutId}-${index}`}
                              className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono"
                            >
                              {punch.code} · {formatSecondsAsClock(punch.timeSec)}
                            </span>
                          ))}
                          {record.readout.punches.length === 0 && <span>Inga stämplingar</span>}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
              {historyView === 'OUTSTANDING'
                ? 'Inga öppna eller pågående avläsningsärenden.'
                : 'Historiken visas här efter första SI-avläsningen.'}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              disabled={visibleHistoryPage === 0}
              onClick={() => setHistoryPage((current) => Math.max(0, current - 1))}
              className="px-2.5 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
            >
              Föregående
            </button>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Sida {visibleHistoryPage + 1} av {historyPageCount}
            </span>
            <button
              type="button"
              disabled={visibleHistoryPage + 1 >= historyPageCount}
              onClick={() =>
                setHistoryPage((current) => Math.min(historyPageCount - 1, current + 1))
              }
              className="px-2.5 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
            >
              Nästa
            </button>
          </div>
        </section>
      </div>

      {/* Readout & Live Timing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        <div className="lg:col-span-12 space-y-3.5 min-w-0">
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

        {/* Online / Radio Control Sender */}
        <div className="lg:col-span-12 space-y-3.5">
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
