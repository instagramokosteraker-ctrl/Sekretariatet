import { describe, expect, it } from 'vitest';
import {
  parseEventorClassesXml,
  parseEventorEntriesXml,
} from '../server/eventorXml';
import {
  buildEventorClassMapping,
  parseEventorImportApiResponse,
} from './eventorImport';

const classRows = [
  { id: 'class-vit', name: 'Vit' },
  { id: 'class-gul', name: 'Gul' },
  { id: 'class-orange', name: 'Orange' },
  { id: 'class-svart', name: 'Svart' },
];

const classesXml = `<EventClassList>${classRows
  .map(
    ({ id, name }) =>
      `<EventClass><EventClassId>${id}</EventClassId><Name>${name}</Name></EventClass>`
  )
  .join('')}</EventClassList>`;

const entriesXml = `<EntryList>${classRows
  .map(
    ({ id, name }, index) =>
      `<Entry><Competitor><Person><PersonId>person-${index}</PersonId><Name><Given>Runner</Given><Family>${name}</Family></Name></Person></Competitor><EntryClass><EventClassId>${id}</EventClassId></EntryClass><CCardId>${1000 + index}</CCardId></Entry>`
  )
  .join('')}</EntryList>`;

describe('Eventor dedicated class-list import', () => {
  it('preserves all four class identities and maps each competitor to its class', () => {
    const classIdToName = parseEventorClassesXml(classesXml);
    const parsed = parseEventorImportApiResponse({
      success: true,
      event: {
        eventId: 'event-1',
        name: 'Testtävling',
        organizer: 'OK Test',
        date: '2026-06-01',
      },
      classes: Array.from(classIdToName, ([id, name]) => ({ id, name })),
      entries: parseEventorEntriesXml(entriesXml, classIdToName),
    });

    const mapping = buildEventorClassMapping(parsed, 'EVENTOR_API', 1234);

    expect(mapping.classes.map(({ name, eventorClassId }) => [name, eventorClassId])).toEqual(
      classRows.map(({ id, name }) => [name, id])
    );
    expect(
      parsed.entries.map((entry) => [
        entry.className,
        entry.eventorClassId,
        mapping.resolveEntryClassId(entry),
      ])
    ).toEqual(
      classRows.map(({ id, name }, index) => [
        name,
        id,
        `evtcls-1234-${index + 1}`,
      ])
    );
  });

  it('does not create an API-import class for an entry absent from the dedicated list', () => {
    const classIdToName = parseEventorClassesXml(classesXml);
    const parsed = parseEventorImportApiResponse({
      success: true,
      event: {
        eventId: 'event-1',
        name: 'Testtävling',
        organizer: null,
        date: null,
      },
      classes: Array.from(classIdToName, ([id, name]) => ({ id, name })),
      entries: [
        {
          ...parseEventorEntriesXml(entriesXml, classIdToName)[0],
          className: 'Okänd klass',
          eventorClassId: 'missing-class-id',
        },
      ],
    });

    const mapping = buildEventorClassMapping(parsed, 'EVENTOR_API', 1234);

    expect(mapping.classes.map(({ name }) => name)).toEqual([
      'Vit',
      'Gul',
      'Orange',
      'Svart',
    ]);
    expect(() => mapping.resolveEntryClassId(parsed.entries[0])).toThrow(
      'finns inte i den hämtade klasslistan'
    );
  });
});
