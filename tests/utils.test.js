import { jest } from '@jest/globals';
import { 
  sanitize, clamp, debounce, throttle, formatDuration, formatWait, 
  formatNumber, formatCurrency, lerp, isValidZoneId, isValidOccupancy, 
  percentage, generateId, gaussianJitter 
} from '../js/utils.js';

// ---- Tests ----

describe('sanitize()', () => {

  test('returns empty string for non-string input', () => {
    expect(sanitize(null)).toBe('');
    expect(sanitize(42)).toBe('');
    expect(sanitize({})).toBe('');
  });

  test('escapes < and >', () => {
    expect(sanitize('<script>')).toBe('&lt;script&gt;');
  });

  test('escapes &', () => {
    expect(sanitize('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('escapes double quotes', () => {
    expect(sanitize('say "hello"')).toBe('say &quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(sanitize("it's")).toBe('it&#x27;s');
  });

  test('escapes forward slash', () => {
    expect(sanitize('path/to/file')).toBe('path&#x2F;to&#x2F;file');
  });

  test('escapes backtick and equals sign', () => {
    expect(sanitize('`a=b`')).toBe('&#x60;a&#x3D;b&#x60;');
  });

  test('does not modify safe plain text', () => {
    expect(sanitize('Hello World!')).toBe('Hello World!');
  });

  test('prevents XSS injection pattern', () => {
    const xss = '<img src=x onerror=alert(1)>';
    const out = sanitize(xss);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });
});

// ---------------------------------------------------------------------------
describe('clamp()', () => {
  test('returns value within bounds unchanged', () => expect(clamp(5, 0, 10)).toBe(5));
  test('clamps to min when below min',           () => expect(clamp(-5, 0, 10)).toBe(0));
  test('clamps to max when above max',           () => expect(clamp(15, 0, 10)).toBe(10));
  test('handles equal min and max',              () => expect(clamp(7, 5, 5)).toBe(5));
  test('returns min === max when val is outside',() => expect(clamp(-1, 5, 5)).toBe(5));
});

// ---------------------------------------------------------------------------
describe('formatDuration()', () => {
  test('formats seconds',    () => expect(formatDuration(30_000)).toBe('30s'));
  test('formats minutes',    () => expect(formatDuration(300_000)).toBe('5 min'));
  test('formats hours',      () => expect(formatDuration(3_600_000)).toBe('1h'));
  test('formats h + min',    () => expect(formatDuration(5_400_000)).toBe('1h 30m'));
  test('rounds to nearest',  () => expect(formatDuration(90_000)).toBe('2 min'));
});

// ---------------------------------------------------------------------------
describe('formatWait()', () => {
  test('returns "< 1 min" for 0.5',  () => expect(formatWait(0.5)).toBe('< 1 min'));
  test('returns "3 min" for 3',      () => expect(formatWait(3)).toBe('3 min'));
  test('handles 60 minutes edge',    () => { const r = formatWait(60); expect(r).toContain('h'); });
});

// ---------------------------------------------------------------------------
describe('formatNumber()', () => {
  test('formats thousands', () => expect(formatNumber(41240)).toBe('41,240'));
  test('formats zero',      () => expect(formatNumber(0)).toBe('0'));
  test('rounds float',      () => expect(formatNumber(1234.7)).toBe('1,235'));
});

// ---------------------------------------------------------------------------
describe('formatCurrency()', () => {
  test('formats INR', () => {
    const val = formatCurrency(12.99);
    expect(val).toContain('12.99'); // generic check for INR formatting
  });
  test('formats whole rupee', () => {
    const val = formatCurrency(5);
    expect(val).toContain('5.00');
  });
});

// ---------------------------------------------------------------------------
describe('lerp()', () => {
  test('returns a at t=0',     () => expect(lerp(0, 100, 0)).toBe(0));
  test('returns b at t=1',     () => expect(lerp(0, 100, 1)).toBe(100));
  test('returns midpoint',     () => expect(lerp(0, 100, 0.5)).toBe(50));
  test('clamps t below 0',     () => expect(lerp(0, 100, -1)).toBe(0));
  test('clamps t above 1',     () => expect(lerp(0, 100, 2)).toBe(100));
});

// ---------------------------------------------------------------------------
describe('isValidZoneId()', () => {
  test('accepts alphanumeric',       () => expect(isValidZoneId('north-stand')).toBe(true));
  test('accepts underscore',         () => expect(isValidZoneId('gate_a')).toBe(true));
  test('rejects spaces',             () => expect(isValidZoneId('north stand')).toBe(false));
  test('rejects empty string',       () => expect(isValidZoneId('')).toBe(false));
  test('rejects >32 chars',          () => expect(isValidZoneId('a'.repeat(33))).toBe(false));
  test('rejects non-string',         () => expect(isValidZoneId(123)).toBe(false));
  test('rejects special chars',      () => expect(isValidZoneId('<script>')).toBe(false));
  test('accepts 1-char id',          () => expect(isValidZoneId('A')).toBe(true));
  test('accepts exactly 32 chars',   () => expect(isValidZoneId('a'.repeat(32))).toBe(true));
});

// ---------------------------------------------------------------------------
describe('isValidOccupancy()', () => {
  test('accepts valid occupancy',       () => expect(isValidOccupancy(500, 1000)).toBe(true));
  test('accepts zero occupancy',        () => expect(isValidOccupancy(0, 1000)).toBe(true));
  test('accepts at capacity',           () => expect(isValidOccupancy(1000, 1000)).toBe(true));
  test('accepts 5% buffer over cap',    () => expect(isValidOccupancy(1050, 1000)).toBe(true));
  test('rejects > 5% over capacity',    () => expect(isValidOccupancy(1060, 1000)).toBe(false));
  test('rejects negative occupancy',    () => expect(isValidOccupancy(-1, 1000)).toBe(false));
  test('rejects zero capacity',         () => expect(isValidOccupancy(0, 0)).toBe(false));
  test('rejects non-finite values',     () => expect(isValidOccupancy(Infinity, 1000)).toBe(false));
  test('rejects string values',         () => expect(isValidOccupancy('500', 1000)).toBe(false));
});

// ---------------------------------------------------------------------------
describe('percentage()', () => {
  test('computes 50%',   () => expect(percentage(500, 1000)).toBe(50));
  test('computes 33.3%', () => expect(percentage(1, 3)).toBe(33.3));
  test('handles 0 whole',() => expect(percentage(5, 0)).toBe(0));
});

// ---------------------------------------------------------------------------
describe('generateId()', () => {
  test('returns a string', () => expect(typeof generateId()).toBe('string'));
  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
  test('matches UUID v4 pattern', () => {
    const uuid = generateId();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

// ---------------------------------------------------------------------------
describe('gaussianJitter()', () => {
  test('stays within [0, cap]', () => {
    for (let i = 0; i < 200; i++) {
      const val = gaussianJitter(500, 100, 1000);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1000);
    }
  });

  test('returns integer', () => {
    const val = gaussianJitter(500, 50, 1000);
    expect(Number.isInteger(val)).toBe(true);
  });

  test('centers around mean over many samples (±20%)', () => {
    let sum = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) sum += gaussianJitter(500, 20, 1000);
    const avg = sum / N;
    expect(avg).toBeGreaterThan(400);
    expect(avg).toBeLessThan(600);
  });
});

// ---------------------------------------------------------------------------
describe('debounce()', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('delays function call', () => {
    const fn = jest.fn();
    const d  = debounce(fn, 300);
    d();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('resets timer on repeated calls', () => {
    const fn = jest.fn();
    const d  = debounce(fn, 300);
    d(); jest.advanceTimersByTime(200);
    d(); jest.advanceTimersByTime(200);
    d(); jest.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('cancel() prevents future call', () => {
    const fn = jest.fn();
    const d  = debounce(fn, 300);
    d();
    d.cancel();
    jest.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('throttle()', () => {
  test('calls function at most once per interval', () => {
    const fn  = jest.fn();
    const thr = throttle(fn, 100);
    jest.useFakeTimers();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    thr();
    thr();
    thr();
    expect(fn).toHaveBeenCalledTimes(1);
    jest.spyOn(Date, 'now').mockReturnValue(now + 150);
    thr();
    expect(fn).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
});
