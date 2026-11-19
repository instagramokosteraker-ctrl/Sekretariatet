import { ChevronRight } from 'lucide-react';
import type { ReadoutHistoryRecord } from '../services/readoutHistoryStore';
import { formatSiNumber } from '../services/sportidentProtocol';
import {
  getReadoutDeliveryLabel,
  getReadoutStatusPresentation,
  getReadoutStatusText,
} from '../utils/readoutStatusPresentation';

interface ReadoutHistoryRowProps {
  record: ReadoutHistoryRecord;
  isSelected: boolean;
  onSelect: (record: ReadoutHistoryRecord, forceOpen?: boolean) => void;
}

export function ReadoutHistoryRow({
  record,
  isSelected,
  onSelect,
}: ReadoutHistoryRowProps) {
  const status = getReadoutStatusPresentation(record);
  const statusText = getReadoutStatusText(record);
  const canRegisterUnknownCard =
    record.issueType === 'UNKNOWN_CARD' &&
    record.issueState !== 'RESOLVED' &&
    record.issueState !== 'DISMISSED';

  return (
    <li className={status.surfaceClass}>
      <div className="flex items-stretch">
        <button
          type="button"
          aria-label={`Öppna avläsning nr ${record.captureSequence}: ${
            record.competitorName ?? 'SI-bricka'
          }, SI ${formatSiNumber(record.readout.siNumber)}`}
          aria-pressed={isSelected}
          onClick={() => onSelect(record)}
          className={`group flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-black/[0.04] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-sky-600 dark:hover:bg-white/[0.06] ${
            isSelected ? 'ring-2 ring-inset ring-sky-600 dark:ring-sky-400' : ''
          }`}
        >
          <span className="min-w-0 truncate text-xs font-medium text-slate-800 dark:text-slate-200">
            Avläsning nr {record.captureSequence} ·{' '}
            {record.competitorName ?? 'SI-bricka'} · SI{' '}
            {formatSiNumber(record.readout.siNumber)}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>
              {statusText} · {getReadoutDeliveryLabel(record.deliveryState)}
            </span>
            <ChevronRight
              aria-hidden="true"
              className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 dark:text-slate-400"
            />
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
      </div>
    </li>
  );
}
