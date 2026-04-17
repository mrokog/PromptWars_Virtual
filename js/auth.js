/**
 * @fileoverview Firebase Authentication manager for StadiumIQ.
 * Wraps Google Sign-In via Firebase Auth SDK.
 * Production: swap simulation methods for real firebase/auth SDK calls.
 * @module auth
 * @version 1.0.0
 */

'use strict';

import { sanitize, generateId } from './utils.js';
import { GOOGLE_CONFIG } from './config.js';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut 
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

/**
 * @typedef {Object} StadiumUser
 * @property {string} uid         - Firebase user ID
 * @property {string} displayName - User's full name
 * @property {string} email       - User's email
 * @property {string} photoURL    - Avatar URL
 * @property {string} role        - 'attendee' | 'staff' | 'admin'
 * @property {Object} ticket      - Ticket information
 */

// ---------------------------------------------------------------------------
// AuthManager
// ---------------------------------------------------------------------------

/**
 * Manages authentication state for the application.
 * In production, initialize Firebase with your config and swap the
 * simulation methods for:
 *   import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
 */
export class AuthManager {
  constructor() {
    /** @private @type {StadiumUser|null} */
    this._currentUser = null;

    /** @private @type {Function[]} */
    this._listeners = [];

    /** @private */
    this._sessionKey = 'siq_session';

    /** @private */
    this._auth = getAuth();

    // Restore persisted session
    this._restoreSession();

    // Listen to real Firebase auth changes
    onAuthStateChanged(this._auth, (user) => {
      if (user) {
        this._setUserFromFirebase(user);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initiates Google Sign-In flow (simulated popup).
   * Production: replace with signInWithPopup(auth, new GoogleAuthProvider())
   *
   * @returns {Promise<StadiumUser>}
   */
  async signInWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(this._auth, provider);
      return this._setUserFromFirebase(result.user);
    } catch (error) {
      console.warn('[AuthManager] Firebase sign-in failed, falling back to demo mode:', error.message);
      
      // Demo fallback logic
      const user = {
        uid:         generateId(),
        displayName: 'Alex Johnson',
        email:       'alex.johnson@example.com',
        photoURL:    'https://ui-avatars.com/api/?name=Alex+Johnson&background=3b82f6&color=fff&size=128',
        role:        'attendee',
        ticket: {
          section: '112', row: '15', seat: '7', gate: 'C',
          event:   'Lakers vs Celtics — April 17, 2026',
        },
      };

      this._setUser(user);
      return user;
    }
  }

  /**
   * Internal helper to map Firebase User to StadiumUser
   * @private
   */
  _setUserFromFirebase(fbUser) {
    const user = {
      uid:         fbUser.uid,
      displayName: fbUser.displayName || 'Stadium Fan',
      email:       fbUser.email || '',
      photoURL:    fbUser.photoURL || '',
      role:        'attendee',
      ticket:      this._currentUser?.ticket || { section: '112', row: '15', seat: '7', gate: 'C', event: 'Match' }
    };
    this._setUser(user);
    return user;
  }

  /**
   * Signs the current user out and clears session.
   * Production: replace with signOut(auth)
   * @returns {Promise<void>}
   */
  async signOut() {
    try {
      await signOut(this._auth);
    } catch (e) {
      console.error('[AuthManager] Firebase signout error:', e);
    }
    this._setUser(null);
  }

  /**
   * Returns the currently authenticated user, or null.
   * @returns {StadiumUser|null}
   */
  getCurrentUser() {
    return this._currentUser ? { ...this._currentUser } : null;
  }

  /**
   * Registers a listener that fires whenever auth state changes.
   * Fires immediately with current state.
   *
   * @param {(user: StadiumUser|null) => void} callback
   * @returns {Function} Unsubscribe function
   */
  onAuthStateChanged(callback) {
    this._listeners.push(callback);
    callback(this.getCurrentUser());
    return () => {
      const idx = this._listeners.indexOf(callback);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Returns whether the current user has a given role.
   * @param {'attendee'|'staff'|'admin'} role
   * @returns {boolean}
   */
  hasRole(role) {
    return this._currentUser?.role === role;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** @private */
  _setUser(user) {
    this._currentUser = user;
    this._persistSession(user);
    for (const cb of this._listeners) {
      try { cb(user ? { ...user } : null); } catch (e) { console.error('AuthManager listener error:', e); }
    }
  }

  /**
   * Persists user data to sessionStorage (not localStorage to avoid
   * cross-tab privilege leakage). Only non-sensitive fields are stored.
   * @private
   */
  _persistSession(user) {
    try {
      if (user) {
        // Only persist safe, non-sensitive display fields
        const safe = {
          uid:         sanitize(user.uid),
          displayName: sanitize(user.displayName),
          email:       sanitize(user.email),
          photoURL:    user.photoURL, // URL — validated on load
          role:        user.role,
          ticket:      user.ticket,
        };
        sessionStorage.setItem(this._sessionKey, JSON.stringify(safe));
      } else {
        sessionStorage.removeItem(this._sessionKey);
      }
    } catch (_) {
      // sessionStorage may be unavailable in private/restricted contexts
    }
  }

  /** @private */
  _restoreSession() {
    try {
      const raw = sessionStorage.getItem(this._sessionKey);
      if (!raw) return;
      const user = JSON.parse(raw);
      // Validate URL field before restoring — prevent stored XSS
      if (user.photoURL && !/^https?:\/\//.test(user.photoURL)) {
        user.photoURL = '';
      }
      this._currentUser = user;
    } catch (_) {
      sessionStorage.removeItem(this._sessionKey);
    }
  }
}

/** Singleton auth manager */
export const authManager = new AuthManager();
