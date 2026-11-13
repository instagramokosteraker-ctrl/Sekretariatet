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
    document.getElementsByTagName('parsererror').length > 0 ||
    localName(document.documentElement).toLowerCase() === 'parsererror'
  ) {
    throw new Error('Eventor-filen innehåller inte giltig XML.');
  }
  console.log('Parsed XML Root:', document.documentElement.tagName);
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
  const given = textFrom(person, ['Given', 'GivenName', 'FirstName']);
  const family = textFrom(person, ['Family', 'FamilyName', 'LastName']);
  const fullName = (
    `${given} ${family}`.trim() ||
    textFrom(person, ['PersonName', 'Name'])
  ).slice(0, 120);
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
  let inheritedClass: Element | null = null;
  let ancestor = element.parentElement;
  while (ancestor && !inheritedClass) {
    inheritedClass =
      Array.from(ancestor.children).find((child) =>
        ['EventClass', 'Class'].includes(localName(child))
      ) ?? null;
    ancestor = ancestor.parentElement;
  }
  const entryClass =
    firstElement(element, ['EntryClass', 'EventClass', 'Class']) ??
    inheritedClass;
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
  const recordNames = isCompetitorList
    ? ['Competitor', 'PersonEntry']
    : ['Entry', 'PersonEntry', 'Start', 'Competitor'];
  const candidateElements = elementsByName(document, recordNames);
  const candidateSet = new Set(candidateElements);
  const entryElements = candidateElements.filter((element) => {
    let ancestor = element.parentElement;
    while (ancestor) {
      if (candidateSet.has(ancestor)) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
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
  let initialDocument: Document | null = null;
  if (typeof input === 'string') {
    initialDocument = parseDocument(input);
    const rootTag = localName(initialDocument.documentElement);
    if (rootTag === 'CompetitorList') {
      source = { competitorsXml: input };
    } else if (rootTag === 'ClassList') {
      source = { classesXml: input };
    } else if (rootTag === 'EntryList' || rootTag === 'StartList') {
      source = { entriesXml: input, classesXml: input };
    } else {
      source = { eventXml: input, classesXml: input, entriesXml: input };
    }
  } else {
    source = input;
  }
  const documentCache = new Map<string, Document>();
  if (typeof input === 'string' && initialDocument) {
    documentCache.set(input, initialDocument);
  }
  const documentFor = (xml?: string): Document | null => {
    if (!xml) return null;
    const cached = documentCache.get(xml);
    if (cached) return cached;
    const document = parseDocument(xml);
    documentCache.set(xml, document);
    return document;
  };
  const eventDocument =
    documentFor(source.eventXml) ??
    documentFor(source.entriesXml) ??
    documentFor(source.classesXml);
  const classesDocument =
    documentFor(source.classesXml) ??
    documentFor(source.eventXml) ??
    documentFor(source.entriesXml);
  const entriesDocument =
    documentFor(source.entriesXml) ??
    documentFor(source.eventXml) ??
    documentFor(source.classesXml);
  const competitorsDocument = documentFor(source.competitorsXml);
  const organizationDocument = documentFor(source.organizationXml);
  const rootDocument =
    competitorsDocument ??
    entriesDocument ??
    eventDocument ??
    classesDocument ??
    organizationDocument;
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
    source.competitorsXml ? competitorsDocument : effectiveEntriesDocument,
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
      : rootDocument
        ? localName(rootDocument.documentElement)
        : '',
    organization,
    event: parseEvent(eventDocument, source.eventId ?? ''),
    classes,
    ...parsedEntries,
  };
}
