import { describe, expect, it } from 'vitest';
import { getParsedServiceAccount } from './firebaseServiceAccount';

describe('getParsedServiceAccount', () => {
  it('returns undefined when credentials are not configured', () => {
    expect(getParsedServiceAccount(null)).toBeUndefined();
  });

  it('normalizes escaped newlines on object and JSON-string credentials', () => {
    const serviceAccount = {
      type: 'service_account',
      private_key: 'first\\nsecond',
    };

    expect(getParsedServiceAccount(serviceAccount)?.private_key).toBe('first\nsecond');
    expect(
      getParsedServiceAccount(JSON.stringify(serviceAccount))?.private_key
    ).toBe('first\nsecond');
  });

  it('retries parsing after normalizing escaped line breaks', () => {
    const raw = '{"type":"service_account",\\n"project_id":"demo"}';

    expect(getParsedServiceAccount(raw)?.project_id).toBe('demo');
  });

  it('rejects invalid credential values explicitly', () => {
    expect(() => getParsedServiceAccount('not-json')).toThrow(
      'FIREBASE_SERVICE_ACCOUNT must contain valid JSON.'
    );
    expect(() => getParsedServiceAccount('[]')).toThrow(
      'FIREBASE_SERVICE_ACCOUNT must contain a JSON object.'
    );
  });
});
