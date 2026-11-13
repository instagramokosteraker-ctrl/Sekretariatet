import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { scanSIAssignmentInventoryFromFirestore } from '../firebase';
import {
  getLiveIntegrityFindingKey,
  partitionLiveIntegrityFindings,
  type LiveIntegrityFinding,
} from '../utils/liveIntegrityMonitoring';
import type { SIAssignmentInventoryReport } from '../utils/siAssignmentInventory';

const SCAN_INTERVAL_MS = 5 * 60 * 1000;

export function LiveIntegrityMonitorView() {
  const [report, setReport] = useState<SIAssignmentInventoryReport | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedFindingKeys, setDismissedFindingKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [showDismissedFindings, setShowDismissedFindings] = useState(false);
  const mountedRef = useRef(true);
  const scanInFlightRef = useRef(false);
  const scanNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    mountedRef.current = true;

    const scan = async () => {
      if (scanInFlightRef.current) return;
      scanInFlightRef.current = true;
      if (mountedRef.current) {
        setBusy(true);
        setError(null);
      }

      try {
        const nextReport = await scanSIAssignmentInventoryFromFirestore();
        if (mountedRef.current) {
          setReport(nextReport);
          setLastScanAt(nextReport.generatedAtIso);
        }
      } catch (scanError) {
        if (mountedRef.current) {
          setError(
            scanError instanceof Error
              ? scanError.message
              : 'Kontrollen kunde inte genomföras.'
          );
        }
      } finally {
        scanInFlightRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    };

    scanNowRef.current = () => void scan();
    void scan();
    const intervalId = window.setInterval(() => void scan(), SCAN_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      scanNowRef.current = () => {};
      window.clearInterval(intervalId);
    };
  }, []);

  const findings = useMemo(
    () => report ? partitionLiveIntegrityFindings(report) : null,
    [report]
  );
  const visibleActiveFindings = findings?.activeFindings.filter(
    (finding) => !dismissedFindingKeys.has(getLiveIntegrityFindingKey(finding))
  ) ?? [];
  const dismissedFindings = findings?.activeFindings.filter(
    (finding) => dismissedFindingKeys.has(getLiveIntegrityFindingKey(finding))
  ) ?? [];
  const activeErrorCount = visibleActiveFindings.filter(
    (finding) => finding.issue.severity === 'ERROR'
  ).length;
  const status = error
    ? 'KONTROLLEN MISSLYCKADES'
    : !report
      ? 'KONTROLLERAR'
      : activeErrorCount > 0
        ? 'AKTIV AVVIKELSE'
        : visibleActiveFindings.length > 0
          ? 'VARNING'
          : 'INGEN NY AVVIKELSE';
  const statusClass = error || activeErrorCount > 0
    ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
    : !report
      ? 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
    : visibleActiveFindings.length > 0
      ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
      : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
  const StatusIcon = error || activeErrorCount > 0
    ? ShieldAlert
    : !report
      ? RefreshCw
    : visibleActiveFindings.length > 0
      ? AlertTriangle
      : CheckCircle2;

  const dismissFinding = (finding: LiveIntegrityFinding) => {
    setDismissedFindingKeys((previous) => {
      const next = new Set(previous);
      next.add(getLiveIntegrityFindingKey(finding));
      return next;
    });
  };

  const dismissAllVisibleFindings = () => {
    setDismissedFindingKeys((previous) => {
      const next = new Set(previous);
      visibleActiveFindings.forEach((finding) =>
        next.add(getLiveIntegrityFindingKey(finding))
      );
      return next;
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Live integritetskontroll · Drift-larm
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Skrivskyddad V2-kontroll av SI-kopplingar, löpare, dubbletter och
            ownerUid/cardSeries-paritet. Automatisk kontroll var femte minut.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showDismissedFindings}
              onChange={(event) => setShowDismissedFindings(event.target.checked)}
              className="rounded border-slate-300"
            />
            Visa kvitterade larm
          </label>
          <button
            type="button"
            disabled={visibleActiveFindings.length === 0}
            onClick={dismissAllVisibleFindings}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Rensa/Kvittera alla synliga larm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => scanNowRef.current()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:text-slate-100"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Skannar...' : 'Skanna nu'}
          </button>
        </div>
      </header>

      <div role="status" aria-live="polite" className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${statusClass}`}>
        <StatusIcon className="h-4 w-4 shrink-0" />
        <span>{status}</span>
        {findings && (
          <span className="ml-auto font-normal">
            {visibleActiveFindings.length} aktiva · {dismissedFindings.length} kvitterade · {findings.acknowledgedFindings.length} godkända undantag
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Senaste kontrollen misslyckades: {error}
          {lastScanAt && ` Visar senaste lyckade kontroll från ${formatScanTime(lastScanAt)}.`}
        </p>
      )}

      {report && findings && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="Tävlingar" value={report.competitionCount} />
            <Metric label="Löpare / kopplingar" value={`${report.competitorCount} / ${report.assignmentCount}`} />
            <Metric label="Aktiva avvikelser" value={visibleActiveFindings.length} />
            <Metric label="Kvitterade larm" value={dismissedFindings.length} />
            <Metric label="Godkända historiska undantag" value={findings.acknowledgedFindings.length} />
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            Senast lyckad kontroll: {formatScanTime(lastScanAt ?? report.generatedAtIso)}
          </p>

          {visibleActiveFindings.length > 0 && (
            <FindingList
              title="Aktiva avvikelser"
              findings={visibleActiveFindings}
              tone="red"
              onDismiss={dismissFinding}
            />
          )}

          {showDismissedFindings && dismissedFindings.length > 0 && (
            <FindingList
              title="Kvitterade larm"
              findings={dismissedFindings}
              tone="slate"
            />
          )}

          <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
            <h3 className="text-xs font-bold text-amber-900 dark:text-amber-200">
              Godkända historiska ownerUid-undantag
            </h3>
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              Exakt matchade fynd visas här och undantas från det aktiva larmet.
              De är inte rättade och ska inte tolkas som bevis för korrekt ägarskap.
            </p>
            {findings.acknowledgedFindings.length > 0 ? (
              <FindingList
                title=""
                findings={findings.acknowledgedFindings}
                tone="amber"
              />
            ) : (
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Inga av de godkända undantagen återfanns vid senaste kontrollen.
              </p>
            )}
            {findings.unobservedExceptions.length > 0 && (
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Inte återfunna: {findings.unobservedExceptions.map((exception) =>
                  `${exception.competitionName} · ${exception.siNumber}`
                ).join(', ')}.
              </p>
            )}
          </section>
        </>
      )}

      {!report && !error && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Första skrivskyddade kontrollen pågår...
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
      <p className="text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

function FindingList({
  title,
  findings,
  tone,
  onDismiss,
}: {
  title: string;
  findings: LiveIntegrityFinding[];
  tone: 'red' | 'amber' | 'slate';
  onDismiss?: (finding: LiveIntegrityFinding) => void;
}) {
  const toneClass = tone === 'red'
    ? 'border-red-200 text-red-900 dark:border-red-900 dark:text-red-200'
    : tone === 'amber'
      ? 'border-amber-200 text-amber-900 dark:border-amber-900 dark:text-amber-200'
      : 'border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-300';

  return (
    <div className="space-y-1">
      {title && <h3 className="text-xs font-bold">{title}</h3>}
      <ul className="space-y-1">
        {findings.map(({ competitionId, competitionName, issue }, index) => (
          <li
            key={getLiveIntegrityFindingKey({ competitionId, competitionName, issue }) || index}
            className={`flex items-start justify-between gap-2 rounded-md border px-2.5 py-2 text-[11px] ${toneClass}`}
          >
            <span className="min-w-0">
              <span className="font-semibold">{competitionName}</span>
              {' · '}{issue.conflictType}
              {' · SI '}{issue.siNumber}
              {issue.competitorIds.length > 0 && ` · Löpare ${issue.competitorIds.join(', ')}`}
              {issue.assignmentDocumentIds.length > 0 && ` · Koppling ${issue.assignmentDocumentIds.join(', ')}`}
              {' · '}{issue.detail}
            </span>
            {onDismiss && (
              <button
                type="button"
                onClick={() =>
                  onDismiss({ competitionId, competitionName, issue })
                }
                aria-label={`Kvittera larm för ${competitionName}, SI ${issue.siNumber}`}
                title="Kvittera larm"
                className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatScanTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('sv-SE');
}
