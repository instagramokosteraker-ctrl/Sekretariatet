import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {
  scanSIAssignmentInventoryFromFirestore,
} from '../firebase';
import {
  formatSIAssignmentInventoryMarkdown,
  type SIAssignmentInventoryReport,
} from '../utils/siAssignmentInventory';

export function SIAssignmentInventoryView() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SIAssignmentInventoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runInventory = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await scanSIAssignmentInventoryFromFirestore());
    } catch (scanError) {
      setReport(null);
      setError(
        scanError instanceof Error
          ? scanError.message
          : 'SI-inventeringen kunde inte genomföras.'
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const markdown = formatSIAssignmentInventoryMarkdown(report);
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
          SI Assignment Inventory
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Skrivskyddad skanning av alla tävlingars konkurrenter och SI-assignment-dokument.
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

      {report && (
        <div className="space-y-2">
          <p role="status" className="text-xs text-slate-600 dark:text-slate-300">
            Skannade {report.competitionCount} tävlingar, {report.competitorCount} konkurrenter
            och {report.assignmentCount} assignment-dokument.
          </p>
          <pre className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {formatSIAssignmentInventoryMarkdown(report)}
          </pre>
        </div>
      )}
    </section>
  );
}
