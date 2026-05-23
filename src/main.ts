import './style.css';
import { AudioEngine, type ReverbType } from './audio/AudioEngine';
import { SoundMapper, type Preset, type Scale } from './audio/SoundMapper';
import { BlitzortungSource } from './sources/BlitzortungSource';
import { SimulatedSource } from './sources/SimulatedSource';
import { OpenWeatherSource } from './sources/OpenWeatherSource';
import type { IDataSource } from './sources/IDataSource';
import type { LightningStrike } from './types/lightning';
import type { MappingSnapshot } from './types/mapping';
import { SourceSelector } from './ui/SourceSelector';
import { StrikeLog } from './ui/StrikeLog';
import { MappingPanel } from './ui/MappingPanel';
import { StrikeMap } from './ui/StrikeMap';
import { Settings } from './util/Settings';
import { StrikeQueue } from './util/StrikeQueue';
import { SourceHealth } from './util/SourceHealth';

// --- Instances ---
const engine = new AudioEngine();
const mapper = new SoundMapper();
const strikeQueue = new StrikeQueue({ maxStrikesPerSecond: 8, maxPolyphony: 12 });

const sources: Record<string, IDataSource> = {
  simulated:   new SimulatedSource(),
  blitzortung: new BlitzortungSource(),
  openweather: new OpenWeatherSource(),
};

let activeSource: IDataSource | null = null;
let strikeCount = 0;
const health = new SourceHealth();

// --- DOM ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <h1>&#9889; Lightning Chimes</h1>
    <p class="subtitle">Real-time lightning data transformed into sound</p>
  </header>

  <main>
    <section class="panel" id="source-panel">
      <h2>Data Source</h2>
      <div id="source-selector"></div>
    </section>

    <section class="panel" id="sound-panel">
      <h2>Sound</h2>
      <div class="control-row">
        <label for="preset-select">Preset</label>
        <select id="preset-select">
          <option value="windchime">Wind Chime</option>
          <option value="bells">Bells</option>
          <option value="theremin">Theremin</option>
          <option value="percussion">Percussion</option>
          <option value="fm">FM Synthesis</option>
        </select>
      </div>
      <div class="control-row">
        <label for="scale-select">Scale / Chord</label>
        <select id="scale-select">
          <optgroup label="Scales">
            <option value="pentatonic">Pentatonic</option>
            <option value="wholetone">Whole Tone</option>
            <option value="just">Just Intonation</option>
            <option value="lydian">Lydian</option>
            <option value="chromatic">Chromatic</option>
          </optgroup>
          <optgroup label="Chord pools">
            <option value="maj7add9">Maj7(add9)</option>
            <option value="min9">Min7(9)</option>
            <option value="dim7">Dim7</option>
            <option value="opensus">Open Sus</option>
          </optgroup>
        </select>
      </div>
      <div class="control-row">
        <label for="root-select">Base note</label>
        <select id="root-select">
          <option value="48">C3</option>
          <option value="49">C#3</option>
          <option value="50">D3</option>
          <option value="51">D#3</option>
          <option value="52">E3</option>
          <option value="53">F3</option>
          <option value="54">F#3</option>
          <option value="55">G3</option>
          <option value="56">G#3</option>
          <option value="57">A3</option>
          <option value="58">A#3</option>
          <option value="59">B3</option>
          <option value="60">C4</option>
          <option value="61">C#4</option>
          <option value="62">D4</option>
          <option value="63">D#4</option>
          <option value="64">E4</option>
          <option value="65">F4</option>
          <option value="66">F#4</option>
          <option value="67">G4</option>
          <option value="68">G#4</option>
          <option value="69">A4</option>
          <option value="70">A#4</option>
          <option value="71">B4</option>
        </select>
      </div>
      <div class="control-row">
        <label for="octaves-select">Octaves</label>
        <select id="octaves-select">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
      </div>
      <div class="control-row">
        <label for="reverb-select">Reverb</label>
        <select id="reverb-select">
          <option value="room">Room</option>
          <option value="hall">Hall</option>
          <option value="canyon">Canyon</option>
        </select>
      </div>
      <div class="control-row">
        <label for="volume-slider">Volume</label>
        <input type="range" id="volume-slider" min="0" max="1" step="0.01" value="0.7" />
        <span id="volume-label">70%</span>
      </div>
      <div id="audio-notice" class="notice hidden">
        Click anywhere to enable audio (browser autoplay policy).
      </div>
    </section>

    <section class="panel" id="status-panel">
      <h2>Status</h2>
      <div class="status-row">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">Disconnected</span>
      </div>
      <div class="stat">Strikes heard: <strong id="strike-count">0</strong></div>
      <div class="stat">Rate: <strong id="strike-rate">—</strong></div>
      <div class="stat">Last strike: <strong id="last-strike">—</strong></div>
    </section>

    <section class="panel full-width" id="mapping-panel">
      <h2>Fine-tune</h2>
      <p class="panel-hint">Adjustments on top of the selected preset. Double-click any slider to reset it.</p>
      <div id="mapping-sliders"></div>
      <div class="mapping-snapshot-row">
        <button id="save-snapshot-btn" class="btn-secondary">Save snapshot</button>
        <label class="btn-secondary btn-file-label" for="load-snapshot-input">Load snapshot</label>
        <input type="file" id="load-snapshot-input" accept=".json" style="display:none" />
      </div>
    </section>

    <section class="panel full-width" id="map-panel">
      <div class="panel-header-row">
        <h2>Map</h2>
        <button id="heatmap-toggle" class="btn-toggle" aria-pressed="false">Heatmap</button>
      </div>
      <p class="panel-hint">Drag the blue pin to move the centre point. Reconnect to apply the new position.</p>
      <div id="strike-map"></div>
    </section>

    <section class="panel full-width" id="log-panel">
      <h2>Strike Log</h2>
      <div class="log-header">
        <span>Time</span><span>Pol</span><span>Lat, Lon</span><span>Amplitude</span><span>Source</span>
      </div>
      <div id="strike-log"></div>
    </section>
  </main>
`;

// --- Source selector ---
const selectorContainer = document.getElementById('source-selector')!;
const allConfigs = Object.values(sources).map((s) => s.config);

const selector = new SourceSelector(
  selectorContainer,
  allConfigs,
  async (sourceId, sourceSettings) => {
    if (activeSource) {
      activeSource.offStrike(onStrike);
      await activeSource.disconnect();
    }
    activeSource = sources[sourceId];

    const centerLat = Number(sourceSettings.lat ?? 0);
    const centerLon = Number(sourceSettings.lon ?? 0);
    mapper.setCenter(centerLat, centerLon);
    strikeMap.setCenter(centerLat, centerLon);

    setStatus('connecting', 'Connecting…');
    try {
      await activeSource.connect(sourceSettings);
      mapper.setCapabilities(activeSource.capabilities);
      activeSource.onStrike(onStrike);
      selector.setConnected(sourceId);
      setStatus('connected', `Connected · ${activeSource.config.label}`);
      Settings.save({ lastSourceId: sourceId, centerLat, centerLon });
      Settings.setSourceSettings(sourceId, sourceSettings);
    } catch (e) {
      setStatus('error', `Connection failed: ${(e as Error).message}`);
      activeSource = null;
      selector.setConnected(null);
    }
  },
  async () => {
    if (activeSource) {
      activeSource.offStrike(onStrike);
      await activeSource.disconnect();
      activeSource = null;
    }
    selector.setConnected(null);
    health.reset();
    updateHealthDisplay();
    setStatus('disconnected', 'Disconnected');
  }
);

// --- Strike log ---
const log = new StrikeLog(document.getElementById('strike-log')!);

// --- Settings restore ---
const saved = Settings.load();
const volumeSlider   = document.getElementById('volume-slider')  as HTMLInputElement;
const volumeLabel    = document.getElementById('volume-label')!;
const presetSelect   = document.getElementById('preset-select')  as HTMLSelectElement;
const scaleSelect    = document.getElementById('scale-select')   as HTMLSelectElement;
const rootSelect     = document.getElementById('root-select')    as HTMLSelectElement;
const octavesSelect  = document.getElementById('octaves-select') as HTMLSelectElement;
const reverbSelect   = document.getElementById('reverb-select')  as HTMLSelectElement;

volumeSlider.value  = String(saved.volume);
volumeLabel.textContent = `${Math.round(saved.volume * 100)}%`;
presetSelect.value  = saved.preset;
scaleSelect.value   = saved.scale;
rootSelect.value    = String(saved.rootMidi);
octavesSelect.value = String(saved.octaves);
reverbSelect.value  = saved.reverbType;

engine.setMasterVolume(saved.volume);
mapper.setPreset(saved.preset);
mapper.setScale(saved.scale);
mapper.setRootMidi(saved.rootMidi);
mapper.setOctaves(saved.octaves);
mapper.setCenter(saved.centerLat, saved.centerLon);

// --- Mapping panel ---
const mappingPanel = new MappingPanel(
  document.getElementById('mapping-sliders')!,
  (mapping) => {
    mapper.setMapping(mapping);
    Settings.setMappingConfig(mapper.getPreset(), mapping);
  }
);

// Load persisted mapping for the starting preset
mappingPanel.setMapping(Settings.getMappingConfig(saved.preset));
mapper.setMapping(Settings.getMappingConfig(saved.preset));

// --- Strike map ---
const strikeMap = new StrikeMap(
  'strike-map',
  saved.centerLat,
  saved.centerLon,
  (lat, lon) => {
    // Update source config fields if they exist (lat/lon inputs in source selector)
    const latEl = document.getElementById('field-lat') as HTMLInputElement | null;
    const lonEl = document.getElementById('field-lon') as HTMLInputElement | null;
    if (latEl) latEl.value = lat.toFixed(5);
    if (lonEl) lonEl.value = lon.toFixed(5);
    // Persist updated centre so it survives a page reload
    Settings.save({ centerLat: lat, centerLon: lon });
  }
);

// --- Heatmap toggle ---
const heatmapToggle = document.getElementById('heatmap-toggle') as HTMLButtonElement;
heatmapToggle.addEventListener('click', () => {
  const on = heatmapToggle.getAttribute('aria-pressed') !== 'true';
  heatmapToggle.setAttribute('aria-pressed', String(on));
  heatmapToggle.classList.toggle('active', on);
  strikeMap.setHeatmap(on);
});

// --- Audio ---
let visibilityListenerSetUp = false;
async function ensureAudio() {
  await engine.init();
  await engine.resume();
  if (!visibilityListenerSetUp) {
    engine.setupVisibilityListener();
    visibilityListenerSetUp = true;
  }
  // Apply persisted reverb on first init
  await engine.setReverb(saved.reverbType);
  document.getElementById('audio-notice')?.classList.add('hidden');
}

document.addEventListener('click', ensureAudio, { once: true });

window.addEventListener('load', () => {
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') {
    document.getElementById('audio-notice')?.classList.remove('hidden');
  }
  ctx.close();
});

// --- Controls ---
presetSelect.addEventListener('change', () => {
  const preset = presetSelect.value as Preset;
  mapper.setPreset(preset);
  Settings.save({ preset });
  // Load the mapping saved for this preset (or defaults)
  const m = Settings.getMappingConfig(preset);
  mappingPanel.setMapping(m);
  mapper.setMapping(m);
});

scaleSelect.addEventListener('change', () => {
  const scale = scaleSelect.value as Scale;
  mapper.setScale(scale);
  Settings.save({ scale });
});

rootSelect.addEventListener('change', () => {
  const rootMidi = parseInt(rootSelect.value, 10);
  mapper.setRootMidi(rootMidi);
  Settings.save({ rootMidi });
});

octavesSelect.addEventListener('change', () => {
  const octaves = parseInt(octavesSelect.value, 10);
  mapper.setOctaves(octaves);
  Settings.save({ octaves });
});

reverbSelect.addEventListener('change', async () => {
  const reverbType = reverbSelect.value as ReverbType;
  await ensureAudio();
  await engine.setReverb(reverbType);
  Settings.save({ reverbType });
});

volumeSlider.addEventListener('input', () => {
  const v = parseFloat(volumeSlider.value);
  engine.setMasterVolume(v);
  volumeLabel.textContent = `${Math.round(v * 100)}%`;
  Settings.save({ volume: v });
});

// --- Snapshot save (4.2) ---
document.getElementById('save-snapshot-btn')!.addEventListener('click', () => {
  const name = prompt('Name this snapshot:', `${mapper.getPreset()} snapshot`) ?? 'snapshot';
  const snapshot: MappingSnapshot = {
    version:  1,
    name,
    savedAt:  new Date().toISOString(),
    preset:   mapper.getPreset(),
    scale:    mapper.getScale(),
    rootMidi: mapper.getRootMidi(),
    octaves:  mapper.getOctaves(),
    mapping:  mapper.getMapping(),
  };

  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  // Sanitise name for filename
  const safeName = name.replace(/[^a-z0-9_\-\s]/gi, '').trim().replace(/\s+/g, '-') || 'snapshot';
  a.href     = url;
  a.download = `lightningchime-${safeName}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// --- Snapshot load (4.2) ---
document.getElementById('load-snapshot-input')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target?.result as string) as MappingSnapshot;

      // Basic validation
      if (data.version !== 1 || !data.mapping || !data.preset) {
        alert('This file doesn\'t look like a Lightning Chimes snapshot.');
        return;
      }

      // Apply preset + scale + root + octaves
      presetSelect.value  = data.preset;
      scaleSelect.value   = data.scale;
      rootSelect.value    = String(data.rootMidi);
      const snapshotOctaves = data.octaves ?? 2;
      octavesSelect.value = String(snapshotOctaves);

      mapper.setPreset(data.preset);
      mapper.setScale(data.scale);
      mapper.setRootMidi(data.rootMidi);
      mapper.setOctaves(snapshotOctaves);

      // Apply mapping
      mappingPanel.setMapping(data.mapping);
      mapper.setMapping(data.mapping);

      // Persist everything
      Settings.save({ preset: data.preset, scale: data.scale, rootMidi: data.rootMidi, octaves: snapshotOctaves });
      Settings.setMappingConfig(data.preset, data.mapping);

    } catch {
      alert('Could not read the snapshot file. Make sure it\'s a valid JSON file.');
    }

    // Reset input so the same file can be loaded again if needed
    (e.target as HTMLInputElement).value = '';
  };
  reader.readAsText(file);
});

// --- Health display ---
function updateHealthDisplay() {
  const rateEl = document.getElementById('strike-rate');
  const lastEl = document.getElementById('last-strike');
  if (rateEl) {
    const rate = health.getRate();
    rateEl.textContent = rate > 0 ? `${rate.toFixed(1)}/min` : '—';
  }
  if (lastEl) lastEl.textContent = health.getLastStrikeLabel();
}

health.setUpdateCallback(updateHealthDisplay);
// Also refresh the "X ago" label every 10 seconds without a new strike
setInterval(updateHealthDisplay, 10_000);

// Reset health stats when source disconnects
// (patched into the disconnect handler below via closure)

// --- Strike handler ---
function onStrike(strike: LightningStrike) {
  strikeQueue.push(strike);
}

strikeQueue.setCallback(async (strike: LightningStrike) => {
  await ensureAudio();
  const params = mapper.map(strike);
  strikeQueue.noteVoiceStart();
  engine.playStrike(params);
  log.add(strike);
  strikeMap.addStrike(strike);
  health.recordStrike();
  strikeCount++;
  document.getElementById('strike-count')!.textContent = String(strikeCount);

  // Signal voice end after full ADSR duration
  const voiceDuration = params.attackTime + params.decayTime + params.releaseTime + 0.1;
  setTimeout(() => strikeQueue.noteVoiceEnd(), voiceDuration * 1000);
});

// --- Status helpers ---
type StatusState = 'disconnected' | 'connecting' | 'connected' | 'error';
function setStatus(state: StatusState, text: string) {
  const dot   = document.getElementById('status-dot')!;
  const label = document.getElementById('status-text')!;
  dot.className   = `status-dot ${state}`;
  label.textContent = text;
}
