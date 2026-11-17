import React, { useState } from 'react';
import type { CardPunch, Competitor, Course } from '../types/sportident';

export interface SportidentHardwareTestbenchProps {
  courses: Course[];
  competitors: Competitor[];
  onSelectRunner: (id: string) => void;
  onSimulateFullReadout: (params: {
    protocolKind?: 'SI10_EF' | 'SI6_E1' | 'SI5_B1';
    siNumber: number;
    checkTimeSec: number | null;
    startTimeSec: number | null;
    finishTimeSec: number | null;
    punches: CardPunch[];
  }) => Promise<void>;
}

export function SportidentHardwareTestbench({
  courses,
  competitors,
  onSelectRunner,
  onSimulateFullReadout,
}: SportidentHardwareTestbenchProps) {
  const [busy, setBusy] = useState(false);

  const runScenarioHenrikReadout = async () => {
    const henrik = competitors.find((competitor) => competitor.siNumber === 8190442);
    const start = henrik?.startTimeSec ?? 36300;
    const finish = henrik?.finishTimeSec ?? start + 1598;
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI10_EF',
        siNumber: 8190442,
        checkTimeSec: start - 190,
        startTimeSec: start,
        finishTimeSec: finish,
        punches: [
          { code: 31, timeSec: start + 178 },
          { code: 38, timeSec: start + 429 },
          { code: 42, timeSec: start + 679 },
          { code: 55, timeSec: start + 1058 },
          { code: 61, timeSec: start + 1354 },
          { code: 100, timeSec: start + 1559 },
        ],
      });
      if (henrik) onSelectRunner(henrik.id);
    } finally {
      setBusy(false);
    }
  };

  const runScenarioFridaFinishAndReadout = async () => {
    const frida = competitors.find((competitor) => competitor.siNumber === 8339104);
    const start = frida?.startTimeSec ?? 36360;
    const finish = start + 1758;
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI10_EF',
        siNumber: 8339104,
        checkTimeSec: start - 180,
        startTimeSec: start,
        finishTimeSec: finish,
        punches: [
          { code: 31, timeSec: start + 205 },
          { code: 38, timeSec: start + 482 },
          { code: 42, timeSec: start + 748 },
          { code: 55, timeSec: start + 1168 },
          { code: 61, timeSec: start + 1485 },
          { code: 100, timeSec: start + 1715 },
        ],
      });
      if (frida) onSelectRunner(frida.id);
    } finally {
      setBusy(false);
    }
  };

  const runScenarioSiCard5Readout = async () => {
    const anders = competitors.find((competitor) => competitor.siNumber === 342819);
    const start = 37020;
    const finish = start + 1580;
    const course = courses.find((candidate) => candidate.id === 'crs-2') ??
      courses[1] ??
      courses[0];
    const controls = course ? course.controls : [31, 42, 52, 61, 100];
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI5_B1',
        siNumber: 342819,
        checkTimeSec: start - 70,
        startTimeSec: start,
        finishTimeSec: finish,
        punches: controls.map((code, index) => ({
          code,
          timeSec: start + (index + 1) * 295,
        })),
      });
      if (anders) onSelectRunner(anders.id);
    } finally {
      setBusy(false);
    }
  };

  const runScenarioSiCard6Readout = async () => {
    const helena = competitors.find((competitor) => competitor.siNumber === 612480);
    const start = helena?.startTimeSec ?? 36660;
    const finish = start + 1635;
    const course = courses.find((candidate) => candidate.id === 'crs-2') ??
      courses[1] ??
      courses[0];
    const controls = course ? course.controls : [31, 42, 52, 61, 100];
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI6_E1',
        siNumber: 612480,
        checkTimeSec: start - 50,
        startTimeSec: start,
        finishTimeSec: finish,
        punches: controls.map((code, index) => ({
          code,
          timeSec: start + (index + 1) * 304 + (index === 2 ? 42 : 0),
        })),
      });
      if (helena) onSelectRunner(helena.id);
    } finally {
      setBusy(false);
    }
  };

  const runScenarioJohanAutoCourseRental = async () => {
    const johan = competitors.find((competitor) => competitor.siNumber === 541209);
    const start = johan?.startTimeSec ?? 36540;
    const finish = start + 1645;
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI6_E1',
        siNumber: 541209,
        checkTimeSec: start - 40,
        startTimeSec: start,
        finishTimeSec: finish,
        punches: [
          { code: 31, timeSec: start + 240 },
          { code: 42, timeSec: start + 610 },
          { code: 52, timeSec: start + 980 },
          { code: 61, timeSec: start + 1350 },
          { code: 100, timeSec: start + 1595 },
        ],
      });
      if (johan) onSelectRunner(johan.id);
    } finally {
      setBusy(false);
    }
  };

  const runScenarioEventorDbMemberReadout = async () => {
    const start = 36600;
    const course = courses[2] ?? courses[0];
    const controls = course ? course.controls : [32, 42, 58, 100];
    setBusy(true);
    try {
      await onSimulateFullReadout({
        protocolKind: 'SI10_EF',
        siNumber: 8812405,
        checkTimeSec: start - 120,
        startTimeSec: start,
        finishTimeSec: start + 1420,
        punches: controls.map((code, index) => ({
          code,
          timeSec: start + (index + 1) * 310,
        })),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
        Diagnostik och verktyg
      </summary>
      <section className="border-t border-slate-200 dark:border-slate-800">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            SPORTident Hårdvarutestbänk
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Binära <span className="font-mono">0xEF</span>,{' '}
            <span className="font-mono">0xE1</span> &{' '}
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
    </details>
  );
}
