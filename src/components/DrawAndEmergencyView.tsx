import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Download,
  FileCode,
  RefreshCw,
  Shuffle,
  Sliders,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  CompClass,
  CompetitionMeta,
  Competitor,
  Course,
  EmergencySettings,
} from '../types/sportident';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
  formatSiNumber,
} from '../services/sportidentProtocol';
import { buildIofStartListXml, triggerTextFileDownload } from '../utils/iofXml';
import { RunnerStatusIndicator } from './StatusLabels';

interface DrawAndEmergencyViewProps {
  competition: CompetitionMeta;
  courses: Course[];
  classes: CompClass[];
  competitors: Competitor[];
  emergency: EmergencySettings;
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
  onUpdateEmergency: (patch: Partial<EmergencySettings>) => Promise<{
    recalculatedCount: number;
  }>;
  onRecalculateAll: () => Promise<{ recalculatedCount: number }>;
  onAssignManualFinish: (params: {
    competitorId: string;
    finishClockStr: string;
  }) => Promise<string | null>;
}

export function DrawAndEmergencyView({
  competition,
  courses,
  classes,
  competitors,
  emergency,
  onDrawClass,
  onUpdateEmergency,
  onRecalculateAll,
  onAssignManualFinish,
}: DrawAndEmergencyViewProps) {
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

  // Emergency state
  const [offsetCtrlInput, setOffsetCtrlInput] = useState<string>('55');
  const [offsetSecondsInput, setOffsetSecondsInput] = useState<string>('-60');
  const [manualRunnerId, setManualRunnerId] = useState<string>(competitors[0]?.id ?? '');
  const [manualFinishClock, setManualFinishClock] = useState<string>('10:35:00');
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [emergencyFeedback, setEmergencyFeedback] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  // All unique control codes across courses
  const allCourseControlCodes = useMemo(() => {
    const set = new Set<number>();
    for (const crs of courses) {
      for (const code of crs.controls) {
        set.add(code);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [courses]);

  const rawArchivedCount = useMemo(
    () => competitors.filter((c) => Boolean(c.rawReadout || c.readoutAt)).length,
    [competitors]
  );

  const handleRunDraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetClsId = drawClassId || classes[0]?.id;
    if (!targetClsId) return;
    setDrawBusy(true);
    setDrawFeedback(null);
    try {
      const res = await onDrawClass({
        classId: targetClsId,
        mode: drawMode,
        firstStartClock,
        intervalSec,
        vacancies,
        clubSeparation,
        includeAlreadyStarted,
      });
      setVacantSlotsPreview(res.vacantStartTimes || []);
      const modeLabel =
        drawMode === 'INTERVAL'
          ? `minutstart (${intervalSec} s intervall${clubSeparation ? ', klubbseparering' : ''})`
          : drawMode === 'MASS'
          ? `masstart kl. ${firstStartClock}`
          : 'fri starttid';
      setDrawFeedback(
        `Lottade ${res.drawnCount} deltagare i ${res.className} med ${modeLabel}${
          res.vacantStartTimes.length > 0
            ? ` + ${res.vacantStartTimes.length} vakanser (${res.vacantStartTimes.join(', ')})`
            : ''
        }.`
      );
    } finally {
      setDrawBusy(false);
    }
  };

  const handleExportStartListCsv = () => {
    const lines = ['Klass;Starttid;Startnr;Namn;Klubb;SI-bricka'];
    for (const cls of classes) {
      const inCls = competitors
        .filter((c) => c.classId === cls.id)
        .sort((a, b) => (a.allocatedStartSec ?? 999999) - (b.allocatedStartSec ?? 999999));
      for (const r of inCls) {
        lines.push(
          `${cls.name};${
            r.allocatedStartSec !== null ? formatSecondsAsClock(r.allocatedStartSec) : 'Fri start'
          };${r.bib};${r.fullName};${r.club};${r.siNumber}`
        );
      }
    }
    triggerTextFileDownload(
      `startlista-${competition.date}.csv`,
      lines.join('\n'),
      'text/csv;charset=utf-8;'
    );
  };

  const handleExportStartListIofXml = () => {
    const xml = buildIofStartListXml({
      competition,
      classes,
      courses,
      competitors,
    });
    triggerTextFileDownload(
      `iof-startlista-3.0-${competition.date}.xml`,
      xml,
      'application/xml;charset=utf-8;'
    );
  };

  const handleToggleBrokenControl = async (code: number) => {
    setEmergencyBusy(true);
    setEmergencyFeedback(null);
    try {
      const current = new Set(emergency.brokenControls);
      if (current.has(code)) {
        current.delete(code);
      } else {
        current.add(code);
      }
      const nextList = Array.from(current).sort((a, b) => a - b);
      const res = await onUpdateEmergency({
        brokenControls: nextList,
        controlTimeOffsets: emergency.controlTimeOffsets,
      });
      setEmergencyFeedback({
        ok: true,
        msg: current.has(code)
          ? `(${code}) markerad som trasig i skogen — räknade om ${res.recalculatedCount} utlästa brickor (saknad kontroll (${code}) godkänns nu som OK).`
          : `(${code}) återställd som ordinarie kontroll — räknade om ${res.recalculatedCount} utlästa brickor.`,
      });
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleAddControlTimeOffset = async (e: React.FormEvent) => {
    e.preventDefault();
    const ctrl = Number(offsetCtrlInput);
    const delta = Number(offsetSecondsInput);
    if (!Number.isFinite(ctrl) || ctrl <= 0 || !Number.isFinite(delta)) return;

    setEmergencyBusy(true);
    setEmergencyFeedback(null);
    try {
      const nextOffsets = { ...emergency.controlTimeOffsets };
      if (delta === 0) {
        delete nextOffsets[String(ctrl)];
      } else {
        nextOffsets[String(ctrl)] = Math.round(delta);
      }
      const res = await onUpdateEmergency({
        brokenControls: emergency.brokenControls,
        controlTimeOffsets: nextOffsets,
      });
      setEmergencyFeedback({
        ok: true,
        msg: `Tidsjustering för (${ctrl}) (${delta > 0 ? `+${delta}` : delta} s) sparad — räknade om ${res.recalculatedCount} avläsningar.`,
      });
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleRemoveOffset = async (codeKey: string) => {
    setEmergencyBusy(true);
    try {
      const nextOffsets = { ...emergency.controlTimeOffsets };
      delete nextOffsets[codeKey];
      const res = await onUpdateEmergency({
        brokenControls: emergency.brokenControls,
        controlTimeOffsets: nextOffsets,
      });
      setEmergencyFeedback({
        ok: true,
        msg: `Tog bort tidsjustering för (${codeKey}) — räknade om ${res.recalculatedCount} avläsningar.`,
      });
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleManualFinishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = manualRunnerId || competitors[0]?.id;
    if (!targetId) return;
    setEmergencyBusy(true);
    setEmergencyFeedback(null);
    try {
      const err = await onAssignManualFinish({
        competitorId: targetId,
        finishClockStr: manualFinishClock,
      });
      if (err) {
        setEmergencyFeedback({ ok: false, msg: err });
      } else {
        const r = competitors.find((c) => c.id === targetId);
        setEmergencyFeedback({
          ok: true,
          msg: `Manuell måltid (${manualFinishClock}) registrerad för ${r?.fullName ?? 'löpare'}.`,
        });
      }
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleRecalcClick = async () => {
    setEmergencyBusy(true);
    setEmergencyFeedback(null);
    try {
      const res = await onRecalculateAll();
      setEmergencyFeedback({
        ok: true,
        msg: `Räknade om ${res.recalculatedCount} utlästa SI-brickor från arkiverad rådata mot aktuella banor och klasser.`,
      });
    } finally {
      setEmergencyBusy(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100">
            Startlistelottning & Nödlägen i skogen
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Lotta starttider med klubbseparering och hantera trasiga kontroller, felställda
            stationsklockor eller omräkning av sparad rådata.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExportStartListIofXml}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>IOF StartList XML</span>
          </button>

          <button
            type="button"
            onClick={handleExportStartListCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Startlista CSV</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: Emergency Forest Tools & Raw Readout Recalculation */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Nödlägen i skogen & Omräkning ({rawArchivedCount} sparade avläsningar)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ändringar räknar omedelbart om sparade råavläsningar utan ny brickavläsning.
            </p>
          </div>

          <button
            type="button"
            disabled={emergencyBusy}
            onClick={() => void handleRecalcClick()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${emergencyBusy ? 'animate-spin' : ''}`} />
            <span>Räkna om alla</span>
          </button>
        </div>

        {emergencyFeedback && (
          <div
            className={`px-3 py-2 text-xs font-medium rounded-lg border ${
              emergencyFeedback.ok
                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60'
            }`}
          >
            {emergencyFeedback.msg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          {/* 1A: Broken Control in Forest */}
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                1. Kontroll ur funktion (Undanta stämplingskrav)
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Om en SI-enhet dött eller försvunnit i skogen: klicka på kontrollkoden nedan så blir
              löpare som saknar kontrollen godkända (OK). Prova t.ex. <strong>(55)</strong> för Sara
              Holm!
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allCourseControlCodes.map((code) => {
                const isBroken = emergency.brokenControls.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    disabled={emergencyBusy}
                    onClick={() => void handleToggleBrokenControl(code)}
                    className={`px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium rounded-md border transition-colors whitespace-nowrap ${
                      isBroken
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                    }`}
                  >
                    ({code}) {isBroken ? '(Ur funk.)' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1B: Station Clock Time Offset */}
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                2. Tidsjustering för felställd enhetsklocka
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Har en skogskontroll gått t.ex. 1 minut fel eller glömt sommartid (-3600 s)? Justera
              alla stämplingar på koden retroaktivt.
            </p>
            <form onSubmit={handleAddControlTimeOffset} className="flex items-end gap-2">
              <div className="w-24">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Kontroll
                </label>
                <select
                  value={offsetCtrlInput}
                  onChange={(e) => setOffsetCtrlInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
                >
                  {allCourseControlCodes.map((c) => (
                    <option key={c} value={String(c)}>
                      ({c})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Sekunder (+/-)
                </label>
                <input
                  type="number"
                  value={offsetSecondsInput}
                  onChange={(e) => setOffsetSecondsInput(e.target.value)}
                  placeholder="-60"
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
                />
              </div>
              <button
                type="submit"
                disabled={emergencyBusy}
                className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-md whitespace-nowrap shrink-0"
              >
                Tillämpa
              </button>
            </form>

            {Object.keys(emergency.controlTimeOffsets).length > 0 && (
              <div className="pt-1 space-y-1">
                {Object.entries(emergency.controlTimeOffsets).map(([k, sec]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between text-xs font-mono bg-white dark:bg-slate-900 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800"
                  >
                    <span>
                      ({k}): {sec > 0 ? `+${sec}` : sec} s
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRemoveOffset(k)}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Ta bort tidsjustering (${k})`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 1C: Manual Finish Time */}
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                3. Manuell måltid (Reservklocka vid målet)
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Om en löpare missat målenheten eller målets SI-station slutat fungera: sätt manuell
              måltid (HH:MM:SS).
            </p>
            <form onSubmit={handleManualFinishSubmit} className="space-y-2">
              <select
                value={manualRunnerId}
                onChange={(e) => setManualRunnerId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
              >
                {competitors.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.bib} {c.fullName} ({c.club})
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualFinishClock}
                  onChange={(e) => setManualFinishClock(e.target.value)}
                  placeholder="10:35:00"
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md"
                />
                <button
                  type="submit"
                  disabled={emergencyBusy || competitors.length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md whitespace-nowrap shrink-0"
                >
                  Sätt måltid
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* SECTION 2: Start List Draw Engine */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <Shuffle className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Startlistelottning per klass
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Minutstart med klubbseparering och vakanser, masstart samt fri starttid.
          </p>
        </div>

        <form
          onSubmit={handleRunDraw}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 items-end"
        >
          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Klass att lotta
            </label>
            <select
              value={drawClassId}
              onChange={(e) => setDrawClassId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({competitors.filter((c) => c.classId === cls.id).length} st)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Startmetod
            </label>
            <select
              value={drawMode}
              onChange={(e) => setDrawMode(e.target.value as 'INTERVAL' | 'MASS' | 'FREE')}
              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="INTERVAL">Minutstart (Lottad)</option>
              <option value="MASS">Masstart (Gemensam)</option>
              <option value="FREE">Fri start</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Första start
            </label>
            <input
              type="text"
              disabled={drawMode === 'FREE'}
              value={firstStartClock}
              onChange={(e) => setFirstStartClock(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg disabled:opacity-40"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Intervall (sek)
            </label>
            <select
              disabled={drawMode !== 'INTERVAL'}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg disabled:opacity-40"
            >
              <option value={60}>60 s (1 min)</option>
              <option value={90}>90 s (1,5 min)</option>
              <option value={120}>120 s (2 min)</option>
              <option value={180}>180 s (3 min)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Vakanser
            </label>
            <input
              type="number"
              min={0}
              max={15}
              disabled={drawMode !== 'INTERVAL'}
              value={vacancies}
              onChange={(e) => setVacancies(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg disabled:opacity-40"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={drawBusy || classes.length === 0}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>{drawBusy ? 'Lottar...' : 'Lotta startlista'}</span>
            </button>
          </div>

          <div className="col-span-2 sm:col-span-3 lg:col-span-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-0.5">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={clubSeparation}
                onChange={(e) => setClubSeparation(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-600"
              />
              <span>Automatisk klubbseparering</span>
            </label>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAlreadyStarted}
                onChange={(e) => setIncludeAlreadyStarted(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-600"
              />
              <span>Lotta även redan startade/avlästa</span>
            </label>
          </div>
        </form>

        {drawFeedback && (
          <div className="px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-lg">
            {drawFeedback}
          </div>
        )}
      </section>

      {/* Start List Preview Per Class */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {classes.map((cls) => {
          const inCls = competitors
            .filter((c) => c.classId === cls.id)
            .sort((a, b) => (a.allocatedStartSec ?? 999999) - (b.allocatedStartSec ?? 999999));

          return (
            <section
              key={cls.id}
              className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
            >
              <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40">
                <div className="flex items-baseline gap-2 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {cls.name}
                  </h3>
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">
                    {cls.freeStart ? 'Fri start' : 'Tilldelad starttid'}
                  </span>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
                  {inCls.length} anmälda
                </span>
              </div>

              {cls.id === drawClassId && vacantSlotsPreview.length > 0 && (
                <div className="px-3.5 py-1.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                  Vakanser: {vacantSlotsPreview.join(' · ')}
                </div>
              )}

              {inCls.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  Inga anmälda i {cls.name}.
                </div>
              ) : (
                <div>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500">
                        <th className="py-1.5 pl-3.5 pr-2">Starttid</th>
                        <th className="py-1.5 px-2">Löpare & Klubb</th>
                        <th className="hidden sm:table-cell py-1.5 px-2">SI-bricka</th>
                        <th className="py-1.5 pl-2 pr-3.5 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                      {inCls.map((r) => (
                        <tr key={r.id}>
                          <td className="py-1.5 pl-3.5 pr-2 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {r.allocatedStartSec !== null
                              ? formatSecondsAsClock(r.allocatedStartSec)
                              : 'Fri'}
                          </td>
                          <td className="py-1.5 px-2 max-w-[155px] sm:max-w-[230px]">
                            <div className="flex items-baseline gap-1.5 min-w-0 truncate">
                              <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                                #{r.bib}
                              </span>
                              <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                {r.fullName}
                              </span>
                              <span className="text-slate-300 dark:text-slate-700 shrink-0" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-[11px] text-slate-500 truncate">{r.club}</span>
                            </div>
                          </td>
                          <td className="hidden sm:table-cell py-1.5 px-2 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {formatSiNumber(r.siNumber)}
                          </td>
                          <td className="py-1.5 pl-2 pr-3.5 text-right whitespace-nowrap">
                            {r.manualFinishTimeSec ? (
                              <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
                                Man. {formatDurationMmSs(r.runningTimeSec)}
                              </span>
                            ) : (
                              <RunnerStatusIndicator status={r.status} compact />
                            )}
                          </td>
                        </tr>
                      ))}
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
