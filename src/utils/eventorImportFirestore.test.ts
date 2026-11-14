import { describe, expect, it } from 'vitest';
import { buildImportedCompetitorWriteFields } from './importedCompetitorWrite';

describe('Eventor imported competitor Firestore fields', () => {
  it('initializes rentalReturned to false on create', () => {
    expect(
      buildImportedCompetitorWriteFields(
        { fullName: 'Ada Löpare', rentalReturned: true },
        'CREATE'
      )
    ).toEqual({ fullName: 'Ada Löpare', rentalReturned: false });
  });

  it('does not include rentalReturned in updates', () => {
    expect(
      buildImportedCompetitorWriteFields(
        { fullName: 'Ada Updated', rentalReturned: true },
        'UPDATE'
      )
    ).toEqual({ fullName: 'Ada Updated' });
  });
});
