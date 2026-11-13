import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  CloudDownload,
  Database,
  ExternalLink,
  FileCode,
  MapPin,
  QrCode,
  RefreshCw,
  Sliders,
  Trophy,
  Upload,
} from 'lucide-react';
import type {
  CompetitionMeta,
  EventLifecycleStatus,
  EventorIntegrationStatus,
} from '../types/sportident';
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

interface CompetitionSettingsViewProps {
  isAdmin?: boolean;
  competition: CompetitionMeta;
  availableSeriesNames: string[];
  eventor: EventorIntegrationStatus;
  runnerDbCount: number;
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
    event?: {
      name: string;
      organizer: string | null;
      date: string | null;
    };
    importBatch?: {
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
    };
  }>;
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
}

export function CompetitionSettingsView({
  isAdmin = true,
  competition,
  availableSeriesNames,
  eventor,
  runnerDbCount,
  onUpdateCompetition,
  onOpenPublicPortal,
  onUpdateEventorSettings,
  onSyncEventorClub,
  onImportEventorEvent,
  onImportIofBatch,
}: CompetitionSettingsViewProps) {
  // Competition form state
  const [compName, setCompName] = useState(competition.name);
  const [compOrganizer, setCompOrganizer] = useState(competition.organizer);
  const [compDate, setCompDate] = useState(competition.date);
  const [compZero, setCompZero] = useState(competition.zeroTimeStr);
  const [compArena, setCompArena] = useState(competition.arenaInfo ?? '');
  const [compSeries, setCompSeries] = useState(competition.seriesName ?? '');
  const [compStatus, setCompStatus] = useState(competition.status ?? 'UPCOMING');
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [compSavedMsg, setCompSavedMsg] = useState<string | null>(null);

  // Eventor REST API state
  const [eventorEventId, setEventorEventId] = useState(eventor.connectedEventId ?? '');
  const [eventorBusy, setEventorBusy] = useState(false);
  const [eventorFeedback, setEventorFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  // IOF XML Import state
  const [xmlBusy, setXmlBusy] = useState(false);
  const [xmlFeedback, setXmlFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setCompName(competition.name);
    setCompOrganizer(competition.organizer);
    setCompDate(competition.date);
    setCompZero(competition.zeroTimeStr);
    setCompArena(competition.arenaInfo ?? '');
    setCompSeries(competition.seriesName ?? '');
  }, [
    competition.name,
    competition.organizer,
    competition.date,
    competition.zeroTimeStr,
    competition.arenaInfo,
    competition.seriesName,
  ]);

  useEffect(() => {
    setCompStatus(competition.status ?? 'UPCOMING');
  }, [competition.status]);

  const handleStatusChange = async (status: EventLifecycleStatus) => {
    if (status === competition.status) return;
    setCompStatus(status);
    setStatusSaving(true);
    setStatusError(null);
    try {
      await onUpdateCompetition({ status });
    } catch (error) {
      setCompStatus(competition.status ?? 'UPCOMING');
      setStatusError(
        error instanceof Error ? error.message : 'Tävlingsstatusen kunde inte sparas.'
      );
    } finally {
      setStatusSaving(false);
    }
  };

  const handleSaveComp = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateCompetition({
      name: compName.trim(),
      organizer: compOrganizer.trim(),
      date: compDate.trim(),
      zeroTimeStr: compZero.trim(),
      arenaInfo: compArena.trim(),
      seriesName: compSeries.trim(),
    });
    setCompSavedMsg('Inställningar sparade!');
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
      if (!res.ok) {
        setEventorFeedback({ ok: false, msg: res.message });
        return;
      }
      if (res.event && res.importBatch) {
        const importResult = await onImportIofBatch(res.importBatch);
        const metadataPatch: Partial<CompetitionMeta> = { name: res.event.name };
        if (res.event.organizer) metadataPatch.organizer = res.event.organizer;
        if (res.event.date && /^\d{4}-\d{2}-\d{2}$/.test(res.event.date)) {
          metadataPatch.date = res.event.date;
        }
        await onUpdateCompetition(metadataPatch);
        setEventorFeedback({
          ok: true,
          msg: `Hämtade "${res.event.name}" från Eventor: +${importResult.addedClasses} klasser och +${importResult.addedEntries} anmälda deltagare.`,
        });
        return;
      }
      setEventorFeedback({ ok: true, msg: res.message });
    } catch (error) {
      setEventorFeedback({
        ok: false,
        msg: error instanceof Error ? error.message : 'Kunde inte importera tävlingen från Eventor.',
      });
    } finally {
      setEventorBusy(false);
    }
  };

  const handleImportXmlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXmlBusy(true);
    setXmlFeedback(null);
    try {
      const text = await file.text();
      const doc = parseIofXmlDocument(text);
      const effectiveBatch = buildEffectiveCourseImportBatch(doc, {
        autoCreateClassesIfMissing: true,
        freeStart: false,
      });
      const res = await onImportIofBatch({
        courses: effectiveBatch.courses,
        classes: effectiveBatch.classes,
        entries: doc.entries,
        runnerDbEntries: doc.runnerDbEntries,
      });
      setXmlFeedback({
        ok: true,
        msg: `Fil "${file.name}" tolkad som ${doc.type}: +${res.addedCourses} banor, +${res.addedClasses} klasser, +${res.addedEntries} deltagare (${res.syncedRunnerDb ?? 0} i löpardatabasen).`,
      });
    } catch (err: unknown) {
      setXmlFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : 'Kunde inte tolka XML-filen.',
      });
    } finally {
      setXmlBusy(false);
      e.target.value = '';
    }
  };

  const handleImportSampleXml = async (sampleXml: string, label: string) => {
    setXmlBusy(true);
    setXmlFeedback(null);
    try {
      const doc = parseIofXmlDocument(sampleXml);
      const effectiveBatch = buildEffectiveCourseImportBatch(doc, {
        autoCreateClassesIfMissing: true,
        freeStart: false,
      });
      const res = await onImportIofBatch({
        courses: effectiveBatch.courses,
        classes: effectiveBatch.classes,
        entries: doc.entries,
        runnerDbEntries: doc.runnerDbEntries,
      });
      setXmlFeedback({
        ok: true,
        msg: `Laddade ${label}: +${res.addedCourses} banor, +${res.addedClasses} klasser, +${res.addedEntries} anmälda (${res.syncedRunnerDb ?? 0} i löpardatabasen).`,
      });
    } catch (err: unknown) {
      setXmlFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : 'Kunde inte importera demodata.',
      });
    } finally {
      setXmlBusy(false);
    }
  };

  const handleDownloadMopXml = async () => {
    const res = await fetch(`/api/mop/${competition.id}`);
    if (!res.ok) return;
    const text = await res.text();
    triggerTextFileDownload(
      `mop-complete-${competition.date}.xml`,
      text,
      'application/xml;charset=utf-8;'
    );
  };

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-red-600 dark:text-red-400" />
            <span>Tävlingsinställningar</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Konfigurera grunddata för aktiv tävling, Eventor REST API samt import av IOF XML.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={onOpenPublicPortal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Publiksida & QR</span>
          </button>
        </div>
      </div>

      {/* 1. Tävlingsinställningar */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tävlingsinställningar
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Grundläggande tävlingsuppgifter för tävlingen.
            </p>
          </div>
          {compSavedMsg && (
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
              {compSavedMsg}
            </span>
          )}
        </div>

        <form onSubmit={handleSaveComp} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tävlingsnamn
              </label>
              <input
                type="text"
                value={compName}
                onChange={(e) => setCompName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Arrangerande klubb
              </label>
              <input
                type="text"
                value={compOrganizer}
                onChange={(e) => setCompOrganizer(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Klubbserie/Cup
              </label>
              <div className="relative">
                <Trophy className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <select
                  value={compSeries}
                  onChange={(e) => setCompSeries(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                >
                  <option value="">Ingen</option>
                  {availableSeriesNames.map((seriesName) => (
                    <option key={seriesName} value={seriesName}>
                      {seriesName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="max-w-sm">
            <label
              htmlFor="competition-status"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Status
            </label>
            <div className="flex items-center gap-2">
              <select
                id="competition-status"
                value={compStatus}
                onChange={(e) => {
                  const status = e.target.value;
                  if (
                    status === 'UPCOMING' ||
                    status === 'LIVE' ||
                    status === 'COMPLETED'
                  ) {
                    void handleStatusChange(status);
                  }
                }}
                disabled={!isAdmin || statusSaving}
                className="min-w-40 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-60"
              >
                <option value="UPCOMING">Kommande</option>
                <option value="LIVE">Pågående</option>
                <option value="COMPLETED">Avslutad</option>
              </select>
              <span
                aria-live="polite"
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                  compStatus === 'LIVE'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : compStatus === 'COMPLETED'
                      ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                }`}
              >
                {compStatus === 'LIVE'
                  ? 'Pågående'
                  : compStatus === 'COMPLETED'
                    ? 'Avslutad'
                    : 'Kommande'}
              </span>
              {statusSaving && (
                <span className="text-xs text-slate-500 dark:text-slate-400">Sparar…</span>
              )}
            </div>
            {statusError && (
              <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {statusError}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tävlingsdatum
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="date"
                  value={compDate}
                  onChange={(e) => setCompDate(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nolltid (HH:MM:SS)
              </label>
              <div className="relative">
                <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={compZero}
                  onChange={(e) => setCompZero(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                  required
                />
              </div>
            </div>

            <div className="sm:col-span-1 lg:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Arenainfo / Samlingsplats
              </label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={compArena}
                  onChange={(e) => setCompArena(e.target.value)}
                  placeholder="t.ex. Klubbhörnan, första start 18:00."
                  className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              Spara tävlingsinställningar
            </button>
          </div>
        </form>
      </section>

      {/* 2. Eventor-koppling & Automatisk brickuppslagning (Löpardatabas) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Eventor-koppling & Automatisk brickuppslagning (Löpardatabas)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Synka medlemmar och tävlingar från Eventor · Löpardatabas:{' '}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {runnerDbCount}
              </strong>{' '}
              SI-brickor.
            </p>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 shrink-0">
            {eventor.connectedOrgName && (
              <>
                <span>Ansluten:</span>
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {eventor.connectedOrgName}
                </strong>
              </>
            )}
          </div>
        </div>

        <div className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg">
          Eventor-anslutningen hanteras under <strong>Klubbadmin & Behörighet → Eventor-integration</strong>.
          Den lokala Löpardatabasen ({runnerDbCount} brickor) fungerar även utan Eventor-anslutning.
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <button
            type="button"
            disabled={eventorBusy}
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
              className="w-28 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <button
              type="submit"
              disabled={eventorBusy || !eventorEventId.trim()}
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

        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800">
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
              bricka i Löpardatabasen och matchar bana/klass direkt vid målavläsning.
            </span>
          </label>
        </div>
      </section>

      {/* 3. Importera tävlingsdata (IOF XML 3.0 & MOP) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Importera tävlingsdata
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              IOF XML 3.0 (OCAD / Purple Pen / Eventor) & MeOS Online Protocol (MOP)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
              <Upload className="w-3.5 h-3.5" />
              <span>Välj XML-fil (.xml)</span>
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                onChange={(e) => void handleImportXmlFile(e)}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => void handleDownloadMopXml()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Exportera MOP XML</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Snabbtest med demodata:</span>
          <button
            type="button"
            disabled={xmlBusy}
            onClick={() => void handleImportSampleXml(SAMPLE_OCAD_COURSE_XML, 'OCAD CourseData')}
            className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md transition-colors whitespace-nowrap"
          >
            OCAD Banor XML
          </button>
          <button
            type="button"
            disabled={xmlBusy}
            onClick={() => void handleImportSampleXml(SAMPLE_EVENTOR_ENTRY_XML, 'Eventor EntryList')}
            className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md transition-colors whitespace-nowrap"
          >
            Eventor Anmälningslista
          </button>
          <button
            type="button"
            disabled={xmlBusy}
            onClick={() =>
              void handleImportSampleXml(SAMPLE_EVENTOR_COMPETITOR_XML, 'Eventor CompetitorList')
            }
            className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md transition-colors whitespace-nowrap"
          >
            Eventor Löpardatabas
          </button>
        </div>

        {xmlFeedback && (
          <div
            className={`px-3 py-2 text-xs font-medium rounded-lg border ${
              xmlFeedback.ok
                ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60'
            }`}
          >
            {xmlFeedback.msg}
          </div>
        )}
      </section>
    </div>
  );
}
