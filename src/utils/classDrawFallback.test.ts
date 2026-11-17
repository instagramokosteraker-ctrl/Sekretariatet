import { describe, expect, it } from 'vitest';
import { shouldUseFirestoreClassDrawFallback } from './classDrawFallback';

describe('shouldUseFirestoreClassDrawFallback', () => {
  it('uses Firestore when the Express draw API cannot find its competition', () => {
    expect(
      shouldUseFirestoreClassDrawFallback(
        new Error('HTTP 404: Tävlingen hittades ej.')
      )
    ).toBe(true);
  });

  it('uses Firestore for unavailable APIs but preserves other client errors', () => {
    expect(shouldUseFirestoreClassDrawFallback(new TypeError('Network error'))).toBe(true);
    expect(
      shouldUseFirestoreClassDrawFallback(new Error('HTTP 503: Service unavailable'))
    ).toBe(true);
    expect(
      shouldUseFirestoreClassDrawFallback(new Error('HTTP 403: Åtkomst nekad.'))
    ).toBe(false);
    expect(
      shouldUseFirestoreClassDrawFallback(new Error('HTTP 400: Ogiltig lottning.'))
    ).toBe(false);
  });
});
