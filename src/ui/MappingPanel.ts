import { DEFAULT_MAPPING } from '../types/mapping';
import type { MappingConfig } from '../types/mapping';

type ChangeCallback = (mapping: MappingConfig) => void;

interface SliderDef {
  key: keyof MappingConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const SLIDERS: SliderDef[] = [
  {
    key: 'gainMult',
    label: 'Volume',
    min: 0.1, max: 2.0, step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'pitchShift',
    label: 'Pitch',
    min: -24, max: 24, step: 1,
    format: (v) => v === 0 ? '0 st' : (v > 0 ? `+${v} st` : `${v} st`),
  },
  {
    key: 'reverbOffset',
    label: 'Reverb',
    min: -0.5, max: 0.5, step: 0.05,
    format: (v) => v === 0 ? '±0' : (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
  },
  {
    key: 'panWidth',
    label: 'Stereo Width',
    min: 0.0, max: 2.0, step: 0.05,
    format: (v) => v === 1 ? 'Normal' : (v === 0 ? 'Mono' : `${Math.round(v * 100)}%`),
  },
  {
    key: 'attackMult',
    label: 'Attack',
    min: 0.25, max: 4.0, step: 0.05,
    format: (v) => `${v.toFixed(2)}×`,
  },
  {
    key: 'envelopeMult',
    label: 'Decay / Release',
    min: 0.25, max: 4.0, step: 0.05,
    format: (v) => `${v.toFixed(2)}×`,
  },
];

export class MappingPanel {
  private container: HTMLElement;
  private mapping: MappingConfig = { ...DEFAULT_MAPPING };
  private onChange: ChangeCallback;
  private inputs: Map<keyof MappingConfig, HTMLInputElement> = new Map();
  private labels: Map<keyof MappingConfig, HTMLElement> = new Map();

  constructor(container: HTMLElement, onChange: ChangeCallback) {
    this.container = container;
    this.onChange = onChange;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = '';

    for (const def of SLIDERS) {
      const row = document.createElement('div');
      row.className = 'control-row mapping-row';

      const label = document.createElement('label');
      label.textContent = def.label;
      label.htmlFor = `mapping-${def.key}`;

      const input = document.createElement('input');
      input.type = 'range';
      input.id = `mapping-${def.key}`;
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.value = String(this.mapping[def.key]);

      const valueLabel = document.createElement('span');
      valueLabel.className = 'mapping-value';
      valueLabel.textContent = def.format(this.mapping[def.key] as number);

      // Double-click resets to default
      input.title = 'Double-click to reset';
      input.addEventListener('dblclick', () => {
        const defaultVal = DEFAULT_MAPPING[def.key] as number;
        input.value = String(defaultVal);
        valueLabel.textContent = def.format(defaultVal);
        (this.mapping[def.key] as number) = defaultVal;
        this.onChange({ ...this.mapping });
      });

      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        (this.mapping[def.key] as number) = v;
        valueLabel.textContent = def.format(v);
        this.onChange({ ...this.mapping });
      });

      row.append(label, input, valueLabel);
      this.container.appendChild(row);
      this.inputs.set(def.key, input);
      this.labels.set(def.key, valueLabel);
    }

    // Reset-all button
    const resetRow = document.createElement('div');
    resetRow.className = 'control-row mapping-reset-row';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset all';
    resetBtn.className = 'btn-secondary';
    resetBtn.addEventListener('click', () => this.resetAll());
    resetRow.appendChild(resetBtn);
    this.container.appendChild(resetRow);
  }

  /** Load a mapping object into all sliders — called when the preset changes. */
  setMapping(m: MappingConfig): void {
    this.mapping = { ...m };
    for (const def of SLIDERS) {
      const input = this.inputs.get(def.key);
      const label = this.labels.get(def.key);
      if (input) input.value = String(m[def.key]);
      if (label) label.textContent = def.format(m[def.key] as number);
    }
  }

  getMapping(): MappingConfig {
    return { ...this.mapping };
  }

  resetAll(): void {
    this.setMapping({ ...DEFAULT_MAPPING });
    this.onChange({ ...DEFAULT_MAPPING });
  }
}
