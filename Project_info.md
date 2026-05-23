# Lightning Chime

> A real-time lightning data sonifier — turns live strike events from the atmosphere into synthesized sound, like a wind chime driven by nature.

---

## What it does

Lightning Chime connects to a live lightning detection network and plays a synthesized sound for every strike detected. Each property of a strike — its polarity, strength, location, altitude, and detection delay — is mapped to a sonic parameter, so the character of the sound changes with the character of the storm. The result is something between a generative music instrument and a natural data visualization.

---

## Data sources

The app supports swappable data sources, selectable from the UI. All current sources are free and require no paid API key.

| Source | Type | Details |
|---|---|---|
| **Simulated** | Offline / synthetic | Generates random but realistic strikes around a configurable location. Uses Poisson-distributed timing for a natural feel. No internet required — good for development and testing. |
| **Blitzortung** | Live / community | Connects to `mqtt.lightningmaps.org`, a public MQTT broker run by the [Blitzortung.org](https://www.blitzortung.org) community. A worldwide volunteer sensor network. Provides global real-time strikes with ~1–5 second latency. No API key needed. |

More sources can be added by implementing the `IDataSource` interface (see `src/sources/IDataSource.ts`).

---

## Sound presets

Each preset is a different algorithm for translating strike properties into sound parameters.

| Preset | Character | Key mappings |
|---|---|---|
| **Wind Chime** | Gentle, melodic | Pentatonic scale notes; polarity selects octave; longitude → stereo pan; reverb depth scales with detection delay |
| **Bells** | Long, resonant | Harmonic series; negative polarity = fundamental, positive = fifth above; heavy reverb tail |
| **Theremin** | Eerie, continuous | Sawtooth wave; latitude drives pitch over 3 octaves (C2–C5); amplitude modulates filter cutoff |
| **Percussion** | Rhythmic, punchy | High amplitude → bass kick (low sine); low amplitude → hi-hat (high square); very short envelopes |

---

## How strike properties map to sound

| Lightning property | Audio parameter |
|---|---|
| Polarity (+ / −) | Waveform type, pitch octave, or harmonic choice |
| Amplitude (kA) | Volume / gain |
| Longitude offset from center | Stereo pan (left ↔ right) |
| Latitude | Pitch (Theremin preset) or note selection |
| Detection delay | Reverb mix depth |
| Altitude | Envelope release time |

---

## Project structure

```
Lightningchimes/
│
├── Project_info.md          ← you are here
├── index.html               ← app entry point (single HTML shell)
├── package.json             ← dependencies and npm scripts
├── tsconfig.json            ← TypeScript configuration
│
└── src/
    ├── main.ts              ← app root: wires UI, sources, and audio together
    ├── style.css            ← all app styles (dark theme)
    │
    ├── types/
    │   └── lightning.ts     ← shared TypeScript interfaces:
    │                           LightningStrike, AudioParams, SourceConfig
    │
    ├── sources/
    │   ├── IDataSource.ts   ← interface every data source must implement
    │   ├── BlitzortungSource.ts  ← live MQTT source (Blitzortung network)
    │   └── SimulatedSource.ts   ← offline random-strike generator
    │
    ├── audio/
    │   ├── AudioEngine.ts   ← Web Audio API wrapper: oscillators, reverb,
    │   │                       delay, LFO, envelope, stereo pan
    │   └── SoundMapper.ts   ← maps a LightningStrike → AudioParams
    │                           for each of the 4 presets
    │
    └── ui/
        ├── SourceSelector.ts ← dropdown + per-source config fields,
        │                        connect / disconnect button
        └── StrikeLog.ts      ← live scrolling log of recent strikes
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Build tool | [Vite](https://vite.dev/) v8 |
| Language | TypeScript |
| UI | Vanilla JS/TS — no framework |
| Audio | Web Audio API (browser-native) |
| Live data | [MQTT.js](https://github.com/mqttjs/MQTT.js) v5 over WebSocket |
| Geohashing | [ngeohash](https://github.com/sunng87/node-geohash) (for Blitzortung topic filtering) |

---

## Running the project

```bash
# Install dependencies (first time only)
npm install

# Start development server
npm run dev
# → opens at http://localhost:5173

# Build for production
npm run build
```

> **Audio note:** browsers require a user interaction before allowing audio. Click anywhere on the page once to unlock sound.

---

## Adding a new data source

1. Create `src/sources/YourSource.ts` implementing `IDataSource`
2. Define a `SourceConfig` describing the UI fields (label, type, default)
3. Register it in the `sources` map in `src/main.ts`

The UI will automatically pick it up — no other changes needed.

---

## Future ideas / backlog

- Map overlay showing strike locations in real time
- Additional free data sources (e.g. OpenWeather lightning API)
- User-editable sound mapping (MIDI-style CC knobs per property)
- Exportable audio recordings of sessions
- Mobile-responsive layout improvements
- Visual flash/glow effect synced to each strike
