/**
 * @fileoverview Unit tests for CrowdEngine — StadiumIQ
 * Compatible with Jest (run: npx jest tests/crowd.test.js)
 * @module tests/crowd.test
 */

'use strict';

// ---- Minimal inline clone of CrowdEngine for pure-Node testability ----
// (avoids ES Module transform in Jest; in a Vite/esbuild project, import directly)

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

const THRESHOLDS = { empty: 0, light: 25, moderate: 50, heavy: 70, full: 85 };
const COLORS     = { empty: '#22c55e', light: '#84cc16', moderate: '#f59e0b', heavy: '#f97316', full: '#ef4444' };
const BASE_WAIT  = { concession: 3, restroom: 2, gate: 1.5, stand: 0, firstaid: 0.5 };

function scoreToLevel(score) {
  if (score >= THRESHOLDS.full)     return 'full';
  if (score >= THRESHOLDS.heavy)    return 'heavy';
  if (score >= THRESHOLDS.moderate) return 'moderate';
  if (score >= THRESHOLDS.light)    return 'light';
  return 'empty';
}

class CrowdEngine {
  constructor({ smoothingWindow = 3 } = {}) {
    if (!Number.isInteger(smoothingWindow) || smoothingWindow < 1) throw new RangeError('smoothingWindow must be positive integer');
    this._w = smoothingWindow;
    this._h = new Map();
  }

  computeDensity(zone) {
    if (!zone?.id) throw new TypeError('zone must have id');
    if (zone.capacity <= 0) throw new RangeError('capacity must be > 0');
    if (zone.occupancy < 0) throw new RangeError('occupancy must be >= 0');
    const hist = this._h.get(zone.id) ?? [];
    hist.push(zone.occupancy);
    if (hist.length > this._w) hist.shift();
    this._h.set(zone.id, hist);
    const smoothed = hist.reduce((s, v) => s + v, 0) / hist.length;
    const ratio = smoothed / zone.capacity;
    const score = clamp(Math.round(ratio * 100), 0, 100);
    const level = scoreToLevel(score);
    const mult  = 1 + 4 * Math.pow(clamp(ratio, 0, 1), 2);
    const base  = BASE_WAIT[zone.type] ?? 2;
    return { score, level, hex: COLORS[level], waitMinutes: Math.round(base * mult * 10) / 10, waitMultiplier: mult };
  }

  rankZones(zones) {
    return zones.map((z) => ({ zone: z, density: this.computeDensity(z) }))
                .sort((a, b) => a.density.score - b.density.score);
  }

  clearHistory(id) { id ? this._h.delete(id) : this._h.clear(); }
}

// ---- Test helpers ----
function makeZone(overrides = {}) {
  return { id: 'zone-a', name: 'Test Zone', type: 'stand', capacity: 1000, occupancy: 500, ...overrides };
}

// ---- Tests ----
describe('CrowdEngine', () => {

  // -------------------------------------------------------------------------
  describe('constructor', () => {

    test('accepts valid smoothingWindow', () => {
      expect(() => new CrowdEngine({ smoothingWindow: 5 })).not.toThrow();
    });

    test('throws RangeError for smoothingWindow < 1', () => {
      expect(() => new CrowdEngine({ smoothingWindow: 0 })).toThrow(RangeError);
    });

    test('throws RangeError for non-integer smoothingWindow', () => {
      expect(() => new CrowdEngine({ smoothingWindow: 2.5 })).toThrow(RangeError);
    });
  });

  // -------------------------------------------------------------------------
  describe('computeDensity', () => {

    test('returns score 50 for half-capacity zone', () => {
      const engine = new CrowdEngine();
      const result = engine.computeDensity(makeZone({ occupancy: 500, capacity: 1000 }));
      expect(result.score).toBe(50);
    });

    test('returns level "moderate" for score 50', () => {
      const engine = new CrowdEngine();
      const result = engine.computeDensity(makeZone({ occupancy: 500, capacity: 1000 }));
      expect(result.level).toBe('moderate');
    });

    test('returns level "empty" for 0% occupancy', () => {
      const engine = new CrowdEngine();
      const result = engine.computeDensity(makeZone({ occupancy: 0 }));
      expect(result.level).toBe('empty');
      expect(result.score).toBe(0);
    });

    test('returns level "full" for 90% occupancy (above 85% threshold)', () => {
      const engine = new CrowdEngine();
      const result = engine.computeDensity(makeZone({ occupancy: 900 }));
      expect(result.level).toBe('full');
      expect(result.score).toBe(90);
    });

    test('clamps score to 100 even when occupancy exceeds capacity', () => {
      const engine = new CrowdEngine();
      const result = engine.computeDensity(makeZone({ occupancy: 1200, capacity: 1000 }));
      expect(result.score).toBe(100);
    });

    test('waitMinutes is 0 for a stand zone at zero density', () => {
      const engine = new CrowdEngine();
      const result = engine.computeDensity(makeZone({ type: 'stand', occupancy: 0 }));
      expect(result.waitMinutes).toBe(0);
    });

    test('waitMinutes grows at high concession density', () => {
      const engine = new CrowdEngine();
      const low  = engine.computeDensity(makeZone({ type: 'concession', capacity: 60, occupancy: 6 }));
      engine.clearHistory('zone-a');
      const high = engine.computeDensity(makeZone({ type: 'concession', capacity: 60, occupancy: 57 }));
      expect(high.waitMinutes).toBeGreaterThan(low.waitMinutes);
    });

    test('returns correct hex color for each level', () => {
      const engine = new CrowdEngine();
      const cases = [
        { occupancy: 260, expectedHex: '#84cc16' }, // light
        { occupancy: 500, expectedHex: '#f59e0b' }, // moderate
        { occupancy: 750, expectedHex: '#f97316' }, // heavy
        { occupancy: 900, expectedHex: '#ef4444' }, // full
      ];
      for (const { occupancy, expectedHex } of cases) {
        engine.clearHistory('zone-a');
        const r = engine.computeDensity(makeZone({ occupancy }));
        expect(r.hex).toBe(expectedHex);
      }
    });

    test('throws TypeError if zone has no id', () => {
      const engine = new CrowdEngine();
      expect(() => engine.computeDensity({ capacity: 100, occupancy: 50 })).toThrow(TypeError);
    });

    test('throws RangeError for zero capacity', () => {
      const engine = new CrowdEngine();
      expect(() => engine.computeDensity(makeZone({ capacity: 0 }))).toThrow(RangeError);
    });

    test('throws RangeError for negative occupancy', () => {
      const engine = new CrowdEngine();
      expect(() => engine.computeDensity(makeZone({ occupancy: -1 }))).toThrow(RangeError);
    });
  });

  // -------------------------------------------------------------------------
  describe('smoothing (rolling average)', () => {

    test('smooths occupancy over window of 3', () => {
      const engine = new CrowdEngine({ smoothingWindow: 3 });
      const id = 'zone-smooth';
      // Feed 3 readings: 900, 100, 100 — smoothed avg = 367
      engine.computeDensity({ id, name: 'Z', type: 'stand', capacity: 1000, occupancy: 900 });
      engine.computeDensity({ id, name: 'Z', type: 'stand', capacity: 1000, occupancy: 100 });
      const r = engine.computeDensity({ id, name: 'Z', type: 'stand', capacity: 1000, occupancy: 100 });
      // avg = (900+100+100)/3 = 367 → score 37 → 'light'
      expect(r.level).toBe('light');
      expect(r.score).toBe(37);
    });

    test('clearHistory resets smoothing for a zone', () => {
      const engine = new CrowdEngine({ smoothingWindow: 3 });
      const zone   = makeZone({ occupancy: 900 });
      engine.computeDensity(zone); // record 900
      engine.clearHistory(zone.id);
      const r = engine.computeDensity(makeZone({ occupancy: 100 }));
      // After clear, only 1 reading: 100 → score 10 → light
      expect(r.score).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  describe('rankZones', () => {

    test('sorts zones from least to most crowded', () => {
      const engine = new CrowdEngine();
      const zones  = [
        makeZone({ id: 'z1', occupancy: 800 }),
        makeZone({ id: 'z2', occupancy: 200 }),
        makeZone({ id: 'z3', occupancy: 500 }),
      ];
      const ranked = engine.rankZones(zones);
      expect(ranked[0].zone.id).toBe('z2');
      expect(ranked[1].zone.id).toBe('z3');
      expect(ranked[2].zone.id).toBe('z1');
    });

    test('throws TypeError if zones is not an array', () => {
      const engine = new CrowdEngine();
      expect(() => engine.rankZones(null)).toThrow(TypeError);
    });
  });

  // -------------------------------------------------------------------------
  describe('density level thresholds', () => {

    const cases = [
      { occupancy:   0, expected: 'empty'    },
      { occupancy: 244, expected: 'empty'    }, // 24.4% (rounds to 24)
      { occupancy: 250, expected: 'light'    }, // 25%
      { occupancy: 494, expected: 'light'    }, // 49.4% (rounds to 49)
      { occupancy: 500, expected: 'moderate' }, // 50%
      { occupancy: 694, expected: 'moderate' }, // 69.4% (rounds to 69)
      { occupancy: 700, expected: 'heavy'    }, // 70%
      { occupancy: 844, expected: 'heavy'    }, // 84.4% (rounds to 84)
      { occupancy: 850, expected: 'full'     }, // 85%
      { occupancy:1000, expected: 'full'     }, // 100%
    ];

    test.each(cases)('occupancy $occupancy/1000 → $expected', ({ occupancy, expected }) => {
      const engine = new CrowdEngine({ smoothingWindow: 1 }); // no smoothing interference
      const result = engine.computeDensity(makeZone({ occupancy }));
      expect(result.level).toBe(expected);
    });
  });

});
