import type { RunnerStatus } from './sportident';

export type ResultReassignmentActorRole =
  | 'SUPER_ADMIN'
  | 'RACE_ADMIN'
  | 'READOUT'
  | 'FOREST';

export interface ReadoutReassignmentAuditEntry {
  operationId: string;
  readoutId: string;
  actorUid: string;
  actorRole: ResultReassignmentActorRole;
  timestamp: string;
  reason: string;
  originalCompetitor: {
    id: string;
    name: string;
  };
  correctedCompetitor: {
    id: string;
    name: string;
  };
  result: {
    status: 'APPLIED';
    previousStatus: RunnerStatus;
    newStatus: RunnerStatus;
    finishTimeSec: number;
    runningTimeSec: number;
    bomSec: number | null;
    placing: { pos: number; total: number } | null;
  };
}

export interface ResultReassignmentResponse {
  status: 'APPLIED' | 'REPLAYED';
  operationId: string;
  readoutId: string;
  originalCompetitorId: string;
  correctedCompetitorId: string;
  audit: ReadoutReassignmentAuditEntry;
}
