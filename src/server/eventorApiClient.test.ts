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
        message:
          'Eventor svarade med HTTP 401: Unauthorized för /organisation/apiKey.',
      } satisfies Partial<EventorApiError>);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('identifies the Eventor endpoint when the response has no status text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', {
        status: 400,
        statusText: '',
        headers: { 'content-type': 'text/plain' },
      }))
    );

    try {
      await expect(
        fetchFromEventorApi('/export/entries?eventId=123&version=3.0', {
          apiKey: 'test-key',
          baseUrl: 'https://eventor.example/api',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message:
          'Eventor svarade med HTTP 400 för /export/entries?eventId=123&version=3.0.',
      } satisfies Partial<EventorApiError>);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
