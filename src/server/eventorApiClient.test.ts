import { describe, expect, it, vi } from 'vitest';
import {
  EventorApiError,
  fetchFromEventorApi,
} from './eventorApiClient';

describe('fetchFromEventorApi', () => {
  it('reports Eventor HTTP status and status text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Unauthorized', {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'text/plain' },
      }))
    );

    try {
      await expect(
        fetchFromEventorApi('/organisation/apiKey', {
          apiKey: 'invalid-key',
          baseUrl: 'https://eventor.example/api',
        })
      ).rejects.toMatchObject({
        statusCode: 401,
        message: 'Eventor svarade med HTTP 401 (Unauthorized)',
      } satisfies Partial<EventorApiError>);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
