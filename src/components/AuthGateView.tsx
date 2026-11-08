import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Eye,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import type { ClubSettings, EventLifecycleStatus } from '../types/sportident';
import { prewarmGooglePopupAuth } from '../firebase';
import {
  loginWithGoogleClient,
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

const DEFAULT_DEMO_COMPETITIONS: GateCompetitionItem[] = [];

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

  // Google sign-in state
  const [googleBusy, setGoogleBusy] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminErrorCode, setAdminErrorCode] = useState<string | null>(null);

  useEffect(() => {
    prewarmGooglePopupAuth();
  }, []);

  const selectedCompetition = compList[0] ?? null;

  const handleGoogleSignIn = async () => {
    setGoogleBusy(true);
    setAdminError(null);
    setAdminErrorCode(null);
    try {
      const result = await loginWithGoogleClient();
      if (!result.ok) {
        if (result.code) setAdminErrorCode(result.code);
        setAdminError(result.error);
        return;
      }
      onAuthenticated(result.session);
    } catch (err: unknown) {
      const code = extractFirebaseErrorCode(err);
      setAdminErrorCode(code || null);
      setAdminError(
        err instanceof Error ? err.message : 'Google-inloggningen misslyckades.'
      );
    } finally {
      setGoogleBusy(false);
    }
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
        <div className="w-full max-w-xl grid grid-cols-1 gap-5">

          {/* Google sign-in for assigned club roles */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col justify-between space-y-4 shadow-sm">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-slate-900 dark:text-slate-100 shrink-0" />
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Google-inloggning
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                  Tilldelad roll
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Logga in med Google-kontot som tilldelats en roll av klubbadministratören.
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
