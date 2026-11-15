import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { XmlDocument, XsdValidator } from 'libxml2-wasm';
import type {
  CompClass,
  CompetitionMeta,
  Competitor,
  Course,
  RunnerStatus,
} from '../types/sportident';
import { buildIofResultListXml } from './iofXml';

const IOF_XSD_URL =
  'https://raw.githubusercontent.com/international-orienteering-federation/datastandard-v3/24eb108e4c6b5e2904e5f8f0e49142e45e2c5230/IOF.xsd';
const IOF_XSD_SHA256 = '9d00abaea14ba4bedfae910d68a01506c097a57c29b0492c49abb19034ae90a1';

const competition: CompetitionMeta = {
  id: 'evt-1',
  status: 'LIVE',
  name: 'Test Event',
  organizer: 'OK Test',
  date: '2026-06-01',
  zeroTimeStr: '10:00:00',
  zeroTimeSec: 36000,
};
const eventClass: CompClass = {
  id: 'cls-1',
  name: 'D21',
  courseId: 'course-1',
  allowDirectEntry: false,
  freeStart: false,
  autoMatchCourse: false,
};
const course: Course = {
  id: 'course-1',
  name: 'Course 1',
  lengthMeters: 5000,
  climbMeters: 100,
  controls: [31, 32, 33],
};

function runner(
  id: string,
  status: RunnerStatus,
  overrides: Partial<Competitor> = {}
): Competitor {
  return {
    id,
    bib: 1,
    fullName: 'Ada Lovelace',
    club: 'OK Test',
    classId: eventClass.id,
    siNumber: 123456,
    cardSeries: 'SI-Card 10',
    isRentalCard: false,
    rentalReturned: false,
    status,
    allocatedStartSec: 36000,
    checkTimeSec: null,
    startTimeSec: 36000,
    finishTimeSec: null,
    runningTimeSec: null,
    lastSeenControl: null,
    lastSeenTimeSec: null,
    readoutAt: null,
    radioSplits: [],
    cardPunches: [],
    validation: null,
    ...overrides,
  };
}

function buildXml(
  competitors: Competitor[],
  eventOverrides: Partial<CompetitionMeta> = {}
): string {
  return buildIofResultListXml({
    competition: { ...competition, ...eventOverrides },
    classes: [eventClass],
    courses: [course],
    competitors,
  });
}

let schemaDocument: XmlDocument;
let validator: XsdValidator;

beforeAll(async () => {
  const response = await fetch(IOF_XSD_URL, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download pinned IOF 3.0 XSD: HTTP ${response.status}`);
  }
  const schemaText = await response.text();
  const actualHash = createHash('sha256').update(schemaText).digest('hex');
  if (actualHash !== IOF_XSD_SHA256) {
    throw new Error(`Pinned IOF 3.0 XSD checksum mismatch: ${actualHash}`);
  }
  schemaDocument = XmlDocument.fromString(schemaText);
  validator = XsdValidator.fromDoc(schemaDocument);
}, 60_000);

afterAll(() => {
  validator?.dispose();
  schemaDocument?.dispose();
});

function expectValidIoFXml(xml: string): void {
  const document = XmlDocument.fromString(xml);
  try {
    validator.validate(document);
  } finally {
    document.dispose();
  }
}

describe('IOF ResultList XML export', () => {
  it('validates against the pinned official IOF 3.0 XSD', () => {
    const xml = buildXml([
      runner('ok', 'OK', { runningTimeSec: 1800, finishTimeSec: 37800 }),
      runner('mp', 'MP', { runningTimeSec: 1900, finishTimeSec: 37900 }),
      runner('dnf', 'DNF', { runningTimeSec: 900, finishTimeSec: 36900 }),
      runner('dns', 'DNS'),
      runner('preliminary', 'PRELIMINARY_FIN', {
        runningTimeSec: 1700,
        finishTimeSec: 37700,
      }),
      runner('forest', 'IN_FOREST'),
      runner('checked', 'CHECKED'),
      runner('registered', 'REGISTERED'),
    ]);

    expectValidIoFXml(xml);

    const invalidNameOrder = xml.replace(
      '<Family>Lovelace</Family>\n          <Given>Ada</Given>',
      '<Given>Ada</Given>\n          <Family>Lovelace</Family>'
    );
    expect(() => expectValidIoFXml(invalidNameOrder)).toThrow();
  });

  it('exports Eventor identities instead of internal document IDs', () => {
    const xml = buildIofResultListXml({
      competition: { ...competition, eventorEventId: '59797' },
      classes: [{ ...eventClass, eventorClassId: '1234' }],
      courses: [course],
      competitors: [
        runner('cmp-internal', 'DNS', {
          eventorPersonId: '31889',
          eventorOrgId: '636',
        }),
      ],
    });

    expect(xml).toContain('<Event>\n    <Id>59797</Id>');
    expect(xml).toContain('<Class>\n      <Id>1234</Id>');
    expect(xml).toContain('<Person>\n        <Id>31889</Id>');
    expect(xml).toContain('<Organisation>\n        <Id>636</Id>');
    expect(xml).not.toContain('<Id>evt-1</Id>');
    expect(xml).not.toContain('<Id>cls-1</Id>');
    expect(xml).not.toContain('<Id>cmp-internal</Id>');
    expectValidIoFXml(xml);
  });

  it('omits absent Eventor identities and keeps the ResultList schema-valid', () => {
    const xml = buildXml([runner('cmp-internal', 'DNS')]);

    expect(xml).not.toContain('<Id>');
    expectValidIoFXml(xml);
  });

  it('uses snapshot/complete status and maps preliminary and unstarted runners accurately', () => {
    const xml = buildXml(
      [
        runner('preliminary', 'PRELIMINARY_FIN'),
        runner('forest', 'IN_FOREST'),
        runner('checked', 'CHECKED'),
        runner('registered', 'REGISTERED'),
      ],
      { status: 'LIVE' }
    );

    expect(xml).toContain('status="Snapshot"');
    expect(xml).toContain('<Status>Finished</Status>');
    expect(xml).toContain('<Status>Active</Status>');
    expect(xml.match(/<PersonResult>/g)).toHaveLength(4);
    expectValidIoFXml(xml);

    const completeXml = buildXml(
      [runner('dns', 'DNS')],
      { status: 'COMPLETED' }
    );
    expect(completeXml).toContain('status="Complete"');
    expectValidIoFXml(completeXml);

    const unresolvedXml = buildXml(
      [runner('unclassified', 'DNS', { classId: 'missing-class' })],
      { status: 'COMPLETED' }
    );
    expect(unresolvedXml).toContain('status="Snapshot"');
    expectValidIoFXml(unresolvedXml);
  });

  it('assigns a shared position to tied finishers', () => {
    const xml = buildXml([
      runner('first', 'OK', { bib: 1, runningTimeSec: 1200 }),
      runner('tie', 'OK', { bib: 2, runningTimeSec: 1200 }),
      runner('third', 'OK', { bib: 3, runningTimeSec: 1300 }),
    ]);

    expect(xml.match(/<Position>1<\/Position>/g)).toHaveLength(2);
    expect(xml).toContain('<Position>3</Position>');
    expectValidIoFXml(xml);
  });

  it('exports split states and additional punches without false missing times', () => {
    const xml = buildXml([
      runner('split-runner', 'MP', {
        runningTimeSec: 600,
        startTimeSec: 36000,
        validation: {
          ok: false,
          matchedCourseId: course.id,
          matchedCourseName: course.name,
          missingControls: [32],
          extraControls: [{ code: 55, timeSec: 36120 }],
          splits: [
            {
              order: 1,
              controlCode: 31,
              label: '(31)',
              status: 'OK',
              punchTimeSec: null,
              cumulativeSec: null,
              legSec: null,
            },
            {
              order: 2,
              controlCode: 32,
              label: '(32)',
              status: 'MISSING',
              punchTimeSec: null,
              cumulativeSec: null,
              legSec: null,
            },
            {
              order: 3,
              controlCode: 33,
              label: '(33)',
              status: 'BROKEN_CTRL',
              punchTimeSec: null,
              cumulativeSec: null,
              legSec: null,
            },
            {
              order: 4,
              controlCode: 999,
              label: 'Mål',
              status: 'OK',
              punchTimeSec: 36600,
              cumulativeSec: 600,
              legSec: 100,
            },
          ],
        },
      }),
    ]);

    expect(xml).toContain(
      '<SplitTime>\n          <ControlCode>31</ControlCode>\n        </SplitTime>'
    );
    expect(xml).toContain('<SplitTime status="Missing">\n          <ControlCode>32</ControlCode>');
    expect(xml).toContain(
      '<SplitTime>\n          <ControlCode>33</ControlCode>\n        </SplitTime>'
    );
    expect(xml).toContain(
      '<SplitTime status="Additional">\n          <ControlCode>55</ControlCode>\n          <Time>120</Time>'
    );
    expect(xml).not.toContain('<ControlCode>999</ControlCode>');
    expectValidIoFXml(xml);
  });

  it('omits imported synthetic SI values but retains a real rental card number', () => {
    const xml = buildXml([
      runner('evtcmp-imported', 'DNS', {
        bib: 4,
        siNumber: 8_900_004,
        isRentalCard: true,
      }),
      runner('real-rental', 'DNS', {
        bib: 5,
        siNumber: 8_500_001,
        isRentalCard: true,
      }),
    ]);

    expect(xml).not.toContain('<ControlCard>8900004</ControlCard>');
    expect(xml).toContain('<ControlCard>8500001</ControlCard>');
    expectValidIoFXml(xml);
  });
});
