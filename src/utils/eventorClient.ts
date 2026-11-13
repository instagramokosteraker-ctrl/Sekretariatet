import type { EventorLocalConfig } from './eventorLocalConfig';
import { DEFAULT_EVENTOR_BASE_URL } from './eventorLocalConfig';

const EVENTOR_REQUEST_TIMEOUT_MS = 10_000;

export class EventorNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventorNetworkError';
  }
}

function getApiBaseUrl(baseUrl: string): string {
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

export async function fetchEventorXml(
  paths: string[],
  config: EventorLocalConfig
): Promise<string[]> {
  if (!config.apiKey.trim()) {
    throw new Error('Spara en Eventor API-nyckel lokalt innan du använder Eventor.');
  }
  if (paths.length === 0) return [];

  const baseUrl = getApiBaseUrl(config.baseUrl);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    EVENTOR_REQUEST_TIMEOUT_MS
  );
  try {
    return await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, {
          headers: {
            ApiKey: config.apiKey.trim(),
            Accept: 'application/xml, text/xml, */*',
          },
          redirect: 'error',
          signal: controller.signal,
        });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(
            `Eventor svarade med HTTP ${response.status} (${response.statusText})`
          );
        }
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const looksLikeXml =
          /^\s*(?:<\?xml\b[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<[A-Za-z_][\w:.-]*(?:\s|>)/i.test(
            body
          );
        const looksLikeHtml =
          contentType.includes('text/html') ||
          contentType.includes('application/json') ||
          /^\s*(?:<!doctype\s+html|<(?:html|head|body|title|meta|script)\b)/i.test(body);
        if (!body.trim() || !looksLikeXml || looksLikeHtml) {
          throw new Error(`Eventor svarade inte med giltig XML (HTTP ${response.status}).`);
        }
        return body;
      })
    );
  } catch (error) {
    controller.abort();
    if (
      controller.signal.aborted &&
      error instanceof DOMException &&
      error.name === 'AbortError'
    ) {
      throw new EventorNetworkError(
        'Eventor svarade inte inom 10 sekunder. Försök igen om en stund.'
      );
    }
    if (error instanceof TypeError) {
      throw new EventorNetworkError(
        'Kunde inte nå Eventor direkt (CORS/nätverk). Ladda upp Eventor IOF XML-fil.'
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
