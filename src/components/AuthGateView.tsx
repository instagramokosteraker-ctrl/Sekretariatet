import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Delete,
  ExternalLink,
  Eye,
  KeyRound,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  WifiOff,
} from 'lucide-react';
import type { ClubSettings, EventLifecycleStatus } from '../types/sportident';
import { prewarmGooglePopupAuth } from '../firebase';
import {
  loginWithGoogleClient,
  loginWithOfflineCodeClient,
  loginWithPinClient,
  type StoredAuthSession,
} from '../services/authClient';
import { applyClubThemeToDocument } from '../utils/clubTheme';

export interface GateCompetitionItem {
  id: string;
  shortCode: string;
  name: string;
  organizer: string;
  date: string;
  status: EventLifecycleStatus;
  pinsCustomized?: boolean;
  demoPinHints?: Record<string, string>;
}

interface AuthGateViewProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  preferredPublicShortCode?: string | null;
  competitions?: GateCompetitionItem[];
  clubSettings?: ClubSettings;
  onAuthenticated: (session: StoredAuthSession) => void;
  onOpenPublicPortal: (shortCode: string | null) => void;
}

function formatStatusText(status: EventLifecycleStatus): string {
  if (status === 'LIVE') return 'Pågår';
  if (status === 'UPCOMING') return 'Kommande';
  return 'Avslutad';
}

function extractFirebaseErrorCode(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const match = msg.match(/auth\/[a-z0-9\-]+/i);
  return match ? match[0].toLowerCase() : '';
}

const DEFAULT_DEMO_COMPETITIONS: GateCompetitionItem[] = [
  {
    id: 'evt-live',
    shortCode: 'oko26a',
    name: 'Höstsprinten & Natt-KM 2026',
    organizer: 'OK Österåker',
    date: '2026-11-02',
    status: 'LIVE',
    pinsCustomized: false,
    demoPinHints: { START: '1100', READOUT: '2200', FOREST: '3300', SPEAKER: '4400' },
  },
  {
    id: 'evt-upcoming',
    shortCode: 'oko26b',
    name: 'Torsdagsträning Lunsen — Nattintervaller',
    organizer: 'OK Österåker',
    date: '2026-11-05',
    status: 'UPCOMING',
    pinsCustomized: false,
    demoPinHints: { START: '1100', READOUT: '2200', FOREST: '3300', SPEAKER: '4400' },
  },
  {
    id: 'evt-completed',
    shortCode: 'oko26c',
    name: 'Klubbserien Etapp 1 — Nåsten',
    organizer: 'OK Österåker',
    date: '2026-10-21',
    status: 'COMPLETED',
    pinsCustomized: false,
    demoPinHints: { START: '1100', READOUT: '2200', FOREST: '3300', SPEAKER: '4400' },
  },
];

export function AuthGateView({
  darkMode,
  onToggleDarkMode,
  preferredPublicShortCode,
  competitions = DEFAULT_DEMO_COMPETITIONS,
  clubSettings,
  onAuthenticated,
  onOpenPublicPortal,
}: AuthGateViewProps) {
  const compList = competitions && competitions.length > 0 ? competitions : DEFAULT_DEMO_COMPETITIONS;
  const [selectedEventId, setSelectedEventId] = useState<string>(() => compList[0]?.id || 'evt-live');
  const [logoBroken, setLogoBroken] = useState<boolean>(false);

  useEffect(() => {
    setLogoBroken(false);
  }, [clubSettings?.logoDataUrl]);

  useEffect(() => {
    applyClubThemeToDocument(clubSettings, darkMode);
  }, [clubSettings, darkMode]);

  const isEmbeddedIframe = useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  const standaloneHref = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    return window.location.href;
  }, []);

  // Official PIN state
  const [pinValue, setPinValue] = useState<string>('');
  const [pinBusy, setPinBusy] = useState<boolean>(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Admin Google & Offline state
  const [googleBusy, setGoogleBusy] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminErrorCode, setAdminErrorCode] = useState<string | null>(null);
  const [offlineExpanded, setOfflineExpanded] = useState<boolean>(false);
  const [offlineCode, setOfflineCode] = useState<string>('');
  const [offlineBusy, setOfflineBusy] = useState<boolean>(false);

  useEffect(() => {
    prewarmGooglePopupAuth();
  }, []);

  const selectedCompetition = useMemo(() => {
    return (
      compList.find((c) => c.id === selectedEventId) ??
      compList[0] ??
      null
    );
  }, [compList, selectedEventId]);

  const submitPin = (codeToSubmit: string) => {
    const clean = codeToSubmit.replace(/\D/g, '');
    if (clean.length < 4) {
      setPinError('Ange din 4-siffriga funktionärs-PIN.');
      return;
    }
    const targetId = selectedCompetition?.id || selectedEventId;
    if (!targetId) {
      setPinError('Ingen tävling hittades.');
      return;
    }

    setPinBusy(true);
    setPinError(null);
    const result = loginWithPinClient({
      eventId: targetId,
      eventName: selectedCompetition?.name,
      pin: clean,
    });
    setPinBusy(false);

    if (result.ok === false) {
      setPinError(result.error);
      setPinValue('');
      return;
    }
    onAuthenticated(result.session);
  };

  const handleNumpadDigit = (digit: string) => {
    if (pinBusy) return;
    setPinError(null);
    const next = (pinValue + digit).replace(/\D/g, '').slice(0, 6);
    setPinValue(next);
    if (next.length === 4) {
      submitPin(next);
    }
  };

  const handleBackspace = () => {
    setPinError(null);
    setPinValue((prev) => prev.slice(0, -1));
  };

  const handleGoogleSignIn = async () => {
    setGoogleBusy(true);
    setAdminError(null);
    setAdminErrorCode(null);
    try {
      const result = await loginWithGoogleClient();
      if (!result.ok) {
        if (result.code) setAdminErrorCode(result.code);
        setAdminError(result.error);
        if (isEmbeddedIframe) setOfflineExpanded(true);
        return;
      }
      onAuthenticated(result.session);
    } catch (err: unknown) {
      const code = extractFirebaseErrorCode(err);
      setAdminErrorCode(code || null);
      setAdminError(
        err instanceof Error ? err.message : 'Google-inloggningen misslyckades. Använd reservkod nedan.'
      );
      setOfflineExpanded(true);
    } finally {
      setGoogleBusy(false);
    }
  };

  const submitOfflineCodeValue = (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) {
      setAdminError('Ange klubbens offline reservkod.');
      return;
    }
    setOfflineBusy(true);
    setAdminError(null);
    setAdminErrorCode(null);
    const res = loginWithOfflineCodeClient(clean);
    setOfflineBusy(false);
    if (res.ok === false) {
      setAdminError(res.error);
      return;
    }
    onAuthenticated(res.session);
  };

  const handleOfflineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitOfflineCodeValue(offlineCode);
  };

  return (
    <div className="min-h-screen overflow-x-clip flex flex-col club-canvas bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict Top Bar */}
      <header className="min-h-12 py-1.5 px-3 sm:px-6 lg:px-8 club-surface bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {clubSettings?.logoDataUrl && !logoBroken ? (
            <img
              src={clubSettings.logoDataUrl}
              alt={`${clubSettings.clubName || 'Klubb'} logotyp`}
              referrerPolicy="no-referrer"
              onError={() => setLogoBroken(true)}
              className="h-7 w-auto max-w-[120px] object-contain shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-lg club-accent-bg flex items-center justify-center text-white font-bold text-xs shrink-0">
              OK
            </div>
          )}
          <span className="text-sm sm:text-base font-display font-bold tracking-tight truncate">
            {clubSettings?.portalTitle?.trim() || `${clubSettings?.clubName || 'OK Österåker'} — Sekretariat`}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenPublicPortal(preferredPublicShortCode || selectedCompetition?.shortCode || null)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Publiksida & Resultat</span>
            <span className="sm:hidden">Publik</span>
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-800"
            aria-label="Växla mörkt läge"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Card 1: Funktionärs-PIN */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Funktionärs-PIN
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Station
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Logga in på en station (Start, Mål, Skog eller Speaker) med din 4-siffriga PIN.
              </p>

              {/* Event selector */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Välj tävling:
                </label>
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  {compList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.date})
                    </option>
                  ))}
                </select>
              </div>

              {/* PIN input display */}
              <div className="pt-2">
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((idx) => {
                    const digit = pinValue[idx];
                    return (
                      <div
                        key={idx}
                        className={`w-11 h-12 rounded-xl border-2 flex items-center justify-center text-lg font-mono font-bold transition-all ${
                          digit
                            ? 'border-red-600 dark:border-red-500 text-slate-900 dark:text-slate-100 bg-red-50/20 dark:bg-red-950/20'
                            : 'border-slate-200 dark:border-slate-800 text-slate-400 bg-slate-50/50 dark:bg-slate-950/50'
                        }`}
                      >
                        {digit ? '•' : ''}
                      </div>
                    );
                  })}
                </div>

                {pinError && (
                  <p className="text-xs text-red-600 dark:text-red-400 text-center font-medium mt-2">
                    {pinError}
                  </p>
                )}
              </div>

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto pt-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => handleNumpadDigit(digit)}
                    className="h-11 rounded-xl text-base font-semibold bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPinValue('')}
                  className="h-11 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Rensa
                </button>
                <button
                  type="button"
                  onClick={() => handleNumpadDigit('0')}
                  className="h-11 rounded-xl text-base font-semibold bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleBackspace}
                  className="h-11 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Radera siffra"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-slate-400 text-center border-t border-slate-100 dark:border-slate-800">
              Standard-PIN: Start 1100 · Mål 2200 · Skog 3300 · Speaker 4400
            </div>
          </div>

          {/* Card 2: Administratör (Google & Offline reservkod) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-slate-900 dark:text-slate-100 shrink-0" />
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Administratör & Tävlingsledare
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                  Full behörighet
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Logga in med klubbens administratörskonto via Google för full behörighet till alla funktioner.
              </p>

              {/* Google Sign In Button */}
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  disabled={googleBusy}
                  onClick={() => void handleGoogleSignIn()}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-xl transition-all shadow-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>{googleBusy ? 'Loggar in...' : 'Logga in med Google'}</span>
                </button>

                {adminError && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-700 dark:text-red-300">
                    <p className="font-semibold">{adminError}</p>
                    {isEmbeddedIframe && (
                      <a
                        href={standaloneHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-red-700 dark:text-red-400 underline mt-1.5"
                      >
                        <span>Öppna i egen webbläsarflik</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Offline reservkod collapsible */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setOfflineExpanded((v) => !v)}
                  className="w-full flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 py-1"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Offline reservkod (skogsbruk utan nät)</span>
                  </span>
                  {offlineExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {offlineExpanded && (
                  <form onSubmit={handleOfflineSubmit} className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="Ange reservkod (okosteraker2026)"
                        value={offlineCode}
                        onChange={(e) => setOfflineCode(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={offlineBusy || !offlineCode}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                      >
                        {offlineBusy ? '...' : 'Öppna'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-400 text-center">
              Huvudkonto: <span className="font-mono text-slate-600 dark:text-slate-300">instagram.okosteraker@gmail.com</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
