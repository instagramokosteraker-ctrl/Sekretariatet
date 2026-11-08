import React, { useMemo, useState } from 'react';
import { Edit2, FileCode, Plus, Trash2, Upload, X } from 'lucide-react';
import type {
  ClassCompetitionFormat,
  CompClass,
  Competitor,
  Course,
} from '../types/sportident';
import {
  SAMPLE_OCAD_COURSE_XML,
  buildEffectiveCourseImportBatch,
  parseIofXmlDocument,
  type ParsedIofClassAssignment,
  type ParsedIofCourse,
  type ParsedIofDocument,
} from '../utils/iofXml';

interface CoursesClassesViewProps {
  courses: Course[];
  classes: CompClass[];
  competitors: Competitor[];
  feeTrackingEnabled?: boolean;
  onSaveCourse: (payload: Partial<Course>, existingId?: string) => Promise<void>;
  onDeleteCourse: (id: string) => Promise<void>;
  onSaveClass: (payload: Partial<CompClass>, existingId?: string) => Promise<void>;
  onImportCourseBatch: (payload: {
    courses: ParsedIofCourse[];
    classes: ParsedIofClassAssignment[];
    replaceExisting: boolean;
    defaultFreeStart: boolean;
  }) => Promise<{
    addedCourses: number;
    addedClasses: number;
    replaced?: boolean;
  }>;
}

export function CoursesClassesView({
  courses,
  classes,
  competitors,
  feeTrackingEnabled = false,
  onSaveCourse,
  onDeleteCourse,
  onSaveClass,
  onImportCourseBatch,
}: CoursesClassesViewProps) {
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseName, setCourseName] = useState('');
  const [lengthMeters, setLengthMeters] = useState('4200');
  const [climbMeters, setClimbMeters] = useState('110');
  const [controlsText, setControlsText] = useState('31, 42, 55, 100');
  const [courseActionError, setCourseActionError] = useState<string | null>(null);

  const [classModalOpen, setClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<CompClass | null>(null);
  const [className, setClassName] = useState('');
  const [classFormat, setClassFormat] = useState<ClassCompetitionFormat>('STANDARD');
  const [classCourseId, setClassCourseId] = useState<string>(courses[0]?.id ?? '');
  const [forkCourseIds, setForkCourseIds] = useState<string[]>([]);
  const [rogainingMaxMin, setRogainingMaxMin] = useState<string>('45');
  const [rogainingPenaltyPerMin, setRogainingPenaltyPerMin] = useState<string>('10');
  const [freeStart, setFreeStart] = useState(true);
  const [autoMatchCourse, setAutoMatchCourse] = useState(false);
  const [classFeeSek, setClassFeeSek] = useState('100');

  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [importParsed, setImportParsed] = useState<ParsedIofDocument | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importReplaceExisting, setImportReplaceExisting] = useState(true);
  const [importAutoClasses, setImportAutoClasses] = useState(true);
  const [importFreeStart, setImportFreeStart] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const effectiveImport = useMemo(() => {
    if (!importParsed) return null;
    return buildEffectiveCourseImportBatch(importParsed, {
      autoCreateClassesIfMissing: importAutoClasses,
      freeStart: importFreeStart,
    });
  }, [importParsed, importAutoClasses, importFreeStart]);

  // MeOS "Kontrollstatus": How many runners in forest/registered still have each control ahead of them?
  const controlStatusList = useMemo(() => {
    const allCodes = Array.from(
      new Set(courses.flatMap((c) => c.controls))
    ).sort((a, b) => a - b);

    return allCodes.map((code) => {
      const coursesUsing = courses.filter((c) => c.controls.includes(code));
      const classIdsUsing = new Set(
        classes
          .filter((cl) => {
            if (cl.classFormat === 'FORKED' && cl.forkCourseIds?.length) {
              return coursesUsing.some((cr) => cl.forkCourseIds!.includes(cr.id));
            }
            return coursesUsing.some((cr) => cr.id === cl.courseId);
          })
          .map((cl) => cl.id)
      );

      const activeRunnersRemaining = competitors.filter((r) => {
        if (!classIdsUsing.has(r.classId)) return false;
        if (r.status !== 'CHECKED' && r.status !== 'IN_FOREST') return false;
        const passedThisRadio = r.radioSplits.some((s) => s.controlCode === code);
        return !passedThisRadio;
      }).length;

      return {
        code,
        courseCount: coursesUsing.length,
        activeRunnersRemaining,
      };
    });
  }, [courses, classes, competitors]);

  const openNewCourse = () => {
    setCourseActionError(null);
    setEditingCourse(null);
    setCourseName('');
    setLengthMeters('4200');
    setClimbMeters('110');
    setControlsText('31, 42, 55, 100');
    setCourseModalOpen(true);
  };

  const openEditCourse = (c: Course) => {
    setCourseActionError(null);
    setEditingCourse(c);
    setCourseName(c.name);
    setLengthMeters(String(c.lengthMeters));
    setClimbMeters(String(c.climbMeters));
    setControlsText(c.controls.join(', '));
    setCourseModalOpen(true);
  };

  const openNewClass = () => {
    setEditingClass(null);
    setClassName('');
    setClassFormat('STANDARD');
    setClassCourseId(courses[0]?.id ?? '');
    setForkCourseIds(courses.slice(0, 2).map((c) => c.id));
    setRogainingMaxMin('45');
    setRogainingPenaltyPerMin('10');
    setFreeStart(true);
    setAutoMatchCourse(false);
    setClassFeeSek('100');
    setClassModalOpen(true);
  };

  const openEditClass = (cls: CompClass) => {
    setEditingClass(cls);
    setClassName(cls.name);
    setClassFormat(cls.classFormat ?? 'STANDARD');
    setClassCourseId(cls.courseId ?? courses[0]?.id ?? '');
    setForkCourseIds(
      cls.forkCourseIds && cls.forkCourseIds.length > 0
        ? cls.forkCourseIds
        : cls.courseId
        ? [cls.courseId]
        : []
    );
    setRogainingMaxMin(
      cls.rogainingMaxTimeSec ? String(Math.round(cls.rogainingMaxTimeSec / 60)) : '45'
    );
    setRogainingPenaltyPerMin(
      cls.rogainingPenaltyPerMin ? String(cls.rogainingPenaltyPerMin) : '10'
    );
    setFreeStart(cls.freeStart);
    setAutoMatchCourse(cls.autoMatchCourse);
    setClassFeeSek(String(cls.feeSek ?? 100));
    setClassModalOpen(true);
  };

  const toggleForkCourse = (courseId: string) => {
    setForkCourseIds((prev) =>
      prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]
    );
  };

  const submitCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedControls = controlsText
      .split(/[\s,;-]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 511);
    if (!courseName.trim() || parsedControls.length === 0) return;

    setCourseActionError(null);
    try {
      await onSaveCourse(
        {
          name: courseName.trim(),
          lengthMeters: Number(lengthMeters) || 3500,
          climbMeters: Number(climbMeters) || 80,
          controls: parsedControls,
        },
        editingCourse?.id
      );
      setCourseModalOpen(false);
    } catch (error) {
      setCourseActionError(
        error instanceof Error ? error.message : 'Kunde inte spara banan.'
      );
    }
  };

  const submitClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim()) return;

    const effectiveCourseId =
      classFormat === 'FORKED'
        ? forkCourseIds[0] ?? classCourseId ?? null
        : classFormat === 'ROGAINING'
        ? null
        : classCourseId || null;

    await onSaveClass(
      {
        name: className.trim(),
        courseId: effectiveCourseId,
        classFormat,
        forkCourseIds: classFormat === 'FORKED' ? forkCourseIds : [],
        rogainingMaxTimeSec:
          classFormat === 'ROGAINING'
            ? Math.max(60, (Number(rogainingMaxMin) || 45) * 60)
            : null,
        rogainingPenaltyPerMin:
          classFormat === 'ROGAINING'
            ? Math.max(1, Number(rogainingPenaltyPerMin) || 10)
            : null,
        allowDirectEntry: true,
        freeStart,
        autoMatchCourse: classFormat === 'FORKED' ? true : autoMatchCourse,
        ...(feeTrackingEnabled
          ? { feeSek: Math.max(0, Math.min(10000, Math.round(Number(classFeeSek) || 0))) }
          : {}),
      },
      editingClass?.id
    );
    setClassName('');
    setClassModalOpen(false);
  };

  const loadCourseXmlText = (rawText: string, labelName: string) => {
    setImportFeedback(null);
    try {
      const parsed = parseIofXmlDocument(rawText);
      if (parsed.type !== 'CourseData' || parsed.courses.length === 0) {
        setImportParsed(null);
        setImportFileName('');
        setImportFeedback({
          ok: false,
          msg: 'Filen är inte en banfil (<CourseData>). Använd Purple Pen, Condes eller OCAD för att exportera banor som IOF XML.',
        });
        return;
      }
      setImportParsed(parsed);
      setImportFileName(labelName);
    } catch (err: unknown) {
      setImportParsed(null);
      setImportFileName('');
      setImportFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : 'Kunde inte tolka XML-banfilen.',
      });
    }
  };

  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const rawText = await file.text();
    loadCourseXmlText(rawText, file.name);
    e.target.value = '';
  };

  const handleConfirmCourseImport = async () => {
    if (!effectiveImport || effectiveImport.courses.length === 0) return;
    setImportBusy(true);
    setImportFeedback(null);
    try {
      const res = await onImportCourseBatch({
        courses: effectiveImport.courses,
        classes: effectiveImport.classes,
        replaceExisting: importReplaceExisting,
        defaultFreeStart: importFreeStart,
      });
      const modeText = res.replaced ? 'ersatte tidigare banor' : 'lade till / uppdaterade banor';
      setImportFeedback({
        ok: true,
        msg: `Banfil "${importFileName || 'IOF XML'}" importerad (${modeText}): ${effectiveImport.courses.length} banor och ${effectiveImport.classes.length} klasser klara.`,
      });
      setImportParsed(null);
      setImportFileName('');
      setImportPanelOpen(false);
    } catch (err: unknown) {
      setImportFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : 'Kunde inte spara importerade banor.',
      });
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="space-y-3.5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Banor, Klasser, Gaffling & Poängorientering
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Importera banfil från Purple Pen / Condes / OCAD eller redigera banor & klasser direkt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !importPanelOpen;
              setImportPanelOpen(next);
              if (next) {
                setCourseModalOpen(false);
                setClassModalOpen(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium club-accent-btn rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>{importPanelOpen ? 'Stäng import' : 'Importera banfil (.xml)'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (courseModalOpen) {
                setCourseModalOpen(false);
              } else {
                setImportPanelOpen(false);
                openNewCourse();
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>{courseModalOpen ? 'Stäng' : 'Ny bana'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (classModalOpen) {
                setClassModalOpen(false);
              } else {
                setImportPanelOpen(false);
                openNewClass();
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>{classModalOpen ? 'Stäng' : 'Ny klass'}</span>
          </button>
        </div>
      </div>

      {importFeedback && (
        <div
          className={`px-3.5 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
            importFeedback.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          <span>{importFeedback.msg}</span>
          <button
            type="button"
            onClick={() => setImportFeedback(null)}
            className="p-0.5 opacity-70 hover:opacity-100 shrink-0"
            aria-label="Stäng meddelande"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {courseActionError && (
        <div
          role="alert"
          className="px-3.5 py-2 rounded-lg border text-xs bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300"
        >
          {courseActionError}
        </div>
      )}

      {/* Inline Course XML Import Panel (Purple Pen / Condes / OCAD) */}
      {importPanelOpen && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                Importera banfil från Purple Pen, Condes eller OCAD
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setImportPanelOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg shrink-0"
              aria-label="Stäng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium club-accent-btn rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span>Välj XML-banfil (.xml)</span>
                  <input
                    type="file"
                    accept=".xml,text/xml,application/xml"
                    onChange={(e) => void handleImportFileSelect(e)}
                    className="sr-only"
                  />
                </label>

                <button
                  type="button"
                  onClick={() =>
                    loadCourseXmlText(SAMPLE_OCAD_COURSE_XML, 'exempel-purplepen.xml')
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Ladda exempel (Purple Pen)</span>
                </button>
              </div>

              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Stöder både IOF XML 3.0 och IOF XML 2.0.3 (inkl. gafflade banor)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs">
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setImportReplaceExisting(true)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    importReplaceExisting
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Ersätt befintliga banor & klasser
                </button>
                <button
                  type="button"
                  onClick={() => setImportReplaceExisting(false)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    !importReplaceExisting
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Lägg till / uppdatera
                </button>
              </div>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importFreeStart}
                  onChange={(e) => setImportFreeStart(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700"
                />
                <span>Fri starttid på klasserna</span>
              </label>

              {(!importParsed || importParsed.classes.length === 0) && (
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importAutoClasses}
                    onChange={(e) => setImportAutoClasses(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700"
                  />
                  <span>Skapa 1 klass per bana om filen saknar klasser</span>
                </label>
              )}
            </div>

            {importParsed && effectiveImport && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-medium text-slate-900 dark:text-slate-100 min-w-0 truncate">
                    {importFileName} · IOF XML {importParsed.iofVersion ?? '3.0'} ·{' '}
                    {effectiveImport.courses.length} banor · {effectiveImport.classes.length}{' '}
                    klasser
                    {effectiveImport.classesSynthesized
                      ? ' (skapas automatiskt 1:1)'
                      : importParsed.classes.length > 0
                      ? ' (från banfilen)'
                      : ''}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setImportParsed(null);
                      setImportFileName('');
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap shrink-0"
                  >
                    Rensa val
                  </button>
                </div>

                <div className="max-h-40 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800/70">
                  {effectiveImport.courses.map((cr) => (
                    <div
                      key={cr.name}
                      className="px-3 py-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs"
                    >
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {cr.name}
                        <span className="ml-2 font-normal font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                          {cr.lengthMeters > 0 ? `${cr.lengthMeters} m · ` : ''}
                          {cr.climbMeters > 0 ? `+${cr.climbMeters} m · ` : ''}
                          {cr.controls.length} ktr
                        </span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate max-w-full sm:max-w-[55%]">
                        Start → {cr.controls.join('–')} → Mål
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-white/70 dark:bg-slate-900/60">
                  <button
                    type="button"
                    onClick={() => {
                      setImportParsed(null);
                      setImportFileName('');
                      setImportPanelOpen(false);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Avbryt
                  </button>
                  <button
                    type="button"
                    disabled={importBusy}
                    onClick={() => void handleConfirmCourseImport()}
                    className="px-3.5 py-1.5 text-xs font-medium club-accent-btn disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {importBusy
                      ? 'Importerar...'
                      : `Verkställ import (${effectiveImport.courses.length} banor)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Inline Course Form Panel (No Popup Modal) */}
      {courseModalOpen && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {editingCourse ? `Redigera bana: ${editingCourse.name}` : 'Skapa ny bana'}
            </h2>
            <button
              type="button"
              onClick={() => setCourseModalOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              aria-label="Stäng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={submitCourse} className="p-5 grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Bannamn
              </label>
              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="t.ex. Gaffel A — Lång 5,4 km"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Längd (m)
              </label>
              <input
                type="number"
                value={lengthMeters}
                onChange={(e) => setLengthMeters(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Stigning (m)
              </label>
              <input
                type="number"
                value={climbMeters}
                onChange={(e) => setClimbMeters(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Kontrollkoder i ordningsföljd
              </label>
              <input
                type="text"
                value={controlsText}
                onChange={(e) => setControlsText(e.target.value)}
                placeholder="31, 38, 42, 55, 61, 100"
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                required
              />
            </div>

            <div className="sm:col-span-12 flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCourseModalOpen(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Avbryt
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Spara bana
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Inline Class Form Panel (No Popup Modal) */}
      {classModalOpen && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {editingClass ? `Redigera klass: ${editingClass.name}` : 'Skapa ny klass'}
            </h2>
            <button
              type="button"
              onClick={() => setClassModalOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              aria-label="Stäng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={submitClass} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Klassnamn
                </label>
                <input
                  type="text"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="t.ex. Långa Natt (Gafflad) eller Poäng-OL 45 min"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tävlingstyp / Banformat
                </label>
                <select
                  value={classFormat}
                  onChange={(e) => setClassFormat(e.target.value as ClassCompetitionFormat)}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                >
                  <option value="STANDARD">Standard linjebana (kontroller i ordningsföljd)</option>
                  <option value="FORKED">Gafflad banpool (automatisk gaffelmatchning)</option>
                  <option value="ROGAINING">Rogaining / Poäng-OL (valfri ordning + maxtid)</option>
                </select>
              </div>

              {classFormat === 'STANDARD' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Standardbana
                  </label>
                  <select
                    value={classCourseId}
                    onChange={(e) => setClassCourseId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  >
                    {courses.map((cr) => (
                      <option key={cr.id} value={cr.id}>
                        {cr.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {feeTrackingEnabled && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Startavgift (kr)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={classFeeSek}
                    onChange={(e) => setClassFeeSek(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg"
                  />
                </div>
              )}
            </div>

            {classFormat === 'FORKED' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Tillåtna gafflingsvarianter för klassen
                </label>
                <div className="flex flex-wrap gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                  {courses.map((cr) => (
                    <label
                      key={cr.id}
                      className="inline-flex items-center gap-2 text-xs text-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={forkCourseIds.includes(cr.id)}
                        onChange={() => toggleForkCourse(cr.id)}
                        className="rounded border-slate-300 text-red-600"
                      />
                      <span>
                        {cr.name} ({cr.controls.length} ktr)
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {classFormat === 'ROGAINING' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 items-center">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Maxtid (minuter)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={rogainingMaxMin}
                    onChange={(e) => setRogainingMaxMin(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Avdrag / påbörjad min
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={rogainingPenaltyPerMin}
                    onChange={(e) => setRogainingPenaltyPerMin(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Kontrollpoäng beräknas ur kontrollens tiotal (t.ex. (31) = 30 p, (55) = 50 p, (100) =
                  100 p).
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-5">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={freeStart}
                    onChange={(e) => setFreeStart(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-red-600"
                  />
                  <span>Fri starttid</span>
                </label>
                {classFormat === 'STANDARD' && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoMatchCourse}
                      onChange={(e) => setAutoMatchCourse(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-red-600"
                    />
                    <span>Automatisk banmatchning vid målavläsning</span>
                  </label>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setClassModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Avbryt
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
                >
                  {editingClass ? 'Spara klass' : 'Skapa klass'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
        {/* Courses List */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Banor & Kontrollsekvenser ({courses.length})
            </h2>
          </div>

          <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
            {courses.map((c) => (
              <div key={c.id} className="px-3.5 py-2 flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {c.name}
                    </h3>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {c.lengthMeters} m · +{c.climbMeters} m · {c.controls.length} ktr
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-400 truncate">
                    Start → {c.controls.join('–')} → Mål
                  </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditCourse(c)}
                    className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded"
                    aria-label={`Redigera ${c.name}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {courses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCourseActionError(null);
                        void onDeleteCourse(c.id).catch((error: unknown) => {
                          setCourseActionError(
                            error instanceof Error
                              ? error.message
                              : 'Kunde inte ta bort banan.'
                          );
                        });
                      }}
                      className="p-1 text-slate-400 hover:text-red-600 rounded"
                      aria-label={`Ta bort ${c.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Classes Table */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Tävlingsklasser & Format ({classes.length})
            </h2>
          </div>

          <div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-1.5 pl-3.5 pr-2">Klass</th>
                  <th className="py-1.5 px-2">Format / Bana</th>
                  <th className="hidden sm:table-cell py-1.5 px-2">Regler</th>
                  {feeTrackingEnabled && <th className="py-1.5 px-2 text-right">Avgift</th>}
                  <th className="py-1.5 pl-2 pr-3.5 text-right">Ändra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {classes.map((cls) => {
                  const fmt = cls.classFormat ?? 'STANDARD';
                  const forkNames = (cls.forkCourseIds ?? [])
                    .map((id) => courses.find((c) => c.id === id)?.name)
                    .filter(Boolean);

                  return (
                    <tr key={cls.id}>
                      <td className="py-1.5 pl-3.5 pr-2 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {cls.name}
                      </td>
                      <td className="py-1.5 px-2 min-w-0">
                        {fmt === 'ROGAINING' ? (
                          <div className="text-slate-800 dark:text-slate-200 font-medium truncate">
                            Poäng-OL ({Math.round((cls.rogainingMaxTimeSec ?? 2700) / 60)}m / -{cls.rogainingPenaltyPerMin ?? 10}p)
                          </div>
                        ) : fmt === 'FORKED' ? (
                          <div className="text-slate-800 dark:text-slate-200 font-medium truncate max-w-[160px] sm:max-w-[200px]" title={forkNames.join(' / ')}>
                            Gafflad ({forkNames.length} st)
                          </div>
                        ) : (
                          <select
                            value={cls.courseId ?? ''}
                            onChange={(e) =>
                              void onSaveClass(
                                { courseId: e.target.value || null },
                                cls.id
                              )
                            }
                            aria-label={`Bana för ${cls.name}`}
                            className="w-full max-w-[155px] sm:max-w-[200px] px-2 py-0.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                          >
                            {courses.map((cr) => (
                              <option key={cr.id} value={cr.id}>
                                {cr.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="hidden sm:table-cell py-1.5 px-2 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {[
                          cls.freeStart ? 'Fri start' : 'Lottad',
                          fmt === 'FORKED'
                            ? 'Gaffel'
                            : fmt === 'ROGAINING'
                            ? 'Valfri'
                            : cls.autoMatchCourse
                            ? 'Autobana'
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                      {feeTrackingEnabled && (
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                          {cls.feeSek} kr
                        </td>
                      )}
                      <td className="py-1.5 pl-2 pr-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => openEditClass(cls)}
                          className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded"
                          aria-label={`Redigera klass ${cls.name}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* MeOS Control Status (Kontrollintagning) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Kontrollstatus i skogen (Kontrollintagning)
          </h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Antal löpare i terrängen med kontrollen kvar
          </span>
        </div>

        <div className="p-3 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-2">
          {controlStatusList.map((item) => (
            <div
              key={item.code}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40"
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
                  ({item.code})
                </span>
                <span className="text-[10px] text-slate-400 font-mono">{item.courseCount}b</span>
              </div>
              <div
                className={`mt-0.5 text-[11px] font-mono tabular-nums font-medium truncate ${
                  item.activeRunnersRemaining === 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {item.activeRunnersRemaining === 0
                  ? 'Klart'
                  : `${item.activeRunnersRemaining} kvar`}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
