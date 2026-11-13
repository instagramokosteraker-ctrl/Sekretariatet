import type { ServiceAccount } from 'firebase-admin/app';

export type ParsedServiceAccount = ServiceAccount & {
  project_id?: string;
  private_key?: string;
  client_email?: string;
};

export function getParsedServiceAccount(
  value: unknown = process.env.FIREBASE_SERVICE_ACCOUNT
): ParsedServiceAccount | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      try {
        parsed = JSON.parse(value.replace(/\\n/g, '\n'));
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid JSON.');
      }
    }

    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT must contain a JSON object.');
      }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must contain a JSON object.');
  }

  const serviceAccount = { ...parsed } as Record<string, unknown>;
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  if (typeof serviceAccount.privateKey === 'string') {
    serviceAccount.privateKey = serviceAccount.privateKey.replace(/\\n/g, '\n');
  }
  return serviceAccount as ParsedServiceAccount;
}
