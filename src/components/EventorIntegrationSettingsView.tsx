import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, Save } from 'lucide-react';
import { apiFetch } from '../services/authClient';

interface EventorAdminConfig {
  apiKeyConfigured: boolean;
  orgId: string;
  baseUrl: string;
  connectedOrgId: string | null;
  connectedOrgName: string | null;
  lastSyncedAt: string | null;
  migrationAvailable: boolean;
}

interface Notice {
  ok: boolean;
  message: string;
}

interface EventorIntegrationSettingsViewProps {
  onSaveOrgId?: (orgId: string) => Promise<void>;
}

const DEFAULT_BASE_URL = 'https://eventor.orientering.se/api';

export function EventorIntegrationSettingsView({
  onSaveOrgId,
}: EventorIntegrationSettingsViewProps) {
  const [config, setConfig] = useState<EventorAdminConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [orgId, setOrgId] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/eventor/config');
      const data = (await response.json()) as EventorAdminConfig & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Kunde inte läsa Eventor-inställningarna.');
      setConfig(data);
      setOrgId(data.orgId);
      setBaseUrl(data.baseUrl || DEFAULT_BASE_URL);
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : 'Kunde inte läsa Eventor-inställningarna.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const saveConfig = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiFetch('/api/eventor/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, orgId, baseUrl }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Kunde inte spara Eventor-inställningarna.');
      setApiKey('');
      await onSaveOrgId?.(orgId);
      setNotice({ ok: true, message: 'Eventor-inställningarna har sparats i Firestore.' });
      await loadConfig();
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : 'Kunde inte spara Eventor-inställningarna.',
      });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiFetch('/api/eventor/test', { method: 'POST' });
      const data = (await response.json()) as {
        connected?: boolean;
        orgId?: string;
        orgName?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || 'Anslutningen till Eventor misslyckades.');
      setNotice({
        ok: true,
        message: `Ansluten till Eventor\nKlubb: ${data.orgName}\nOrganisation-ID: ${data.orgId}`,
      });
      await loadConfig();
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : 'Anslutningen till Eventor misslyckades.',
      });
    } finally {
      setBusy(false);
    }
  };

  const migrateLegacy = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiFetch('/api/eventor/migrate-legacy', { method: 'POST' });
      const data = (await response.json()) as {
        orgName?: string;
        orgId?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || 'Migreringen misslyckades.');
      setNotice({
        ok: true,
        message: `Migrerade den befintliga nyckeln till Firestore.\nKlubb: ${data.orgName}\nOrganisation-ID: ${data.orgId}`,
      });
      await loadConfig();
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : 'Migreringen misslyckades.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <KeyRound className="w-5 h-5 mt-0.5 text-slate-600 dark:text-slate-300 shrink-0" />
        <div>
          <h2 className="text-sm font-display font-bold text-slate-900 dark:text-slate-100">
            Eventor-integration
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Inställningarna sparas i ett privat Firestore-dokument. API-nyckeln visas aldrig i appen.
          </p>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`flex items-start gap-2 whitespace-pre-line px-3 py-2 text-xs rounded-lg border ${
            notice.ok
              ? 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900'
              : 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900'
          }`}
        >
          {notice.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
          Eventor API-nyckel
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={config?.apiKeyConfigured ? 'Nyckel sparad — lämna tomt för oförändrad' : 'Ange API-nyckel'}
            className="mt-1 w-full px-2.5 py-2 text-xs font-normal bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
          Eventor Organisations-ID
          <input
            type="text"
            inputMode="numeric"
            maxLength={32}
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
            placeholder="t.ex. 1234"
            className="mt-1 w-full px-2.5 py-2 text-xs font-normal font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 sm:col-span-2">
          Eventor Base URL
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={DEFAULT_BASE_URL}
            className="mt-1 w-full px-2.5 py-2 text-xs font-normal font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading || busy}
          onClick={() => void saveConfig()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {busy ? 'Sparar...' : 'Spara inställningar'}
        </button>
        <button
          type="button"
          disabled={loading || busy}
          onClick={() => void testConnection()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          Testa anslutning
        </button>
        {config?.migrationAvailable && (
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void migrateLegacy()}
            className="px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded-lg disabled:opacity-50"
          >
            Migrera befintlig nyckel
          </button>
        )}
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        <p>
          Anslutningsstatus:{' '}
          <strong className={config?.connectedOrgName ? 'text-emerald-700 dark:text-emerald-400' : ''}>
            {config?.connectedOrgName ? `Ansluten till ${config.connectedOrgName}` : config?.apiKeyConfigured ? 'Inte testad' : 'Inte konfigurerad'}
          </strong>
        </p>
        {config?.lastSyncedAt && (
          <p>Senaste lyckade synkronisering: {new Date(config.lastSyncedAt).toLocaleString('sv-SE')}</p>
        )}
        {config?.connectedOrgId && <p>Organisations-ID: {config.connectedOrgId}</p>}
      </div>
    </section>
  );
}
