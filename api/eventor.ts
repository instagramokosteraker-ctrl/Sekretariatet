import type { VercelRequest, VercelResponse } from '@vercel/node';

const EVENTOR_API_URL = 'https://eventor.orientering.se/api/';
const EVENTOR_TIMEOUT_MS = 10_000;

type EventorAction = 'test' | 'import-event' | 'sync-club';

function applyCorsHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ApiKey');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeEventId(value: unknown): string {
  return String(value ?? '').trim().replace(/\D/g, '');
}

function buildEventorUrl(
  action: EventorAction,
  eventId: unknown,
  suppliedUrl: unknown
): URL | null {
  if (typeof suppliedUrl === 'string' && suppliedUrl.trim()) {
    try {
      const url = new URL(
        suppliedUrl.trim().replace(/^\/+/, ''),
        EVENTOR_API_URL
      );
      url.pathname = url.pathname.replace(/\/{2,}/g, '/');
      if (
        url.protocol === 'https:' &&
        url.hostname === 'eventor.orientering.se' &&
        !url.port &&
        !url.username &&
        !url.password &&
        url.pathname.startsWith('/api/')
      ) {
        const eventClassesPath = url.pathname === '/api/eventclasses';
        const eventPathMatch = url.pathname.match(/^\/api\/event\/([^/]+)$/);
        const queryEventId = url.searchParams.get('eventId');
        if (eventClassesPath) {
          const sanitizedEventId = sanitizeEventId(queryEventId);
          if (!/^\d{1,32}$/.test(sanitizedEventId)) return null;
          url.pathname = `/api/event/${sanitizedEventId}`;
          url.search = '';
        } else if (eventPathMatch) {
          const sanitizedEventId = sanitizeEventId(eventPathMatch[1]);
          if (!/^\d{1,32}$/.test(sanitizedEventId)) return null;
          url.pathname = `/api/event/${sanitizedEventId}`;
        } else if (
          url.pathname === '/api/entries' ||
          url.pathname === '/api/export/entries'
        ) {
          const sanitizedEventId = sanitizeEventId(queryEventId);
          if (!/^\d{1,32}$/.test(sanitizedEventId)) return null;
          url.pathname = '/api/export/entries';
          url.search = '';
          url.searchParams.set('eventId', sanitizedEventId);
          url.searchParams.set('version', '3.0');
        }
        return url;
      }
    } catch {
      return null;
    }
    return null;
  }

  if (action === 'test') {
    return new URL('organisation/apiKey', EVENTOR_API_URL);
  }

  if (
    action === 'import-event' &&
    (typeof eventId === 'string' || typeof eventId === 'number') &&
    /^\d{1,32}$/.test(sanitizeEventId(eventId))
  ) {
    return new URL(
      `event/${encodeURIComponent(sanitizeEventId(eventId))}`,
      EVENTOR_API_URL
    );
  }

  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Internt serverfel i Eventor-proxyn.';
}

function sendFailure(
  res: VercelResponse,
  error: string,
  url?: string
): void {
  res.status(200).json({
    success: false,
    error,
    ...(url ? { url } : {}),
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  try {
    applyCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    if (req.method !== 'POST') {
      sendFailure(res, 'Endast POST och OPTIONS stöds.');
      return;
    }

    const body = asRecord(req.body);
    const apiKey =
      typeof body.apiKey === 'string'
        ? body.apiKey.trim().replace(/['"]/g, '')
        : '';
    const action = body.action;
    if (!apiKey || apiKey.length > 512) {
      sendFailure(res, 'Eventor API-nyckeln saknas eller är ogiltig.');
      return;
    }
    if (
      action !== 'test' &&
      action !== 'import-event' &&
      action !== 'sync-club'
    ) {
      sendFailure(res, 'Ogiltig Eventor-åtgärd.');
      return;
    }

    const eventorUrl = buildEventorUrl(action, body.eventId, body.url);
    if (!eventorUrl) {
      sendFailure(res, 'Ogiltig Eventor-URL eller saknat tävlings-ID.');
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EVENTOR_TIMEOUT_MS
    );
    const targetUrl = eventorUrl.toString();
    try {
      console.log('Fetching Eventor API URL:', targetUrl);
      const response = await fetch(targetUrl, {
        headers: {
          ApiKey: apiKey,
          'User-Agent': 'LIVE-Appen/1.0 (Secretariat App)',
          Accept: 'application/xml, text/xml, text/plain, */*',
        },
        signal: controller.signal,
      });
      const xml = await response.text();

      if (!response.ok) {
        const errorBodyText = xml.trim();
        console.error('Eventor API error response:', {
          status: response.status,
          url: targetUrl,
          body: errorBodyText,
        });
        sendFailure(
          res,
          `Eventor HTTP ${response.status}: ${errorBodyText || response.statusText}`,
          targetUrl
        );
        return;
      }

      res.status(200).json({
        success: true,
        xml,
        status: response.status,
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Eventor svarade inte inom 10 sekunder.'
        : `Eventor kunde inte nås: ${errorMessage(error)}`;
      sendFailure(res, message, targetUrl);
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error('Standalone Eventor proxy failed:', error);
    if (!res.headersSent) {
      applyCorsHeaders(res);
      sendFailure(res, errorMessage(error));
    }
  }
}
