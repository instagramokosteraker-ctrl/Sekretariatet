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

async function requireEventorAdmin(req: Request, res: Response): Promise<boolean> {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Du behöver vara inloggad som administratör.',
    });
    return false;
  }

  let verified: Awaited<ReturnType<typeof verifyFirebaseIdToken>>;
  try {
    verified = await verifyFirebaseIdToken(token, FIREBASE_PROJECT_ID);
  } catch {
    res.status(401).json({
      success: false,
      error: 'Du behöver vara inloggad som administratör.',
    });
    return false;
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
  } catch {
    res.status(503).json({
      success: false,
      error: 'Kunde inte verifiera administratörsbehörigheten.',
    });
    return false;
  }

  if (role !== 'SUPER_ADMIN' && role !== 'RACE_ADMIN') {
    res.status(403).json({
      success: false,
      error: 'Endast SUPER_ADMIN och RACE_ADMIN får hantera Eventor.',
    });
    return false;
  }
  return true;
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

function sendError(res: Response, error: unknown): void {
  if (error instanceof EventorApiError) {
    const statusCode =
      error.statusCode === 504 ? 504 : error.statusCode >= 500 ? 502 : 400;
    res.status(statusCode).json({ success: false, error: error.message });
    return;
  }
  if (error instanceof TypeError) {
    res.status(502).json({
      success: false,
      error: 'Nätverksfel: Eventor kunde inte nås.',
    });
    return;
  }
  console.error('Standalone Eventor function failed:', error);
  res.status(500).json({
    success: false,
    error: 'Kunde inte hantera Eventor-förfrågan.',
  });
}

export default async function handler(req: Request, res: Response): Promise<void> {
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
  if (!(await requireEventorAdmin(req, res))) return;

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

  const baseUrl = getApiBaseUrl(params.baseUrl);
  if (!baseUrl) {
    res.status(400).json({
      success: false,
      error: 'Eventor Base URL måste använda https://eventor.orientering.se.',
    });
    return;
  }
  const eventorConfig = { apiKey, baseUrl };
  try {
    if (action === 'test') {
      const xml = await fetchFromEventorApi(
        '/organisation/apiKey',
        eventorConfig,
        true
      );
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

    const xml = await fetchFromEventorApi(
      getEventorPath(action, resource, eventId, orgId),
      eventorConfig,
      true
    );
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(xml);
  } catch (error) {
    sendError(res, error);
  }
}
