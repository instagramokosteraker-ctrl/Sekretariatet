import React, { useEffect, useState } from 'react';
import {
  CloudDownload,
  Database,
  Download,
  ExternalLink,
  FileCode,
  Plus,
  Radio,
  RefreshCw,
  Sliders,
  Smartphone,
  Trash2,
  Upload,
  Usb,
  Volume2,
  X,
} from 'lucide-react';
import type {
  CompetitionMeta,
  EventorIntegrationStatus,
  HardwareModel,
  RocIntegrationStatus,
  SIStation,
  StationFunction,
} from '../types/sportident';
import { getStockholmTodayIso } from '../firebase';
import type { SerialConnectionStatus, UsbStationMode } from '../services/sportidentWebSerial';
import { formatStationFunctionLabel } from './StatusLabels';
import {
  SAMPLE_EVENTOR_COMPETITOR_XML,
  SAMPLE_EVENTOR_ENTRY_XML,
  SAMPLE_OCAD_COURSE_XML,
  buildEffectiveCourseImportBatch,
  parseIofXmlDocument,
  triggerTextFileDownload,
  type ParsedIofClassAssignment,
  type ParsedIofCourse,
} from '../utils/iofXml';
import { apiFetch } from '../services/authClient';

interface HardwareStationsViewProps {
  isAdmin?: boolean;
  competition: CompetitionMeta;
  eventor: EventorIntegrationStatus;
  roc: RocIntegrationStatus;
  runnerDbCount: number;
  stations: SIStation[];
  serialStatus: SerialConnectionStatus;
  onUpdateCompetition: (patch: Partial<CompetitionMeta>) => Promise<void>;
  onOpenPublicPortal: () => void;
  onUpdateEventorSettings: (patch: { autoCreateFromRunnerDbOnReadout: boolean }) => Promise<void>;
  onSyncEventorClub: () => Promise<{
    ok: boolean;
    message: string;
  }>;
  onImportEventorEvent: (eventId: string) => Promise<{
    ok: boolean;
    message: string;
  }>;
  onUpdateRocSettings: (patch: Partial<RocIntegrationStatus>) => Promise<void>;
  onPollRocNow: () => Promise<{ ingested: number; error: string | null }>;
  onSimulateRocBatch: () => Promise<{ ingested: number; samplePayload: string }>;
  onConnectUsb: (baudRate: 38400 | 4800) => Promise<void>;
  onConnectWebUsb: (baudRate: 38400 | 4800) => Promise<void>;
  onDisconnectUsb: () => Promise<void>;
  onSetUsbMode: (mode: UsbStationMode) => void;
  onSetBaudRate: (baud: 38400 | 4800) => void;
  onSendDirectMode: () => Promise<void>;
  onRequestSysConfig: () => Promise<void>;
  onTriggerStationBeep: () => Promise<void>;
  onCreateStation: (payload: Partial<SIStation>) => Promise<string | null>;
  onDeleteStation: (id: string) => Promise<void>;
  onImportIofBatch: (batch: {
    courses: ParsedIofCourse[];
    classes: ParsedIofClassAssignment[];
    entries: { fullName: string; club: string; className: string; siNumber: number }[];
    runnerDbEntries: {
      siNumber: number;
      fullName: string;
      club: string;
      birthYear?: number | null;
      defaultClassName?: string | null;
      eventorPersonId?: string | null;
    }[];
  }) => Promise<{
    addedCourses: number;
    addedClasses: number;
    addedEntries: number;
    syncedRunnerDb?: number;
  }>;
  onResetDemoSeed: () => Promise<void>;
}

const HARDWARE_MODELS: HardwareModel[] = [
  'BSM8-USB',
  'BSM7-USB',
  'SRR-USB (Air+)',
  'BSF9 Master',
  'BSF8 Master',
];

const STATION_FUNCTIONS: StationFunction[] = [
  'CHECK',
  'START',
  'RADIO',
  'PREWARNING',
  'FINISH',
  'READOUT',
  'CLEAR',
];

export function HardwareStationsView({
  isAdmin = true,
  competition,
  eventor,
  roc,
  runnerDbCount,
  stations,
  serialStatus,
  onUpdateCompetition,
  onOpenPublicPortal,
  onUpdateEventorSettings,
  onSyncEventorClub,
  onImportEventorEvent,
  onUpdateRocSettings,
  onPollRocNow,
  onSimulateRocBatch,
  onConnectUsb,
  onConnectWebUsb,
  onDisconnectUsb,
  onSetUsbMode,
  onSetBaudRate,
  onSendDirectMode,
  onRequestSysConfig,
  onTriggerStationBeep,
  onCreateStation,
  onDeleteStation,
  onImportIofBatch,
  onResetDemoSeed,
}: HardwareStationsViewProps) {
  // Competition form synced when switching active competition
  const [compName, setCompName] = useState(competition.name);
  const [compDate, setCompDate] = useState(competition.date);
  const [compZero, setCompZero] = useState(competition.zeroTimeStr);
  const [compArena, setCompArena] = useState(competition.arenaInfo ?? '');
  const [compSelfReg, setCompSelfReg] = useState(
    competition.allowSelfRegistration !== false
  );
  const [compFeesAndSwish, setCompFeesAndSwish] = useState(
    Boolean(competition.enableFeesAndSwish)
  );
  const [compSavedMsg, setCompSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setCompName(competition.name);
    setCompDate(competition.date);
    setCompZero(competition.zeroTimeStr);
    setCompArena(competition.arenaInfo ?? '');
    setCompSelfReg(competition.allowSelfRegistration !== false);
    setCompFeesAndSwish(Boolean(competition.enableFeesAndSwish));
  }, [competition]);

  // Eventor REST API state
  const [eventorEventId, setEventorEventId] = useState(eventor.connectedEventId ?? '');
  const [eventorBusy, setEventorBusy] = useState(false);
  const [eventorFeedback, setEventorFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  // ROC state
  const [rocUnitInput, setRocUnitInput] = useState(roc.unitId);
  const [rocIntervalInput, setRocIntervalInput] = useState(roc.pollIntervalSec);
  const [rocBusy, setRocBusy] = useState(false);
  const [rocFeedback, setRocFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setRocUnitInput(roc.unitId);
    setRocIntervalInput(roc.pollIntervalSec);
  }, [roc.unitId, roc.pollIntervalSec]);

  // XML Import state
  const [xmlInput, setXmlInput] = useState('');
  const [xmlFeedback, setXmlFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Add Station modal
  const [modalOpen, setModalOpen] = useState(false);
  const [stationCode, setStationCode] = useState('61');
  const [stationName, setStationName] = useState('');
  const [hardwareModel, setHardwareModel] = useState<HardwareModel>('SRR-USB (Air+)');
  const [stationFunction, setStationFunction] = useState<StationFunction>('RADIO');
  const [stationErr, setStationErr] = useState<string | null>(null);

  const [confirmReset, setConfirmReset] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleDownloadBackup = async () => {
    setBackupFeedback(null);
    try {
      const res = await apiFetch('/api/system/backup');
      if (!res.ok) {
        setBackupFeedback({ ok: false, msg: 'Kunde inte hämta säkerhetskopian.' });
        return;
      }
      const text = await res.text();
      const dateStamp = new Date().toISOString().slice(0, 10);
      triggerTextFileDownload(
        `passersi-season-db-${dateStamp}.json`,
        text,
        'application/json;charset=utf-8;'
      );
      setBackupFeedback({
        ok: true,
        msg: 'Säsongsdatabasen (.json) har laddats ner till din enhet.',
      });
    } catch {
      setBackupFeedback({ ok: false, msg: 'Nätverksfel vid nedladdning av säkerhetskopia.' });
    }
  };

  const handleRestoreBackupUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupFeedback(null);
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as unknown;
      const res = await apiFetch('/api/system/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        eventCount?: number;
        runnerDbCount?: number;
        error?: string;
      };
      if (!res.ok) {
        setBackupFeedback({
          ok: false,
          msg: payload.error ?? 'Kunde inte återställa säkerhetskopian.',
        });
      } else {
        setBackupFeedback({
          ok: true,
          msg: `Säsongsdatabas återställd (${payload.eventCount ?? 0} tävlingar, ${
            payload.runnerDbCount ?? 0
          } löpare i registret).`,
        });
      }
    } catch {
      setBackupFeedback({
        ok: false,
        msg: 'Filen kunde inte läsas som en giltig JSON-säkerhetskopia.',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveComp = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateCompetition({
      name: compName,
      date: compDate,
      zeroTimeStr: compZero,
      arenaInfo: compArena,
      allowSelfRegistration: compSelfReg,
      enableFeesAndSwish: compFeesAndSwish,
    });
    setCompSavedMsg('Tävlingsinställningar sparade.');
    setTimeout(() => setCompSavedMsg(null), 3000);
  };

  const handleSyncClubClick = async () => {
    setEventorBusy(true);
    setEventorFeedback(null);
    try {
      const res = await onSyncEventorClub();
      setEventorFeedback({ ok: res.ok, msg: res.message });
    } finally {
      setEventorBusy(false);
    }
  };

  const handleImportEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventorEventId.trim()) return;
    setEventorBusy(true);
    setEventorFeedback(null);
    try {
      const res = await onImportEventorEvent(eventorEventId.trim());
      setEventorFeedback({ ok: res.ok, msg: res.message });
    } finally {
      setEventorBusy(false);
    }
  };

  const handleSaveRocSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateRocSettings({
      unitId: rocUnitInput.trim(),
      pollIntervalSec: rocIntervalInput,
    });
    setRocFeedback({ ok: true, msg: 'ROC-konfiguration sparad.' });
  };

  const handlePollRocClick = async () => {
    setRocBusy(true);
    setRocFeedback(null);
    try {
      await onUpdateRocSettings({ unitId: rocUnitInput.trim() });
      const res = await onPollRocNow();
      if (res.error) {
        setRocFeedback({ ok: false, msg: res.error });
      } else {
        setRocFeedback({
          ok: true,
          msg: `ROC kontrollerad — läste in ${res.ingested} nya radiostämplingar.`,
        });
      }
    } finally {
      setRocBusy(false);
    }
  };

  const handleSimulateRocClick = async () => {
    setRocBusy(true);
    setRocFeedback(null);
    try {
      const res = await onSimulateRocBatch();
      setRocFeedback({
        ok: true,
        msg: `Simulerade ROC-paket (${res.ingested} radiostämplingar inlästa till tävlingen).`,
      });
    } finally {
      setRocBusy(false);
    }
  };

  const handleXmlImport = async (rawXml: string) => {
    try {
      setXmlFeedback(null);
      const parsed = parseIofXmlDocument(rawXml);
      const effectiveBatch =
        parsed.type === 'CourseData'
          ? {
              ...parsed,
              ...buildEffectiveCourseImportBatch(parsed, {
                autoCreateClassesIfMissing: true,
                freeStart: true,
              }),
            }
          : parsed;
      const res = await onImportIofBatch(effectiveBatch);
      setXmlFeedback({
        ok: true,
        msg: `Importerade IOF XML ${parsed.iofVersion ?? '3.0'} (${parsed.type}): +${res.addedCourses} banor, +${res.addedClasses} klasser, +${res.addedEntries} anmälda, +${res.syncedRunnerDb ?? 0} i Löpardatabasen.`,
      });
    } catch (err: unknown) {
      setXmlFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : 'Kunde inte tolka XML-filen.',
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setXmlInput(text);
    await handleXmlImport(text);
    e.target.value = '';
  };

  const handleDownloadMopXml = async () => {
    const res = await apiFetch('/api/mop/xml');
    if (!res.ok) return;
    const text = await res.text();
    triggerTextFileDownload(
      `mop-complete-${competition.date}.xml`,
      text,
      'application/xml;charset=utf-8;'
    );
  };

  const handleCreateStationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStationErr(null);
    const err = await onCreateStation({
      stationCode: Number(stationCode),
      name: stationName.trim(),
      hardwareModel,
      stationFunction,
      baudRate: 38400,
    });
    if (err) {
      setStationErr(err);
    } else {
      setStationName('');
      setModalOpen(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100">
            {isAdmin
              ? 'Tävling, Eventor, ROC, WebUSB & XML'
              : 'USB-avläsare, Android OTG & Radiokontroller'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isAdmin
              ? 'Konfigurera tävlingsdata, publik QR-sida, Eventor, ROC-radiokontroller samt USB-anslutning.'
              : 'Anslut SPORTident-enhet via USB eller Android OTG och övervaka radiokontroller.'}
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setModalOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            {modalOpen ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{modalOpen ? 'Stäng formulär' : 'Ny SI-station'}</span>
          </button>
        )}
      </div>

      {modalOpen && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Lägg till SI-station / Radiokontroll
            </h2>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              aria-label="Stäng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleCreateStationSubmit} className="p-3.5 space-y-3">
            {stationErr && (
              <div className="px-3 py-1.5 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg">
                {stationErr}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Kod (CN)
                </label>
                <input
                  type="number"
                  min={1}
                  max={511}
                  value={stationCode}
                  onChange={(e) => setStationCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Benämning
                </label>
                <input
                  type="text"
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                  placeholder="t.ex. Radiokontroll K61"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Funktion i tävlingen
                </label>
                <select
                  value={stationFunction}
                  onChange={(e) => setStationFunction(e.target.value as StationFunction)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                >
                  {STATION_FUNCTIONS.map((fn) => (
                    <option key={fn} value={fn}>
                      {formatStationFunctionLabel(fn)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Hårdvarumodell
                </label>
                <select
                  value={hardwareModel}
                  onChange={(e) => setHardwareModel(e.target.value as HardwareModel)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                >
                  {HARDWARE_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
              >
                Avbryt
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap shrink-0"
              >
                Skapa station
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 1. Competition Settings & Public QR Link (Admin only) */}
      {isAdmin && (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tävlingsinställningar & Självregistrering
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              /t/{competition.shortCode}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {compSavedMsg && (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {compSavedMsg}
              </span>
            )}
            <button
              type="button"
              onClick={onOpenPublicPortal}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Publiksida & QR</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSaveComp} className="space-y-2.5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 items-end">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tävlingsnamn
              </label>
              <input
                type="text"
                value={compName}
                onChange={(e) => setCompName(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Datum
              </label>
              <input
                type="date"
                value={compDate}
                onChange={(e) => setCompDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nolltid (HH:MM:SS)
              </label>
              <input
                type="text"
                value={compZero}
                onChange={(e) => setCompZero(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Arenainfo / PM på publiksidan
              </label>
              <input
                type="text"
                value={compArena}
                onChange={(e) => setCompArena(e.target.value)}
                placeholder="t.ex. Samling Nyby IP, mål stänger 20:30"
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
              >
                Spara tävling
              </button>
              {competition.date === getStockholmTodayIso() && competition.status === 'LIVE' && (
                <button
                  type="button"
                  onClick={() => void onUpdateCompetition({ status: 'COMPLETED' })}
                  title="Markera dagens tävling som avslutad i förtid (stänger självregistrering)"
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                >
                  Avsluta nu
                </button>
              )}
              {competition.date === getStockholmTodayIso() && competition.status === 'COMPLETED' && (
                <button
                  type="button"
                  onClick={() => void onUpdateCompetition({ status: 'LIVE' })}
                  className="px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/70 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg whitespace-nowrap shrink-0"
                >
                  Återöppna
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-0.5">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={compSelfReg}
                onChange={(e) => setCompSelfReg(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-red-600"
              />
              <span>Tillåt mobil självregistrering via QR</span>
            </label>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={compFeesAndSwish}
                onChange={(e) => setCompFeesAndSwish(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-red-600"
              />
              <span>Avgift / Swish-QR aktiv</span>
            </label>
          </div>
        </form>
      </section>
      )}

      {/* 2. Web Serial (PC/Mac) & WebUSB CP210x (Android OTG) + SI5/SI6/SIAC */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Usb className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                SPORTident USB-avläsare — Web Serial & WebUSB CP210x (Android OTG)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Stödjer SI-Card 5 (<span className="font-mono">0xB1</span>), SI-Card 6 (
              <span className="font-mono">0xE1</span>) samt SI-Card 8–11 & SIAC (
              <span className="font-mono">0xEF</span> / <span className="font-mono">0xD3</span>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <select
              value={serialStatus.baudRate}
              disabled={serialStatus.connected}
              onChange={(e) => onSetBaudRate(Number(e.target.value) as 38400 | 4800)}
              className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value={38400}>38400 bps</option>
              <option value={4800}>4800 bps</option>
            </select>

            <select
              value={serialStatus.usbMode}
              onChange={(e) => onSetUsbMode(e.target.value as UsbStationMode)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="READOUT">Målavläsning & Radio</option>
              <option value="START_CORRAL">Startfålla & Brickbyte</option>
              <option value="REGISTRATION">Direktanmälan</option>
            </select>

            {serialStatus.connected ? (
              <button
                type="button"
                onClick={() => void onDisconnectUsb()}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-lg whitespace-nowrap"
              >
                Koppla från USB
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={serialStatus.connecting}
                  onClick={() => void onConnectUsb(serialStatus.baudRate)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap"
                >
                  <Usb className="w-3.5 h-3.5" />
                  <span>PC / Mac</span>
                </button>

                <button
                  type="button"
                  disabled={serialStatus.connecting}
                  onClick={() => void onConnectWebUsb(serialStatus.baudRate)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg whitespace-nowrap"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Android OTG</span>
                </button>
              </>
            )}
          </div>
        </div>

        {serialStatus.error && (
          <div className="px-3 py-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg">
            {serialStatus.error}
          </div>
        )}

        <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Status:{' '}
            <strong className="text-slate-900 dark:text-slate-100">
              {serialStatus.connected
                ? `Ansluten (${serialStatus.vendorProductLabel})`
                : 'Ej ansluten'}
            </strong>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!serialStatus.connected}
              onClick={() => void onSendDirectMode()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg disabled:opacity-40"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Direktläge (0xF0)</span>
            </button>
            <button
              type="button"
              disabled={!serialStatus.connected}
              onClick={() => void onRequestSysConfig()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Systeminfo (0x83)</span>
            </button>
            <button
              type="button"
              disabled={!serialStatus.connected}
              onClick={() => void onTriggerStationBeep()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg disabled:opacity-40"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Pip (0xF9)</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. ROC Radio Controls (roc.olresultat.se) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                ROC Radiokontroller i skogen (roc.olresultat.se)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Hämtar online-stämplingar via <span className="font-mono break-all">{roc.baseUrl}</span> ·
              Mottagna:{' '}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {roc.totalReceived} st
              </strong>{' '}
              (senaste ID: <span className="font-mono">{roc.lastPunchId}</span>).
            </p>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={roc.enabled}
              onChange={(e) =>
                void onUpdateRocSettings({
                  enabled: e.target.checked,
                  unitId: rocUnitInput.trim(),
                })
              }
              className="w-3.5 h-3.5 rounded border-slate-300 text-red-600"
            />
            <span>Automatisk ROC-polling</span>
          </label>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-2.5">
          <form onSubmit={handleSaveRocSettings} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                ROC Enhets-ID
              </label>
              <input
                type="text"
                value={rocUnitInput}
                onChange={(e) => setRocUnitInput(e.target.value)}
                placeholder="t.ex. 1042"
                className="w-28 px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Intervall
              </label>
              <select
                value={rocIntervalInput}
                onChange={(e) => setRocIntervalInput(Number(e.target.value))}
                className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              >
                <option value={3}>3 s</option>
                <option value={5}>5 s</option>
                <option value={10}>10 s</option>
                <option value={20}>20 s</option>
              </select>
            </div>

            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg whitespace-nowrap"
            >
              Spara ROC
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={rocBusy}
              onClick={() => void handlePollRocClick()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rocBusy ? 'animate-spin' : ''}`} />
              <span>Hämta ROC nu</span>
            </button>

            <button
              type="button"
              disabled={rocBusy}
              onClick={() => void handleSimulateRocClick()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Simulera ROC-stämplingar</span>
            </button>
          </div>
        </div>

        {rocFeedback && (
          <div
            className={`px-3 py-2 text-xs font-medium rounded-lg border ${
              rocFeedback.ok
                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60'
            }`}
          >
            {rocFeedback.msg}
          </div>
        )}
      </section>

      {/* 4. Eventor REST API & Automatic Runner Database Lookup (Admin only) */}
      {isAdmin && (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-2.5">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Eventor-koppling & Automatisk brickuppslagning (Löpardatabas)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Synka medlemmar och tävlingar från{' '}
              <span className="font-mono break-all">{eventor.baseUrl}</span> · Löpardatabas:{' '}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {runnerDbCount}
              </strong>{' '}
              SI-brickor.
            </p>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 shrink-0">
            <span>Servernyckel:</span>
            <strong
              className={
                eventor.apiKeyConfigured
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }
            >
              {eventor.apiKeyConfigured ? 'EVENTOR_API_KEY aktiv' : 'EVENTOR_API_KEY ej satt'}
            </strong>
            {eventor.connectedOrgName && (
              <>
                <span aria-hidden="true">·</span>
                <span>{eventor.connectedOrgName}</span>
              </>
            )}
          </div>
        </div>

        {!eventor.apiKeyConfigured && (
          <div className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg">
            För live-hämtning från Eventor: lägg in{' '}
            <span className="font-mono font-semibold">EVENTOR_API_KEY</span> i Secrets-panelen. Den
            lokala Löpardatabasen ({runnerDbCount} brickor) fungerar direkt även utan nyckel.
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <button
            type="button"
            disabled={eventorBusy || !eventor.apiKeyConfigured}
            onClick={() => void handleSyncClubClick()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap self-start"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${eventorBusy ? 'animate-spin' : ''}`} />
            <span>Synka klubbmedlemmar från Eventor</span>
          </button>

          <form onSubmit={handleImportEventSubmit} className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="eventor-id-input"
              className="text-xs text-slate-600 dark:text-slate-400"
            >
              Tävlings-ID:
            </label>
            <input
              id="eventor-id-input"
              type="text"
              inputMode="numeric"
              value={eventorEventId}
              onChange={(e) => setEventorEventId(e.target.value)}
              placeholder="t.ex. 48210"
              className="w-28 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            />
            <button
              type="submit"
              disabled={eventorBusy || !eventor.apiKeyConfigured || !eventorEventId.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <CloudDownload className="w-3.5 h-3.5" />
              <span>Hämta tävling</span>
            </button>
          </form>
        </div>

        {eventorFeedback && (
          <div
            className={`px-3 py-2 text-xs font-medium rounded-lg border ${
              eventorFeedback.ok
                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60'
            }`}
          >
            {eventorFeedback.msg}
          </div>
        )}

        <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800">
          <label className="inline-flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={eventor.autoCreateFromRunnerDbOnReadout}
              onChange={(e) =>
                void onUpdateEventorSettings({
                  autoCreateFromRunnerDbOnReadout: e.target.checked,
                })
              }
              className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-600"
            />
            <span>
              <strong>Automatisk deltagarregistrering vid brickavläsning:</strong> Slår upp oanmäld
              bricka i Löpardatabasen och matchar bana/klass direkt.
            </span>
          </label>
        </div>
      </section>
      )}

      {/* 5. IOF XML 3.0 Import (OCAD / Purple Pen / Eventor) & MOP Export (Admin only) */}
      {isAdmin && (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              IOF XML 3.0 (OCAD / Purple Pen / Eventor) & MeOS Online Protocol (MOP)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Importera <span className="font-mono">CourseData</span>,{' '}
              <span className="font-mono">EntryList</span> och{' '}
              <span className="font-mono">CompetitorList</span>, eller exportera MOP-flöde.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap">
              <Upload className="w-3.5 h-3.5" />
              <span>Läs in IOF XML</span>
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => void handleDownloadMopXml()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>MOP XML</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setXmlInput(SAMPLE_OCAD_COURSE_XML);
              void handleXmlImport(SAMPLE_OCAD_COURSE_XML);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Testa importera Purple Pen CourseData</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setXmlInput(SAMPLE_EVENTOR_ENTRY_XML);
              void handleXmlImport(SAMPLE_EVENTOR_ENTRY_XML);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Testa importera Eventor EntryList</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setXmlInput(SAMPLE_EVENTOR_COMPETITOR_XML);
              void handleXmlImport(SAMPLE_EVENTOR_COMPETITOR_XML);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Testa importera Eventor CompetitorList</span>
          </button>
        </div>

        {xmlFeedback && (
          <div
            className={`px-4 py-2.5 text-xs font-medium rounded-lg border ${
              xmlFeedback.ok
                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60'
            }`}
          >
            {xmlFeedback.msg}
          </div>
        )}

        {xmlInput && (
          <textarea
            rows={4}
            value={xmlInput}
            onChange={(e) => setXmlInput(e.target.value)}
            className="w-full p-3 text-[11px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
          />
        )}
      </section>
      )}

      {/* 5B. Portable Season Database Backup & Restore (Admin only) */}
      {isAdmin && (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Säsongsdatabas & Säkerhetskopiering (.json)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ladda ner komplett säkerhetskopia eller flytta säsongen mellan dator och molnserver.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleDownloadBackup()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ladda ner (.json)</span>
            </button>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0">
              <Upload className="w-3.5 h-3.5" />
              <span>Återställ .json</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleRestoreBackupUpload(e)}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {backupFeedback && (
          <div
            className={`px-3 py-2 text-xs font-medium rounded-lg border ${
              backupFeedback.ok
                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60'
            }`}
          >
            {backupFeedback.msg}
          </div>
        )}
      </section>
      )}

      {/* 6. Stations Table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Konfigurerade SI-stationer & Radiokontroller ({stations.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mappar stationskoder (CN) för onlinekontroller/ROC i skogen. Din USB-anslutna BSM8 växlar roll automatiskt efter öppen vy (Direktanmälan, Startfålla eller Målavläsning).
            </p>
          </div>

          {isAdmin &&
            (!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
              >
                Återställ exempeldata
              </button>
            ) : (
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onResetDemoSeed();
                    setConfirmReset(false);
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 rounded-md"
                >
                  Bekräfta
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300"
                >
                  Avbryt
                </button>
              </div>
            ))}
        </div>

        <div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="py-2 pl-3.5 pr-2">Kod</th>
                <th className="py-2 px-2">Benämning</th>
                <th className="hidden sm:table-cell py-2 px-2">Tävlingsfunktion</th>
                <th className="hidden md:table-cell py-2 px-2">Hårdvara</th>
                {isAdmin && <th className="py-2 pl-2 pr-3.5 text-right">Ta bort</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
              {stations.map((st) => (
                <tr key={st.id}>
                  <td className="py-1.5 pl-3.5 pr-2 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    CN {st.stationCode}
                  </td>
                  <td className="py-1.5 px-2 max-w-[170px] sm:max-w-[260px]">
                    <div className="flex items-baseline gap-1.5 min-w-0 truncate">
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {st.name}
                      </span>
                      <span className="sm:hidden text-[11px] text-slate-500 truncate">
                        · {formatStationFunctionLabel(st.stationFunction)}
                      </span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell py-1.5 px-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {formatStationFunctionLabel(st.stationFunction)}
                  </td>
                  <td className="hidden md:table-cell py-1.5 px-2 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {st.hardwareModel} · {st.batteryMv} mV
                  </td>
                  {isAdmin && (
                    <td className="py-1.5 pl-2 pr-3.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void onDeleteStation(st.id)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                        aria-label={`Ta bort ${st.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
