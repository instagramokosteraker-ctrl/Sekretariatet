import type { Request, Response } from 'express';
import {
  readFirestoreRole,
  verifyFirebaseIdToken,
} from '../src/server/firebaseTokenAuth';
import {
  EventorApiError,
  fetchFromEventorApi,
} from '../src/server/eventorApiClient';
import {
  parseEventorClassesXml,
  parseEventorEntriesXml,
  parseEventorEventXml,
  parseEventorOrgXml,
} from '../src/server/eventorXml';

const EVENTOR_API_BASE_URL = 'https://eventor.orientering.se/api';
const FIREBASE_PROJECT_ID = 'ai-studio-applet-webapp-72c01';
const FIRESTORE_DATABASE_ID =
  'ai-studio-kopiaavoksekreta-4d24d0cc-1fd7-4b98-ba1a-8c6f95c187df';

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string, req: Request): boolean {
  const parsedOrigin = normalizeOrigin(origin);
  if (!parsedOrigin) return false;

  const host = req.get('host');
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0].trim();
  const requestOrigin = host
    ? normalizeOrigin(`${forwardedProto || (process.env.VERCEL ? 'https' : 'http')}://${host}`)
    : null;
  if (parsedOrigin === requestOrigin) return true;

  const configuredOrigins = [
    process.env.APP_ORIGIN,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ]
    .map(normalizeOrigin)
    .filter((value): value is string => value !== null);
  return configuredOrigins.includes(parsedOrigin);
}

function applyCors(req: Request, res: Response): boolean {
  const origin = req.get('origin');
  if (!origin) return true;
  if (!isAllowedOrigin(origin, req)) {
    res.status(403).json({ success: false, error: 'Origin is not allowed.' });
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-passersi-token'
  );
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

async function requireEventorAdmin(req: Request, res: Response): Promise<boolean> {
  const rawToken = req.get('x-passersi-token') || req.get('authorization');
  const token =
    rawToken?.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken?.trim();
  if (!token) {
    res.status(401).json({ success: false, error: 'Inloggning krävs.' });
    return false;
  }

  let verified: Awaited<ReturnType<typeof verifyFirebaseIdToken>>;
  try {
    verified = await verifyFirebaseIdToken(token, FIREBASE_PROJECT_ID);
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : 'Ogiltig inloggning.',
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

function sendError(res: Response, error: unknown): void {
  if (error instanceof EventorApiError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
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
  if (!applyCors(req, res)) return;
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({ success: false, error: 'Method not allowed.' });
    return;
  }
  if (!(await requireEventorAdmin(req, res))) return;

  const body =
    typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
  if (!apiKey) {
    res.status(400).json({ success: false, error: 'Eventor API-nyckel saknas.' });
    return;
  }
  if (apiKey.length > 512) {
    res.status(400).json({ success: false, error: 'API-nyckeln är för lång.' });
    return;
  }
  const eventorConfig = { apiKey, baseUrl: EVENTOR_API_BASE_URL };

  try {
    if (action === 'test') {
      if (orgId && !/^\d{1,32}$/.test(orgId)) {
        res.status(400).json({
          success: false,
          error: 'Organisations-ID måste bestå av 1–32 siffror.',
        });
        return;
      }
      const orgXml = await fetchFromEventorApi(
        '/organisation/apiKey',
        eventorConfig,
        true
      );
      const org = parseEventorOrgXml(orgXml);
      if (org && orgId && org.orgId !== orgId) {
        res.status(400).json({
          success: false,
          error: `API-nyckeln hör till organisation ${org.orgId} (${org.orgName}), inte angivet organisations-ID ${orgId}.`,
        });
        return;
      }
      res.status(200).json({
        success: true,
        message: 'Anslutning lyckades!',
        orgId: org?.orgId ?? orgId,
        ...(org ? { orgName: org.orgName } : {}),
      });
      return;
    }

    if (action !== 'import') {
      res.status(400).json({ success: false, error: 'Ogiltig Eventor-åtgärd.' });
      return;
    }

    const eventId =
      typeof body.eventId === 'string' || typeof body.eventId === 'number'
        ? String(body.eventId).trim()
        : '';
    if (!/^\d{1,32}$/.test(eventId)) {
      res.status(400).json({
        success: false,
        error: 'Ange ett giltigt Eventor-tävlings-ID.',
      });
      return;
    }

    const encodedEventId = encodeURIComponent(eventId);
    const [eventXml, classesXml, entriesXml] = await Promise.all([
      fetchFromEventorApi(`/event/${encodedEventId}`, eventorConfig, true),
      fetchFromEventorApi(
        `/eventclasses?eventId=${encodedEventId}`,
        eventorConfig,
        true
      ),
      fetchFromEventorApi(
        `/entries?eventId=${encodedEventId}`,
        eventorConfig,
        true
      ),
    ]);
    const event = parseEventorEventXml(eventXml, eventId);
    if (!event) {
      res.status(502).json({
        success: false,
        error: 'Eventor returnerade inte läsbara tävlingsuppgifter.',
      });
      return;
    }
    const classIdToName = parseEventorClassesXml(classesXml);
    res.status(200).json({
      success: true,
      event,
      classes: Array.from(classIdToName, ([id, name]) => ({ id, name })),
      entries: parseEventorEntriesXml(entriesXml, classIdToName),
    });
  } catch (error) {
    sendError(res, error);
  }
}
