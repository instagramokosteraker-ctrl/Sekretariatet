import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunnerStatus } from '../types/sportident';
import { RunnerStatusIndicator } from './StatusLabels';

const tooltipByStatus: Record<RunnerStatus, string> = {
  REGISTERED: 'Anmäld',
  CHECKED: 'Checkad i startfålla',
  IN_FOREST: 'Kvar i skogen',
  PRELIMINARY_FIN: 'Preliminär målgång',
  OK: 'Godkänd (OK)',
  MP: 'Felstämplat (MP)',
  DNF: 'Utgått (DNF)',
  DNS: 'Ej start (DNS)',
};

describe('RunnerStatusIndicator', () => {
  it('renders only the status symbol in compact mode with a descriptive tooltip', () => {
    for (const [status, tooltip] of Object.entries(tooltipByStatus) as [
      RunnerStatus,
      string,
    ][]) {
      const markup = renderToStaticMarkup(
        <RunnerStatusIndicator status={status} compact />
      );
      const visibleText = markup.replace(/<[^>]*>/g, '');

      expect(visibleText).toBe('');
      expect(markup).toContain(`title="${tooltip}"`);
      expect(markup).toContain(`aria-label="${tooltip}"`);
    }
  });

  it('retains the descriptive label outside compact mode', () => {
    const markup = renderToStaticMarkup(
      <RunnerStatusIndicator status="CHECKED" />
    );

    expect(markup).toContain('Checkad');
    expect(markup).toContain('title="Checkad i startfålla"');
  });
});
