import type { SourceConfig } from '../types/lightning';

export type SourceChangeHandler = (id: string, settings: Record<string, string | number>) => void;

export class SourceSelector {
  private el: HTMLElement;
  private configs: SourceConfig[];
  private onConnect: SourceChangeHandler;
  private onDisconnect: () => void;
  private currentSourceId: string | null = null;
  private fieldExtras: Map<string, HTMLElement> = new Map();

  constructor(
    container: HTMLElement,
    configs: SourceConfig[],
    onConnect: SourceChangeHandler,
    onDisconnect: () => void
  ) {
    this.el = container;
    this.configs = configs;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.render();
  }

  setConnected(sourceId: string | null) {
    this.currentSourceId = sourceId;
    this.updateButton(sourceId);
  }

  private render() {
    this.el.innerHTML = '';
    const select = document.createElement('select');
    select.id = 'source-select';
    this.configs.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      select.appendChild(opt);
    });

    const fieldsContainer = document.createElement('div');
    fieldsContainer.id = 'source-fields';

    const desc = document.createElement('p');
    desc.id = 'source-desc';
    desc.className = 'source-desc';

    const btn = document.createElement('button');
    btn.id = 'connect-btn';
    btn.textContent = 'Connect';
    btn.className = 'btn btn-primary';

    this.el.append(select, desc, fieldsContainer, btn);
    this.renderFields(this.configs[0]);

    select.addEventListener('change', () => {
      const cfg = this.configs.find((c) => c.id === select.value)!;
      this.renderFields(cfg);
    });

    btn.addEventListener('click', () => {
      if (this.currentSourceId) {
        this.onDisconnect();
      } else {
        const cfg = this.configs.find((c) => c.id === select.value)!;
        const settings = this.readFields(cfg);
        this.onConnect(cfg.id, settings);
      }
    });
  }

  /** Inject `el` immediately after the row containing `field-{fieldKey}`. Re-injected on every re-render. */
  setFieldExtra(fieldKey: string, el: HTMLElement | null): void {
    if (el === null) this.fieldExtras.delete(fieldKey);
    else this.fieldExtras.set(fieldKey, el);
    this.injectExtras();
  }

  private injectExtras(): void {
    for (const [key, el] of this.fieldExtras) {
      const row = document.getElementById(`field-${key}`)?.closest('.field-row') as HTMLElement | null;
      if (row) row.after(el);
    }
  }

  private renderFields(cfg: SourceConfig) {
    const desc = document.getElementById('source-desc')!;
    desc.textContent = cfg.description;

    const container = document.getElementById('source-fields')!;
    container.innerHTML = '';
    cfg.fields.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'field-row';
      const label = document.createElement('label');
      label.textContent = f.label;
      label.htmlFor = `field-${f.key}`;

      let input: HTMLElement;
      if (f.type === 'select' && f.options) {
        const sel = document.createElement('select');
        sel.id = `field-${f.key}`;
        f.options.forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          if (o.value === String(f.default)) opt.selected = true;
          sel.appendChild(opt);
        });
        input = sel;
      } else {
        const inp = document.createElement('input');
        inp.id = `field-${f.key}`;
        inp.type = f.type === 'number' ? 'number' : 'text';
        inp.value = String(f.default);
        if (f.placeholder) inp.placeholder = f.placeholder;
        input = inp;
      }
      row.append(label, input);
      container.appendChild(row);
    });
    this.injectExtras();
  }

  private readFields(cfg: SourceConfig): Record<string, string | number> {
    const result: Record<string, string | number> = {};
    cfg.fields.forEach((f) => {
      const el = document.getElementById(`field-${f.key}`) as HTMLInputElement | HTMLSelectElement;
      result[f.key] = f.type === 'number' ? Number(el?.value ?? f.default) : (el?.value ?? String(f.default));
    });
    return result;
  }

  /** Returns the currently selected source ID and its field values — used for auto-reconnect. */
  getConnectionParams(): { sourceId: string; settings: Record<string, string | number> } | null {
    const select = document.getElementById('source-select') as HTMLSelectElement | null;
    if (!select) return null;
    const cfg = this.configs.find((c) => c.id === select.value);
    if (!cfg) return null;
    return { sourceId: cfg.id, settings: this.readFields(cfg) };
  }

  private updateButton(connectedId: string | null) {
    const btn = document.getElementById('connect-btn') as HTMLButtonElement;
    if (!btn) return;
    if (connectedId) {
      btn.textContent = 'Disconnect';
      btn.classList.add('btn-danger');
      btn.classList.remove('btn-primary');
    } else {
      btn.textContent = 'Connect';
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-danger');
    }
  }
}
