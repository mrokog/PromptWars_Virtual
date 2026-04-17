/**
 * @fileoverview Firebase-backed (simulated) real-time data store for StadiumIQ.
 * Mimics Firebase Realtime Database + Firestore listener patterns.
 * Replace simulation blocks with actual Firebase SDK calls for production.
 * @module realtime
 * @version 1.0.0
 */

'use strict';

import { deepClone, gaussianJitter, randomChoice, generateId, formatShortTime } from './utils.js';

// ---------------------------------------------------------------------------
// Initial venue data — would come from Firestore in production
// ---------------------------------------------------------------------------

/** @type {import('./crowd.js').ZoneData[]} */
const INITIAL_ZONES = [
  // Stands
  { id: 'north-stand',   name: 'North Stand',    type: 'stand',      capacity: 12000, occupancy: 9800,  accessible: true  },
  { id: 'south-stand',   name: 'South Stand',    type: 'stand',      capacity: 12000, occupancy: 10100, accessible: true  },
  { id: 'east-stand',    name: 'East Stand',     type: 'stand',      capacity: 8000,  occupancy: 5500,  accessible: false },
  { id: 'west-stand',    name: 'West Stand',     type: 'stand',      capacity: 8000,  occupancy: 6800,  accessible: true  },
  { id: 'ne-corner',     name: 'NE Corner',      type: 'stand',      capacity: 3000,  occupancy: 1800,  accessible: false },
  { id: 'nw-corner',     name: 'NW Corner',      type: 'stand',      capacity: 3000,  occupancy: 2100,  accessible: false },
  { id: 'se-corner',     name: 'SE Corner',      type: 'stand',      capacity: 3000,  occupancy: 2900,  accessible: false },
  { id: 'sw-corner',     name: 'SW Corner',      type: 'stand',      capacity: 3000,  occupancy: 2600,  accessible: false },
  // Gates
  { id: 'gate-a',        name: 'Gate A (North)', type: 'gate',       capacity: 800,   occupancy: 480,   accessible: true  },
  { id: 'gate-b',        name: 'Gate B (South)', type: 'gate',       capacity: 800,   occupancy: 310,   accessible: true  },
  { id: 'gate-c',        name: 'Gate C (East)',  type: 'gate',       capacity: 600,   occupancy: 520,   accessible: false },
  { id: 'gate-d',        name: 'Gate D (West)',  type: 'gate',       capacity: 600,   occupancy: 150,   accessible: true  },
  // Concessions
  { id: 'food-n1',       name: 'Concession N1',  type: 'concession', capacity: 60,    occupancy: 48,    accessible: true  },
  { id: 'food-n2',       name: 'Concession N2',  type: 'concession', capacity: 60,    occupancy: 22,    accessible: true  },
  { id: 'food-s1',       name: 'Concession S1',  type: 'concession', capacity: 60,    occupancy: 55,    accessible: true  },
  { id: 'food-s2',       name: 'Concession S2',  type: 'concession', capacity: 60,    occupancy: 30,    accessible: false },
  { id: 'food-e1',       name: 'Concession E1',  type: 'concession', capacity: 40,    occupancy: 18,    accessible: true  },
  { id: 'food-w1',       name: 'Concession W1',  type: 'concession', capacity: 40,    occupancy: 38,    accessible: false },
  // Restrooms
  { id: 'rest-n1',       name: 'Restroom N1',    type: 'restroom',   capacity: 30,    occupancy: 22,    accessible: true  },
  { id: 'rest-s1',       name: 'Restroom S1',    type: 'restroom',   capacity: 30,    occupancy: 28,    accessible: true  },
  { id: 'rest-e1',       name: 'Restroom E1',    type: 'restroom',   capacity: 20,    occupancy: 8,     accessible: false },
  { id: 'rest-w1',       name: 'Restroom W1',    type: 'restroom',   capacity: 20,    occupancy: 16,    accessible: true  },
  // First Aid
  { id: 'aid-north',     name: 'First Aid N',    type: 'firstaid',   capacity: 10,    occupancy: 1,     accessible: true  },
  { id: 'aid-south',     name: 'First Aid S',    type: 'firstaid',   capacity: 10,    occupancy: 0,     accessible: true  },
];

const INITIAL_ALERTS = [
  { id: 'a1', type: 'info',    title: 'Gates Open',           body: 'All gates are now open. Enjoy the match!',                timestamp: Date.now() - 300000, read: false },
  { id: 'a2', type: 'warning', title: 'South Stand Crowded',  body: 'South Stand nearing capacity. Try East Stand.',           timestamp: Date.now() - 120000, read: false },
  { id: 'a3', type: 'success', title: 'Boundary! 4 Runs',     body: 'Great shot by Kohli!',                                    timestamp: Date.now() - 60000,  read: false },
];

const CONCESSION_MENU = [
  { id: 'm1', stand: 'food-n1', name: 'Vada Pav',               category: 'snacks',   price: 20.00,  emoji: '🍔', popular: true  },
  { id: 'm2', stand: 'food-n1', name: 'Samosa (2 pcs)',         category: 'snacks',   price: 30.00,  emoji: '🥟', popular: true  },
  { id: 'm3', stand: 'food-n1', name: 'Masala Chai',            category: 'drinks',   price: 15.00,  emoji: '☕', popular: true  },
  { id: 'm4', stand: 'food-n1', name: 'Bottled Water',          category: 'drinks',   price: 20.00,  emoji: '💧', popular: false },
  { id: 'm5', stand: 'food-n2', name: 'Chicken Biryani',        category: 'hot-food', price: 200.00, emoji: '🍗', popular: false },
  { id: 'm6', stand: 'food-n2', name: 'Popcorn (Large)',        category: 'snacks',   price: 50.00,  emoji: '🍿', popular: true  },
  { id: 'm7', stand: 'food-n2', name: 'Pani Puri (6 pcs)',      category: 'snacks',   price: 40.00,  emoji: '😋', popular: false },
  { id: 'm8', stand: 'food-s1', name: 'Paneer Tikka Roll',      category: 'hot-food', price: 120.00, emoji: '🌯', popular: true  },
  { id: 'm9', stand: 'food-s1', name: 'Chole Bhature',          category: 'hot-food', price: 150.00, emoji: '🍛', popular: false },
  { id: 'm10',stand: 'food-s2', name: 'French Fries',           category: 'snacks',   price: 80.00,  emoji: '🍟', popular: false },
  { id: 'm11',stand: 'food-s2', name: 'Gulab Jamun (2 pcs)',    category: 'desserts', price: 50.00,  emoji: '🍩', popular: true  },
  { id: 'm12',stand: 'food-e1', name: 'Veggie Wrap',            category: 'hot-food', price: 100.00, emoji: '🌯', popular: false },
  { id: 'm13',stand: 'food-w1', name: 'Nimbu Pani',             category: 'drinks',   price: 30.00,  emoji: '🍋', popular: false },
  { id: 'm14',stand: 'food-w1', name: 'Jalebi (100g)',          category: 'desserts', price: 40.00,  emoji: '🥨', popular: false },
];

const EVENT_DATA = {
  cricket: {
    match: {
      homeTeam:   'RCB', awayTeam:   'CSK',
      homeScore:  182,   awayScore:  150,
      period:     'Innings 2', clock: '18.2 Overs', status: 'live'
    },
    history: [
      { date: '12 Apr 2026', title: 'RCB win by 10 runs', venue: 'Chinnaswamy' },
      { date: '05 May 2025', title: 'CSK win by 8 wickets', venue: 'Chepauk' }
    ]
  },
  football: {
    match: {
      homeTeam:   'Mohun Bagan', awayTeam:   'East Bengal',
      homeScore:  2,             awayScore:  1,
      period:     '2nd Half',    clock: '78:45', status: 'live'
    },
    history: [
      { date: '20 Feb 2026', title: 'Mohun Bagan win 3-1', venue: 'Salt Lake' },
      { date: '10 Nov 2025', title: 'Draw 0-0', venue: 'Salt Lake' }
    ]
  },
  badminton: {
    match: {
      homeTeam:   'Sindhu', awayTeam:   'Marin',
      homeScore:  21,       awayScore:  18,
      period:     'Game 3', clock: 'Live', status: 'live'
    },
    history: [
      { date: '08 Mar 2026', title: 'Sindhu wins 2-1', venue: 'All England' }
    ]
  },
  tennis: {
    match: {
      homeTeam:   'Bopanna', awayTeam:   'Ram',
      homeScore:  3,         awayScore:  4,
      period:     'Set 3',   clock: '40-AD', status: 'live'
    },
    history: [
      { date: '15 Jan 2026', title: 'Bopanna wins 3-2', venue: 'Aus Open' }
    ]
  }
};

// ---------------------------------------------------------------------------
// DataStore class
// ---------------------------------------------------------------------------

/**
 * Simulated real-time data store.
 * Uses setInterval to mimic Firebase Realtime Database push events.
 * In production: swap `_startSimulation` calls for `firebase.database().ref().on()`
 * and Firestore `onSnapshot` listeners.
 */
export class DataStore {
  constructor() {
    /** @private @type {Map<string, import('./crowd.js').ZoneData>} */
    this._zones = new Map(INITIAL_ZONES.map((z) => [z.id, deepClone(z)]));

    /** @private @type {Object[]} */
    this._alerts = deepClone(INITIAL_ALERTS);

    /** @private @type {Map<string, Function[]>} */
    this._listeners = new Map();

    /** Live match state */
    this._match = deepClone(EVENT_DATA.cricket.match);
    
    /** Match history */
    this._history = deepClone(EVENT_DATA.cricket.history);

    /** @private @type {number[]} interval IDs for cleanup */
    this._intervals = [];
  }

  setSport(sportId) {
    if (EVENT_DATA[sportId]) {
      this._match = deepClone(EVENT_DATA[sportId].match);
      this._history = deepClone(EVENT_DATA[sportId].history);
      this._notify('match');
      this._notify('history');
    }
  }

  // -------------------------------------------------------------------------
  // Subscription API (mirrors Firebase .on() pattern)
  // -------------------------------------------------------------------------

  /**
   * Subscribe to a data path. Listener fires immediately with current data,
   * then on every update.
   *
   * @param {string}   path     - e.g. 'zones', 'match', 'alerts'
   * @param {Function} callback - Called with current data on each update
   * @returns {Function} Unsubscribe function — call to stop receiving updates
   */
  subscribe(path, callback) {
    if (!this._listeners.has(path)) this._listeners.set(path, []);
    this._listeners.get(path).push(callback);

    // Emit current value immediately
    callback(this._read(path));

    return () => {
      const list = this._listeners.get(path) ?? [];
      const idx  = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /**
   * Write data to a path and notify subscribers.
   * @param {string} path
   * @param {*} data
   */
  update(path, data) {
    this._write(path, data);
    this._notify(path);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  getZones()  { return [...this._zones.values()]; }
  getAlerts() { return deepClone(this._alerts); }
  getMatch()  { return deepClone(this._match); }
  getMatchHistory() { return deepClone(this._history); }
  getMenu()   { return deepClone(CONCESSION_MENU); }

  getUnreadAlertCount() {
    return this._alerts.filter((a) => !a.read).length;
  }

  markAlertRead(id) {
    const alert = this._alerts.find((a) => a.id === id);
    if (alert) { alert.read = true; this._notify('alerts'); }
  }

  markAllAlertsRead() {
    this._alerts.forEach((a) => (a.read = true));
    this._notify('alerts');
  }

  addAlert(alert) {
    this._alerts.unshift({ id: generateId(), timestamp: Date.now(), read: false, ...alert });
    if (this._alerts.length > 50) this._alerts.pop(); // cap at 50
    this._notify('alerts');
  }

  // -------------------------------------------------------------------------
  // Simulation — replace with real Firebase listeners in production
  // -------------------------------------------------------------------------

  /**
   * Starts all simulation loops.
   * Called once by app.js on boot.
   */
  startSimulation() {
    // Update zone occupancy every 5 seconds
    this._intervals.push(
      setInterval(() => this._tickZones(), 5000),
    );

    // Tick match clock every second
    this._intervals.push(
      setInterval(() => this._tickMatch(), 1000),
    );

    // Generate occasional random alerts every 45 seconds
    this._intervals.push(
      setInterval(() => this._maybeAddAlert(), 45000),
    );
  }

  /** Stops all simulation loops (useful for cleanup/testing). */
  stopSimulation() {
    this._intervals.forEach(clearInterval);
    this._intervals = [];
  }

  // -------------------------------------------------------------------------
  // Private simulation helpers
  // -------------------------------------------------------------------------

  /** @private */
  _tickZones() {
    for (const [id, zone] of this._zones) {
      // Drift occupancy with Gaussian jitter; stands drift slowly, service zones faster
      const drift = zone.type === 'stand' ? 80 : 5;
      zone.occupancy = gaussianJitter(zone.occupancy, drift, zone.capacity);
    }
    this._notify('zones');
  }

  /** @private */
  _tickMatch() {
    // Simple clock countdown simulation
    if (this._match.status !== 'live') return;
    const [min, sec] = this._match.clock.split(':').map(Number);
    let totalSecs = min * 60 + sec;
    totalSecs = Math.max(0, totalSecs - 1);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    this._match.clock = `${m}:${s.toString().padStart(2, '0')}`;

    // Random scoring event ~0.1% chance per tick
    if (Math.random() < 0.001) {
      const scorer = Math.random() < 0.55 ? 'home' : 'away';
      const runs = [1, 4, 6][Math.floor(Math.random() * 3)];
      if (scorer === 'home') this._match.homeScore += runs;
      else this._match.awayScore += runs;

      const team = scorer === 'home' ? this._match.homeTeam : this._match.awayTeam;
      const typeStr = runs === 6 ? 'SIX!' : runs === 4 ? 'FOUR!' : `${runs} Run`;
      
      this.addAlert({
        type:  'success',
        title: `${typeStr} - ${this._match.homeScore} vs ${this._match.awayScore}`,
        body:  `${team} scores ${typeStr} in ${this._match.period}! ${formatShortTime()}`,
      });
    }

    this._notify('match');
  }

  /** @private */
  _maybeAddAlert() {
    if (Math.random() < 0.4) return; // only fires ~60% of the time
    const candidates = [
      { type: 'warning', title: 'Gate C at Capacity', body: 'Please use Gate D on the West side.' },
      { type: 'info',    title: 'Halftime in 5 min',  body: 'Visit concession stands now to beat the rush.' },
      { type: 'warning', title: 'South Stand Busy',   body: 'South Stand at 92% capacity. Try East Stand.' },
      { type: 'info',    title: 'Parking Update',     body: 'Lot B is now open for easier exit access.' },
    ];
    this.addAlert(randomChoice(candidates));
  }

  /** @private */
  _read(path) {
    switch (path) {
      case 'zones':  return this.getZones();
      case 'alerts': return this.getAlerts();
      case 'match':  return this.getMatch();
      case 'menu':   return this.getMenu();
      default:       return null;
    }
  }

  /** @private */
  _write(path, data) {
    if (path.startsWith('zones/')) {
      const id = path.split('/')[1];
      if (this._zones.has(id)) Object.assign(this._zones.get(id), data);
    }
  }

  /** @private */
  _notify(path) {
    const listeners = this._listeners.get(path) ?? [];
    const data = this._read(path);
    for (const cb of listeners) {
      try { cb(data); } catch (e) { console.error(`DataStore listener error [${path}]:`, e); }
    }
  }
}

/** Singleton instance shared across the application */
export const dataStore = new DataStore();
