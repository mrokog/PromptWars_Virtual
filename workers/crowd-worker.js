/**
 * @fileoverview Web Worker for offloading crowd density computations.
 * Receives zone data via postMessage and returns processed results
 * without blocking the main UI thread.
 *
 * Message protocol:
 *   IN  → { type: 'COMPUTE', payload: { zones: ZoneData[], smoothingWindow?: number } }
 *   IN  → { type: 'PROJECT', payload: { zones: ZoneData[], minutesAhead: number } }
 *   IN  → { type: 'AGGREGATE', payload: { zones: ZoneData[] } }
 *   OUT → { type: 'RESULT_COMPUTE',   payload: DensityMap, error?: string }
 *   OUT → { type: 'RESULT_PROJECT',   payload: DensityMap, error?: string }
 *   OUT → { type: 'RESULT_AGGREGATE', payload: AggregateStats, error?: string }
 *
 * @module crowd-worker
 */

'use strict';

// ---------------------------------------------------------------------------
// Inline minimal implementations (Web Workers cannot import ES modules
// unless the host page sets { type: 'module' } — we keep this self-contained
// for maximum browser compatibility).
// ---------------------------------------------------------------------------

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

const THRESHOLDS = { empty: 0, light: 25, moderate: 50, heavy: 70, full: 85 };
const COLORS     = { empty: '#22c55e', light: '#84cc16', moderate: '#f59e0b', heavy: '#f97316', full: '#ef4444' };
const BASE_WAIT  = { concession: 3, restroom: 2, gate: 1.5, exit: 1, firstaid: 0.5, stand: 0 };

function scoreToLevel(score) {
  if (score >= THRESHOLDS.full)     return 'full';
  if (score >= THRESHOLDS.heavy)    return 'heavy';
  if (score >= THRESHOLDS.moderate) return 'moderate';
  if (score >= THRESHOLDS.light)    return 'light';
  return 'empty';
}

function waitMultiplier(ratio) { return 1 + 4 * Math.pow(clamp(ratio, 0, 1), 2); }

/** Simple history store keyed by zone ID */
const _history = new Map();
let   _smoothingWindow = 3;

function recordAndSmooth(id, occupancy) {
  const h = _history.get(id) ?? [];
  h.push(occupancy);
  if (h.length > _smoothingWindow) h.shift();
  _history.set(id, h);
  return h.reduce((s, v) => s + v, 0) / h.length;
}

/**
 * Compute density for a single zone.
 * @param {Object} zone
 * @returns {Object} DensityResult
 */
function computeOne(zone) {
  const smoothed  = recordAndSmooth(zone.id, zone.occupancy);
  const ratio     = smoothed / zone.capacity;
  const score     = clamp(Math.round(ratio * 100), 0, 100);
  const level     = scoreToLevel(score);
  const mult      = waitMultiplier(ratio);
  const baseWait  = BASE_WAIT[zone.type] ?? 2;
  return {
    score,
    level,
    hex:          COLORS[level],
    waitMinutes:  Math.round(baseWait * mult * 10) / 10,
    waitMultiplier: mult,
  };
}

/**
 * Project density for a single zone `minutesAhead` into the future.
 * @param {Object} zone
 * @param {number} minutesAhead
 * @returns {Object} DensityResult
 */
function projectOne(zone, minutesAhead) {
  const history = _history.get(zone.id) ?? [zone.occupancy];
  let projected = zone.occupancy;
  if (history.length >= 2) {
    const trend = history[history.length - 1] - history[Math.max(0, history.length - 2)];
    const steps = (minutesAhead * 60) / 5;
    projected = clamp(zone.occupancy + trend * steps, 0, zone.capacity);
  }
  return computeOne({ ...zone, occupancy: Math.round(projected) });
}

/**
 * Aggregate statistics across all zones.
 * @param {Object[]} zones
 */
function aggregate(zones) {
  let sum = 0, max = 0, totalOcc = 0, totalCap = 0;
  for (const z of zones) {
    const d = computeOne(z);
    sum += d.score;
    if (d.score > max) max = d.score;
    totalOcc += z.occupancy;
    totalCap += z.capacity;
  }
  const count = zones.length;
  return {
    avgScore:       count ? Math.round((sum / count) * 10) / 10 : 0,
    maxScore:       max,
    totalOccupancy: totalOcc,
    totalCapacity:  totalCap,
    fillPercent:    totalCap ? Math.round((totalOcc / totalCap) * 1000) / 10 : 0,
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'COMPUTE': {
        if (payload.smoothingWindow) _smoothingWindow = payload.smoothingWindow;
        const densityMap = {};
        for (const zone of payload.zones) {
          densityMap[zone.id] = computeOne(zone);
        }
        self.postMessage({ type: 'RESULT_COMPUTE', payload: densityMap });
        break;
      }

      case 'PROJECT': {
        const minutesAhead = payload.minutesAhead ?? 10;
        const projectedMap = {};
        for (const zone of payload.zones) {
          projectedMap[zone.id] = projectOne(zone, minutesAhead);
        }
        self.postMessage({ type: 'RESULT_PROJECT', payload: projectedMap });
        break;
      }

      case 'AGGREGATE': {
        const stats = aggregate(payload.zones);
        self.postMessage({ type: 'RESULT_AGGREGATE', payload: stats });
        break;
      }

      case 'CLEAR_HISTORY': {
        _history.clear();
        self.postMessage({ type: 'HISTORY_CLEARED' });
        break;
      }

      default:
        self.postMessage({ type: 'ERROR', error: `Unknown message type: ${type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'ERROR', error: err.message, originalType: type });
  }
});
