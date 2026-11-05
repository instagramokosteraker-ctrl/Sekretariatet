import React, { useMemo } from 'react';
import { Award, Clock, Compass, Sparkles, Star, X } from 'lucide-react';
import type { CompClass, Competitor, Course } from '../types/sportident';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
  formatSiNumber,
} from '../services/sportidentProtocol';
import { RunnerStatusIndicator } from './StatusLabels';

interface RunnerSplitCardModalProps {
  runner: Competitor | null;
  compClass: CompClass | null;
  course: Course | null;
  classCompetitors: Competitor[];
  onClose: () => void;
}

export function RunnerSplitCardModal({
  runner,
  compClass,
  course,
  classCompetitors,
  onClose,
}: RunnerSplitCardModalProps) {
  const isRogaining = compClass?.classFormat === 'ROGAINING';

  const placementInfo = useMemo(() => {
    if (!runner || runner.status !== 'OK' || runner.runningTimeSec === null) return null;
    const okSorted = classCompetitors
      .filter((c) => c.status === 'OK' && c.runningTimeSec !== null)
      .sort((a, b) => {
        if (isRogaining) {
          const pa = a.validation?.rogainingPoints ?? 0;
          const pb = b.validation?.rogainingPoints ?? 0;
          if (pb !== pa) return pb - pa;
        }
        return (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999);
      });
    const idx = okSorted.findIndex((c) => c.id === runner.id);
    if (idx === -1) return null;
    const winnerSec = okSorted[0]?.runningTimeSec ?? runner.runningTimeSec;
    const winnerPts = okSorted[0]?.validation?.rogainingPoints ?? 0;
    return {
      pos: idx + 1,
      total: okSorted.length,
      behindWinnerSec: runner.runningTimeSec - winnerSec,
      behindWinnerPts: (runner.validation?.rogainingPoints ?? 0) - winnerPts,
    };
  }, [runner, classCompetitors, isRogaining]);

  // Deterministic schematic orienteering map coordinates (IOF Start triangle -> Controls -> Double Finish circle)
  const schematicNodes = useMemo(() => {
    if (!runner) return [];
    const splits = runner.validation?.splits ?? [];
    const ctrlCodes =
      splits.length > 0
        ? splits.map((s) => s.controlCode)
        : [...(course?.controls ?? []), 999];

    if (ctrlCodes.length === 0) return [];

    const totalPoints = ctrlCodes.length + 1; // Start + controls + finish
    const width = 680;
    const padX = 48;
    const usableW = width - padX * 2;

    const pts: {
      kind: 'START' | 'CONTROL' | 'FINISH';
      label: string;
      code: number;
      x: number;
      y: number;
      legRank?: number | null;
      timeLossSec?: number | null;
      status?: 'OK' | 'MISSING' | 'BROKEN_CTRL';
      legSec?: number | null;
    }[] = [
      {
        kind: 'START',
        label: 'Start',
        code: 0,
        x: padX,
        y: 96,
      },
    ];

    ctrlCodes.forEach((code, idx) => {
      const sp = splits[idx];
      const t = (idx + 1) / (totalPoints - 1);
      const x = Math.round(padX + t * usableW);
      // Natural terrain-loop wave using deterministic control code hash
      const wave = Math.sin((idx + 1) * 1.65 + (code % 7) * 0.45) * 44;
      const y = code === 999 ? 96 : Math.round(96 + wave);

      pts.push({
        kind: code === 999 ? 'FINISH' : 'CONTROL',
        label: code === 999 ? 'Mål' : `${idx + 1} (${code})`,
        code,
        x,
        y,
        legRank: sp?.legRank,
        timeLossSec: sp?.timeLossSec,
        status: sp?.status ?? 'OK',
        legSec: sp?.legSec,
      });
    });

    return pts;
  }, [runner, course]);

  if (!runner) return null;

  const val = runner.validation;
  const legWinsCount =
    val?.splits.filter((s) => s.legRank === 1 && s.status === 'OK').length ?? 0;

  return (
    <div
      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
      aria-labelledby="runner-card-title"
    >
      {/* Compact Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2
            id="runner-card-title"
            className="text-base font-display font-bold text-slate-900 dark:text-slate-100 truncate"
          >
            {runner.fullName}
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {compClass?.name ?? 'Klass'} · {runner.club} ·{' '}
            <span className="font-mono tabular-nums">
              #{runner.bib} · SI {formatSiNumber(runner.siNumber)}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <RunnerStatusIndicator status={runner.status} compact />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Stäng löparkort"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4-Column Compact Analytical Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-200 dark:border-slate-800 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/60 dark:bg-slate-950/40 text-xs">
        <div className="px-3 py-2">
          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="truncate">Sluttid & Plac</span>
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100">
            {formatDurationMmSs(runner.runningTimeSec)}
            {placementInfo && (
              <span className="ml-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                ({placementInfo.pos}/{placementInfo.total})
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
            {placementInfo
              ? placementInfo.behindWinnerSec === 0
                ? 'Klassledare'
                : `+${formatDurationMmSs(placementInfo.behindWinnerSec)} efter`
              : `Start ${formatSecondsAsClock(runner.startTimeSec ?? runner.allocatedStartSec)}`}
          </div>
        </div>

        <div className="px-3 py-2">
          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <Compass className="w-3 h-3 shrink-0" />
            <span className="truncate">{isRogaining ? 'Nettopoäng' : 'Est. bomtid'}</span>
          </div>
          {isRogaining ? (
            <>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {val?.rogainingPoints ?? 0} p
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                Brutto {val?.rogainingGrossPoints ?? 0} p
                {(val?.rogainingOvertimePenalty ?? 0) > 0
                  ? ` (-${val?.rogainingOvertimePenalty} p)`
                  : ''}
              </div>
            </>
          ) : (
            <>
              <div
                className={`mt-0.5 font-mono tabular-nums text-sm font-semibold ${
                  (val?.totalTimeLossSec ?? 0) > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {val?.totalTimeLossSec !== undefined && val?.totalTimeLossSec !== null
                  ? val.totalTimeLossSec > 0
                    ? `+${formatDurationMmSs(val.totalTimeLossSec)}`
                    : '0:00'
                  : '—'}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                Tidsförlust sträckor
              </div>
            </>
          )}
        </div>

        <div className="px-3 py-2">
          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <Sparkles className="w-3 h-3 shrink-0" />
            <span className="truncate">{isRogaining ? 'Maxtid' : 'Bomfri tid'}</span>
          </div>
          {isRogaining ? (
            <>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatDurationMmSs(compClass?.rogainingMaxTimeSec ?? 2700)}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                {(val?.rogainingOvertimeSec ?? 0) > 0
                  ? `+${formatDurationMmSs(val?.rogainingOvertimeSec ?? 0)} över`
                  : 'Inom maxtid'}
              </div>
            </>
          ) : (
            <>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatDurationMmSs(val?.mistakeFreeTimeSec ?? null)}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                Idealtid {formatDurationMmSs(val?.idealTimeSec ?? null)}
              </div>
            </>
          )}
        </div>

        <div className="px-3 py-2">
          <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <Award className="w-3 h-3 shrink-0" />
            <span className="truncate">{isRogaining ? 'Kontroller' : 'Sträcksegrar (★)'}</span>
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {isRogaining
              ? `${Math.max(0, (val?.splits.length ?? 1) - 1)} st`
              : `${legWinsCount} st`}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
            {val?.matchedCourseName ?? course?.name ?? 'Ingen bana'}
          </div>
        </div>
      </div>

      {/* Responsive Schematic IOF Course Diagram (Zero Horizontal Scroll) */}
      {schematicNodes.length > 1 && (
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Schematisk banprofil (IOF)
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              Lila = normalt · Grön ★ = seger · Bärnsten = bom (&ge;12s)
            </span>
          </div>

          <div className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1">
            <svg
              viewBox="0 0 680 192"
              className="w-full h-24 sm:h-32 select-none"
              role="img"
              aria-label="Schematisk banprofil med orienteringskontroller"
            >
              <path
                d="M 10 42 Q 190 18, 360 52 T 670 36"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.75"
                className="text-amber-700/15 dark:text-amber-500/15"
              />
              <path
                d="M 10 148 Q 220 172, 410 136 T 670 154"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.75"
                className="text-amber-700/15 dark:text-amber-500/15"
              />

              {schematicNodes.slice(1).map((target, idx) => {
                const prev = schematicNodes[idx];
                const isMissing = target.status === 'MISSING';
                const isBroken = target.status === 'BROKEN_CTRL';
                const hasBom = (target.timeLossSec ?? 0) >= 12;
                const isWin = target.legRank === 1 && !hasBom;

                const strokeColor = isMissing
                  ? '#dc2626'
                  : isBroken
                  ? '#64748b'
                  : hasBom
                  ? '#d97706'
                  : isWin
                  ? '#059669'
                  : '#a21caf';

                const midX = (prev.x + target.x) / 2;
                const midY = (prev.y + target.y) / 2 - 8;

                return (
                  <g key={`leg-${target.code}-${idx}`}>
                    <line
                      x1={prev.x}
                      y1={prev.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={strokeColor}
                      strokeWidth={hasBom ? 3 : 2.2}
                      strokeDasharray={isMissing || isBroken ? '5 4' : undefined}
                    />
                    {target.legSec !== null && target.legSec !== undefined && (
                      <text
                        x={midX}
                        y={midY}
                        textAnchor="middle"
                        className="fill-slate-600 dark:fill-slate-300 text-[9px] font-mono"
                      >
                        {formatDurationMmSs(target.legSec)}
                        {hasBom ? ` (+${formatDurationMmSs(target.timeLossSec ?? 0)})` : ''}
                      </text>
                    )}
                  </g>
                );
              })}

              {schematicNodes.map((pt, idx) => {
                if (pt.kind === 'START') {
                  return (
                    <g key="iof-start">
                      <polygon
                        points={`${pt.x},${pt.y - 11} ${pt.x - 10},${pt.y + 8} ${pt.x + 10},${pt.y + 8}`}
                        fill="none"
                        stroke="#a21caf"
                        strokeWidth="2.2"
                      />
                      <text
                        x={pt.x}
                        y={pt.y + 23}
                        textAnchor="middle"
                        className="fill-slate-700 dark:fill-slate-300 text-[10px] font-semibold"
                      >
                        Start
                      </text>
                    </g>
                  );
                }

                if (pt.kind === 'FINISH') {
                  return (
                    <g key="iof-finish">
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="11"
                        fill="none"
                        stroke="#a21caf"
                        strokeWidth="2"
                      />
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="6.5"
                        fill="none"
                        stroke="#a21caf"
                        strokeWidth="2"
                      />
                      <text
                        x={pt.x}
                        y={pt.y + 24}
                        textAnchor="middle"
                        className="fill-slate-700 dark:fill-slate-300 text-[10px] font-semibold"
                      >
                        Mål
                      </text>
                    </g>
                  );
                }

                const isMissing = pt.status === 'MISSING';
                const hasBom = (pt.timeLossSec ?? 0) >= 12;
                const isWin = pt.legRank === 1;
                const ringStroke = isMissing
                  ? '#dc2626'
                  : hasBom
                  ? '#d97706'
                  : isWin
                  ? '#059669'
                  : '#a21caf';

                return (
                  <g key={`ctrl-${pt.code}-${idx}`}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="9.5"
                      className="fill-white dark:fill-slate-900"
                      stroke={ringStroke}
                      strokeWidth="2.3"
                    />
                    <circle cx={pt.x} cy={pt.y} r="2" fill={ringStroke} />
                    <text
                      x={pt.x}
                      y={pt.y + 23}
                      textAnchor="middle"
                      className="fill-slate-800 dark:fill-slate-200 text-[10px] font-mono font-medium"
                    >
                      {pt.label}
                      {isWin ? ' ★' : ''}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Detailed Leg-by-Leg Split Table (Responsive Zero-Scroll) */}
      <div>
        {val && val.splits.length > 0 ? (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-1.5 pl-3.5 pr-1.5 w-8">#</th>
                <th className="py-1.5 px-2">Kontroll</th>
                <th className="py-1.5 px-2 text-right">Sträcka</th>
                <th className="hidden sm:table-cell py-1.5 px-2 text-right">Sträckplac</th>
                <th className="hidden sm:table-cell py-1.5 px-2 text-right">
                  {isRogaining ? 'Poäng' : 'Bomtid'}
                </th>
                <th className="py-1.5 px-2 sm:pr-2 pr-3.5 text-right">Total (Plac)</th>
                <th className="hidden md:table-cell py-1.5 pl-2 pr-3.5 text-right">Klockslag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80 font-mono tabular-nums">
              {val.splits.map((s) => {
                const hasBom = (s.timeLossSec ?? 0) >= 12;
                return (
                  <tr
                    key={`${s.order}-${s.controlCode}`}
                    className={
                      s.status === 'MISSING'
                        ? 'bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                        : hasBom
                        ? 'bg-amber-50/50 dark:bg-amber-950/20'
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
                          Saknas
                        </span>
                      )}
                      {s.status === 'BROKEN_CTRL' && (
                        <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                          Ur funk.
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-2 text-right font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
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
                    <td className="hidden sm:table-cell py-1 px-2 text-right whitespace-nowrap">
                      {s.legRank ? (
                        <span
                          className={
                            s.legRank === 1
                              ? 'font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center justify-end gap-1'
                              : 'text-slate-600 dark:text-slate-400'
                          }
                        >
                          {s.legRank === 1 && <Star className="w-3 h-3 fill-current" />}
                          <span>
                            #{s.legRank}
                            {s.legBehindSec && s.legBehindSec > 0
                              ? ` (+${formatDurationMmSs(s.legBehindSec)})`
                              : ''}
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="hidden sm:table-cell py-1 px-2 text-right whitespace-nowrap">
                      {isRogaining && s.pointsAwarded ? (
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          +{s.pointsAwarded} p
                        </span>
                      ) : hasBom ? (
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          +{formatDurationMmSs(s.timeLossSec ?? 0)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-1 px-2 sm:pr-2 pr-3.5 text-right text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {formatDurationMmSs(s.cumulativeSec)}
                      {s.cumulativeRank ? (
                        <span className="text-slate-400 ml-1">({s.cumulativeRank})</span>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="hidden md:table-cell py-1 pl-2 pr-3.5 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatSecondsAsClock(s.punchTimeSec)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
            SI-brickan är ännu inte utläst vid målet.
            {runner.radioSplits.length > 0 && (
              <div className="mt-1.5 font-mono text-slate-800 dark:text-slate-200">
                Radio:{' '}
                {runner.radioSplits
                  .map((r) => `(${r.controlCode}): ${formatDurationMmSs(r.runningTimeSec)}`)
                  .join(' · ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
