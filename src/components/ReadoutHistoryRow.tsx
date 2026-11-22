import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  isEligibleWrongCompetitorReadout,
  type ReadoutHistoryRecord,
} from '../services/readoutHistoryStore';
import {
  formatDurationMmSs,
  formatSecondsAsClock,
  formatSiNumber,
} from '../services/sportidentProtocol';
import {
  getReadoutDeliveryBadgeClass,
  getReadoutDeliveryLabel,
  getReadoutIssueBadgeClass,
  getReadoutIssueLabel,
  getReadoutIssueStateLabel,
  getReadoutStatusPresentation,
  getReadoutStatusText,
} from '../utils/readoutStatusPresentation';

interface ReadoutHistoryRowProps {
  record: ReadoutHistoryRecord;
  isLatest: boolean;
  isExpanded: boolean;
  placementLabel: string;
  onSelect: (record: ReadoutHistoryRecord, forceOpen?: boolean) => void;
  children?: ReactNode;
}

export function ReadoutHistoryRow({
  record,
  isLatest,
  isExpanded,
  placementLabel,
  onSelect,
  children,
}: ReadoutHistoryRowProps) {
  const status = getReadoutStatusPresentation(record);
  const statusText = getReadoutStatusText(record);
  const issueLabel = getReadoutIssueLabel(record.issueType);
  const issueStateLabel = getReadoutIssueStateLabel(record.issueState);
  const runnerName =
    record.competitorName ?? record.suggestedRunner?.fullName ?? 'Okänd bricka';
  const finishTime = formatSecondsAsClock(record.readout.finishTimeSec);
  const runningTime = record.competitorSnapshot?.runningTimeSec;
  const bomSec = record.competitorSnapshot?.validation?.totalTimeLossSec;
  const canRegisterUnknownCard =
    record.issueType === 'UNKNOWN_CARD' &&
    record.issueState !== 'RESOLVED' &&
    record.issueState !== 'DISMISSED';
  const canCorrectCompetitor = isEligibleWrongCompetitorReadout(record);

  return (
    <li
      className={status.surfaceClass}
      data-readout-id={record.clientReadoutId}
      data-expanded={isExpanded}
    >
      <div className="flex min-w-0 items-stretch">
        <button
          type="button"
          data-readout-history-primary="true"
          aria-keyshortcuts="ArrowDown ArrowUp Enter"
          aria-expanded={isExpanded}
          aria-controls={`readout-details-${record.clientReadoutId}`}
          aria-label={`Öppna avläsning nr ${record.captureSequence}: ${
            runnerName
          }, SI ${formatSiNumber(record.readout.siNumber)}`}
          onClick={() => onSelect(record)}
          className={`group flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.04] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-sky-600 dark:hover:bg-white/[0.06] ${
            isExpanded ? 'ring-2 ring-inset ring-sky-600 dark:ring-sky-400' : ''
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Avläsning #{record.captureSequence}
              </span>
              {isLatest && (
                <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
                  Senaste
                </span>
              )}
              <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                {runnerName} · SI {formatSiNumber(record.readout.siNumber)}
              </span>
            </span>
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
              <span>Klass: {record.className ?? '—'}</span>
              <span>Mål: {finishTime}</span>
              {runningTime != null && (
                <span>Löptid: {formatDurationMmSs(runningTime)}</span>
              )}
              <span>Placering: {placementLabel}</span>
              <span>
                Bom: {bomSec == null ? '—' : formatDurationMmSs(bomSec)}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-[10px]">
            <span className="rounded-full bg-white/70 px-2 py-1 font-semibold text-slate-900 dark:bg-slate-950/50 dark:text-slate-100">
              {statusText}
            </span>
            {(issueLabel || issueStateLabel) && (
              <span
                className={`rounded-full px-2 py-1 font-semibold ${getReadoutIssueBadgeClass(record)}`}
              >
                {issueLabel ?? issueStateLabel}
              </span>
            )}
            {issueLabel && issueStateLabel && (
              <span
                className={`rounded-full px-2 py-1 font-semibold ${getReadoutIssueBadgeClass(record)}`}
              >
                {issueStateLabel}
              </span>
            )}
            <span
              className={`rounded-full px-2 py-1 font-semibold ${getReadoutDeliveryBadgeClass(record.deliveryState)}`}
            >
              {getReadoutDeliveryLabel(record.deliveryState)}
            </span>
            {isExpanded ? (
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            ) : (
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 dark:text-slate-400"
              />
            )}
          </span>
        </button>
        {canRegisterUnknownCard && (
          <button
            type="button"
            onClick={() => onSelect(record, true)}
            className="shrink-0 cursor-pointer px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40 dark:focus-visible:outline-amber-300"
          >
            Anmäl
          </button>
        )}
        {canCorrectCompetitor && (
          <button
            type="button"
            aria-label={`Korrigera löpare för avläsning nr ${record.captureSequence}`}
            onClick={() => onSelect(record, true)}
            className="shrink-0 cursor-pointer px-3 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40 dark:focus-visible:outline-amber-300"
          >
            Fel löpare
          </button>
        )}
      </div>
      {isExpanded && (
        <div
          id={`readout-details-${record.clientReadoutId}`}
          className="border-t border-slate-200 dark:border-slate-800"
        >
          {children}
        </div>
      )}
    </li>
  );
}
