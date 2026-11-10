import { useState } from 'react';
import { Download, RefreshCw, UserPlus } from 'lucide-react';
import {
  generateMissingSIAssignmentsFromFirestore,
  scanSIAssignmentInventoryFromFirestore,
} from '../firebase';
import {
  formatSIAssignmentInventoryMarkdown,
  SIAssignmentInventoryQueryError,
  type SIAssignmentInventoryReport,
} from '../utils/siAssignmentInventory';

export function SIAssignmentInventoryView() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SIAssignmentInventoryReport | null>(null);
  const [reportBefore, setReportBefore] = useState<SIAssignmentInventoryReport | null>(null);
  const [bootstrapSummary, setBootstrapSummary] = useState<Awaited<
    ReturnType<typeof generateMissingSIAssignmentsFromFirestore>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryFailure, setQueryFailure] = useState<SIAssignmentInventoryQueryError['diagnostic'] | null>(null);

  const runInventory = async () => {
    setBusy(true);
    setError(null);
    setQueryFailure(null);
    setReportBefore(null);
    setBootstrapSummary(null);
    try {
      setReport(await scanSIAssignmentInventoryFromFirestore());
    } catch (scanError) {
      setReport(null);
      if (scanError instanceof SIAssignmentInventoryQueryError) {
        setQueryFailure(scanError.diagnostic);
      } else {
        setError(
          scanError instanceof Error
            ? scanError.message
            : 'SI-inventeringen kunde inte genomföras.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const generateMissingAssignments = async () => {
    if (
      !window.confirm(
        'Skapa SI-kopplingar för löpare med giltigt och unikt SI-nummer som saknar koppling? Befintliga uppgifter ändras inte.'
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setQueryFailure(null);
    setReport(null);
    setReportBefore(null);
    setBootstrapSummary(null);
    try {
      const result = await generateMissingSIAssignmentsFromFirestore();
      setReportBefore(result.before);
      setReport(result.after);
      setBootstrapSummary(result);
    } catch (scanError) {
      if (scanError instanceof SIAssignmentInventoryQueryError) {
        setQueryFailure(scanError.diagnostic);
      } else {
        setError(
          scanError instanceof Error
            ? `Bootstrapen avbröts: ${scanError.message} Tidigare SI-kopplingar kan redan ha skapats; kör inventeringen innan du försöker igen.`
            : 'Bootstrapen avbröts. Tidigare SI-kopplingar kan redan ha skapats; kör inventeringen innan du försöker igen.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const markdown = bootstrapSummary && reportBefore
      ? [
          '# Resultat av skapandet av SI-kopplingar',
          '',
          `- Skapade SI-kopplingar: ${bootstrapSummary.createdCount}`,
          `- Överhoppade löpare: ${bootstrapSummary.skipped.length}`,
          `- SI-dubbletter att reda ut: ${bootstrapSummary.duplicates.length}`,
          '',
          '## Inventering före skapandet',
          '',
          formatSIAssignmentInventoryMarkdown(reportBefore),
          '',
          '## Inventering efter skapandet',
          '',
          formatSIAssignmentInventoryMarkdown(report),
        ].join('\n')
      : formatSIAssignmentInventoryMarkdown(report);
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'SI_ASSIGNMENT_INVENTORY.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
        Inventering av SI-kopplingar
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Skrivskyddad kontroll av tävlingarnas löpare och SI-kopplingar.
          Rapporten innehåller endast ID:n och SI-nummer.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void runInventory()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Skannar Firestore...' : 'Skanna Firestore'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void generateMissingAssignments()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:text-slate-100"
        >
          <UserPlus className="h-3.5 w-3.5" />
          {busy ? 'Arbetar...' : 'Skapa saknade SI-kopplingar'}
        </button>
        {report && (
          <button
            type="button"
            onClick={downloadReport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            Ladda ner SI_ASSIGNMENT_INVENTORY.md
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Skanningen misslyckades: {error}
        </p>
      )}

      {queryFailure && (
        <div
          role="alert"
          className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <p className="font-bold">ERROR</p>
          <p><span className="font-semibold">Path:</span> {queryFailure.path}</p>
          <p><span className="font-semibold">Competition ID:</span> {queryFailure.competitionId ?? '—'}</p>
          <p><span className="font-semibold">Operation:</span> {queryFailure.operation}</p>
          <p><span className="font-semibold">Error code:</span> {queryFailure.errorCode}</p>
          <p><span className="font-semibold">Required role:</span> {queryFailure.requiredRole}</p>
          <p><span className="font-semibold">Actual role:</span> {queryFailure.userRole}</p>
          <p><span className="font-semibold">Admin tier:</span> {queryFailure.adminTier}</p>
          <p><span className="font-semibold">Details:</span> {queryFailure.message}</p>
        </div>
      )}

      {report && (
        <div className="space-y-2">
          {bootstrapSummary && reportBefore && (
            <section className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                Resultat av bootstrap
              </p>
              <p>Skapade SI-kopplingar: {bootstrapSummary.createdCount}</p>
              <p>Överhoppade löpare: {bootstrapSummary.skipped.length}</p>
              <p>Dubblettgrupper som kräver manuell hantering: {bootstrapSummary.duplicates.length}</p>
              {bootstrapSummary.skipped.length > 0 && (
                <ul className="list-inside list-disc text-slate-600 dark:text-slate-300">
                  {Object.entries(
                    bootstrapSummary.skipped.reduce<Record<string, number>>((counts, item) => {
                      counts[item.reason] = (counts[item.reason] ?? 0) + 1;
                      return counts;
                    }, {})
                  ).map(([reason, count]) => (
                    <li key={reason}>{getSkippedReasonLabel(reason)}: {count}</li>
                  ))}
                </ul>
              )}
              {bootstrapSummary.duplicates.map((duplicate) => (
                <p key={`${duplicate.competitionId}-${duplicate.siNumber}`} className="text-amber-700 dark:text-amber-300">
                  Dubblett i {duplicate.competitionId}: SI {duplicate.siNumber} — {duplicate.competitorIds.join(', ')} (överhoppad)
                </p>
              ))}
            </section>
          )}
          {reportBefore && (
            <details className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
              <summary className="cursor-pointer font-semibold">
                Inventering före skapandet ({reportBefore.competitionCount} tävlingar, {reportBefore.competitorCount} löpare, {reportBefore.assignmentCount} SI-kopplingar)
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] dark:bg-slate-950">
                {formatSIAssignmentInventoryMarkdown(reportBefore)}
              </pre>
            </details>
          )}
          <p role="status" className="text-xs text-slate-600 dark:text-slate-300">
            {reportBefore ? 'Inventering efter skapandet:' : 'Kontrollerade'}
            {' '}{report.competitionCount} tävlingar, {report.competitorCount} löpare och {report.assignmentCount} SI-kopplingar.
          </p>
          <pre className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {reportBefore ? 'Inventering efter skapandet\n\n' : ''}
            {formatSIAssignmentInventoryMarkdown(report)}
          </pre>
        </div>
      )}
    </section>
  );
}

function getSkippedReasonLabel(reason: string): string {
  switch (reason) {
    case 'INVALID_SI_NUMBER':
      return 'Ogiltigt SI-nummer';
    case 'DUPLICATE_SI_NUMBER':
      return 'SI-numret förekommer på flera löpare';
    case 'ALREADY_EXISTS':
      return 'SI-koppling fanns redan';
    case 'INVALID_CARD_SERIES':
      return 'Ogiltig bricktyp';
    default:
      return 'Övrig anledning';
  }
}
