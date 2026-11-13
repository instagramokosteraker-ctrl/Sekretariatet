export interface ParsedEventorOrganization {
  orgId: string;
  orgName: string;
}

export interface ParsedEventorCompetition {
  eventId: string;
  name: string;
  organizer: string | null;
  date: string | null;
}

export interface ParsedEventorClass {
  id: string;
  name: string;
}

export interface ParsedEventorEntry {
  fullName: string;
  club: string;
  className: string;
  siNumber: number;
  personId: string | null;
}

export interface ParsedEventorRunner {
  siNumber: number;
  fullName: string;
  club: string;
  birthYear: number | null;
  defaultClassName: string | null;
  eventorPersonId: string | null;
  eventorOrgId: string | null;
}

export interface ParsedEventorXml {
  rootTag: string;
  organization: ParsedEventorOrganization | null;
  event: ParsedEventorCompetition | null;
  classes: ParsedEventorClass[];
  entries: ParsedEventorEntry[];
  runnerDbEntries: ParsedEventorRunner[];
}

interface EventorXmlDocuments {
  eventId?: string;
  eventXml?: string;
  classesXml?: string;
  entriesXml?: string;
  organizationXml?: string;
  competitorsXml?: string;
  fallbackOrgId?: string;
  fallbackOrgName?: string;
}

function localName(element: Element): string {
  return element.localName || element.nodeName.split(':').pop() || '';
}

function elementsByName(parent: ParentNode, names: string[]): Element[] {
  const self =
    parent instanceof Element && names.includes(localName(parent)) ? [parent] : [];
  return [
    ...self,
    ...Array.from(parent.querySelectorAll('*')).filter((element) =>
      names.includes(localName(element))
    ),
  ];
}

function firstElement(parent: ParentNode, names: string[]): Element | null {
  return elementsByName(parent, names)[0] ?? null;
}

function textFrom(parent: ParentNode, names: string[]): string {
  return firstElement(parent, names)?.textContent?.trim() ?? '';
}

function parseDocument(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('Eventor XML-filer får inte innehålla DTD- eller entitetsdeklarationer.');
  }
  const document = new DOMParser().parseFromString(
    xml.replace(/^\uFEFF/, '').trim(),
    'application/xml'
  );
  if (
    document.querySelector('parsererror') ||
    localName(document.documentElement).toLowerCase() === 'html'
  ) {
    throw new Error('Eventor-filen innehåller inte giltig XML.');
  }
  return document;
}

function parseOrganization(document: Document | null): ParsedEventorOrganization | null {
  if (!document) return null;
  const organization =
    localName(document.documentElement) === 'Organisation'
      ? document.documentElement
      : firstElement(document, ['Organisation', 'Organization']) ?? document;
  const orgId = textFrom(organization, ['OrganisationId', 'OrganizationId', 'Id']);
  const orgName = textFrom(organization, ['Name', 'ShortName']);
  return orgId && orgName ? { orgId, orgName } : null;
}

function parseEvent(
  document: Document | null,
  requestedEventId: string
): ParsedEventorCompetition | null {
  if (!document) return null;
  const event = findEvent(document, requestedEventId);
  if (!event) return null;
  const name = textFrom(event, ['Name', 'EventName']);
  if (!name) return null;

  const organizerElement = firstElement(event, [
    'Organiser',
    'Organizer',
    'Organisation',
    'Organization',
  ]);
  const organizer = organizerElement
    ? textFrom(organizerElement, ['Name', 'ShortName'])
    : textFrom(event, ['OrganiserName', 'OrganizerName']);
  const dateValue = textFrom(event, ['StartDate', 'EventDate', 'Date']);
  const date = dateValue.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const eventId = requestedEventId || textFrom(event, ['EventId', 'Id']);
  return {
    eventId,
    name: name.slice(0, 140),
    organizer: organizer.slice(0, 100) || null,
    date,
  };
}

function findEvent(document: Document, requestedEventId: string): Element | null {
  const rootEvent =
    localName(document.documentElement) === 'Event'
      ? document.documentElement
      : null;
  const eventNodes = rootEvent ? [rootEvent] : elementsByName(document, ['Event']);
  if (!requestedEventId) return eventNodes[0] ?? null;
  return (
    eventNodes.find(
      (candidate) => textFrom(candidate, ['EventId', 'Id']) === requestedEventId
    ) ??
    (eventNodes.length === 1 ? eventNodes[0] : null)
  );
}

function parseClasses(document: ParentNode | null): ParsedEventorClass[] {
  if (!document) return [];
  const classElements = elementsByName(document, ['EventClass', 'Class']);
  const classesById = new Map<string, ParsedEventorClass>();
  for (const element of classElements) {
    const id = textFrom(element, ['EventClassId', 'Id']);
    const name = textFrom(element, ['Name', 'ClassShortName']);
    if (!name) continue;
    const key = id || name;
    if (!classesById.has(key)) {
      classesById.set(key, { id: id.slice(0, 128), name: name.slice(0, 80) });
    }
  }
  return Array.from(classesById.values());
}

function parsePersonEntry(
  element: Element,
  classNames: Map<string, string>,
  fallbackOrgId: string,
  fallbackOrgName: string,
  collectRunner: (runner: ParsedEventorRunner) => void
): ParsedEventorEntry | null {
  const person =
    firstElement(element, ['Competitor', 'Person']) ?? element;
  const given = textFrom(person, ['Given']);
  const family = textFrom(person, ['Family']);
  const fullName = `${given} ${family}`.trim().slice(0, 120);
  if (!fullName) return null;

  const personId = textFrom(person, ['PersonId', 'Id']).slice(0, 128) || null;
  const organization = firstElement(element, ['Organisation', 'Organization']);
  const club = (
    (organization ? textFrom(organization, ['Name', 'ShortName']) : '') ||
    fallbackOrgName ||
    'Klubblös'
  ).slice(0, 100);
  const orgId = (
    (organization
      ? textFrom(organization, ['OrganisationId', 'OrganizationId', 'Id'])
      : '') || fallbackOrgId
  ).slice(0, 32);
  const entryClass = firstElement(element, ['EntryClass', 'EventClass', 'Class']);
  const classId = entryClass
    ? textFrom(entryClass, ['EventClassId', 'Id'])
    : textFrom(element, ['EventClassId']);
  const className = (
    (classId ? classNames.get(classId) : '') ||
    (entryClass ? textFrom(entryClass, ['Name', 'ClassShortName']) : '') ||
    'Öppen Motion'
  ).slice(0, 80);

  const cardElement = firstElement(element, [
    'CCardId',
    'ControlCard',
    'PunchingUnitId',
    'CardNumber',
  ]);
  const siNumber = cardElement
    ? Number((cardElement.textContent || '').replace(/\D/g, '')) || 0
    : 0;
  const birthYearText = textFrom(person, ['BirthDate']);
  const birthYear = Number(birthYearText.match(/\b(19\d{2}|20\d{2})\b/)?.[1]) || null;
  if (siNumber > 0) {
    collectRunner({
      siNumber,
      fullName,
      club,
      birthYear,
      defaultClassName: className,
      eventorPersonId: personId,
      eventorOrgId: orgId || null,
    });
  }
  return { fullName, club, className, siNumber, personId };
}

function parseEntries(
  document: ParentNode | null,
  classNames: Map<string, string>,
  fallbackOrgId: string,
  fallbackOrgName: string,
  isCompetitorList = false
): { entries: ParsedEventorEntry[]; runnerDbEntries: ParsedEventorRunner[] } {
  if (!document) return { entries: [], runnerDbEntries: [] };
  const entryElements = elementsByName(
    document,
    isCompetitorList ? ['Competitor', 'PersonEntry'] : ['Entry', 'PersonEntry']
  );
  const entries: ParsedEventorEntry[] = [];
  const runners = new Map<number, ParsedEventorRunner>();
  for (const element of entryElements) {
    const entry = parsePersonEntry(
      element,
      classNames,
      fallbackOrgId,
      fallbackOrgName,
      (runner) => runners.set(runner.siNumber, runner)
    );
    if (entry && !isCompetitorList) entries.push(entry);
  }
  const uniqueEntries = new Map<string, ParsedEventorEntry>();
  for (const entry of entries) {
    uniqueEntries.set(
      `${entry.personId ?? entry.fullName}|${entry.className}|${entry.siNumber}`,
      entry
    );
  }
  return {
    entries: Array.from(uniqueEntries.values()),
    runnerDbEntries: Array.from(runners.values()),
  };
}

export function parseEventorXml(
  input: string | EventorXmlDocuments
): ParsedEventorXml {
  let source: EventorXmlDocuments;
  if (typeof input === 'string') {
    const document = parseDocument(input);
    source =
      localName(document.documentElement) === 'CompetitorList'
        ? { competitorsXml: input }
        : { entriesXml: input };
  } else {
    source = input;
  }
  const eventDocument = source.eventXml
    ? parseDocument(source.eventXml)
    : source.entriesXml
      ? parseDocument(source.entriesXml)
      : null;
  const classesDocument = source.classesXml
    ? parseDocument(source.classesXml)
    : source.entriesXml
      ? parseDocument(source.entriesXml)
      : null;
  const entriesDocument = source.entriesXml
    ? parseDocument(source.entriesXml)
    : source.competitorsXml
      ? parseDocument(source.competitorsXml)
      : null;
  const organizationDocument = source.organizationXml
    ? parseDocument(source.organizationXml)
    : null;
  const organization = parseOrganization(organizationDocument);
  const effectiveClassesDocument =
    !source.classesXml &&
    classesDocument &&
    localName(classesDocument.documentElement) === 'EventList'
      ? findEvent(classesDocument, source.eventId ?? '')
      : classesDocument;
  const effectiveEntriesDocument =
    !source.competitorsXml &&
    entriesDocument &&
    localName(entriesDocument.documentElement) === 'EventList'
      ? findEvent(entriesDocument, source.eventId ?? '')
      : entriesDocument;
  const classes = parseClasses(effectiveClassesDocument);
  const classNames = new Map(
    classes.filter((eventClass) => eventClass.id).map((eventClass) => [eventClass.id, eventClass.name])
  );
  const parsedEntries = parseEntries(
    effectiveEntriesDocument,
    classNames,
    organization?.orgId ?? source.fallbackOrgId ?? '',
    organization?.orgName ?? source.fallbackOrgName ?? '',
    Boolean(source.competitorsXml)
  );
  const knownClassNames = new Set(classes.map((eventClass) => eventClass.name.toLocaleLowerCase()));
  for (const entry of parsedEntries.entries) {
    if (!knownClassNames.has(entry.className.toLocaleLowerCase())) {
      classes.push({ id: '', name: entry.className });
      knownClassNames.add(entry.className.toLocaleLowerCase());
    }
  }

  return {
    rootTag: source.competitorsXml
      ? 'CompetitorList'
      : entriesDocument
        ? localName(entriesDocument.documentElement)
        : eventDocument
          ? localName(eventDocument.documentElement)
          : '',
    organization,
    event: parseEvent(eventDocument, source.eventId ?? ''),
    classes,
    ...parsedEntries,
  };
}
