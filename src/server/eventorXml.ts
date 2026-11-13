function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function extractFirstTag(xml: string, localTagName: string): string | null {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${localTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>`,
    'i'
  );
  const match = xml.match(re);
  return match ? decodeXmlEntities(match[1]) : null;
}

function extractAllBlocks(xml: string, localTagName: string): string[] {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${localTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localTagName}>`,
    'gi'
  );
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

export function parseEventorOrgXml(
  xml: string
): { orgId: string; orgName: string } | null {
  const orgBlock = extractFirstTag(xml, 'Organisation') ?? xml;
  const orgId =
    extractFirstTag(orgBlock, 'OrganisationId') ??
    extractFirstTag(orgBlock, 'Id') ??
    null;
  const orgName =
    extractFirstTag(orgBlock, 'Name') ??
    extractFirstTag(orgBlock, 'ShortName') ??
    null;
  if (!orgId || !orgName) return null;
  return { orgId, orgName };
}

export function parseEventorEventXml(
  xml: string,
  requestedEventId: string
): { eventId: string; name: string; organizer: string | null; date: string | null } | null {
  const eventBlock = extractFirstTag(xml, 'Event') ?? xml;
  const name = extractFirstTag(eventBlock, 'Name') ?? extractFirstTag(eventBlock, 'EventName');
  if (!name?.trim()) return null;

  const organizerBlock =
    extractFirstTag(eventBlock, 'Organiser') ??
    extractFirstTag(eventBlock, 'Organizer') ??
    extractFirstTag(eventBlock, 'Organisation');
  const organizer =
    (organizerBlock
      ? extractFirstTag(organizerBlock, 'Name') ?? extractFirstTag(organizerBlock, 'ShortName')
      : null) ??
    extractFirstTag(eventBlock, 'OrganiserName') ??
    extractFirstTag(eventBlock, 'OrganizerName') ??
    null;
  const dateValue =
    extractFirstTag(eventBlock, 'StartDate') ??
    extractFirstTag(eventBlock, 'EventDate') ??
    extractFirstTag(eventBlock, 'Date') ??
    '';
  const dateMatch = dateValue.match(/^(\d{4}-\d{2}-\d{2})/);

  return {
    eventId: requestedEventId,
    name: name.trim().slice(0, 140),
    organizer: organizer?.trim().slice(0, 100) || null,
    date: dateMatch?.[1] ?? null,
  };
}

export function parseEventorCompetitorsXml(
  xml: string,
  fallbackClubName: string,
  fallbackOrgId: string
): {
  siNumber: number;
  fullName: string;
  club: string;
  birthYear: number | null;
  eventorPersonId: string | null;
  eventorOrgId: string | null;
}[] {
  const blocks = [
    ...extractAllBlocks(xml, 'Competitor'),
    ...extractAllBlocks(xml, 'PersonEntry'),
  ];
  const parsed: {
    siNumber: number;
    fullName: string;
    club: string;
    birthYear: number | null;
    eventorPersonId: string | null;
    eventorOrgId: string | null;
  }[] = [];

  for (const block of blocks) {
    const personBlock = extractFirstTag(block, 'Person') ?? block;
    const nameBlock = extractFirstTag(personBlock, 'Name') ?? personBlock;
    const given = extractFirstTag(nameBlock, 'Given') ?? '';
    const family = extractFirstTag(nameBlock, 'Family') ?? '';
    const fullName = `${given} ${family}`.trim();
    if (!fullName) continue;

    const personId =
      extractFirstTag(personBlock, 'PersonId') ??
      extractFirstTag(personBlock, 'Id') ??
      null;
    const birthRaw = extractFirstTag(personBlock, 'BirthDate') ?? '';
    const yearMatch = birthRaw.match(/\b(19\d{2}|20\d{2})\b/);
    const birthYear = yearMatch ? Number(yearMatch[1]) : null;

    const orgBlock = extractFirstTag(block, 'Organisation');
    const club =
      (orgBlock ? extractFirstTag(orgBlock, 'Name') : null) || fallbackClubName;
    const orgId =
      (orgBlock
        ? extractFirstTag(orgBlock, 'OrganisationId') ?? extractFirstTag(orgBlock, 'Id')
        : null) || fallbackOrgId;

    const cardTexts = [
      ...extractAllBlocks(block, 'CCardId'),
      ...extractAllBlocks(block, 'ControlCard'),
      ...extractAllBlocks(block, 'PunchingUnitId'),
    ];
    for (const cardText of cardTexts) {
      const siNumber = Number(decodeXmlEntities(cardText).replace(/\D/g, ''));
      if (Number.isFinite(siNumber) && siNumber > 0) {
        parsed.push({
          siNumber,
          fullName,
          club,
          birthYear,
          eventorPersonId: personId,
          eventorOrgId: orgId,
        });
      }
    }
  }
  return parsed;
}

export function parseEventorClassesXml(xml: string): Map<string, string> {
  const classMap = new Map<string, string>();
  const blocks = [
    ...extractAllBlocks(xml, 'EventClass'),
    ...extractAllBlocks(xml, 'Class'),
  ];
  for (const block of blocks) {
    const id = extractFirstTag(block, 'EventClassId') ?? extractFirstTag(block, 'Id');
    const name = extractFirstTag(block, 'Name') ?? extractFirstTag(block, 'ClassShortName');
    if (id?.trim() && name?.trim()) {
      classMap.set(id.trim().slice(0, 128), name.trim().slice(0, 80));
    }
  }
  return classMap;
}

export function parseEventorEntriesXml(
  xml: string,
  classIdToName: Map<string, string>
): {
  fullName: string;
  club: string;
  className: string;
  siNumber: number;
  personId: string | null;
}[] {
  const blocks = [
    ...extractAllBlocks(xml, 'Entry'),
    ...extractAllBlocks(xml, 'PersonEntry'),
  ];
  const entries: {
    fullName: string;
    club: string;
    className: string;
    siNumber: number;
    personId: string | null;
  }[] = [];

  for (const block of blocks) {
    const personBlock =
      extractFirstTag(block, 'Competitor') ?? extractFirstTag(block, 'Person') ?? block;
    const nameBlock = extractFirstTag(personBlock, 'Name') ?? personBlock;
    const given = extractFirstTag(nameBlock, 'Given') ?? '';
    const family = extractFirstTag(nameBlock, 'Family') ?? '';
    const fullName = `${given} ${family}`.trim().slice(0, 120);
    if (!fullName) continue;

    const personId =
      extractFirstTag(personBlock, 'PersonId') ??
      extractFirstTag(personBlock, 'Id') ??
      null;

    const orgBlock =
      extractFirstTag(block, 'Organisation') ??
      extractFirstTag(personBlock, 'Organisation');
    const club = (
      (orgBlock ? extractFirstTag(orgBlock, 'Name') : null) || 'Klubblös'
    ).slice(0, 100);

    const entryClassBlock =
      extractFirstTag(block, 'EntryClass') ?? extractFirstTag(block, 'Class') ?? block;
    const eventClassId =
      extractFirstTag(entryClassBlock, 'EventClassId') ??
      extractFirstTag(block, 'EventClassId') ??
      extractFirstTag(entryClassBlock, 'Id') ??
      '';
    const directClassName = extractFirstTag(entryClassBlock, 'Name');
    const className = (
      (eventClassId && classIdToName.get(eventClassId)) ||
      directClassName ||
      'Öppen Motion'
    ).slice(0, 80);

    const cardTexts = [
      ...extractAllBlocks(block, 'CCardId'),
      ...extractAllBlocks(block, 'ControlCard'),
      ...extractAllBlocks(block, 'PunchingUnitId'),
    ];
    let siNumber = 0;
    for (const cardText of cardTexts) {
      const candidate = Number(decodeXmlEntities(cardText).replace(/\D/g, ''));
      if (Number.isInteger(candidate) && candidate > 0 && candidate <= 99999999) {
        siNumber = candidate;
        break;
      }
    }

    entries.push({
      fullName,
      club,
      className,
      siNumber,
      personId: personId?.slice(0, 128) ?? null,
    });
  }
  return entries;
}
