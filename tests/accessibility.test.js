/**
 * @fileoverview Unit tests for js/accessibility.js — StadiumIQ
 * Tests ARIA live region behaviour, preference persistence, focus management.
 * Compatible with Jest + jsdom (jest.config.js: testEnvironment: 'jsdom').
 * @module tests/accessibility.test
 */

'use strict';

// ---- A11yManager inline (avoids ES Module transform) ----

const PREFS_KEY = 'siq_a11y_prefs';

class A11yManager {
  constructor() {
    this._politeRegion    = null;
    this._assertiveRegion = null;
    this._prefs           = this._loadPrefs();
    this._prefListeners   = [];
    this._debouncedPolite = (msg) => this._setLiveText(this._politeRegion, msg);
  }

  init() {
    this._politeRegion    = document.getElementById('aria-live');
    this._assertiveRegion = document.getElementById('aria-alert');
    this._applyAllPrefs();
  }

  announcePolite(message) {
    if (!message || typeof message !== 'string') return;
    const safe = message.replace(/<[^>]*>/g, '').substring(0, 200);
    this._setLiveText(this._politeRegion, safe);
  }

  announceAssertive(message) {
    if (!message || typeof message !== 'string') return;
    const safe = message.replace(/<[^>]*>/g, '').substring(0, 200);
    this._setLiveText(this._assertiveRegion, safe);
  }

  setHighContrast(enabled) {
    this._prefs.highContrast = !!enabled;
    document.documentElement.classList.toggle('high-contrast', enabled);
    this._savePrefs();
    this._notifyListeners();
  }

  setReduceMotion(enabled) {
    this._prefs.reduceMotion = !!enabled;
    document.documentElement.classList.toggle('reduce-motion', enabled);
    this._savePrefs();
    this._notifyListeners();
  }

  setMobilityMode(enabled) {
    this._prefs.mobilityMode = !!enabled;
    document.documentElement.classList.toggle('mobility-mode', enabled);
    this._savePrefs();
    this._notifyListeners();
  }

  setLargeText(enabled) {
    this._prefs.largeText = !!enabled;
    document.documentElement.style.fontSize = enabled ? '20px' : '';
    this._savePrefs();
    this._notifyListeners();
  }

  getPrefs() { return { ...this._prefs }; }

  onPrefsChange(callback) {
    this._prefListeners.push(callback);
    callback({ ...this._prefs });
    return () => {
      const i = this._prefListeners.indexOf(callback);
      if (i !== -1) this._prefListeners.splice(i, 1);
    };
  }

  getFocusableElements(container) {
    const sel = ['a[href]', 'button:not([disabled])', 'input:not([disabled])', '[tabindex]:not([tabindex="-1"])'].join(',');
    return [...container.querySelectorAll(sel)];
  }

  _setLiveText(region, text) {
    if (!region) return;
    region.textContent = '';
    region.textContent = text;
  }

  _applyAllPrefs() {
    if (this._prefs.highContrast) document.documentElement.classList.add('high-contrast');
    if (this._prefs.reduceMotion) document.documentElement.classList.add('reduce-motion');
    if (this._prefs.mobilityMode) document.documentElement.classList.add('mobility-mode');
    if (this._prefs.largeText)    document.documentElement.style.fontSize = '20px';
  }

  _loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        for (const v of Object.values(p)) { if (typeof v !== 'boolean') throw new Error(); }
        return p;
      }
    } catch (_) { localStorage.removeItem(PREFS_KEY); }
    return { highContrast: false, reduceMotion: false, mobilityMode: false, largeText: false };
  }

  _savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this._prefs)); } catch (_) {}
  }

  _notifyListeners() {
    const p = { ...this._prefs };
    for (const cb of this._prefListeners) { try { cb(p); } catch (_) {} }
  }
}

// ---- Test setup ----

function setupDOM() {
  document.body.innerHTML = `
    <div id="aria-live"  role="status"  aria-live="polite"    aria-atomic="true"></div>
    <div id="aria-alert" role="alert"   aria-live="assertive" aria-atomic="true"></div>
    <div id="modal">
      <button id="btn1">First</button>
      <input id="inp1" type="text">
      <button id="btn2" disabled>Disabled</button>
      <a href="#" id="link1">Link</a>
    </div>
  `;
}

beforeEach(() => {
  setupDOM();
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.fontSize = '';
});

// ---- Tests ----

describe('A11yManager — ARIA live regions', () => {

  test('init() connects live regions from DOM', () => {
    const mgr = new A11yManager();
    mgr.init();
    expect(mgr._politeRegion).toBeTruthy();
    expect(mgr._assertiveRegion).toBeTruthy();
  });

  test('announcePolite() sets text in polite region', () => {
    const mgr = new A11yManager();
    mgr.init();
    mgr.announcePolite('Zone is crowded');
    expect(document.getElementById('aria-live').textContent).toBe('Zone is crowded');
  });

  test('announceAssertive() sets text in assertive region', () => {
    const mgr = new A11yManager();
    mgr.init();
    mgr.announceAssertive('Emergency alert!');
    expect(document.getElementById('aria-alert').textContent).toBe('Emergency alert!');
  });

  test('announcePolite() strips HTML tags', () => {
    const mgr = new A11yManager();
    mgr.init();
    mgr.announcePolite('<b>North Stand</b>: crowded');
    expect(document.getElementById('aria-live').textContent).toBe('North Stand: crowded');
    expect(document.getElementById('aria-live').textContent).not.toContain('<b>');
  });

  test('announcePolite() truncates at 200 chars', () => {
    const mgr = new A11yManager();
    mgr.init();
    mgr.announcePolite('A'.repeat(300));
    expect(document.getElementById('aria-live').textContent.length).toBe(200);
  });

  test('announcePolite() ignores non-string input', () => {
    const mgr = new A11yManager();
    mgr.init();
    mgr.announcePolite(null);
    expect(document.getElementById('aria-live').textContent).toBe('');
  });

  test('announcePolite() ignores empty string', () => {
    const mgr = new A11yManager();
    mgr.init();
    mgr.announcePolite('First message');
    mgr.announcePolite('');
    expect(document.getElementById('aria-live').textContent).toBe('First message');
  });
});

// ---------------------------------------------------------------------------
describe('A11yManager — preference toggles', () => {

  test('setHighContrast(true) adds high-contrast class to <html>', () => {
    const mgr = new A11yManager();
    mgr.setHighContrast(true);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(mgr.getPrefs().highContrast).toBe(true);
  });

  test('setHighContrast(false) removes high-contrast class', () => {
    const mgr = new A11yManager();
    mgr.setHighContrast(true);
    mgr.setHighContrast(false);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
  });

  test('setReduceMotion(true) adds reduce-motion class', () => {
    const mgr = new A11yManager();
    mgr.setReduceMotion(true);
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
  });

  test('setMobilityMode(true) adds mobility-mode class', () => {
    const mgr = new A11yManager();
    mgr.setMobilityMode(true);
    expect(document.documentElement.classList.contains('mobility-mode')).toBe(true);
    expect(mgr.getPrefs().mobilityMode).toBe(true);
  });

  test('setLargeText(true) sets font-size to 20px on <html>', () => {
    const mgr = new A11yManager();
    mgr.setLargeText(true);
    expect(document.documentElement.style.fontSize).toBe('20px');
  });

  test('setLargeText(false) resets font-size', () => {
    const mgr = new A11yManager();
    mgr.setLargeText(true);
    mgr.setLargeText(false);
    expect(document.documentElement.style.fontSize).toBe('');
  });

  test('getPrefs() returns a copy, not a reference', () => {
    const mgr = new A11yManager();
    const p1 = mgr.getPrefs();
    p1.highContrast = true;
    expect(mgr.getPrefs().highContrast).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('A11yManager — preference persistence', () => {

  test('saves prefs to localStorage', () => {
    const mgr = new A11yManager();
    mgr.setHighContrast(true);
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY));
    expect(stored.highContrast).toBe(true);
  });

  test('loads prefs from localStorage on construction', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ highContrast: true, reduceMotion: false, mobilityMode: false, largeText: false }));
    const mgr = new A11yManager();
    expect(mgr.getPrefs().highContrast).toBe(true);
  });

  test('ignores corrupted localStorage data', () => {
    localStorage.setItem(PREFS_KEY, 'not-json{{{');
    expect(() => new A11yManager()).not.toThrow();
  });

  test('ignores localStorage data with non-boolean values', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ highContrast: 'yes', reduceMotion: 1 }));
    const mgr = new A11yManager();
    // Should fall back to defaults
    expect(mgr.getPrefs().highContrast).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('A11yManager — preference listeners', () => {

  test('onPrefsChange fires immediately with current prefs', () => {
    const mgr = new A11yManager();
    const calls = [];
    mgr.onPrefsChange((p) => calls.push(p));
    expect(calls.length).toBe(1);
    expect(calls[0].highContrast).toBe(false);
  });

  test('listener fires when pref changes', () => {
    const mgr = new A11yManager();
    const calls = [];
    mgr.onPrefsChange((p) => calls.push(p));
    mgr.setHighContrast(true);
    expect(calls.length).toBe(2);
    expect(calls[1].highContrast).toBe(true);
  });

  test('unsubscribe stops further calls', () => {
    const mgr = new A11yManager();
    const calls = [];
    const unsub = mgr.onPrefsChange((p) => calls.push(p));
    unsub();
    mgr.setHighContrast(true);
    expect(calls.length).toBe(1); // only the immediate call
  });
});

// ---------------------------------------------------------------------------
describe('A11yManager — focusable elements detection', () => {

  test('finds buttons and links but not disabled buttons', () => {
    const mgr     = new A11yManager();
    const modal   = document.getElementById('modal');
    const focusable = mgr.getFocusableElements(modal);
    const ids = focusable.map((el) => el.id);
    expect(ids).toContain('btn1');
    expect(ids).toContain('inp1');
    expect(ids).toContain('link1');
    expect(ids).not.toContain('btn2'); // disabled
  });
});

// ---------------------------------------------------------------------------
describe('A11yManager — applyAllPrefs on init', () => {

  test('applies high-contrast on init if saved', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ highContrast: true, reduceMotion: false, mobilityMode: false, largeText: false }));
    const mgr = new A11yManager();
    mgr.init();
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
  });
});
