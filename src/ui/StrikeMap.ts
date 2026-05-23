import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LightningStrike } from '../types/lightning';

// Leaflet's default marker icons reference image files by path that Vite rewrites.
// We don't use those icons (all our markers use DivIcon), but this prevents console
// errors if Leaflet tries to resolve them internally.
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];

const MARKER_HOLD_MS  = 2_500;   // ms at full opacity before fade begins
const MARKER_FADE_MS  = 7_500;   // CSS transition duration
const MARKER_TOTAL_MS = MARKER_HOLD_MS + MARKER_FADE_MS + 200;  // when to remove from DOM

export type CenterChangeCallback = (lat: number, lon: number) => void;

export class StrikeMap {
  private map: L.Map;
  private centerMarker: L.Marker;
  private onCenterChange?: CenterChangeCallback;

  constructor(
    containerId: string,
    lat: number,
    lon: number,
    onCenterChange?: CenterChangeCallback
  ) {
    this.onCenterChange = onCenterChange;

    this.map = L.map(containerId, {
      center: [lat, lon],
      zoom: 8,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);

    // Draggable centre pin
    this.centerMarker = L.marker([lat, lon], {
      icon:          this.makeCenterIcon(),
      draggable:     true,
      title:         'Drag to move centre point',
      zIndexOffset:  1000,
    }).addTo(this.map);

    this.centerMarker.on('dragend', () => {
      const pos = this.centerMarker.getLatLng();
      this.onCenterChange?.(pos.lat, pos.lng);
    });
  }

  /** Move the centre pin (called when the user connects a new source). */
  setCenter(lat: number, lon: number): void {
    this.map.setView([lat, lon], this.map.getZoom());
    this.centerMarker.setLatLng([lat, lon]);
  }

  /** Add a fading marker for an incoming strike. */
  addStrike(strike: LightningStrike): void {
    const color =
      strike.polarity ===  1 ? '#f9a825' :  // positive → amber
      strike.polarity === -1 ? '#7c4dff' :  // negative → violet
                               '#4fc3f7';   // unknown  → accent blue

    // Size 6–18 px — scales with amplitude; unknown amplitude → mid-range
    const normAmp = strike.amplitude > 0 ? Math.min(1, strike.amplitude / 200) : 0.5;
    const size    = Math.round(6 + normAmp * 12);
    const glow    = size + 4;

    const icon = L.divIcon({
      className: 'strike-marker',
      html: `<span style="
        display:block;
        width:${size}px;height:${size}px;
        background:${color};
        border-radius:50%;
        box-shadow:0 0 ${glow}px ${color},0 0 ${glow * 2}px ${color}44;
      "></span>`,
      iconSize:   [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([strike.lat, strike.lon], {
      icon,
      interactive: false,
      keyboard:    false,
    }).addTo(this.map);

    // Begin fade after hold period
    const holdTimer = setTimeout(() => {
      const el = marker.getElement();
      if (el) {
        el.style.transition = `opacity ${MARKER_FADE_MS}ms ease-out`;
        el.style.opacity    = '0';
      }
    }, MARKER_HOLD_MS);

    // Remove element from map once fully faded
    const removeTimer = setTimeout(() => {
      marker.remove();
    }, MARKER_TOTAL_MS);

    // Safety: if the component is destroyed before timers fire, clean up
    marker.once('remove', () => {
      clearTimeout(holdTimer);
      clearTimeout(removeTimer);
    });
  }

  /** Call after the container becomes visible or is resized. */
  invalidateSize(): void {
    this.map.invalidateSize();
  }

  private makeCenterIcon(): L.DivIcon {
    return L.divIcon({
      className: 'center-pin',
      html:      '<div class="center-pin-ring"></div>',
      iconSize:  [28, 28],
      iconAnchor:[14, 14],
    });
  }
}
