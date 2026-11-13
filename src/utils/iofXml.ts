import type {
  ClassCompetitionFormat,
  CompClass,
  CompetitionMeta,
  Competitor,
  Course,
  RunnerDbEntry,
} from '../types/sportident';
import { formatDurationMmSs, formatSecondsAsClock } from '../services/sportidentProtocol';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function secondsToIsoToday(dateStr: string, sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec)) return null;
  const clock = formatSecondsAsClock(sec);
  return `${dateStr}T${clock}`;
}

/**
 * Generates a valid IOF Interface Standard v3.0 ResultList XML document
 * including <SplitTime> elements compatible with Eventor and WinSplits Online.
 */
export function buildIofResultListXml(params: {
  competition: CompetitionMeta;
  classes: CompClass[];
  courses: Course[];
  competitors: Competitor[];
}): string {
  const { competition, classes, courses, competitors } = params;
  const createTime = new Date().toISOString();

  const classBlocks = classes
    .map((cls) => {
      const course = courses.find((c) => c.id === cls.courseId) ?? null;
      const inClass = competitors.filter(
        (c) =>
          c.classId === cls.id &&
          (c.status === 'OK' ||
            c.status === 'MP' ||
            c.status === 'DNF' ||
            c.status === 'DNS' ||
            c.status === 'PRELIMINARY_FIN')
      );

      const okRunners = inClass
        .filter((c) => c.status === 'OK' && c.runningTimeSec !== null)
        .sort((a, b) => (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999));

      const others = inClass.filter((c) => c.status !== 'OK');
      const ordered = [...okRunners, ...others];

      const personResults = ordered
        .map((runner, idx) => {
          const nameParts = runner.fullName.trim().split(/\s+/);
          const given = nameParts[0] || runner.fullName;
          const family = nameParts.slice(1).join(' ') || '-';

          let iofStatus = 'OK';
          if (runner.status === 'MP') iofStatus = 'MissingPunch';
          else if (runner.status === 'DNF') iofStatus = 'DidNotFinish';
          else if (runner.status === 'DNS') iofStatus = 'DidNotStart';
          else if (runner.status === 'PRELIMINARY_FIN') iofStatus = 'Active';

          const startIso = secondsToIsoToday(
            competition.date,
            runner.startTimeSec ?? runner.allocatedStartSec
          );
          const finishIso = secondsToIsoToday(competition.date, runner.finishTimeSec);

          const splitElements = (runner.validation?.splits ?? [])
            .filter((s) => s.controlCode !== 999)
            .map((s) =>
              s.status === 'OK' && s.cumulativeSec !== null
                ? `        <SplitTime>\n          <ControlCode>${s.controlCode}</ControlCode>\n          <Time>${s.cumulativeSec}</Time>\n        </SplitTime>`
                : `        <SplitTime status="Missing">\n          <ControlCode>${s.controlCode}</ControlCode>\n        </SplitTime>`
            )
            .join('\n');

          return `    <PersonResult>
      <Person>
        <Name>
          <Given>${escapeXml(given)}</Given>
          <Family>${escapeXml(family)}</Family>
        </Name>
      </Person>
      <Organisation>
        <Name>${escapeXml(runner.club)}</Name>
      </Organisation>
      <Result>
        <BibNumber>${runner.bib}</BibNumber>
${startIso ? `        <StartTime>${startIso}</StartTime>\n` : ''}${
            finishIso ? `        <FinishTime>${finishIso}</FinishTime>\n` : ''
          }${
            runner.runningTimeSec !== null && runner.status === 'OK'
              ? `        <Time>${runner.runningTimeSec}</Time>\n        <Position>${
                  idx + 1
                }</Position>\n`
              : ''
          }        <Status>${iofStatus}</Status>
        <ControlCard>${runner.siNumber}</ControlCard>
${splitElements ? splitElements + '\n' : ''}      </Result>
    </PersonResult>`;
        })
        .join('\n');

      return `  <ClassResult>
    <Class>
      <Id>${escapeXml(cls.id)}</Id>
      <Name>${escapeXml(cls.name)}</Name>
    </Class>
${
  course
    ? `    <Course>\n      <Name>${escapeXml(course.name)}</Name>\n      <Length>${
        course.lengthMeters
      }</Length>\n      <Climb>${course.climbMeters}</Climb>\n    </Course>\n`
    : ''
}${personResults}
  </ClassResult>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="${createTime}" creator="PasserSI MeOS Web">
  <Event>
    <Name>${escapeXml(competition.name)}</Name>
    <StartTime>
      <Date>${escapeXml(competition.date)}</Date>
      <Time>${escapeXml(competition.zeroTimeStr)}</Time>
    </StartTime>
  </Event>
${classBlocks}
</ResultList>`;
}

export interface ParsedIofCourse {
  name: string;
  courseFamily?: string;
  lengthMeters: number;
  climbMeters: number;
  controls: number[];
}

export interface ParsedIofClassAssignment {
  name: string;
  courseName?: string;
  classFormat?: ClassCompetitionFormat;
  forkCourseNames?: string[];
  freeStart?: boolean;
  autoMatchCourse?: boolean;
}

export interface ParsedIofDocument {
  type: 'CourseData' | 'EntryList' | 'EventList' | 'CompetitorList';
  iofVersion?: '3.0' | '2.0.3';
  eventName?: string;
  creator?: string;
  courses: ParsedIofCourse[];
  classes: ParsedIofClassAssignment[];
  entries: { fullName: string; club: string; className: string; siNumber: number }[];
  runnerDbEntries: {
    siNumber: number;
    fullName: string;
    club: string;
    birthYear?: number | null;
    defaultClassName?: string | null;
    eventorPersonId?: string | null;
  }[];
}

function directChildrenByLocalName(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const ch = parent.children[i];
    if (ch.localName === localName) out.push(ch);
  }
  return out;
}

function directChildText(parent: Element, localName: string): string {
  const el = directChildrenByLocalName(parent, localName)[0];
  return el?.textContent?.trim() || '';
}

function parseMetersElement(el: Element | undefined, maxMeters: number): number {
  if (!el) return 0;
  const raw = (el.textContent || '').trim().replace(',', '.');
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;
  const unit = (el.getAttribute('unit') || '').trim().toLowerCase();
  const meters = unit === 'km' ? num * 1000 : num;
  return Math.max(0, Math.min(maxMeters, Math.round(meters)));
}

function parseControlCodeNumber(rawCode: string): number | null {
  const cleaned = rawCode.trim();
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const codeNum = Math.round(Number(cleaned));
  if (!Number.isFinite(codeNum) || codeNum < 1 || codeNum > 511) return null;
  return codeNum;
}

/**
 * Builds the effective course + class batch from a parsed CourseData XML document,
 * automatically synthesizing 1 class per course (or 1 FORKED class per multi-course family)
 * when the XML file lacks explicit class-to-course assignments.
 */
export function buildEffectiveCourseImportBatch(
  parsed: Pick<ParsedIofDocument, 'courses' | 'classes'>,
  options: {
    autoCreateClassesIfMissing: boolean;
    freeStart: boolean;
  }
): {
  courses: ParsedIofCourse[];
  classes: ParsedIofClassAssignment[];
  classesSynthesized: boolean;
} {
  if (parsed.classes.length > 0) {
    return {
      courses: parsed.courses,
      classes: parsed.classes.map((cls) => ({
        ...cls,
        freeStart: cls.freeStart ?? options.freeStart,
        autoMatchCourse:
          cls.classFormat === 'FORKED'
            ? true
            : cls.autoMatchCourse ?? options.freeStart,
      })),
      classesSynthesized: false,
    };
  }

  if (!options.autoCreateClassesIfMissing || parsed.courses.length === 0) {
    return {
      courses: parsed.courses,
      classes: [],
      classesSynthesized: false,
    };
  }

  const familyGroups = new Map<string, ParsedIofCourse[]>();
  for (const c of parsed.courses) {
    if (c.courseFamily) {
      const key = c.courseFamily.toLowerCase();
      const arr = familyGroups.get(key) ?? [];
      arr.push(c);
      familyGroups.set(key, arr);
    }
  }

  const emittedFamilies = new Set<string>();
  const synthesized: ParsedIofClassAssignment[] = [];

  for (const c of parsed.courses) {
    const famKey = c.courseFamily?.toLowerCase();
    const famMembers = famKey ? familyGroups.get(famKey) : undefined;
    if (famKey && famMembers && famMembers.length > 1) {
      if (emittedFamilies.has(famKey)) continue;
      emittedFamilies.add(famKey);
      synthesized.push({
        name: c.courseFamily!.slice(0, 80),
        courseName: famMembers[0].name,
        classFormat: 'FORKED',
        forkCourseNames: famMembers.map((m) => m.name).slice(0, 32),
        freeStart: options.freeStart,
        autoMatchCourse: true,
      });
    } else {
      synthesized.push({
        name: c.name.slice(0, 80),
        courseName: c.name,
        classFormat: 'STANDARD',
        freeStart: options.freeStart,
        autoMatchCourse: options.freeStart,
      });
    }
  }

  return {
    courses: parsed.courses,
    classes: synthesized,
    classesSynthesized: true,
  };
}

/**
 * Parses IOF XML 3.0 & IOF XML 2.0.3 CourseData (Purple Pen / Condes / OCAD),
 * EntryList/EventList (Eventor), and CompetitorList (Eventor Löpardatabas) in the browser via DOMParser.
 */
export function parseIofXmlDocument(xmlText: string): ParsedIofDocument {
  const sanitized = xmlText.replace(/^\uFEFF/, '').trim();
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(
      'Ogiltigt XML-format. Kontrollera att filen är en giltig IOF XML-fil (3.0 eller 2.0.3).'
    );
  }

  const rootEl = doc.documentElement;
  const rootTag = rootEl.localName;
  const creator = rootEl.getAttribute('creator')?.trim() || undefined;
  const rootVerAttr = (
    rootEl.getAttribute('iofVersion') ||
    directChildText(rootEl, 'IOFVersion') ||
    doc.getElementsByTagNameNS('*', 'IOFVersion')[0]?.getAttribute('version') ||
    ''
  ).trim();

  const eventNode = doc.getElementsByTagNameNS('*', 'Event')[0];
  const eventName =
    (eventNode
      ? directChildText(eventNode, 'Name') || directChildText(eventNode, 'EventName')
      : '') ||
    directChildText(rootEl, 'EventName') ||
    undefined;

  if (rootTag === 'CourseData') {
    const courseNodes = Array.from(doc.getElementsByTagNameNS('*', 'Course'));
    const has203Structure = courseNodes.some(
      (n) =>
        directChildrenByLocalName(n, 'CourseVariation').length > 0 ||
        Boolean(directChildText(n, 'CourseName'))
    );
    const iofVersion: '3.0' | '2.0.3' =
      has203Structure || rootVerAttr.startsWith('2.') ? '2.0.3' : '3.0';

    const courses: ParsedIofCourse[] = [];
    const classToCoursesMap = new Map<string, { displayName: string; courseNames: string[] }>();

    const registerClassCourse = (rawClassName: string, targetCourseNames: string[]) => {
      const cleanCls = rawClassName.trim().slice(0, 80);
      if (!cleanCls || targetCourseNames.length === 0) return;
      const key = cleanCls.toLowerCase();
      const entry = classToCoursesMap.get(key) ?? {
        displayName: cleanCls,
        courseNames: [],
      };
      for (const cn of targetCourseNames) {
        if (!entry.courseNames.some((x) => x.toLowerCase() === cn.toLowerCase())) {
          entry.courseNames.push(cn);
        }
      }
      classToCoursesMap.set(key, entry);
    };

    const usedCourseNames = new Set<string>();
    const allocateUniqueCourseName = (desired: string): string => {
      const base = (desired.trim() || 'Importerad bana').slice(0, 110);
      if (!usedCourseNames.has(base.toLowerCase())) {
        usedCourseNames.add(base.toLowerCase());
        return base;
      }
      let suffix = 2;
      while (usedCourseNames.has(`${base} (${suffix})`.toLowerCase())) {
        suffix++;
      }
      const unique = `${base} (${suffix})`;
      usedCourseNames.add(unique.toLowerCase());
      return unique;
    };

    if (iofVersion === '2.0.3') {
      for (const cNode of courseNodes) {
        const baseName =
          directChildText(cNode, 'CourseName') ||
          directChildText(cNode, 'Name') ||
          'Importerad bana';
        const classNodes = [
          ...directChildrenByLocalName(cNode, 'ClassShortName'),
          ...directChildrenByLocalName(cNode, 'ClassName'),
        ];
        const attachedClassNames = classNodes
          .map((cn) => cn.textContent?.trim() || '')
          .filter(Boolean);

        const variations = directChildrenByLocalName(cNode, 'CourseVariation');
        const variationTargets = variations.length > 0 ? variations : [cNode];
        const createdNamesForThisCourse: string[] = [];

        variationTargets.forEach((vNode, idx) => {
          const lenEl =
            directChildrenByLocalName(vNode, 'CourseLength')[0] ||
            directChildrenByLocalName(vNode, 'Length')[0];
          const climbEl =
            directChildrenByLocalName(vNode, 'CourseClimb')[0] ||
            directChildrenByLocalName(vNode, 'Climb')[0];

          const ccNodes = directChildrenByLocalName(vNode, 'CourseControl');
          const orderedCc = [...ccNodes].sort((a, b) => {
            const seqA = Number(directChildText(a, 'Sequence'));
            const seqB = Number(directChildText(b, 'Sequence'));
            if (Number.isFinite(seqA) && Number.isFinite(seqB) && seqA > 0 && seqB > 0) {
              return seqA - seqB;
            }
            return 0;
          });

          const controls: number[] = [];
          for (const cc of orderedCc) {
            const typeAttr = cc.getAttribute('type') || directChildText(cc, 'Type') || 'Control';
            if (typeAttr === 'Start' || typeAttr === 'Finish') continue;
            const codeText =
              directChildText(cc, 'ControlCode') || directChildText(cc, 'Control');
            const codeNum = parseControlCodeNumber(codeText);
            if (codeNum !== null && controls.length < 128) {
              controls.push(codeNum);
            }
          }

          if (controls.length === 0) return;

          const varLabel =
            variationTargets.length > 1
              ? directChildText(vNode, 'Name') ||
                directChildText(vNode, 'CourseVariationId') ||
                `Gaffel ${idx + 1}`
              : '';
          const finalCourseName = allocateUniqueCourseName(
            varLabel ? `${baseName} (${varLabel})` : baseName
          );

          courses.push({
            name: finalCourseName,
            courseFamily: variationTargets.length > 1 ? baseName : undefined,
            lengthMeters: parseMetersElement(lenEl, 200000),
            climbMeters: parseMetersElement(climbEl, 20000),
            controls,
          });
          createdNamesForThisCourse.push(finalCourseName);
        });

        for (const clsName of attachedClassNames) {
          registerClassCourse(clsName, createdNamesForThisCourse);
        }
      }
    } else {
      // IOF XML 3.0 CourseData
      for (const node of courseNodes) {
        const ccNodes = directChildrenByLocalName(node, 'CourseControl');
        if (ccNodes.length === 0) continue;

        const rawName = directChildText(node, 'Name') || 'Importerad bana';
        const rawFamily = directChildText(node, 'CourseFamily') || undefined;
        const lenEl = directChildrenByLocalName(node, 'Length')[0];
        const climbEl = directChildrenByLocalName(node, 'Climb')[0];

        const controls: number[] = [];
        for (const cc of ccNodes) {
          const typeAttr = cc.getAttribute('type') || '';
          const typeChild = directChildText(cc, 'Type');
          const ctrlType = typeAttr || typeChild || 'Control';
          if (ctrlType === 'Start' || ctrlType === 'Finish') continue;

          const codeText =
            directChildText(cc, 'Control') || directChildText(cc, 'ControlCode');
          const codeNum = parseControlCodeNumber(codeText);
          if (codeNum !== null && controls.length < 128) {
            controls.push(codeNum);
          }
        }

        if (controls.length === 0) continue;

        const hadDuplicateName = usedCourseNames.has(rawName.trim().toLowerCase());
        const uniqueName = allocateUniqueCourseName(rawName);

        courses.push({
          name: uniqueName,
          courseFamily: rawFamily || (hadDuplicateName ? rawName.trim() : undefined),
          lengthMeters: parseMetersElement(lenEl, 200000),
          climbMeters: parseMetersElement(climbEl, 20000),
          controls,
        });
      }

      const assignmentNodes = Array.from(
        doc.getElementsByTagNameNS('*', 'ClassCourseAssignment')
      );
      for (const an of assignmentNodes) {
        const clsName = directChildText(an, 'ClassName');
        const targetCourseName = directChildText(an, 'CourseName');
        const targetFamily = directChildText(an, 'CourseFamily');
        if (!clsName) continue;

        const matchedNames: string[] = [];
        if (targetCourseName) {
          const exact = courses.filter(
            (c) => c.name.toLowerCase() === targetCourseName.toLowerCase()
          );
          matchedNames.push(...exact.map((c) => c.name));
        }
        if (matchedNames.length === 0 && targetFamily) {
          const byFam = courses.filter(
            (c) => (c.courseFamily || '').toLowerCase() === targetFamily.toLowerCase()
          );
          matchedNames.push(...byFam.map((c) => c.name));
        }
        if (matchedNames.length === 0 && targetCourseName) {
          // Also check if CourseName in XML actually referred to a CourseFamily
          const byFamFallback = courses.filter(
            (c) => (c.courseFamily || '').toLowerCase() === targetCourseName.toLowerCase()
          );
          matchedNames.push(...byFamFallback.map((c) => c.name));
        }

        if (matchedNames.length > 0) {
          registerClassCourse(clsName, matchedNames);
        } else if (courses.length > 0) {
          registerClassCourse(clsName, [courses[0].name]);
        }
      }
    }

    if (courses.length === 0) {
      throw new Error(
        'Inga banor med kontroller hittades i XML-filen. Kontrollera att du exporterat en banfil (IOF XML 3.0 eller 2.0.3) från Purple Pen, Condes eller OCAD.'
      );
    }

    const classes: ParsedIofClassAssignment[] = Array.from(classToCoursesMap.values()).map(
      (entry) => {
        if (entry.courseNames.length > 1) {
          return {
            name: entry.displayName,
            courseName: entry.courseNames[0],
            classFormat: 'FORKED',
            forkCourseNames: entry.courseNames.slice(0, 32),
          };
        }
        return {
          name: entry.displayName,
          courseName: entry.courseNames[0],
          classFormat: 'STANDARD',
        };
      }
    );

    return {
      type: 'CourseData',
      iofVersion,
      eventName,
      creator,
      courses,
      classes,
      entries: [],
      runnerDbEntries: [],
    };
  }

  if (rootTag === 'EntryList' || rootTag === 'EventList') {
    const personEntries = Array.from(doc.getElementsByTagNameNS('*', 'PersonEntry'));
    const nestedPersonEntries = new Set(
      personEntries.flatMap((personEntry) => {
        let parent = personEntry.parentElement;
        const ancestors: Element[] = [];
        while (parent && parent !== rootEl) {
          ancestors.push(parent);
          parent = parent.parentElement;
        }
        return ancestors;
      })
    );
    const standaloneEntries =
      rootTag === 'EventList'
        ? Array.from(doc.getElementsByTagNameNS('*', 'Entry')).filter(
            (entry) => !nestedPersonEntries.has(entry)
          )
        : [];
    const importEntries = [...personEntries, ...standaloneEntries];
    const entries: { fullName: string; club: string; className: string; siNumber: number }[] = [];
    const runnerDbEntries: {
      siNumber: number;
      fullName: string;
      club: string;
      birthYear?: number | null;
      defaultClassName?: string | null;
      eventorPersonId?: string | null;
    }[] = [];
    const classSet = new Set<string>();

    if (rootTag === 'EventList') {
      for (const classNode of [
        ...Array.from(doc.getElementsByTagNameNS('*', 'EventClass')),
        ...Array.from(doc.getElementsByTagNameNS('*', 'Class')),
      ]) {
        const className =
          classNode.getElementsByTagNameNS('*', 'Name')[0]?.textContent?.trim() ||
          classNode.getElementsByTagNameNS('*', 'ClassShortName')[0]?.textContent?.trim();
        if (className) classSet.add(className);
      }
    }

    for (const pe of importEntries) {
      const given = pe.getElementsByTagNameNS('*', 'Given')[0]?.textContent?.trim() || '';
      const family = pe.getElementsByTagNameNS('*', 'Family')[0]?.textContent?.trim() || '';
      const fullName = `${given} ${family}`.trim() || 'Okänd anmäld';

      const orgEl = pe.getElementsByTagNameNS('*', 'Organisation')[0];
      const club = orgEl?.getElementsByTagNameNS('*', 'Name')[0]?.textContent?.trim() || 'Klubblös';

      const classEl = pe.getElementsByTagNameNS('*', 'Class')[0];
      const className =
        classEl?.getElementsByTagNameNS('*', 'Name')[0]?.textContent?.trim() || 'Öppen Motion';
      classSet.add(className);

      const ccText =
        pe.getElementsByTagNameNS('*', 'ControlCard')[0]?.textContent?.trim() ||
        pe.getElementsByTagNameNS('*', 'CardNumber')[0]?.textContent?.trim() ||
        pe.getElementsByTagNameNS('*', 'CCardId')[0]?.textContent?.trim() ||
        '0';
      const siNumber = Number(ccText.replace(/\D/g, '')) || 0;

      entries.push({ fullName, club, className, siNumber });
      if (siNumber > 0) {
        runnerDbEntries.push({
          siNumber,
          fullName,
          club,
          defaultClassName: className,
        });
      }
    }

    return {
      type: rootTag === 'EventList' ? 'EventList' : 'EntryList',
      courses: [],
      classes: Array.from(classSet).map((name) => ({ name })),
      entries,
      runnerDbEntries,
    };
  }

  if (rootTag === 'CompetitorList') {
    const compNodes = [
      ...Array.from(doc.getElementsByTagNameNS('*', 'Competitor')),
      ...Array.from(doc.getElementsByTagNameNS('*', 'PersonEntry')),
    ];
    const runnerDbEntries: {
      siNumber: number;
      fullName: string;
      club: string;
      birthYear?: number | null;
      defaultClassName?: string | null;
      eventorPersonId?: string | null;
    }[] = [];

    for (const node of compNodes) {
      const given = node.getElementsByTagNameNS('*', 'Given')[0]?.textContent?.trim() || '';
      const family = node.getElementsByTagNameNS('*', 'Family')[0]?.textContent?.trim() || '';
      const fullName = `${given} ${family}`.trim();
      if (!fullName) continue;

      const orgEl = node.getElementsByTagNameNS('*', 'Organisation')[0];
      const club = orgEl?.getElementsByTagNameNS('*', 'Name')[0]?.textContent?.trim() || 'Klubblös';

      const birthText =
        node.getElementsByTagNameNS('*', 'BirthDate')[0]?.textContent?.trim() || '';
      const birthMatch = birthText.match(/\b(19\d{2}|20\d{2})\b/);
      const birthYear = birthMatch ? Number(birthMatch[1]) : null;

      const personId =
        node.getElementsByTagNameNS('*', 'Id')[0]?.textContent?.trim() ||
        node.getElementsByTagNameNS('*', 'PersonId')[0]?.textContent?.trim() ||
        null;

      const clsEl = node.getElementsByTagNameNS('*', 'Class')[0];
      const defaultClassName =
        clsEl?.getElementsByTagNameNS('*', 'Name')[0]?.textContent?.trim() || null;

      const cardEls = [
        ...Array.from(node.getElementsByTagNameNS('*', 'ControlCard')),
        ...Array.from(node.getElementsByTagNameNS('*', 'CCardId')),
        ...Array.from(node.getElementsByTagNameNS('*', 'PunchingUnitId')),
      ];

      for (const ce of cardEls) {
        const siNumber = Number((ce.textContent || '').replace(/\D/g, ''));
        if (Number.isFinite(siNumber) && siNumber > 0) {
          runnerDbEntries.push({
            siNumber,
            fullName,
            club,
            birthYear,
            defaultClassName,
            eventorPersonId: personId,
          });
        }
      }
    }

    return {
      type: 'CompetitorList',
      courses: [],
      classes: [],
      entries: [],
      runnerDbEntries,
    };
  }

  throw new Error(
    `Rot-elementet <${rootTag}> stöds ej. Importera IOF XML (3.0 eller 2.0.3) <CourseData>, <EntryList>, <EventList> eller <CompetitorList>.`
  );
}

/**
 * Parses a MeOS / Eventor CSV or XML runner database list:
 * Supports CSV lines like: SI;Namn;Klubb;Födelseår;Klass OR Namn;Klubb;SI
 */
export function parseRunnerDbCsvOrXml(rawText: string): {
  siNumber: number;
  fullName: string;
  club: string;
  birthYear?: number | null;
  defaultClassName?: string | null;
}[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('<')) {
    const parsed = parseIofXmlDocument(trimmed);
    return parsed.runnerDbEntries;
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const results: {
    siNumber: number;
    fullName: string;
    club: string;
    birthYear?: number | null;
    defaultClassName?: string | null;
  }[] = [];

  for (const line of lines) {
    const cols = line
      .split(/[;,\t]/)
      .map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;

    // Skip header row if detected
    if (
      cols[0].toLowerCase().includes('brick') ||
      cols[0].toLowerCase() === 'si' ||
      cols[0].toLowerCase().includes('namn')
    ) {
      continue;
    }

    // Format A: SI;Namn;Klubb;Födelseår?;Klass?
    const firstAsNum = Number(cols[0].replace(/\s+/g, ''));
    if (Number.isFinite(firstAsNum) && firstAsNum >= 1000 && cols[1]) {
      const birthNum = cols[3] ? Number(cols[3]) : null;
      results.push({
        siNumber: firstAsNum,
        fullName: cols[1],
        club: cols[2] || 'Klubblös',
        birthYear: birthNum && birthNum > 1900 && birthNum < 2030 ? birthNum : null,
        defaultClassName: cols[4] || null,
      });
      continue;
    }

    // Format B: Namn;Klubb;SI
    const thirdAsNum = cols[2] ? Number(cols[2].replace(/\s+/g, '')) : NaN;
    if (Number.isFinite(thirdAsNum) && thirdAsNum >= 1000 && cols[0]) {
      results.push({
        siNumber: thirdAsNum,
        fullName: cols[0],
        club: cols[1] || 'Klubblös',
        birthYear: null,
        defaultClassName: cols[3] || null,
      });
    }
  }

  return results;
}

export function exportRunnerDbCsv(runnerDb: RunnerDbEntry[]): void {
  const rows: string[][] = [
    ['SI-bricka', 'Namn', 'Klubb', 'Födelseår', 'Standardklass', 'Källa'],
    ...runnerDb.map((r) => [
      String(r.siNumber),
      r.fullName,
      r.club,
      r.birthYear ? String(r.birthYear) : '',
      r.defaultClassName ?? '',
      r.source,
    ]),
  ];
  const csv = '\uFEFF' + rows.map((r) => r.join(';')).join('\r\n');
  triggerTextFileDownload(
    `lopardatabas-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    'text/csv;charset=utf-8;'
  );
}

export function triggerTextFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportForestSafetyCsv(
  competitors: Competitor[],
  classes: CompClass[]
): void {
  const inForest = competitors.filter(
    (c) => c.status === 'CHECKED' || c.status === 'IN_FOREST' || c.status === 'PRELIMINARY_FIN'
  );
  const rows: string[][] = [
    [
      'Startnr',
      'Namn',
      'Klubb',
      'Klass',
      'SI-bricka',
      'Hyrbricka',
      'Status',
      'Starttid',
      'Senast sedd kontroll',
      'Senaste tid',
    ],
    ...inForest.map((c) => {
      const cls = classes.find((k) => k.id === c.classId)?.name ?? '-';
      return [
        String(c.bib),
        c.fullName,
        c.club,
        cls,
        String(c.siNumber),
        c.isRentalCard ? 'Ja' : 'Nej',
        c.status,
        formatSecondsAsClock(c.startTimeSec ?? c.allocatedStartSec),
        c.lastSeenControl ? `(${c.lastSeenControl})` : '-',
        formatSecondsAsClock(c.lastSeenTimeSec),
      ];
    }),
  ];

  const csv = '\uFEFF' + rows.map((r) => r.join(';')).join('\r\n');
  triggerTextFileDownload(
    `kvar-i-skogen-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    'text/csv;charset=utf-8;'
  );
}

export function buildIofStartListXml(params: {
  competition: CompetitionMeta;
  classes: CompClass[];
  courses: Course[];
  competitors: Competitor[];
}): string {
  const { competition, classes, courses, competitors } = params;
  const createTime = new Date().toISOString();

  const classStarts = classes
    .map((cls) => {
      const course = courses.find((c) => c.id === cls.courseId) ?? null;
      const inClass = competitors
        .filter((c) => c.classId === cls.id)
        .sort((a, b) => (a.allocatedStartSec ?? 999999) - (b.allocatedStartSec ?? 999999));

      const personStarts = inClass
        .map((r) => {
          const nameParts = r.fullName.trim().split(/\s+/);
          const given = nameParts[0] || r.fullName;
          const family = nameParts.slice(1).join(' ') || '-';
          const startIso = secondsToIsoToday(
            competition.date,
            r.allocatedStartSec ?? r.startTimeSec
          );

          return `    <PersonStart>
      <Person>
        <Name>
          <Given>${escapeXml(given)}</Given>
          <Family>${escapeXml(family)}</Family>
        </Name>
      </Person>
      <Organisation>
        <Name>${escapeXml(r.club)}</Name>
      </Organisation>
      <Start>
        <BibNumber>${r.bib}</BibNumber>
${startIso ? `        <StartTime>${startIso}</StartTime>\n` : ''}        <ControlCard>${r.siNumber}</ControlCard>
      </Start>
    </PersonStart>`;
        })
        .join('\n');

      return `  <ClassStart>
    <Class>
      <Id>${escapeXml(cls.id)}</Id>
      <Name>${escapeXml(cls.name)}</Name>
    </Class>
${
  course
    ? `    <Course>\n      <Name>${escapeXml(course.name)}</Name>\n      <Length>${course.lengthMeters}</Length>\n      <Climb>${course.climbMeters}</Climb>\n    </Course>\n`
    : ''
}${personStarts}
  </ClassStart>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="${createTime}" creator="PasserSI">
  <Event>
    <Name>${escapeXml(competition.name)}</Name>
    <StartTime>
      <Date>${escapeXml(competition.date)}</Date>
      <Time>${escapeXml(competition.zeroTimeStr)}</Time>
    </StartTime>
  </Event>
${classStarts}
</StartList>`;
}

export function exportClassResultsCsv(
  competitors: Competitor[],
  classes: CompClass[]
): void {
  const rows: string[][] = [
    ['Klass', 'Placering', 'Startnr', 'Namn', 'Klubb', 'SI-bricka', 'Status', 'Poäng', 'Sluttid'],
  ];

  for (const cls of classes) {
    const isRogaining = cls.classFormat === 'ROGAINING';
    const runners = competitors.filter((c) => c.classId === cls.id);
    const ok = runners
      .filter((c) => c.status === 'OK' && c.runningTimeSec !== null)
      .sort((a, b) => {
        if (isRogaining) {
          const pa = a.validation?.rogainingPoints ?? 0;
          const pb = b.validation?.rogainingPoints ?? 0;
          if (pb !== pa) return pb - pa;
        }
        return (a.runningTimeSec ?? 999999) - (b.runningTimeSec ?? 999999);
      });
    const rest = runners.filter((c) => c.status !== 'OK');

    ok.forEach((r, idx) => {
      rows.push([
        cls.name,
        String(idx + 1),
        String(r.bib),
        r.fullName,
        r.club,
        String(r.siNumber),
        'OK',
        isRogaining ? String(r.validation?.rogainingPoints ?? 0) : '',
        formatDurationMmSs(r.runningTimeSec),
      ]);
    });
    rest.forEach((r) => {
      rows.push([
        cls.name,
        '-',
        String(r.bib),
        r.fullName,
        r.club,
        String(r.siNumber),
        r.status,
        '',
        formatDurationMmSs(r.runningTimeSec),
      ]);
    });
  }

  const csv = '\uFEFF' + rows.map((r) => r.join(';')).join('\r\n');
  triggerTextFileDownload(
    `resultatlista-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    'text/csv;charset=utf-8;'
  );
}

export const SAMPLE_OCAD_COURSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="Purple Pen 3.5.1">
  <Event>
    <Name>Torsdagsträning Lunsen</Name>
  </Event>
  <RaceCourseData>
    <Course>
      <Name>Lång 5,3 km</Name>
      <Length>5320</Length>
      <Climb>125</Climb>
      <CourseControl type="Start"><Control>S1</Control></CourseControl>
      <CourseControl type="Control"><Control>31</Control></CourseControl>
      <CourseControl type="Control"><Control>35</Control></CourseControl>
      <CourseControl type="Control"><Control>42</Control></CourseControl>
      <CourseControl type="Control"><Control>48</Control></CourseControl>
      <CourseControl type="Control"><Control>55</Control></CourseControl>
      <CourseControl type="Control"><Control>62</Control></CourseControl>
      <CourseControl type="Control"><Control>100</Control></CourseControl>
      <CourseControl type="Finish"><Control>M1</Control></CourseControl>
    </Course>
    <Course>
      <Name>Mellan 3,8 km</Name>
      <Length>3810</Length>
      <Climb>85</Climb>
      <CourseControl type="Start"><Control>S1</Control></CourseControl>
      <CourseControl type="Control"><Control>31</Control></CourseControl>
      <CourseControl type="Control"><Control>42</Control></CourseControl>
      <CourseControl type="Control"><Control>55</Control></CourseControl>
      <CourseControl type="Control"><Control>62</Control></CourseControl>
      <CourseControl type="Control"><Control>100</Control></CourseControl>
      <CourseControl type="Finish"><Control>M1</Control></CourseControl>
    </Course>
    <Course>
      <Name>Kort 2,4 km</Name>
      <Length>2430</Length>
      <Climb>45</Climb>
      <CourseControl type="Start"><Control>S1</Control></CourseControl>
      <CourseControl type="Control"><Control>32</Control></CourseControl>
      <CourseControl type="Control"><Control>42</Control></CourseControl>
      <CourseControl type="Control"><Control>55</Control></CourseControl>
      <CourseControl type="Control"><Control>100</Control></CourseControl>
      <CourseControl type="Finish"><Control>M1</Control></CourseControl>
    </Course>
    <Course>
      <Name>Inskolning 1,6 km</Name>
      <Length>1620</Length>
      <Climb>20</Climb>
      <CourseControl type="Start"><Control>S1</Control></CourseControl>
      <CourseControl type="Control"><Control>32</Control></CourseControl>
      <CourseControl type="Control"><Control>56</Control></CourseControl>
      <CourseControl type="Control"><Control>100</Control></CourseControl>
      <CourseControl type="Finish"><Control>M1</Control></CourseControl>
    </Course>
  </RaceCourseData>
</CourseData>`;

export const SAMPLE_EVENTOR_ENTRY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="Eventor Sverige">
  <Event>
    <Name>Höstsprinten 2026</Name>
  </Event>
  <PersonEntry>
    <Person>
      <Name><Given>Tove</Given><Family>Alexandersson</Family></Name>
    </Person>
    <Organisation><Name>Stora Tuna OK</Name></Organisation>
    <Class><Name>D21</Name></Class>
    <ControlCard>8501992</ControlCard>
  </PersonEntry>
  <PersonEntry>
    <Person>
      <Name><Given>Emil</Given><Family>Svensk</Family></Name>
    </Person>
    <Organisation><Name>Stora Tuna OK</Name></Organisation>
    <Class><Name>H21</Name></Class>
    <ControlCard>8502410</ControlCard>
  </PersonEntry>
</EntryList>`;

export const SAMPLE_EVENTOR_COMPETITOR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CompetitorList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="Eventor Sverige">
  <Competitor>
    <Person>
      <Id>104921</Id>
      <Name><Given>Gustav</Given><Family>Bergman</Family></Name>
      <BirthDate>1990-12-04</BirthDate>
    </Person>
    <Organisation><Name>OK Ravinen</Name></Organisation>
    <ControlCard>8509112</ControlCard>
  </Competitor>
  <Competitor>
    <Person>
      <Id>108312</Id>
      <Name><Given>Hanna</Given><Family>Lundberg</Family></Name>
      <BirthDate>2002-07-16</BirthDate>
    </Person>
    <Organisation><Name>OK Renen</Name></Organisation>
    <ControlCard>8509448</ControlCard>
  </Competitor>
</CompetitorList>`;
