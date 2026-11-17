import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Compass,
  Flag,
  UserCheck,
  X,
} from 'lucide-react';
import type { RunnerStatus, StationFunction } from '../types/sportident';

export function RunnerStatusIndicator({
  status,
  compact = false,
  minimal = false,
}: {
  status: RunnerStatus;
  compact?: boolean;
  minimal?: boolean;
}) {
  const iconOnly = compact || minimal;
  const iconClassName = `${minimal ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0`;
  const textClassName = minimal ? 'text-[10px]' : 'text-xs';

  switch (status) {
    case 'OK':
      return (
        <span
          title="Godkänd (OK)"
          role="img"
          aria-label="Godkänd (OK)"
          className={`inline-flex items-center gap-1 ${textClassName} font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap`}
        >
          <CheckCircle2 className={iconClassName} />
          {!iconOnly && <span>Godkänd</span>}
        </span>
      );
    case 'MP':
      return (
        <span
          title="Felstämplat (MP)"
          role="img"
          aria-label="Felstämplat (MP)"
          className={`inline-flex items-center gap-1 ${textClassName} font-semibold text-red-700 dark:text-red-400 whitespace-nowrap`}
        >
          <AlertTriangle className={iconClassName} />
          {!iconOnly && <span>Felst.</span>}
        </span>
      );
    case 'PRELIMINARY_FIN':
      return (
        <span
          title="Preliminär målgång"
          role="img"
          aria-label="Preliminär målgång"
          className={`inline-flex items-center gap-1 ${textClassName} font-medium text-sky-700 dark:text-sky-400 whitespace-nowrap`}
        >
          <Flag className={iconClassName} />
          {!iconOnly && <span>Prel. mål</span>}
        </span>
      );
    case 'IN_FOREST':
      return (
        <span
          title="Kvar i skogen"
          role="img"
          aria-label="Kvar i skogen"
          className={`inline-flex items-center gap-1 ${textClassName} font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap`}
        >
          <Compass className={iconClassName} />
          {!iconOnly && <span>I skogen</span>}
        </span>
      );
    case 'CHECKED':
      return (
        <span
          title="Checkad i startfålla"
          role="img"
          aria-label="Checkad i startfålla"
          className={`inline-flex items-center gap-1 ${textClassName} font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap`}
        >
          <UserCheck className={iconClassName} />
          {!iconOnly && <span>Checkad</span>}
        </span>
      );
    case 'REGISTERED':
      return (
        <span
          title="Start ännu inte registrerad – väntar på start"
          role="img"
          aria-label="Start ännu inte registrerad – väntar på start"
          className={`inline-flex items-center gap-1 ${textClassName} text-slate-600 dark:text-slate-400 whitespace-nowrap`}
        >
          <Clock className={iconClassName} />
          {!iconOnly && <span>Anmäld – ej startat</span>}
        </span>
      );
    case 'DNF':
      return (
        <span
          title="Avbröt ett påbörjat lopp (DNF)"
          role="img"
          aria-label="Avbröt ett påbörjat lopp (DNF)"
          className={`inline-flex items-center gap-1 ${textClassName} font-medium text-red-700 dark:text-red-400 whitespace-nowrap`}
        >
          <X className={iconClassName} />
          {!iconOnly && <span>DNF – bröt loppet</span>}
        </span>
      );
    case 'DNS':
      return (
        <span
          title="Starten blev inte av (DNS)"
          role="img"
          aria-label="Starten blev inte av (DNS)"
          className={`inline-flex items-center gap-1 ${textClassName} text-slate-500 dark:text-slate-500 whitespace-nowrap`}
        >
          <CircleSlash className={iconClassName} />
          {!iconOnly && <span>DNS – startade aldrig</span>}
        </span>
      );
  }
}

export function formatStationFunctionLabel(fn: StationFunction): string {
  switch (fn) {
    case 'CLEAR':
      return 'Töm (Clear)';
    case 'CHECK':
      return 'Check (Startfålla)';
    case 'START':
      return 'Startpunkt';
    case 'RADIO':
      return 'Radiokontroll (Mellantid)';
    case 'PREWARNING':
      return 'Förvarning (Upplopp)';
    case 'FINISH':
      return 'Målstämpling';
    case 'READOUT':
      return 'Målavläsning (Hela brickan)';
  }
}
