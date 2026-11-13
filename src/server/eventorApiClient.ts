export interface EventorApiConfig {
  apiKey: string;
  baseUrl: string;
}

export class EventorApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'EventorApiError';
  }
}

export const EVENTOR_TIMEOUT_MESSAGE =
  'Eventor svarade inte inom 10 sekunder. Försök igen om en stund.';

const EVENTOR_REQUEST_TIMEOUT_MS = 10_000;

export async function fetchFromEventorApi(
  endpointPath: string,
  config: EventorApiConfig,
  requireStatus200 = false
): Promise<string> {
  if (!config.apiKey) throw new Error('Eventor API-nyckel saknas.');
  const url = `${config.baseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EVENTOR_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        ApiKey: config.apiKey,
        Accept: 'application/xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    const body = await response.text();
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    const isHtml =
      contentType.includes('text/html') ||
      /^\s*(?:<!doctype\s+html|<(?:html|head|body|title|meta|script)\b)/i.test(body);

    if (!response.ok || (requireStatus200 && response.status !== 200)) {
      throw new EventorApiError(
        response.ok ? 502 : response.status,
        `Eventor svarade med HTTP ${response.status} (${response.statusText})`
      );
    }

    const isXml =
      (body.trim().length > 0 && contentType.includes('xml')) ||
      (!contentType.includes('html') &&
        !contentType.includes('json') &&
        body.trim().length > 0 &&
        /^\s*(?:<\?xml\b|<[A-Za-z_][\w:.-]*(?:\s|>))/i.test(body) &&
        !isHtml);
    if (!isXml) {
      throw new EventorApiError(
        502,
        `Eventor svarade inte korrekt (HTTP ${response.status})`
      );
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new EventorApiError(504, EVENTOR_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
