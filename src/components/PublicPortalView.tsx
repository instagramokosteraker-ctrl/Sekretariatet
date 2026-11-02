import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  MapPin,
  Moon,
  QrCode,
  Share2,
  Sun,
  Trophy,
  UserCheck,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import type {
  ClubSettings,
  CompetitionSummary,
  Competitor,
  PublicRacePayload,
  PublicSeasonOverviewPayload,
  RunnerDbEntry,
  SeriesStandingsBundle,
} from '../types/sportident';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
  formatSiNumber,
} from '../services/sportidentProtocol';
import { SplitsAnalysisTable } from './SplitsAnalysisTable';
import { RunnerSplitCardModal } from './RunnerSplitCardModal';
import { RunnerStatusIndicator } from './StatusLabels';
import { PWAInstallButton } from './PWAInstallButton';
import { applyClubThemeToDocument } from '../utils/clubTheme';

interface PublicPortalViewProps {
  shortCode: string | null; // null means Season Overview (/publik)
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onSelectEventShortCode: (shortCode: string | null) => void;
  onSwitchToSecretariat: () => void;
}

type PublicEventTab = 'RESULTS' | 'STARTLIST' | 'SELF_REG';

function buildSwishQrPayload(swishNumber: string, amountSek: number, message: string): string {
  const digits = swishNumber.replace(/\D/g, '');
  const cleanMsg = message.replace(/;/g, ' ').trim().slice(0, 50);
  const cleanAmount = Math.max(0, Math.round(amountSek));
  return `C${digits};${cleanAmount};${cleanMsg};0`;
}

export function PublicPortalView({
  shortCode,
  darkMode,
  onToggleDarkMode,
  onSelectEventShortCode,
  onSwitchToSecretariat,
}: PublicPortalViewProps) {
  const [competitionsList, setCompetitionsList] = useState<CompetitionSummary[]>([]);
  const [seasonClubSettings, setSeasonClubSettings] = useState<ClubSettings | null>(null);
  const [seasonSeriesStandings, setSeasonSeriesStandings] = useState<SeriesStandingsBundle[]>([]);
  const [selectedSeriesName, setSelectedSeriesName] = useState<string>('');
  const [selectedSeriesClass, setSelectedSeriesClass] = useState<string>('');

  const [raceData, setRaceData] = useState<PublicRacePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<PublicEventTab>('RESULTS');
  const [resultsGrouping, setResultsGrouping] = useState<'CLASS' | 'CLUB'>('CLASS');
  const [selectedClassId, setSelectedClassId] = useState<string>('ALL');

  // Runner detail inline panel
  const [inspectedRunner, setInspectedRunner] = useState<Competitor | null>(null);

  // QR & Share inline footer panel
  const [qrModalOpen, setQrModalOpen] = useState<boolean>(false);
  const [qrSvgMarkup, setQrSvgMarkup] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Mobile Self-Registration form state
  const [selfSiInput, setSelfSiInput] = useState<string>('');
  const [selfFullName, setSelfFullName] = useState<string>('');
  const [selfClub, setSelfClub] = useState<string>('');
  const [selfClassId, setSelfClassId] = useState<string>('');
  const [selfIsRental, setSelfIsRental] = useState<boolean>(false);
  const [selfLookupMatch, setSelfLookupMatch] = useState<RunnerDbEntry | null>(null);
  const [selfAlreadyEntered, setSelfAlreadyEntered] = useState<{
    bib: number;
    fullName: string;
    club: string;
  } | null>(null);
  const [selfBusy, setSelfBusy] = useState<boolean>(false);
  const [selfNotice, setSelfNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [swishQrSvg, setSwishQrSvg] = useState<string>('');

  const loadData = useCallback(async () => {
    try {
      if (!shortCode) {
        const res = await fetch('/api/public/season');
        if (res.ok) {
          const overview = (await res.json()) as PublicSeasonOverviewPayload;
          setCompetitionsList(overview.competitions);
          setSeasonClubSettings(overview.clubSettings);
          setSeasonSeriesStandings(overview.seriesStandings ?? []);
          setError(null);
        } else {
          const fallback = await fetch('/api/public/competitions');
          if (fallback.ok) {
            setCompetitionsList((await fallback.json()) as CompetitionSummary[]);
            setError(null);
          }
        }
      } else {
        const res = await fetch(`/api/public/events/${encodeURIComponent(shortCode)}`);
        if (!res.ok) {
          setError('Tävlingen eller kortlänken hittades inte.');
          setRaceData(null);
        } else {
          const payload = (await res.json()) as PublicRacePayload;
          setRaceData(payload);
          setCompetitionsList(payload.competitionsList);
          if (payload.clubSettings) setSeasonClubSettings(payload.clubSettings);
          if (payload.seriesStandings) setSeasonSeriesStandings(payload.seriesStandings);
          setError(null);
        }
      }
    } catch {
      setError('Kunde inte nå resultatservern — visar senast hämtade data.');
    } finally {
      setLoading(false);
    }
  }, [shortCode]);

  useEffect(() => {
    setLoading(true);
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (seasonSeriesStandings.length === 0) {
      setSelectedSeriesName('');
      setSelectedSeriesClass('');
      return;
    }
    const bundle =
      seasonSeriesStandings.find((b) => b.seriesName === selectedSeriesName) ??
      seasonSeriesStandings[0];
    if (bundle.seriesName !== selectedSeriesName) {
      setSelectedSeriesName(bundle.seriesName);
    }
    if (!bundle.classes.some((c) => c.className === selectedSeriesClass)) {
      setSelectedSeriesClass(bundle.classes[0]?.className ?? '');
    }
  }, [seasonSeriesStandings, selectedSeriesName, selectedSeriesClass]);

  // Real-time WebSocket auto-refresh for spectators
  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!active) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/api/ws`);
      ws.onmessage = () => {
        if (active) void loadData();
      };
      ws.onclose = () => {
        if (active) retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    };
  }, [loadData]);

  // Generate SVG QR code for current public event URL
  const publicEventUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const code = shortCode || raceData?.competition.shortCode;
    return code
      ? `${window.location.origin}/t/${code}`
      : `${window.location.origin}/publik`;
  }, [shortCode, raceData]);

  const iofResultsXmlUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const code = shortCode || raceData?.competition.shortCode;
    return code
      ? `${window.location.origin}/api/public/events/${code}/iof-results`
      : '';
  }, [shortCode, raceData]);

  useEffect(() => {
    if (!publicEventUrl) return;
    let mounted = true;
    QRCode.toString(publicEventUrl, {
      type: 'svg',
      margin: 1,
      width: 200,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((svg) => {
        if (mounted) setQrSvgMarkup(svg);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      mounted = false;
    };
  }, [publicEventUrl]);

  // Instant SI-card lookup when runner types SI number on mobile Self-Registration
  useEffect(() => {
    if (!shortCode) return;
    const digits = selfSiInput.replace(/\D/g, '');
    if (digits.length < 4) {
      setSelfLookupMatch(null);
      setSelfAlreadyEntered(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/public/events/${encodeURIComponent(shortCode)}/lookup-si/${digits}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          runnerDbMatch: RunnerDbEntry | null;
          alreadyEntered: { bib: number; fullName: string; club: string } | null;
        };
        setSelfAlreadyEntered(data.alreadyEntered);
        setSelfLookupMatch(data.runnerDbMatch);

        if (data.runnerDbMatch && !data.alreadyEntered) {
          setSelfFullName(data.runnerDbMatch.fullName);
          setSelfClub(data.runnerDbMatch.club);
          if (data.runnerDbMatch.defaultClassName && raceData) {
            const cls = raceData.classes.find(
              (c) =>
                c.allowDirectEntry &&
                c.name.toLowerCase() === data.runnerDbMatch!.defaultClassName!.toLowerCase()
            );
            if (cls) setSelfClassId(cls.id);
          }
        }
      } catch {
        // ignore
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [selfSiInput, shortCode, raceData]);

  const openDirectClasses = useMemo(
    () => (raceData ? raceData.classes.filter((c) => c.allowDirectEntry) : []),
    [raceData]
  );

  const selectedSelfClass = useMemo(() => {
    if (openDirectClasses.length === 0) return null;
    return (
      openDirectClasses.find((c) => c.id === selfClassId) ?? openDirectClasses[0] ?? null
    );
  }, [openDirectClasses, selfClassId]);

  const feesEnabled = Boolean(raceData?.competition.enableFeesAndSwish);
  const effectiveClubSettings = raceData?.clubSettings ?? seasonClubSettings;
  const [logoBroken, setLogoBroken] = useState<boolean>(false);

  useEffect(() => {
    setLogoBroken(false);
  }, [effectiveClubSettings?.logoDataUrl]);

  useEffect(() => {
    applyClubThemeToDocument(effectiveClubSettings, darkMode);
  }, [effectiveClubSettings, darkMode]);

  const baseClassFeeSek =
    selectedSelfClass?.feeSek ?? effectiveClubSettings?.defaultDirectEntryFeeSek ?? 0;
  const rentalExtraSek = selfIsRental ? effectiveClubSettings?.rentalCardFeeSek ?? 30 : 0;
  const totalSelfFeeSek = baseClassFeeSek + rentalExtraSek;
  const swishMessage = `${shortCode || 'PasserSI'} ${selfFullName.trim() || 'Direktanmalan'}`
    .trim()
    .slice(0, 50);

  // Generate Swish QR SVG dynamically for Mobile Self-Registration
  useEffect(() => {
    const swishNum = effectiveClubSettings?.swishNumber ?? '';
    const digits = swishNum.replace(/\D/g, '');
    if (!feesEnabled || activeTab !== 'SELF_REG' || digits.length < 6 || totalSelfFeeSek <= 0) {
      setSwishQrSvg('');
      return;
    }
    let mounted = true;
    const payload = buildSwishQrPayload(digits, totalSelfFeeSek, swishMessage);
    QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      width: 164,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((svg) => {
        if (mounted) setSwishQrSvg(svg);
      })
      .catch(() => {
        if (mounted) setSwishQrSvg('');
      });
    return () => {
      mounted = false;
    };
  }, [feesEnabled, activeTab, effectiveClubSettings?.swishNumber, totalSelfFeeSek, swishMessage]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    } catch {
      // ignore
    }
  };

  const uniqueClubs = useMemo(() => {
    if (!raceData) return [];
    const set = new Set<string>();
    for (const c of raceData.competitors) {
      if (c.club.trim()) set.add(c.club.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'sv'));
  }, [raceData]);

  const filteredCompetitors = useMemo(() => {
    if (!raceData) return [];
    return raceData.competitors;
  }, [raceData]);

  const handleSelfRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shortCode) return;
    setSelfBusy(true);
    setSelfNotice(null);
    try {
      const targetClassId = selfClassId || openDirectClasses[0]?.id || '';
      const res = await fetch(
        `/api/public/events/${encodeURIComponent(shortCode)}/self-register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siNumber: Number(selfSiInput.replace(/\D/g, '')),
            fullName: selfFullName.trim(),
            club: selfClub.trim() || 'Klubblös',
            classId: targetClassId,
            isRentalCard: selfIsRental,
          }),
        }
      );
      const data = (await res.json()) as Competitor & { error?: string };
      if (!res.ok) {
        setSelfNotice({
          ok: false,
          msg: data.error ?? 'Kunde inte genomföra självregistreringen.',
        });
      } else {
        setSelfNotice({
          ok: true,
          msg: `Klart! ${data.fullName} är nu anmäld med startnr #${data.bib} (SI ${formatSiNumber(
            data.siNumber
          )}). Lycka till i skogen!`,
        });
        setSelfSiInput('');
        setSelfFullName('');
        setSelfClub('');
        void loadData();
      }
    } finally {
      setSelfBusy(false);
    }
  };

  // ============================================================================
  // VIEW A: SEASON OVERVIEW (/publik)
  // ============================================================================
  if (!shortCode) {
    const liveList = competitionsList.filter((c) => c.status === 'LIVE');
    const upcomingList = competitionsList.filter((c) => c.status === 'UPCOMING');
    const completedList = competitionsList.filter((c) => c.status === 'COMPLETED');

    const activeSeriesBundle =
      seasonSeriesStandings.find((b) => b.seriesName === selectedSeriesName) ??
      seasonSeriesStandings[0] ??
      null;
    const activeSeriesClassGroup =
      activeSeriesBundle?.classes.find((c) => c.className === selectedSeriesClass) ??
      activeSeriesBundle?.classes[0] ??
      null;

    const renderGroup = (title: string, items: CompetitionSummary[]) => {
      if (items.length === 0) return null;
      return (
        <section className="space-y-1.5">
          <h2 className="text-xs font-semibold club-muted text-slate-600 dark:text-slate-400 px-0.5">
            {title} ({items.length})
          </h2>
          <div className="club-surface bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200/80 dark:divide-slate-800/80 overflow-hidden">
            {items.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => onSelectEventShortCode(ev.shortCode)}
                className="w-full text-left px-3.5 py-2 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3"
              >
                <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-display font-bold truncate">
                    {ev.name}
                  </span>
                  <span className="text-xs club-muted text-slate-500 dark:text-slate-400 truncate">
                    <span className="font-mono tabular-nums">
                      {ev.date}
                      {ev.status !== 'COMPLETED' ? ` kl. ${ev.zeroTimeStr.slice(0, 5)}` : ''}
                    </span>
                    {ev.seriesName ? ` · ${ev.seriesName}` : ''}
                    {ev.arenaInfo ? ` · ${ev.arenaInfo}` : ''}
                  </span>
                </div>

                <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums club-muted text-slate-600 dark:text-slate-400">
                  <span>
                    {ev.finishedCount}/{ev.competitorCount} i mål
                  </span>
                  {ev.allowSelfRegistration && ev.status !== 'COMPLETED' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans text-emerald-700 dark:text-emerald-400 font-medium">
                        Självreg
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-400 dark:text-slate-500">/t/{ev.shortCode}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      );
    };

    return (
      <div className="min-h-screen flex flex-col club-canvas bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-clip">
        <header className="min-h-12 py-1.5 px-3 sm:px-6 lg:px-8 club-surface bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {effectiveClubSettings?.logoDataUrl && !logoBroken && (
              <img
                src={effectiveClubSettings.logoDataUrl}
                alt={`${effectiveClubSettings.clubName || 'Klubb'} logotyp`}
                referrerPolicy="no-referrer"
                onError={() => setLogoBroken(true)}
                className="h-7 w-auto max-w-[96px] sm:max-w-[130px] object-contain shrink-0"
              />
            )}
            <span className="text-sm sm:text-base font-display font-bold truncate">
              {effectiveClubSettings?.portalTitle?.trim() || 'PasserSI Live'}
            </span>
            <span className="text-xs club-muted text-slate-500 dark:text-slate-400 hidden md:inline truncate">
              Liveresultat, sträcktider & mobil självregistrering
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0"
              aria-label="Växla tema"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onSwitchToSecretariat}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Wrench className="w-3.5 h-3.5 shrink-0" />
              <span>Sekretariat</span>
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto p-3 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg sm:text-xl font-display font-bold">
              {seasonClubSettings?.clubName
                ? `${seasonClubSettings.clubName} — Tävlingar & Träningar`
                : 'Tävlingar & Klubbarrangemang'}
            </h1>
            <p className="text-xs club-muted text-slate-500 dark:text-slate-400">
              Välj tävling för liveresultat, sträcktider eller självregistrering.
            </p>
          </div>

          {!loading && competitionsList.length === 0 ? (
            <section className="p-5 club-surface bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-1">
              <h2 className="text-sm font-semibold">
                Inga publicerade tävlingar just nu
              </h2>
              <p className="text-xs club-muted text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Nya tävlingar och klubbträningar visas här så snart sekretariatet har lagt upp dem.
              </p>
            </section>
          ) : (
            <div className="space-y-3.5">
              {renderGroup('Pågår nu', liveList)}
              {renderGroup('Kommande tävlingar & träningar', upcomingList)}
              {renderGroup('Avslutade tävlingar', completedList)}
            </div>
          )}

          {/* Public Multi-Stage Club Series Leaderboard */}
          {activeSeriesBundle && activeSeriesBundle.classes.length > 0 && (
            <section className="club-surface bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>{activeSeriesBundle.seriesName}</span>
                  </h2>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Poängskala 25-20-16-13...
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {seasonSeriesStandings.length > 1 && (
                    <select
                      value={activeSeriesBundle.seriesName}
                      onChange={(e) => setSelectedSeriesName(e.target.value)}
                      className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                    >
                      {seasonSeriesStandings.map((b) => (
                        <option key={b.seriesName} value={b.seriesName}>
                          {b.seriesName}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    {activeSeriesBundle.classes.map((c) => (
                      <button
                        key={c.className}
                        type="button"
                        onClick={() => setSelectedSeriesClass(c.className)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                          activeSeriesClassGroup?.className === c.className
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {c.className}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {activeSeriesClassGroup && (
                <div className="w-full overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        <th className="py-1.5 pl-3.5 pr-1.5 w-10">#</th>
                        <th className="py-1.5 px-2">Löpare · Klubb</th>
                        {activeSeriesBundle.stages.map((st, idx) => (
                          <th
                            key={st.eventId}
                            title={`${st.name} (${st.date})`}
                            className="hidden sm:table-cell py-1.5 px-2 text-right font-mono whitespace-nowrap"
                          >
                            E{idx + 1}
                          </th>
                        ))}
                        <th className="py-1.5 pl-2 pr-3.5 text-right">Totalt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                      {activeSeriesClassGroup.rows.map((row, idx) => (
                        <tr
                          key={row.runnerKey}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        >
                          <td className="py-1.5 pl-3.5 pr-1.5 font-mono tabular-nums text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="py-1.5 px-2 min-w-0">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.fullName}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {' · '}
                              {row.club}
                            </span>
                          </td>
                          {activeSeriesBundle.stages.map((st) => {
                            const pts = row.stagePoints[st.eventId];
                            return (
                              <td
                                key={st.eventId}
                                className="hidden sm:table-cell py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap"
                              >
                                {pts !== undefined ? `${pts}` : '—'}
                              </td>
                            );
                          })}
                          <td className="py-1.5 pl-2 pr-3.5 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {row.totalPoints} p
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </main>

        <footer className="mt-4 club-surface bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="max-w-5xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs club-muted text-slate-500 dark:text-slate-400">
              {effectiveClubSettings?.portalTitle?.trim() || 'PasserSI Live'} · Orienteringsresultat i realtid
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <PWAInstallButton />
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // ============================================================================
  // VIEW B: PUBLIC RACE PAGE (/t/{shortCode})
  // ============================================================================
  return (
    <div className="min-h-screen flex flex-col club-canvas bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-clip">
      {/* Top Spectator Header */}
      <header className="club-surface bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="min-h-12 py-1.5 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {effectiveClubSettings?.logoDataUrl && !logoBroken && (
              <img
                src={effectiveClubSettings.logoDataUrl}
                alt={`${effectiveClubSettings.clubName || 'Klubb'} logotyp`}
                referrerPolicy="no-referrer"
                onError={() => setLogoBroken(true)}
                className="h-6 w-auto max-w-[84px] sm:max-w-[100px] object-contain shrink-0"
              />
            )}
            <button
              type="button"
              onClick={() => onSelectEventShortCode(null)}
              className="inline-flex items-center gap-1 text-xs font-medium club-muted text-slate-700 dark:text-slate-300 hover:underline whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Alla</span>
            </button>
            <span className="text-slate-300 dark:text-slate-700 shrink-0" aria-hidden="true">
              /
            </span>
            <h1 className="text-sm sm:text-base font-display font-bold truncate">
              {raceData?.competition.name ?? 'Laddar tävling...'}
            </h1>
            {raceData && (
              <div className="hidden lg:flex items-center gap-1.5 text-xs club-muted text-slate-500 dark:text-slate-400 min-w-0 truncate">
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-mono tabular-nums shrink-0">
                  <Calendar className="w-3 h-3 shrink-0" />
                  {raceData.competition.date}
                </span>
                {raceData.competition.seriesName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{raceData.competition.seriesName}</span>
                  </>
                )}
                {raceData.competition.arenaInfo && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 club-accent-text shrink-0" />
                      <span className="truncate">{raceData.competition.arenaInfo}</span>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors shrink-0"
              aria-label="Växla tema"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onSwitchToSecretariat}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Wrench className="w-3.5 h-3.5 shrink-0" />
              <span>Sekretariat</span>
            </button>
          </div>
        </div>

        {raceData && (
          <div className="lg:hidden px-3 sm:px-6 pb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs club-muted text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <Calendar className="w-3 h-3 shrink-0" />
              {raceData.competition.date}
            </span>
            {raceData.competition.seriesName && (
              <>
                <span aria-hidden="true">·</span>
                <span>{raceData.competition.seriesName}</span>
              </>
            )}
            {raceData.competition.arenaInfo && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3 club-accent-text shrink-0" />
                  <span>{raceData.competition.arenaInfo}</span>
                </span>
              </>
            )}
          </div>
        )}

        {/* Navigation Tabs */}
        {raceData && (
          <div className="max-w-6xl mx-auto px-3 sm:px-6 flex flex-wrap items-center gap-x-1 border-t border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              onClick={() => setActiveTab('RESULTS')}
              className={`px-2.5 sm:px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'RESULTS'
                  ? 'club-accent-tab-active'
                  : 'border-transparent club-muted text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Resultat & Sträcktider
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('STARTLIST')}
              className={`px-2.5 sm:px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'STARTLIST'
                  ? 'club-accent-tab-active'
                  : 'border-transparent club-muted text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Startlista ({raceData.competitors.length})
            </button>

            {raceData.competition.allowSelfRegistration !== false &&
              raceData.competition.status !== 'COMPLETED' && (
              <button
                type="button"
                onClick={() => setActiveTab('SELF_REG')}
                className={`inline-flex items-center gap-1 px-2.5 sm:px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'SELF_REG'
                    ? 'club-accent-tab-active'
                    : 'border-transparent text-emerald-700 dark:text-emerald-400 hover:text-emerald-800'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span>Självregistrering</span>
              </button>
            )}
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-2.5 sm:p-4 space-y-3">
        {loading && !raceData ? (
          <div className="p-6 text-center text-xs text-slate-500">Hämtar tävlingsdata...</div>
        ) : error && !raceData ? (
          <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-red-600">
            {error}
          </div>
        ) : (
          raceData && (
            <>
              {/* Emergency Broken Control Notice for Spectators */}
              {raceData.emergency.brokenControls.length > 0 && (
                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                  <strong>Tävlingsinfo:</strong> Kontroll{' '}
                  {raceData.emergency.brokenControls.map((c) => `K${c}`).join(', ')} är ur
                  funktion och har undantagits.
                </div>
              )}

              {/* Results Grouping Bar */}
              {activeTab === 'RESULTS' && (
                <div className="flex items-center justify-end gap-2">
                  <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-xs">
                    <button
                      type="button"
                      onClick={() => setResultsGrouping('CLASS')}
                      className={`px-2.5 py-1 rounded whitespace-nowrap shrink-0 transition-colors ${
                        resultsGrouping === 'CLASS'
                          ? 'bg-white dark:bg-slate-950 font-medium text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Per klass
                    </button>
                    <button
                      type="button"
                      onClick={() => setResultsGrouping('CLUB')}
                      className={`px-2.5 py-1 rounded whitespace-nowrap shrink-0 transition-colors ${
                        resultsGrouping === 'CLUB'
                          ? 'bg-white dark:bg-slate-950 font-medium text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Per klubb
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 1: RESULTS & SPLITS */}
              {activeTab === 'RESULTS' &&
                (resultsGrouping === 'CLASS' ? (
                  <SplitsAnalysisTable
                    classes={raceData.classes}
                    courses={raceData.courses}
                    competitors={filteredCompetitors}
                    selectedClassId={selectedClassId}
                    onSelectClassId={setSelectedClassId}
                  />
                ) : (
                  <div className="space-y-2.5">
                    {uniqueClubs.map((clubName) => {
                      const clubRunners = filteredCompetitors.filter(
                        (c) => c.club === clubName
                      );
                      if (clubRunners.length === 0) return null;
                      return (
                        <section
                          key={clubName}
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
                        >
                          <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40">
                            <h3 className="text-xs font-semibold">{clubName}</h3>
                            <span className="text-[11px] font-mono tabular-nums text-slate-500">
                              {clubRunners.length} delt.
                            </span>
                          </div>
                          <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                            {clubRunners.map((r) => {
                              const cls = raceData.classes.find((c) => c.id === r.classId);
                              const isExpanded = inspectedRunner?.id === r.id;
                              const isRogaining = cls?.classFormat === 'ROGAINING';
                              return (
                                <div key={r.id}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setInspectedRunner((prev) =>
                                        prev?.id === r.id ? null : r
                                      )
                                    }
                                    className="w-full px-3.5 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs"
                                  >
                                    <div className="min-w-0 truncate">
                                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                                        {r.fullName}
                                      </span>
                                      <span className="text-slate-500 ml-1.5">
                                        {cls?.name ?? '-'} · #{r.bib}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                                      {isRogaining &&
                                        r.validation?.rogainingPoints !== undefined && (
                                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                            {r.validation.rogainingPoints} p
                                          </span>
                                        )}
                                      <span className="font-semibold">
                                        {formatDurationMmSs(r.runningTimeSec)}
                                      </span>
                                      <RunnerStatusIndicator status={r.status} compact />
                                    </div>
                                  </button>
                                  {isExpanded && (
                                    <div className="p-2.5 sm:p-3 bg-slate-50/70 dark:bg-slate-950/50 border-t border-slate-200/80 dark:border-slate-800/80">
                                      <RunnerSplitCardModal
                                        runner={r}
                                        compClass={cls ?? null}
                                        course={
                                          raceData.courses.find(
                                            (crs) =>
                                              crs.id ===
                                              (r.validation?.matchedCourseId ?? cls?.courseId)
                                          ) ?? null
                                        }
                                        classCompetitors={raceData.competitors.filter(
                                          (c) => c.classId === r.classId
                                        )}
                                        onClose={() => setInspectedRunner(null)}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                ))}

              {/* TAB 2: START LIST */}
              {activeTab === 'STARTLIST' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {raceData.classes.map((cls) => {
                    const inCls = raceData.competitors
                      .filter((c) => c.classId === cls.id)
                      .sort(
                        (a, b) =>
                          (a.allocatedStartSec ?? 999999) - (b.allocatedStartSec ?? 999999)
                      );
                    return (
                      <section
                        key={cls.id}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
                      >
                        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40">
                          <h3 className="text-xs font-semibold">{cls.name}</h3>
                          <span className="text-[11px] font-mono tabular-nums text-slate-500">
                            {inCls.length} anmälda
                          </span>
                        </div>
                        <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80 text-xs">
                          {inCls.map((r) => (
                            <div
                              key={r.id}
                              className="px-3.5 py-1.5 flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 w-14 shrink-0">
                                  {r.allocatedStartSec !== null
                                    ? formatSecondsAsClock(r.allocatedStartSec)
                                    : 'Fri'}
                                </span>
                                <div className="min-w-0 truncate">
                                  <span className="font-medium text-slate-900 dark:text-slate-100">
                                    {r.fullName}
                                  </span>
                                  <span className="text-[11px] text-slate-500 ml-1.5">
                                    #{r.bib} · {r.club}
                                  </span>
                                  {r.isSelfRegistered && (
                                    <span className="ml-1 text-[10px] text-sky-700 dark:text-sky-400">
                                      · självreg
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                                {formatSiNumber(r.siNumber)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}

              {/* TAB 4: MOBILE SELF-REGISTRATION WITH SWISH QR */}
              {activeTab === 'SELF_REG' && (
                <section className="max-w-xl mx-auto club-surface bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
                  <div>
                    <h2 className="text-base font-display font-bold">
                      Självregistrering på mobilen
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Ange SI-bricknummer. Finns du i löparregistret hämtas namn och klubb direkt.
                    </p>
                  </div>

                  {selfLookupMatch && !selfAlreadyEntered && (
                    <div className="px-3 py-2 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/60 rounded-lg flex items-center gap-2 text-xs text-sky-900 dark:text-sky-200">
                      <UserCheck className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
                      <span className="min-w-0 truncate">
                        Hittad: <strong>{selfLookupMatch.fullName}</strong> ({selfLookupMatch.club})
                      </span>
                    </div>
                  )}

                  {selfAlreadyEntered && (
                    <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                      SI-brickan är redan anmäld på <strong>{selfAlreadyEntered.fullName}</strong> (
                      #{selfAlreadyEntered.bib}).
                    </div>
                  )}

                  {selfNotice && (
                    <div
                      className={`px-3 py-2 text-xs font-medium rounded-lg border ${
                        selfNotice.ok
                          ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                          : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60'
                      }`}
                    >
                      {selfNotice.msg}
                    </div>
                  )}

                  <form onSubmit={handleSelfRegisterSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-medium mb-1">
                          SI-bricknummer
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={selfSiInput}
                          onChange={(e) => setSelfSiInput(e.target.value)}
                          placeholder="t.ex. 8540219"
                          className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1">Klass / bana</label>
                        <select
                          value={selfClassId || openDirectClasses[0]?.id || ''}
                          onChange={(e) => setSelfClassId(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        >
                          {openDirectClasses.map((cls) => (
                            <option key={cls.id} value={cls.id}>
                              {cls.name}
                              {feesEnabled ? ` (${cls.feeSek} kr)` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1">För- och efternamn</label>
                        <input
                          type="text"
                          value={selfFullName}
                          onChange={(e) => setSelfFullName(e.target.value)}
                          placeholder="Förnamn Efternamn"
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1">Klubb</label>
                        <input
                          type="text"
                          value={selfClub}
                          onChange={(e) => setSelfClub(e.target.value)}
                          placeholder="t.ex. OK Österåker"
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                        />
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={selfIsRental}
                        onChange={(e) => setSelfIsRental(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-red-600 shrink-0"
                      />
                      <span>
                        Jag har lånat hyrbricka vid start
                        {feesEnabled
                          ? ` (+${effectiveClubSettings?.rentalCardFeeSek ?? 30} kr)`
                          : ''}
                      </span>
                    </label>

                    {/* Swish Fee Breakdown & QR Box */}
                    {feesEnabled && totalSelfFeeSek > 0 && effectiveClubSettings?.swishNumber && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            Startavgift via Swish
                          </span>
                          <span className="font-mono tabular-nums font-bold text-sm text-slate-900 dark:text-slate-100">
                            {totalSelfFeeSek} kr
                          </span>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-3">
                          {swishQrSvg && (
                            <div
                              className="w-28 h-28 p-1.5 bg-white border border-slate-200 rounded-lg shrink-0"
                              dangerouslySetInnerHTML={{ __html: swishQrSvg }}
                            />
                          )}
                          <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400 w-full min-w-0">
                            <div className="truncate">
                              Mottagare:{' '}
                              <strong className="text-slate-900 dark:text-slate-100">
                                {effectiveClubSettings.swishRecipientName ||
                                  effectiveClubSettings.clubName}
                              </strong>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span>
                                Swish:{' '}
                                <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                                  {effectiveClubSettings.swishNumber}
                                </strong>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void copyText('swish', effectiveClubSettings.swishNumber)
                                }
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md whitespace-nowrap shrink-0"
                              >
                                {copiedKey === 'swish' ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>{copiedKey === 'swish' ? 'Kopierat' : 'Kopiera'}</span>
                              </button>
                            </div>
                            <div className="font-mono tabular-nums text-[11px]">
                              Klass {baseClassFeeSek} kr
                              {selfIsRental ? ` + Hyrbricka ${rentalExtraSek} kr` : ''}
                            </div>
                            {selfIsRental && (
                              <div className="text-[11px] text-amber-800 dark:text-amber-300">
                                Återlämna hyrbrickan i mål (saknad bricka:{' '}
                                {effectiveClubSettings.missingRentalFeeSek} kr).
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={selfBusy || Boolean(selfAlreadyEntered)}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold club-accent-btn disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>{selfBusy ? 'Registrerar...' : 'Registrera start på mobilen'}</span>
                    </button>
                  </form>
                </section>
              )}
            </>
          )
        )}
      </main>

      {/* Bottom Action & Share Footer */}
      <footer className="mt-6 club-surface bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 space-y-3">
          {qrModalOpen && (
            <section className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Share2 className="w-4 h-4 club-accent-text shrink-0" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    Dela publiksida, QR & Livelox
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setQrModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg shrink-0"
                  aria-label="Stäng"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-center">
                {qrSvgMarkup && (
                  <div className="md:col-span-4 flex flex-col items-center justify-center p-3 bg-white border border-slate-200 rounded-xl">
                    <div
                      className="w-32 h-32"
                      dangerouslySetInnerHTML={{ __html: qrSvgMarkup }}
                    />
                    <span className="mt-1.5 text-[11px] font-mono text-slate-600 text-center">
                      Skanna på TC för Liveresultat & Självreg
                    </span>
                  </div>
                )}

                <div className="md:col-span-8 space-y-2.5 text-xs min-w-0">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Publik kortlänk
                    </label>
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="text"
                        readOnly
                        value={publicEventUrl}
                        className="min-w-0 flex-1 px-2.5 py-1.5 font-mono text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => void copyText('pub', publicEventUrl)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg whitespace-nowrap shrink-0"
                      >
                        {copiedKey === 'pub' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedKey === 'pub' ? 'Kopierad' : 'Kopiera'}</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      IOF XML 3.0 Resultat-URL (Livelox / WinSplits)
                    </label>
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="text"
                        readOnly
                        value={iofResultsXmlUrl}
                        className="min-w-0 flex-1 px-2.5 py-1.5 font-mono text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => void copyText('iof', iofResultsXmlUrl)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg whitespace-nowrap shrink-0"
                      >
                        {copiedKey === 'iof' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedKey === 'iof' ? 'Kopierad' : 'Kopiera'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <PWAInstallButton />

              <button
                type="button"
                onClick={() => setQrModalOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium club-accent-btn rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {qrModalOpen ? <X className="w-3.5 h-3.5" /> : <QrCode className="w-3.5 h-3.5" />}
                <span>{qrModalOpen ? 'Dölj QR' : 'QR & Livelox'}</span>
              </button>
            </div>

            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              PasserSI · /t/{shortCode}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
