import { auth } from '../firebase';
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
type ProxyResource = 'event' | 'classes' | 'entries' | 'organization' | 'competitors';

interface EventorProxyRequest {
  action: ProxyAction;
  resource?: ProxyResource;
  eventId?: string;
  params?: { resource?: ProxyResource; orgId?: string };
}

function getProxyRequest(path: string, isClubSync: boolean): EventorProxyRequest {
  const cleanPath = path.replace(/^\/+/, '');
  if (cleanPath === 'organisation/apiKey') {
    return isClubSync
      ? { action: 'sync-club', resource: 'organization' }
      : { action: 'test' };
  }
  if (cleanPath.startsWith('competitors?')) {
    return { action: 'sync-club', resource: 'competitors' };
  }

  const eventMatch = cleanPath.match(/^event\/(\d{1,32})$/);
  if (eventMatch) {
    return {
      action: 'import-event',
      resource: 'event',
      eventId: eventMatch[1],
    };
  }
  const classesMatch = cleanPath.match(/^eventclasses\?eventId=(\d{1,32})$/);
  if (classesMatch) {
    return {
      action: 'import-event',
      resource: 'classes',
      eventId: classesMatch[1],
    };
  }
  const entriesMatch = cleanPath.match(/^entries\?eventId=(\d{1,32})$/);
  if (entriesMatch) {
    return {
      action: 'import-event',
      resource: 'entries',
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
    url.search ||
    url.hash
  ) {
    throw new Error('Eventor Base URL måste använda https://eventor.orientering.se.');
  }
  return url.toString().replace(/\/+$/, '');
}

async function postToEventorProxy(
  request: EventorProxyRequest,
  config: EventorLocalConfig,
  idToken: string | null
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    PROXY_REQUEST_TIMEOUT_MS
  );
  try {
    const response = await fetch('/api/eventor', {
      method: 'POST',
      headers: {
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey: config.apiKey.trim(),
        action: request.action,
        ...(request.eventId ? { eventId: request.eventId } : {}),
        params: {
          resource: request.resource,
          orgId: config.orgId.trim(),
          baseUrl: validateBaseUrl(config.baseUrl),
        },
      }),
      signal: controller.signal,
    });

    if (request.action === 'test') {
      const result = (await response.json().catch(() => null)) as
        | { success?: unknown; error?: unknown; xml?: unknown }
        | null;
      if (!response.ok || result?.success !== true) {
        const message =
          typeof result?.error === 'string'
            ? result.error
            : `Eventor-proxyn svarade med HTTP ${response.status}.`;
        if (response.status === 502 || response.status === 504) {
          throw new EventorNetworkError(message);
        }
        throw new Error(message);
      }
      if (typeof result.xml !== 'string') {
        throw new Error('Eventor-proxyn returnerade inte organisations-XML.');
      }
      return result.xml;
    }

    const xml = await response.text();
    if (!response.ok) {
      let message = `Eventor-proxyn svarade med HTTP ${response.status}.`;
      try {
        const result = JSON.parse(xml) as { error?: unknown };
        if (typeof result.error === 'string') message = result.error;
      } catch {
        // Keep the HTTP diagnostic when the proxy did not return JSON.
      }
      if (response.status === 502 || response.status === 504) {
        throw new EventorNetworkError(message);
      }
      throw new Error(message);
    }
    return xml;
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
  const currentUser = auth.currentUser;
  const requiresAuthentication = requests.some(
    (request) => request.action !== 'test'
  );
  if (!currentUser && requiresAuthentication) {
    throw new Error('Du behöver vara inloggad som administratör.');
  }
  const idToken = currentUser ? await currentUser.getIdToken() : null;
  return Promise.all(
    requests.map((request) => postToEventorProxy(request, config, idToken))
  );
}
