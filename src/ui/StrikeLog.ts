import type { LightningStrike } from '../types/lightning';

const MAX_ENTRIES = 40;

export class StrikeLog {
  private el: HTMLElement;
  private count = 0;

  constructor(container: HTMLElement) {
    this.el = container;
  }

  add(strike: LightningStrike) {
    this.count++;
    const row = document.createElement('div');
    row.className = `log-row ${strike.polarity === 1 ? 'pos' : strike.polarity === -1 ? 'neg' : 'unk'}`;

    const time = new Date(strike.time).toLocaleTimeString();
    const polIcon = strike.polarity === 1 ? '⊕' : strike.polarity === -1 ? '⊖' : '○';
    const amp = strike.amplitude > 0 ? `${strike.amplitude.toFixed(0)} kA` : '—';

    row.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-pol">${polIcon}</span>
      <span class="log-coord">${strike.lat.toFixed(2)}, ${strike.lon.toFixed(2)}</span>
      <span class="log-amp">${amp}</span>
      <span class="log-src">${strike.source}</span>
    `;

    this.el.prepend(row);

    // Remove oldest entries
    const rows = this.el.querySelectorAll('.log-row');
    if (rows.length > MAX_ENTRIES) {
      rows[rows.length - 1].remove();
    }
  }

  clear() {
    this.el.innerHTML = '';
    this.count = 0;
  }

  getCount() {
    return this.count;
  }
}
