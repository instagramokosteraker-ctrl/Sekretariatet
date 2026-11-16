import { describe, expect, it } from 'vitest';
import {
  buildPublicCompetitionUrl,
  buildSecretariatUrl,
  parsePathnameToRoute,
} from './competitionNavigation';

describe('competition view navigation', () => {
  it('preserves selected competition, class, and public tab on the Secretariat route', () => {
    const url = buildSecretariatUrl('event-1', 'D21', 'STARTLIST');
    expect(url).toBe('/admin?id=event-1&class=D21&tab=STARTLIST');
    expect(parsePathnameToRoute('/admin', url.slice('/admin'.length))).toEqual({
      mode: 'SECRETARIAT',
      shortCode: null,
      competitionId: 'event-1',
      classFilter: 'D21',
      publicTab: 'STARTLIST',
    });
  });

  it('restores the same competition, class, and tab on the public route', () => {
    const url = buildPublicCompetitionUrl('event-1', 'D21', 'STARTLIST');
    expect(url).toBe('/?id=event-1&class=D21&tab=STARTLIST');
    expect(parsePathnameToRoute('/', url.slice(1))).toMatchObject({
      mode: 'PUBLIC',
      competitionId: 'event-1',
      classFilter: 'D21',
      publicTab: 'STARTLIST',
    });
  });

  it('does not infer a competition for the public overview route', () => {
    expect(buildPublicCompetitionUrl(null, null, 'RESULTS')).toBe('/');
    expect(parsePathnameToRoute('/')).toMatchObject({
      mode: 'PUBLIC',
      competitionId: null,
      classFilter: null,
    });
  });

  it('parses a selected competition and class from a public URL', () => {
    expect(
      parsePathnameToRoute('/', '?id=event-2&class=D21%20%E2%80%93%20D40')
    ).toMatchObject({
      mode: 'PUBLIC',
      competitionId: 'event-2',
      classFilter: 'D21 – D40',
    });
  });
});
