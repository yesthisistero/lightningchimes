import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import type { LightningStrike } from '../types/lightning';

// Leaflet's default marker icons reference image files by path that Vite rewrites.
// We don't use those icons (all our markers use DivIcon), but this prevents console
// errors if Leaflet tries to resolve them internally.
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];

const MARKER_HOLD_MS  = 2_500;
const MARKER_FADE_MS  = 7_500;
const MARKER_TOTAL_MS = MARKER_HOLD_MS + MARKER_FADE_MS + 200;

const MAX_HEAT_POINTS = 500;

const HEAT_GRADIENT: L.ColorGradientConfig = {
  0.15: '#7c4dff',
  0.45: '#4fc3f7',
  0.75: '#f9a825',
  1.00: '#ff6d00',
};

export type CenterChangeCallback = (lat: number, lon: number) => void;

// --------------------------------------------------- rubber-band parameters --

export interface RubberBandParams {
  /** Resistance felt while dragging past the world edge — 0 = silky loose, 100 = nearly rigid */
  resistance:   number;
  /** Hard stop distance beyond the world edge in degrees — how far you can stretch before it blocks */
  maxPull:      number;
  /** Spring-back animation duration in ms */
  snapDuration: number;
  /** Bounce overshoot before settling — 0 = ease-out only, 40 = strong spring */
  overshoot:    number;
  /** Momentum friction after a fast flick — 0 = glides far, 100 = stops immediately */
  friction:     number;
}

const RB_DEFAULTS: RubberBandParams = {
  resistance:   40,
  maxPull:      25,
  snapDuration: 380,
  overshoot:    14,
  friction:     45,
};

// Penner back ease-out: reaches 1.0 at t=1, overshoots by ~s * 0.064 around t=0.7.
// s = 0 → smooth ease-out cubic; s = 1.70158 → classic spring overshoot.
function easeOutBack(t: number, s: number): number {
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

// ------------------------------------------------------------------ class --

export class StrikeMap {
  private map: L.Map;
  private centerMarker: L.Marker;
  private radiusCircle: L.Circle | null  = null;
  private onCenterChange?: CenterChangeCallback;

  // Heatmap
  private heatPoints: L.HeatLatLngTuple[] = [];
  private heatLayer: L.HeatLayer | null   = null;
  private heatVisible                     = false;

  // Rubber-band
  private rbParams: RubberBandParams = { ...RB_DEFAULTS };
  private snapActive                 = false;

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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors ' +
        '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
      // noWrap intentionally omitted — tiles repeat in the rubber-band spring zone,
      // fading out via the #strike-map::after vignette overlay in CSS.
    }).addTo(this.map);

    // Centre pin — click on map to reposition, no drag
    this.centerMarker = L.marker([lat, lon], {
      icon:          this.makeCenterIcon(),
      draggable:     false,
      interactive:   true,
      zIndexOffset:  1000,
    }).addTo(this.map);

    // Prevent map click from firing when the pin itself is clicked
    this.centerMarker.on('click', (e) => L.DomEvent.stopPropagation(e));

    // Click anywhere on the map to move the centre
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      this.centerMarker.setLatLng([lat, lng]);
      this.radiusCircle?.setLatLng([lat, lng]);
      if (this.radiusCircle) {
        this.map.fitBounds(this.radiusCircle.getBounds(), { padding: [20, 20] });
      }
      this.onCenterChange?.(lat, lng);
    });

    this.setupRubberBand();
  }

  // ----------------------------------------------------------------- public --

  /** Move the centre pin and radius circle programmatically. */
  setCenter(lat: number, lon: number): void {
    this.map.setView([lat, lon], this.map.getZoom());
    this.centerMarker.setLatLng([lat, lon]);
    this.radiusCircle?.setLatLng([lat, lon]);
  }

  /** Show a radius circle around the centre. Pass null to hide it. */
  setRadius(km: number | null): void {
    this.radiusCircle?.remove();
    this.radiusCircle = null;
    if (km !== null) {
      this.radiusCircle = L.circle(this.centerMarker.getLatLng(), {
        radius:      km * 1000,
        color:       '#4fc3f7',
        weight:      1.5,
        opacity:     0.5,
        fillColor:   '#4fc3f7',
        fillOpacity: 0.04,
        interactive: false,
      }).addTo(this.map);
      this.map.invalidateSize();
      this.map.fitBounds(this.radiusCircle.getBounds(), { padding: [20, 20] });
    }
  }

  /** Add a fading marker for an incoming strike. */
  addStrike(strike: LightningStrike): void {
    // --- heatmap accumulation ---
    const intensity = strike.amplitude > 0 ? Math.min(1, strike.amplitude / 200) : 0.5;
    this.heatPoints.push([strike.lat, strike.lon, intensity]);
    if (this.heatPoints.length > MAX_HEAT_POINTS) this.heatPoints.shift();
    if (this.heatVisible && this.heatLayer) this.heatLayer.setLatLngs(this.heatPoints);

    // --- fading dot marker ---
    const color =
      strike.polarity ===  1 ? '#f9a825' :
      strike.polarity === -1 ? '#7c4dff' :
                               '#4fc3f7';

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

    const holdTimer = setTimeout(() => {
      const el = marker.getElement();
      if (el) {
        el.style.transition = `opacity ${MARKER_FADE_MS}ms ease-out`;
        el.style.opacity    = '0';
      }
    }, MARKER_HOLD_MS);

    const removeTimer = setTimeout(() => {
      marker.remove();
    }, MARKER_TOTAL_MS);

    marker.once('remove', () => {
      clearTimeout(holdTimer);
      clearTimeout(removeTimer);
    });
  }

  /** Show or hide the heatmap layer. */
  setHeatmap(on: boolean): void {
    this.heatVisible = on;
    if (on) {
      if (!this.heatLayer) {
        this.heatLayer = L.heatLayer(this.heatPoints, {
          radius:     22,
          blur:       16,
          minOpacity: 0.3,
          gradient:   HEAT_GRADIENT,
        }).addTo(this.map);
      } else {
        this.heatLayer.setLatLngs(this.heatPoints).addTo(this.map);
      }
    } else {
      this.heatLayer?.remove();
    }
  }

  /** Call after the container becomes visible or is resized. */
  invalidateSize(): void {
    this.map.invalidateSize();
  }

  // --------------------------------------------------------- rubber-band --

  private setupRubberBand(): void {
    this.applyRbOptions();

    // Replace Leaflet's own flat pan-inside-bounds with our custom spring.
    // Leaflet calls _panInsideBoundsIfNeeded() at the end of every drag event;
    // we no-op it here and handle snap-back ourselves.
    (this.map as unknown as Record<string, () => void>)._panInsideBoundsIfNeeded = () => {};

    // Cancel any in-progress spring animation if the user grabs the map again
    this.map.on('dragstart', () => { this.snapActive = false; });

    // After drag ends, spring back if the centre is outside the real world bounds
    this.map.on('dragend', () => {
      if (this.isPastWorld(this.map.getCenter())) {
        this.springTo(this.clampToWorld(this.map.getCenter()));
      }
    });

    this.buildRbControl().addTo(this.map);
  }

  /**
   * Push current params into Leaflet's option object.
   *
   * • resistance  → maxBoundsViscosity at the real world edge (drag feel)
   * • maxPull     → outer hard-stop boundary (expanded maxBounds)
   * • friction    → inertia deceleration (momentum after flick)
   *
   * Leaflet reads these from map.options during the next drag, so the change
   * takes effect immediately without needing to reconnect anything.
   */
  private applyRbOptions(): void {
    const { resistance, maxPull, friction } = this.rbParams;

    // Two-layer boundary:
    //   Inner layer (real world) — viscosity creates rubber-band drag resistance
    //   Outer layer (expanded)  — hard wall so the map can't stretch further than maxPull
    (this.map.options as L.MapOptions).maxBounds = L.latLngBounds(
      L.latLng(-90 - maxPull, -180 - maxPull),
      L.latLng( 90 + maxPull,  180 + maxPull),
    );
    // Viscosity at outer wall: resistance param is re-used as a "stiffness" here.
    // High resistance → very sticky outer wall AND snappier spring-back feel.
    (this.map.options as L.MapOptions).maxBoundsViscosity = 0.3 + (resistance / 100) * 0.65;

    // Inertia deceleration: low friction → long glide (≈500 px/s²), high → quick stop (≈10 000)
    (this.map.options as L.MapOptions).inertiaDeceleration =
      500 + (friction / 100) * 9_500;
  }

  private isPastWorld(c: L.LatLng): boolean {
    return c.lat < -90 || c.lat > 90 || c.lng < -180 || c.lng > 180;
  }

  private clampToWorld(c: L.LatLng): L.LatLng {
    return L.latLng(
      Math.max(-90,  Math.min(90,   c.lat)),
      Math.max(-180, Math.min(180,  c.lng)),
    );
  }

  private springTo(to: L.LatLng): void {
    const { snapDuration, overshoot } = this.rbParams;
    const from  = this.map.getCenter();
    const dLat  = to.lat - from.lat;
    const dLng  = to.lng - from.lng;
    const start = performance.now();
    this.snapActive = true;

    // Map overshoot 0–40 → Penner s-param 0–1.70158
    const s = (overshoot / 40) * 1.70158;

    const frame = (now: number) => {
      if (!this.snapActive) return;
      const t  = Math.min(1, (now - start) / snapDuration);
      const et = overshoot === 0
        ? 1 - Math.pow(1 - t, 3)    // ease-out cubic when no overshoot requested
        : easeOutBack(t, s);

      this.map.setView(
        [from.lat + dLat * et, from.lng + dLng * et],
        this.map.getZoom(),
        { animate: false },
      );

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        this.snapActive = false;
        // Hard-clamp at animation end to guarantee exact landing on world boundary
        if (this.isPastWorld(this.map.getCenter())) {
          this.map.setView(to, this.map.getZoom(), { animate: false });
        }
      }
    };

    requestAnimationFrame(frame);
  }

  // --------------------------------------------- floating overlay control --

  private buildRbControl(): L.Control {
    const self = this;

    function sliderRow(
      key:   keyof RubberBandParams,
      label: string,
      min:   number,
      max:   number,
      step:  number,
      unit:  string,
    ): string {
      const val = self.rbParams[key];
      return `
        <div class="rb-row">
          <span class="rb-label">${label}</span>
          <input class="rb-slider" type="range"
            data-rb="${key}" min="${min}" max="${max}" step="${step}" value="${val}">
          <span class="rb-val" data-rbv="${key}">${val}</span>
          <span class="rb-unit">${unit}</span>
        </div>`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CtrlClass = (L.Control as any).extend({
      options: { position: 'bottomleft' },

      onAdd(): HTMLElement {
        const wrap = L.DomUtil.create('div', 'rb-panel');
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.disableScrollPropagation(wrap);

        // Body is first in DOM so it expands upward on screen when the
        // control is anchored to the bottom-left corner.
        wrap.innerHTML = `
          <div class="rb-body hidden">
            <div class="rb-heading">Edge spring</div>
            ${sliderRow('resistance',   'Resistance',  0,   100, 5,  '%' )}
            ${sliderRow('maxPull',      'Max pull',    2,   60,  2,  '°' )}
            ${sliderRow('snapDuration', 'Snap',        80,  700, 10, 'ms')}
            ${sliderRow('overshoot',    'Overshoot',   0,   40,  2,  '%' )}
            ${sliderRow('friction',     'Friction',    0,   100, 5,  '%' )}
          </div>
          <button class="rb-toggle" title="Edge spring settings">&#9881;&nbsp;Spring</button>
        `;

        const toggle = wrap.querySelector('.rb-toggle') as HTMLButtonElement;
        const body   = wrap.querySelector('.rb-body')   as HTMLElement;

        toggle.addEventListener('click', () => {
          const nowOpen = body.classList.toggle('rb-open');
          body.classList.toggle('hidden', !nowOpen);
          toggle.classList.toggle('active', nowOpen);
        });

        wrap.querySelectorAll<HTMLInputElement>('.rb-slider').forEach((slider) => {
          slider.addEventListener('input', () => {
            const key = slider.dataset.rb as keyof RubberBandParams;
            const val = Number(slider.value);
            self.rbParams[key] = val;
            const valEl = wrap.querySelector(`[data-rbv="${key}"]`) as HTMLElement | null;
            if (valEl) valEl.textContent = String(val);
            self.applyRbOptions();
          });
        });

        return wrap;
      },
    });

    return new CtrlClass();
  }

  // ---------------------------------------------------------------- helpers --

  private makeCenterIcon(): L.DivIcon {
    return L.divIcon({
      className: 'center-pin',
      html:      '<div class="center-crosshair"></div>',
      iconSize:  [16, 16],
      iconAnchor:[8, 8],
    });
  }
}
