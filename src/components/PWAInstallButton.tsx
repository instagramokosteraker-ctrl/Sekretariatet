import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Installera</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <div className="inline-flex flex-col items-start">
        <button
          type="button"
          onClick={() => setShowIOSGuide((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{showIOSGuide ? 'Dölj tips' : 'Hemskärm'}</span>
        </button>

        {showIOSGuide && (
          <div className="mt-2 w-full max-w-xs rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Spara PasserSI i Safari
              </span>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Stäng tips"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="mt-1 leading-relaxed text-[11px] text-slate-600 dark:text-slate-400">
              Tryck på <strong>Dela</strong> i Safari och välj{' '}
              <strong>Lägg till på hemskärmen</strong> för helskärmsläge och offline-cache.
            </p>
          </div>
        )}
      </div>
    );
  }

  return null;
}
