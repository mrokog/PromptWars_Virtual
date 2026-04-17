/**
 * @fileoverview Utility functions for StadiumIQ — Smart Venue Experience
 * @module utils
 * @version 1.0.0
 */

'use strict';

/**
 * Sanitizes a user-provided string to prevent XSS injection attacks.
 * Escapes HTML special characters before any DOM insertion.
 * @param {string} str - The raw input string
 * @returns {string} HTML-entity-escaped string safe for innerHTML
 */
export function sanitize(str) {
  if (typeof str !== 'string') return '';
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };
  return str.replace(/[&<>"'`=/]/g, (char) => escapeMap[char]);
}

/**
 * Creates a debounced version of a function that delays invocation
 * until after `ms` milliseconds of silence.
 * @param {Function} fn - The function to debounce
 * @param {number} [ms=300] - Delay in milliseconds
 * @returns {Function} Debounced function with a `.cancel()` method
 */
export function debounce(fn, ms = 300) {
  let timer;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/**
 * Creates a throttled version of a function that can only fire once
 * per `ms` millisecond window.
 * @param {Function} fn - The function to throttle
 * @param {number} [ms=100] - Throttle interval in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(fn, ms = 100) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

/**
 * Clamps a numeric value between min and max boundaries.
 * @param {number} val - Value to clamp
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number} Clamped value
 */
export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Linear interpolation between two values.
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0–1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Formats milliseconds into a human-readable duration string.
 * @param {number} ms - Duration in milliseconds
 * @returns {string} E.g. "30s", "5 min", "1h 20m"
 */
export function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Formats a wait time given in minutes.
 * @param {number} minutes
 * @returns {string}
 */
export function formatWait(minutes) {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return formatDuration(minutes * 60_000);
}

/**
 * Formats a large number with locale-appropriate thousand separators.
 * @param {number} n
 * @returns {string} E.g. "41,240"
 */
export function formatNumber(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

/**
 * Formats a currency amount.
 * @param {number} amount - Amount in dollars
 * @returns {string} E.g. "$12.99"
 */
export function formatCurrency(amount) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount); }

/**
 * Formats a Date object to a short time string.
 * @param {Date} [date=new Date()]
 * @returns {string} E.g. "3:45 PM"
 */
export function formatShortTime(date = new Date()) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Generates a cryptographically random UUID v4.
 * Falls back to Math.random() in environments without crypto.randomUUID.
 * @returns {string} UUID string
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Performs a deep clone of a serializable object using structuredClone
 * with JSON fallback for compatibility.
 * @template T
 * @param {T} obj
 * @returns {T} Deep clone
 */
export function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Returns a Promise that resolves after the specified delay.
 * Useful for async/await-style delays without blocking the thread.
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validates a zone or section identifier.
 * Zone IDs must be alphanumeric with optional hyphens/underscores, 1–32 chars.
 * @param {string} id
 * @returns {boolean}
 */
export function isValidZoneId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(id);
}

/**
 * Validates that a numeric value is within the expected capacity range.
 * @param {number} value
 * @param {number} capacity
 * @returns {boolean}
 */
export function isValidOccupancy(value, capacity) {
  return (
    typeof value === 'number' &&
    typeof capacity === 'number' &&
    Number.isFinite(value) &&
    Number.isFinite(capacity) &&
    value >= 0 &&
    capacity > 0 &&
    value <= capacity * 1.05 // allow small buffer for sensor inaccuracies
  );
}

/**
 * Computes the percentage of two numbers, rounded to 1 decimal place.
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
export function percentage(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Creates a safe DOM element from a template string,
 * never using innerHTML with unsanitized data.
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attribute map
 * @param {string} [text] - sanitized text content
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, text = '') {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'class') el.className = val;
    else if (key === 'data') {
      for (const [dk, dv] of Object.entries(val)) {
        el.dataset[dk] = dv;
      }
    } else if (key.startsWith('aria-')) {
      el.setAttribute(key, val);
    } else {
      el[key] = val;
    }
  }
  if (text) el.textContent = text; // textContent is XSS-safe
  return el;
}

/**
 * Picks a random element from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
export function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Returns a Gaussian-jittered number around a mean, bounded to [0, cap].
 * Used for realistic crowd simulation.
 * @param {number} mean - Center value
 * @param {number} stdDev - Standard deviation
 * @param {number} cap - Maximum value
 * @returns {number}
 */
export function gaussianJitter(mean, stdDev, cap) {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-9)) * Math.cos(2 * Math.PI * u2);
  return clamp(Math.round(mean + z * stdDev), 0, cap);
}
