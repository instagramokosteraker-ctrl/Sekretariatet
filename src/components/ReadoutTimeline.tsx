import React, { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { ReadoutHistoryRecord } from '../services/readoutHistoryStore';
import { getReadoutDeliveryLabel, getReadoutIssueLabel, getReadoutIssueStateLabel } from '../utils/readoutStatusPresentation';
import { getReadoutHistoryNavigationIndex } from '../utils/readoutHistoryKeyboard';
import { getReadoutHistoryPage } from '../utils/readoutHistoryPaging';
import {
  getReadoutTimelineItems,
  type ReadoutTimelineFilter,
} from '../utils/readoutTimeline';
import { ReadoutHistoryRow } from './ReadoutHistoryRow';

interface ReadoutTimelineProps {
  records: ReadoutHistoryRecord[];
  latestReadoutId: string | null;
  expandedReadoutId: string | null;
  historyError: string | null;
  onToggleReadout: (record: ReadoutHistoryRecord, forceOpen?: boolean) => void;
  getPlacementLabel: (record: ReadoutHistoryRecord) => string;
  children?: React.ReactNode;
}

const filters: Array<{ value: ReadoutTimelineFilter; label: string }> = [
  { value: 'ALL', label: 'Alla' },
  { value: 'ACTION_REQUIRED', label: 'Kräver åtgärd' },
  { value: 'OK', label: 'OK' },
  { value: 'MP', label: 'MP' },
  { value: 'UNKNOWN_CARD', label: 'Okänd bricka' },
  { value: 'DUPLICATE_READOUT', label: 'Redan avläst' },
];

export function ReadoutTimeline({
  records,
  latestReadoutId,
  expandedReadoutId,
  historyError,
  onToggleReadout,
  getPlacementLabel,
  children,
}: ReadoutTimelineProps) {
  const [filter, setFilter] = useState<ReadoutTimelineFilter>('ALL');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState<20 | 30 | 50>(30);
  const [page, setPage] = useState(0);
  const rowsRef = useRef<HTMLOListElement | null>(null);

  const timelineItems = useMemo(
    () => getReadoutTimelineItems(records, latestReadoutId, expandedReadoutId, filter),
    [records, latestReadoutId, expandedReadoutId, filter]
  );
  const query = search.trim().toLocaleLowerCase();
  const searchedItems = useMemo(
    () =>
      query
        ? timelineItems.filter(({ record }) =>
            [
              record.clientReadoutId,
              String(record.captureSequence),
              String(record.readout.siNumber),
              record.competitorName ?? '',
              record.originalCompetitorName ?? '',
              record.className ?? '',
              record.readout.cardSeries,
              String(record.readout.stationCode),
              record.resultStatus ?? '',
              record.originalResultStatus ?? '',
              getReadoutIssueLabel(record.issueType) ?? '',
              getReadoutIssueStateLabel(record.issueState) ?? '',
              getReadoutDeliveryLabel(record.deliveryState),
            ].some((value) => value.toLocaleLowerCase().includes(query))
          )
        : timelineItems,
    [query, timelineItems]
  );
  const pageCount = Math.max(1, Math.ceil(searchedItems.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleItems = useMemo(
    () => getReadoutHistoryPage(searchedItems, visiblePage, pageSize),
    [searchedItems, visiblePage, pageSize]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLOListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }

    const buttons = Array.from(
      rowsRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-readout-history-primary="true"]'
      ) ?? []
    );
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = getReadoutHistoryNavigationIndex(
      event.key,
      activeIndex,
      buttons.length
    );
    if (nextIndex === null) return;

    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  const updateFilter = (nextFilter: ReadoutTimelineFilter) => {
    setFilter(nextFilter);
    setPage(0);
  };

  const updateSearch = (nextSearch: string) => {
    setSearch(nextSearch);
    setPage(0);
  };

  const updatePageSize = (nextPageSize: 20 | 30 | 50) => {
    setPageSize(nextPageSize);
    setPage(0);
  };

  return (
    <section
      aria-label="Avläsningstidslinje"
      className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="space-y-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Avläsningar
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Nyaste först · {records.length} avläsningar · ↑/↓ flyttar fokus · Enter öppnar
            </p>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Visar {searchedItems.length === 0 ? 0 : visiblePage * pageSize + 1}–
            {Math.min((visiblePage + 1) * pageSize, searchedItems.length)} av {searchedItems.length}
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrera avläsningar">
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => updateFilter(option.value)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  filter === option.value
                    ? option.value === 'ACTION_REQUIRED'
                      ? 'border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200'
                      : 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="Sök bricka, löpare, status eller ID"
              aria-label="Sök i avläsningstidslinjen"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        </div>
        {historyError && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            Avläsningshistoriken kunde inte laddas eller sparas: {historyError}
          </p>
        )}
        <label className="flex items-center justify-end gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          Rader
          <select
            value={pageSize}
            onChange={(event) =>
              updatePageSize(Number(event.target.value) as 20 | 30 | 50)
            }
            aria-label="Avläsningar per sida"
            className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            <option value={20}>20</option>
            <option value={30}>30</option>
            <option value={50}>50</option>
          </select>
        </label>
      </header>
      {visibleItems.length > 0 ? (
        <ol
          ref={rowsRef}
          onKeyDown={handleKeyDown}
          aria-label="Avläsningar på aktuell sida"
          className="divide-y divide-slate-100 dark:divide-slate-800"
        >
          {visibleItems.map(({ record, isLatest, isExpanded }) => (
            <ReadoutHistoryRow
              key={record.clientReadoutId}
              record={record}
              isLatest={isLatest}
              isExpanded={isExpanded}
              placementLabel={getPlacementLabel(record)}
              onSelect={onToggleReadout}
            >
              {isExpanded ? children : null}
            </ReadoutHistoryRow>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
          {records.length === 0
            ? 'Historiken visas här efter första SI-avläsningen.'
            : 'Inga avläsningar matchar filtret eller sökningen.'}
        </p>
      )}
      <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2 dark:border-slate-800">
        <button
          type="button"
          disabled={visiblePage === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          className="rounded border border-slate-200 px-2.5 py-1 text-xs disabled:opacity-40 dark:border-slate-700"
        >
          Föregående
        </button>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Sida {visiblePage + 1} av {pageCount}
        </span>
        <button
          type="button"
          disabled={visiblePage + 1 >= pageCount}
          onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          className="rounded border border-slate-200 px-2.5 py-1 text-xs disabled:opacity-40 dark:border-slate-700"
        >
          Nästa
        </button>
      </footer>
    </section>
  );
}
