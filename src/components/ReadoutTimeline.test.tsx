import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReadoutHistoryRecord } from '../services/readoutHistoryStore';
import { ReadoutTimeline } from './ReadoutTimeline';

function makeRecord(
  id: string,
  sequence: number
): ReadoutHistoryRecord {
  return {
    clientReadoutId: id,
    captureSequence: sequence,
    capturedAt: `2026-11-22T09:${String(sequence).padStart(2, '0')}:00.000Z`,
    eventId: 'event-1',
    readout: {
      clientReadoutId: id,
      captureSequence: sequence,
      capturedAt: `2026-11-22T09:${String(sequence).padStart(2, '0')}:00.000Z`,
      siNumber: sequence,
      cardSeries: 'SI-Card 9',
      stationCode: 8,
      checkTimeSec: null,
      startTimeSec: null,
      finishTimeSec: sequence * 60,
      punches: [],
      source: 'USB_WEBSERIAL',
    },
    readoutState: 'PROCESSED',
    deliveryState: 'SYNCED',
    competitorId: `competitor-${id}`,
    competitorName: `Runner ${id}`,
    className: 'D21',
    resultStatus: 'OK',
    competitorSnapshot: null,
    originalCompetitorId: `competitor-${id}`,
    originalCompetitorName: `Runner ${id}`,
    originalClassName: 'D21',
    originalResultStatus: 'OK',
    originalCompetitorSnapshot: null,
    issueType: null,
    issueState: 'NONE',
    correctionOperationId: null,
    correctionAudit: [],
    suggestedRunner: null,
    syncError: null,
  };
}

describe('ReadoutTimeline', () => {
  it('renders each readout once and keeps expanded content in its row', () => {
    const records = [makeRecord('older', 1), makeRecord('newest', 2)];
    const markup = renderToStaticMarkup(
      <ReadoutTimeline
        records={records}
        latestReadoutId="newest"
        expandedReadoutId="older"
        historyError={null}
        onToggleReadout={() => undefined}
        getPlacementLabel={() => '1/1'}
      >
        <div data-detail-for="older">Older readout actions</div>
      </ReadoutTimeline>
    );
    const rows = markup.match(/data-readout-id=/g) ?? [];
    const olderRow = markup.match(
      /<li[^>]*data-readout-id="older"[\s\S]*?<\/li>/
    )?.[0];
    const newestRow = markup.match(
      /<li[^>]*data-readout-id="newest"[\s\S]*?<\/li>/
    )?.[0];

    expect(rows).toHaveLength(2);
    expect(newestRow).toContain('Senaste');
    expect(olderRow).toContain('data-detail-for="older"');
    expect(newestRow).not.toContain('Older readout actions');
  });
});
