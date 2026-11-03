import React, { useMemo, useState } from 'react';
import {
  Download,
  FileCode,
  Shuffle,
  Users,
} from 'lucide-react';
import type {
  CompClass,
  CompetitionMeta,
  Competitor,
  Course,
} from '../types/sportident';
import {
  formatSecondsAsClock,
  formatSiNumber,
} from '../services/sportidentProtocol';
import { buildIofStartListXml, triggerTextFileDownload } from '../utils/iofXml';
import { RunnerStatusIndicator } from './StatusLabels';

interface DrawViewProps {
  competition: CompetitionMeta;
  courses: Course[];
  classes: CompClass[];
  competitors: Competitor[];
  onDrawClass: (params: {
    classId: string;
    mode: 'INTERVAL' | 'MASS' | 'FREE';
    firstStartClock: string;
    intervalSec: number;
    vacancies: number;
    clubSeparation: boolean;
    includeAlreadyStarted: boolean;
  }) => Promise<{
    className: string;
    drawnCount: number;
    mode: string;
    vacantStartTimes: string[];
  }>;
}

export function DrawView({
  competition,
  courses,
  classes,
  competitors,
  onDrawClass,
}: DrawViewProps) {
  // Start Draw state
  const [drawClassId, setDrawClassId] = useState<string>(classes[0]?.id ?? '');
  const [drawMode, setDrawMode] = useState<'INTERVAL' | 'MASS' | 'FREE'>('INTERVAL');
  const [firstStartClock, setFirstStartClock] = useState<string>(competition.zeroTimeStr);
  const [intervalSec, setIntervalSec] = useState<number>(120);
  const [vacancies, setVacancies] = useState<number>(2);
  const [clubSeparation, setClubSeparation] = useState<boolean>(true);
  const [includeAlreadyStarted, setIncludeAlreadyStarted] = useState<boolean>(false);
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawFeedback, setDrawFeedback] = useState<string | null>(null);
  const [vacantSlotsPreview, setVacantSlotsPreview] = useState<string[]>([]);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === drawClassId) ?? classes[0],
    [classes, drawClassId]
  );

  const selectedClassCompetitors = useMemo(() => {
    if (!selectedClass) return [];
    return competitors
      .filter((c) => c.classId === selectedClass.id)
      .sort((a, b) => {
        const tA = a.allocatedStartSec ?? a.startTimeSec ?? 999999;
        const tB = b.allocatedStartSec ?? b.startTimeSec ?? 999999;
        if (tA !== tB) return tA - tB;
        return (a.bib ?? 9999) - (b.bib ?? 9999);
      });
  }, [competitors, selectedClass]);

  const handleDrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawClassId) return;
    setDrawBusy(true);
    setDrawFeedback(null);
    try {
      const res = await onDrawClass({
        classId: drawClassId,
        mode: drawMode,
        firstStartClock,
        intervalSec,
        vacancies,
        clubSeparation,
        includeAlreadyStarted,
      });
      setVacantSlotsPreview(res.vacantStartTimes);
      setDrawFeedback(
        `Lottade ${res.drawnCount} löpare i ${res.className} (${res.mode})${
          res.vacantStartTimes.length > 0 ? ` + ${res.vacantStartTimes.length} vakanser` : ''
        }.`
      );
    } catch (err: unknown) {
      setDrawFeedback(err instanceof Error ? err.message : 'Kunde inte slutföra lottningen.');
    } finally {
      setDrawBusy(false);
    }
  };

  const handleExportStartListIofXml = () => {
    const xml = buildIofStartListXml({ competition, classes, courses, competitors });
    triggerTextFileDownload(
      `startlist-${competition.date}-${competition.shortCode || 'comp'}.xml`,
      xml,
      'application/xml;charset=utf-8;'
    );
  };

  const handleExportStartListCsv = () => {
    const rows = [
      ['Startnummer', 'Starttid', 'Namn', 'Klubb', 'Klass', 'Bana', 'SI-bricka', 'Status'].join(';'),
    ];
    for (const c of competitors) {
      const cls = classes.find((k) => k.id === c.classId);
      const crs = courses.find((k) => k.id === cls?.courseId);
      const startClock =
        c.allocatedStartSec != null
          ? formatSecondsAsClock(c.allocatedStartSec)
          : c.startTimeSec != null
          ? formatSecondsAsClock(c.startTimeSec)
          : 'Ej satt';
      rows.push(
        [
          c.bib ?? '',
          startClock,
          c.fullName,
          c.club,
          cls?.name ?? '',
          crs?.name ?? '',
          c.siNumber,
          c.status,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(';')
      );
    }
    triggerTextFileDownload(
      `startlista-${competition.date}.csv`,
      rows.join('\r\n'),
      'text/csv;charset=utf-8;'
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shuffle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <span>Lottning</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Startlistelottning per klass med klubbseparering, intervallstart, masstart och export till IOF XML.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportStartListIofXml}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>IOF StartList XML</span>
          </button>

          <button
            type="button"
            onClick={handleExportStartListCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Startlista CSV</span>
          </button>
        </div>
      </div>

      {/* Startlistelottning per klass */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Startlistelottning per klass
            </h2>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Totalt anmälda i tävlingen: <strong className="font-mono text-slate-900 dark:text-slate-100">{competitors.length}</strong>
          </span>
        </div>

        {drawFeedback && (
          <div className="px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            {drawFeedback}
          </div>
        )}

        <form onSubmit={handleDrawSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Klass att lotta
              </label>
              <select
                value={drawClassId}
                onChange={(e) => setDrawClassId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-medium"
              >
                {classes.map((cls) => {
                  const cnt = competitors.filter((c) => c.classId === cls.id).length;
                  return (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} ({cnt} anmälda)
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Startläge
              </label>
              <select
                value={drawMode}
                onChange={(e) => setDrawMode(e.target.value as 'INTERVAL' | 'MASS' | 'FREE')}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-medium"
              >
                <option value="INTERVAL">Intervallstart (t.ex. 2 min)</option>
                <option value="MASS">Masstart (alla samma tid)</option>
                <option value="FREE">Fri start / Pinnstart (inget klockslag)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Första start (HH:MM:SS)
              </label>
              <input
                type="text"
                value={firstStartClock}
                onChange={(e) => setFirstStartClock(e.target.value)}
                disabled={drawMode === 'FREE'}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg disabled:opacity-40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Startintervall (sekunder)
              </label>
              <input
                type="number"
                min={30}
                max={600}
                step={30}
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
                disabled={drawMode !== 'INTERVAL'}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg disabled:opacity-40"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-slate-50/70 dark:bg-slate-950/40 rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Vakansplatser:
                </label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={vacancies}
                  onChange={(e) => setVacancies(Number(e.target.value))}
                  disabled={drawMode !== 'INTERVAL'}
                  className="w-16 px-2 py-1 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md disabled:opacity-40"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={clubSeparation}
                  onChange={(e) => setClubSeparation(e.target.checked)}
                  disabled={drawMode !== 'INTERVAL'}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500 disabled:opacity-40"
                />
                <span>Klubbseparering (undvik samma klubb i följd)</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAlreadyStarted}
                  onChange={(e) => setIncludeAlreadyStarted(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
                />
                <span>Lotta om även redan startade</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={drawBusy || !drawClassId}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <Shuffle className={`w-3.5 h-3.5 ${drawBusy ? 'animate-spin' : ''}`} />
              <span>Lotta starttider för {selectedClass?.name || 'vald klass'}</span>
            </button>
          </div>
        </form>

        {/* Start list preview for selected class */}
        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Startlista — {selectedClass?.name || 'Vald klass'} ({selectedClassCompetitors.length} deltagare)
            </h3>
            {vacantSlotsPreview.length > 0 && (
              <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
                {vacantSlotsPreview.length} vakanser inlagda
              </span>
            )}
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                <tr>
                  <th className="px-3 py-2">Startnr</th>
                  <th className="px-3 py-2">Starttid</th>
                  <th className="px-3 py-2">Namn</th>
                  <th className="px-3 py-2">Klubb</th>
                  <th className="px-3 py-2">SI-bricka</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                {selectedClassCompetitors.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400 dark:text-slate-500 font-sans">
                      Inga löpare anmälda i {selectedClass?.name || 'klassen'} ännu.
                    </td>
                  </tr>
                ) : (
                  selectedClassCompetitors.map((runner) => {
                    const startClock =
                      runner.allocatedStartSec != null
                        ? formatSecondsAsClock(runner.allocatedStartSec)
                        : runner.startTimeSec != null
                        ? formatSecondsAsClock(runner.startTimeSec)
                        : '—';
                    return (
                      <tr key={runner.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-500">{runner.bib ?? '—'}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                          {startClock}
                        </td>
                        <td className="px-3 py-2 font-sans font-medium text-slate-900 dark:text-slate-100">
                          {runner.fullName}
                        </td>
                        <td className="px-3 py-2 font-sans text-slate-600 dark:text-slate-400">
                          {runner.club}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                          {formatSiNumber(runner.siNumber)}
                        </td>
                        <td className="px-3 py-2 font-sans">
                          <RunnerStatusIndicator status={runner.status} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
