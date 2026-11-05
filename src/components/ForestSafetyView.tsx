import React, { useMemo, useState } from 'react';
import { CheckCircle2, Download, Search } from 'lucide-react';
import type { CompClass, Competitor, RunnerStatus } from '../types/sportident';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
  formatSiNumber,
} from '../services/sportidentProtocol';
import { RunnerStatusIndicator } from './StatusLabels';
import { exportForestSafetyCsv } from '../utils/iofXml';

interface ForestSafetyViewProps {
  competitors: Competitor[];
  classes: CompClass[];
  zeroTimeSec: number;
  onUpdateRunnerStatus: (competitorId: string, status: RunnerStatus) => Promise<void>;
}

type ForestFilter = 'ALL_OUT' | 'IN_FOREST' | 'CHECKED' | 'PRELIMINARY_FIN' | 'UNCHECKED';

export function ForestSafetyView({
  competitors,
  classes,
  zeroTimeSec,
  onUpdateRunnerStatus,
}: ForestSafetyViewProps) {
  const [filter, setFilter] = useState<ForestFilter>('ALL_OUT');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const counts = useMemo(() => {
    const inForest = competitors.filter((c) => c.status === 'IN_FOREST').length;
    const checked = competitors.filter((c) => c.status === 'CHECKED').length;
    const prel = competitors.filter((c) => c.status === 'PRELIMINARY_FIN').length;
    const unchecked = competitors.filter((c) => c.status === 'REGISTERED').length;
    return {
      allOut: inForest + checked + prel,
      inForest,
      checked,
      prel,
      unchecked,
    };
  }, [competitors]);

  const filteredRunners = useMemo(() => {
    const q = search.trim().toLowerCase();
    return competitors
      .filter((c) => {
        if (filter === 'ALL_OUT') {
          if (
            c.status !== 'IN_FOREST' &&
            c.status !== 'CHECKED' &&
            c.status !== 'PRELIMINARY_FIN'
          ) {
            return false;
          }
        } else if (filter === 'IN_FOREST' && c.status !== 'IN_FOREST') {
          return false;
        } else if (filter === 'CHECKED' && c.status !== 'CHECKED') {
          return false;
        } else if (filter === 'PRELIMINARY_FIN' && c.status !== 'PRELIMINARY_FIN') {
          return false;
        } else if (filter === 'UNCHECKED' && c.status !== 'REGISTERED') {
          return false;
        }

        if (classFilter !== 'ALL' && c.classId !== classFilter) return false;
        if (!q) return true;
        return (
          c.fullName.toLowerCase().includes(q) ||
          c.club.toLowerCase().includes(q) ||
          String(c.siNumber).includes(q) ||
          String(c.bib).includes(q)
        );
      })
      .sort((a, b) => {
        const aStart = a.startTimeSec ?? a.checkTimeSec ?? a.allocatedStartSec ?? zeroTimeSec;
        const bStart = b.startTimeSec ?? b.checkTimeSec ?? b.allocatedStartSec ?? zeroTimeSec;
        return aStart - bStart; // Earliest starters (longest out in forest) at top!
      });
  }, [competitors, filter, classFilter, search, zeroTimeSec]);

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Kvar i skogen — Säkerhetskontroll
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Övervakar löpare som checkat in eller startat men ännu inte läst ut vid målet.
          </p>
        </div>

        <button
          type="button"
          onClick={() => exportForestSafetyCsv(competitors, classes)}
          disabled={counts.allOut === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Exportera CSV</span>
        </button>
      </div>

      {/* Filter & Segment Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-lg w-fit">
          {(
            [
              { id: 'ALL_OUT', label: `Kvar ute (${counts.allOut})` },
              { id: 'IN_FOREST', label: `I skogen (${counts.inForest})` },
              { id: 'CHECKED', label: `Checkade (${counts.checked})` },
              { id: 'PRELIMINARY_FIN', label: `Ej utlästa (${counts.prel})` },
              { id: 'UNCHECKED', label: `Ej checkade (${counts.unchecked})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök namn, startnummer, klubb eller SI..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-600/25"
            />
          </div>

          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
          >
            <option value="ALL">Alla klasser</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Safety Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filteredRunners.length === 0 ? (
          <div className="p-8 text-center space-y-1.5">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Inga löpare kvar i detta urval!
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Alla startande löpare i valt filter har redovisats eller läst ut sina SI-brickor.
            </p>
          </div>
        ) : (
          <div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-1.5 pl-3.5 pr-2">Löpare · Klubb · Klass</th>
                  <th className="hidden md:table-cell py-1.5 px-2">SI-bricka</th>
                  <th className="hidden lg:table-cell py-1.5 px-2">Start / Check</th>
                  <th className="hidden sm:table-cell py-1.5 px-2">Senast sedd</th>
                  <th className="py-1.5 px-2">Status</th>
                  <th className="py-1.5 pl-2 pr-3.5 text-right">Åtgärd</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {filteredRunners.map((r) => {
                  const clsName = classes.find((c) => c.id === r.classId)?.name ?? '-';
                  const lastRadio = r.radioSplits[r.radioSplits.length - 1];
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-1.5 pl-3.5 pr-2 max-w-[175px] sm:max-w-none">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 truncate">
                          <span className="font-mono tabular-nums text-slate-500">#{r.bib}</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {r.fullName}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            · {clsName} · {r.club}
                          </span>
                        </div>
                      </td>
                      <td className="hidden md:table-cell py-1.5 px-2 font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatSiNumber(r.siNumber)}
                        {r.isRentalCard && (
                          <span className="text-amber-700 dark:text-amber-400 font-sans font-medium">
                            {' '}
                            · Hyr
                          </span>
                        )}
                      </td>
                      <td className="hidden lg:table-cell py-1.5 px-2 font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {r.startTimeSec !== null
                          ? `Start ${formatSecondsAsClock(r.startTimeSec)}`
                          : r.checkTimeSec !== null
                          ? `Check ${formatSecondsAsClock(r.checkTimeSec)}`
                          : `Lottad ${formatSecondsAsClock(r.allocatedStartSec)}`}
                      </td>
                      <td className="hidden sm:table-cell py-1.5 px-2 font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {r.status === 'PRELIMINARY_FIN'
                          ? `Mål (${formatDurationMmSs(r.runningTimeSec)})`
                          : lastRadio
                          ? `(${lastRadio.controlCode}) ${formatDurationMmSs(
                              lastRadio.runningTimeSec
                            )})`
                          : r.lastSeenControl
                          ? `CN ${r.lastSeenControl} (${formatSecondsAsClock(r.lastSeenTimeSec)})`
                          : '—'}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        <RunnerStatusIndicator status={r.status} compact />
                      </td>
                      <td className="py-1.5 pl-2 pr-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void onUpdateRunnerStatus(r.id, 'DNF')}
                            title="Markera som Utgått (DNF)"
                            className="px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                          >
                            DNF
                          </button>
                          <button
                            type="button"
                            onClick={() => void onUpdateRunnerStatus(r.id, 'DNS')}
                            title="Markera som Ej start (DNS)"
                            className="px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                          >
                            DNS
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
