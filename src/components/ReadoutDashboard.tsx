import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CloudOff,
  Compass,
  Radio,
  RefreshCw,
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
  EmergencySettings,
  RunnerDbEntry,
  SIStation,
} from '../types/sportident';
import type { ReadoutReassignmentAuditEntry } from '../types/readoutReassignment';
import type { OfflineQueueSnapshot } from '../services/offlineReadoutQueue';
import {
  isEligibleWrongCompetitorReadout,
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
  parseClockToSeconds,
} from '../services/sportidentProtocol';
import {
  getCompetitorPlacement,
  getCompetitorPlacements,
  getMissingPunchExplanation,
} from '../services/readoutSummary';
import {
  getReadoutDeliveryLabel,
  getReadoutIssueSummary,
} from '../utils/readoutStatusPresentation';
import { getRunnerNameSuggestions } from '../utils/runnerNameSuggestions';
import { calculateReadoutReassignmentPreview } from '../utils/readoutReassignment';
import { RunnerStatusIndicator, formatStationFunctionLabel } from './StatusLabels';
import { RunnerSplitCardModal } from './RunnerSplitCardModal';
import { ReadoutTimeline } from './ReadoutTimeline';
import { UsbStationBar, UsbStationErrorBanner } from './UsbStationBar';

interface ReadoutDashboardProps {
  courses: Course[];
  classes: CompClass[];
  emergency: EmergencySettings;
  zeroTimeSec: number;
  stations: SIStation[];
  competitors: Competitor[];
  runnerDb: RunnerDbEntry[];
  defaultClubName?: string;
  runnerDbCount: number;
  readoutHistory: ReadoutHistoryRecord[];
  latestReadoutId: string | null;
  readoutHistoryError: string | null;
  onCreateMpReviewIssue: (clientReadoutId: string) => Promise<void>;
  onApplyResultReassignment: (
    record: ReadoutHistoryRecord,
    targetCompetitorId: string,
    reason: string
  ) => Promise<ReadoutReassignmentAuditEntry>;
  onLoadResultReassignmentAudits: (
    readoutId: string
  ) => Promise<ReadoutReassignmentAuditEntry[]>;
  onApproveManualResult: (
    competitorId: string,
    reason: string
  ) => Promise<string | null>;
  onResolveUnknownCard: (
    record: ReadoutHistoryRecord | null,
    siNumber: number,
    details: {
      fullName: string;
      club: string;
      classId: string;
      runnerProfileId: string | null;
      isRentalCard: boolean;
      isBorrowedCard: boolean;
      allocatedStartSec: number | null;
    }
  ) => Promise<string | null>;
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
  onMarkRentalReturned: (competitorId: string) => Promise<void>;
  onSimulateOnlinePunch: (params: {
    stationCode: number;
    siNumber: number;
    punchTimeSec?: number;
  }) => Promise<void>;
  onNavigateForest: () => void;
}

export function ReadoutDashboard({
  courses,
  classes,
  emergency,
  zeroTimeSec,
  stations,
  competitors,
  runnerDb,
  defaultClubName,
  runnerDbCount,
  readoutHistory,
  latestReadoutId,
  readoutHistoryError,
  onCreateMpReviewIssue,
  onApplyResultReassignment,
  onLoadResultReassignmentAudits,
  onApproveManualResult,
  onResolveUnknownCard,
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
  onMarkRentalReturned,
  onSimulateOnlinePunch,
  onNavigateForest,
}: ReadoutDashboardProps) {
  const [radioStationCode, setRadioStationCode] = useState<number>(100);
  const [radioSiInput, setRadioSiInput] = useState<string>('8339104');
  const [busy, setBusy] = useState(false);
  const [modalRunner, setModalRunner] = useState<Competitor | null>(null);
  const [queueActionId, setQueueActionId] = useState<string | null>(null);
  const [selectedReadoutId, setSelectedReadoutId] = useState<string | null>(null);
  const [issueActionBusyId, setIssueActionBusyId] = useState<string | null>(null);
  const [wrongCompetitorOpen, setWrongCompetitorOpen] = useState(false);
  const [wrongCompetitorTargetId, setWrongCompetitorTargetId] = useState('');
  const [wrongCompetitorReason, setWrongCompetitorReason] = useState('');
  const [wrongCompetitorBusy, setWrongCompetitorBusy] = useState(false);
  const [wrongCompetitorError, setWrongCompetitorError] = useState<string | null>(null);
  const [correctionAudits, setCorrectionAudits] = useState<
    ReadoutReassignmentAuditEntry[]
  >([]);
  const [correctionAuditLoading, setCorrectionAuditLoading] = useState(false);
  const [correctionAuditError, setCorrectionAuditError] = useState<string | null>(null);
  const [manualApprovalBusy, setManualApprovalBusy] = useState(false);
  const [manualApprovalReason, setManualApprovalReason] = useState('');
  const [manualApprovalError, setManualApprovalError] = useState<string | null>(null);
  const [unknownCardBusyId, setUnknownCardBusyId] = useState<string | null>(null);
  const [unknownCardError, setUnknownCardError] = useState<string | null>(null);
  const [unknownCardSuccess, setUnknownCardSuccess] = useState<string | null>(null);
  const [unknownCardName, setUnknownCardName] = useState('');
  const [unknownCardClub, setUnknownCardClub] = useState('');
  const [unknownCardClassId, setUnknownCardClassId] = useState('');
  const [unknownCardRunnerProfileId, setUnknownCardRunnerProfileId] = useState<string | null>(
    null
  );
  const [unknownCardNameSuggestionOpen, setUnknownCardNameSuggestionOpen] =
    useState(false);
  const [unknownCardActiveSuggestionIndex, setUnknownCardActiveSuggestionIndex] =
    useState(0);
  const [unknownCardIsRental, setUnknownCardIsRental] = useState(false);
  const [unknownCardIsBorrowed, setUnknownCardIsBorrowed] = useState(false);
  const [unknownCardStartClock, setUnknownCardStartClock] = useState('');
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

  const selectedReadout = useMemo(
    () =>
      readoutHistory.find((record) => record.clientReadoutId === selectedReadoutId) ?? null,
    [readoutHistory, selectedReadoutId]
  );
  const selectedOfflineReadoutQueueItem = useMemo(
    () =>
      selectedReadout
        ? offlineSnap.pendingItems.find(
            (item) =>
              item.kind === 'READOUT' &&
              item.eventId === selectedReadout.eventId &&
              item.readoutPayload?.clientReadoutId === selectedReadout.clientReadoutId
          ) ?? null
        : null,
    [offlineSnap.pendingItems, selectedReadout]
  );
  const offlineQueueDisplayItems = useMemo(
    () =>
      offlineSnap.pendingItems.filter(
        (item) =>
          item.kind === 'ONLINE_PUNCH' ||
          !readoutHistory.some(
            (record) =>
              record.eventId === item.eventId &&
              record.clientReadoutId === item.readoutPayload?.clientReadoutId
          )
      ),
    [offlineSnap.pendingItems, readoutHistory]
  );
  const competitorPlacements = useMemo(
    () => getCompetitorPlacements(competitors),
    [competitors]
  );
  const reassignmentPreview = useMemo(() => {
    if (!selectedReadout || !wrongCompetitorTargetId) return null;
    const target = competitors.find(
      (candidate) => candidate.id === wrongCompetitorTargetId
    );
    if (!target) {
      return { error: 'Löparen hittades inte i den aktiva tävlingen.' } as const;
    }
    try {
      return {
        preview: calculateReadoutReassignmentPreview(
          selectedReadout.readout,
          selectedReadout.competitorId ?? '',
          target,
          competitors,
          classes,
          courses,
          zeroTimeSec,
          emergency
        ),
      } as const;
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : 'Avläsningen kan inte förhandsgranskas säkert.',
      } as const;
    }
  }, [
    classes,
    competitors,
    courses,
    emergency,
    selectedReadout,
    wrongCompetitorTargetId,
    zeroTimeSec,
  ]);
  useEffect(() => {
    if (!selectedReadout) {
      setCorrectionAudits([]);
      setCorrectionAuditError(null);
      setCorrectionAuditLoading(false);
      return;
    }

    let active = true;
    setCorrectionAuditLoading(true);
    setCorrectionAuditError(null);
    void onLoadResultReassignmentAudits(selectedReadout.clientReadoutId)
      .then((audits) => {
        if (active) setCorrectionAudits(audits);
      })
      .catch((error: unknown) => {
        if (active) {
          setCorrectionAuditError(
            error instanceof Error
              ? error.message
              : 'Korrigeringshistoriken kunde inte hämtas.'
          );
        }
      })
      .finally(() => {
        if (active) setCorrectionAuditLoading(false);
      });

    return () => {
      active = false;
    };
  }, [onLoadResultReassignmentAudits, selectedReadout]);
  const unknownCardNameSuggestions = useMemo(
    () => getRunnerNameSuggestions(runnerDb, unknownCardName),
    [runnerDb, unknownCardName]
  );

  // This runner detail is independent of the expanded readout timeline item.
  const inspectedRunner = useMemo(() => {
    return selectedRunnerId
      ? competitors.find((competitor) => competitor.id === selectedRunnerId) ?? null
      : null;
  }, [competitors, selectedRunnerId]);

  const inspectedClass = useMemo(
    () => classes.find((c) => c.id === inspectedRunner?.classId) ?? null,
    [classes, inspectedRunner]
  );

  const inspectedPlacement = useMemo(
    () => getCompetitorPlacement(inspectedRunner, competitors),
    [competitors, inspectedRunner]
  );

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
  const getReadoutPlacementLabel = (record: ReadoutHistoryRecord) => {
    const placement = record.competitorId
      ? competitorPlacements.get(record.competitorId)
      : null;
    return placement ? `${placement.pos}/${placement.total}` : '—';
  };

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

  const handleApproveManualResult = async (e: React.FormEvent) => {
    e.preventDefault();
    const competitorId = selectedReadout?.competitorId;
    if (!competitorId) {
      setManualApprovalError('Ingen löpare är kopplad till avläsningen.');
      return;
    }
    const competitor = competitors.find((candidate) => candidate.id === competitorId);
    if (!competitor || competitor.status !== 'PRELIMINARY_FIN') {
      setManualApprovalError('Endast ett preliminärt resultat kan godkännas manuellt.');
      return;
    }
    if (
      competitor.manualFinishTimeSec == null &&
      competitor.finishTimeSec == null
    ) {
      setManualApprovalError('En giltig måltid saknas.');
      return;
    }
    if (manualApprovalReason.trim().length < 3) {
      setManualApprovalError('Ange en tydlig anledning för det manuella godkännandet.');
      return;
    }
    setManualApprovalBusy(true);
    setManualApprovalError(null);
    try {
      const error = await onApproveManualResult(
        competitorId,
        manualApprovalReason.trim()
      );
      setManualApprovalError(error);
      if (!error) setManualApprovalReason('');
    } finally {
      setManualApprovalBusy(false);
    }
  };

  const handleSelectReadout = (
    record: ReadoutHistoryRecord,
    forceOpen = false
  ) => {
    const alreadySelected = selectedReadoutId === record.clientReadoutId;
    const isClosing = alreadySelected && !forceOpen;
    if (alreadySelected && forceOpen) return;
    setSelectedReadoutId(isClosing ? null : record.clientReadoutId);
    setWrongCompetitorOpen(
      !isClosing &&
        record.issueType === 'WRONG_COMPETITOR' &&
        record.issueState !== 'RESOLVED' &&
        record.issueState !== 'DISMISSED'
    );
    setWrongCompetitorTargetId('');
    setWrongCompetitorReason('');
    setWrongCompetitorError(null);
    setUnknownCardError(null);
    setUnknownCardSuccess(null);
    setUnknownCardNameSuggestionOpen(false);
    setUnknownCardActiveSuggestionIndex(0);
    if (isClosing) return;

    if (record.issueType === 'UNKNOWN_CARD') {
      const runner =
        record.suggestedRunner ??
        runnerDb.find((candidate) => candidate.siNumber === record.readout.siNumber) ??
        null;
      const matchingClass = runner?.defaultClassName
        ? classes.find(
            (candidate) =>
              candidate.name.toLocaleLowerCase() ===
              runner.defaultClassName?.toLocaleLowerCase()
          )
        : null;
      setUnknownCardName(runner?.fullName ?? '');
      setUnknownCardClub(runner?.club ?? defaultClubName ?? '');
      setUnknownCardClassId(
        matchingClass?.id ?? classes[3]?.id ?? classes[0]?.id ?? ''
      );
      setUnknownCardRunnerProfileId(runner?.id ?? null);
      setUnknownCardIsRental(false);
      setUnknownCardIsBorrowed(false);
      setUnknownCardStartClock('');
    }
  };

  const selectUnknownCardNameSuggestion = (runner: RunnerDbEntry) => {
    const matchingClass = runner.defaultClassName
      ? classes.find(
          (candidate) =>
            candidate.name.toLocaleLowerCase() ===
            runner.defaultClassName?.toLocaleLowerCase()
        )
      : null;
    setUnknownCardName(runner.fullName);
    setUnknownCardClub(runner.club);
    setUnknownCardClassId(matchingClass?.id ?? '');
    setUnknownCardRunnerProfileId(runner.id);
    setUnknownCardNameSuggestionOpen(false);
    setUnknownCardActiveSuggestionIndex(0);
  };

  const handleUnknownCardNameKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (!unknownCardNameSuggestionOpen || unknownCardNameSuggestions.length === 0) {
      if (event.key === 'ArrowDown' && unknownCardNameSuggestions.length > 0) {
        setUnknownCardNameSuggestionOpen(true);
        setUnknownCardActiveSuggestionIndex(0);
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      setUnknownCardActiveSuggestionIndex(
        (index) => (index + 1) % unknownCardNameSuggestions.length
      );
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      setUnknownCardActiveSuggestionIndex(
        (index) =>
          (index - 1 + unknownCardNameSuggestions.length) %
          unknownCardNameSuggestions.length
      );
      event.preventDefault();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectUnknownCardNameSuggestion(
        unknownCardNameSuggestions[unknownCardActiveSuggestionIndex]
      );
    } else if (event.key === 'Escape') {
      setUnknownCardNameSuggestionOpen(false);
    }
  };

  const handleOpenWrongCompetitorDraft = () => {
    setWrongCompetitorTargetId('');
    setWrongCompetitorReason('');
    setWrongCompetitorError(null);
    setWrongCompetitorOpen(true);
  };

  const handleApplyResultReassignment = async () => {
    if (!selectedReadout || !wrongCompetitorTargetId) return;
    if (wrongCompetitorReason.trim().length < 3) {
      setWrongCompetitorError('Ange en tydlig anledning till korrigeringen.');
      return;
    }
    if (!reassignmentPreview || !('preview' in reassignmentPreview)) {
      setWrongCompetitorError(
        reassignmentPreview && 'error' in reassignmentPreview
          ? reassignmentPreview.error
          : 'Välj en giltig löpare för att visa förhandsgranskningen.'
      );
      return;
    }

    setWrongCompetitorBusy(true);
    setWrongCompetitorError(null);
    try {
      const audit = await onApplyResultReassignment(
        selectedReadout,
        wrongCompetitorTargetId,
        wrongCompetitorReason.trim()
      );
      setCorrectionAudits((current) =>
        [
          ...current.filter((entry) => entry.operationId !== audit.operationId),
          audit,
        ].sort(
          (left, right) =>
            (left.sequence ?? 0) - (right.sequence ?? 0) ||
            left.timestamp.localeCompare(right.timestamp)
        )
      );
      setWrongCompetitorOpen(false);
      setWrongCompetitorTargetId('');
      setWrongCompetitorReason('');
    } catch (error) {
      setWrongCompetitorError(
        error instanceof Error ? error.message : 'Resultatet kunde inte korrigeras.'
      );
    } finally {
      setWrongCompetitorBusy(false);
    }
  };

  const handleResolveUnknownCard = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    const record = selectedReadout;
    if (!record) return;
    const siNumber = record.readout.siNumber;

    setUnknownCardBusyId(record.clientReadoutId);
    setUnknownCardError(null);
    setUnknownCardSuccess(null);
    try {
      const error = await onResolveUnknownCard(record, siNumber, {
        fullName: unknownCardName.trim(),
        club: unknownCardClub.trim() || defaultClubName || 'Klubblös',
        classId: unknownCardClassId,
        runnerProfileId: unknownCardRunnerProfileId,
        isRentalCard: unknownCardIsRental,
        isBorrowedCard: unknownCardIsBorrowed,
        allocatedStartSec: unknownCardStartClock.trim()
          ? parseClockToSeconds(unknownCardStartClock)
          : null,
      });
      if (error) {
        setUnknownCardError(error);
      } else {
        setUnknownCardSuccess(
          `${unknownCardName.trim()} kopplades till avläsning nr ${record.captureSequence}.`
        );
      }
    } catch (error) {
      setUnknownCardError(
        error instanceof Error ? error.message : 'Avläsningen kunde inte kopplas.'
      );
    } finally {
      setUnknownCardBusyId(null);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Avläsning och översikt
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Läser ut SI-brickor (SI5–SIAC) via ansluten SI-station och validerar banor direkt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <details className="relative">
            <summary
              aria-label={`Offlinekö. ${
                isOfflineActive ? 'Offline aktivt' : 'Nätverk OK'
              }. ${offlineSnap.pendingItems.length} i kö`}
              className={`flex cursor-pointer list-none items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium ${
                isOfflineActive || offlineSnap.pendingItems.length > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              {isOfflineActive ? (
                <CloudOff className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              )}
              <span>Offlinekö</span>
              <span aria-hidden="true">·</span>
              <span>{isOfflineActive ? 'Offline' : 'Nätverk OK'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {offlineSnap.pendingItems.length} i kö
              </span>
            </summary>
            <div className="absolute right-0 top-full z-40 mt-2 max-h-[75vh] w-[min(90vw,48rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
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
            {offlineQueueDisplayItems.map((item) => {
              const isBusy = queueActionId === item.id || offlineSnap.flushing;
              const readout = item.readoutPayload;
              const punch = item.onlinePunchPayload;
              const itemName =
                item.kind === 'READOUT'
                  ? `Avläsning utanför aktuell tidslinje · SI ${readout?.siNumber ?? 'okänt'} · ${readout?.cardSeries ?? 'okänd bricka'}`
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
                        {readout.finishTimeSec != null
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
            {offlineQueueDisplayItems.length === 0 &&
              offlineSnap.pendingItems.some((item) => item.kind === 'READOUT') && (
              <li className="px-3.5 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                Köade avläsningar hanteras på respektive tidslinjerad.
              </li>
              )}
          </ul>
        </section>
      )}
        </div>
      </details>
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

      <ReadoutTimeline
        records={readoutHistory}
        latestReadoutId={latestReadoutId}
        expandedReadoutId={selectedReadoutId}
        historyError={readoutHistoryError}
        onToggleReadout={handleSelectReadout}
        getPlacementLabel={getReadoutPlacementLabel}
      >
        {selectedReadout && (
        <section
          aria-label={`Detaljer för avläsning ${selectedReadout.captureSequence}`}
          className="bg-white/50 dark:bg-slate-950/20"
        >
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Avläsningsdetaljer
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                SI {formatSiNumber(selectedReadout.readout.siNumber)}
                {` · ${selectedReadout.readout.cardSeries} · Mål ${formatSecondsAsClock(
                  selectedReadout.readout.finishTimeSec
                )} · ${new Date(selectedReadout.capturedAt).toLocaleString('sv-SE')}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSelectReadout(selectedReadout)}
              className="shrink-0 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Stäng
            </button>
          </div>
          {selectedReadout && (
          <div className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              <span>
                Ursprunglig match:{' '}
                {selectedReadout.originalCompetitorName ?? 'Ingen match vid avläsning'}
                {selectedReadout.originalClassName
                  ? ` · ${selectedReadout.originalClassName}`
                  : ''}
              </span>
              <span>
                Nuvarande match:{' '}
                {selectedReadout.competitorName ?? 'Ingen aktuell match'}
                {selectedReadout.className ? ` · ${selectedReadout.className}` : ''}
              </span>
              <span>
                Ursprungligt resultat: {selectedReadout.originalResultStatus ?? 'Ej tilldelat'}
                {selectedReadout.originalCompetitorSnapshot?.runningTimeSec != null
                  ? ` · tid ${formatDurationMmSs(
                      selectedReadout.originalCompetitorSnapshot.runningTimeSec
                    )}`
                  : ''}
                {selectedReadout.originalCompetitorSnapshot?.validation?.totalTimeLossSec != null
                  ? ` · Bom ${formatDurationMmSs(
                      selectedReadout.originalCompetitorSnapshot.validation.totalTimeLossSec
                    )}`
                  : ''}
              </span>
              <span>
                Aktuellt resultat: {selectedReadout.resultStatus ?? 'Ej tilldelat'}
                {selectedReadout.resultStatus === 'OK'
                  ? selectedReadout.competitorSnapshot?.resultVerification === 'MANUALLY_APPROVED_OK'
                    ? ' · Manuellt godkänt OK'
                    : ' · SI-verifierat OK'
                  : ''}
                {selectedReadout.competitorSnapshot?.runningTimeSec != null
                  ? ` · tid ${formatDurationMmSs(
                      selectedReadout.competitorSnapshot.runningTimeSec
                    )}`
                  : ''}
                {selectedReadout.competitorSnapshot?.validation?.totalTimeLossSec != null
                  ? ` · Bom ${formatDurationMmSs(
                      selectedReadout.competitorSnapshot.validation.totalTimeLossSec
                    )}`
                  : ''}
              </span>
              <span>
                Ärende: {getReadoutIssueSummary(selectedReadout) ?? 'Inget'}
              </span>
              <span>
                Leverans: {getReadoutDeliveryLabel(selectedReadout.deliveryState)}
              </span>
            </div>
            {selectedReadout.suggestedRunner && (
              <div className="mt-1">
                Föreslagen löpare: {selectedReadout.suggestedRunner.fullName}
              </div>
            )}
            {selectedReadout.syncError && (
              <div className="mt-1 text-red-700 dark:text-red-300">
                {selectedReadout.syncError}
              </div>
            )}
            {(() => {
              const approvalCompetitor = selectedReadout.competitorId
                ? competitors.find(
                    (competitor) =>
                      competitor.id === selectedReadout.competitorId
                  ) ?? null
                : null;
              const canApproveManually =
                approvalCompetitor?.status === 'PRELIMINARY_FIN' &&
                (approvalCompetitor.manualFinishTimeSec != null ||
                  approvalCompetitor.finishTimeSec != null);
              if (!canApproveManually) return null;
              return (
                <form
                  onSubmit={(event) => void handleApproveManualResult(event)}
                  className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-slate-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-slate-100"
                >
                  <h3 className="text-xs font-semibold">
                    Manuell godkännande av resultat
                  </h3>
                  <p className="mt-0.5 text-[11px]">
                    Måltid: {formatSecondsAsClock(
                      approvalCompetitor.manualFinishTimeSec ??
                        approvalCompetitor.finishTimeSec
                    )}. Ange anledning innan resultatet godkänns som OK.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      value={manualApprovalReason}
                      onChange={(event) =>
                        setManualApprovalReason(event.target.value)
                      }
                      placeholder="Anledning, t.ex. förlorad SI-bricka"
                      className="min-w-64 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <button
                      type="submit"
                      disabled={
                        manualApprovalBusy ||
                        manualApprovalReason.trim().length < 3
                      }
                      className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {manualApprovalBusy
                        ? 'Godkänner...'
                        : 'Godkänn resultat som OK'}
                    </button>
                  </div>
                  {manualApprovalError && (
                    <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">
                      {manualApprovalError}
                    </p>
                  )}
                </form>
              );
            })()}
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedReadout.readout.punches.map((punch, index) => (
                <span
                  key={`${selectedReadout.clientReadoutId}-${index}`}
                  className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono"
                >
                  {punch.code} · {formatSecondsAsClock(punch.timeSec)}
                </span>
              ))}
              {selectedReadout.readout.punches.length === 0 && <span>Inga stämplingar</span>}
            </div>
          </div>
          )}
          {isEligibleWrongCompetitorReadout(selectedReadout) && (
              <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                {!wrongCompetitorOpen ? (
                  <button
                    type="button"
                    disabled={wrongCompetitorBusy}
                    onClick={handleOpenWrongCompetitorDraft}
                    className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50"
                  >
                    Fel löpare
                  </button>
                ) : (
                  <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Korrigera löparmatchning
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                        Avläsningens originaldata och stämplingar ändras inte.
                      </p>
                    </div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Ny löpare
                      <select
                        value={wrongCompetitorTargetId}
                        onChange={(event) =>
                          setWrongCompetitorTargetId(event.target.value)
                        }
                        className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="">Välj löpare</option>
                        {competitors
                          .filter(
                            (competitor) =>
                              competitor.id !== selectedReadout.competitorId
                          )
                          .map((competitor) => (
                            <option key={competitor.id} value={competitor.id}>
                              {competitor.fullName} ·{' '}
                              {classes.find(
                                (candidate) => candidate.id === competitor.classId
                              )?.name ?? 'Okänd klass'}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Anledning
                      <textarea
                        value={wrongCompetitorReason}
                        onChange={(event) =>
                          setWrongCompetitorReason(event.target.value)
                        }
                        maxLength={500}
                        rows={2}
                        placeholder="Beskriv varför resultatet ska kopplas till en annan löpare"
                        className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                    {reassignmentPreview && (
                      'error' in reassignmentPreview ? (
                        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
                          {reassignmentPreview.error}
                        </p>
                      ) : (
                        <div
                          aria-live="polite"
                          className="rounded border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <h4 className="font-semibold text-slate-800 dark:text-slate-100">
                            Förhandsgranskning
                          </h4>
                          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                            <span>
                              Original match: {selectedReadout.originalCompetitorName ?? '—'}
                            </span>
                            <span>
                              Ny match: {reassignmentPreview.preview.competitor.fullName}
                            </span>
                            <span>Status: {reassignmentPreview.preview.status}</span>
                            <span>
                              Placering:{' '}
                              {reassignmentPreview.preview.placing
                                ? `${reassignmentPreview.preview.placing.pos} / ${reassignmentPreview.preview.placing.total}`
                                : '—'}
                            </span>
                            <span>
                              Tid: {formatDurationMmSs(reassignmentPreview.preview.runningTimeSec)}
                            </span>
                            <span>
                              Bom:{' '}
                              {reassignmentPreview.preview.bomSec == null
                                ? '—'
                                : formatDurationMmSs(reassignmentPreview.preview.bomSec)}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                    {wrongCompetitorError && (
                      <p role="alert" className="text-xs text-red-700 dark:text-red-300">
                        {wrongCompetitorError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          wrongCompetitorBusy ||
                          !wrongCompetitorTargetId ||
                          wrongCompetitorReason.trim().length < 3 ||
                          !reassignmentPreview ||
                          !('preview' in reassignmentPreview)
                        }
                        onClick={() => void handleApplyResultReassignment()}
                        className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {wrongCompetitorBusy ? 'Sparar...' : 'Bekräfta korrigering'}
                      </button>
                      <button
                        type="button"
                        disabled={wrongCompetitorBusy}
                        onClick={() => {
                          setWrongCompetitorOpen(false);
                          setWrongCompetitorTargetId('');
                          setWrongCompetitorReason('');
                          setWrongCompetitorError(null);
                        }}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                      >
                        Avbryt
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          {correctionAudits.length > 0 && (
            <section
              aria-label="Korrigeringshistorik"
              className="border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-800"
            >
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                Korrigeringshistorik
              </h3>
              <ol className="mt-2 space-y-2">
                {correctionAudits.map((audit) => (
                  <li
                    key={audit.operationId}
                    className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <p className="font-medium">
                      {(audit.previousCompetitor ?? audit.originalCompetitor).name} →{' '}
                      {audit.correctedCompetitor.name}
                      {' · '}
                      {new Date(audit.timestamp).toLocaleString('sv-SE')}
                    </p>
                    <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                      {audit.result.previousStatus} → {audit.result.newStatus}
                      {' · '}tid {formatDurationMmSs(audit.result.runningTimeSec)}
                      {' · '}Bom{' '}
                      {audit.result.bomSec == null
                        ? '—'
                        : formatDurationMmSs(audit.result.bomSec)}
                      {' · '}av {audit.actorRole} ({audit.actorUid})
                    </p>
                    <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                      Anledning: {audit.reason}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(correctionAuditLoading || correctionAuditError) && (
            <p
              className={`border-t border-slate-200 px-4 py-2 text-[11px] dark:border-slate-800 ${
                correctionAuditError
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
              role={correctionAuditError ? 'alert' : undefined}
            >
              {correctionAuditError ?? 'Hämtar korrigeringshistorik...'}
            </p>
          )}
          {selectedReadout.issueType === 'UNKNOWN_CARD' &&
            selectedReadout.issueState !== 'RESOLVED' &&
            selectedReadout.issueState !== 'DISMISSED' && (
              <form
                onSubmit={(event) => void handleResolveUnknownCard(event)}
                className="border-t border-slate-200 dark:border-slate-800 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 rounded-b-lg"
              >
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Koppla okänd SI-bricka
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                  Läsaren är fortsatt aktiv. Nästa bricka kan läsas medan denna avläsning hanteras.
                </p>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    SI-bricka
                    <input
                      value={formatSiNumber(selectedReadout.readout.siNumber)}
                      readOnly
                      className="mt-1 w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 font-mono"
                    />
                  </label>
                  <div className="relative text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    <label className="block" htmlFor="unknown-card-runner-name">
                      Löparens namn
                    </label>
                    <input
                      id="unknown-card-runner-name"
                      value={unknownCardName}
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={
                        unknownCardNameSuggestionOpen &&
                        unknownCardName.trim().length >= 2
                      }
                      aria-controls="unknown-card-runner-suggestions"
                      aria-activedescendant={
                        unknownCardNameSuggestionOpen &&
                        unknownCardNameSuggestions.length > 0
                          ? `unknown-card-runner-suggestion-${unknownCardActiveSuggestionIndex}`
                          : undefined
                      }
                      onFocus={() => {
                        if (unknownCardNameSuggestions.length > 0) {
                          setUnknownCardNameSuggestionOpen(true);
                        }
                      }}
                      onBlur={() => setUnknownCardNameSuggestionOpen(false)}
                      onKeyDown={handleUnknownCardNameKeyDown}
                      onChange={(event) => {
                        setUnknownCardName(event.target.value);
                        setUnknownCardRunnerProfileId(null);
                        setUnknownCardNameSuggestionOpen(true);
                        setUnknownCardActiveSuggestionIndex(0);
                      }}
                      required
                      className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                    />
                    {unknownCardNameSuggestionOpen &&
                      unknownCardName.trim().length >= 2 && (
                        <div
                          id="unknown-card-runner-suggestions"
                          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-lg"
                        >
                          {unknownCardNameSuggestions.length > 0 ? (
                            <div role="listbox" aria-label="Löpare i databasen">
                              {unknownCardNameSuggestions.map((runner, index) => (
                                <button
                                  id={`unknown-card-runner-suggestion-${index}`}
                                  key={`${runner.siNumber}-${runner.id}`}
                                  type="button"
                                  role="option"
                                  aria-selected={
                                    index === unknownCardActiveSuggestionIndex
                                  }
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() =>
                                    selectUnknownCardNameSuggestion(runner)
                                  }
                                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs ${
                                    index === unknownCardActiveSuggestionIndex
                                      ? 'bg-slate-100 dark:bg-slate-800'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                  }`}
                                >
                                  <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                                    {runner.fullName}
                                    <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                                      {runner.club}
                                    </span>
                                  </span>
                                  <span className="shrink-0 font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400">
                                    SI {formatSiNumber(runner.siNumber)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p
                              role="status"
                              className="px-2.5 py-1.5 text-xs font-normal text-slate-500 dark:text-slate-400"
                            >
                              Inga löpare matchar sökningen.
                            </p>
                          )}
                        </div>
                      )}
                  </div>
                  <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    Klubb
                    <input
                      value={unknownCardClub}
                      onChange={(event) => setUnknownCardClub(event.target.value)}
                      className="mt-1 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    Klass
                    <select
                      value={unknownCardClassId}
                      onChange={(event) => setUnknownCardClassId(event.target.value)}
                      required={classes.length > 0}
                      className="mt-1 w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                    >
                      <option value="">Välj klass</option>
                      {classes.map((compClass) => (
                        <option key={compClass.id} value={compClass.id}>
                          {compClass.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={unknownCardIsRental}
                      onChange={(event) => setUnknownCardIsRental(event.target.checked)}
                      className="h-3.5 w-3.5 rounded"
                    />
                    Klubbens hyrbricka
                  </label>
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={unknownCardIsBorrowed}
                      onChange={(event) => setUnknownCardIsBorrowed(event.target.checked)}
                      className="h-3.5 w-3.5 rounded"
                    />
                    Lånad privatbricka
                  </label>
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                    Valfri starttid
                    <input
                      value={unknownCardStartClock}
                      onChange={(event) => setUnknownCardStartClock(event.target.value)}
                      placeholder="HH:MM:SS"
                      className="w-24 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                    />
                  </label>
                </div>
                {unknownCardError && (
                  <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">
                    {unknownCardError}
                  </p>
                )}
                {unknownCardSuccess && (
                  <p role="status" className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                    {unknownCardSuccess}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={
                    unknownCardBusyId === selectedReadout.clientReadoutId ||
                    unknownCardSuccess !== null
                  }
                  className="mt-2 inline-flex items-center gap-1.5 rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {unknownCardBusyId === selectedReadout.clientReadoutId
                    ? 'Sparar…'
                    : 'Anmäl och koppla avläsning'}
                </button>
              </form>
            )}
          {selectedReadout?.resultStatus === 'MP' && selectedReadout.issueState === 'NONE' && (
            <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-2">
              <button
                type="button"
                disabled={issueActionBusyId === selectedReadout.clientReadoutId}
                onClick={() => void handleCreateMpReviewIssue(selectedReadout.clientReadoutId)}
                className="rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
              >
                {issueActionBusyId === selectedReadout.clientReadoutId
                  ? 'Sparar…'
                  : 'Skapa MP-granskningsärende'}
              </button>
              {issueActionError?.clientReadoutId === selectedReadout.clientReadoutId &&
                issueActionBusyId === null && (
                  <div role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
                    {issueActionError.message}
                  </div>
                )}
            </div>
          )}
          {selectedOfflineReadoutQueueItem && (
            <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Avläsningen väntar i offlinekön
              </p>
              <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                Köad {new Date(selectedOfflineReadoutQueueItem.createdAt).toLocaleString('sv-SE')}
                {selectedOfflineReadoutQueueItem.lastError
                  ? ` · ${selectedOfflineReadoutQueueItem.lastError}`
                  : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={
                    queueActionId === selectedOfflineReadoutQueueItem.id ||
                    offlineSnap.flushing ||
                    isOfflineActive
                  }
                  onClick={async () => {
                    setQueueActionId(selectedOfflineReadoutQueueItem.id);
                    try {
                      await onRetryOfflineQueueItem(selectedOfflineReadoutQueueItem.id);
                    } finally {
                      setQueueActionId(null);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${
                      queueActionId === selectedOfflineReadoutQueueItem.id
                        ? 'animate-spin'
                        : ''
                    }`}
                  />
                  Försök igen
                </button>
                <button
                  type="button"
                  disabled={
                    queueActionId === selectedOfflineReadoutQueueItem.id ||
                    offlineSnap.flushing
                  }
                  onClick={() =>
                    onRemoveOfflineQueueItem(selectedOfflineReadoutQueueItem.id)
                  }
                  className="inline-flex items-center gap-1 rounded bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/40 dark:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Ta bort ur kön
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      </ReadoutTimeline>

      {/* Competition overview stays secondary to the single readout timeline. */}
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
