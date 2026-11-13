export interface EventorLocalConfig {
  apiKey: string;
  orgId: string;
  baseUrl: string;
}

export const DEFAULT_EVENTOR_BASE_URL = 'https://eventor.orientering.se/api';

export function readEventorLocalConfig(): EventorLocalConfig {
  return {
    apiKey: localStorage.getItem('eventorApiKey') ?? '',
    orgId: localStorage.getItem('eventorOrgId') ?? '',
    baseUrl: localStorage.getItem('eventorBaseUrl') ?? DEFAULT_EVENTOR_BASE_URL,
  };
}

export function saveEventorLocalConfig(config: EventorLocalConfig): void {
  localStorage.setItem('eventorApiKey', config.apiKey);
  localStorage.setItem('eventorOrgId', config.orgId);
  localStorage.setItem('eventorBaseUrl', config.baseUrl);
}
