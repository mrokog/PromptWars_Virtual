/**
 * @fileoverview Interactive venue map renderer for StadiumIQ.
 * Renders an SVG stadium floor plan with crowd-density heat-layer,
 * zone interaction, and route overlays.
 * Integrates with Google Maps Directions API for turn-by-turn navigation.
 * @module maps
 * @version 1.0.0
 */

'use strict';

import { sanitize, throttle } from './utils.js';
import { DENSITY_COLORS }     from './crowd.js';

// ---------------------------------------------------------------------------
// SVG venue geometry
// ---------------------------------------------------------------------------

/**
 * Zone geometrical definitions on the 700×520 SVG canvas.
 * `path` is SVG path data or rect attributes.
 * Each zone maps to a DataStore zone ID.
 */
let ZONE_GEOMETRY = [];
let CURRENT_SPORT = 'cricket';

const VENUE_PRESETS = {
  football: [
    // Stands
    { id: 'north-stand', label: 'North\nStand',     cx: 350, cy: 75,  shape: 'rect',   x: 195, y: 30,  w: 310, h: 90,  rx: 8  },
    { id: 'south-stand', label: 'South\nStand',     cx: 350, cy: 445, shape: 'rect',   x: 195, y: 400, w: 310, h: 90,  rx: 8  },
    { id: 'west-stand',  label: 'West\nStand',      cx: 75,  cy: 260, shape: 'rect',   x: 30,  y: 150, w: 90,  h: 220, rx: 8  },
    { id: 'east-stand',  label: 'East\nStand',      cx: 625, cy: 260, shape: 'rect',   x: 580, y: 150, w: 90,  h: 220, rx: 8  },
    { id: 'nw-corner',   label: 'NW',               cx: 110, cy: 115, shape: 'rect',   x: 30,  y: 30,  w: 130, h: 110, rx: 30 },
    { id: 'ne-corner',   label: 'NE',               cx: 590, cy: 115, shape: 'rect',   x: 540, y: 30,  w: 130, h: 110, rx: 30 },
    { id: 'sw-corner',   label: 'SW',               cx: 110, cy: 405, shape: 'rect',   x: 30,  y: 380, w: 130, h: 110, rx: 30 },
    { id: 'se-corner',   label: 'SE',               cx: 590, cy: 405, shape: 'rect',   x: 540, y: 380, w: 130, h: 110, rx: 30 },
    // Gates
    { id: 'gate-a',      label: 'Gate A',            cx: 350, cy: 16,  shape: 'rect',   x: 295, y: 4,   w: 110, h: 22,  rx: 4  },
    { id: 'gate-b',      label: 'Gate B',            cx: 350, cy: 504, shape: 'rect',   x: 295, y: 494, w: 110, h: 22,  rx: 4  },
    { id: 'gate-c',      label: 'Gate C',            cx: 684, cy: 260, shape: 'rect',   x: 674, y: 220, w: 22,  h: 80,  rx: 4  },
    { id: 'gate-d',      label: 'Gate D',            cx: 16,  cy: 260, shape: 'rect',   x: 4,   y: 220, w: 22,  h: 80,  rx: 4  },
    // Concessions
    { id: 'food-n1',     label: '🍔 N1',             cx: 290, cy: 140, shape: 'circle', r: 18  },
    { id: 'food-n2',     label: '🍔 N2',             cx: 410, cy: 140, shape: 'circle', r: 18  },
    { id: 'food-s1',     label: '🍔 S1',             cx: 290, cy: 380, shape: 'circle', r: 18  },
    { id: 'food-s2',     label: '🍔 S2',             cx: 410, cy: 380, shape: 'circle', r: 18  },
    { id: 'food-e1',     label: '🍔 E1',             cx: 540, cy: 260, shape: 'circle', r: 18  },
    { id: 'food-w1',     label: '🍔 W1',             cx: 160, cy: 260, shape: 'circle', r: 18  },
    // Restrooms
    { id: 'rest-n1',     label: '🚻 N1',             cx: 240, cy: 110, shape: 'circle', r: 12  },
    { id: 'rest-n2',     label: '🚻 N2',             cx: 460, cy: 110, shape: 'circle', r: 12  },
    { id: 'rest-s1',     label: '🚻 S1',             cx: 240, cy: 410, shape: 'circle', r: 12  },
    { id: 'rest-w1',     label: '🚻 W1',             cx: 160, cy: 310, shape: 'circle', r: 12  },
    // First Aid
    { id: 'aid-north',   label: '➕',                cx: 350, cy: 165, shape: 'circle', r: 12  },
    { id: 'aid-south',   label: '➕',                cx: 350, cy: 355, shape: 'circle', r: 12  },
  ],
  cricket: [
    // Circular Stands
    { id: 'north-stand', label: 'North\nStand',     cx: 350, cy: 75,  shape: 'rect',   x: 230, y: 30,  w: 240, h: 70,  rx: 35 },
    { id: 'south-stand', label: 'South\nStand',     cx: 350, cy: 445, shape: 'rect',   x: 230, y: 420, w: 240, h: 70,  rx: 35 },
    { id: 'west-stand',  label: 'West\nStand',      cx: 80,  cy: 260, shape: 'rect',   x: 40,  y: 140, w: 70,  h: 240, rx: 35 },
    { id: 'east-stand',  label: 'East\nStand',      cx: 620, cy: 260, shape: 'rect',   x: 590, y: 140, w: 70,  h: 240, rx: 35 },
    { id: 'nw-corner',   label: 'NW',               cx: 140, cy: 120, shape: 'circle', r: 50 },
    { id: 'ne-corner',   label: 'NE',               cx: 560, cy: 120, shape: 'circle', r: 50 },
    { id: 'sw-corner',   label: 'SW',               cx: 140, cy: 400, shape: 'circle', r: 50 },
    { id: 'se-corner',   label: 'SE',               cx: 560, cy: 400, shape: 'circle', r: 50 },
    // Gates
    { id: 'gate-a',      label: 'Gate A',            cx: 350, cy: 16,  shape: 'rect',   x: 295, y: 4,   w: 110, h: 22,  rx: 4  },
    { id: 'gate-b',      label: 'Gate B',            cx: 350, cy: 504, shape: 'rect',   x: 295, y: 494, w: 110, h: 22,  rx: 4  },
    { id: 'gate-c',      label: 'Gate C',            cx: 684, cy: 260, shape: 'rect',   x: 674, y: 220, w: 22,  h: 80,  rx: 4  },
    { id: 'gate-d',      label: 'Gate D',            cx: 16,  cy: 260, shape: 'rect',   x: 4,   y: 220, w: 22,  h: 80,  rx: 4  },
    // Concessions
    { id: 'food-n1',     label: '🍔 N1',             cx: 290, cy: 115, shape: 'circle', r: 18  },
    { id: 'food-n2',     label: '🍔 N2',             cx: 410, cy: 115, shape: 'circle', r: 18  },
    { id: 'food-s1',     label: '🍔 S1',             cx: 290, cy: 405, shape: 'circle', r: 18  },
    { id: 'food-s2',     label: '🍔 S2',             cx: 410, cy: 405, shape: 'circle', r: 18  },
    { id: 'food-e1',     label: '🍔 E1',             cx: 560, cy: 260, shape: 'circle', r: 18  },
    { id: 'food-w1',     label: '🍔 W1',             cx: 140, cy: 260, shape: 'circle', r: 18  },
    // Restrooms
    { id: 'rest-n1',     label: '🚻 N1',             cx: 240, cy: 90,  shape: 'circle', r: 12  },
    { id: 'rest-n2',     label: '🚻 N2',             cx: 460, cy: 90,  shape: 'circle', r: 12  },
    { id: 'rest-s1',     label: '🚻 S1',             cx: 240, cy: 430, shape: 'circle', r: 12  },
    { id: 'rest-w1',     label: '🚻 W1',             cx: 110, cy: 310, shape: 'circle', r: 12  },
    // First Aid
    { id: 'aid-north',   label: '➕',                cx: 350, cy: 145, shape: 'circle', r: 12  },
    { id: 'aid-south',   label: '➕',                cx: 350, cy: 375, shape: 'circle', r: 12  },
  ],
  tennis: [
    // Tennis layout
    { id: 'north-stand', label: 'North\nStand',     cx: 350, cy: 85,  shape: 'rect',   x: 230, y: 50,  w: 240, h: 70,  rx: 8  },
    { id: 'south-stand', label: 'South\nStand',     cx: 350, cy: 435, shape: 'rect',   x: 230, y: 400, w: 240, h: 70,  rx: 8  },
    { id: 'west-stand',  label: 'West\nStand',      cx: 150, cy: 260, shape: 'rect',   x: 100, y: 140, w: 100, h: 240, rx: 8  },
    { id: 'east-stand',  label: 'East\nStand',      cx: 550, cy: 260, shape: 'rect',   x: 500, y: 140, w: 100, h: 240, rx: 8  },
    // Missing corners for tennis, we'll assign them dummy off-screen spots or very small
    { id: 'nw-corner',   label: 'NW',               cx: -100, cy: -100, shape: 'circle', r: 0 },
    { id: 'ne-corner',   label: 'NE',               cx: -100, cy: -100, shape: 'circle', r: 0 },
    { id: 'sw-corner',   label: 'SW',               cx: -100, cy: -100, shape: 'circle', r: 0 },
    { id: 'se-corner',   label: 'SE',               cx: -100, cy: -100, shape: 'circle', r: 0 },
    // Gates
    { id: 'gate-a',      label: 'Gate A',            cx: 350, cy: 16,  shape: 'rect',   x: 295, y: 4,   w: 110, h: 22,  rx: 4  },
    { id: 'gate-b',      label: 'Gate B',            cx: 350, cy: 504, shape: 'rect',   x: 295, y: 494, w: 110, h: 22,  rx: 4  },
    { id: 'gate-c',      label: 'Gate C',            cx: 684, cy: 260, shape: 'rect',   x: 674, y: 220, w: 22,  h: 80,  rx: 4  },
    { id: 'gate-d',      label: 'Gate D',            cx: 16,  cy: 260, shape: 'rect',   x: 4,   y: 220, w: 22,  h: 80,  rx: 4  },
    // Concessions
    { id: 'food-n1',     label: '🍔',               cx: 200, cy: 60,  shape: 'circle', r: 18  },
    { id: 'food-n2',     label: '🍔',               cx: 500, cy: 60,  shape: 'circle', r: 18  },
    { id: 'food-s1',     label: '🍔',               cx: 200, cy: 460, shape: 'circle', r: 18  },
    { id: 'food-s2',     label: '🍔',               cx: 500, cy: 460, shape: 'circle', r: 18  },
    { id: 'food-e1',     label: '🍔',               cx: 640, cy: 180, shape: 'circle', r: 18  },
    { id: 'food-w1',     label: '🍔',               cx: 60,  cy: 180, shape: 'circle', r: 18  },
    // Restrooms
    { id: 'rest-n1',     label: '🚻',               cx: 260, cy: 30,  shape: 'circle', r: 12  },
    { id: 'rest-n2',     label: '🚻',               cx: 440, cy: 30,  shape: 'circle', r: 12  },
    { id: 'rest-s1',     label: '🚻',               cx: 260, cy: 490, shape: 'circle', r: 12  },
    { id: 'rest-w1',     label: '🚻',               cx: 60,  cy: 280, shape: 'circle', r: 12  },
    // First Aid
    { id: 'aid-north',   label: '➕',                cx: 100, cy: 60,  shape: 'circle', r: 12  },
    { id: 'aid-south',   label: '➕',                cx: 600, cy: 460, shape: 'circle', r: 12  },
  ]
};

// Map badminton to tennis layout for now
VENUE_PRESETS.badminton = VENUE_PRESETS.tennis;

ZONE_GEOMETRY = VENUE_PRESETS[CURRENT_SPORT];

/** Zone type → visibility class (for filter chips) */
const TYPE_TO_FILTER = {
  stand:      'all',
  gate:       'gate',
  concession: 'concession',
  restroom:   'restroom',
  firstaid:   'firstaid',
  exit:       'gate',
};

// ---------------------------------------------------------------------------
// VenueMap class
// ---------------------------------------------------------------------------

/**
 * Renders and manages the interactive SVG venue map.
 *
 * @example
 * const map = new VenueMap(document.getElementById('venue-map-container'));
 * map.init();
 * map.updateZoneData(zones, densityResults);
 */
export class VenueMap {
  /**
   * @param {HTMLElement} container - Container element for the SVG
   * @param {Object} [options]
   * @param {Function} [options.onZoneClick] - Called with (zoneId) on zone click
   */
  constructor(container, { onZoneClick } = {}) {
    this._container   = container;
    this._onZoneClick = onZoneClick ?? (() => {});
    this._svg         = null;
    this._zoneEls     = new Map(); // zoneId → SVGElement
    this._activeFilter = 'all';
    this._activeZone   = null;

    /** @type {{ [zoneId]: import('./crowd.js').DensityResult }} */
    this._densityCache = {};
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /** Renders the base SVG and wire up interaction. */
  init() {
    const svg = this._buildSVG();
    this._container.innerHTML = '';
    this._container.appendChild(svg);
    this._svg = svg;
    this._wireEvents();
  }

  setVenueLayout(sport) {
    if (VENUE_PRESETS[sport]) {
      CURRENT_SPORT = sport;
      ZONE_GEOMETRY = VENUE_PRESETS[sport];
      this.init();
      // Re-apply density cache if exists
      if (Object.keys(this._densityCache).length > 0) {
        // Find dummy zones for re-applying color (since zone objects didn't change identity context externally)
        for(let z of ZONE_GEOMETRY) {
           let density = this._densityCache[z.id];
           if(density) {
             const el = this._zoneEls.get(z.id);
             if (el) {
                el.style.setProperty('--zone-fill', density.hex);
                el.setAttribute('aria-label', density.ariaLabel ?? `${z.id}: ${density.score}% full`);
                el.dataset.level = density.level;
                el.dataset.score = density.score;
             }
           }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Data updates
  // -------------------------------------------------------------------------

  /**
   * Updates zone fill colors based on new density results.
   * Called every 5 seconds from the real-time data listener.
   *
   * @param {import('./crowd.js').ZoneData[]} zones
   * @param {{ [zoneId]: import('./crowd.js').DensityResult }} densityMap
   */
  updateZoneData(zones, densityMap) {
    this._densityCache = densityMap;
    for (const zone of zones) {
      const density = densityMap[zone.id];
      if (!density) continue;
      const el = this._zoneEls.get(zone.id);
      if (!el) continue;

      const targetColor = density.hex;

      // Smooth color transition via CSS custom property
      el.style.setProperty('--zone-fill', targetColor);
      el.setAttribute('aria-label', density.ariaLabel ?? `${zone.name}: ${density.score}% full`);
      el.dataset.level = density.level;
      el.dataset.score = density.score;
    }
  }

  /**
   * Sets the active map filter, showing/hiding point-of-interest types.
   * @param {'all'|'concession'|'restroom'|'gate'|'firstaid'} filter
   */
  setFilter(filter) {
    this._activeFilter = filter;
    for (const [id, el] of this._zoneEls) {
      const geo    = ZONE_GEOMETRY.find((g) => g.id === id);
      const zoneFilter = this._getZoneFilter(id);
      const visible = filter === 'all' || zoneFilter === filter;
      el.setAttribute('aria-hidden', String(!visible));
      el.style.opacity = visible ? '1' : '0.15';
      el.style.pointerEvents = visible ? 'auto' : 'none';
    }
  }

  /**
   * Highlights a specific zone (e.g. after searching or tapping "Go to Seat").
   * @param {string} zoneId
   */
  highlightZone(zoneId) {
    // Clear previous highlight
    if (this._activeZone) {
      this._zoneEls.get(this._activeZone)?.classList.remove('zone--active');
    }
    this._activeZone = zoneId;
    const el = this._zoneEls.get(zoneId);
    if (el) {
      el.classList.add('zone--active');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Draws a route overlay on the SVG (simplified polyline for demo).
   * In production, use Google Maps Directions API response to draw actual paths.
   *
   * @param {string} fromZoneId
   * @param {string} toZoneId
   */
  drawRoute(fromZoneId, toZoneId) {
    this._clearRoute();
    const from = ZONE_GEOMETRY.find((g) => g.id === fromZoneId);
    const to   = ZONE_GEOMETRY.find((g) => g.id === toZoneId);
    if (!from || !to) return;

    const fromX = from.cx, fromY = from.cy;
    const toX   = to.cx,   toY   = to.cy;

    // Simple L-shaped route (replace with actual Directions API path in prod)
    const routeLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    routeLine.setAttribute('points', `${fromX},${fromY} ${fromX},${toY} ${toX},${toY}`);
    routeLine.setAttribute('class', 'route-line');
    routeLine.setAttribute('stroke', '#3b82f6');
    routeLine.setAttribute('stroke-width', '4');
    routeLine.setAttribute('fill', 'none');
    routeLine.setAttribute('stroke-dasharray', '10 6');
    routeLine.setAttribute('stroke-linecap', 'round');
    routeLine.id = 'svg-route-line';

    // Start/end markers
    [{ x: fromX, y: fromY, cls: 'route-start' }, { x: toX, y: toY, cls: 'route-end' }].forEach(({ x, y, cls }) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r',  '8');
      dot.setAttribute('class', `route-dot ${cls}`);
      dot.id = `svg-${cls}`;
      this._svg.appendChild(dot);
    });

    this._svg.appendChild(routeLine);
  }

  /** Clears any route overlay from the SVG. */
  _clearRoute() {
    ['svg-route-line', 'svg-route-start', 'svg-route-end'].forEach((id) => {
      document.getElementById(id)?.remove();
    });
  }

  // -------------------------------------------------------------------------
  // SVG construction
  // -------------------------------------------------------------------------

  /** @private @returns {SVGElement} */
  _buildSVG() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 700 520');
    svg.setAttribute('role',    'img');
    svg.setAttribute('aria-label', 'Interactive stadium venue map showing crowd density by zone');
    svg.setAttribute('class', 'venue-svg');
    svg.setAttribute('focusable', 'false');

    // Background
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('width', '700');
    bg.setAttribute('height', '520');
    bg.setAttribute('fill', '#0d1424');
    bg.setAttribute('rx', '16');
    svg.appendChild(bg);

    // Field (center)
    if (CURRENT_SPORT === 'cricket') {
      const field = document.createElementNS(NS, 'circle');
      field.setAttribute('cx', '350');
      field.setAttribute('cy', '260');
      field.setAttribute('r', '135');
      field.setAttribute('fill', '#166534');
      field.setAttribute('stroke', '#15803d');
      field.setAttribute('stroke-width', '2');
      svg.appendChild(field);
    } else if (CURRENT_SPORT === 'tennis' || CURRENT_SPORT === 'badminton') {
      const field = document.createElementNS(NS, 'rect');
      field.setAttribute('x', '220');
      field.setAttribute('y', '150');
      field.setAttribute('width', '260');
      field.setAttribute('height', '220');
      field.setAttribute('rx', '8');
      field.setAttribute('fill', '#1e3a8a');
      field.setAttribute('stroke', '#1d4ed8');
      field.setAttribute('stroke-width', '2');
      svg.appendChild(field);
    } else {
      const field = document.createElementNS(NS, 'rect');
      field.setAttribute('x', '160');
      field.setAttribute('y', '130');
      field.setAttribute('width', '380');
      field.setAttribute('height', '260');
      field.setAttribute('rx', '20');
      field.setAttribute('fill', '#166534');
      field.setAttribute('stroke', '#15803d');
      field.setAttribute('stroke-width', '2');
      svg.appendChild(field);
    }

    // Field markings (center circle + lines)
    this._addFieldMarkings(svg, NS);

    // Render all zones
    for (const geo of ZONE_GEOMETRY) {
      const el = this._buildZoneEl(NS, geo);
      this._zoneEls.set(geo.id, el);
      svg.appendChild(el);

      // Label
      const label = this._buildZoneLabel(NS, geo);
      if (label) svg.appendChild(label);
    }

    return svg;
  }

  /** @private */
  _addFieldMarkings(svg, NS) {
    if (CURRENT_SPORT === 'football') {
      const centerLine = document.createElementNS(NS, 'line');
      centerLine.setAttribute('x1', '350'); centerLine.setAttribute('y1', '130');
      centerLine.setAttribute('x2', '350'); centerLine.setAttribute('y2', '390');
      centerLine.setAttribute('stroke', 'rgba(255,255,255,0.25)');
      centerLine.setAttribute('stroke-width', '1.5');
      svg.appendChild(centerLine);

      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', '350');
      circle.setAttribute('cy', '260');
      circle.setAttribute('r', '45');
      circle.setAttribute('stroke', 'rgba(255,255,255,0.25)');
      circle.setAttribute('stroke-width', '1.5');
      circle.setAttribute('fill', 'none');
      svg.appendChild(circle);

      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('x', '350');
      txt.setAttribute('y', '264');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', 'rgba(255,255,255,0.2)');
      txt.setAttribute('font-size', '14');
      txt.setAttribute('font-family', 'Inter, sans-serif');
      txt.setAttribute('aria-hidden', 'true');
      txt.textContent = '⚽ PITCH';
      svg.appendChild(txt);
    } else if (CURRENT_SPORT === 'cricket') {
      const pitch = document.createElementNS(NS, 'rect');
      pitch.setAttribute('x', '335'); pitch.setAttribute('y', '220');
      pitch.setAttribute('width', '30'); pitch.setAttribute('height', '80');
      pitch.setAttribute('fill', '#d4d4d8');
      svg.appendChild(pitch);

      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('x', '350');
      txt.setAttribute('y', '264');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', 'rgba(0,0,0,0.5)');
      txt.setAttribute('font-size', '12');
      txt.setAttribute('font-family', 'Inter, sans-serif');
      txt.setAttribute('aria-hidden', 'true');
      txt.textContent = '🏏 PITCH';
      svg.appendChild(txt);
    } else if (CURRENT_SPORT === 'tennis' || CURRENT_SPORT === 'badminton') {
      const net = document.createElementNS(NS, 'line');
      net.setAttribute('x1', '220'); net.setAttribute('y1', '260');
      net.setAttribute('x2', '480'); net.setAttribute('y2', '260');
      net.setAttribute('stroke', 'rgba(255,255,255,0.8)');
      net.setAttribute('stroke-width', '2');
      svg.appendChild(net);

      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('x', '350');
      txt.setAttribute('y', '240');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', 'rgba(255,255,255,0.4)');
      txt.setAttribute('font-size', '14');
      txt.setAttribute('font-family', 'Inter, sans-serif');
      txt.setAttribute('aria-hidden', 'true');
      txt.textContent = CURRENT_SPORT === 'tennis' ? '🎾 COURT' : '🏸 COURT';
      svg.appendChild(txt);
    }
  }

  /** @private */
  _buildZoneEl(NS, geo) {
    let el;
    if (geo.shape === 'rect') {
      el = document.createElementNS(NS, 'rect');
      el.setAttribute('x',  geo.x);
      el.setAttribute('y',  geo.y);
      el.setAttribute('width',  geo.w);
      el.setAttribute('height', geo.h);
      el.setAttribute('rx', geo.rx ?? 4);
    } else {
      el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', geo.cx);
      el.setAttribute('cy', geo.cy);
      el.setAttribute('r',  geo.r);
    }

    el.setAttribute('class', 'venue-zone');
    el.setAttribute('data-zone-id', geo.id);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', geo.label.replace(/\n/g, ' '));
    el.style.setProperty('--zone-fill', '#1e3a5f'); // default color until data arrives

    return el;
  }

  /** @private */
  _buildZoneLabel(NS, geo) {
    if (geo.shape === 'circle' && geo.r <= 12) return null; // too small for label

    const lines = geo.label.split('\n');
    if (!lines[0].match(/[a-zA-Z]/)) return null;

    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', geo.cx);
    text.setAttribute('y', geo.cy + (lines.length > 1 ? -7 : 4));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'rgba(255,255,255,0.9)');
    text.setAttribute('font-size', geo.shape === 'rect' && geo.w > 200 ? '13' : '10');
    text.setAttribute('font-family', 'Inter, sans-serif');
    text.setAttribute('font-weight', '600');
    text.setAttribute('pointer-events', 'none');
    text.setAttribute('aria-hidden', 'true');

    for (const [i, line] of lines.entries()) {
      const tspan = document.createElementNS(NS, 'tspan');
      tspan.setAttribute('x', geo.cx);
      tspan.setAttribute('dy', i === 0 ? '0' : '14');
      tspan.textContent = line;
      text.appendChild(tspan);
    }

    return text;
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  /** @private */
  _wireEvents() {
    const handleActivate = throttle((e) => {
      const el = e.target.closest('[data-zone-id]');
      if (!el) return;
      const id = el.dataset.zoneId;
      this.highlightZone(id);
      this._onZoneClick(id, this._densityCache[id]);
    }, 100);

    this._svg.addEventListener('click',   handleActivate);
    this._svg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate(e);
      }
    });
  }

  /** @private */
  _getZoneFilter(zoneId) {
    // Infer type from ID pattern
    if (zoneId.startsWith('food-'))  return 'concession';
    if (zoneId.startsWith('rest-'))  return 'restroom';
    if (zoneId.startsWith('gate-'))  return 'gate';
    if (zoneId.startsWith('aid-'))   return 'firstaid';
    return 'all';
  }
}

// ---------------------------------------------------------------------------
// Google Maps Directions API helper
// ---------------------------------------------------------------------------

/**
 * Constructs a Google Maps Directions URL for in-venue + parking navigation.
 * Used when user taps "Open in Google Maps".
 *
 * @param {string} origin      - Human-readable origin (e.g. "Section 112")
 * @param {string} destination - Human-readable destination
 * @param {boolean} accessible - If true, requests wheelchair-accessible route
 * @returns {string} Google Maps URL
 */
export function buildGoogleMapsUrl(origin, destination, accessible = false) {
  const params = new URLSearchParams({
    api: '1',
    origin:      origin,
    destination: destination,
    travelmode:  'walking',
  });
  if (accessible) params.set('avoid', 'stairs');
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Destination presets for the navigation view.
 * In production, these would be geocoded venue POI coordinates.
 */
export const NAVIGATION_DESTINATIONS = [
  { id: 'gate-a',   label: 'Gate A (North)',          hint: 'Main entrance' },
  { id: 'gate-b',   label: 'Gate B (South)',          hint: 'South entrance' },
  { id: 'gate-c',   label: 'Gate C (East)',           hint: 'East entrance' },
  { id: 'gate-d',   label: 'Gate D (West)',           hint: 'Accessible entrance' },
  { id: 'food-n1',  label: 'Concession N1',           hint: 'Hot dogs & beer' },
  { id: 'food-s1',  label: 'Concession S1',           hint: 'Pizza & snacks' },
  { id: 'rest-n1',  label: 'Restroom N1',             hint: 'North side' },
  { id: 'rest-s1',  label: 'Restroom S1',             hint: 'South side' },
  { id: 'aid-north',label: 'First Aid (North)',       hint: 'Medical services' },
  { id: 'aid-south',label: 'First Aid (South)',       hint: 'Medical services' },
  { id: 'my-seat',  label: 'My Seat (Section 112)',   hint: 'Row 15, Seat 7' },
];

/**
 * Generates turn-by-turn route steps (simplified simulation).
 * Production: call Google Maps Directions API:
 *   fetch(`https://maps.googleapis.com/maps/api/directions/json?...&key=API_KEY`)
 *
 * @param {string} fromId
 * @param {string} toId
 * @param {boolean} [accessible=false]
 * @returns {{ steps: string[], estimatedMinutes: number, distanceM: number }}
 */
export function computeRoute(fromId, toId, accessible = false) {
  const from = ZONE_GEOMETRY.find((g) => g.id === fromId);
  const to   = ZONE_GEOMETRY.find((g) => g.id === toId);

  if (!from || !to) {
    return { steps: ['Destination not found'], estimatedMinutes: 0, distanceM: 0 };
  }

  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const distancePx = Math.sqrt(dx * dx + dy * dy);

  // Approx: 1 SVG unit ≈ 0.5 m in real stadium; walking speed 1.2 m/s
  const distanceM = Math.round(distancePx * 0.5);
  const estimatedMinutes = Math.max(1, Math.round((distanceM / 1.2) / 60));

  const direction = (angle) => {
    const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    return dirs[Math.round(((angle % 360) + 360) % 360 / 45) % 8];
  };
  const angle = Math.atan2(-dy, dx) * (180 / Math.PI);

  const steps = [
    accessible ? '♿ Take the elevator to the concourse level' : '📍 Head toward the main concourse',
    `🚶 Walk ${direction(angle)} for approximately ${distanceM}m`,
    accessible ? '♿ Use the accessible ramp to your destination' : `🎯 Arrive at ${NAVIGATION_DESTINATIONS.find((d) => d.id === toId)?.label ?? toId}`,
  ];

  return { steps, estimatedMinutes, distanceM };
}
