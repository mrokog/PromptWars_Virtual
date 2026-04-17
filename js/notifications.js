/**
 * @fileoverview Notification manager for StadiumIQ.
 * Handles in-app notification center, toast messages,
 * and Firebase Cloud Messaging (FCM) push notifications.
 * @module notifications
 * @version 1.0.0
 */

'use strict';

import { sanitize, generateId, formatShortTime, sleep } from './utils.js';

/**
 * @typedef {'info'|'warning'|'success'|'danger'} AlertType
 */

/**
 * @typedef {Object} AppNotification
 * @property {string}    id        - Unique identifier
 * @property {AlertType} type      - Severity level
 * @property {string}    title     - Notification headline
 * @property {string}    body      - Detail message
 * @property {number}    timestamp - Unix epoch ms
 * @property {boolean}   read      - Read state
 */

// ---------------------------------------------------------------------------
// Toast queue
// ---------------------------------------------------------------------------

const TOAST_DURATION_MS = 4000;
const TOAST_QUEUE_LIMIT = 5;

// ---------------------------------------------------------------------------
// NotificationManager
// ---------------------------------------------------------------------------

/**
 * Manages the in-app notification center and toast queue.
 *
 * Firebase Cloud Messaging integration points are marked with comments.
 * Production: initialize FCM and call requestPermission() on user interaction.
 */
export class NotificationManager {
  constructor() {
    /** @private @type {HTMLElement|null} */
    this._toastContainer = null;

    /** @private @type {number} Active toast count */
    this._activeToasts = 0;

    /** @private @type {boolean} FCM permission state */
    this._pushEnabled = false;

    /** @private @type {Function[]} Notification change listeners */
    this._listeners = [];
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /** Call after DOM is ready. */
  init() {
    this._toastContainer = document.getElementById('toast-container');
  }

  // -------------------------------------------------------------------------
  // Push permission (FCM)
  // -------------------------------------------------------------------------

  /**
   * Requests browser push notification permission.
   * Production: after permission, call getToken(messaging, { vapidKey }) to
   * register the FCM token and send it to your backend.
   *
   * @returns {Promise<boolean>} true if permission was granted
   */
  async requestPushPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') { this._pushEnabled = true; return true; }
    if (Notification.permission === 'denied')  return false;

    const result = await Notification.requestPermission();
    this._pushEnabled = result === 'granted';

    if (this._pushEnabled) {
      // Production: register FCM token here
      // const token = await getToken(messaging, { vapidKey: VAPID_KEY });
      // await fetch('/api/fcm-tokens', { method: 'POST', body: JSON.stringify({ token }) });
      console.info('[FCM] Push notifications enabled (token would be registered here)');
    }

    return this._pushEnabled;
  }

  /**
   * Simulates an incoming FCM push (for demo purposes).
   * Production: FCM SDK calls onMessage(messaging, handler) instead.
   * @param {AppNotification} notification
   */
  handleIncomingPush(notification) {
    if (this._pushEnabled && document.hidden) {
      // Show native notification when app is in background
      try {
        new Notification(sanitize(notification.title), {
          body: sanitize(notification.body),
          icon: '/icons/icon-192.png',
          tag:  notification.id,
        });
      } catch (_) {}
    }
    this.showToast(notification);
  }

  // -------------------------------------------------------------------------
  // Toast notifications
  // -------------------------------------------------------------------------

  /**
   * Shows a non-blocking toast notification at the bottom of the screen.
   * Auto-dismisses after TOAST_DURATION_MS. Respects queue limit.
   *
   * @param {AppNotification} notification
   */
  showToast(notification) {
    if (!this._toastContainer) return;
    if (this._activeToasts >= TOAST_QUEUE_LIMIT) return;

    const toast = this._createToastElement(notification);
    this._toastContainer.appendChild(toast);
    this._activeToasts++;

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add('toast--visible'));

    // Auto-dismiss
    const dismiss = () => {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', () => {
        toast.remove();
        this._activeToasts = Math.max(0, this._activeToasts - 1);
      }, { once: true });
    };

    const timer = setTimeout(dismiss, TOAST_DURATION_MS);

    // Manual dismiss on click
    toast.querySelector('.toast__close')?.addEventListener('click', () => {
      clearTimeout(timer);
      dismiss();
    });
  }

  /**
   * Shows a critical alert banner at the top of the viewport.
   * Used for emergencies and venue-wide broadcasts.
   * @param {string} message - Plain text
   * @param {AlertType} [type='danger']
   */
  showBanner(message, type = 'danger') {
    const banner = document.getElementById('alert-banner');
    const text   = document.getElementById('alert-banner-text');
    if (!banner || !text) return;

    text.textContent = sanitize(message);
    banner.dataset.type = type;
    banner.classList.remove('hidden');
    banner.setAttribute('aria-hidden', 'false');
  }

  /** Hides the top alert banner. */
  hideBanner() {
    const banner = document.getElementById('alert-banner');
    if (!banner) return;
    banner.classList.add('hidden');
    banner.setAttribute('aria-hidden', 'true');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Creates a toast DOM element.
   * Uses textContent (never innerHTML with user data) to prevent XSS.
   * @private
   * @param {AppNotification} n
   * @returns {HTMLElement}
   */
  _createToastElement(n) {
    const el = document.createElement('div');
    el.className = `toast toast--${n.type ?? 'info'}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');

    const icon = this._iconForType(n.type);

    // Build DOM safely without innerHTML
    const iconEl  = document.createElement('span');
    iconEl.className = 'toast__icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;

    const body = document.createElement('div');
    body.className = 'toast__body';

    const title = document.createElement('p');
    title.className = 'toast__title';
    title.textContent = n.title;

    const msg = document.createElement('p');
    msg.className = 'toast__msg';
    msg.textContent = n.body;

    const time = document.createElement('span');
    time.className = 'toast__time';
    time.textContent = formatShortTime(new Date(n.timestamp ?? Date.now()));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast__close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '×';

    body.append(title, msg, time);
    el.append(iconEl, body, closeBtn);
    return el;
  }

  /** @private */
  _iconForType(type) {
    return { info: 'ℹ️', warning: '⚠️', success: '✅', danger: '🚨' }[type] ?? 'ℹ️';
  }
}

/** Singleton notification manager */
export const notifManager = new NotificationManager();
