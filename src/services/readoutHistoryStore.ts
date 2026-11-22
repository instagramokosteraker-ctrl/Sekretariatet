import type {
  Competitor,
  FullCardReadoutPayload,
  RunnerDbEntry,
  RunnerStatus,
} from '../types/sportident';
import {
  isReassignableReadoutResultStatus,
  type ReadoutReassignmentAuditEntry,
} from '../types/readoutReassignment';

export type CapturedReadoutPayload = FullCardReadoutPayload & {
  clientReadoutId: string;
  captureSequence: number;
  capturedAt: string;
};

export type ReadoutIssueType =
  | 'UNKNOWN_CARD'
  | 'UNLINKED_COMPETITOR'
  | 'CLASS_CONFLICT'
  | 'DUPLICATE_ASSIGNMENT'
  | 'MANUAL_FINISH_REVIEW'
  | 'MANUAL_RESULT_APPROVAL'
  | 'WRONG_COMPETITOR'
  | 'MP_REVIEW'
  | 'DUPLICATE_READOUT'
  | 'LOCAL_PERSISTENCE_FAILURE'
  | 'CORRECTION_FAILURE'
  | 'SYNC_INTERVENTION_REQUIRED'
  | 'CORRUPTED_PAYLOAD'
  | 'UNRECOVERABLE_VALIDATION_FAILURE';

export type ReadoutIssueState =
  | 'NONE'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'DISMISSED';

export interface ReadoutHistoryRecord {
  clientReadoutId: string;
  captureSequence: number;
  capturedAt: string;
  eventId: string | null;
  readout: CapturedReadoutPayload;
  readoutState: 'CAPTURED' | 'UNKNOWN' | 'PROCESSED';
  deliveryState:
    | 'PERSISTING'
    | 'LOCAL_SAVED'
    | 'QUEUED'
    | 'SYNCED'
    | 'SAVE_FAILED';
  competitorId: string | null;
  competitorName: string | null;
  className: string | null;
  resultStatus: RunnerStatus | null;
  competitorSnapshot: Competitor | null;
  originalCompetitorId: string | null;
  originalCompetitorName: string | null;
  originalClassName: string | null;
  originalResultStatus: RunnerStatus | null;
  originalCompetitorSnapshot: Competitor | null;
  issueType: ReadoutIssueType | null;
  issueState: ReadoutIssueState;
  correctionOperationId: string | null;
  correctionAudit: ReadoutReassignmentAuditEntry[];
  suggestedRunner: RunnerDbEntry | null;
  syncError: string | null;
}

export function isEligibleWrongCompetitorReadout(
  record: ReadoutHistoryRecord
): boolean {
  return (
    record.readoutState === 'PROCESSED' &&
    record.competitorId !== null &&
    isReassignableReadoutResultStatus(record.resultStatus)
  );
}

export type ReadoutHistoryUpdate = Partial<
  Pick<
    ReadoutHistoryRecord,
    | 'readoutState'
    | 'deliveryState'
    | 'competitorId'
    | 'competitorName'
    | 'className'
    | 'resultStatus'
    | 'competitorSnapshot'
    | 'originalCompetitorId'
    | 'originalCompetitorName'
    | 'originalClassName'
    | 'originalResultStatus'
    | 'originalCompetitorSnapshot'
    | 'issueType'
    | 'issueState'
    | 'correctionOperationId'
    | 'correctionAudit'
    | 'suggestedRunner'
    | 'syncError'
  >
>;

export function getWrongCompetitorIssueUpdateForConfirmation(
  record: ReadoutHistoryRecord
): ReadoutHistoryUpdate | null {
  if (
    record.issueType === 'WRONG_COMPETITOR' &&
    (record.issueState === 'OPEN' || record.issueState === 'IN_PROGRESS')
  ) {
    return null;
  }
  return {
    issueType: 'WRONG_COMPETITOR',
    issueState: 'OPEN',
  };
}

export function createDuplicateReadoutHistoryUpdate(
  record: ReadoutHistoryRecord,
  competitor: Competitor,
  className: string | null
): ReadoutHistoryUpdate {
  const wasOriginallyUnknown =
    record.issueType === 'UNKNOWN_CARD' || record.readoutState === 'UNKNOWN';

  return {
    deliveryState: 'SYNCED',
    readoutState: 'PROCESSED',
    competitorId: competitor.id,
    competitorName: competitor.fullName,
    className,
    resultStatus: competitor.status,
    competitorSnapshot: competitor,
    originalCompetitorId:
      record.originalCompetitorId ?? (wasOriginallyUnknown ? null : competitor.id),
    originalCompetitorName:
      record.originalCompetitorName ?? (wasOriginallyUnknown ? null : competitor.fullName),
    originalClassName:
      record.originalClassName ?? (wasOriginallyUnknown ? null : className),
    originalResultStatus:
      record.originalResultStatus ?? (wasOriginallyUnknown ? null : competitor.status),
    originalCompetitorSnapshot:
      record.originalCompetitorSnapshot ?? (wasOriginallyUnknown ? null : competitor),
    issueType: 'DUPLICATE_READOUT',
    issueState: 'NONE',
    suggestedRunner: null,
    syncError: null,
  };
}

const DATABASE_NAME = 'PasserSI_ReadoutHistoryDB';
const DATABASE_VERSION = 1;
const RECORD_STORE = 'readouts';

export function addReadoutHistoryRecord(
  records: ReadoutHistoryRecord[],
  record: ReadoutHistoryRecord
): ReadoutHistoryRecord[] {
  if (records.some((candidate) => candidate.clientReadoutId === record.clientReadoutId)) {
    return records;
  }
  return [...records, record];
}

export function updateReadoutHistoryRecord(
  records: ReadoutHistoryRecord[],
  clientReadoutId: string,
  update: ReadoutHistoryUpdate
): ReadoutHistoryRecord[] {
  const existing = records.find((record) => record.clientReadoutId === clientReadoutId);
  if (!existing) {
    return records;
  }
  return records.map((record) =>
    record.clientReadoutId === clientReadoutId
      ? {
          ...record,
          ...update,
          originalCompetitorId:
            record.originalCompetitorId ?? update.originalCompetitorId ?? null,
          originalCompetitorName:
            record.originalCompetitorName ?? update.originalCompetitorName ?? null,
          originalClassName:
            record.originalClassName ?? update.originalClassName ?? null,
          originalResultStatus:
            record.originalResultStatus ?? update.originalResultStatus ?? null,
          originalCompetitorSnapshot:
            record.originalCompetitorSnapshot ??
            update.originalCompetitorSnapshot ??
            null,
        }
      : record
  );
}

export function getLatestReadoutId(
  records: ReadoutHistoryRecord[],
  eventId: string | null
): string | null {
  let latest: ReadoutHistoryRecord | null = null;
  for (const record of records) {
    if (
      record.eventId === eventId &&
      (!latest || record.captureSequence > latest.captureSequence)
    ) {
      latest = record;
    }
  }
  return latest?.clientReadoutId ?? null;
}

export function sortReadoutHistory(
  records: ReadoutHistoryRecord[],
  eventId: string | null
): ReadoutHistoryRecord[] {
  return records
    .filter((record) => record.eventId === eventId)
    .slice()
    .sort((a, b) => b.captureSequence - a.captureSequence);
}

export function filterOutstandingReadouts(
  records: ReadoutHistoryRecord[]
): ReadoutHistoryRecord[] {
  return records.filter(
    (record) => record.issueState === 'OPEN' || record.issueState === 'IN_PROGRESS'
  );
}

function createReadoutId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ro-${crypto.randomUUID()}`;
  }
  return `ro-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function transactionError(transaction: IDBTransaction): Error {
  return transaction.error ?? new Error('Readout history transaction failed.');
}

class ReadoutHistoryStore {
  private records: ReadoutHistoryRecord[] = [];
  private sequenceByEvent = new Map<string, number>();
  private listeners = new Set<(records: ReadoutHistoryRecord[]) => void>();
  private databasePromise: Promise<IDBDatabase> | null = null;
  private initializationPromise: Promise<void> | null = null;
  private initialized = false;

  public get isInitialized(): boolean {
    return this.initialized;
  }

  public getSnapshot(): ReadoutHistoryRecord[] {
    return this.records.slice();
  }

  public getRecord(clientReadoutId: string): ReadoutHistoryRecord | null {
    return (
      this.records.find((record) => record.clientReadoutId === clientReadoutId) ?? null
    );
  }

  public subscribe(listener: (records: ReadoutHistoryRecord[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  public initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this.loadRecords();
    return this.initializationPromise;
  }

  public capture(
    payload: FullCardReadoutPayload,
    eventId: string | null
  ): ReadoutHistoryRecord {
    if (!this.initialized) {
      throw new Error('Readout history must be initialized before capturing a card.');
    }

    const sequenceKey = eventId ?? '__unassigned__';
    const captureSequence = (this.sequenceByEvent.get(sequenceKey) ?? 0) + 1;
    this.sequenceByEvent.set(sequenceKey, captureSequence);
    const clientReadoutId = createReadoutId();
    const capturedAt = new Date().toISOString();
    const readout: CapturedReadoutPayload = {
      ...payload,
      clientReadoutId,
      captureSequence,
      capturedAt,
      punches: payload.punches.map((punch) => ({ ...punch })),
    };
    const record: ReadoutHistoryRecord = {
      clientReadoutId,
      captureSequence,
      capturedAt,
      eventId,
      readout,
      readoutState: 'CAPTURED',
      deliveryState: 'PERSISTING',
      competitorId: null,
      competitorName: null,
      className: null,
      resultStatus: null,
      competitorSnapshot: null,
      originalCompetitorId: null,
      originalCompetitorName: null,
      originalClassName: null,
      originalResultStatus: null,
      originalCompetitorSnapshot: null,
      issueType: null,
      issueState: 'NONE',
      correctionOperationId: null,
      correctionAudit: [],
      suggestedRunner: null,
      syncError: null,
    };
    this.records = addReadoutHistoryRecord(this.records, record);
    this.emit();
    return record;
  }

  public async persist(record: ReadoutHistoryRecord): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RECORD_STORE, 'readwrite');
      transaction.objectStore(RECORD_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionError(transaction));
      transaction.onabort = () => reject(transactionError(transaction));
    });
  }

  public async update(
    clientReadoutId: string,
    update: ReadoutHistoryUpdate,
    persist = true
  ): Promise<ReadoutHistoryRecord | null> {
    const updatedRecords = updateReadoutHistoryRecord(
      this.records,
      clientReadoutId,
      update
    );
    if (updatedRecords === this.records) return null;

    this.records = updatedRecords;
    const record = this.getRecord(clientReadoutId);
    this.emit();
    if (persist && record) await this.persist(record);
    return record;
  }

  private async loadRecords(): Promise<void> {
    const database = await this.openDatabase();
    const loadedRecords = await new Promise<ReadoutHistoryRecord[]>((resolve, reject) => {
      const transaction = database.transaction(RECORD_STORE, 'readonly');
      const request = transaction.objectStore(RECORD_STORE).getAll();
      request.onsuccess = () => resolve(request.result as ReadoutHistoryRecord[]);
      request.onerror = () =>
        reject(request.error ?? new Error('Could not load readout history.'));
      transaction.onabort = () => reject(transactionError(transaction));
    });

    this.records = loadedRecords.map((record) => {
      const hasField = (field: keyof ReadoutHistoryRecord) =>
        Object.prototype.hasOwnProperty.call(record, field);
      return {
        ...record,
        originalCompetitorId: hasField('originalCompetitorId')
          ? record.originalCompetitorId
          : record.competitorId ?? null,
        originalCompetitorName: hasField('originalCompetitorName')
          ? record.originalCompetitorName
          : record.competitorName ?? null,
        originalClassName: hasField('originalClassName')
          ? record.originalClassName
          : record.className ?? null,
        originalResultStatus: hasField('originalResultStatus')
          ? record.originalResultStatus
          : record.resultStatus ?? null,
        originalCompetitorSnapshot: hasField('originalCompetitorSnapshot')
          ? record.originalCompetitorSnapshot
          : record.competitorSnapshot ?? null,
        issueType: hasField('issueType')
          ? record.issueType
          : record.readoutState === 'UNKNOWN'
            ? 'UNKNOWN_CARD'
            : null,
        issueState: hasField('issueState')
          ? record.issueState
          : record.readoutState === 'UNKNOWN'
            ? 'OPEN'
            : 'NONE',
        correctionOperationId: hasField('correctionOperationId')
          ? record.correctionOperationId
          : null,
        correctionAudit: hasField('correctionAudit')
          ? record.correctionAudit
          : [],
      };
    });
    if (
      loadedRecords.some(
        (record) =>
          !Object.prototype.hasOwnProperty.call(record, 'issueState') ||
          !Object.prototype.hasOwnProperty.call(record, 'issueType') ||
          !Object.prototype.hasOwnProperty.call(record, 'originalCompetitorId') ||
          !Object.prototype.hasOwnProperty.call(record, 'originalCompetitorName') ||
          !Object.prototype.hasOwnProperty.call(record, 'originalClassName') ||
          !Object.prototype.hasOwnProperty.call(record, 'originalResultStatus') ||
          !Object.prototype.hasOwnProperty.call(
            record,
            'originalCompetitorSnapshot'
          ) ||
          !Object.prototype.hasOwnProperty.call(record, 'correctionOperationId') ||
          !Object.prototype.hasOwnProperty.call(record, 'correctionAudit')
      )
    ) {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(RECORD_STORE, 'readwrite');
        const store = transaction.objectStore(RECORD_STORE);
        this.records.forEach((record) => store.put(record));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transactionError(transaction));
        transaction.onabort = () => reject(transactionError(transaction));
      });
    }
    this.records.forEach((record) => {
      const sequenceKey = record.eventId ?? '__unassigned__';
      this.sequenceByEvent.set(
        sequenceKey,
        Math.max(this.sequenceByEvent.get(sequenceKey) ?? 0, record.captureSequence)
      );
    });
    this.initialized = true;
    this.emit();
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable for readout history.'));
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          database.createObjectStore(RECORD_STORE, { keyPath: 'clientReadoutId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Could not open readout history.'));
      request.onblocked = () =>
        reject(new Error('Readout history database upgrade is blocked.'));
    });
    return this.databasePromise;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export const readoutHistoryStore = new ReadoutHistoryStore();
