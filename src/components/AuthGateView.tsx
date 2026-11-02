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
import type { AuthPublicInfoPayload, EventLifecycleStatus } from '../types/sportident';
import {
  ensureAdminRoleInFirestore,
  prewarmGooglePopupAuth,
  signInWithGooglePopup,
} from '../firebase';
import {
  fetchAuthPublicInfo,
  loginWithGoogleTokenOnServer,
  loginWithOfflineCodeOnServer,
  loginWithPinOnServer,
  type StoredAuthSession,
} from '../services/authClient';
import { applyClubThemeToDocument } from '../utils/clubTheme';

interface AuthGateViewProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  preferredPublicShortCode?: string | null;
  onAuthenticated: (session: StoredAuthSession) => void;
  onOpenPublicPortal: (shortCode: string | null) => void;
}

function formatStatusText(status: EventLifecycleStatus): string {
  if (status === 'LIVE') return 'Pågår';
  if (status === 'UPCOMING') return 'Kommande';
  return 'Avslutad';
}

function extractFirebaseErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const match = msg.match(/auth\/[a-z0-9\-]+/i);
  return match ? match[0].toLowerCase() : '';
}

export function AuthGateView({
  darkMode,
  onToggleDarkMode,
  preferredPublicShortCode,
  onAuthenticated,
  onOpenPublicPortal,
}: AuthGateViewProps) {
  const [publicInfo, setPublicInfo] = useState<AuthPublicInfoPayload | null>(null);
  const [loadingInfo, setLoadingInfo] = useState<boolean>(true);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [userChangedEvent, setUserChangedEvent] = useState<boolean>(false);
  const [logoBroken, setLogoBroken] = useState<boolean>(false);

  useEffect(() => {
    setLogoBroken(false);
  }, [publicInfo?.clubSettings?.logoDataUrl]);

  useEffect(() => {
    applyClubThemeToDocument(publicInfo?.clubSettings, darkMode);
  }, [publicInfo?.clubSettings, darkMode]);

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
    let active = true;
    fetchAuthPublicInfo()
      .then((info) => {
        if (!active) return;
        setPublicInfo(info);
        if (info) {
          setSelectedEventId(info.activeEventId || info.competitions[0]?.id || '');
        }
      })
      .finally(() => {
        if (active) setLoadingInfo(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedCompetition = useMemo(() => {
    if (!publicInfo) return null;
    return (
      publicInfo.competitions.find((c) => c.id === selectedEventId) ??
      publicInfo.competitions[0] ??
      null
    );
  }, [publicInfo, selectedEventId]);

  const submitPin = async (codeToSubmit: string) => {
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
    const result = await loginWithPinOnServer({
      eventId: targetId,
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
      void submitPin(next);
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
      const { user, idToken } = await signInWithGooglePopup();
      let claimedRole: 'SUPER_ADMIN' | 'RACE_ADMIN' | null = null;
      if (user) {
        try {
          const claimRes = await ensureAdminRoleInFirestore(user);
          claimedRole = claimRes.role;
        } catch {
          // Server still verifies Google token authoritatively
        }
      }
      const serverRes = await loginWithGoogleTokenOnServer({
        idToken,
        firestoreClaimedRole: claimedRole,
      });
      if (serverRes.ok === false) {
        setAdminError(serverRes.error);
        return;
      }
      onAuthenticated(serverRes.session);
    } catch (err: unknown) {
      const code = extractFirebaseErrorCode(err);
      setAdminErrorCode(code || null);
      const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAdminError(
          isEmbeddedIframe
            ? 'Google-fönstret kunde inte slutföras inuti förhandsgranskningsramen. Öppna appen i en egen webbläsarflik eller använd reservkoden nedan.'
            : 'Google-inloggningen stängdes innan den slutfördes. Klicka igen och välj ditt Google-konto.'
        );
        if (isEmbeddedIframe) setOfflineExpanded(true);
      } else if (code === 'auth/popup-blocked') {
        setAdminError(
          isEmbeddedIframe
            ? 'Webbläsaren blockerade inloggningsfönstret inuti förhandsgranskningen. Öppna sekretariatet i en egen webbläsarflik eller använd reservkoden nedan.'
            : 'Webbläsaren blockerade Google-fönstret. Tillåt popup-fönster för den här sidan i adressfältet och klicka igen.'
        );
        setOfflineExpanded(true);
      } else if (code === 'auth/web-storage-unsupported' || code === 'auth/cors-unsupported') {
        setAdminError(
          isEmbeddedIframe
            ? 'Tredjepartslagring är isolerad inuti förhandsgranskningsramen. Öppna sekretariatet i en egen webbläsarflik för Google-inloggning, eller använd reservkoden nedan.'
            : 'Webbläsaren blockerar tredjepartslagring (t.ex. inkognitoläge, Safari ITP eller Brave Shield). Tillåt kakor/lagring för Google-inloggning eller använd reservkoden nedan.'
        );
        setOfflineExpanded(true);
      } else if (code === 'auth/unauthorized-domain') {
        setAdminError(
          `Domänen (${hostname}) saknas under Authorized domains i Firebase Authentication. Lägg till den där eller använd reservkoden nedan.`
        );
        setOfflineExpanded(true);
      } else if (code.includes('token-service-api')) {
        setAdminErrorCode('auth/token-service-api-disabled');
        setAdminError(
          'Google Cloud-projektets Token Service API (securetoken.googleapis.com) är inte aktiverat ännu för automatisk tokenförnyelse.'
        );
        setOfflineExpanded(true);
      } else if (code === 'auth/network-request-failed') {
        setAdminError(
          'Ingen internetanslutning för Google-inloggning. Använd klubbens offline reservkod nedan.'
        );
        setOfflineExpanded(true);
      } else {
        setAdminErrorCode(code ? code.slice(0, 64) : null);
        setAdminError(
          isEmbeddedIframe
            ? 'Google-inloggning blockerades av förhandsgranskningsramen. Öppna sekretariatet i en egen webbläsarflik eller använd reservkoden nedan.'
            : 'Kunde inte slutföra Google-inloggningen i den här webbläsarvy. Öppna i egen flik eller använd reservkoden nedan.'
        );
        setOfflineExpanded(true);
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const submitOfflineCodeValue = async (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) {
      setAdminError('Ange klubbens offline reservkod.');
      return;
    }
    setOfflineBusy(true);
    setAdminError(null);
    setAdminErrorCode(null);
    const res = await loginWithOfflineCodeOnServer(clean);
    setOfflineBusy(false);
    if (res.ok === false) {
      setAdminError(res.error);
      return;
    }
    onAuthenticated(res.session);
  };

  const handleOfflineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitOfflineCodeValue(offlineCode);
  };

  return (
    <div className="min-h-screen overflow-x-clip flex flex-col club-canvas bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict Top Bar Contract: Brand Left — General Actions Right */}
      <header className="min-h-12 py-1.5 px-3 sm:px-6 lg:px-8 club-surface bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <a
          href="/"
          onClick={(e) => e.preventDefault()}
          className="inline-flex items-center gap-2.5 text-sm sm:text-base font-display font-bold tracking-tight min-w-0"
        >
          {publicInfo?.clubSettings?.logoDataUrl && !logoBroken && (
            <img
              src={publicInfo.clubSettings.logoDataUrl}
              alt={`${publicInfo.clubSettings.clubName || 'Klubb'} logotyp`}
              referrerPolicy="no-referrer"
              onError={() => setLogoBroken(true)}
              className="h-7 w-auto max-w-[100px] sm:max-w-[120px] object-contain shrink-0"
            />
          )}
          <span className="truncate">
            {publicInfo?.clubSettings?.portalTitle?.trim() || 'PasserSI'}
          </span>
        </a>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenPublicPortal(null)}
            className="hidden sm:inline-flex px-2 py-1 text-xs font-medium club-muted text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Säsongsöversikt
          </button>

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
            onClick={() =>
              onOpenPublicPortal(
                !userChangedEvent && preferredPublicShortCode !== undefined
                  ? preferredPublicShortCode
                  : (selectedCompetition?.shortCode ?? null)
              )
            }
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Eye className="w-3.5 h-3.5 shrink-0" />
            <span>Publik vy</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="max-w-2xl mb-4">
          <p className="text-xs font-medium club-muted text-slate-500 dark:text-slate-400">
            {publicInfo?.clubSettings?.clubName
              ? `${publicInfo.clubSettings.clubName} · Sekretariat & Funktionärsinloggning`
              : 'Sekretariat & Funktionärsinloggning · SPORTident tidtagning'}
          </p>
          <h1 className="mt-0.5 text-xl sm:text-2xl font-display font-bold tracking-tight [text-wrap:balance]">
            Öppna sekretariatet eller funktionärsstation
          </h1>
          <p className="mt-1 text-xs sm:text-sm club-muted text-slate-600 dark:text-slate-400">
            Funktionärer loggar in direkt med tävlingens 4-siffriga PIN-kod. Tävlingsledare loggar
            in med Google-konto.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          {/* Column 1: Official 4-digit PIN Login */}
          <section className="min-w-0 club-surface bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                  Funktionär på tävlingsdagen
                </h2>
                <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                För lånedatorer och surfplattor vid startfålla, målavläsning, skogssäkerhet eller
                speaker.
              </p>

              <div className="mt-3">
                <label
                  htmlFor="pin-competition-select"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Tävling eller träning
                </label>
                {loadingInfo ? (
                  <div className="h-9 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                ) : (
                  <select
                    id="pin-competition-select"
                    value={selectedCompetition?.id || ''}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setUserChangedEvent(true);
                      setPinError(null);
                    }}
                    className="w-full px-3 py-1.5 text-xs sm:text-sm font-medium bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {(publicInfo?.competitions ?? []).map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({formatStatusText(ev.status)} · {ev.date})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitPin(pinValue);
                }}
                className="mt-3 space-y-2.5"
              >
                <div>
                  <label
                    htmlFor="official-pin-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    4-siffrig funktionärs-PIN
                  </label>
                  <input
                    id="official-pin-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={pinValue}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setPinValue(clean);
                      setPinError(null);
                    }}
                    placeholder="••••"
                    className="w-full px-3 py-2 text-center text-xl font-mono tabular-nums tracking-[0.35em] bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>

                {pinError && (
                  <div className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg">
                    {pinError}
                  </div>
                )}

                {/* Touch-friendly keypad for iPad/field tablets */}
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Sifferknappsats">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handleNumpadDigit(digit)}
                      className="min-h-[40px] text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setPinValue('');
                      setPinError(null);
                    }}
                    className="min-h-[40px] text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Rensa
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumpadDigit('0')}
                    className="min-h-[40px] text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleBackspace}
                    aria-label="Sudda sista siffran"
                    className="min-h-[40px] inline-flex items-center justify-center text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                  >
                    <Delete className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={pinBusy || pinValue.length < 4}
                  className="w-full min-h-[40px] px-4 py-2 text-xs sm:text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  {pinBusy ? 'Kontrollerar PIN...' : 'Öppna funktionärsvy'}
                </button>
              </form>
            </div>

            {selectedCompetition?.demoPinHints && !selectedCompetition.pinsCustomized && (
              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <div className="font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Förvalda standardkoder (tills tävlingsledaren byter dem):
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
                  <button
                    type="button"
                    onClick={() => void submitPin(selectedCompetition.demoPinHints!.START)}
                    className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline"
                  >
                    Startfålla {selectedCompetition.demoPinHints.START}
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => void submitPin(selectedCompetition.demoPinHints!.READOUT)}
                    className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline"
                  >
                    Mål {selectedCompetition.demoPinHints.READOUT}
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => void submitPin(selectedCompetition.demoPinHints!.FOREST)}
                    className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline"
                  >
                    Skogssäkerhet {selectedCompetition.demoPinHints.FOREST}
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => void submitPin(selectedCompetition.demoPinHints!.SPEAKER)}
                    className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline"
                  >
                    Speaker {selectedCompetition.demoPinHints.SPEAKER}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Column 2: Race Director / Club Admin (Google Auth + Offline Code) */}
          <section className="min-w-0 club-surface bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between">
            <div className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-display font-bold text-slate-900 dark:text-slate-100">
                    Tävlingsledare & Klubbadmin
                  </h2>
                  <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  Full behörighet att skapa tävlingar, ladda upp banor, synka Eventor, hantera
                  säkerhetskopior och ställa in funktionärernas PIN-koder.
                </p>
              </div>

              {adminError && (
                <div className="px-3 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg space-y-1.5 overflow-hidden">
                  <div className="font-medium leading-snug break-words">{adminError}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-red-600/90 dark:text-red-300/80 min-w-0">
                    {adminErrorCode && (
                      <span className="font-mono tabular-nums break-all">
                        Kod: {adminErrorCode}
                      </span>
                    )}
                    {adminErrorCode === 'auth/token-service-api-disabled' ? (
                      <a
                        href="https://console.developers.google.com/apis/api/securetoken.googleapis.com/overview?project=671017021565"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-red-800 dark:hover:text-red-100 break-words"
                      >
                        <span>Aktivera Token Service API i Google Cloud</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <a
                        href={standaloneHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-red-800 dark:hover:text-red-100"
                      >
                        <span>Öppna i egen webbläsarflik</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => void handleGoogleSignIn()}
                  disabled={googleBusy}
                  className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>{googleBusy ? 'Verifierar Google-konto...' : 'Logga in med Google'}</span>
                </button>

                {isEmbeddedIframe && (
                  <div className="pt-1 space-y-2">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Du kör appen i en förhandsgranskningsram där Google-popup ibland isoleras.
                      Öppna i egen flik eller använd reservkoden:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={standaloneHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <span>Öppna i egen webbläsarflik</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                      {publicInfo?.demoOfflineCodeHint && !publicInfo.offlineCodeCustomized && (
                        <button
                          type="button"
                          disabled={offlineBusy}
                          onClick={() =>
                            void submitOfflineCodeValue(publicInfo.demoOfflineCodeHint!)
                          }
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          <span>Öppna med reservkod</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Verifieras mot Firebase Authentication och klubbens behörighetslista i Firestore.
                </p>
              </div>

              {publicInfo?.offlineCodeEnabled !== false && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setOfflineExpanded((v) => !v);
                      setAdminError(null);
                      setAdminErrorCode(null);
                    }}
                    className="w-full flex items-center justify-between gap-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 py-0.5"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <WifiOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">Saknar mobiltäckning? Använd offline reservkod</span>
                    </span>
                    {offlineExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                  </button>

                  {offlineExpanded && (
                    <form onSubmit={handleOfflineSubmit} className="mt-2.5 space-y-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Lås upp sekretariatet utan internet med klubbens lokala reservkod.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="password"
                          value={offlineCode}
                          onChange={(e) => {
                            setOfflineCode(e.target.value);
                            setAdminError(null);
                            setAdminErrorCode(null);
                          }}
                          placeholder="Ange offline reservkod"
                          className="flex-1 min-w-0 px-3 py-1.5 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="submit"
                          disabled={offlineBusy || !offlineCode.trim()}
                          className="px-3.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          {offlineBusy ? 'Kontrollerar...' : 'Lås upp offline'}
                        </button>
                      </div>
                      {publicInfo?.demoOfflineCodeHint && !publicInfo.offlineCodeCustomized && (
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          <span>Förvald reservkod: </span>
                          <button
                            type="button"
                            onClick={() =>
                              void submitOfflineCodeValue(publicInfo.demoOfflineCodeHint!)
                            }
                            className="font-semibold text-slate-700 dark:text-slate-200 hover:underline"
                          >
                            {publicInfo.demoOfflineCodeHint}
                          </button>
                        </div>
                      )}
                    </form>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Löpare och publik behöver aldrig logga in för att se resultat eller registrera
                SI-bricka.
              </div>
              <button
                type="button"
                onClick={() =>
                  onOpenPublicPortal(selectedCompetition?.shortCode ?? null)
                }
                className="inline-flex items-center gap-1.5 text-xs font-semibold club-accent-text hover:underline whitespace-nowrap"
              >
                <span>Gå till öppen publikvy & liveresultat</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
