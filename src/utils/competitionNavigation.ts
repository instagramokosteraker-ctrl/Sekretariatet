export type PublicCompetitionTab = 'RESULTS' | 'STARTLIST';

export interface AppRouteState {
  mode: 'SECRETARIAT' | 'PUBLIC';
  shortCode: string | null;
  competitionId: string | null;
  classFilter: string | null;
  publicTab: PublicCompetitionTab;
}

function getPublicTab(value: string | null): PublicCompetitionTab {
  return value?.toUpperCase() === 'STARTLIST' ? 'STARTLIST' : 'RESULTS';
}

export function parsePathnameToRoute(
  pathname: string,
  search = ''
): AppRouteState {
  const params = new URLSearchParams(search);
  const competitionId = params.get('id')?.trim() || null;
  const classFilter = competitionId ? params.get('class')?.trim() || null : null;
  const publicTab = getPublicTab(params.get('tab'));
  const shortMatch = pathname.match(/^\/t\/([^/?#]+)/i);

  if (shortMatch && shortMatch[1]) {
    return {
      mode: 'PUBLIC',
      shortCode: decodeURIComponent(shortMatch[1]),
      competitionId: null,
      classFilter: null,
      publicTab,
    };
  }
  if (/^\/publik(\/|$)/i.test(pathname)) {
    return {
      mode: 'PUBLIC',
      shortCode: null,
      competitionId,
      classFilter,
      publicTab,
    };
  }
  if (/^\/admin(\/|$)|^\/login(\/|$)/i.test(pathname)) {
    return {
      mode: 'SECRETARIAT',
      shortCode: null,
      competitionId,
      classFilter,
      publicTab,
    };
  }
  if (pathname === '/' || pathname === '/index.html') {
    return {
      mode: 'PUBLIC',
      shortCode: null,
      competitionId,
      classFilter,
      publicTab,
    };
  }
  return {
    mode: 'SECRETARIAT',
    shortCode: null,
    competitionId: null,
    classFilter: null,
    publicTab,
  };
}

function buildCompetitionQuery(
  competitionId: string | null,
  classFilter: string | null,
  publicTab: PublicCompetitionTab
): string {
  const params = new URLSearchParams();
  if (competitionId) {
    params.set('id', competitionId);
    if (classFilter) params.set('class', classFilter);
    if (publicTab === 'STARTLIST') params.set('tab', publicTab);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

export function buildSecretariatUrl(
  competitionId: string | null,
  classFilter: string | null,
  publicTab: PublicCompetitionTab
): string {
  return `/admin${buildCompetitionQuery(competitionId, classFilter, publicTab)}`;
}

export function buildPublicCompetitionUrl(
  competitionId: string | null,
  classFilter: string | null,
  publicTab: PublicCompetitionTab
): string {
  return `/${buildCompetitionQuery(competitionId, classFilter, publicTab)}`;
}
