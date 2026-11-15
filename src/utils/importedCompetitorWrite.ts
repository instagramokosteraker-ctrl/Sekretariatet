export function buildImportedCompetitorWriteFields(
  mutable: Record<string, unknown>,
  mode: 'CREATE' | 'UPDATE'
): Record<string, unknown> {
  const fields = { ...mutable };
  delete fields.rentalReturned;
  if (mode === 'UPDATE') {
    delete fields.eventorPersonId;
    delete fields.eventorOrgId;
  }
  return mode === 'CREATE' ? { ...fields, rentalReturned: false } : fields;
}
