/**
 * @fileoverview Crowd density engine for StadiumIQ.
 * Computes real-time density scores, wait times, and projected trends
 * for each venue zone. Designed to run on the main thread or in a Web Worker.
 * @module crowd
 * @version 1.0.0
 */

'use strict';

import { clamp, isValidZoneId, isValidOccupancy } from './utils.js';

// ---------------------------------------------------------------------------
// Type definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {'stand'|'concession'|'restroom'|'gate'|'firstaid'|'exit'} ZoneType
 */

/**
 * @typedef {'empty'|'light'|'moderate'|'heavy'|'full'} CrowdLevel
 */

/**
 * @typedef {Object} ZoneData
 * @property {string}    id           - Unique zone identifier
 * @property {string}    name         - Display name (e.g. "North Stand")
 * @property {ZoneType}  type         - Functional category
 * @property {number}    capacity     - Maximum safe occupancy
 * @property {number}    occupancy    - Current estimated occupancy
 * @property {boolean}   [accessible] - Whether zone is wheelchair-accessible
 */

/**
 * @typedef {Object} DensityResult
 * @property {number}      score           - Integer 0–100 representing fill %
 * @property {CrowdLevel}  level           - Human-readable severity
 * @property {string}      hex             - Hex color for this level
 * @property {number}      waitMinutes     - Estimated wait time in minutes
 * @property {number}      waitMultiplier  - Raw multiplier (1.0 = no wait)
 * @property {string}      recommendation  - User-facing guidance string
 * @property {string}      ariaLabel       - Accessible description
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Crowd level thresholds (fill %) */
export const DENSITY_THRESHOLDS = Object.freeze({
  empty:    0,
  light:    25,
  moderate: 50,
  heavy:    70,
  full:     85,
});

/** Crowd level colors — matches CSS custom properties */
export const DENSITY_COLORS = Object.freeze({
  empty:    '#22c55e',
  light:    '#84cc16',
  moderate: '#f59e0b',
  heavy:    '#f97316',
  full:     '#ef4444',
});

/** Base wait times in minutes per zone type (at zero crowd) */
export const BASE_WAIT_MINUTES = Object.freeze({
  concession: 3,
  restroom:   2,
  gate:       1.5,
  exit:       1,
  firstaid:   0.5,
  stand:      0,
});

/** User-facing recommendations per level */
const RECOMMENDATIONS = Object.freeze({
  empty:    'Clear — great time to move freely',
  light:    'Lightly occupied — easy access',
  moderate: 'Moderately busy — expect short waits',
  heavy:    'Very crowded — consider an alternate route',
  full:     'At capacity — please use an alternate location',
});

// ---------------------------------------------------------------------------
// CrowdEngine
// ---------------------------------------------------------------------------

/**
 * Stateful crowd density computation engine.
 * Maintains a rolling history per zone for smoothed readings.
 *
 * @example
 * const engine = new CrowdEngine({ smoothingWindow: 4 });
 * const result = engine.computeDensity(zone);
 * console.log(result.level); // "moderate"
 */
export class CrowdEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.smoothingWindow=3] - Number of past readings to average
   */
  constructor({ smoothingWindow = 3 } = {}) {
    if (!Number.isInteger(smoothingWindow) || smoothingWindow < 1) {
      throw new RangeError('smoothingWindow must be a positive integer');
    }
    this._smoothingWindow = smoothingWindow;
    /** @private @type {Map<string, number[]>} zoneId → occupancy history */
    this._history = new Map();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Computes the current density result for a zone.
   * Records the occupancy in the rolling history for smoothing.
   *
   * @param {ZoneData} zone
   * @returns {DensityResult}
   * @throws {Error} If zone data fails validation
   */
  computeDensity(zone) {
    this._validateZone(zone);

    const smoothedOccupancy = this._recordAndSmooth(zone.id, zone.occupancy);
    const rawRatio = smoothedOccupancy / zone.capacity;
    const score = clamp(Math.round(rawRatio * 100), 0, 100);
    const level = this._scoreToLevel(score);
    const waitMultiplier = this._waitMultiplier(rawRatio);
    const baseWait = BASE_WAIT_MINUTES[zone.type] ?? 2;
    const waitMinutes = Math.round(baseWait * waitMultiplier * 10) / 10;

    return {
      score,
      level,
      hex: DENSITY_COLORS[level],
      waitMinutes,
      waitMultiplier,
      recommendation: RECOMMENDATIONS[level],
      ariaLabel: `${zone.name}: ${score}% full, ${level} crowd. ${RECOMMENDATIONS[level]}.`,
    };
  }

  /**
   * Projects crowd density N minutes into the future using a linear trend
   * extrapolated from the zone's occupancy history.
   *
   * @param {ZoneData} zone
   * @param {number} minutesAhead - Projection horizon (1–60 minutes)
   * @returns {DensityResult} Projected density result
   */
  projectDensity(zone, minutesAhead) {
    this._validateZone(zone);
    const mins = clamp(minutesAhead, 1, 60);
    const history = this._history.get(zone.id) ?? [zone.occupancy];

    let projectedOccupancy = zone.occupancy;

    if (history.length >= 2) {
      // Linear trend from last two readings; each reading is ~5 s apart
      const recent = history[history.length - 1];
      const prev   = history[Math.max(0, history.length - 2)];
      const trendPerStep = recent - prev;
      const stepsAhead = (mins * 60) / 5;
      projectedOccupancy = clamp(
        zone.occupancy + trendPerStep * stepsAhead,
        0,
        zone.capacity,
      );
    }

    return this.computeDensity({ ...zone, occupancy: Math.round(projectedOccupancy) });
  }

  /**
   * Ranks an array of zones from least to most crowded.
   *
   * @param {ZoneData[]} zones
   * @returns {{ zone: ZoneData, density: DensityResult }[]} Ascending by score
   */
  rankZones(zones) {
    if (!Array.isArray(zones)) throw new TypeError('zones must be an array');
    return zones
      .map((zone) => ({ zone, density: this.computeDensity(zone) }))
      .sort((a, b) => a.density.score - b.density.score);
  }

  /**
   * Returns the recommended zone of a given type (least crowded, open, accessible
   * if `mobilityMode` is set).
   *
   * @param {ZoneData[]} zones - All known zones
   * @param {ZoneType}   targetType - Type to filter by
   * @param {Object}     [opts]
   * @param {boolean}    [opts.mobilityMode=false] - Prefer accessible zones
   * @returns {{ zone: ZoneData, density: DensityResult, reason: string }|null}
   */
  getRecommendation(zones, targetType, { mobilityMode = false } = {}) {
    let candidates = zones.filter((z) => z.type === targetType);
    if (mobilityMode) {
      const accessible = candidates.filter((z) => z.accessible);
      if (accessible.length) candidates = accessible;
    }
    if (!candidates.length) return null;

    const ranked = this.rankZones(candidates);
    const best = ranked[0];
    return {
      ...best,
      reason: `${best.zone.name} has the lowest crowd (${best.density.score}% full). ${best.density.recommendation}.`,
    };
  }

  /**
   * Computes aggregate statistics across all zones.
   * @param {ZoneData[]} zones
   * @returns {{ avgScore: number, maxScore: number, totalOccupancy: number, totalCapacity: number }}
   */
  aggregateStats(zones) {
    if (!zones.length) return { avgScore: 0, maxScore: 0, totalOccupancy: 0, totalCapacity: 0 };

    let sum = 0;
    let max = 0;
    let totalOccupancy = 0;
    let totalCapacity = 0;

    for (const zone of zones) {
      const d = this.computeDensity(zone);
      sum += d.score;
      if (d.score > max) max = d.score;
      totalOccupancy += zone.occupancy;
      totalCapacity += zone.capacity;
    }

    return {
      avgScore: Math.round((sum / zones.length) * 10) / 10,
      maxScore: max,
      totalOccupancy,
      totalCapacity,
    };
  }

  /**
   * Resets occupancy history for a specific zone or all zones.
   * @param {string} [zoneId] - If omitted, clears all history
   */
  clearHistory(zoneId) {
    if (zoneId) {
      this._history.delete(zoneId);
    } else {
      this._history.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** @private */
  _validateZone(zone) {
    if (!zone || typeof zone !== 'object') {
      throw new TypeError('zone must be a non-null object');
    }
    if (!isValidZoneId(zone.id)) {
      throw new Error(`Invalid zone ID: "${zone.id}"`);
    }
    if (!isValidOccupancy(zone.occupancy, zone.capacity)) {
      throw new RangeError(
        `Invalid occupancy ${zone.occupancy} for capacity ${zone.capacity} in zone "${zone.id}"`,
      );
    }
  }

  /**
   * Records a new occupancy reading into the rolling history,
   * trims to the window size, then returns the window average.
   * @private
   * @param {string} id
   * @param {number} occupancy
   * @returns {number} Smoothed occupancy
   */
  _recordAndSmooth(id, occupancy) {
    const history = this._history.get(id) ?? [];
    history.push(occupancy);
    if (history.length > this._smoothingWindow) history.shift();
    this._history.set(id, history);
    return history.reduce((s, v) => s + v, 0) / history.length;
  }

  /**
   * Maps a density score (0–100) to a CrowdLevel enum value.
   * @private
   * @param {number} score
   * @returns {CrowdLevel}
   */
  _scoreToLevel(score) {
    if (score >= DENSITY_THRESHOLDS.full)     return 'full';
    if (score >= DENSITY_THRESHOLDS.heavy)    return 'heavy';
    if (score >= DENSITY_THRESHOLDS.moderate) return 'moderate';
    if (score >= DENSITY_THRESHOLDS.light)    return 'light';
    return 'empty';
  }

  /**
   * Non-linear wait multiplier: grows quadratically at high density.
   * At density 0 → ×1.0; at density 1.0 → ×5.0.
   * @private
   * @param {number} ratio - 0.0–1.0
   * @returns {number}
   */
  _waitMultiplier(ratio) {
    return 1 + 4 * Math.pow(clamp(ratio, 0, 1), 2);
  }
}
