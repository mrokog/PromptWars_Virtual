/**
 * @fileoverview Accessibility manager for StadiumIQ.
 * Provides ARIA live region announcements, high-contrast mode,
 * reduced-motion toggle, font scaling, and keyboard navigation helpers.
 * Targets WCAG 2.1 AA compliance.
 * @module accessibility
 * @version 1.0.0
 */

'use strict';

import { debounce } from './utils.js';

/** Storage key for persisted a11y preferences */
const PREFS_KEY = 'siq_a11y_prefs';

/**
 * @typedef {Object} A11yPrefs
 * @property {boolean} highContrast   - High-contrast mode
 * @property {boolean} reduceMotion   - Suppress animations
 * @property {boolean} mobilityMode   - Prefer accessible routes and zones
 * @property {boolean} largeText      - Increase base font size
 * @property {boolean} lightTheme     - Enable light mode
 */

// ---------------------------------------------------------------------------
// A11yManager
// ---------------------------------------------------------------------------

/**
 * WCAG 2.1 AA accessibility manager.
 * Manages ARIA live regions, user preference toggles, and keyboard traps.
 */
export class A11yManager {
  constructor() {
    /** @private @type {HTMLElement|null} */
    this._politeRegion = null;

    /** @private @type {HTMLElement|null} */
    this._assertiveRegion = null;

    /** @private @type {A11yPrefs} */
    this._prefs = this._loadPrefs();

    /** @private @type {Function[]} */
    this._prefListeners = [];

    /**
     * Debounced polite announcer — collapses rapid-fire updates
     * (e.g. crowd level changes) into a single announcement.
     * @private
     */
    this._debouncedPolite = debounce((msg) => this._setLiveText(this._politeRegion, msg), 600);
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Initializes the manager. Must be called after DOM is ready.
   * Sets up ARIA live regions, applies persisted preferences, and
   * hooks system media queries.
   */
  init() {
    this._politeRegion    = document.getElementById('aria-live');
    this._assertiveRegion = document.getElementById('aria-alert');

    if (!this._politeRegion || !this._assertiveRegion) {
      console.error('A11yManager: ARIA live regions not found in DOM');
    }

    this._applyAllPrefs();
    this._hookSystemPreferences();
    this._setupSkipLink();
    this._setupFocusOutline();
  }

  // -------------------------------------------------------------------------
  // ARIA Announcements
  // -------------------------------------------------------------------------

  /**
   * Makes a polite announcement — screen reader will finish current sentence first.
   * Debounced to avoid spamming with rapid updates.
   * @param {string} message - Plain text (not HTML)
   */
  announcePolite(message) {
    if (!message || typeof message !== 'string') return;
    // Truncate overly long announcements for screen-reader clarity
    const safe = message.replace(/<[^>]*>/g, '').substring(0, 200);
    this._debouncedPolite(safe);
  }

  /**
   * Makes an assertive announcement — interrupts current screen reader speech.
   * Use sparingly, only for emergencies or critical alerts.
   * @param {string} message - Plain text (not HTML)
   */
  announceAssertive(message) {
    if (!message || typeof message !== 'string') return;
    const safe = message.replace(/<[^>]*>/g, '').substring(0, 200);
    this._setLiveText(this._assertiveRegion, safe);
  }

  // -------------------------------------------------------------------------
  // Preference toggles
  // -------------------------------------------------------------------------

  /**
   * Enables or disables high-contrast mode.
   * @param {boolean} enabled
   */
  setHighContrast(enabled) {
    this._prefs.highContrast = !!enabled;
    document.documentElement.classList.toggle('high-contrast', enabled);
    this._savePrefs();
    this._notifyListeners();
    this.announcePolite(enabled ? 'High contrast mode enabled' : 'High contrast mode disabled');
  }

  /**
   * Enables or disables reduced-motion.
   * When enabled, sets `--motion-duration` to 0ms across the design system.
   * @param {boolean} enabled
   */
  setReduceMotion(enabled) {
    this._prefs.reduceMotion = !!enabled;
    document.documentElement.classList.toggle('reduce-motion', enabled);
    this._savePrefs();
    this._notifyListeners();
    this.announcePolite(enabled ? 'Motion effects reduced' : 'Motion effects enabled');
  }

  /**
   * Enables or disables mobility-friendly route preferences.
   * When true, the navigation module will prefer accessible paths and
   * the crowd engine will prefer accessible zones.
   * @param {boolean} enabled
   */
  setMobilityMode(enabled) {
    this._prefs.mobilityMode = !!enabled;
    document.documentElement.classList.toggle('mobility-mode', enabled);
    this._savePrefs();
    this._notifyListeners();
    this.announcePolite(enabled ? 'Mobility-friendly routes enabled' : 'Standard routes enabled');
  }

  /**
   * Enables or disables large text mode. Bumps the root font size by 25%.
   * @param {boolean} enabled
   */
  setLargeText(enabled) {
    this._prefs.largeText = !!enabled;
    document.documentElement.style.fontSize = enabled ? '20px' : '';
    this._savePrefs();
    this._notifyListeners();
    this.announcePolite(enabled ? 'Large text enabled' : 'Large text disabled');
  }

  /**
   * Enables or disables light theme.
   * @param {boolean} enabled
   */
  setLightTheme(enabled) {
    this._prefs.lightTheme = !!enabled;
    document.documentElement.setAttribute('data-theme', enabled ? 'light' : 'dark');
    this._savePrefs();
    this._notifyListeners();
    this.announcePolite(enabled ? 'Light mode enabled' : 'Dark mode enabled');
  }

  /** Returns a copy of current accessibility preferences. */
  getPrefs() { return { ...this._prefs }; }

  /**
   * Registers a listener called whenever preferences change.
   * @param {(prefs: A11yPrefs) => void} callback
   * @returns {Function} Unsubscribe function
   */
  onPrefsChange(callback) {
    this._prefListeners.push(callback);
    callback({ ...this._prefs });
    return () => {
      const i = this._prefListeners.indexOf(callback);
      if (i !== -1) this._prefListeners.splice(i, 1);
    };
  }

  // -------------------------------------------------------------------------
  // Focus management
  // -------------------------------------------------------------------------

  /**
   * Traps keyboard focus within a container element (for modals/drawers).
   * @param {HTMLElement} container
   * @returns {Function} Release function — call to remove the trap
   */
  trapFocus(container) {
    const focusable = this._getFocusableElements(container);
    if (!focusable.length) return () => {};

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    first.focus();

    const handler = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }

  /**
   * Moves focus to a target element, setting tabIndex=-1 if needed.
   * @param {HTMLElement|string} target - Element or CSS selector
   */
  moveFocus(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** @private */
  _setLiveText(region, text) {
    if (!region) return;
    // Clear first, then set — forces screen readers to re-announce same text
    region.textContent = '';
    requestAnimationFrame(() => { region.textContent = text; });
  }

  /** @private */
  _applyAllPrefs() {
    if (this._prefs.highContrast)  document.documentElement.classList.add('high-contrast');
    if (this._prefs.reduceMotion)  document.documentElement.classList.add('reduce-motion');
    if (this._prefs.mobilityMode)  document.documentElement.classList.add('mobility-mode');
    if (this._prefs.largeText)     document.documentElement.style.fontSize = '20px';
    if (this._prefs.lightTheme)    document.documentElement.setAttribute('data-theme', 'light');
    else                           document.documentElement.setAttribute('data-theme', 'dark');
  }

  /**
   * Hooks prefers-reduced-motion media query to auto-enable reduce-motion
   * if the OS setting is active (unless user overrode manually).
   * @private
   */
  _hookSystemPreferences() {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => {
      if (!this._prefs.reduceMotion && e.matches) {
        document.documentElement.classList.add('reduce-motion');
      }
    };
    mq.addEventListener('change', handler);
    handler(mq); // apply immediately
  }

  /** @private */
  _setupSkipLink() {
    const skipLink = document.querySelector('.skip-link');
    if (!skipLink) return;
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById('main-content');
      if (target) { this.moveFocus(target); }
    });
  }

  /**
   * Adds a visible focus ring only when navigating by keyboard
   * (removes it on mouse click to avoid visual clutter).
   * @private
   */
  _setupFocusOutline() {
    let usingMouse = false;
    document.addEventListener('mousedown', () => { usingMouse = true; });
    document.addEventListener('keydown',   () => { usingMouse = false; });
    document.addEventListener('focusin',   (e) => {
      if (usingMouse) e.target.classList.add('mouse-focus');
      else            e.target.classList.remove('mouse-focus');
    });
  }

  /** @private */
  _getFocusableElements(container) {
    const sel = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return [...container.querySelectorAll(sel)].filter(
      (el) => !el.closest('[hidden]') && !el.closest('[aria-hidden="true"]'),
    );
  }

  /** @private */
  _loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Validate that all keys are booleans
        for (const val of Object.values(parsed)) {
          if (typeof val !== 'boolean') throw new Error('Invalid prefs');
        }
        return parsed;
      }
    } catch (_) {
      localStorage.removeItem(PREFS_KEY);
    }
    return { highContrast: false, reduceMotion: false, mobilityMode: false, largeText: false, lightTheme: false };
  }

  /** @private */
  _savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this._prefs)); } catch (_) {}
  }

  /** @private */
  _notifyListeners() {
    const prefs = { ...this._prefs };
    for (const cb of this._prefListeners) { try { cb(prefs); } catch (_) {} }
  }
}

/** Singleton a11y manager */
export const a11yManager = new A11yManager();
