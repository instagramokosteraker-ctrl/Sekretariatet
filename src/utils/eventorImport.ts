import type {
  ParsedEventorClass,
  ParsedEventorEntry,
  ParsedEventorXml,
} from './eventorXml';
import type { CompClass, RunnerDbSource } from '../types/sportident';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Eventor-importen saknar giltigt fält: ${fieldName}.`);
  }
  return value;
}

export function parseEventorImportApiResponse(value: unknown): ParsedEventorXml {
  if (!isRecord(value)) {
    throw new Error('Eventor returnerade ett ogiltigt importsvar.');
  }
  if (value.success !== true) {
    throw new Error(
      typeof value.error === 'string'
        ? value.error
        : 'Kunde inte hämta tävlingen från Eventor.'
    );
  }
  if (!isRecord(value.event) || !Array.isArray(value.classes) || !Array.isArray(value.entries)) {
    throw new Error('Eventor returnerade ett ofullständigt importsvar.');
  }

  const event = value.event;
  const classes = value.classes.map((item): ParsedEventorClass => {
    if (!isRecord(item)) {
      throw new Error('Eventor returnerade en ogiltig klass.');
    }
    return {
      id: readString(item.id, 'class.id'),
      name: readString(item.name, 'class.name'),
    };
  });
  const entries = value.entries.map((item): ParsedEventorEntry => {
    if (!isRecord(item) || typeof item.siNumber !== 'number') {
      throw new Error('Eventor returnerade en ogiltig anmälan.');
    }
    return {
      fullName: readString(item.fullName, 'entry.fullName'),
      club: readString(item.club, 'entry.club'),
      className: readString(item.className, 'entry.className'),
      eventorClassId:
        typeof item.eventorClassId === 'string' ? item.eventorClassId : null,
      siNumber: item.siNumber,
      personId: typeof item.personId === 'string' ? item.personId : null,
      eventorOrgId: typeof item.eventorOrgId === 'string' ? item.eventorOrgId : null,
      birthYear: typeof item.birthYear === 'number' ? item.birthYear : null,
    };
  });

  return {
    rootTag: 'EventorImport',
    organization: null,
    event: {
      eventId: readString(event.eventId, 'event.eventId'),
      name: readString(event.name, 'event.name'),
      organizer: typeof event.organizer === 'string' ? event.organizer : null,
      date: typeof event.date === 'string' ? event.date : null,
    },
    classes,
    entries,
    runnerDbEntries: entries
      .filter((entry) => entry.siNumber > 0)
      .map((entry) => ({
        siNumber: entry.siNumber,
        fullName: entry.fullName,
        club: entry.club,
        birthYear: entry.birthYear ?? null,
        defaultClassName: entry.className,
        eventorPersonId: entry.personId,
        eventorOrgId: entry.eventorOrgId,
      })),
  };
}

export function buildEventorClassMapping(
  parsed: ParsedEventorXml,
  source: Extract<RunnerDbSource, 'EVENTOR_API' | 'EVENTOR_XML'>,
  now: number
): {
  classes: CompClass[];
  resolveEntryClassId: (entry: ParsedEventorEntry) => string;
} {
  const classDefinitions = new Map<string, { name: string; eventorClassId?: string }>();
  const addClassDefinition = (rawName: string, eventorClassId?: string | null) => {
    const name = rawName.trim().slice(0, 80);
    if (!name) return;
    const key = eventorClassId
      ? `eventor:${eventorClassId}`
      : `name:${name.toLocaleLowerCase()}`;
    if (!classDefinitions.has(key)) {
      classDefinitions.set(key, {
        name,
        ...(eventorClassId ? { eventorClassId } : {}),
      });
    }
  };

  for (const eventClass of parsed.classes) {
    addClassDefinition(eventClass.name, eventClass.id || null);
  }
  if (source !== 'EVENTOR_API') {
    for (const entry of parsed.entries) {
      addClassDefinition(entry.className, entry.eventorClassId);
    }
  }
  if (classDefinitions.size === 0) {
    if (source === 'EVENTOR_API') {
      throw new Error('Eventor returnerade ingen klasslista.');
    }
    addClassDefinition('Öppen');
  }

  const classes: CompClass[] = Array.from(classDefinitions.values()).map(
    (definition, index) => ({
      id: `evtcls-${now}-${index + 1}`,
      ...(definition.eventorClassId
        ? { eventorClassId: definition.eventorClassId }
        : {}),
      name: definition.name,
      courseId: null,
      classFormat: 'STANDARD',
      forkCourseIds: [],
      allowDirectEntry: true,
      freeStart: true,
      autoMatchCourse: true,
    })
  );
  const classIdByEventorId = new Map<string, string>();
  for (const eventClass of classes) {
    if (eventClass.eventorClassId) {
      classIdByEventorId.set(eventClass.eventorClassId, eventClass.id);
    }
  }
  const classIdByName = new Map<string, string>();
  for (const eventClass of classes) {
    const key = eventClass.name.toLocaleLowerCase();
    if (!classIdByName.has(key)) classIdByName.set(key, eventClass.id);
  }

  return {
    classes,
    resolveEntryClassId: (entry) => {
      const classId =
        (entry.eventorClassId
          ? classIdByEventorId.get(entry.eventorClassId)
          : undefined) ??
        classIdByName.get(entry.className.trim().toLocaleLowerCase());
      if (classId) return classId;
      if (source === 'EVENTOR_API') {
        throw new Error(
          `Eventor-klass "${entry.className}" (${entry.eventorClassId || 'utan ID'}) finns inte i den hämtade klasslistan.`
        );
      }
      return classes[0].id;
    },
  };
}
