import type { Request, Response } from 'express';
import {
  EventorApiError,
  fetchFromEventorApi,
} from '../src/server/eventorApiClient';
import {
  readFirestoreRole,
  verifyFirebaseIdToken,
} from '../src/server/firebaseTokenAuth';

const EVENTOR_API_BASE_URL = 'https://eventor.orientering.se/api';
const FIREBASE_PROJECT_ID = 'ai-studio-applet-webapp-72c01';
const FIRESTORE_DATABASE_ID =
  'ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df';
const RESOURCES = {
  'import-event': ['event', 'classes', 'entries'],
  'sync-club': ['organization', 'competitors'],
} as const;

type EventorAction = 'test' | 'import-event' | 'sync-club';
type EventorResource = (typeof RESOURCES)[keyof typeof RESOURCES][number];

class EventorAuthError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'EventorAuthError';
  }
}

function applyCorsHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, ApiKey'
  );
}

function getBearerToken(req: Request): string {
  const authorization = req.headers.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function requireEventorAdmin(req: Request): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    throw new EventorAuthError(
      401,
      'Du behöver vara inloggad som administratör.'
    );
  }

  let verified: Awaited<ReturnType<typeof verifyFirebaseIdToken>>;
  try {
    verified = await verifyFirebaseIdToken(token, FIREBASE_PROJECT_ID);
  } catch (error) {
    throw new EventorAuthError(
      401,
      error instanceof Error
        ? error.message
        : 'Du behöver vara inloggad som administratör.'
    );
  }

  let role: string | null;
  try {
    role = await readFirestoreRole(
      token,
      'admins',
      verified.uid,
      FIREBASE_PROJECT_ID,
      FIRESTORE_DATABASE_ID
    );
  } catch (error) {
    throw new EventorAuthError(
      503,
      error instanceof Error
        ? error.message
        : 'Kunde inte verifiera administratörsbehörigheten.'
    );
  }

  if (role !== 'SUPER_ADMIN' && role !== 'RACE_ADMIN') {
    throw new EventorAuthError(
      403,
      'Endast SUPER_ADMIN och RACE_ADMIN får hantera Eventor.'
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getApiBaseUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return EVENTOR_API_BASE_URL;
  }
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'eventor.orientering.se' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function isAction(value: unknown): value is EventorAction {
  return value === 'test' || value === 'import-event' || value === 'sync-club';
}

function isResourceForAction(
  action: 'import-event' | 'sync-club',
  resource: unknown
): resource is EventorResource {
  return (
    typeof resource === 'string' &&
    (RESOURCES[action] as readonly string[]).includes(resource)
  );
}

function getEventorPath(
  action: 'import-event' | 'sync-club',
  resource: EventorResource,
  eventId: string,
  orgId: string
): string {
  if (action === 'import-event') {
    const encodedEventId = encodeURIComponent(eventId);
    switch (resource) {
      case 'event':
        return `/event/${encodedEventId}`;
      case 'classes':
        return `/eventclasses?eventId=${encodedEventId}`;
      case 'entries':
        return `/entries?eventId=${encodedEventId}`;
    }
  }

  switch (resource) {
    case 'organization':
      return '/organisation/apiKey';
    case 'competitors':
      return `/competitors?organisationId=${encodeURIComponent(orgId)}&includeContactDetails=false`;
  }
  throw new Error('Ogiltig Eventor-resurs för åtgärden.');
}

async function fetchEventorXml(
  path: string,
  config: { apiKey: string; baseUrl: string }
): Promise<string> {
  try {
    return await fetchFromEventorApi(path, config, true);
  } catch (error) {
    if (error instanceof EventorApiError) throw error;
    throw new EventorApiError(
      502,
      error instanceof Error && error.message
        ? error.message
        : 'Eventor kunde inte nås.'
    );
  }
}

function sendError(res: Response, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof EventorApiError) {
    const statusCode =
      error.statusCode === 504 ? 504 : error.statusCode >= 500 ? 502 : 400;
    res
      .status(statusCode)
      .json({ success: false, error: `Eventor-fel: ${error.message}` });
    return;
  }
  if (error instanceof TypeError) {
    res.status(502).json({
      success: false,
      error: `Eventor-fel: ${error.message}`,
    });
    return;
  }
  console.error('Standalone Eventor function failed:', error);
  res.status(500).json({
    success: false,
    error:
      error instanceof Error && error.message
        ? error.message
        : 'Internt serverfel i Eventor-proxyn',
  });
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    applyCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      res.status(405).json({ success: false, error: 'Method not allowed.' });
      return;
    }

    const body = asRecord(req.body);
    const params = asRecord(body.params);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const action = body.action;
    if (!isAction(action)) {
      res.status(400).json({ success: false, error: 'Ogiltig Eventor-åtgärd.' });
      return;
    }
    if (!apiKey) {
      res.status(400).json({ success: false, error: 'Eventor API-nyckel saknas.' });
      return;
    }
    if (apiKey.length > 512) {
      res.status(400).json({ success: false, error: 'API-nyckeln är för lång.' });
      return;
    }

    if (action !== 'test') {
      await requireEventorAdmin(req);
    }

    const baseUrl = getApiBaseUrl(params.baseUrl);
    if (!baseUrl) {
      res.status(400).json({
        success: false,
        error: 'Eventor Base URL måste använda https://eventor.orientering.se.',
      });
      return;
    }
    const eventorConfig = { apiKey, baseUrl };

    if (action === 'test') {
      const xml = await fetchEventorXml('/organisation/apiKey', eventorConfig);
      res.status(200).json({
        success: true,
        message: 'Anslutning till Eventor lyckades!',
        xml,
      });
      return;
    }

    const resource = params.resource;
    if (!isResourceForAction(action, resource)) {
      res.status(400).json({
        success: false,
        error: 'Ogiltig Eventor-resurs för åtgärden.',
      });
      return;
    }
    const eventId =
      typeof body.eventId === 'string' || typeof body.eventId === 'number'
        ? String(body.eventId).trim()
        : '';
    const orgId = typeof params.orgId === 'string' ? params.orgId.trim() : '';
    if (action === 'import-event' && !/^\d{1,32}$/.test(eventId)) {
      res.status(400).json({
        success: false,
        error: 'Ange ett giltigt Eventor-tävlings-ID.',
      });
      return;
    }
    if (
      action === 'sync-club' &&
      resource === 'competitors' &&
      !/^\d{1,32}$/.test(orgId)
    ) {
      res.status(400).json({
        success: false,
        error: 'Ange ett giltigt Eventor Organisations-ID.',
      });
      return;
    }

    const xml = await fetchEventorXml(
      getEventorPath(action, resource, eventId, orgId),
      eventorConfig
    );
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(xml);
  } catch (error) {
    if (error instanceof EventorAuthError) {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(error.statusCode).json({
        success: false,
        error: `Autentiseringsfel: ${error.message}`,
      });
      return;
    }
    sendError(res, error);
  }
}
