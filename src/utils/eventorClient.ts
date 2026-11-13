import type { EventorLocalConfig } from './eventorLocalConfig';
import { DEFAULT_EVENTOR_BASE_URL } from './eventorLocalConfig';

const PROXY_REQUEST_TIMEOUT_MS = 18_000;

export class EventorNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventorNetworkError';
  }
}

type ProxyAction = 'test' | 'import-event' | 'sync-club';
interface EventorProxyRequest {
  action: ProxyAction;
  url: string;
  eventId?: string;
}

function getProxyRequest(path: string, isClubSync: boolean): EventorProxyRequest {
  const cleanPath = path.replace(/^\/+/, '');
  if (cleanPath === 'organisation/apiKey') {
    return isClubSync
      ? { action: 'sync-club', url: cleanPath }
      : { action: 'test', url: cleanPath };
  }
  if (cleanPath.startsWith('competitors?')) {
    return { action: 'sync-club', url: cleanPath };
  }

  const eventMatch = cleanPath.match(/^event\/(\d{1,32})$/);
  if (eventMatch) {
    return {
      action: 'import-event',
      url: cleanPath,
      eventId: eventMatch[1],
    };
  }
  const classesMatch = cleanPath.match(/^eventclasses\?eventId=(\d{1,32})$/);
  if (classesMatch) {
    return {
      action: 'import-event',
      url: cleanPath,
      eventId: classesMatch[1],
    };
  }
  const entriesMatch = cleanPath.match(/^entries\?eventId=(\d{1,32})$/);
  if (entriesMatch) {
    return {
      action: 'import-event',
      url: cleanPath,
      eventId: entriesMatch[1],
    };
  }
  throw new Error('Ogiltig Eventor-förfrågan.');
}

function validateBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl || DEFAULT_EVENTOR_BASE_URL);
  } catch {
    throw new Error('Eventor Base URL är ogiltig.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'eventor.orientering.se' ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname.replace(/\/+$/, '') !== '/api' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Eventor Base URL måste använda https://eventor.orientering.se.');
  }
  return url.toString().replace(/\/+$/, '');
}

async function postToEventorProxy(
  request: EventorProxyRequest,
  config: EventorLocalConfig
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    PROXY_REQUEST_TIMEOUT_MS
  );
  try {
    const apiBaseUrl = validateBaseUrl(config.baseUrl);
    const response = await fetch('/api/eventor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // The server restricts this URL to Eventor's API origin and /api path.
      body: JSON.stringify({
        apiKey: config.apiKey.trim(),
        action: request.action,
        ...(request.eventId ? { eventId: request.eventId } : {}),
        url: new URL(request.url, `${apiBaseUrl}/`).toString(),
      }),
      signal: controller.signal,
    });

    const result = (await response.json().catch(() => null)) as
      | { success?: unknown; error?: unknown; xml?: unknown }
      | null;
    if (!response.ok || result?.success !== true) {
      const message =
        typeof result?.error === 'string'
          ? result.error
          : `Eventor-proxyn returnerade ett ogiltigt svar (HTTP ${response.status}).`;
      throw new EventorNetworkError(
        `${message} Ladda upp Eventor IOF XML-fil.`
      );
    }
    if (typeof result.xml !== 'string') {
      throw new EventorNetworkError(
        'Eventor-proxyn returnerade inte XML. Ladda upp Eventor IOF XML-fil.'
      );
    }
    return result.xml;
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new EventorNetworkError(
        'Eventor-proxyn svarade inte inom 18 sekunder. Ladda upp Eventor IOF XML-fil.'
      );
    }
    if (error instanceof EventorNetworkError) throw error;
    if (error instanceof TypeError) {
      throw new EventorNetworkError(
        'Kunde inte nå Eventor-proxyn (nätverk). Ladda upp Eventor IOF XML-fil.'
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchEventorXml(
  paths: string[],
  config: EventorLocalConfig
): Promise<string[]> {
  if (!config.apiKey.trim()) {
    throw new Error('Spara en Eventor API-nyckel lokalt innan du använder Eventor.');
  }
  if (paths.length === 0) return [];

  const isClubSync = paths.some((path) => path.replace(/^\/+/, '').startsWith('competitors?'));
  const requests = paths.map((path) => getProxyRequest(path, isClubSync));
  return Promise.all(
    requests.map((request) => postToEventorProxy(request, config))
  );
}
