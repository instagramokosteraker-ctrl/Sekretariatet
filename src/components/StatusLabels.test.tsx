import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunnerStatus } from '../types/sportident';
import { RunnerStatusIndicator } from './StatusLabels';

const tooltipByStatus: Record<RunnerStatus, string> = {
  REGISTERED: 'Start ännu inte registrerad – väntar på start',
  CHECKED: 'Checkad i startfålla',
  IN_FOREST: 'Kvar i skogen',
  PRELIMINARY_FIN: 'Preliminär målgång',
  OK: 'Godkänd (OK)',
  MP: 'Felstämplat (MP)',
  DNF: 'Avbröt ett påbörjat lopp (DNF)',
  DNS: 'Starten blev inte av (DNS)',
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

  it('uses the requested start and finish meanings in full labels', () => {
    const registered = renderToStaticMarkup(
      <RunnerStatusIndicator status="REGISTERED" />
    );
    const dns = renderToStaticMarkup(
      <RunnerStatusIndicator status="DNS" />
    );
    const dnf = renderToStaticMarkup(
      <RunnerStatusIndicator status="DNF" />
    );

    expect(registered).toContain('Anmäld – ej startat');
    expect(dns).toContain('DNS – startade aldrig');
    expect(dnf).toContain('DNF – bröt loppet');
  });
});
