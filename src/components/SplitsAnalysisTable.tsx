import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ChevronDown, ChevronUp } from 'lucide-react';
import type { CompClass, Competitor, Course } from '../types/sportident';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
} from '../services/sportidentProtocol';
import { RunnerStatusIndicator } from './StatusLabels';
import { RunnerSplitCardModal } from './RunnerSplitCardModal';

export type SplitsCellMode = 'LEG_AND_BOM' | 'CUMULATIVE';

function getLiveRunningTimeSec(startTimeSec: number | null, nowMs: number): number | null {
  if (startTimeSec === null) return null;

  const now = new Date(nowMs);
  const currentClockSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const difference = currentClockSec - startTimeSec;
  const elapsedSec = difference < -12 * 3600 ? difference + 86400 : difference;
  return elapsedSec >= 0 ? elapsedSec : null;
}

interface SplitsAnalysisTableProps {
  classes: CompClass[];
  courses: Course[];
  competitors: Competitor[];
  selectedClassId: string;
  onSelectClassId: (id: string) => void;
  onSelectClub?: (clubName: string) => void;
  onInspectRunner?: (runner: Competitor) => void;
  liveUpdates?: boolean;
  liveUpdateScope?: string;
}

export function SplitsAnalysisTable({
  classes,
  courses,
  competitors,
  selectedClassId,
  onSelectClassId,
  onSelectClub,
  onInspectRunner,
  liveUpdates = false,
  liveUpdateScope,
}: SplitsAnalysisTableProps) {
  const [cellMode, setCellMode] = useState<SplitsCellMode>('LEG_AND_BOM');
  const [showLegMatrix, setShowLegMatrix] = useState<boolean>(false);
  // Sort per class by control order (null = official result order, -1 = sort by total bomtid, >0 = leg order)
  const [sortByLegOrder, setSortByLegOrder] = useState<Record<string, number | null>>({});
  const [expandedRunnerId, setExpandedRunnerId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const previousCompetitorsRef = useRef<Map<string, string>>(new Map());
  const updatedCompetitorsRef = useRef<Map<string, number>>(new Map());
  const liveScopeRef = useRef(liveUpdateScope);
  const hasCompetitorBaselineRef = useRef(false);

  useEffect(() => {
    if (!liveUpdates) return;

    if (liveScopeRef.current !== liveUpdateScope) {
      liveScopeRef.current = liveUpdateScope;
      previousCompetitorsRef.current.clear();
      updatedCompetitorsRef.current.clear();
      hasCompetitorBaselineRef.current = false;
    }

    const currentCompetitors = new Map(
      competitors.map((competitor) => [competitor.id, JSON.stringify(competitor)])
    );

    if (hasCompetitorBaselineRef.current) {
      const updatedAt = Date.now();
      currentCompetitors.forEach((snapshot, competitorId) => {
        if (previousCompetitorsRef.current.get(competitorId) !== snapshot) {
          updatedCompetitorsRef.current.set(competitorId, updatedAt);
        }
      });
      updatedCompetitorsRef.current.forEach((_, competitorId) => {
        if (!currentCompetitors.has(competitorId)) {
          updatedCompetitorsRef.current.delete(competitorId);
        }
      });
    } else if (currentCompetitors.size > 0) {
      hasCompetitorBaselineRef.current = true;
    }

    previousCompetitorsRef.current = currentCompetitors;
  }, [competitors, liveUpdateScope, liveUpdates]);

  useEffect(() => {
    if (!liveUpdates) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [liveUpdates]);

  const visibleClasses = useMemo(
    () =>
      selectedClassId === 'ALL'
        ? classes
        : classes.filter((c) => c.id === selectedClassId),
    [classes, selectedClassId]
  );

  const toggleClassSort = (classId: string, orderKey: number) => {
    setSortByLegOrder((prev) => ({
      ...prev,
      [classId]: prev[classId] === orderKey ? null : orderKey,
    }));
  };

  return (
    <div className="space-y-3">
      {/* Filter & Analysis Mode Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => onSelectClassId('ALL')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedClassId === 'ALL'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Alla klasser
          </button>
          {classes.map((cls) => (
            <button
              key={cls.id}
              type="button"
              onClick={() => onSelectClassId(cls.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                selectedClassId === cls.id
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {cls.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            <button
              type="button"
              onClick={() => setShowLegMatrix(false)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                !showLegMatrix
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Kompakt resultatvy
            </button>
            <button
              type="button"
              onClick={() => setShowLegMatrix(true)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                showLegMatrix
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Sträckmatris (WinSplits)
            </button>
          </div>

          {showLegMatrix && (
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
              <button
                type="button"
                onClick={() => setCellMode('LEG_AND_BOM')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  cellMode === 'LEG_AND_BOM'
                    ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Sträcka & Bom
              </button>
              <button
                type="button"
                onClick={() => setCellMode('CUMULATIVE')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  cellMode === 'CUMULATIVE'
                    ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Total vid kontroll
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Per-Class Split Tables */}
      <div className="space-y-3">
        {visibleClasses.map((cls) => {
          const isRogaining = cls.classFormat === 'ROGAINING';
          const isForked = cls.classFormat === 'FORKED';
          const course = courses.find((c) => c.id === cls.courseId) ?? null;
          const inClass = competitors.filter((c) => c.classId === cls.id);
          const hasRadioControls = inClass.some((c) => c.radioSplits.length > 0);

          const officialTimed = inClass
            .filter(
              (c) =>
                (c.status === 'OK' || c.status === 'PRELIMINARY_FIN') &&
                c.runningTimeSec !== null
            )
            .sort((a, b) => {
              if (isRogaining) {
                const pa = a.validation?.rogainingPoints ?? 0;
                const pb = b.validation?.rogainingPoints ?? 0;
                if (pb !== pa) return pb - pa;
              }
              return (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999);
            });

          const leaderSec = officialTimed[0]?.runningTimeSec ?? null;
          const leaderPts = officialTimed[0]?.validation?.rogainingPoints ?? null;
          const idealSec =
            !isRogaining && !isForked
              ? officialTimed.find((r) => r.validation?.idealTimeSec)?.validation
                  ?.idealTimeSec ?? null
              : null;
          const winnerVsIdeal =
            leaderSec !== null && idealSec !== null ? leaderSec - idealSec : null;

          const activeSortOrder = sortByLegOrder[cls.id] ?? null;

          // Build leg columns only when Sträckmatris is toggled on
          const legColumns: { order: number; code: number; label: string; bestLegSec: number | null }[] =
            showLegMatrix && course && !isRogaining && !isForked
              ? [
                  ...course.controls.map((ctrl, idx) => {
                    const order = idx + 1;
                    const best =
                      officialTimed
                        .map((r) =>
                          r.validation?.splits.find((s) => s.order === order)?.bestLegSec
                        )
                        .find((v) => v !== null && v !== undefined) ?? null;
                    return {
                      order,
                      code: ctrl,
                      label: `K${ctrl}`,
                      bestLegSec: best,
                    };
                  }),
                  {
                    order: course.controls.length + 1,
                    code: 999,
                    label: 'Spurt',
                    bestLegSec:
                      officialTimed
                        .map((r) =>
                          r.validation?.splits.find((s) => s.controlCode === 999)?.bestLegSec
                        )
                        .find((v) => v !== null && v !== undefined) ?? null,
                  },
                ]
              : [];

          let displayRows = [
            ...officialTimed,
            ...inClass.filter((c) => !officialTimed.some((t) => t.id === c.id)),
          ];

          if (activeSortOrder !== null) {
            if (activeSortOrder === -1) {
              displayRows = [...displayRows].sort((a, b) => {
                const ba = a.validation?.totalTimeLossSec ?? 999999;
                const bb = b.validation?.totalTimeLossSec ?? 999999;
                return ba - bb;
              });
            } else if (showLegMatrix) {
              displayRows = [...displayRows].sort((a, b) => {
                const la =
                  a.validation?.splits.find((s) => s.order === activeSortOrder)?.legSec ??
                  999999;
                const lb =
                  b.validation?.splits.find((s) => s.order === activeSortOrder)?.legSec ??
                  999999;
                return la - lb;
              });
            }
          }

          return (
            <section
              key={cls.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
            >
              {/* Compact Class Header with Idealtid */}
              <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-950/40">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {cls.name}
                  </h3>
                  {isRogaining ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Poäng-OL · Max {Math.round((cls.rogainingMaxTimeSec ?? 2700) / 60)} min
                    </span>
                  ) : isForked ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Gafflad ({(cls.forkCourseIds ?? []).length} var.)
                    </span>
                  ) : (
                    course && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {course.name} · {(course.lengthMeters / 1000).toFixed(1)} km ·{' '}
                        {course.controls.length} k
                      </span>
                    )
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-mono tabular-nums">
                  {idealSec !== null && (
                    <span className="text-slate-700 dark:text-slate-300">
                      Idealtid <strong>{formatDurationMmSs(idealSec)}</strong>
                      {winnerVsIdeal !== null && winnerVsIdeal >= 0 && (
                        <span className="hidden sm:inline text-slate-500 dark:text-slate-400">
                          {' '}
                          (+{formatDurationMmSs(winnerVsIdeal)})
                        </span>
                      )}
                    </span>
                  )}
                  <span className="text-slate-500 dark:text-slate-400">
                    {inClass.length} anm.
                  </span>
                  {activeSortOrder !== null && (
                    <button
                      type="button"
                      onClick={() =>
                        setSortByLegOrder((prev) => ({ ...prev, [cls.id]: null }))
                      }
                      className="font-sans text-red-600 dark:text-red-400 hover:underline font-medium"
                    >
                      Återställ ordning
                    </button>
                  )}
                </div>
              </div>

              {displayRows.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  Inga deltagare i {cls.name}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-1.5 pl-3 pr-1.5 w-9">Plac</th>
                        <th className="py-1.5 px-2">Namn</th>
                        <th className="py-1.5 px-2">Klubb</th>
                        <th className="py-1.5 px-2 text-right whitespace-nowrap">Starttid</th>
                        {hasRadioControls && (
                          <th className="py-1.5 px-2 text-right whitespace-nowrap">Radiokontroller</th>
                        )}
                        {legColumns.map((col) => {
                          const isSorted = activeSortOrder === col.order;
                          return (
                            <th
                              key={col.order}
                              className="py-1.5 px-2 text-right font-mono whitespace-nowrap"
                            >
                              <button
                                type="button"
                                onClick={() => toggleClassSort(cls.id, col.order)}
                                className={`inline-flex flex-col items-end hover:text-slate-900 dark:hover:text-slate-100 transition-colors ${
                                  isSorted
                                    ? 'text-red-600 dark:text-red-400 font-semibold'
                                    : ''
                                }`}
                                title={`Sortera ${cls.name} efter sträcktid till ${col.label}`}
                              >
                                <span className="inline-flex items-center gap-1">
                                  <span>{col.label}</span>
                                  <ArrowDownUp className="w-2.5 h-2.5 opacity-60" />
                                </span>
                                {col.bestLegSec !== null && (
                                  <span className="text-[10px] font-normal text-emerald-700 dark:text-emerald-400">
                                    ★ {formatDurationMmSs(col.bestLegSec)}
                                  </span>
                                )}
                              </button>
                            </th>
                          );
                        })}
                        <th className="py-1.5 px-2 text-right">Tid</th>
                        <th className="hidden sm:table-cell py-1.5 px-2 text-right">Diff</th>
                        {isRogaining ? (
                          <>
                            <th className="hidden sm:table-cell py-1.5 px-2 text-right whitespace-nowrap">
                              Kontr.
                            </th>
                            <th className="hidden md:table-cell py-1.5 px-2 text-right whitespace-nowrap">Brutto</th>
                            <th className="py-1.5 px-2 text-right whitespace-nowrap">Poäng</th>
                          </>
                        ) : (
                          <th
                            className="py-1.5 px-2 text-right whitespace-nowrap"
                          >
                            <button
                              type="button"
                              onClick={() => toggleClassSort(cls.id, -1)}
                              className={`inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 ${
                                activeSortOrder === -1
                                  ? 'text-red-600 dark:text-red-400 font-semibold'
                                  : ''
                              }`}
                            >
                              <span>{isForked ? 'Gaffel' : 'Bom'}</span>
                              {!isForked && <ArrowDownUp className="w-2.5 h-2.5 opacity-60" />}
                            </button>
                          </th>
                        )}
                        <th className="py-1.5 pl-1.5 pr-3 text-right">Status</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                      {displayRows.map((r) => {
                        const timedIdx = officialTimed.findIndex((t) => t.id === r.id);
                        const isRunning =
                          liveUpdates &&
                          (r.status === 'IN_FOREST' || r.status === 'CHECKED') &&
                          r.finishTimeSec === null;
                        const displayedTimeSec = isRunning
                          ? getLiveRunningTimeSec(
                              r.startTimeSec ?? r.allocatedStartSec,
                              nowMs
                            )
                          : r.runningTimeSec;
                        const diff =
                          (timedIdx !== -1 || isRunning) &&
                          leaderSec !== null &&
                          displayedTimeSec !== null
                            ? displayedTimeSec - leaderSec
                            : null;
                        const ptsDiff =
                          isRogaining &&
                          timedIdx !== -1 &&
                          leaderPts !== null &&
                          r.validation?.rogainingPoints !== undefined &&
                          r.validation?.rogainingPoints !== null
                            ? r.validation.rogainingPoints - leaderPts
                            : null;

                        const isExpanded = expandedRunnerId === r.id;
                        const totalCols =
                          4 +
                          (hasRadioControls ? 1 : 0) +
                          legColumns.length +
                          (isRogaining ? 3 : 1) +
                          3;

                        return (
                          <React.Fragment key={r.id}>
                          <tr
                            onClick={() => {
                              setExpandedRunnerId((prev) => (prev === r.id ? null : r.id));
                              if (onInspectRunner) onInspectRunner(r);
                            }}
                            className={`cursor-pointer transition-colors ${
                              liveUpdates &&
                              nowMs - (updatedCompetitorsRef.current.get(r.id) ?? 0) < 20000
                                ? 'bg-orange-200/80 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-950/75'
                                : isExpanded
                                ? 'bg-slate-100/80 dark:bg-slate-800/70'
                                : 'hover:bg-slate-50/90 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <td className="py-1.5 pl-3 pr-1.5 font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              {timedIdx !== -1
                                ? r.status === 'PRELIMINARY_FIN'
                                  ? `(${timedIdx + 1})`
                                  : `${timedIdx + 1}.`
                                : '—'}
                            </td>

                            <td className="py-1.5 px-2 max-w-[165px] sm:max-w-none whitespace-nowrap">
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                  {r.fullName}
                                </span>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  #{r.bib}
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3 h-3 text-slate-400 shrink-0" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 opacity-60" />
                                )}
                              </div>
                            </td>

                            <td className="py-1.5 px-2 whitespace-nowrap">
                              {r.club.trim() ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSelectClub?.(r.club.trim());
                                  }}
                                  className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
                                >
                                  {r.club}
                                </button>
                              ) : (
                                <span className="text-slate-400">Klubblös</span>
                              )}
                            </td>

                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {formatSecondsAsClock(r.startTimeSec ?? r.allocatedStartSec)}
                            </td>

                            {hasRadioControls && (
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {r.radioSplits.length > 0
                                  ? r.radioSplits
                                      .map(
                                        (split) =>
                                          `K${split.controlCode} ${formatDurationMmSs(split.runningTimeSec)}`
                                      )
                                      .join(' · ')
                                  : '—'}
                              </td>
                            )}

                            {legColumns.map((col) => {
                              const sp = r.validation?.splits.find(
                                (s) => s.order === col.order
                              );
                              if (!sp) {
                                return (
                                  <td
                                    key={col.order}
                                    className="py-2.5 px-2 text-right font-mono text-slate-300 dark:text-slate-700"
                                  >
                                    —
                                  </td>
                                );
                              }

                              if (sp.status === 'MISSING') {
                                return (
                                  <td
                                    key={col.order}
                                    className="py-2.5 px-2 text-right font-semibold text-red-600 dark:text-red-400 whitespace-nowrap"
                                  >
                                    Saknas
                                  </td>
                                );
                              }

                              if (sp.status === 'BROKEN_CTRL') {
                                return (
                                  <td
                                    key={col.order}
                                    className="py-2.5 px-2 text-right text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap"
                                  >
                                    Ur funk.
                                  </td>
                                );
                              }

                              const hasBom = (sp.timeLossSec ?? 0) >= 12;
                              const isWin = sp.legRank === 1;

                              if (cellMode === 'CUMULATIVE') {
                                return (
                                  <td
                                    key={col.order}
                                    className="py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap"
                                  >
                                    <div className="text-slate-900 dark:text-slate-100">
                                      {formatDurationMmSs(sp.cumulativeSec)}
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                      {sp.cumulativeRank ? `#${sp.cumulativeRank}` : ''}
                                      {sp.cumulativeBehindSec && sp.cumulativeBehindSec > 0
                                        ? ` +${formatDurationMmSs(sp.cumulativeBehindSec)}`
                                        : ''}
                                    </div>
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={col.order}
                                  className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap ${
                                    hasBom
                                      ? 'bg-amber-50/70 dark:bg-amber-950/25'
                                      : isWin
                                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                                      : ''
                                  }`}
                                >
                                  <div
                                    className={
                                      isWin
                                        ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                        : 'text-slate-800 dark:text-slate-200'
                                    }
                                  >
                                    {isWin ? '★ ' : ''}
                                    {formatDurationMmSs(sp.legSec)}
                                    {sp.legRank ? ` (${sp.legRank})` : ''}
                                  </div>
                                  {hasBom ? (
                                    <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                      +{formatDurationMmSs(sp.timeLossSec ?? 0)} bom
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                      {formatDurationMmSs(sp.cumulativeSec)}
                                    </div>
                                  )}
                                </td>
                              );
                            })}

                            <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatDurationMmSs(displayedTimeSec)}
                            </td>

                            <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {isRogaining
                                ? ptsDiff !== null
                                ? ptsDiff === 0
                                  ? '0 p'
                                  : `${ptsDiff} p`
                                : '—'
                                : diff !== null
                                ? diff === 0
                                  ? '0:00'
                                  : `${diff > 0 ? '+' : '−'}${formatDurationMmSs(Math.abs(diff))}`
                                : '—'}
                            </td>

                            {isRogaining ? (
                              <>
                                <td className="hidden sm:table-cell py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                  {r.validation
                                    ? `${Math.max(0, r.validation.splits.length - 1)} st`
                                    : '—'}
                                </td>
                                <td className="hidden md:table-cell py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                                  {r.validation?.rogainingGrossPoints !== undefined &&
                                  r.validation?.rogainingGrossPoints !== null ? (
                                    <span>
                                      {r.validation.rogainingGrossPoints} p
                                      {(r.validation.rogainingOvertimePenalty ?? 0) > 0 && (
                                        <span className="text-red-600 dark:text-red-400 ml-1">
                                          (-{r.validation.rogainingOvertimePenalty} p)
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-700">—</span>
                                  )}
                                </td>
                                <td className="py-1.5 px-2 text-right font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                  {r.validation?.rogainingPoints !== undefined &&
                                  r.validation?.rogainingPoints !== null
                                    ? `${r.validation.rogainingPoints} p`
                                    : '—'}
                                </td>
                              </>
                            ) : isForked ? (
                              <td
                                className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400 whitespace-nowrap"
                              >
                                {r.validation?.matchedCourseName ?? '—'}
                              </td>
                            ) : (
                              <td
                                className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap"
                              >
                                {r.validation?.totalTimeLossSec !== undefined &&
                                r.validation?.totalTimeLossSec !== null ? (
                                  r.validation.totalTimeLossSec > 0 ? (
                                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                                      +{formatDurationMmSs(r.validation.totalTimeLossSec)}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-700 dark:text-emerald-400">
                                      0:00
                                    </span>
                                  )
                                ) : (
                                  <span className="text-slate-300 dark:text-slate-700">—</span>
                                )}
                              </td>
                            )}

                            <td className="py-1.5 pl-1.5 pr-3 text-right whitespace-nowrap">
                              <RunnerStatusIndicator status={r.status} compact />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/70 dark:bg-slate-950/60">
                              <td colSpan={totalCols} className="p-2.5 sm:p-3">
                                <RunnerSplitCardModal
                                  runner={r}
                                  compClass={cls}
                                  course={
                                    courses.find(
                                      (crs) => crs.id === (r.validation?.matchedCourseId ?? cls.courseId)
                                    ) ?? course
                                  }
                                  classCompetitors={inClass}
                                  onClose={() => setExpandedRunnerId(null)}
                                />
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
