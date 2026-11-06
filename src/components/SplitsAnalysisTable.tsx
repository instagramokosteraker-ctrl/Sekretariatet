import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import type { CompClass, Competitor, Course, SIStation } from '../types/sportident';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
} from '../services/sportidentProtocol';
import { RunnerStatusIndicator } from './StatusLabels';
import { RunnerSplitCardModal } from './RunnerSplitCardModal';

function getLiveRunningTimeSec(startTimeSec: number | null, nowMs: number): number | null {
  if (startTimeSec === null) return null;

  const now = new Date(nowMs);
  const currentClockSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const difference = currentClockSec - startTimeSec;
  const elapsedSec = difference < -12 * 3600 ? difference + 86400 : difference;
  return elapsedSec >= 0 ? elapsedSec : null;
}

function getLiveLegTimeSec(
  startTimeSec: number | null,
  lastPunchTimeSec: number | null,
  nowMs: number
): number | null {
  const now = new Date(nowMs);
  const currentClockSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const baseline = lastPunchTimeSec ?? startTimeSec;
  if (baseline === null) return null;
  const difference = currentClockSec - baseline;
  const elapsedSec = difference < -12 * 3600 ? difference + 86400 : difference;
  return elapsedSec >= 0 ? elapsedSec : null;
}

function getPlacementClass(rank: number | null | undefined): string {
  if (rank === 1) return 'text-red-600 dark:text-red-400 font-semibold';
  if (rank === 2) return 'text-blue-600 dark:text-blue-400 font-semibold';
  if (rank === 3) return 'text-green-600 dark:text-green-400 font-semibold';
  return 'text-slate-500 dark:text-slate-400';
}

function getPlacementTimeClass(rank: number | null | undefined): string {
  return rank === 1 || rank === 2 || rank === 3 ? getPlacementClass(rank) : '';
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
  radioControls?: Pick<
    SIStation,
    'stationCode' | 'name' | 'stationFunction' | 'active'
  >[];
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
  radioControls = [],
}: SplitsAnalysisTableProps) {
  const [detailedView, setDetailedView] = useState(false);
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

  const viewTabClass = (selected: boolean) =>
    `px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
      selected
        ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
    }`;

  return (
    <div className="space-y-3">
      {/* Filter & Analysis Mode Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
        <div
          className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg w-fit"
          role="tablist"
          aria-label="Resultatvy"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!detailedView}
            onClick={() => {
              setDetailedView(false);
              setSortByLegOrder({});
            }}
            className={viewTabClass(!detailedView)}
          >
            Förenklad vy
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailedView}
            onClick={() => setDetailedView(true)}
            className={viewTabClass(detailedView)}
          >
            Sträcka & bom
          </button>
        </div>
      </div>

      {/* Per-Class Split Tables */}
      <div className="space-y-3">
        {visibleClasses.map((cls) => {
          const isRogaining = cls.classFormat === 'ROGAINING';
          const isForked = cls.classFormat === 'FORKED';
          const course = courses.find((c) => c.id === cls.courseId) ?? null;
          const inClass = competitors.filter((c) => c.classId === cls.id);
          const configuredRadioControls = radioControls
            .filter(
              (station) =>
                station.active &&
                (station.stationFunction === 'RADIO' ||
                  station.stationFunction === 'PREWARNING') &&
                course?.controls.includes(station.stationCode)
            )
            .sort(
              (a, b) =>
                (course?.controls.indexOf(a.stationCode) ?? 0) -
                (course?.controls.indexOf(b.stationCode) ?? 0)
            );
          const radioControlCodes = new Set([
            ...configuredRadioControls.map((station) => station.stationCode),
            ...inClass.flatMap((competitor) =>
              competitor.radioSplits.map((split) => split.controlCode)
            ),
          ]);

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

          // Build leg columns for the detailed view.
          const legColumns: { order: number; code: number; label: string; bestLegSec: number | null }[] =
            detailedView && course && !isRogaining && !isForked
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
                      label: `(${ctrl})`,
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

          const controlResults = new Map<
            number,
            Map<
              string,
              {
                legSec: number | null;
                cumulativeSec: number | null;
                legRank: number | null;
                cumulativeRank: number | null;
              }
            >
          >();
          for (const col of legColumns) {
            if (col.code === 999) continue;
            const results = inClass.map((runner) => {
              const split = runner.validation?.splits.find(
                (item) => item.order === col.order
              );
              const radioSplit = runner.radioSplits.find(
                (item) => item.controlCode === col.code
              );
              const cumulativeSec =
                radioSplit?.runningTimeSec ?? split?.cumulativeSec ?? null;
              const previousCode = course?.controls[col.order - 2];
              const previousSplit = previousCode
                ? runner.validation?.splits.find(
                    (item) => item.controlCode === previousCode
                  )
                : undefined;
              const previousRadioSplit = previousCode
                ? runner.radioSplits.find(
                    (item) => item.controlCode === previousCode
                  )
                : undefined;
              const previousCumulativeSec =
                previousRadioSplit?.runningTimeSec ??
                previousSplit?.cumulativeSec ??
                0;
              const legSec =
                split?.legSec ??
                (radioSplit && cumulativeSec !== null
                  ? cumulativeSec - previousCumulativeSec
                  : null);
              return { runner, legSec, cumulativeSec };
            });
            controlResults.set(
              col.code,
              new Map(
                results.map(({ runner, legSec, cumulativeSec }) => [
                  runner.id,
                  {
                    legSec,
                    cumulativeSec,
                    legRank:
                      legSec === null
                        ? null
                        : 1 +
                          results.filter(
                            (result) =>
                              result.legSec !== null && result.legSec < legSec
                          ).length,
                    cumulativeRank:
                      cumulativeSec === null
                        ? null
                        : 1 +
                          results.filter(
                            (result) =>
                              result.cumulativeSec !== null &&
                              result.cumulativeSec < cumulativeSec
                          ).length,
                  },
                ])
              )
            );
          }

          if (activeSortOrder !== null) {
            if (activeSortOrder === -1) {
              displayRows = [...displayRows].sort((a, b) => {
                const ba = a.validation?.totalTimeLossSec ?? 999999;
                const bb = b.validation?.totalTimeLossSec ?? 999999;
                return ba - bb;
              });
            } else {
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
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
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
                        {(course.lengthMeters / 1000).toFixed(1)} km · {course.controls.length} k
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
                  <table
                    className={`w-full text-left border-collapse text-xs ${
                      detailedView ? 'table-auto' : 'table-fixed'
                    }`}
                  >
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-1.5 pl-3 pr-1.5 w-12">Plac</th>
                        <th className="py-1.5 px-2 w-[36%]">
                          {detailedView ? 'Namn / Klubb' : 'Namn'}
                        </th>
                        {!detailedView && (
                          <th className="hidden sm:table-cell py-1.5 px-2 w-[26%]">
                            Klubb
                          </th>
                        )}
                        {detailedView && (
                          <th className="py-1.5 px-2 text-right whitespace-nowrap">Starttid</th>
                        )}
                        {detailedView && legColumns.map((col) => {
                          const isSorted = activeSortOrder === col.order;
                          const isRadioControl = radioControlCodes.has(col.code);
                          return (
                            <th
                              key={col.order}
                              className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${
                                isRadioControl ? 'text-orange-600 dark:text-orange-400' : ''
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleClassSort(cls.id, col.order)}
                                className={`inline-flex flex-col items-end hover:text-slate-900 dark:hover:text-slate-100 transition-colors ${
                                  isSorted
                                    ? isRadioControl
                                      ? 'text-orange-600 dark:text-orange-400 font-semibold'
                                      : 'text-red-600 dark:text-red-400 font-semibold'
                                    : ''
                                }`}
                                title={
                                  isRadioControl
                                    ? `Radiokontroll ${col.label} · sortera ${cls.name} efter sträcktid`
                                    : `Sortera ${cls.name} efter sträcktid till ${col.label}`
                                }
                              >
                                <span
                                  className={`inline-flex items-center ${
                                    isRadioControl ? 'gap-0' : 'gap-1'
                                  }`}
                                >
                                  <span>{col.label}</span>
                                  {isRadioControl && (
                                    <Zap
                                      className="w-2.5 h-2.5 fill-current"
                                      aria-label="Radiokontroll"
                                    />
                                  )}
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
                        {detailedView && isRogaining ? (
                          <>
                            <th className="hidden sm:table-cell py-1.5 px-2 text-right whitespace-nowrap">
                              Kontr.
                            </th>
                            <th className="hidden md:table-cell py-1.5 px-2 text-right whitespace-nowrap">Brutto</th>
                            <th className="py-1.5 px-2 text-right whitespace-nowrap">Poäng</th>
                          </>
                        ) : detailedView ? (
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
                        ) : (
                          <th className="py-1.5 px-2 text-right whitespace-nowrap">
                            {isRogaining ? 'Poäng' : isForked ? 'Gaffel' : 'Bom'}
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
                        const passedRadioSplits = [...r.radioSplits].sort(
                          (a, b) => a.punchTimeSec - b.punchTimeSec
                        );
                        const lastPassedConfiguredRadioIndex = passedRadioSplits.reduce(
                          (lastIndex, split) => {
                            const index = configuredRadioControls.findIndex(
                              (station) => station.stationCode === split.controlCode
                            );
                            return Math.max(lastIndex, index);
                          },
                          -1
                        );
                        const nextRadioControl = configuredRadioControls.find(
                          (_, index) => index > lastPassedConfiguredRadioIndex
                        );
                        const liveLegTimeSec =
                          isRunning && radioControlCodes.size > 0
                            ? getLiveLegTimeSec(
                                r.startTimeSec ?? r.allocatedStartSec,
                                passedRadioSplits.length > 0
                                  ? passedRadioSplits[passedRadioSplits.length - 1].punchTimeSec
                                  : null,
                                nowMs
                              )
                            : null;
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
                        const totalCols = detailedView
                          ? 3 + legColumns.length + (isRogaining ? 3 : 1) + 3
                          : 7;

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

                            <td
                              className={`py-1.5 px-2 whitespace-nowrap ${
                                detailedView ? 'min-w-[140px] max-w-[220px]' : 'max-w-[165px] sm:max-w-none'
                              }`}
                            >
                              {detailedView ? (
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                      {r.fullName}
                                    </span>
                                    {isExpanded ? (
                                      <ChevronUp className="w-3 h-3 text-slate-400 shrink-0" />
                                    ) : (
                                      <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 opacity-60" />
                                    )}
                                  </div>
                                  {r.club.trim() ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onSelectClub?.(r.club.trim());
                                      }}
                                      className="block max-w-full truncate text-[11px] text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
                                      title={r.club}
                                    >
                                      {r.club}
                                    </button>
                                  ) : (
                                    <span className="block truncate text-[11px] text-slate-400">
                                      Klubblös
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                    {r.fullName}
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3 h-3 text-slate-400 shrink-0" />
                                  ) : (
                                    <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 opacity-60" />
                                  )}
                                </div>
                              )}
                            </td>

                            {!detailedView && (
                              <td className="hidden sm:table-cell py-1.5 px-2 overflow-hidden whitespace-nowrap">
                                {r.club.trim() ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onSelectClub?.(r.club.trim());
                                    }}
                                    className="inline-block max-w-full truncate align-bottom text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
                                    title={r.club}
                                  >
                                    {r.club}
                                  </button>
                                ) : (
                                  <span className="block truncate text-slate-400">Klubblös</span>
                                )}
                              </td>
                            )}

                            {detailedView && (
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums leading-4 text-slate-600 dark:text-slate-400 whitespace-nowrap align-top">
                                <div className="leading-4">
                                  {formatSecondsAsClock(r.startTimeSec ?? r.allocatedStartSec)}
                                </div>
                              </td>
                            )}

                            {detailedView && legColumns.map((col) => {
                              const isRadioControl = radioControlCodes.has(col.code);
                              const radioSplit = isRadioControl
                                ? passedRadioSplits.find(
                                    (split) => split.controlCode === col.code
                                  )
                                : undefined;
                              const isNextRadioControl =
                                nextRadioControl?.stationCode === col.code;
                              const isFinishLeg = col.code === 999;
                              const sp = r.validation?.splits.find(
                                (s) => s.order === col.order
                              );
                              const controlResult = controlResults
                                .get(col.code)
                                ?.get(r.id);
                              if (radioSplit) {
                                return (
                                  <td
                                    key={col.order}
                                    className="py-1.5 px-2 text-right font-mono tabular-nums leading-4 whitespace-nowrap align-top"
                                  >
                                    <div className="leading-4">
                                      <span
                                        className={getPlacementTimeClass(controlResult?.legRank)}
                                      >
                                        {formatDurationMmSs(controlResult?.legSec ?? null)}
                                      </span>{' '}
                                      {controlResult?.legRank && (
                                        <span className={getPlacementClass(controlResult.legRank)}>
                                          ({controlResult.legRank})
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                      <span
                                        className={getPlacementTimeClass(
                                          controlResult?.cumulativeRank
                                        )}
                                      >
                                        {formatDurationMmSs(
                                          controlResult?.cumulativeSec ?? null
                                        )}
                                      </span>{' '}
                                      {controlResult?.cumulativeRank && (
                                        <span
                                          className={getPlacementClass(
                                            controlResult.cumulativeRank
                                          )}
                                        >
                                          ({controlResult.cumulativeRank})
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                );
                              }
                              if (
                                isRunning &&
                                liveLegTimeSec !== null &&
                                (isNextRadioControl ||
                                  (isFinishLeg && !nextRadioControl))
                              ) {
                                return (
                                  <td
                                    key={col.order}
                                    className="py-1.5 px-2 text-right font-mono tabular-nums leading-4 text-slate-800 dark:text-slate-200 whitespace-nowrap align-top"
                                  >
                                    <div className="leading-4">
                                      {formatDurationMmSs(liveLegTimeSec)}
                                    </div>
                                  </td>
                                );
                              }
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

                              return (
                                <td
                                  key={col.order}
                                  className={`py-1.5 px-2 text-right font-mono tabular-nums leading-4 whitespace-nowrap align-top ${
                                    hasBom
                                      ? 'bg-amber-50/70 dark:bg-amber-950/25'
                                      : isWin
                                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                                      : ''
                                  }`}
                                >
                                  <div
                                    className={
                                      `leading-4 ${
                                        isWin && !controlResult
                                          ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                          : 'text-slate-800 dark:text-slate-200'
                                      }`
                                    }
                                  >
                                    <span
                                      className={getPlacementTimeClass(
                                        controlResult?.legRank ?? sp.legRank
                                      )}
                                    >
                                      {formatDurationMmSs(
                                        controlResult?.legSec ?? sp.legSec
                                      )}
                                    </span>{' '}
                                    {(controlResult?.legRank ?? sp.legRank) && (
                                      <span
                                        className={getPlacementClass(
                                          controlResult?.legRank ?? sp.legRank
                                        )}
                                      >
                                        ({controlResult?.legRank ?? sp.legRank})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                    <span
                                      className={getPlacementTimeClass(
                                        controlResult?.cumulativeRank ?? sp.cumulativeRank
                                      )}
                                    >
                                      {formatDurationMmSs(
                                        controlResult?.cumulativeSec ?? sp.cumulativeSec
                                      )}
                                    </span>{' '}
                                    {(controlResult?.cumulativeRank ?? sp.cumulativeRank) && (
                                      <span
                                        className={getPlacementClass(
                                          controlResult?.cumulativeRank ??
                                            sp.cumulativeRank
                                        )}
                                      >
                                        ({controlResult?.cumulativeRank ?? sp.cumulativeRank})
                                      </span>
                                    )}
                                    {hasBom && (
                                      <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">
                                        +{formatDurationMmSs(sp.timeLossSec ?? 0)} bom
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}

                            <td className="py-1.5 px-2 text-right font-mono tabular-nums leading-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap align-top">
                              <div className="leading-4">
                                {formatDurationMmSs(displayedTimeSec)}
                              </div>
                              {!detailedView && liveLegTimeSec !== null && (
                                <div className="mt-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                  {nextRadioControl
                                    ? `(${nextRadioControl.stationCode})`
                                    : 'Mål'}{' '}
                                  {formatDurationMmSs(liveLegTimeSec)}
                                </div>
                              )}
                            </td>

                            <td className="hidden sm:table-cell py-1.5 px-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
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

                            {detailedView && isRogaining ? (
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
                            ) : detailedView && isForked ? (
                              <td
                                className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400 whitespace-nowrap"
                              >
                                {r.validation?.matchedCourseName ?? '—'}
                              </td>
                            ) : !detailedView && isRogaining ? (
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                {r.validation?.rogainingPoints ?? '—'}
                              </td>
                            ) : !detailedView && isForked ? (
                              <td className="py-1.5 px-2 text-right text-slate-600 dark:text-slate-400 whitespace-nowrap">
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
