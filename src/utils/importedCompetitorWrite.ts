export function buildImportedCompetitorWriteFields(
  mutable: Record<string, unknown>,
  mode: 'CREATE' | 'UPDATE'
): Record<string, unknown> {
  const fields = { ...mutable };
  delete fields.rentalReturned;
  return mode === 'CREATE' ? { ...fields, rentalReturned: false } : fields;
}
