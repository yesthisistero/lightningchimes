# Lightning Chime — Development Backlog

Ordered by priority: all technical work first, design and visual polish last.
Items within each phase are roughly sequenced — earlier items unblock later ones.

---

## Phase 1 — Stability & Correctness

Get the current scaffold working reliably before building on top of it.

- [ ] **Verify Blitzortung MQTT connection end-to-end**
  Confirm the broker URL, topic format, and message schema are current. The Blitzortung project has changed endpoints before. Test with a real storm event or a known active region.

- [ ] **Reconnection logic for Blitzortung source**
  MQTT.js has built-in reconnect, but the app's `connected` state and UI status dot don't track it. Wire up the `reconnect`, `offline`, and `close` events so the status panel reflects actual connection health.

- [ ] **Strike burst throttling**
  During an active storm, Blitzortung can deliver dozens of strikes per second. Scheduling that many `OscillatorNode` instances simultaneously will glitch or crash the audio thread. Add a queue with a configurable max-strikes-per-second cap (e.g. 8/s), dropping or merging excess events.

- [ ] **AudioContext lifecycle hardening**
  Browsers suspend `AudioContext` on tab background/foreground switches. Add a `visibilitychange` listener that calls `resume()` when the tab comes back into focus. Also gate `playStrike` so it silently no-ops if the context is closed.

- [ ] **Settings persistence with localStorage**
  Save the last-used source, preset, volume, center lat/lon, and source-specific fields to `localStorage`. Restore them on page load so the user doesn't have to re-configure every session.

- [ ] **Remove leftover Vite template files**
  Delete `src/counter.ts`, `src/assets/hero.png`, `src/assets/typescript.svg`, `src/assets/vite.svg` — all scaffolding from the Vite template, not used by the app.

---

## Phase 2 — Audio Engine Depth

Make the sound generation richer and more expressive before adding more data.

- [ ] **Polyphony manager**
  Cap the number of simultaneously active `OscillatorNode` instances (suggested: 12). When the cap is hit, steal the oldest voice. Prevents audio thread overload and gives the sound a natural max-density ceiling.

- [ ] **Proper ADSR envelopes**
  The current envelopes are AD (attack + decay only). Add sustain and release stages, and expose them as per-preset tunable parameters so each preset has a distinct character.

- [ ] **FM synthesis preset**
  Implement a proper 2-operator FM patch (carrier + modulator) as a 5th preset. Map amplitude → modulation index and polarity → carrier-to-modulator ratio. FM is particularly expressive for lightning — small parameter changes create dramatically different timbres.

- [ ] **Better reverb impulse response**
  The current reverb is a synthesized exponential decay. Replace it with a choice of 2–3 synthesized IRs (small room, large hall, outdoor/canyon) selectable per preset or automatically chosen based on the number of recent strikes.

- [ ] **Pitch quantization options**
  Currently wind-chime is pentatonic C. Add a selector for scale/tuning: pentatonic, whole-tone, chromatic, just intonation, custom root note. Store the choice in localStorage.

- [ ] **Strike deduplication**
  Blitzortung can occasionally emit the same strike twice within milliseconds (multi-sensor confirmation artifacts). Deduplicate by `id` within a 500 ms window before passing to the audio engine.

---

## Phase 3 — Data Sources

Expand the number of live data feeds, all free.

- [ ] **OpenWeather Lightning API integration**
  OpenWeather has a free tier (1 000 calls/day). Unlike Blitzortung it's REST/polling rather than WebSocket — poll every 30–60 seconds for new strikes within a radius. Provides a `quality` confidence field that can modulate gain or filter cutoff.
  Fields available: `id`, `datetime`, `lat`, `lon`, `quality`, `error` (location uncertainty in km).

- [ ] **Geographic region filter for Blitzortung**
  Currently subscribes to a single geohash cell. Add the ability to subscribe to multiple adjacent cells (a radius in geohash space) so the user gets a wider view without switching to a global feed.

- [ ] **Data source health indicator**
  Show the last-strike timestamp and strike rate (strikes/min, rolling 5-min window) in the status panel. Makes it obvious when a source is connected but quiet vs. genuinely broken.

- [ ] **IDataSource v2: metadata contract**
  Extend the interface to include a `capabilities` object declaring which fields a source provides (`hasPolarity`, `hasAmplitude`, etc.). The SoundMapper can then fall back gracefully instead of silently mapping zeros.

---

## Phase 4 — Sound Mapping Control

Give the user real control over how data maps to sound.

- [ ] **Per-property mapping sliders**
  Expose the key mapping ranges as editable controls: min/max gain, pitch range, pan sensitivity, reverb wet level. Store in localStorage per preset.

- [ ] **Mapping presets save/load**
  Allow the user to name and save their current mapping configuration as a JSON file (download) and reload it later (upload). Useful for sharing interesting configurations.

- [ ] **Strike rate → tempo sync**
  Optionally quantize strike timing to a user-set BPM so strikes snap to a rhythmic grid. Creates a different feel — less ambient, more structured. Toggle on/off.

- [ ] **MIDI output**
  Use the Web MIDI API to send MIDI note-on/off messages alongside the audio. Maps each strike to a MIDI note, velocity, and channel. Lets the app drive external synthesizers or DAWs.

---

## Phase 5 — Map & Visualization

Add spatial context to complement the audio — still technical, no design polish yet.

- [ ] **Leaflet map integration**
  Embed a [Leaflet](https://leafletjs.com/) map (free, open-source) showing the configured center point and incoming strikes as markers. Use OpenStreetMap tiles (free, no API key).

- [ ] **Strike fade-out on map**
  Each strike marker fades from bright to transparent over ~10 seconds, so the map shows recent activity density at a glance. Use CSS transitions driven by a timestamp comparison on each animation frame.

- [ ] **Center-pin drag to reconfigure**
  Allow the user to drag the center pin on the map to update the source lat/lon in real time, replacing the manual number fields.

- [ ] **Strike history heatmap layer**
  Accumulate the last N strikes (e.g. 500) and render a simple density heatmap using Leaflet.heat. Toggle on/off.

---

## Phase 6 — Recording & Export

- [ ] **Audio session recorder**
  Use the Web Audio API's `MediaRecorder` + `AudioContext.createMediaStreamDestination()` to record the generated audio to a WAV or WebM file. Provide start/stop recording controls and a download button.

- [ ] **Strike log export**
  Download the current strike log as a CSV (timestamp, lat, lon, polarity, amplitude, source). Useful for post-session analysis.

---

## Phase 7 — Testing & Code Quality

- [ ] **Unit tests for SoundMapper**
  Test that each preset produces deterministic, valid `AudioParams` for known input strikes (edge cases: zero amplitude, unknown polarity, extreme coordinates).

- [ ] **Unit tests for SimulatedSource**
  Test strike rate distribution over time, coordinate bounds, and polarity ratio.

- [ ] **Type strictness pass**
  Enable `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.json` and resolve all resulting errors.

- [ ] **ESLint setup**
  Add ESLint with `@typescript-eslint` rules. Integrate into the `npm run build` step so lint errors block production builds.

---

## Phase 8 — Design & Visual Polish

*Start this phase only after Phase 1–4 are solid.*

- [ ] **Visual identity / color system**
  Define a proper design token set (primary, accent, semantic colors for polarity, alert states). Current dark theme is functional but ad hoc.

- [ ] **Lightning flash effect**
  Full-screen or panel-edge flash animation synced to each strike. Intensity scales with amplitude. Subtle enough not to be distracting at high strike rates.

- [ ] **Animated waveform visualizer**
  Real-time oscilloscope or spectrum analyzer using `AnalyserNode` drawn on a `<canvas>`. Reflects the live audio output.

- [ ] **Mobile layout**
  Current single-column responsive fallback works but is unstyled for mobile. Redesign the panel layout for portrait phone screens.

- [ ] **Onboarding / empty state**
  First-time visitor sees a brief explanation of what the app does and is guided to pick a source and click Connect before any sound plays.

- [ ] **Favicon and app icon**
  Replace the default Vite favicon with a lightning bolt SVG. Add a web app manifest for "add to home screen" support on mobile.

---

## Icebox — Possible future directions

Not prioritized, but worth keeping in mind.

- WebSocket proxy server (Node.js) to relay Blitzortung data without CORS/browser limitations
- Multiple simultaneous active sources with source-specific audio channels
- Generative ambient background drone that reacts to long-term strike rate trends
- Integration with weather forecast APIs to predict incoming storms
- Electron or Tauri wrapper for a native desktop app with system tray presence
- Community preset sharing (upload/download presets from a simple backend)
