/**
 * @fileoverview Central configuration for SportsVilla.
 * Manages Google Services API keys, Firebase configurations, and environment flags.
 * In production, these should be managed via environment variables and build-time injection.
 */

'use strict';

/**
 * Google Services Configuration
 */
export const GOOGLE_CONFIG = {
  // Firebase configuration
  firebase: {
    apiKey:            'AIzaSyB-DUMMY-KEY-FOR-EVALUATION',
    authDomain:        'promptwars-virtual-493513.firebaseapp.com',
    databaseURL:       'https://promptwars-virtual-493513-default-rtdb.firebaseio.com',
    projectId:         'promptwars-virtual-493513',
    storageBucket:     'promptwars-virtual-493513.appspot.com',
    messagingSenderId: '542617789000',
    appId:             '1:542617789000:web:abcdef1234567890',
  },

  // Google Maps JS API key
  maps: {
    apiKey: 'AIzaSyB-DUMMY-MAPS-KEY-FOR-EVALUATION',
  },

  // FCM VAPID Key (Public)
  fcmVapidKey: 'B...'
};

/**
 * Application environment flags
 */
export const ENV = {
  isDev:      true, // Set to false in production
  useMock:    true, // Set to false when actual services are ready
  version:    '1.2.0',
};
