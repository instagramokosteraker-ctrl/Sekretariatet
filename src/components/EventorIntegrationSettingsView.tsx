import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, Save } from 'lucide-react';
import { apiFetch, readApiResponseJson } from '../services/authClient';
import {
  DEFAULT_EVENTOR_BASE_URL,
  readEventorLocalConfig,
  saveEventorLocalConfig,
} from '../utils/eventorLocalConfig';

interface Notice {
  ok: boolean;
  message: string;
}

export function EventorIntegrationSettingsView() {
  const [apiKey, setApiKey] = useState('');
  const [orgId, setOrgId] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_EVENTOR_BASE_URL);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    try {
      const config = readEventorLocalConfig();
      setApiKey(config.apiKey);
      setApiKeyConfigured(Boolean(config.apiKey.trim()));
      setOrgId(config.orgId);
      setBaseUrl(config.baseUrl || DEFAULT_EVENTOR_BASE_URL);
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : 'Kunde inte läsa lokala Eventor-inställningar.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = () => {
    setBusy(true);
    setNotice(null);
    try {
      const config = {
        apiKey: apiKey.trim(),
        orgId: orgId.trim(),
        baseUrl: baseUrl.trim(),
      };
      saveEventorLocalConfig(config);
      setApiKey(config.apiKey);
      setOrgId(config.orgId);
      setBaseUrl(config.baseUrl || DEFAULT_EVENTOR_BASE_URL);
      setApiKeyConfigured(Boolean(config.apiKey));
      setNotice({ ok: true, message: 'Inställningarna sparades lokalt på denna enhet.' });
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : 'Kunde inte spara lokala Eventor-inställningar.',
      });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
    setBusy(true);
    setNotice(null);
    try {
      const config = readEventorLocalConfig();
      if (!config.apiKey.trim()) {
        throw new Error('Spara en Eventor API-nyckel lokalt innan du testar anslutningen.');
      }
      if (!config.orgId.trim()) {
        throw new Error('Spara ett Eventor Organisations-ID lokalt innan du testar anslutningen.');
      }

      const response = await apiFetch('/api/eventor/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: controller.signal,
      });
      const data = await readApiResponseJson<{
        success?: boolean;
        message?: string;
        orgId?: string;
        orgName?: string;
      }>(
        response,
        'Anslutningen till Eventor misslyckades. Kontrollera serveranslutningen och försök igen.'
      );
      if (!data.success) {
        throw new Error(data.message || 'Eventor kunde inte bekräfta anslutningen.');
      }
      setNotice({
        ok: true,
        message: data.orgName
          ? `${data.message || 'Anslutning lyckades'}\nKlubb: ${data.orgName}\nOrganisation-ID: ${data.orgId || config.orgId}`
          : data.message || 'Anslutning lyckades',
      });
    } catch (error) {
      setNotice({
        ok: false,
        message: controller.signal.aborted
          ? 'Eventor svarade inte inom 10 sekunder. Försök igen om en stund.'
          : error instanceof TypeError
            ? `Nätverksfel: Backend svarar inte. ${error.message}`
            : error instanceof Error
              ? error.message
              : 'Anslutningen till Eventor misslyckades.',
      });
    } finally {
      window.clearTimeout(timeoutId);
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
            API-nyckeln lagras lokalt i din webbläsare och skickas endast med vid Eventor-förfrågningar.
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
            placeholder="Ange API-nyckel"
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
            placeholder={DEFAULT_EVENTOR_BASE_URL}
            className="mt-1 w-full px-2.5 py-2 text-xs font-normal font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading || busy}
          onClick={saveConfig}
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
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        <p>
          Status:{' '}
          <strong className={apiKeyConfigured ? 'text-emerald-700 dark:text-emerald-400' : ''}>
            {apiKeyConfigured ? 'Konfigurerad lokalt' : 'Ej konfigurerad'}
          </strong>
        </p>
      </div>
    </section>
  );
}
